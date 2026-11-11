// Runs the real staff-pin Edge Function code (bundled with esbuild) against the migrations in PGlite,
// with a small stand-in for the Supabase client. Checks the whole PIN sign-in flow.
import test, { before } from "node:test";
import assert from "node:assert/strict";
import { readFileSync, mkdirSync } from "node:fs";
import { pathToFileURL } from "node:url";
import { build } from "esbuild";
import { PGlite } from "@electric-sql/pglite";
import { hashToken } from "../supabase/functions/_shared/pin.js";

const db = new PGlite();
const sql = (f) => readFileSync(new URL(`../supabase/${f}`, import.meta.url), "utf8");
const ID = { owner: "00000000-0000-0000-0000-00000000000a", manager: "00000000-0000-0000-0000-00000000000b", waiter: "00000000-0000-0000-0000-00000000000c", kitchen: "00000000-0000-0000-0000-00000000000d" };
const ID_BY = Object.fromEntries(Object.entries(ID).map(([k, v]) => [v, k]));

// ----- a tiny stand-in for the parts of supabase-js the function uses -----
const iso = (row) => Object.fromEntries(Object.entries(row).map(([k, v]) => [k, v instanceof Date ? v.toISOString() : v]));
function fakeClient(headers = {}) {
  const from = (table) => {
    const q = { op: "select", cols: "*", filters: [], order: null, payload: null };
    const exec = async (single) => {
      try {
        const where = q.filters.map(([c], i) => `${c} = $${i + 1 + (q.payload ? Object.keys(q.payload).length : 0)}`).join(" and ");
        const fv = q.filters.map(([, v]) => v);
        let res;
        if (q.op === "select") {
          res = await db.query(`select ${q.cols} from ${table}${where ? ` where ${where}` : ""}${q.order ? ` order by ${q.order}` : ""}`, fv);
          const rows = res.rows.map(iso);
          return { data: single ? rows[0] ?? null : rows, error: null };
        }
        const keys = Object.keys(q.payload), vals = Object.values(q.payload);
        if (q.op === "insert") await db.query(`insert into ${table} (${keys.join(",")}) values (${keys.map((_, i) => `$${i + 1}`).join(",")})`, vals);
        if (q.op === "upsert") await db.query(`insert into ${table} (${keys.join(",")}) values (${keys.map((_, i) => `$${i + 1}`).join(",")}) on conflict (${keys[0]}) do update set ${keys.slice(1).map((k) => `${k} = excluded.${k}`).join(",")}`, vals);
        if (q.op === "update") await db.query(`update ${table} set ${keys.map((k, i) => `${k} = $${i + 1}`).join(",")}${where ? ` where ${where}` : ""}`, [...vals, ...fv]);
        return { data: null, error: null };
      } catch (e) { return { data: null, error: { message: e.message } }; }
    };
    const api = {
      select(c = "*") { q.cols = c; return api; },
      eq(c, v) { q.filters.push([c, v]); return api; },
      order(c) { q.order = c; return api; },
      insert(p) { q.op = "insert"; q.payload = p; return exec(); },
      upsert(p) { q.op = "upsert"; q.payload = p; return exec(); },
      update(p) { q.op = "update"; q.payload = p; return api; },
      maybeSingle() { return exec(true); },
      then(res, rej) { return exec().then(res, rej); },
    };
    return api;
  };
  return {
    from,
    auth: {
      async getUser() {
        const t = (headers.Authorization || "").replace("Bearer ", "");
        return { data: { user: ID_BY[t] ? { id: t } : null } };
      },
      admin: {
        async getUserById(id) { const r = await db.query("select email from auth.users where id = $1", [id]); return { data: { user: r.rows[0] ?? null } }; },
        async generateLink({ email }) { return { data: { properties: { hashed_token: `hash-for-${email}` } }, error: null }; },
      },
    },
  };
}

let handler;
before(async () => {
  await db.exec(`
    create role anon nologin; create role authenticated nologin; create schema auth;
    create table auth.users (id uuid primary key default gen_random_uuid(), email text);
    create function auth.uid() returns uuid language sql stable as $$ select nullif(current_setting('request.jwt.claim.sub', true), '')::uuid $$;
    grant usage on schema auth to anon, authenticated; grant execute on function auth.uid() to anon, authenticated; grant usage on schema public to anon, authenticated;`);
  for (const f of ["migrations/0001_schema.sql", "migrations/0002_functions.sql", "migrations/0003_security.sql", "migrations/0004_pin_login.sql"]) await db.exec(sql(f));
  for (const [role, id] of Object.entries(ID)) {
    await db.query("insert into auth.users (id, email) values ($1, $2)", [id, `${role}@x.com`]);
    await db.query("insert into profiles (id, full_name, role) values ($1, $2, $3)", [id, role[0].toUpperCase() + role.slice(1), role]);
  }
  mkdirSync(new URL("../node_modules/.tmp/", import.meta.url), { recursive: true });
  const out = new URL("../node_modules/.tmp/staff-pin.mjs", import.meta.url);
  await build({
    entryPoints: [new URL("../supabase/functions/staff-pin/index.ts", import.meta.url).pathname],
    bundle: true, format: "esm", platform: "neutral", outfile: out.pathname, logLevel: "error",
    plugins: [{ name: "stub", setup(b) {
      b.onResolve({ filter: /^npm:@supabase\/supabase-js/ }, () => ({ path: "supabase-stub", namespace: "stub" }));
      b.onLoad({ filter: /.*/, namespace: "stub" }, () => ({ contents: "export const createClient = (u, k, o) => globalThis.__createClient(o?.global?.headers ?? {});", loader: "js" }));
    } }],
  });
  globalThis.__createClient = fakeClient;
  globalThis.Deno = { env: { get: () => "x" }, serve: (fn) => { handler = fn; } };
  await import(pathToFileURL(out.pathname).href);
});

const call = async (body, as = null, token = null) => {
  const headers = { "Content-Type": "application/json", ...(as ? { Authorization: `Bearer ${ID[as]}` } : {}) };
  const res = await handler(new Request("http://x/staff-pin", { method: "POST", headers, body: JSON.stringify({ ...(token ? { token } : {}), ...body }) }));
  return res.json();
};
let device;

test("only a manager or owner can register a device; only the hash is stored", async () => {
  assert.equal((await call({ action: "register", name: "Bar" })).ok, false); // nobody signed in
  assert.equal((await call({ action: "register", name: "Bar" }, "waiter")).ok, false);
  assert.equal((await call({ action: "register", name: " " }, "manager")).ok, false);
  const r = await call({ action: "register", name: "Bar tablet" }, "manager");
  assert.equal(r.ok, true);
  device = r.token;
  assert.equal(device.length, 64);
  const row = (await db.query("select * from devices")).rows[0];
  assert.equal(row.token_hash, await hashToken(device));
  assert.notEqual(row.token_hash, device);
  assert.equal(row.revoked, false);
});

test("setting PINs: validation and who may set whose", async () => {
  assert.equal((await call({ action: "set-pin", staffId: ID.waiter, pin: "4821" })).ok, false); // not signed in
  assert.equal((await call({ action: "set-pin", staffId: ID.waiter, pin: "4821" }, "waiter")).ok, false);
  assert.equal((await call({ action: "set-pin", staffId: ID.waiter, pin: "12" }, "manager")).ok, false);
  assert.equal((await call({ action: "set-pin", staffId: ID.waiter, pin: "abcd" }, "manager")).ok, false);
  assert.equal((await call({ action: "set-pin", staffId: "00000000-0000-0000-0000-000000000099", pin: "4821" }, "manager")).ok, false);
  assert.equal((await call({ action: "set-pin", staffId: ID.owner, pin: "4821" }, "manager")).ok, false); // managers can't set the owner's
  assert.equal((await call({ action: "set-pin", staffId: ID.waiter, pin: "4821" }, "manager")).ok, true);
  assert.equal((await call({ action: "set-pin", staffId: ID.kitchen, pin: "7777" }, "manager")).ok, true);
  assert.equal((await call({ action: "set-pin", staffId: ID.manager, pin: "5555" }, "manager")).ok, true); // their own
  assert.equal((await call({ action: "set-pin", staffId: ID.manager, pin: "5556" }, "owner")).ok, true);
  const hashes = (await db.query("select pin_hash from staff_pins")).rows.map((r) => r.pin_hash);
  assert.equal(hashes.length, 3);
  assert.ok(hashes.every((h) => h.startsWith("pbkdf2$") && !/4821|7777|5556/.test(h)));
});

test("the staff list is only for registered devices and only shows people with a PIN", async () => {
  assert.equal((await call({ action: "staff" })).code, "device_revoked");
  assert.equal((await call({ action: "staff" }, null, "x".repeat(64))).code, "device_revoked");
  const r = await call({ action: "staff" }, null, device);
  assert.equal(r.ok, true);
  assert.deepEqual(r.staff.map((p) => p.name).sort(), ["Kitchen", "Manager", "Waiter"]); // the owner has no PIN yet
  assert.ok(r.staff.every((p) => !("email" in p) && !("pin_hash" in p)));
  assert.ok((await db.query("select last_used_at from devices")).rows[0].last_used_at);
});

test("login: wrong PIN counts down, locks, then a correct PIN works after the lock", async () => {
  assert.equal((await call({ action: "login", staffId: ID.waiter, pin: "4821" })).code, "device_revoked"); // no device secret
  const wrong = await call({ action: "login", staffId: ID.waiter, pin: "0000" }, null, device);
  assert.deepEqual([wrong.ok, wrong.error], [false, "Wrong PIN. 4 tries left."]);
  assert.equal((await call({ action: "login", staffId: ID.waiter, pin: "nope" }, null, device)).error, "Wrong PIN.");
  // another person's PIN doesn't work for this account
  assert.equal((await call({ action: "login", staffId: ID.waiter, pin: "7777" }, null, device)).ok, false);
  const ok = await call({ action: "login", staffId: ID.waiter, pin: "4821" }, null, device);
  assert.deepEqual([ok.ok, ok.tokenHash], [true, "hash-for-waiter@x.com"]);
  assert.equal((await db.query("select failed from staff_pins where staff_id = $1", [ID.waiter])).rows[0].failed, 0); // success resets

  let last;
  for (let i = 0; i < 5; i++) last = await call({ action: "login", staffId: ID.kitchen, pin: "1111" }, null, device);
  assert.match(last.error, /Too many attempts/);
  const during = await call({ action: "login", staffId: ID.kitchen, pin: "7777" }, null, device);
  assert.equal(during.ok, false); // the right PIN is refused while locked
  assert.match(during.error, /Too many attempts/);
  await db.query("update staff_pins set locked_until = now() - interval '1 minute' where staff_id = $1", [ID.kitchen]);
  assert.equal((await call({ action: "login", staffId: ID.kitchen, pin: "7777" }, null, device)).ok, true);
});

test("login refuses unknown, deactivated and PIN-less accounts with the same message", async () => {
  const same = "Wrong PIN.";
  assert.equal((await call({ action: "login", staffId: "00000000-0000-0000-0000-000000000099", pin: "4821" }, null, device)).error, same);
  assert.equal((await call({ action: "login", staffId: ID.owner, pin: "4821" }, null, device)).error, same); // no PIN set
  await db.query("update profiles set active = false where id = $1", [ID.waiter]);
  assert.equal((await call({ action: "login", staffId: ID.waiter, pin: "4821" }, null, device)).error, same);
  assert.equal((await call({ action: "staff" }, null, device)).staff.some((p) => p.name === "Waiter"), false);
  await db.query("update profiles set active = true where id = $1", [ID.waiter]);
});

test("a revoked device stops working", async () => {
  await db.query("update devices set revoked = true");
  assert.equal((await call({ action: "staff" }, null, device)).code, "device_revoked");
  assert.equal((await call({ action: "login", staffId: ID.waiter, pin: "4821" }, null, device)).code, "device_revoked");
  await db.query("update devices set revoked = false");
});

test("database permissions: customers see nothing, managers see devices but never PIN hashes", async () => {
  const as = async (role, sub) => { await db.exec("reset role"); await db.query("select set_config('request.jwt.claim.sub', $1, false)", [sub]); await db.exec(`set role ${role}`); };
  await as("anon", "");
  await assert.rejects(db.query("select * from devices"), /permission denied/);
  await assert.rejects(db.query("select * from staff_pins"), /permission denied/);
  await as("authenticated", ID.waiter);
  assert.equal((await db.query("select * from devices")).rows.length, 0); // row-level security hides them from waiters
  assert.equal((await db.query("select staff_id from staff_pins")).rows.length, 0);
  await as("authenticated", ID.manager);
  assert.equal((await db.query("select * from devices")).rows.length, 1);
  assert.equal((await db.query("select staff_id from staff_pins")).rows.length, 3);
  await assert.rejects(db.query("select pin_hash from staff_pins"), /permission denied/);
  await assert.rejects(db.query("update devices set name = 'x'"), /permission denied/);
  await assert.rejects(db.query("insert into devices (name, token_hash) values ('a', 'b')"), /permission denied/);
  assert.equal((await db.query("update devices set revoked = true returning id")).rows.length, 1);
  await as("authenticated", ID.waiter);
  assert.equal((await db.query("update devices set revoked = false returning id")).rows.length, 0);
  await db.exec("reset role");
});
