// Runs the Supabase migrations in a real Postgres engine (PGlite) and checks the business rules,
// permissions and row-level security. No Supabase account is needed:  npm test
import test, { before } from "node:test";
import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import { PGlite } from "@electric-sql/pglite";

const db = new PGlite();
const sql = (f) => readFileSync(new URL(`../supabase/${f}`, import.meta.url), "utf8");
const ID = { owner: "00000000-0000-0000-0000-00000000000a", manager: "00000000-0000-0000-0000-00000000000b", waiter: "00000000-0000-0000-0000-00000000000c", kitchen: "00000000-0000-0000-0000-00000000000d" };
const as = (role) => (role === "anon" ? { role: "anon", sub: "" } : { role: "authenticated", sub: ID[role] });

async function use(who) {
  await db.exec("reset role");
  await db.query("select set_config('request.jwt.claim.sub', $1, false)", [who.sub]);
  await db.exec(`set role ${who.role}`);
}
async function rpc(who, fn, args = {}) {
  await use(who);
  const keys = Object.keys(args);
  const values = keys.map((k) => (args[k] !== null && typeof args[k] === "object" && !Array.isArray(args[k]) ? JSON.stringify(args[k]) : Array.isArray(args[k]) ? `{${args[k].join(",")}}` : args[k]));
  const call = `select ${fn}(${keys.map((k, i) => `${k} => $${i + 1}`).join(", ")}) as r`;
  try { return (await db.query(call, values)).rows[0].r; } finally { await db.exec("reset role"); }
}
async function admin(q, params) { await db.exec("reset role"); return (await db.query(q, params)).rows; }
const denied = async (p) => assert.rejects(p, /permission denied|must be owner|row-level security/i);
const WAITER = as("waiter"), MANAGER = as("manager"), ANON = as("anon"), OWNER = as("owner"), KITCHEN = as("kitchen");

let ids = {};
before(async () => {
  await db.exec(`
    create role anon nologin; create role authenticated nologin;
    create schema auth;
    create table auth.users (id uuid primary key default gen_random_uuid(), email text);
    create function auth.uid() returns uuid language sql stable as $$ select nullif(current_setting('request.jwt.claim.sub', true), '')::uuid $$;
    grant usage on schema auth to anon, authenticated;
    grant execute on function auth.uid() to anon, authenticated;
    grant usage on schema public to anon, authenticated;`);
  for (const f of ["migrations/0001_schema.sql", "migrations/0002_functions.sql", "migrations/0003_security.sql", "migrations/0004_pin_login.sql", "seed.sql"]) await db.exec(sql(f));
  for (const [role, id] of Object.entries(ID)) {
    await db.query("insert into auth.users (id, email) values ($1, $2)", [id, `${role}@x.com`]);
    await db.query("insert into profiles (id, full_name, role) values ($1, $2, $3)", [id, role[0].toUpperCase() + role.slice(1), role]);
  }
  const items = await admin("select id, name from items");
  ids.item = Object.fromEntries(items.map((i) => [i.name, i.id]));
  const ing = await admin("select id, name from ingredients");
  ids.ing = Object.fromEntries(ing.map((i) => [i.name, i.id]));
});

const line = (name, qty = 1, extras = [], note = "") => ({ itemId: ids.item[name], qty, extras, note });
const onHand = async (name) => Number((await admin("select on_hand from ingredients where name = $1", [name]))[0].on_hand);
const place = (who, tableId, lines, note = "") => rpc(who, "place_order", { p: { tableId, lines, note } });
const bill = async (tabId) => (await admin("select _tab_bill($1) as b", [tabId]))[0].b;

test("customers can read the menu but not the tables", async () => {
  const menu = await rpc(ANON, "get_public_menu", { p_table: "5" });
  assert.equal(menu.ok, true);
  assert.equal(menu.state.items.length, 19);
  assert.deepEqual(menu.state.tables, [{ id: "5", label: "Table 5" }]);
  assert.equal(menu.state.settings.name, "Cedar and Coal");
  assert.equal("kitchenPin" in menu.state.settings, false);
  const none = await rpc(ANON, "get_public_menu", { p_table: "nope" });
  assert.deepEqual(none.state.tables, []);
  await use(ANON);
  await assert.rejects(db.query("select * from orders"), /permission denied/);
  await assert.rejects(db.query("select * from items"), /permission denied/);
  await assert.rejects(db.query("update settings set name = 'x'"), /permission denied/);
  await assert.rejects(db.query("select staff_snapshot()"), /permission denied/);
  await db.exec("reset role");
});

test("customer order: server prices, tab, stock deduction", async () => {
  const before = await onHand("Beef patties");
  const res = await place(ANON, "5", [{ ...line("Beef Burger", 2, ["Extra cheese"]), price: 1 }]);
  assert.equal(res.ok, true, res.error);
  assert.equal(res.order.subtotal, 2700); // (1200 + 150) x 2, the price sent by the browser is ignored
  assert.equal(res.order.total, 2997);
  assert.equal(res.order.source, "customer");
  assert.equal(res.order.items[0].voided, null);
  assert.equal(await onHand("Beef patties"), before - 2);
  const tabs = await admin("select * from tabs where table_id = '5' and status = 'open'");
  assert.equal(tabs.length, 1);
  assert.equal(tabs[0].waiter, null);
  // a waiter adds a round to the same bill and is recorded on it
  const r2 = await place(WAITER, "5", [line("Fresh Lemonade", 2)]);
  assert.equal(r2.order.source, "waiter");
  assert.equal(r2.order.placedBy, "Waiter");
  const tabs2 = await admin("select * from tabs where table_id = '5' and status in ('open','bill')");
  assert.equal(tabs2.length, 1);
  assert.equal(tabs2[0].waiter, "Waiter");
});

test("takeaway orders each get their own bill; bad input is rejected", async () => {
  await place(ANON, "takeaway", [line("Fresh Lemonade")]);
  await place(ANON, "takeaway", [line("Fresh Lemonade")]);
  const n = (await admin("select count(*)::int as n from tabs where table_id = 'takeaway' and status = 'open'"))[0].n;
  assert.equal(n, 2);
  assert.equal((await place(ANON, "nope", [line("Knafeh")])).ok, false);
  assert.equal((await place(ANON, "5", [])).ok, false);
  assert.equal((await place(ANON, "5", [{ itemId: "not-a-uuid", qty: 1 }])).ok, false);
  const huge = await place(ANON, "5", [line("Knafeh", 9999)]);
  assert.equal(huge.order.items[0].qty, 50);
});

test("stock: sold out by stock, unavailable dishes, ordering paused, blocking can be switched off", async () => {
  const lamb = await onHand("Lamb chops");
  await admin("update ingredients set on_hand = 3 where name = 'Lamb chops'");
  const menu = await rpc(ANON, "get_public_menu", { p_table: "1" });
  assert.equal(menu.state.items.find((i) => i.name === "Lamb Chops").stockOut, true);
  const bad = await place(ANON, "1", [line("Lamb Chops")]);
  assert.equal(bad.ok, false);
  assert.match(bad.error, /sold out/);
  const buns = await onHand("Burger buns");
  const big = await place(ANON, "1", [line("Beef Burger", 50), line("Beef Burger", 1, ["Bacon"])]);
  assert.equal(big.ok, buns >= 51 ? true : false);
  await admin("update ingredients set on_hand = 2 where name = 'Burger buns'");
  const short = await place(ANON, "1", [line("Beef Burger", 3)]);
  assert.match(short.error, /Not enough Burger buns/);
  await admin("update items set available = false where name = 'Knafeh'");
  assert.match((await place(ANON, "1", [line("Knafeh")])).error, /sold out/);
  await admin("update settings set ordering_open = false");
  assert.match((await place(ANON, "1", [line("Hummus Beiruti")])).error, /paused/);
  assert.equal((await place(WAITER, "1", [line("Hummus Beiruti")])).ok, true); // staff can still order
  await admin("update settings set ordering_open = true, block_out_of_stock = false");
  const through = await place(ANON, "2", [line("Lamb Chops")]);
  assert.equal(through.ok, true);
  assert.ok((await onHand("Lamb chops")) < 0);
  await admin("update settings set block_out_of_stock = true");
  await admin("update ingredients set on_hand = $1 where name = 'Lamb chops'", [lamb]);
  await admin("update ingredients set on_hand = 40 where name = 'Burger buns'");
  await admin("update items set available = true where name = 'Knafeh'");
  await admin("update tabs set status = 'void' where table_id in ('1','2')");
});

test("cancel restocks only before cooking; undo re-deducts; kitchen can move status, customers can't", async () => {
  const o = (await place(WAITER, "6", [line("Beef Burger")])).order;
  const base = await onHand("Beef patties");
  assert.equal((await rpc(KITCHEN, "set_order_status", { p_id: o.id, p_status: "ready" })).ok, false); // skipping a step
  await denied(rpc(ANON, "set_order_status", { p_id: o.id, p_status: "preparing" }));
  const c = await rpc(WAITER, "set_order_status", { p_id: o.id, p_status: "cancelled" });
  assert.equal(c.ok, true);
  assert.equal(c.previous, "new");
  assert.equal(await onHand("Beef patties"), base + 1);
  await rpc(WAITER, "set_order_status", { p_id: o.id, p_status: "new", p_force: true });
  assert.equal(await onHand("Beef patties"), base);
  assert.equal((await rpc(KITCHEN, "set_order_status", { p_id: o.id, p_status: "preparing" })).ok, true);
  await rpc(WAITER, "set_order_status", { p_id: o.id, p_status: "cancelled" });
  assert.equal(await onHand("Beef patties"), base); // wasted, not restocked
  const row = (await admin("select * from orders where id = $1", [o.id]))[0];
  assert.ok(row.started_at && row.cancelled_at);
  await admin("update tabs set status = 'void' where table_id = '6'");
});

test("removing items needs a reason and permission, recalculates, restocks before cooking", async () => {
  const o = (await place(WAITER, "7", [line("Beef Burger"), line("Hummus Beiruti")])).order;
  assert.equal((await rpc(WAITER, "void_line", { p_order: o.id, p_idx: 0, p_reason: "" })).ok, false);
  await denied(rpc(ANON, "void_line", { p_order: o.id, p_idx: 0, p_reason: "guest left" }));
  assert.equal((await rpc(KITCHEN, "void_line", { p_order: o.id, p_idx: 0, p_reason: "kitchen can't" })).ok, false);
  const base = await onHand("Beef patties");
  const v = await rpc(WAITER, "void_line", { p_order: o.id, p_idx: 0, p_reason: "guest changed mind" });
  assert.equal(v.ok, true, v.error);
  assert.equal(await onHand("Beef patties"), base + 1);
  const row = (await admin("select subtotal, total from orders where id = $1", [o.id]))[0];
  assert.equal(row.subtotal, 600);
  assert.equal((await rpc(WAITER, "void_line", { p_order: o.id, p_idx: 0, p_reason: "again please" })).ok, false);
  await admin("update settings set waiter_can_void = false");
  assert.equal((await rpc(WAITER, "void_line", { p_order: o.id, p_idx: 1, p_reason: "not allowed now" })).ok, false);
  assert.equal((await rpc(MANAGER, "void_line", { p_order: o.id, p_idx: 1, p_reason: "manager override" })).ok, true);
  await admin("update settings set waiter_can_void = true");
  assert.equal((await admin("select status from tabs where table_id = '7'"))[0].status, "open"); // table tabs stay open
  await admin("update tabs set status = 'void' where table_id = '7'");
  // takeaway: removing the only item closes the empty bill
  const t = (await place(ANON, "takeaway", [line("Knafeh")])).order;
  await rpc(WAITER, "void_line", { p_order: t.id, p_idx: 0, p_reason: "changed mind" });
  assert.equal((await admin("select status from tabs where id = $1", [t.tabId]))[0].status, "void");
});

test("bill maths, discount limits, partial payments and closing", async () => {
  const o = (await place(WAITER, "8", [line("Beef Burger", 2)])).order; // 2400
  const tab = o.tabId;
  let b = await bill(tab);
  assert.deepEqual([b.subtotal, b.tax, b.total], [2400, 264, 2664]);
  assert.equal((await rpc(WAITER, "set_discount", { p_tab: tab, p_type: "percent", p_value: 20, p_reason: "regular" })).ok, false);
  assert.equal((await rpc(WAITER, "set_discount", { p_tab: tab, p_type: "percent", p_value: 10, p_reason: "" })).ok, false);
  const d = await rpc(WAITER, "set_discount", { p_tab: tab, p_type: "percent", p_value: 10, p_reason: "regular guest" });
  assert.equal(d.ok, true, d.error);
  b = await bill(tab);
  assert.deepEqual([b.discount, b.net, b.tax, b.total], [240, 2160, 238, 2398]);
  assert.equal((await rpc(MANAGER, "set_discount", { p_tab: tab, p_type: "percent", p_value: 20, p_reason: "vip" })).ok, true);
  assert.equal((await rpc(WAITER, "set_discount", { p_tab: tab, p_type: null, p_value: null, p_reason: null })).ok, false); // 20% is above a waiter's limit
  assert.equal((await rpc(MANAGER, "set_discount", { p_tab: tab, p_type: "amount", p_value: 100, p_reason: "coffee on us" })).ok, true);
  assert.equal((await rpc(MANAGER, "set_discount", { p_tab: tab, p_type: null, p_value: null, p_reason: null })).ok, true);

  assert.equal((await rpc(WAITER, "add_payment", { p_tab: tab, p_method: "cash", p_amount: 1000 })).closed, false);
  assert.equal((await rpc(WAITER, "add_payment", { p_tab: tab, p_method: "card", p_amount: 99999 })).ok, false);
  assert.equal((await rpc(WAITER, "add_payment", { p_tab: tab, p_method: "bitcoin", p_amount: 5 })).ok, false);
  b = await bill(tab);
  assert.equal(b.paid, 1000);
  const r = await rpc(WAITER, "add_payment", { p_tab: tab, p_method: "card", p_amount: b.due });
  assert.equal(r.closed, true);
  assert.equal((await admin("select status from tabs where id = $1", [tab]))[0].status, "paid");
  assert.equal((await rpc(WAITER, "add_payment", { p_tab: tab, p_method: "card", p_amount: 1 })).ok, false);
  const next = await place(ANON, "8", [line("Hummus Beiruti")]);
  assert.notEqual(next.order.tabId, tab);
  await denied(rpc(ANON, "add_payment", { p_tab: tab, p_method: "cash", p_amount: 1 }));
  await admin("update tabs set status = 'void' where table_id = '8'");
});

test("move and merge bills", async () => {
  const a = (await place(WAITER, "10", [line("Hummus Beiruti")])).order;
  const b = (await place(WAITER, "11", [line("Fattoush")])).order;
  assert.equal((await rpc(WAITER, "move_tab", { p_tab: a.tabId, p_to: "11" })).ok, false);
  assert.equal((await rpc(WAITER, "move_tab", { p_tab: a.tabId, p_to: "12" })).ok, true);
  assert.equal((await admin("select table_label from orders where id = $1", [a.id]))[0].table_label, "Table 12");
  assert.equal((await rpc(WAITER, "merge_tabs", { p_from: a.tabId, p_into: b.tabId })).ok, true);
  assert.equal((await bill(b.tabId)).subtotal, 1400);
  assert.equal((await admin("select status from tabs where id = $1", [a.tabId]))[0].status, "void");
  assert.equal((await rpc(WAITER, "merge_tabs", { p_from: b.tabId, p_into: b.tabId })).ok, false);
  await admin("update tabs set status = 'void' where table_id in ('10','11','12')");
});

test("call waiter and request bill", async () => {
  assert.equal((await rpc(ANON, "request_service", { p_table: "12", p_type: "bill" })).ok, false); // nothing ordered yet
  assert.equal((await rpc(ANON, "request_service", { p_table: "takeaway", p_type: "waiter" })).ok, false);
  assert.equal((await rpc(ANON, "request_service", { p_table: "12", p_type: "waiter" })).ok, true);
  await rpc(ANON, "request_service", { p_table: "12", p_type: "waiter" });
  assert.equal((await admin("select count(*)::int as n from service_requests where table_id = '12'"))[0].n, 1);
  const o = (await place(ANON, "9", [line("Hummus Beiruti")])).order;
  assert.equal((await rpc(ANON, "request_service", { p_table: "9", p_type: "bill" })).ok, true);
  assert.equal((await admin("select status from tabs where id = $1", [o.tabId]))[0].status, "bill");
  const b = await bill(o.tabId);
  await rpc(WAITER, "add_payment", { p_tab: o.tabId, p_method: "cash", p_amount: b.due });
  assert.equal((await admin("select status from service_requests where table_id = '9'"))[0].status, "done");
  const req = (await admin("select id from service_requests where table_id = '12'"))[0];
  assert.equal((await rpc(WAITER, "resolve_request", { p_id: req.id })).ok, true);
  await denied(rpc(ANON, "resolve_request", { p_id: req.id }));
  await admin("update settings set customer_requests = false");
  assert.equal((await rpc(ANON, "request_service", { p_table: "3", p_type: "waiter" })).ok, false);
  assert.equal((await rpc(WAITER, "request_service", { p_table: "3", p_type: "waiter" })).ok, true);
  await admin("update settings set customer_requests = true");
});

test("inventory and menu management are manager-only and validated", async () => {
  assert.equal((await rpc(WAITER, "adjust_stock", { p_ingredient: ids.ing["Chicken"], p_delta: 5, p_reason: "restock", p_note: "" })).ok, false);
  const before = await onHand("Chicken");
  assert.equal((await rpc(MANAGER, "adjust_stock", { p_ingredient: ids.ing["Chicken"], p_delta: 5, p_reason: "restock", p_note: "delivery" })).ok, true);
  assert.equal(await onHand("Chicken"), before + 5);
  assert.equal((await rpc(MANAGER, "adjust_stock", { p_ingredient: ids.ing["Chicken"], p_delta: -999, p_reason: "waste", p_note: "" })).ok, false);
  assert.equal((await rpc(MANAGER, "adjust_stock", { p_ingredient: ids.ing["Chicken"], p_delta: 2, p_reason: "waste", p_note: "" })).ok, false);
  assert.equal((await rpc(MANAGER, "delete_ingredient", { p_id: ids.ing["Chicken"] })).ok, false); // used in recipes
  assert.equal((await rpc(MANAGER, "upsert_ingredient", { p: { name: "chicken", unit: "kg", lowAt: 1, onHand: 1 } })).ok, false);
  const made = await rpc(MANAGER, "upsert_ingredient", { p: { name: "Sumac", unit: "kg", lowAt: 0.5, onHand: 2 } });
  assert.equal(made.ok, true, made.error);
  assert.equal(await onHand("Sumac"), 2);

  const cat = (await admin("select id from categories where name = 'Starters'"))[0].id;
  const sumac = (await admin("select id from ingredients where name = 'Sumac'"))[0].id;
  const item = { name: "Sumac Salad", description: "x", price: 700, categoryId: cat, station: "cold", extras: [{ name: "Feta", price: 100 }], recipe: [{ ingredientId: sumac, qty: 0.02 }] };
  assert.equal((await rpc(WAITER, "upsert_item", { p: item })).ok, false);
  assert.equal((await rpc(MANAGER, "upsert_item", { p: { ...item, price: 7.5 } })).ok, false);
  assert.equal((await rpc(MANAGER, "upsert_item", { p: { ...item, extras: [{ name: "A", price: 1 }, { name: "a", price: 2 }] } })).ok, false);
  assert.equal((await rpc(MANAGER, "upsert_item", { p: { ...item, recipe: [{ ingredientId: sumac, qty: 0 }] } })).ok, false);
  const saved = await rpc(MANAGER, "upsert_item", { p: item });
  assert.equal(saved.ok, true, saved.error);
  assert.deepEqual(saved.item.recipe, [{ ingredientId: sumac, qty: 0.02 }]);
  const edited = await rpc(MANAGER, "upsert_item", { p: { ...item, id: saved.item.id, name: "Sumac Salad 2", recipe: [] } });
  assert.equal(edited.item.recipe.length, 0);
  assert.equal((await rpc(MANAGER, "delete_item", { p_id: saved.item.id })).ok, true);
  assert.equal((await rpc(MANAGER, "delete_ingredient", { p_id: sumac })).ok, true);

  // categories and tables
  assert.equal((await rpc(MANAGER, "upsert_category", { p_id: null, p_name: "starters" })).ok, false);
  assert.equal((await rpc(MANAGER, "upsert_category", { p_id: null, p_name: "Sides" })).ok, true);
  const order = async () => (await admin("select name from categories order by position, name")).map((c) => c.name);
  assert.equal((await order()).at(-1), "Sides");
  const sides = (await admin("select id from categories where name = 'Sides'"))[0].id;
  await rpc(MANAGER, "move_category", { p_id: sides, p_dir: -1 });
  assert.equal((await order()).at(-2), "Sides");
  assert.equal((await rpc(MANAGER, "delete_category", { p_id: cat })).ok, false); // has dishes
  assert.equal((await rpc(MANAGER, "delete_category", { p_id: sides })).ok, true);
  assert.equal((await rpc(MANAGER, "add_table", { p_label: "Terrace 1" })).ok, true);
  assert.equal((await rpc(MANAGER, "add_table", { p_label: "terrace 1" })).ok, false);
  assert.equal((await rpc(MANAGER, "delete_table", { p_id: "terrace-1" })).ok, true);
  assert.equal((await rpc(MANAGER, "delete_table", { p_id: "takeaway" })).ok, false);
  assert.equal((await rpc(WAITER, "add_table", { p_label: "Nope" })).ok, false);
});

test("settings: manager only, validated, partial updates", async () => {
  assert.equal((await rpc(WAITER, "update_settings", { p: { name: "Hacked" } })).ok, false);
  assert.equal((await rpc(MANAGER, "update_settings", { p: { taxRate: 150 } })).ok, false);
  assert.equal((await rpc(MANAGER, "update_settings", { p: { paperWidth: 70 } })).ok, false);
  const r = await rpc(MANAGER, "update_settings", { p: { paperWidth: 58, receiptCopies: 2, kitchenAutoPrint: true, receiptFooter: "Merci!" } });
  assert.equal(r.ok, true, r.error);
  const s = (await rpc(WAITER, "staff_snapshot")).state.settings;
  assert.deepEqual([s.paperWidth, s.receiptCopies, s.kitchenAutoPrint, s.receiptFooter, s.name], [58, 2, true, "Merci!", "Cedar and Coal"]);
  await rpc(MANAGER, "update_settings", { p: { paperWidth: 80, receiptCopies: 1, kitchenAutoPrint: false } });
});

test("staff snapshot has the shapes the app expects; customers follow only their own orders", async () => {
  await denied(rpc(ANON, "staff_snapshot"));
  const o = (await place(ANON, "4", [line("Beef Burger", 1, ["Bacon"], "no pickles")], "allergy")).order;
  const snap = (await rpc(KITCHEN, "staff_snapshot")).state;
  const so = snap.orders.find((x) => x.id === o.id);
  assert.equal(so.items[0].note, "no pickles");
  assert.deepEqual(so.items[0].extras, [{ name: "Bacon", price: 200 }]);
  assert.equal(typeof so.createdAt, "number");
  const tab = snap.tabs.find((t) => t.id === o.tabId);
  assert.deepEqual([tab.status, tab.discount, tab.payments], ["open", null, []]);
  assert.equal(typeof tab.taxRate, "number");
  assert.ok(snap.items.find((i) => i.name === "Beef Burger").recipe.length === 2);
  assert.ok(snap.ingredients[0].onHand !== undefined && snap.tables.length >= 13);
  assert.deepEqual(snap.audit, []); // kitchen can't see the audit log
  const mgr = (await rpc(MANAGER, "staff_snapshot")).state;
  assert.ok(mgr.audit.length > 0);
  const mine = await rpc(ANON, "get_orders_by_ids", { p_ids: [o.id, "00000000-0000-0000-0000-000000000099"] });
  assert.equal(mine.length, 1);
  assert.equal(mine[0].status, "new");
  await admin("update tabs set status = 'void' where table_id = '4'");
});

test("row-level security and owner protection", async () => {
  await use(WAITER);
  assert.ok((await db.query("select count(*)::int as n from orders")).rows[0].n > 0);
  await assert.rejects(db.query("update orders set status = 'served'"), /permission denied/);
  await assert.rejects(db.query("insert into payments (tab_id, method, amount) select id, 'cash', 1 from tabs limit 1"), /permission denied/);
  const profiles = (await db.query("select id from profiles")).rows;
  assert.equal(profiles.length, 1); // a waiter only sees their own profile
  assert.equal((await db.query("select * from audit_log")).rows.length, 0); // the audit log is hidden from waiters
  await use(MANAGER);
  assert.equal((await db.query("select count(*)::int as n from profiles")).rows[0].n, 4);
  const r = await db.query("update profiles set role = 'owner' where id = $1 returning id", [ID.waiter]);
  assert.equal(r.rows.length, 0); // only owners can change roles
  await use(OWNER);
  assert.equal((await db.query("update profiles set role = 'manager' where id = $1 returning id", [ID.waiter])).rows.length, 1);
  await assert.rejects(db.query("update profiles set active = false where id = $1", [ID.owner]), /at least one active owner/);
  await db.exec("reset role");
  await admin("update profiles set role = 'waiter' where id = $1", [ID.waiter]);
});
