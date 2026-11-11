// Supabase Edge Function: PIN sign-in for shared devices.
//
//   register  (manager/owner signed in)  Register this device. Returns a secret to keep on it.
//   set-pin   (manager/owner signed in)  Set a staff member's PIN.
//   staff     (registered device)        List the staff who have a PIN, for the "pick your name" screen.
//   login     (registered device)        Check a PIN. On success returns a one-time token the app
//                                        exchanges for a normal Supabase session for that staff member.
//
// Deploy:  supabase functions deploy staff-pin   (supabase/config.toml turns off JWT checking for it,
// because devices call it before anyone is signed in; the checks below replace it.)
import { createClient } from "npm:@supabase/supabase-js@2";
import { hashPin, verifyPin, validPin, newDeviceToken, hashToken, afterAttempt } from "../_shared/pin.js";

const cors = {
  "Access-Control-Allow-Origin": "*",
  "Access-Control-Allow-Headers": "authorization, x-client-info, apikey, content-type",
};
const json = (body: unknown, status = 200) =>
  new Response(JSON.stringify(body), { status, headers: { ...cors, "Content-Type": "application/json" } });
// Expected problems come back as 200 with { ok: false, error } so the app can show the message.
const no = (error: string, extra: Record<string, unknown> = {}) => json({ ok: false, error, ...extra });

Deno.serve(async (req) => {
  if (req.method === "OPTIONS") return new Response("ok", { headers: cors });
  if (req.method !== "POST") return json({ error: "Method not allowed." }, 405);

  const url = Deno.env.get("SUPABASE_URL")!;
  const anonKey = Deno.env.get("SUPABASE_ANON_KEY")!;
  const admin = createClient(url, Deno.env.get("SUPABASE_SERVICE_ROLE_KEY")!);

  let body: Record<string, unknown>;
  try { body = await req.json(); } catch { return no("Invalid request."); }

  // The signed-in manager or owner making the call, if any.
  const caller = async () => {
    const client = createClient(url, anonKey, { global: { headers: { Authorization: req.headers.get("Authorization") ?? "" } } });
    const { data: { user } } = await client.auth.getUser();
    if (!user) return null;
    const { data } = await admin.from("profiles").select("id, role, active").eq("id", user.id).maybeSingle();
    return data && data.active && ["owner", "manager"].includes(data.role) ? data : null;
  };

  // A registered, not revoked device.
  const device = async () => {
    const token = typeof body.token === "string" ? body.token : "";
    if (token.length < 32) return null;
    const { data } = await admin.from("devices").select("id, revoked").eq("token_hash", await hashToken(token)).maybeSingle();
    if (!data || data.revoked) return null;
    await admin.from("devices").update({ last_used_at: new Date().toISOString() }).eq("id", data.id);
    return data;
  };

  switch (body.action) {
    case "register": {
      const me = await caller();
      if (!me) return no("Only a manager or the owner can set up a device.");
      const name = String(body.name ?? "").trim().slice(0, 40);
      if (!name) return no("Give this device a name.");
      const token = newDeviceToken();
      const { error } = await admin.from("devices").insert({ name, token_hash: await hashToken(token), created_by: me.id });
      if (error) return no("Could not register the device.");
      return json({ ok: true, token });
    }

    case "set-pin": {
      const me = await caller();
      if (!me) return no("Only a manager or the owner can set PINs.");
      const staffId = String(body.staffId ?? "");
      if (!validPin(body.pin)) return no("A PIN must be 4 to 6 digits.");
      const { data: target } = await admin.from("profiles").select("id, role, active").eq("id", staffId).maybeSingle();
      if (!target) return no("Staff member not found.");
      if (["owner", "manager"].includes(target.role) && me.role !== "owner" && target.id !== me.id) {
        return no("Only the owner can set a manager's or owner's PIN.");
      }
      const { error } = await admin.from("staff_pins").upsert({
        staff_id: staffId, pin_hash: await hashPin(body.pin as string), failed: 0, locked_until: null, updated_at: new Date().toISOString(),
      });
      if (error) return no("Could not save the PIN.");
      return json({ ok: true });
    }

    case "staff": {
      if (!(await device())) return no("This device is no longer registered.", { code: "device_revoked" });
      const [{ data: people }, { data: pins }] = await Promise.all([
        admin.from("profiles").select("id, full_name, role").eq("active", true).order("full_name"),
        admin.from("staff_pins").select("staff_id"),
      ]);
      const has = new Set((pins ?? []).map((p: { staff_id: string }) => p.staff_id));
      return json({ ok: true, staff: (people ?? []).filter((p: { id: string }) => has.has(p.id)).map((p: { id: string; full_name: string; role: string }) => ({ id: p.id, name: p.full_name, role: p.role })) });
    }

    case "login": {
      if (!(await device())) return no("This device is no longer registered.", { code: "device_revoked" });
      const staffId = String(body.staffId ?? "");
      const wrong = () => no("Wrong PIN.");
      if (!validPin(body.pin)) return wrong();
      const { data: person } = await admin.from("profiles").select("id, active").eq("id", staffId).maybeSingle();
      const { data: rec } = await admin.from("staff_pins").select("pin_hash, failed, locked_until").eq("staff_id", staffId).maybeSingle();
      if (!person || !person.active || !rec) return wrong(); // same answer whether or not the person exists

      const now = Date.now();
      const lockedUntil = rec.locked_until ? Date.parse(rec.locked_until) : null;
      const correct = await verifyPin(body.pin as string, rec.pin_hash);
      const r = afterAttempt({ failed: rec.failed, lockedUntil }, correct, now);
      await admin.from("staff_pins").update({ failed: r.failed, locked_until: r.lockedUntil ? new Date(r.lockedUntil).toISOString() : null }).eq("staff_id", staffId);
      if (!r.allowed) {
        if (r.lockedUntil && r.lockedUntil > now) {
          return no(`Too many attempts. Try again in ${Math.max(1, Math.ceil((r.lockedUntil - now) / 60000))} minutes.`);
        }
        return no(`Wrong PIN. ${r.remaining} ${r.remaining === 1 ? "try" : "tries"} left.`);
      }

      const { data: user } = await admin.auth.admin.getUserById(staffId);
      const email = user?.user?.email;
      if (!email) return no("This account can't sign in with a PIN.");
      const { data: link, error } = await admin.auth.admin.generateLink({ type: "magiclink", email });
      if (error || !link?.properties?.hashed_token) return no("Could not sign in. Please try again.");
      return json({ ok: true, tokenHash: link.properties.hashed_token });
    }

    default:
      return no("Unknown request.");
  }
});
