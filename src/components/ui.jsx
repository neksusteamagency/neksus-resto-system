import { useEffect, useId, useState } from "react";
import { useStore } from "../lib/store";
import { getRole, setRole, canAccess } from "../lib/auth";

// Bottom sheet on phones, centred dialog on larger screens.
export function Sheet({ title, onClose, children, footer, wide = false }) {
  const titleId = useId();
  useEffect(() => {
    const onKey = (e) => { if (e.key === "Escape") onClose(); };
    document.addEventListener("keydown", onKey);
    const prev = document.body.style.overflow;
    document.body.style.overflow = "hidden";
    return () => {
      document.removeEventListener("keydown", onKey);
      document.body.style.overflow = prev;
    };
  }, [onClose]);

  return (
    <div className="overlay" onMouseDown={(e) => { if (e.target === e.currentTarget) onClose(); }}>
      <div className={wide ? "sheet wide" : "sheet"} role="dialog" aria-modal="true" aria-labelledby={titleId}>
        <div className="sheet-head">
          <h3 id={titleId}>{title}</h3>
          <button className="icon-btn" onClick={onClose} aria-label="Close">✕</button>
        </div>
        <div className="sheet-body">{children}</div>
        {footer && <div className="sheet-foot">{footer}</div>}
      </div>
    </div>
  );
}

export function Toast({ toast, onDismiss }) {
  if (!toast) return null;
  return (
    <div className="toast" role="status" key={toast.id}>
      <span>{toast.text}</span>
      {toast.action && (
        <button onClick={() => { toast.action.run(); onDismiss(); }}>{toast.action.label}</button>
      )}
    </div>
  );
}

export function Empty({ title, children }) {
  return (
    <div className="empty">
      <strong>{title}</strong>
      {children && <p>{children}</p>}
    </div>
  );
}

// PIN gate for staff screens.
export function Gate({ role, children }) {
  const { settings } = useStore();
  const [current, setCurrent] = useState(getRole());
  const [pin, setPin] = useState("");
  const [error, setError] = useState("");
  const [fails, setFails] = useState(0);
  const [lockedUntil, setLockedUntil] = useState(0);

  if (canAccess(role, current)) return children(() => { setRole(null); setCurrent(null); });

  const submit = (e) => {
    e.preventDefault();
    if (Date.now() < lockedUntil) {
      setError("Too many attempts. Wait a few seconds and try again.");
      return;
    }
    if (pin === settings.adminPin) { setRole("admin"); setCurrent("admin"); return; }
    if (role === "kitchen" && pin === settings.kitchenPin) { setRole("kitchen"); setCurrent("kitchen"); return; }
    const n = fails + 1;
    setFails(n);
    setPin("");
    if (n >= 5) {
      setLockedUntil(Date.now() + 30000);
      setFails(0);
      setError("Too many attempts. Wait 30 seconds and try again.");
    } else {
      setError("Incorrect PIN.");
    }
  };

  return (
    <div className="gate">
      <form className="gate-card" onSubmit={submit}>
        <span className="brand-mark">N</span>
        <h1>{role === "admin" ? "Admin panel" : "Kitchen screen"}</h1>
        <p>Enter your staff PIN to continue.</p>
        <input
          type="password"
          inputMode="numeric"
          autoComplete="off"
          autoFocus
          value={pin}
          onChange={(e) => { setPin(e.target.value.replace(/\D/g, "").slice(0, 8)); setError(""); }}
          placeholder="PIN"
          aria-label="Staff PIN"
        />
        {error && <div className="form-error" role="alert">{error}</div>}
        <button className="btn primary block" disabled={pin.length < 4}>Unlock</button>
      </form>
    </div>
  );
}
