// Supabase adapter: every store action calls a SQL function from supabase/migrations/0002_functions.sql.
// Staff screens load one snapshot of the restaurant and refresh it whenever Supabase Realtime reports
// a change. Customers load only the menu and follow their own orders by id.
import { supabase } from "./supabaseClient.js";
import { REMOTE } from "./config.js";

let api = null;
let staffActive = false;
let channel = null;
let timers = [];
let refreshTimer = null;
let seq = 0;
let menuTimer = null;
let menuTable = null;

export function init(hooks) { api = hooks; }

const friendly = (error) => {
  const m = String(error?.message || "");
  if (/failed to fetch|networkerror|load failed/i.test(m)) return "Can't reach the server. Check your connection and try again.";
  if (/permission denied|not authorized|jwt/i.test(m)) return "You don't have access to do that. Try signing in again.";
  return "Something went wrong. Please try again.";
};

async function call(fn, args) {
  try {
    const { data, error } = await supabase.rpc(fn, args);
    if (error) return { ok: false, error: friendly(error) };
    return data && typeof data === "object" ? data : { ok: false, error: "No response from the server." };
  } catch (e) {
    return { ok: false, error: friendly(e) };
  }
}

// Run a change; staff screens refresh straight away instead of waiting for Realtime.
async function mutate(fn, args) {
  const res = await call(fn, args);
  if (res.ok && staffActive) scheduleRefresh(0);
  return res;
}

/* ---------- loading ---------- */
async function refresh() {
  const mine = ++seq;
  const res = await call("staff_snapshot");
  if (!res.ok || mine !== seq || !staffActive) return false;
  api.setState({ ...res.state, version: api.getState().version, remoteStock: true, ready: true, staffReady: true, counter: 0, tabCounter: 0 });
  return true;
}

function scheduleRefresh(ms = 250) {
  clearTimeout(refreshTimer);
  refreshTimer = setTimeout(refresh, ms);
}

export async function startStaff() {
  if (staffActive) return;
  staffActive = true;
  clearInterval(menuTimer);
  await refresh();
  channel = supabase
    .channel("neksus-dine")
    .on("postgres_changes", { event: "*", schema: "public" }, () => scheduleRefresh(250))
    .subscribe();
  // Safety net in case the realtime connection drops.
  timers.push(setInterval(refresh, 20000));
  const onVisible = () => { if (document.visibilityState === "visible") refresh(); };
  document.addEventListener("visibilitychange", onVisible);
  window.addEventListener("online", refresh);
  timers.push({ stop: () => { document.removeEventListener("visibilitychange", onVisible); window.removeEventListener("online", refresh); } });
}

export function stopStaff() {
  staffActive = false;
  seq += 1;
  clearTimeout(refreshTimer);
  timers.forEach((t) => (t.stop ? t.stop() : clearInterval(t)));
  timers = [];
  if (channel) { supabase.removeChannel(channel); channel = null; }
  api.setState({ ...api.getState(), staffReady: false, tabs: [], orders: [], requests: [], ingredients: [], stockMoves: [], audit: [] });
}

async function fetchMenu(tableId) {
  const res = await call("get_public_menu", { p_table: tableId });
  if (!res.ok) throw new Error(res.error);
  if (staffActive) return; // staff already have the full picture
  api.setState({ ...api.getState(), ...res.state, remoteStock: true, ready: true });
}

// Customers: load the menu for their table and keep it fresh (sold-out dishes, paused ordering).
export async function loadMenu(tableId) {
  if (staffActive) return;
  menuTable = tableId;
  clearInterval(menuTimer);
  await fetchMenu(tableId);
  menuTimer = setInterval(() => { if (!staffActive && menuTable) fetchMenu(menuTable).catch(() => {}); }, 15000);
}

export async function getOrdersByIds(ids) {
  try {
    const { data, error } = await supabase.rpc("get_orders_by_ids", { p_ids: ids });
    if (error || !Array.isArray(data)) return null;
    return data;
  } catch { return null; }
}

/* ---------- actions (same names and arguments as the local engine) ---------- */
export const placeOrder = (p) => call("place_order", { p });
export const setOrderStatus = (id, status, opts) => mutate("set_order_status", { p_id: id, p_status: status, p_force: !!opts?.force });
export const voidLine = (orderId, idx, reason) => mutate("void_line", { p_order: orderId, p_idx: idx, p_reason: reason });
export const setDiscount = (tabId, d) =>
  mutate("set_discount", { p_tab: tabId, p_type: d ? d.type : null, p_value: d ? d.value : null, p_reason: d ? d.reason : null });
export const addPayment = (tabId, p) => mutate("add_payment", { p_tab: tabId, p_method: p.method, p_amount: p.amount });
export const closeTab = (tabId) => mutate("close_tab", { p_tab: tabId });
export const moveTab = (tabId, to) => mutate("move_tab", { p_tab: tabId, p_to: to });
export const mergeTabs = (from, into) => mutate("merge_tabs", { p_from: from, p_into: into });
export const requestService = (p) => call("request_service", { p_table: p.tableId, p_type: p.type });
export const resolveRequest = (id) => mutate("resolve_request", { p_id: id });
export const upsertIngredient = (p) => mutate("upsert_ingredient", { p });
export const deleteIngredient = (id) => mutate("delete_ingredient", { p_id: id });
export const adjustStock = (p) => mutate("adjust_stock", { p_ingredient: p.ingredientId, p_delta: p.delta, p_reason: p.reason, p_note: p.note || "" });
export const upsertCategory = (p) => mutate("upsert_category", { p_id: p.id || null, p_name: p.name });
export const deleteCategory = (id) => mutate("delete_category", { p_id: id });
export const moveCategory = (id, dir) => mutate("move_category", { p_id: id, p_dir: dir });
export const upsertItem = (p) => mutate("upsert_item", { p });
export const deleteItem = (id) => mutate("delete_item", { p_id: id });
export const setItemAvailable = (id, available) => mutate("set_item_available", { p_id: id, p_available: available });
export const addTable = (label) => mutate("add_table", { p_label: label });
export const deleteTable = (id) => mutate("delete_table", { p_id: id });
export const updateSettings = (patch) => mutate("update_settings", { p: patch });

export const isRemote = REMOTE;
