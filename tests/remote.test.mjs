// Checks that every call the app makes in Supabase mode matches a real SQL function
// (names, argument names, argument types and result shapes), by running src/lib/remote.js
// against the migrations in PGlite.
import test, { before, after } from "node:test";
import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import { PGlite } from "@electric-sql/pglite";
import { __setClientForTests } from "../src/lib/supabaseClient.js";
import * as remote from "../src/lib/remote.js";
import { derive } from "../src/lib/engine.js";

const db = new PGlite();
const sql = (f) => readFileSync(new URL(`../supabase/${f}`, import.meta.url), "utf8");
const ID = { owner: "00000000-0000-0000-0000-00000000000a", manager: "00000000-0000-0000-0000-00000000000b", waiter: "00000000-0000-0000-0000-00000000000c", kitchen: "00000000-0000-0000-0000-00000000000d" };
let current = { role: "anon", sub: "" };
const as = (who) => { current = who === "anon" ? { role: "anon", sub: "" } : { role: "authenticated", sub: ID[who] }; };

const client = {
  async rpc(fn, args = {}) {
    await db.exec("reset role");
    await db.query("select set_config('request.jwt.claim.sub', $1, false)", [current.sub]);
    await db.exec(`set role ${current.role}`);
    const keys = Object.keys(args);
    const values = keys.map((k) => {
      const v = args[k];
      if (Array.isArray(v)) return `{${v.join(",")}}`;
      return v !== null && typeof v === "object" ? JSON.stringify(v) : v;
    });
    try {
      const r = await db.query(`select ${fn}(${keys.map((k, i) => `${k} => $${i + 1}`).join(", ")}) as r`, values);
      return { data: r.rows[0].r, error: null };
    } catch (e) {
      return { data: null, error: { message: e.message } };
    } finally { await db.exec("reset role"); }
  },
  channel() { const c = { on: () => c, subscribe: () => c }; return c; },
  removeChannel() {},
};

let state = { version: 2 };
const hooks = { getState: () => state, setState: (s) => { state = derive(s); } };

before(async () => {
  await db.exec(`
    create role anon nologin; create role authenticated nologin; create schema auth;
    create table auth.users (id uuid primary key default gen_random_uuid(), email text);
    create function auth.uid() returns uuid language sql stable as $$ select nullif(current_setting('request.jwt.claim.sub', true), '')::uuid $$;
    grant usage on schema auth to anon, authenticated; grant execute on function auth.uid() to anon, authenticated;
    grant usage on schema public to anon, authenticated;`);
  for (const f of ["migrations/0001_schema.sql", "migrations/0002_functions.sql", "migrations/0003_security.sql", "migrations/0004_pin_login.sql", "seed.sql"]) await db.exec(sql(f));
  for (const [role, id] of Object.entries(ID)) {
    await db.query("insert into auth.users (id, email) values ($1, $2)", [id, `${role}@x.com`]);
    await db.query("insert into profiles (id, full_name, role) values ($1, $2, $3)", [id, role, role]);
  }
  // Browser globals are added after PGlite starts (it would otherwise think it is in a browser).
  globalThis.document = { addEventListener() {}, removeEventListener() {}, visibilityState: "visible" };
  globalThis.window = { addEventListener() {}, removeEventListener() {} };
  __setClientForTests(client);
  remote.init(hooks);
});
after(() => remote.stopStaff());

const ok = (r) => { assert.equal(r.ok, true, r.error); return r; };

test("customer path: load menu, order, request service, follow orders", async () => {
  as("anon");
  await remote.loadMenu("3");
  assert.equal(state.ready, true);
  assert.equal(state.tables[0].label, "Table 3");
  const burger = state.items.find((i) => i.name === "Beef Burger");
  assert.equal(burger.soldOut, false);
  assert.ok(state.items.find((i) => i.name === "Grilled Sea Bass").soldOut);
  const res = ok(await remote.placeOrder({ tableId: "3", lines: [{ key: "k", itemId: burger.id, qty: 2, extras: ["Bacon"], note: "" }], note: "" }));
  assert.equal(res.order.subtotal, 2800);
  ok(await remote.requestService({ tableId: "3", type: "bill" }));
  const mine = await remote.getOrdersByIds([res.order.id]);
  assert.equal(mine[0].number, res.order.number);
  assert.equal((await remote.setOrderStatus(res.order.id, "preparing", {})).ok, false); // customers can't
});

test("staff path: snapshot, then every action the app can send", async () => {
  as("manager");
  await remote.startStaff();
  assert.equal(state.staffReady, true);
  assert.ok(state.orders.length >= 1 && state.tabs.length >= 1 && state.ingredients.length === 8);
  const order = state.orders[0];
  const tab = state.tabs.find((t) => t.id === order.tabId);
  assert.equal(tab.status, "bill"); // the customer asked for the bill

  ok(await remote.setOrderStatus(order.id, "preparing", {}));
  ok(await remote.setOrderStatus(order.id, "ready", {}));
  ok(await remote.setOrderStatus(order.id, "preparing", { force: true }));
  ok(await remote.setDiscount(tab.id, { type: "percent", value: 10, reason: "regular guest" }));
  ok(await remote.setDiscount(tab.id, null));
  ok(await remote.voidLine(order.id, 0, "guest changed mind"));
  ok(await remote.resolveRequest((await client.rpc("staff_snapshot")).data.state.requests[0].id));

  ok(await remote.upsertIngredient({ name: "Mint", unit: "kg", lowAt: 0.2, onHand: 1.5 }));
  const mint = (await client.rpc("staff_snapshot")).data.state.ingredients.find((g) => g.name === "Mint");
  ok(await remote.adjustStock({ ingredientId: mint.id, delta: 1, reason: "restock", note: "delivery" }));
  ok(await remote.upsertIngredient({ id: mint.id, name: "Fresh mint", unit: "kg", lowAt: 0.3 }));

  ok(await remote.upsertCategory({ name: "Sides" }));
  const sides = (await client.rpc("staff_snapshot")).data.state.categories.find((c) => c.name === "Sides");
  ok(await remote.upsertCategory({ id: sides.id, name: "Side dishes" }));
  ok(await remote.moveCategory(sides.id, -1));
  const item = ok(await remote.upsertItem({ name: "Mint tea", description: "", price: 300, categoryId: sides.id, station: "cold", popular: false, available: true,
    extras: [{ name: "Honey", price: 50 }], recipe: [{ ingredientId: mint.id, qty: 0.01 }] })).item;
  ok(await remote.setItemAvailable(item.id, false));
  ok(await remote.deleteItem(item.id));
  ok(await remote.deleteCategory(sides.id));
  ok(await remote.deleteIngredient(mint.id));

  ok(await remote.addTable("Terrace 1"));
  ok(await remote.deleteTable("terrace-1"));
  ok(await remote.updateSettings({ name: "Cedar & Coal", taxRate: 11, paperWidth: 58, receiptCopies: 2, kitchenSplitStations: true }));

  // waiter flow: order, move, merge, pay
  as("waiter");
  const burger = state.items.find((i) => i.name === "Beef Burger");
  const a = ok(await remote.placeOrder({ tableId: "10", lines: [{ key: "a", itemId: burger.id, qty: 1, extras: [], note: "" }] })).order;
  const b = ok(await remote.placeOrder({ tableId: "11", lines: [{ key: "b", itemId: burger.id, qty: 1, extras: [], note: "" }] })).order;
  ok(await remote.moveTab(a.tabId, "12"));
  ok(await remote.mergeTabs(a.tabId, b.tabId));
  const paid = ok(await remote.addPayment(b.tabId, { method: "cash", amount: 2664 }));
  assert.equal(paid.closed, true);
  const empty = ok(await remote.placeOrder({ tableId: "1", lines: [{ key: "c", itemId: burger.id, qty: 1, extras: [], note: "" }] })).order;
  ok(await remote.voidLine(empty.id, 0, "changed mind"));
  ok(await remote.closeTab(empty.tabId));

  // a refreshed snapshot reflects the changes
  await new Promise((r) => setTimeout(r, 50));
  const snap = (await client.rpc("staff_snapshot")).data.state;
  assert.equal(snap.settings.name, "Cedar & Coal");
  assert.equal(snap.tabs.find((t) => t.id === b.tabId).status, "paid");
  assert.equal(snap.tabs.find((t) => t.id === b.tabId).payments[0].amount, 2664);
});

test("friendly errors", async () => {
  as("anon");
  const denied = await remote.addPayment("00000000-0000-0000-0000-000000000001", { method: "cash", amount: 1 });
  assert.equal(denied.ok, false);
  assert.match(denied.error, /access|wrong/i);
});
