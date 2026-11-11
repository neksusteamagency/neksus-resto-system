// Staff accounts (Supabase mode). Creating a login needs the service key, so it goes through
// the `create-staff` Edge Function; everything else is plain table access protected by RLS.
import { supabase } from "./supabaseClient.js";

export async function listStaff() {
  const { data, error } = await supabase.from("profiles").select("id, full_name, role, active, created_at").order("created_at");
  if (error) return { ok: false, error: error.message };
  return { ok: true, staff: data.map((p) => ({ id: p.id, name: p.full_name, role: p.role, active: p.active, createdAt: p.created_at })) };
}

export async function createStaff({ email, password, name, role }) {
  const { data, error } = await supabase.functions.invoke("create-staff", { body: { email, password, fullName: name, role } });
  if (error) {
    let msg = "Could not create the account.";
    try { const body = await error.context.json(); if (body?.error) msg = body.error; } catch { /* keep default */ }
    return { ok: false, error: msg };
  }
  if (data?.error) return { ok: false, error: data.error };
  return { ok: true };
}

export async function updateStaff(id, patch) {
  const row = {};
  if (patch.role) row.role = patch.role;
  if (patch.name !== undefined) row.full_name = patch.name;
  if (patch.active !== undefined) row.active = patch.active;
  const { error } = await supabase.from("profiles").update(row).eq("id", id);
  return error ? { ok: false, error: error.message } : { ok: true };
}
