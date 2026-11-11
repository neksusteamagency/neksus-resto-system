// PIN sign-in on shared devices (Supabase mode). The PIN is checked by the `staff-pin` Edge
// Function; a registered device keeps a secret in localStorage. Nothing here works without it.
import { useSyncExternalStore } from "react";
import { supabase } from "./supabaseClient.js";
import { refreshProfile } from "./auth.js";

const KEY = "neksus-dine:device";
const listeners = new Set();

export const getDeviceToken = () => {
  try { return localStorage.getItem(KEY); } catch { return null; }
};
function setDeviceToken(token) {
  try { token ? localStorage.setItem(KEY, token) : localStorage.removeItem(KEY); } catch { /* ignore */ }
  listeners.forEach((l) => l());
}
export const forgetDevice = () => setDeviceToken(null);
export const useDevice = () =>
  useSyncExternalStore((l) => { listeners.add(l); return () => listeners.delete(l); }, getDeviceToken);

async function invoke(body) {
  try {
    const { data, error } = await supabase.functions.invoke("staff-pin", { body });
    if (error) return { ok: false, error: "Can't reach the server. Check your connection and try again." };
    return data && typeof data === "object" ? data : { ok: false, error: "No response from the server." };
  } catch {
    return { ok: false, error: "Can't reach the server. Check your connection and try again." };
  }
}

// The people who have a PIN, for the "pick your name" screen.
export async function fetchPinStaff() {
  const r = await invoke({ action: "staff", token: getDeviceToken() });
  if (r.code === "device_revoked") forgetDevice();
  return r;
}

export async function signInWithPin(staffId, pin) {
  const r = await invoke({ action: "login", token: getDeviceToken(), staffId, pin });
  if (!r.ok) {
    if (r.code === "device_revoked") forgetDevice();
    return r;
  }
  const { error } = await supabase.auth.verifyOtp({ token_hash: r.tokenHash, type: "magiclink" });
  if (error) return { ok: false, error: "Could not sign in. Please try again." };
  await refreshProfile();
  return { ok: true };
}

// A signed-in manager or owner turns this device into a PIN sign-in device.
export async function registerThisDevice(name) {
  const r = await invoke({ action: "register", name });
  if (r.ok) setDeviceToken(r.token);
  return r.ok ? { ok: true } : r;
}

export const setStaffPin = (staffId, pin) => invoke({ action: "set-pin", staffId, pin });

export async function listDevices() {
  const { data, error } = await supabase.from("devices").select("id, name, created_at, last_used_at, revoked").order("created_at");
  if (error) return { ok: false, error: error.message };
  return { ok: true, devices: data.map((d) => ({ id: d.id, name: d.name, createdAt: d.created_at, lastUsedAt: d.last_used_at, revoked: d.revoked })) };
}

export async function revokeDevice(id) {
  const { error } = await supabase.from("devices").update({ revoked: true }).eq("id", id);
  return error ? { ok: false, error: error.message } : { ok: true };
}

export async function listPinned() {
  const { data, error } = await supabase.from("staff_pins").select("staff_id");
  return error ? [] : data.map((r) => r.staff_id);
}
