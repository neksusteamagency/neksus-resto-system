// Data layer for Neksus Dine.
//
// Phase 1 keeps everything in the browser (localStorage) and syncs between open tabs
// and windows, so the customer menu, kitchen screen and admin panel update live on one
// device. All reads/writes go through this file, so swapping in Firebase (phase 2) means
// replacing the internals here without touching any page.

import { useSyncExternalStore } from "react";
import { seed, STATE_VERSION } from "./seed";
import { resolveLines, totals } from "./pricing";
import { slug, uid, sum } from "./format";

const KEY = "neksus-dine:data";
const MAX_ORDERS = 500;
const FLOW = ["new", "preparing", "ready", "served"];

const valid = (s) =>
  s && s.version === STATE_VERSION && Array.isArray(s.items) && Array.isArray(s.orders) &&
  Array.isArray(s.categories) && Array.isArray(s.tables) && s.settings;

function load() {
  try {
    const raw = localStorage.getItem(KEY);
    if (raw) {
      const parsed = JSON.parse(raw);
      if (valid(parsed)) return parsed;
    }
  } catch { /* storage unavailable or corrupted: fall back to seed data */ }
  return seed();
}

let state = load();
const listeners = new Set();
const emit = () => listeners.forEach((l) => l());

function commit(next) {
  state = next;
  try { localStorage.setItem(KEY, JSON.stringify(state)); } catch { /* ignore quota errors */ }
  emit();
}

// Keep tabs/windows in sync.
if (typeof window !== "undefined") {
  window.addEventListener("storage", (e) => {
    if (e.key !== KEY) return;
    if (e.newValue === null) { state = seed(); emit(); return; }
    try {
      const parsed = JSON.parse(e.newValue);
      if (valid(parsed)) { state = parsed; emit(); }
    } catch { /* ignore */ }
  });
}

const subscribe = (l) => { listeners.add(l); return () => listeners.delete(l); };
const getState = () => state;
export const useStore = () => useSyncExternalStore(subscribe, getState);

const ok = (extra = {}) => ({ ok: true, ...extra });
const fail = (error) => ({ ok: false, error });

export const store = {
  getState,

  // ---------- Orders ----------
  placeOrder({ tableId, lines, note = "" }) {
    const s = state;
    if (!s.settings.orderingOpen) return fail("Ordering is paused right now. Please ask a member of staff.");
    const table = s.tables.find((t) => t.id === tableId);
    if (!table) return fail("This table is not recognised. Please scan the QR code again.");
    const { lines: priced, problems } = resolveLines(s.items, lines || []);
    if (!priced.length) return fail("Your order is empty.");
    if (problems.length) return fail(`${problems[0].name} is sold out. Please remove it to continue.`);
    const t = totals(sum(priced, (l) => l.total), s.settings);
    const number = s.counter + 1;
    const order = {
      id: uid("o"),
      number,
      tableId: table.id,
      tableLabel: table.label,
      items: priced.map(({ available, key, itemId, ...rest }) => rest),
      note: String(note).trim().slice(0, 200),
      ...t,
      status: "new",
      createdAt: Date.now(),
      startedAt: null,
      readyAt: null,
      servedAt: null,
      cancelledAt: null,
    };
    const orders = [...s.orders, order].slice(-MAX_ORDERS);
    commit({ ...s, counter: number, orders });
    return ok({ order });
  },

  // Moves an order forward one step, or cancels it. `force` is used by Undo.
  // Returns { ok, previous } so callers can offer an undo.
  setOrderStatus(id, status, { force = false } = {}) {
    const s = state;
    const cur = s.orders.find((o) => o.id === id);
    if (!cur) return fail("Order not found.");
    const from = cur.status;
    if (!force) {
      if (status === "cancelled") {
        if (!["new", "preparing", "ready"].includes(from)) return fail("This order can no longer be cancelled.");
      } else if (FLOW.indexOf(status) !== FLOW.indexOf(from) + 1) {
        return fail("This order has already been updated.");
      }
    }
    const now = Date.now();
    const idx = FLOW.indexOf(status);
    const next = { ...cur, status };
    if (status === "cancelled") {
      next.cancelledAt = now;
    } else {
      next.cancelledAt = null;
      next.startedAt = idx >= 1 ? cur.startedAt || now : null;
      if (idx >= 2) next.readyAt = cur.readyAt || now; else next.readyAt = null;
      if (idx >= 3) next.servedAt = cur.servedAt || now; else next.servedAt = null;
    }
    commit({ ...s, orders: s.orders.map((o) => (o.id === id ? next : o)) });
    return ok({ previous: from });
  },

  // ---------- Menu ----------
  upsertCategory({ id, name }) {
    const s = state;
    const n = String(name || "").trim();
    if (!n) return fail("Enter a category name.");
    if (s.categories.some((c) => c.id !== id && c.name.toLowerCase() === n.toLowerCase())) {
      return fail("A category with this name already exists.");
    }
    if (id) {
      commit({ ...s, categories: s.categories.map((c) => (c.id === id ? { ...c, name: n } : c)) });
    } else {
      const order = Math.max(0, ...s.categories.map((c) => c.order)) + 1;
      commit({ ...s, categories: [...s.categories, { id: uid("c"), name: n, order }] });
    }
    return ok();
  },

  deleteCategory(id) {
    const s = state;
    if (s.items.some((i) => i.categoryId === id)) {
      return fail("Move or delete the dishes in this category first.");
    }
    commit({ ...s, categories: s.categories.filter((c) => c.id !== id) });
    return ok();
  },

  moveCategory(id, dir) {
    const s = state;
    const sorted = [...s.categories].sort((a, b) => a.order - b.order);
    const i = sorted.findIndex((c) => c.id === id);
    const j = i + dir;
    if (i < 0 || j < 0 || j >= sorted.length) return ok();
    [sorted[i], sorted[j]] = [sorted[j], sorted[i]];
    commit({ ...s, categories: sorted.map((c, idx) => ({ ...c, order: idx + 1 })) });
    return ok();
  },

  upsertItem(data) {
    const s = state;
    const name = String(data.name || "").trim();
    if (!name) return fail("Enter a dish name.");
    if (!Number.isInteger(data.price) || data.price < 0) return fail("Enter a valid price.");
    if (!s.categories.some((c) => c.id === data.categoryId)) return fail("Choose a category.");
    const extras = (data.extras || [])
      .map((e) => ({ name: String(e.name || "").trim(), price: e.price }))
      .filter((e) => e.name);
    if (extras.some((e) => !Number.isInteger(e.price) || e.price < 0)) return fail("Check the extra prices.");
    if (new Set(extras.map((e) => e.name.toLowerCase())).size !== extras.length) return fail("Extras must have different names.");
    const item = {
      id: data.id || uid("i"),
      name,
      description: String(data.description || "").trim(),
      price: data.price,
      categoryId: data.categoryId,
      station: data.station,
      popular: !!data.popular,
      available: data.available !== false,
      extras,
    };
    const exists = s.items.some((i) => i.id === item.id);
    commit({ ...s, items: exists ? s.items.map((i) => (i.id === item.id ? item : i)) : [...s.items, item] });
    return ok({ item });
  },

  deleteItem(id) {
    commit({ ...state, items: state.items.filter((i) => i.id !== id) });
    return ok();
  },

  setItemAvailable(id, available) {
    commit({ ...state, items: state.items.map((i) => (i.id === id ? { ...i, available } : i)) });
    return ok();
  },

  // ---------- Tables ----------
  addTable(label) {
    const s = state;
    const l = String(label || "").trim().slice(0, 30);
    if (!l) return fail("Enter a table name.");
    if (s.tables.some((t) => t.label.toLowerCase() === l.toLowerCase())) return fail("A table with this name already exists.");
    let id = slug(l);
    while (s.tables.some((t) => t.id === id)) id = `${slug(l)}-${Math.random().toString(36).slice(2, 5)}`;
    commit({ ...s, tables: [...s.tables, { id, label: l }] });
    return ok();
  },

  deleteTable(id) {
    const s = state;
    if (id === "takeaway") return fail("The takeaway code can't be removed.");
    if (s.orders.some((o) => o.tableId === id && ["new", "preparing", "ready"].includes(o.status))) {
      return fail("This table has an active order.");
    }
    commit({ ...s, tables: s.tables.filter((t) => t.id !== id) });
    return ok();
  },

  // ---------- Settings ----------
  updateSettings(patch) {
    commit({ ...state, settings: { ...state.settings, ...patch } });
    return ok();
  },

  resetDemo() {
    commit(seed());
    return ok();
  },
};
