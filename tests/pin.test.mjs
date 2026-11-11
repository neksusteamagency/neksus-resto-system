import test from "node:test";
import assert from "node:assert/strict";
import { hashPin, verifyPin, validPin, newDeviceToken, hashToken, afterAttempt, MAX_FAILS, LOCK_MINUTES } from "../supabase/functions/_shared/pin.js";

test("PINs are hashed with a salt and verified", async () => {
  const a = await hashPin("4821"), b = await hashPin("4821");
  assert.notEqual(a, b); // different salts
  assert.match(a, /^pbkdf2\$\d+\$[0-9a-f]{32}\$[0-9a-f]{64}$/);
  assert.equal(a.includes("4821"), false);
  assert.equal(await verifyPin("4821", a), true);
  assert.equal(await verifyPin("4822", a), false);
  assert.equal(await verifyPin("4821", "garbage"), false);
  assert.equal(await verifyPin("4821", ""), false);
});

test("PIN format", () => {
  for (const ok of ["1234", "123456", "0000"]) assert.equal(validPin(ok), true);
  for (const bad of ["123", "1234567", "12a4", "", " 1234", 1234, null, undefined]) assert.equal(validPin(bad), false);
});

test("device secrets are long, random and stored only as a hash", async () => {
  const t1 = newDeviceToken(), t2 = newDeviceToken();
  assert.equal(t1.length, 64);
  assert.notEqual(t1, t2);
  assert.equal(await hashToken(t1), await hashToken(t1));
  assert.notEqual(await hashToken(t1), t1);
});

test("lockout after five wrong tries, even a correct PIN is refused while locked", () => {
  const now = 1_000_000;
  let rec = { failed: 0, lockedUntil: null };
  for (let i = 1; i < MAX_FAILS; i++) {
    const r = afterAttempt(rec, false, now);
    assert.equal(r.allowed, false);
    assert.equal(r.remaining, MAX_FAILS - i);
    rec = { failed: r.failed, lockedUntil: r.lockedUntil };
  }
  const last = afterAttempt(rec, false, now);
  assert.equal(last.lockedUntil, now + LOCK_MINUTES * 60000);
  rec = { failed: last.failed, lockedUntil: last.lockedUntil };
  assert.equal(afterAttempt(rec, true, now + 1000).allowed, false); // still locked
  const later = afterAttempt(rec, true, now + LOCK_MINUTES * 60000 + 1);
  assert.deepEqual([later.allowed, later.failed, later.lockedUntil], [true, 0, null]);
  assert.equal(afterAttempt({ failed: 3, lockedUntil: null }, true, now).failed, 0); // success resets the counter
});
