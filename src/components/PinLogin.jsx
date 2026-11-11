import { useCallback, useEffect, useState } from "react";
import { fetchPinStaff, signInWithPin } from "../lib/pinAuth";
import { canOpen } from "../lib/auth";
import { ROLE_LABEL } from "../lib/format";
import PinPad from "./PinPad";

const TITLES = { admin: "Admin panel", kitchen: "Kitchen screen", waiter: "Waiter screen" };

// "Pick your name, enter your PIN" for a device a manager has registered.
export default function PinLogin({ screen, onEmail }) {
  const [staff, setStaff] = useState(null);
  const [loadError, setLoadError] = useState("");
  const [who, setWho] = useState(null);
  const [pin, setPin] = useState("");
  const [error, setError] = useState("");
  const [busy, setBusy] = useState(false);

  const load = useCallback(async () => {
    setLoadError("");
    const r = await fetchPinStaff();
    if (r.ok) setStaff(r.staff);
    else setLoadError(r.error);
  }, []);
  useEffect(() => { load(); }, [load]);

  const submit = async (e) => {
    e.preventDefault();
    if (busy) return;
    setBusy(true);
    const r = await signInWithPin(who.id, pin);
    setBusy(false);
    if (!r.ok) { setPin(""); setError(r.error); }
  };

  const eligible = (staff || []).filter((p) => canOpen(screen, p));

  return (
    <div className="gate">
      <div className="gate-card wide">
        <span className="brand-mark">N</span>
        <h1>{TITLES[screen]}</h1>

        {loadError && (
          <>
            <div className="form-error" role="alert">{loadError}</div>
            <button className="btn block" onClick={load}>Try again</button>
          </>
        )}
        {!loadError && !staff && <p className="muted" role="status">Loading…</p>}

        {!loadError && staff && !who && (
          <>
            <p>Who is signing in?</p>
            {eligible.length === 0 ? (
              <p className="muted">Nobody with a PIN can open this screen yet. A manager can set PINs on the Staff page.</p>
            ) : (
              <ul className="pin-staff">
                {eligible.map((p) => (
                  <li key={p.id}>
                    <button className="btn block" onClick={() => { setWho(p); setPin(""); setError(""); }}>
                      <strong>{p.name}</strong><small>{ROLE_LABEL[p.role]}</small>
                    </button>
                  </li>
                ))}
              </ul>
            )}
          </>
        )}

        {who && (
          <form onSubmit={submit} className="pin-form">
            <p>Hello {who.name}, enter your PIN.</p>
            {error && <div className="form-error" role="alert">{error}</div>}
            <PinPad value={pin} onChange={(v) => { setPin(v); setError(""); }} busy={busy} />
            <button type="button" className="btn block" onClick={() => { setWho(null); setError(""); }}>Not you?</button>
          </form>
        )}

        <button type="button" className="link-btn" onClick={onEmail}>Manager? Sign in with email</button>
      </div>
    </div>
  );
}
