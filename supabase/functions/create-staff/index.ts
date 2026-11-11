// Supabase Edge Function: lets the owner create a staff login.
// Creating an auth user needs the service-role key, which must never reach the browser, so the
// app calls this function instead. It checks that the caller is an active owner first.
//
// Deploy:  supabase functions deploy create-staff
import { createClient } from "npm:@supabase/supabase-js@2";

const cors = {
  "Access-Control-Allow-Origin": "*",
  "Access-Control-Allow-Headers": "authorization, x-client-info, apikey, content-type",
};
const json = (body: unknown, status = 200) =>
  new Response(JSON.stringify(body), { status, headers: { ...cors, "Content-Type": "application/json" } });

const ROLES = ["owner", "manager", "waiter", "kitchen"];

Deno.serve(async (req) => {
  if (req.method === "OPTIONS") return new Response("ok", { headers: cors });
  if (req.method !== "POST") return json({ error: "Method not allowed." }, 405);

  const url = Deno.env.get("SUPABASE_URL")!;
  const anonKey = Deno.env.get("SUPABASE_ANON_KEY")!;
  const serviceKey = Deno.env.get("SUPABASE_SERVICE_ROLE_KEY")!;

  const caller = createClient(url, anonKey, { global: { headers: { Authorization: req.headers.get("Authorization") ?? "" } } });
  const { data: { user } } = await caller.auth.getUser();
  if (!user) return json({ error: "Not signed in." }, 401);

  const admin = createClient(url, serviceKey);
  const { data: me } = await admin.from("profiles").select("role, active").eq("id", user.id).maybeSingle();
  if (!me || !me.active || me.role !== "owner") return json({ error: "Only the owner can add staff." }, 403);

  let body: { email?: string; password?: string; fullName?: string; role?: string };
  try { body = await req.json(); } catch { return json({ error: "Invalid request." }, 400); }
  const email = String(body.email ?? "").trim().toLowerCase();
  const password = String(body.password ?? "");
  const fullName = String(body.fullName ?? "").trim();
  const role = String(body.role ?? "");
  if (!/^[^\s@]+@[^\s@]+\.[^\s@]+$/.test(email)) return json({ error: "Enter a valid email address." }, 400);
  if (password.length < 8) return json({ error: "The password needs at least 8 characters." }, 400);
  if (!fullName || fullName.length > 40) return json({ error: "Enter the person's name (40 characters at most)." }, 400);
  if (!ROLES.includes(role)) return json({ error: "Choose a role." }, 400);

  const { data: created, error } = await admin.auth.admin.createUser({ email, password, email_confirm: true });
  if (error || !created.user) return json({ error: error?.message ?? "Could not create the account." }, 400);

  const { error: profileError } = await admin.from("profiles").insert({ id: created.user.id, full_name: fullName, role });
  if (profileError) {
    await admin.auth.admin.deleteUser(created.user.id);
    return json({ error: profileError.message }, 400);
  }
  return json({ ok: true });
});
