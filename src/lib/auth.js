// Who is using the app.
//  - Supabase mode: real staff accounts (email + password) with a role from the `profiles` table.
//  - Local demo mode: a PIN per role, remembered for the browser session only. This keeps
//    casual customers out of staff screens but is NOT real security.
import { useSyncExternalStore } from "react";
import { REMOTE } from "./config.js";
import { supabase } from "./supabaseClient.js";

const KEY = "neksus-dine:user";
const GUEST = { name: "Guest", role: "customer" };

let auth = { status: REMOTE ? "loading" : "ready", user: null };
const listeners = new Set();
const set = (next) => { auth = next; listeners.forEach((l) => l()); };

export const getAuth = () => auth;
export const getActor = () => auth.user || GUEST;
export const subscribeAuth = (l) => { listeners.add(l); return () => listeners.delete(l); };
export const useAuth = () => useSyncExternalStore(subscribeAuth, getAuth);

// Which roles may open which screen.
export const ACCESS = {
  kitchen: ["kitchen", "manager", "owner"],
  waiter: ["waiter", "manager", "owner"],
  admin: ["manager", "owner"],
};
export const canOpen = (screen, user) => !!user && ACCESS[screen].includes(user.role);

/* ---------- local demo mode ---------- */
function readLocal() {
  try { return JSON.parse(sessionStorage.getItem(KEY)); } catch { return null; }
}
if (!REMOTE) set({ status: "ready", user: readLocal() });

export function signInLocal({ pin, name }, settings) {
  const roleByPin = [[settings.adminPin, "owner"], [settings.waiterPin, "waiter"], [settings.kitchenPin, "kitchen"]];
  const hit = roleByPin.find(([p]) => p && p === pin);
  if (!hit) return { ok: false, error: "Incorrect PIN." };
  const role = hit[1];
  const defaults = { owner: "Owner", waiter: "Waiter", kitchen: "Kitchen" };
  const user = { name: String(name || "").trim().slice(0, 30) || defaults[role], role };
  try { sessionStorage.setItem(KEY, JSON.stringify(user)); } catch { /* ignore */ }
  set({ status: "ready", user });
  return { ok: true };
}

// Used by the demo showcase page so the embedded kitchen screen opens without a PIN.
export function ensureDemoUser(role = "kitchen") {
  if (REMOTE || auth.user) return;
  const user = { name: "Kitchen", role };
  try { sessionStorage.setItem(KEY, JSON.stringify(user)); } catch { /* ignore */ }
  set({ status: "ready", user });
}

/* ---------- Supabase mode ---------- */
async function loadProfile(session) {
  if (!session) { set({ status: "ready", user: null }); return; }
  const { data, error } = await supabase
    .from("profiles").select("id, full_name, role, active").eq("id", session.user.id).maybeSingle();
  if (error || !data || !data.active) {
    await supabase.auth.signOut();
    set({ status: "ready", user: null });
    return;
  }
  set({ status: "ready", user: { id: data.id, name: data.full_name, role: data.role } });
}

if (REMOTE) {
  supabase.auth.getSession().then(({ data }) => loadProfile(data.session));
  supabase.auth.onAuthStateChange((event, session) => {
    if (event === "SIGNED_OUT") set({ status: "ready", user: null });
    else if (event === "SIGNED_IN" || event === "USER_UPDATED") setTimeout(() => loadProfile(session), 0);
  });
}

export async function signInRemote({ email, password }) {
  const { data, error } = await supabase.auth.signInWithPassword({ email: email.trim(), password });
  if (error) return { ok: false, error: "Incorrect email or password." };
  await loadProfile(data.session);
  if (!auth.user) return { ok: false, error: "This account has no staff access. Ask the owner." };
  return { ok: true };
}

// After a sign-in that happened outside signInRemote (PIN sign-in), load the person's role.
export async function refreshProfile() {
  if (!REMOTE) return;
  const { data } = await supabase.auth.getSession();
  await loadProfile(data.session);
  return auth.user;
}

export async function signOut() {
  if (REMOTE) await supabase.auth.signOut();
  try { sessionStorage.removeItem(KEY); } catch { /* ignore */ }
  set({ status: "ready", user: null });
}
