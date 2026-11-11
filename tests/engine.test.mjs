import test from "node:test";
import assert from "node:assert/strict";
import * as E from "../src/lib/engine.js";
import { seed } from "../src/lib/seed.js";
import { billOf, tableStatus } from "../src/lib/billing.js";

const WAITER = { name: "Rami", role: "waiter" };
const MANAGER = { name: "Dana", role: "manager" };
const fresh = () => E.derive({ ...seed() });
const line = (itemId, qty = 1, extras = [], note = "") => ({ key: itemId + extras.join(), itemId, qty, extras, note });
const must = (res) => { assert.equal(res.ok, true, res.error); return res.state; };
const D = (s) => E.derive(s);

test("customer order opens a tab, deducts stock and uses tab rates", () => {
  let s = fresh();
  const patties = s.ingredients.find((i) => i.id === "g-patty").onHand;
  const res = E.placeOrder(s, { tableId: "5", lines: [line("i-burger", 2, ["Extra cheese"])] });
  s = D(must(res));
  const tab = s.tabs.find((t) => t.tableId === "5" && t.status === "open");
  assert.ok(tab);
  assert.equal(res.order.source, "customer");
  assert.equal(res.order.subtotal, (1200 + 150) * 2);
  assert.equal(res.order.total, Math.round(2700 * 1.11));
  assert.equal(s.ingredients.find((i) => i.id === "g-patty").onHand, patties - 2);
  assert.equal(s.stockMoves.filter((m) => m.reason === "sale").length, 2); // patty + bun
});

test("second order for the same table joins the same tab; takeaway gets its own tab", () => {
  let s = fresh();
  s = D(must(E.placeOrder(s, { tableId: "5", lines: [line("i-hummus")] })));
  s = D(must(E.placeOrder(s, { tableId: "5", lines: [line("i-fattoush")] }, WAITER)));
  assert.equal(s.tabs.filter((t) => t.tableId === "5" && t.status === "open").length, 1);
  const tab = s.tabs.find((t) => t.tableId === "5" && t.status === "open");
  assert.equal(tab.waiter, "Rami");
  s = D(must(E.placeOrder(s, { tableId: "takeaway", lines: [line("i-hummus")] })));
  s = D(must(E.placeOrder(s, { tableId: "takeaway", lines: [line("i-hummus")] })));
  const newTake = s.tabs.filter((t) => t.tableId === "takeaway" && t.status === "open");
  assert.equal(newTake.length, 3); // 1 seeded + 2 new
});

test("out-of-stock dishes are sold out and rejected", () => {
  let s = fresh();
  assert.equal(s.items.find((i) => i.id === "i-lamb").soldOut, true); // 3 chops, needs 4
  const res = E.placeOrder(s, { tableId: "1", lines: [line("i-lamb")] });
  assert.equal(res.ok, false);
  // burgers: only enough for the quantity in stock
  const buns = s.ingredients.find((i) => i.id === "g-bun").onHand;
  const big = E.placeOrder(s, { tableId: "1", lines: [line("i-burger", buns + 1)] });
  assert.equal(big.ok, false);
  assert.match(big.error, /Not enough/);
  // when blocking is off the order goes through and stock goes negative
  s = D(must(E.updateSettings(s, { blockOutOfStock: false })));
  s = D(must(E.placeOrder(s, { tableId: "1", lines: [line("i-lamb")] })));
  assert.ok(s.ingredients.find((i) => i.id === "g-lamb").onHand < 0);
});

test("cancelling a new order restocks; cancelling a started order does not; undo re-deducts", () => {
  let s = fresh();
  const res = E.placeOrder(s, { tableId: "6", lines: [line("i-burger")] });
  s = D(must(res));
  const before = s.ingredients.find((i) => i.id === "g-patty").onHand;
  s = D(must(E.setOrderStatus(s, res.order.id, "cancelled", {}, WAITER)));
  assert.equal(s.ingredients.find((i) => i.id === "g-patty").onHand, before + 1);
  s = D(must(E.setOrderStatus(s, res.order.id, "new", { force: true }, WAITER)));
  assert.equal(s.ingredients.find((i) => i.id === "g-patty").onHand, before);
  s = D(must(E.setOrderStatus(s, res.order.id, "preparing", {}, WAITER)));
  s = D(must(E.setOrderStatus(s, res.order.id, "cancelled", {}, WAITER)));
  assert.equal(s.ingredients.find((i) => i.id === "g-patty").onHand, before); // wasted, not restocked
});

test("status can only move forward one step", () => {
  let s = fresh();
  const res = E.placeOrder(s, { tableId: "6", lines: [line("i-hummus")] });
  s = D(must(res));
  assert.equal(E.setOrderStatus(s, res.order.id, "ready", {}, WAITER).ok, false);
  assert.equal(E.setOrderStatus(s, res.order.id, "preparing", {}, { name: "x", role: "customer" }).ok, false);
});

test("void line: reason required, waiter permission, totals recalculated, restock only before cooking", () => {
  let s = fresh();
  const res = E.placeOrder(s, { tableId: "6", lines: [line("i-burger"), line("i-hummus")] }, WAITER);
  s = D(must(res));
  assert.equal(E.voidLine(s, res.order.id, 0, "", WAITER).ok, false);
  assert.equal(E.voidLine(s, res.order.id, 0, "guest changed mind", { name: "c", role: "customer" }).ok, false);
  const before = s.ingredients.find((i) => i.id === "g-patty").onHand;
  s = D(must(E.voidLine(s, res.order.id, 0, "guest changed mind", WAITER)));
  assert.equal(s.ingredients.find((i) => i.id === "g-patty").onHand, before + 1);
  const o = s.orders.find((x) => x.id === res.order.id);
  assert.equal(o.subtotal, 600);
  assert.equal(E.voidLine(s, res.order.id, 0, "again please", WAITER).ok, false);
  // waiters can be blocked from voiding
  let t = D(must(E.updateSettings(s, { waiterCanVoid: false })));
  assert.equal(E.voidLine(t, res.order.id, 1, "no reason", WAITER).ok, false);
  must(E.voidLine(t, res.order.id, 1, "manager fixes", MANAGER));
});

test("voiding everything on a takeaway order closes its empty tab", () => {
  let s = fresh();
  const res = E.placeOrder(s, { tableId: "takeaway", lines: [line("i-hummus")] });
  s = D(must(res));
  s = D(must(E.setOrderStatus(s, res.order.id, "cancelled", {}, WAITER)));
  assert.equal(s.tabs.find((t) => t.id === res.order.tabId).status, "void");
});

test("bill maths: discount before VAT, partial payments, closes when fully paid", () => {
  let s = fresh();
  const res = E.placeOrder(s, { tableId: "6", lines: [line("i-burger", 2)] }, WAITER); // 2400
  s = D(must(res));
  const tab = () => s.tabs.find((t) => t.id === res.order.tabId);
  let bill = billOf(tab(), s.orders);
  assert.deepEqual([bill.subtotal, bill.tax, bill.total], [2400, 264, 2664]);

  // waiter limited to 10%
  assert.equal(E.setDiscount(s, tab().id, { type: "percent", value: 20, reason: "regular" }, WAITER).ok, false);
  s = D(must(E.setDiscount(s, tab().id, { type: "percent", value: 10, reason: "regular guest" }, WAITER)));
  bill = billOf(tab(), s.orders);
  assert.deepEqual([bill.discount, bill.net, bill.tax, bill.total], [240, 2160, 238, 2398]);
  assert.equal(E.setDiscount(s, tab().id, { type: "percent", value: 20, reason: "vip" }, MANAGER).ok, true);
  assert.equal(E.setDiscount(s, tab().id, { type: "percent", value: 10 }, WAITER).ok, false); // reason needed

  s = D(must(E.addPayment(s, tab().id, { method: "cash", amount: 1000 }, WAITER)));
  assert.equal(tab().status, "open");
  assert.equal(E.addPayment(s, tab().id, { method: "card", amount: 99999 }, WAITER).ok, false);
  bill = billOf(tab(), s.orders);
  const r = E.addPayment(s, tab().id, { method: "card", amount: bill.due }, WAITER);
  s = D(must(r));
  assert.equal(r.closed, true);
  assert.equal(tab().status, "paid");
  assert.equal(E.addPayment(s, tab().id, { method: "card", amount: 1 }, WAITER).ok, false);
  // a new order on the table now opens a new tab
  const again = E.placeOrder(s, { tableId: "6", lines: [line("i-hummus")] });
  assert.notEqual(again.order.tabId, tab().id);
});

test("move and merge tabs", () => {
  let s = fresh();
  const a = E.placeOrder(s, { tableId: "10", lines: [line("i-hummus")] }, WAITER);
  s = D(must(a));
  const b = E.placeOrder(s, { tableId: "11", lines: [line("i-fattoush")] }, WAITER);
  s = D(must(b));
  assert.equal(E.moveTab(s, a.order.tabId, "11", WAITER).ok, false); // occupied
  s = D(must(E.moveTab(s, a.order.tabId, "12", WAITER)));
  assert.equal(s.orders.find((o) => o.id === a.order.id).tableLabel, "Table 12");
  s = D(must(E.mergeTabs(s, a.order.tabId, b.order.tabId, WAITER)));
  const merged = s.tabs.find((t) => t.id === b.order.tabId);
  assert.equal(billOf(merged, s.orders).subtotal, 600 + 800);
  assert.equal(s.tabs.find((t) => t.id === a.order.tabId).status, "void");
});

test("service requests: dedupe, bill needs an open tab, paying resolves bill request", () => {
  let s = fresh();
  assert.equal(E.requestService(s, { tableId: "12", type: "bill" }).ok, false);
  const r1 = E.requestService(s, { tableId: "12", type: "waiter" });
  s = D(must(r1));
  const r2 = E.requestService(s, { tableId: "12", type: "waiter" });
  assert.equal(r2.request.id, r1.request.id);
  assert.equal(s.requests.filter((r) => r.tableId === "12").length, 1);
  s = D(must(E.updateSettings(s, { customerRequests: false })));
  assert.equal(E.requestService(s, { tableId: "12", type: "waiter" }).ok, false); // customers blocked when off
  assert.equal(E.requestService(s, { tableId: "3", type: "waiter" }).ok, false);
  assert.equal(E.requestService(s, { tableId: "3", type: "waiter" }, WAITER).ok, true);
  // seeded table 7 has bill requested; pay it off
  const tab = s.tabs.find((t) => t.tableId === "7" && t.status === "bill");
  const bill = billOf(tab, s.orders);
  s = D(must(E.addPayment(s, tab.id, { method: "card", amount: bill.due }, WAITER)));
  assert.equal(s.requests.find((r) => r.tableId === "7").status, "done");
});

test("table status for the waiter map", () => {
  const s = fresh();
  const st = (id) => tableStatus(s.tables.find((t) => t.id === id), s.tabs, s.orders, s.requests).key;
  assert.equal(st("1"), "free");
  assert.equal(st("7"), "ready"); // ready order beats bill state
  assert.equal(st("2"), "call");
  assert.equal(st("4"), "busy");
});

test("inventory: restock, waste, no negative, delete rules, recipe validation", () => {
  let s = fresh();
  assert.equal(E.adjustStock(s, { ingredientId: "g-lamb", delta: 10, reason: "restock" }, WAITER).ok, false);
  s = D(must(E.adjustStock(s, { ingredientId: "g-lamb", delta: 10, reason: "restock", note: "delivery" }, MANAGER)));
  assert.equal(s.items.find((i) => i.id === "i-lamb").soldOut, false);
  assert.equal(E.adjustStock(s, { ingredientId: "g-lamb", delta: -100, reason: "waste" }, MANAGER).ok, false);
  assert.equal(E.adjustStock(s, { ingredientId: "g-lamb", delta: 5, reason: "waste" }, MANAGER).ok, false);
  assert.equal(E.deleteIngredient(s, "g-lamb", MANAGER).ok, false); // used by a recipe
  s = D(must(E.upsertIngredient(s, { name: "Sumac", unit: "kg", onHand: 2, lowAt: 0.5 }, MANAGER)));
  assert.equal(E.upsertIngredient(s, { name: "sumac", unit: "kg", onHand: 1, lowAt: 0 }, MANAGER).ok, false);
  const item = s.items.find((i) => i.id === "i-fattoush");
  const bad = E.upsertItem(s, { ...item, recipe: [{ ingredientId: "nope", qty: 1 }] });
  assert.equal(bad.ok, false);
  const good = E.upsertItem(s, { ...item, recipe: [{ ingredientId: s.ingredients.at(-1).id, qty: 0.01 }] });
  assert.equal(good.ok, true);
});
