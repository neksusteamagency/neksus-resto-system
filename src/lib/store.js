// Data layer for Neksus Dine. Every page reads and writes through this file.
//
//  - Local demo mode (default): the business rules in engine.js run in the browser and the
//    data is kept in localStorage, synced live between open tabs.
//  - Supabase mode (.env.local has the Supabase URL and anon key): the same actions call the
//    SQL functions in supabase/migrations through remote.js, and staff screens update live
//    through Supabase Realtime.
//
// Every action is async and resolves to { ok: true, ... } or { ok: false, error }.

import { useEffect, useRef, useState, useSyncExternalStore } from "react";
import * as engine from "./engine.js";
import { seed, STATE_VERSION } from "./seed.js";
import { REMOTE } from "./config.js";
import { getActor, getAuth, subscribeAuth } from "./auth.js";
import * as remote from "./remote.js";

const KEY = "neksus-dine:data";

const valid = (s) =>
  s && s.version === STATE_VERSION && ["items", "orders", "categories", "tables", "tabs", "ingredients", "requests"].every((k) => Array.isArray(s[k])) && s.settings;

function load() {
  try {
    const raw = localStorage.getItem(KEY);
    if (raw) {
      const parsed = JSON.parse(raw);
      if (valid(parsed)) return parsed;
    }
  } catch { /* storage unavailable or corrupted: fall back to sample data */ }
  return seed();
}

const emptyRemote = () => ({
  version: STATE_VERSION, remoteStock: true, ready: false, staffReady: false,
  settings: { name: "", openText: "", currency: "$", taxRate: 0, serviceRate: 0, orderingOpen: true, customerRequests: true, blockOutOfStock: true, paperWidth: 80 },
  categories: [], items: [], ingredients: [], stockMoves: [], tables: [], tabs: [], orders: [], requests: [], audit: [], counter: 0, tabCounter: 0,
});

let state = REMOTE ? emptyRemote() : engine.derive({ ...load(), ready: true, staffReady: true });
const listeners = new Set();
const emit = () => listeners.forEach((l) => l());

function setState(next) {
  state = engine.derive(next);
  emit();
}

function commitLocal(next) {
  const { ready, staffReady, ...persisted } = next;
  try { localStorage.setItem(KEY, JSON.stringify(persisted)); } catch { /* ignore quota errors */ }
  setState({ ...next, ready: true, staffReady: true });
}

if (!REMOTE && typeof window !== "undefined") {
  window.addEventListener("storage", (e) => {
    if (e.key !== KEY) return;
    if (e.newValue === null) { setState({ ...seed(), ready: true, staffReady: true }); return; }
    try {
      const parsed = JSON.parse(e.newValue);
      if (valid(parsed)) setState({ ...parsed, ready: true, staffReady: true });
    } catch { /* ignore */ }
  });
}

const subscribe = (l) => { listeners.add(l); return () => listeners.delete(l); };
const getState = () => state;
export const useStore = () => useSyncExternalStore(subscribe, getState);

/* ---------- actions ---------- */

// Number of arguments each action takes; the engine receives the signed-in user after them.
const SIG = {
  placeOrder: 1, setOrderStatus: 3, voidLine: 3, setDiscount: 2, addPayment: 2, closeTab: 1, moveTab: 2, mergeTabs: 2,
  requestService: 1, resolveRequest: 1, upsertIngredient: 1, deleteIngredient: 1, adjustStock: 1,
  upsertCategory: 1, deleteCategory: 1, moveCategory: 2, upsertItem: 1, deleteItem: 1, setItemAvailable: 2,
  addTable: 1, deleteTable: 1, updateSettings: 1,
};

export const store = { getState };

for (const [name, n] of Object.entries(SIG)) {
  store[name] = async (...args) => {
    const a = Array.from({ length: n }, (_, i) => args[i]);
    if (REMOTE) return remote[name](...a);
    const res = engine[name](state, ...a, getActor());
    if (!res.ok) return res;
    const { state: next, ...rest } = res;
    commitLocal(next);
    return { ok: true, ...rest };
  };
}

store.resetDemo = async () => {
  if (REMOTE) return { ok: false, error: "Sample data can only be restored in local demo mode." };
  commitLocal(seed());
  return { ok: true };
};

// Supabase customers load the menu for their table. No-op in local mode.
store.loadMenu = (tableId) => (REMOTE ? remote.loadMenu(tableId) : Promise.resolve());

/* ---------- a customer's own orders ---------- */
export function useMyOrders(ids) {
  const s = useStore();
  const [remoteOrders, setRemoteOrders] = useState([]);
  const key = ids.join(",");
  const idsRef = useRef(ids);
  idsRef.current = ids;
  useEffect(() => {
    if (!REMOTE || !idsRef.current.length) { setRemoteOrders([]); return undefined; }
    let live = true;
    const run = async () => {
      const list = await remote.getOrdersByIds(idsRef.current);
      if (live && list) setRemoteOrders(list);
    };
    run();
    const t = setInterval(run, 4000);
    return () => { live = false; clearInterval(t); };
  }, [key]);
  if (REMOTE) return ids.map((id) => remoteOrders.find((o) => o.id === id)).filter(Boolean);
  return ids.map((id) => s.orders.find((o) => o.id === id)).filter(Boolean);
}

/* ---------- Supabase wiring ---------- */
if (REMOTE) {
  remote.init({ getState, setState });
  let current = null;
  const sync = () => {
    const u = getAuth().user;
    if (u && current !== u.id) { current = u.id; remote.startStaff(); }
    else if (!u && current) { current = null; remote.stopStaff(); }
  };
  subscribeAuth(sync);
  sync();
}
