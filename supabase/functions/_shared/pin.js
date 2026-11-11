// PIN and device-secret helpers. Plain JavaScript using only Web Crypto, so the same code runs in
// the Supabase Edge Function (Deno) and in the Node tests.

const enc = new TextEncoder();
const toHex = (buf) => [...new Uint8Array(buf)].map((b) => b.toString(16).padStart(2, "0")).join("");
const fromHex = (hex) => new Uint8Array(hex.match(/../g).map((h) => parseInt(h, 16)));

export const ITERATIONS = 150000;
export const MAX_FAILS = 5;
export const LOCK_MINUTES = 5;
export const validPin = (pin) => typeof pin === "string" && /^[0-9]{4,6}$/.test(pin);

async function derive(pin, salt, iterations) {
  const key = await crypto.subtle.importKey("raw", enc.encode(pin), "PBKDF2", false, ["deriveBits"]);
  return crypto.subtle.deriveBits({ name: "PBKDF2", hash: "SHA-256", salt, iterations }, key, 256);
}

// Format: pbkdf2$<iterations>$<salt hex>$<hash hex>
export async function hashPin(pin) {
  const salt = crypto.getRandomValues(new Uint8Array(16));
  return `pbkdf2$${ITERATIONS}$${toHex(salt)}$${toHex(await derive(pin, salt, ITERATIONS))}`;
}

export async function verifyPin(pin, stored) {
  const [kind, iter, saltHex, hashHex] = String(stored || "").split("$");
  if (kind !== "pbkdf2" || !iter || !saltHex || !hashHex) return false;
  const got = new Uint8Array(await derive(pin, fromHex(saltHex), Number(iter)));
  const want = fromHex(hashHex);
  if (got.length !== want.length) return false;
  let diff = 0;
  for (let i = 0; i < got.length; i++) diff |= got[i] ^ want[i]; // constant-time comparison
  return diff === 0;
}

// A long random secret, kept on the device. Only its hash is stored in the database.
export const newDeviceToken = () => toHex(crypto.getRandomValues(new Uint8Array(32)));
export const hashToken = async (token) => toHex(await crypto.subtle.digest("SHA-256", enc.encode(String(token))));

// Decide what a PIN attempt does to the lockout counters.
//   record: { failed, lockedUntil (ms or null) }  ->  { allowed, failed, lockedUntil, remaining }
export function afterAttempt(record, correct, now = Date.now()) {
  if (record.lockedUntil && record.lockedUntil > now) return { allowed: false, failed: record.failed, lockedUntil: record.lockedUntil, remaining: 0 };
  if (correct) return { allowed: true, failed: 0, lockedUntil: null, remaining: MAX_FAILS };
  const failed = record.failed + 1;
  if (failed >= MAX_FAILS) return { allowed: false, failed: 0, lockedUntil: now + LOCK_MINUTES * 60000, remaining: 0 };
  return { allowed: false, failed, lockedUntil: null, remaining: MAX_FAILS - failed };
}
