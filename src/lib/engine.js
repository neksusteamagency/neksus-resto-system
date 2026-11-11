// Business logic for Neksus Dine as pure functions: (state, input, actor) -> result.
// The local (browser) backend runs these directly. The Supabase SQL functions in
// supabase/migrations implement the same rules on the server, so keep them in step.

import { resolveLines, totals } from "./pricing.js";
import { billOf, discountPercent, OPEN_TAB } from "./billing.js";
import { uid, slug, sum } from "./format.js";

const MAX_ORDERS = 500;
const MAX_MOVES = 1000;
const MAX_AUDIT = 500;
const FLOW = ["new", "preparing", "ready", "served"];

export const GUEST = { name: "Guest", role: "customer" };
const isManager = (a) => a.role === "owner" || a.role === "manager";
const isWaiterUp = (a) => isManager(a) || a.role === "waiter";
const isStaff = (a) => isWaiterUp(a) || a.role === "kitchen";

const ok = (state, extra = {}) => ({ ok: true, state, ...extra });
const fail = (error) => ({ ok: false, error });

const round3 = (n) => Math.round(n * 1000) / 1000;

export function stockShort(item, ingredients) {
  return (item.recipe || []).some((r) => {
    const ing = ingredients.find((i) => i.id === r.ingredientId);
    return ing && ing.onHand < r.qty;
  });
}

// Adds the computed `stockOut` / `soldOut` flags that the menus use.
export function derive(s) {
  const items = s.items.map((i) => {
    const stockOut = s.remoteStock ? !!i.stockOut : stockShort(i, s.ingredients);
    const soldOut = !i.available || (s.settings.blockOutOfStock && stockOut);
    return { ...i, stockOut, soldOut };
  });
  return { ...s, items };
}

function log(s, actor, action, detail) {
  return [...s.audit, { id: uid("a"), at: Date.now(), by: actor.name, action, detail }].slice(-MAX_AUDIT);
}

function move(ingredientId, delta, reason, note, by, at, orderId = null) {
  return { id: uid("m"), ingredientId, delta: round3(delta), reason, note, orderId, by, at };
}

// Apply stock changes: changes is [{ingredientId, delta}]. Returns new ingredients and moves.
function applyStock(s, changes, reason, note, by, at, orderId) {
  const ingredients = s.ingredients.map((i) => ({ ...i }));
  const moves = [];
  for (const c of changes) {
    const ing = ingredients.find((i) => i.id === c.ingredientId);
    if (!ing || !c.delta) continue;
    ing.onHand = round3(ing.onHand + c.delta);
    moves.push(move(ing.id, c.delta, reason, note, by, at, orderId));
  }
  return { ingredients, stockMoves: [...s.stockMoves, ...moves].slice(-MAX_MOVES) };
}

function usageOf(items, lines) {
  const usage = new Map();
  for (const l of lines) {
    const item = items.find((i) => i.id === l.itemId);
    for (const r of item?.recipe || []) usage.set(r.ingredientId, round3((usage.get(r.ingredientId) || 0) + r.qty * l.qty));
  }
  return usage;
}

const lineUsage = (s, line) => {
  const item = s.items.find((i) => i.id === line.itemId);
  return (item?.recipe || []).map((r) => ({ ingredientId: r.ingredientId, delta: round3(r.qty * line.qty) }));
};

function recalcOrder(o, tab) {
  const subtotal = sum(o.items.filter((l) => !l.voided), (l) => l.total);
  return { ...o, ...totals(subtotal, tab) };
}

function voidEmptyTakeaway(s, tabId, now) {
  const tab = s.tabs.find((t) => t.id === tabId);
  if (!tab || tab.tableId !== "takeaway" || !OPEN_TAB.includes(tab.status) || tab.payments.length) return s;
  if (billOf(tab, s.orders).total > 0) return s;
  return { ...s, tabs: s.tabs.map((t) => (t.id === tabId ? { ...t, status: "void", closedAt: now } : t)) };
}

/* ---------------- Orders ---------------- */

export function placeOrder(s, { tableId, lines, note = "" }, actor = GUEST, now = Date.now()) {
  const staff = isWaiterUp(actor);
  if (!staff && !s.settings.orderingOpen) return fail("Ordering is paused right now. Please ask a member of staff.");
  const table = s.tables.find((t) => t.id === tableId);
  if (!table) return fail("This table is not recognised. Please scan the QR code again.");
  const { lines: priced, problems } = resolveLines(s.items, lines || []);
  if (!priced.length) return fail("Your order is empty.");
  if (problems.length) return fail(`${problems[0].name} is sold out. Please remove it to continue.`);

  const usage = usageOf(s.items, priced);
  if (s.settings.blockOutOfStock) {
    for (const [ingredientId, need] of usage) {
      const ing = s.ingredients.find((i) => i.id === ingredientId);
      if (ing && ing.onHand < need) return fail(`Not enough ${ing.name} in stock for this order.`);
    }
  }

  let tab = table.id === "takeaway" ? null : s.tabs.find((t) => t.tableId === table.id && OPEN_TAB.includes(t.status));
  let tabs = s.tabs;
  let tabCounter = s.tabCounter;
  if (!tab) {
    tabCounter += 1;
    tab = {
      id: uid("t"), number: tabCounter, tableId: table.id, tableLabel: table.label, status: "open",
      openedAt: now, closedAt: null, waiter: staff ? actor.name : null,
      taxRate: s.settings.taxRate, serviceRate: s.settings.serviceRate, discount: null, payments: [],
    };
    tabs = [...tabs, tab];
  } else if (tab.status === "bill" || (!tab.waiter && staff)) {
    tab = { ...tab, status: "open", waiter: tab.waiter || (staff ? actor.name : null) };
    tabs = tabs.map((t) => (t.id === tab.id ? tab : t));
  }

  const number = s.counter + 1;
  const t = totals(sum(priced, (l) => l.total), tab);
  const order = {
    id: uid("o"), number, tabId: tab.id, tableId: table.id, tableLabel: table.label,
    source: staff ? "waiter" : "customer", placedBy: staff ? actor.name : null,
    items: priced.map(({ available, key, itemId, ...rest }) => ({ ...rest, itemId, voided: null })),
    note: String(note).trim().slice(0, 200), ...t,
    status: "new", createdAt: now, startedAt: null, readyAt: null, servedAt: null, cancelledAt: null, restocked: false,
  };
  const stock = applyStock(s, [...usage].map(([ingredientId, delta]) => ({ ingredientId, delta: -delta })), "sale", `Order #${number}`, actor.name, now, order.id);
  const next = {
    ...s, ...stock, tabs, counter: number, tabCounter,
    orders: [...s.orders, order].slice(-MAX_ORDERS),
    requests: s.requests,
    audit: log(s, actor, "order.place", `#${number} · ${table.label}`),
  };
  return ok(next, { order });
}

export function setOrderStatus(s, id, status, { force = false } = {}, actor = GUEST, now = Date.now()) {
  const cur = s.orders.find((o) => o.id === id);
  if (!cur) return fail("Order not found.");
  const from = cur.status;
  if (!force) {
    if (!isStaff(actor)) return fail("Not allowed.");
    if (status === "cancelled") {
      if (!["new", "preparing", "ready"].includes(from)) return fail("This order can no longer be cancelled.");
    } else if (FLOW.indexOf(status) !== FLOW.indexOf(from) + 1) {
      return fail("This order has already been updated.");
    }
  }
  const idx = FLOW.indexOf(status);
  let next = { ...cur, status };
  let base = s;
  if (status === "cancelled") {
    next.cancelledAt = now;
    // Food that hasn't been started goes back into stock; started food is wasted.
    if (from === "new" && !cur.restocked) {
      const changes = cur.items.filter((l) => !l.voided).flatMap((l) => lineUsage(s, l));
      base = { ...s, ...applyStock(s, changes, "return", `Cancelled #${cur.number}`, actor.name, now, cur.id) };
      next.restocked = true;
    }
  } else {
    if (from === "cancelled" && cur.restocked) {
      const changes = cur.items.filter((l) => !l.voided).flatMap((l) => lineUsage(s, l)).map((c) => ({ ...c, delta: -c.delta }));
      base = { ...s, ...applyStock(s, changes, "sale", `Restored #${cur.number}`, actor.name, now, cur.id) };
      next.restocked = false;
    }
    next.cancelledAt = null;
    next.startedAt = idx >= 1 ? cur.startedAt || now : null;
    next.readyAt = idx >= 2 ? cur.readyAt || now : null;
    next.servedAt = idx >= 3 ? cur.servedAt || now : null;
  }
  let out = { ...base, orders: s.orders.map((o) => (o.id === id ? next : o)) };
  if (status === "cancelled") {
    out.audit = log(out, actor, "order.cancel", `#${cur.number} · ${cur.tableLabel}`);
    out = voidEmptyTakeaway(out, cur.tabId, now);
  }
  return ok(out, { previous: from });
}

export function voidLine(s, orderId, idx, reason, actor = GUEST, now = Date.now()) {
  const r = String(reason || "").trim();
  if (r.length < 3) return fail("Enter a reason for removing this item.");
  if (!(isManager(actor) || (actor.role === "waiter" && s.settings.waiterCanVoid))) return fail("You are not allowed to remove items. Ask a manager.");
  const order = s.orders.find((o) => o.id === orderId);
  if (!order || order.status === "cancelled") return fail("Order not found.");
  const tab = s.tabs.find((t) => t.id === order.tabId);
  if (!tab || !OPEN_TAB.includes(tab.status)) return fail("This bill is already closed.");
  const line = order.items[idx];
  if (!line || line.voided) return fail("This item was already removed.");
  const items = order.items.map((l, i) => (i === idx ? { ...l, voided: { reason: r.slice(0, 120), by: actor.name, at: now } } : l));
  let base = s;
  let restocked = order.restocked;
  if (order.status === "new" && !order.restocked) {
    base = { ...s, ...applyStock(s, lineUsage(s, line), "return", `Removed from #${order.number}`, actor.name, now, order.id) };
  }
  const updated = recalcOrder({ ...order, items, restocked }, tab);
  let out = { ...base, orders: s.orders.map((o) => (o.id === orderId ? updated : o)) };
  out.audit = log(out, actor, "line.void", `#${order.number} · ${line.qty}× ${line.name} · ${r}`);
  out = voidEmptyTakeaway(out, tab.id, now);
  return ok(out);
}

/* ---------------- Tabs and payments ---------------- */

function openTab(s, tabId) {
  const tab = s.tabs.find((t) => t.id === tabId);
  return tab && OPEN_TAB.includes(tab.status) ? tab : null;
}

export function setDiscount(s, tabId, discount, actor = GUEST) {
  if (!isWaiterUp(actor)) return fail("Not allowed.");
  const tab = openTab(s, tabId);
  if (!tab) return fail("This bill is already closed.");
  const bill = billOf(tab, s.orders);
  const limit = Number(s.settings.waiterMaxDiscount) || 0;
  const tooBig = (pct) => actor.role === "waiter" && pct > limit;
  if (!discount) {
    if (tooBig(discountPercent(tab, bill.subtotal))) return fail("Only a manager can remove this discount.");
    return ok({ ...s, tabs: s.tabs.map((t) => (t.id === tabId ? { ...t, discount: null } : t)), audit: log(s, actor, "discount.clear", tab.tableLabel) });
  }
  const type = discount.type;
  const value = Number(discount.value);
  const reason = String(discount.reason || "").trim();
  if (type !== "percent" && type !== "amount") return fail("Choose a discount type.");
  if (!Number.isFinite(value) || value <= 0) return fail("Enter a discount greater than zero.");
  if (type === "percent" && value > 100) return fail("A percentage can't be more than 100.");
  if (type === "amount" && !Number.isInteger(value)) return fail("Enter a valid amount.");
  if (bill.subtotal <= 0) return fail("There is nothing to discount yet.");
  if (type === "amount" && value > bill.subtotal) return fail("The discount can't be more than the bill.");
  if (reason.length < 3) return fail("Enter a reason for the discount.");
  const pct = type === "percent" ? value : (value / bill.subtotal) * 100;
  if (tooBig(pct)) return fail(`Discounts above ${limit}% need a manager.`);
  const d = { type, value, reason: reason.slice(0, 120), by: actor.name };
  return ok({
    ...s, tabs: s.tabs.map((t) => (t.id === tabId ? { ...t, discount: d } : t)),
    audit: log(s, actor, "discount.set", `${tab.tableLabel} · ${type === "percent" ? `${value}%` : value} · ${reason}`),
  });
}

export function addPayment(s, tabId, { method, amount }, actor = GUEST, now = Date.now()) {
  if (!isWaiterUp(actor)) return fail("Not allowed.");
  const tab = openTab(s, tabId);
  if (!tab) return fail("This bill is already closed.");
  if (!["cash", "card", "other"].includes(method)) return fail("Choose a payment method.");
  if (!Number.isInteger(amount) || amount <= 0) return fail("Enter a valid amount.");
  const bill = billOf(tab, s.orders);
  if (bill.total <= 0) return fail("There is nothing to pay on this bill.");
  if (amount > bill.due) return fail("That is more than the balance due.");
  const payment = { id: uid("p"), method, amount, at: now, by: actor.name };
  const paidUp = bill.paid + amount >= bill.total;
  const nextTab = { ...tab, payments: [...tab.payments, payment], ...(paidUp ? { status: "paid", closedAt: now } : {}) };
  const requests = paidUp
    ? s.requests.map((r) => (r.tableId === tab.tableId && r.status === "open" && r.type === "bill" ? { ...r, status: "done", doneAt: now, doneBy: actor.name } : r))
    : s.requests;
  return ok({
    ...s, tabs: s.tabs.map((t) => (t.id === tabId ? nextTab : t)), requests,
    audit: log(s, actor, "payment", `${tab.tableLabel} · ${method} · ${amount}`),
  }, { closed: paidUp });
}

export function closeTab(s, tabId, actor = GUEST, now = Date.now()) {
  if (!isWaiterUp(actor)) return fail("Not allowed.");
  const tab = openTab(s, tabId);
  if (!tab) return fail("This bill is already closed.");
  if (billOf(tab, s.orders).total > 0) return fail("Take payment before closing this bill.");
  return ok({
    ...s, tabs: s.tabs.map((t) => (t.id === tabId ? { ...t, status: "void", closedAt: now } : t)),
    audit: log(s, actor, "tab.close", tab.tableLabel),
  });
}

export function moveTab(s, tabId, toTableId, actor = GUEST) {
  if (!isWaiterUp(actor)) return fail("Not allowed.");
  const tab = openTab(s, tabId);
  if (!tab) return fail("This bill is already closed.");
  const to = s.tables.find((t) => t.id === toTableId);
  if (!to || to.id === "takeaway") return fail("Choose a table.");
  if (s.tabs.some((t) => t.tableId === to.id && OPEN_TAB.includes(t.status))) return fail(`${to.label} already has an open bill. Use merge instead.`);
  return ok({
    ...s,
    tabs: s.tabs.map((t) => (t.id === tabId ? { ...t, tableId: to.id, tableLabel: to.label } : t)),
    orders: s.orders.map((o) => (o.tabId === tabId ? { ...o, tableId: to.id, tableLabel: to.label } : o)),
    audit: log(s, actor, "tab.move", `${tab.tableLabel} → ${to.label}`),
  });
}

export function mergeTabs(s, fromId, intoId, actor = GUEST, now = Date.now()) {
  if (!isWaiterUp(actor)) return fail("Not allowed.");
  const from = openTab(s, fromId);
  const into = openTab(s, intoId);
  if (!from || !into || from.id === into.id) return fail("Choose two open bills.");
  if (from.payments.length) return fail("A bill with payments can't be merged.");
  return ok({
    ...s,
    tabs: s.tabs.map((t) => (t.id === fromId ? { ...t, status: "void", closedAt: now } : t)),
    orders: s.orders.map((o) => (o.tabId === fromId ? { ...o, tabId: into.id, tableId: into.tableId, tableLabel: into.tableLabel } : o)),
    audit: log(s, actor, "tab.merge", `${from.tableLabel} → ${into.tableLabel}`),
  });
}

/* ---------------- Service requests ---------------- */

export function requestService(s, { tableId, type }, actor = GUEST, now = Date.now()) {
  const table = s.tables.find((t) => t.id === tableId);
  if (!table || table.id === "takeaway") return fail("This table is not recognised.");
  if (!["waiter", "bill"].includes(type)) return fail("Unknown request.");
  if (!isWaiterUp(actor) && !s.settings.customerRequests) return fail("Please ask a member of staff.");
  const existing = s.requests.find((r) => r.tableId === tableId && r.type === type && r.status === "open");
  if (existing) return ok(s, { request: existing });
  let tabs = s.tabs;
  if (type === "bill") {
    const tab = s.tabs.find((t) => t.tableId === tableId && OPEN_TAB.includes(t.status));
    if (!tab) return fail("There is no open order for this table yet.");
    tabs = s.tabs.map((t) => (t.id === tab.id ? { ...t, status: "bill" } : t));
  }
  const request = { id: uid("r"), tableId, tableLabel: table.label, type, status: "open", createdAt: now, doneAt: null, doneBy: null };
  return ok({ ...s, tabs, requests: [...s.requests, request].slice(-200) }, { request });
}

export function resolveRequest(s, id, actor = GUEST, now = Date.now()) {
  if (!isWaiterUp(actor)) return fail("Not allowed.");
  if (!s.requests.some((r) => r.id === id)) return fail("Request not found.");
  return ok({ ...s, requests: s.requests.map((r) => (r.id === id ? { ...r, status: "done", doneAt: now, doneBy: actor.name } : r)) });
}

/* ---------------- Inventory ---------------- */

export function upsertIngredient(s, data, actor = GUEST, now = Date.now()) {
  if (!isManager(actor)) return fail("Not allowed.");
  const name = String(data.name || "").trim();
  if (!name) return fail("Enter an ingredient name.");
  if (s.ingredients.some((i) => i.id !== data.id && i.name.toLowerCase() === name.toLowerCase())) return fail("An ingredient with this name already exists.");
  const lowAt = Number(data.lowAt);
  if (!Number.isFinite(lowAt) || lowAt < 0) return fail("Enter a valid low-stock level.");
  if (!data.unit) return fail("Choose a unit.");
  if (data.id) {
    return ok({ ...s, ingredients: s.ingredients.map((i) => (i.id === data.id ? { ...i, name, unit: data.unit, lowAt } : i)) });
  }
  const onHand = Number(data.onHand || 0);
  if (!Number.isFinite(onHand) || onHand < 0) return fail("Enter a valid opening stock.");
  const ing = { id: uid("g"), name, unit: data.unit, onHand: round3(onHand), lowAt };
  const moves = onHand > 0 ? [move(ing.id, onHand, "restock", "Opening stock", actor.name, now)] : [];
  return ok({ ...s, ingredients: [...s.ingredients, ing], stockMoves: [...s.stockMoves, ...moves] }, { ingredient: ing });
}

export function deleteIngredient(s, id, actor = GUEST) {
  if (!isManager(actor)) return fail("Not allowed.");
  if (s.items.some((i) => (i.recipe || []).some((r) => r.ingredientId === id))) return fail("This ingredient is used in a recipe. Remove it from the dishes first.");
  return ok({ ...s, ingredients: s.ingredients.filter((i) => i.id !== id), stockMoves: s.stockMoves.filter((m) => m.ingredientId !== id) });
}

export function adjustStock(s, { ingredientId, delta, reason, note = "" }, actor = GUEST, now = Date.now()) {
  if (!isManager(actor)) return fail("Not allowed.");
  const ing = s.ingredients.find((i) => i.id === ingredientId);
  if (!ing) return fail("Ingredient not found.");
  const d = Number(delta);
  if (!["restock", "waste", "adjust"].includes(reason)) return fail("Choose a reason.");
  if (!Number.isFinite(d) || d === 0) return fail("Enter a quantity.");
  if (reason === "restock" && d < 0) return fail("A delivery must be a positive quantity.");
  if (reason === "waste" && d > 0) return fail("Waste must be a negative quantity.");
  if (round3(ing.onHand + d) < 0) return fail("Stock can't go below zero.");
  const stock = applyStock(s, [{ ingredientId, delta: d }], reason, String(note).trim().slice(0, 120), actor.name, now);
  return ok({ ...s, ...stock, audit: log(s, actor, "stock." + reason, `${ing.name} ${d > 0 ? "+" : ""}${round3(d)} ${ing.unit}`) });
}

/* ---------------- Menu, tables, settings ---------------- */

export function upsertCategory(s, { id, name }) {
  const n = String(name || "").trim();
  if (!n) return fail("Enter a category name.");
  if (s.categories.some((c) => c.id !== id && c.name.toLowerCase() === n.toLowerCase())) return fail("A category with this name already exists.");
  if (id) return ok({ ...s, categories: s.categories.map((c) => (c.id === id ? { ...c, name: n } : c)) });
  const order = Math.max(0, ...s.categories.map((c) => c.order)) + 1;
  return ok({ ...s, categories: [...s.categories, { id: uid("c"), name: n, order }] });
}

export function deleteCategory(s, id) {
  if (s.items.some((i) => i.categoryId === id)) return fail("Move or delete the dishes in this category first.");
  return ok({ ...s, categories: s.categories.filter((c) => c.id !== id) });
}

export function moveCategory(s, id, dir) {
  const sorted = [...s.categories].sort((a, b) => a.order - b.order);
  const i = sorted.findIndex((c) => c.id === id);
  const j = i + dir;
  if (i < 0 || j < 0 || j >= sorted.length) return ok(s);
  [sorted[i], sorted[j]] = [sorted[j], sorted[i]];
  return ok({ ...s, categories: sorted.map((c, idx) => ({ ...c, order: idx + 1 })) });
}

export function upsertItem(s, data) {
  const name = String(data.name || "").trim();
  if (!name) return fail("Enter a dish name.");
  if (!Number.isInteger(data.price) || data.price < 0) return fail("Enter a valid price.");
  if (!s.categories.some((c) => c.id === data.categoryId)) return fail("Choose a category.");
  const extras = (data.extras || []).map((e) => ({ name: String(e.name || "").trim(), price: e.price })).filter((e) => e.name);
  if (extras.some((e) => !Number.isInteger(e.price) || e.price < 0)) return fail("Check the extra prices.");
  if (new Set(extras.map((e) => e.name.toLowerCase())).size !== extras.length) return fail("Extras must have different names.");
  const recipe = (data.recipe || []).map((r) => ({ ingredientId: r.ingredientId, qty: Number(r.qty) }));
  if (recipe.some((r) => !s.ingredients.some((i) => i.id === r.ingredientId))) return fail("Choose an ingredient for each recipe line.");
  if (recipe.some((r) => !Number.isFinite(r.qty) || r.qty <= 0)) return fail("Recipe quantities must be greater than zero.");
  if (new Set(recipe.map((r) => r.ingredientId)).size !== recipe.length) return fail("Each ingredient can only appear once in a recipe.");
  const item = {
    id: data.id || uid("i"), name, description: String(data.description || "").trim(), price: data.price,
    categoryId: data.categoryId, station: data.station, popular: !!data.popular, available: data.available !== false,
    extras, recipe: recipe.map((r) => ({ ...r, qty: round3(r.qty) })),
  };
  const exists = s.items.some((i) => i.id === item.id);
  return ok({ ...s, items: exists ? s.items.map((i) => (i.id === item.id ? item : i)) : [...s.items, item] }, { item });
}

export const deleteItem = (s, id) => ok({ ...s, items: s.items.filter((i) => i.id !== id) });
export const setItemAvailable = (s, id, available) => ok({ ...s, items: s.items.map((i) => (i.id === id ? { ...i, available } : i)) });

export function addTable(s, label) {
  const l = String(label || "").trim().slice(0, 30);
  if (!l) return fail("Enter a table name.");
  if (s.tables.some((t) => t.label.toLowerCase() === l.toLowerCase())) return fail("A table with this name already exists.");
  let id = slug(l);
  while (s.tables.some((t) => t.id === id)) id = `${slug(l)}-${Math.random().toString(36).slice(2, 5)}`;
  return ok({ ...s, tables: [...s.tables, { id, label: l }] });
}

export function deleteTable(s, id) {
  if (id === "takeaway") return fail("The takeaway code can't be removed.");
  if (s.tabs.some((t) => t.tableId === id && OPEN_TAB.includes(t.status))) return fail("This table has an open bill.");
  return ok({ ...s, tables: s.tables.filter((t) => t.id !== id) });
}

export const updateSettings = (s, patch) => ok({ ...s, settings: { ...s.settings, ...patch } });
