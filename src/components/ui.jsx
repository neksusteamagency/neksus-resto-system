import { useEffect, useId, useState } from "react";
import { Link } from "react-router-dom";
import { useStore } from "../lib/store";
import { useAuth, canOpen, signInLocal, signInRemote, signOut } from "../lib/auth";
import { REMOTE } from "../lib/config";
import { useDevice } from "../lib/pinAuth";
import PinLogin from "./PinLogin";

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

export const Loading = ({ text = "Loading…" }) => (
  <div className="gate"><p className="muted" role="status">{text}</p></div>
);

// Staff screens: sign in, then check that the account's role may open this screen.
// children is a function: (user, signOut) => screen
export function Gate({ screen, children }) {
  const auth = useAuth();
  const { staffReady } = useStore();

  if (auth.status === "loading") return <Loading />;
  if (!auth.user) return <LoginForm screen={screen} />;
  if (!canOpen(screen, auth.user)) return <NoAccess user={auth.user} />;
  if (!staffReady) return <Loading text="Loading restaurant data…" />;
  return children(auth.user, signOut);
}

const TITLES = { admin: "Admin panel", kitchen: "Kitchen screen", waiter: "Waiter screen" };

function LoginForm({ screen }) {
  const device = useDevice();
  const [useEmail, setUseEmail] = useState(false);
  if (REMOTE && device && !useEmail) return <PinLogin screen={screen} onEmail={() => setUseEmail(true)} />;
  return <CredentialsForm screen={screen} onPin={REMOTE && device ? () => setUseEmail(false) : null} />;
}

function CredentialsForm({ screen, onPin }) {
  const { settings } = useStore();
  const [pin, setPin] = useState("");
  const [name, setName] = useState("");
  const [email, setEmail] = useState("");
  const [password, setPassword] = useState("");
  const [error, setError] = useState("");
  const [busy, setBusy] = useState(false);
  const [fails, setFails] = useState(0);
  const [lockedUntil, setLockedUntil] = useState(0);

  const submit = async (e) => {
    e.preventDefault();
    if (Date.now() < lockedUntil) { setError("Too many attempts. Wait a few seconds and try again."); return; }
    setBusy(true);
    const res = REMOTE ? await signInRemote({ email, password }) : signInLocal({ pin, name }, settings);
    setBusy(false);
    if (res.ok) return;
    const n = fails + 1;
    setPin(""); setPassword("");
    if (n >= 5) { setFails(0); setLockedUntil(Date.now() + 30000); setError("Too many attempts. Wait 30 seconds and try again."); }
    else { setFails(n); setError(res.error); }
  };

  return (
    <div className="gate">
      <form className="gate-card" onSubmit={submit}>
        <span className="brand-mark">N</span>
        <h1>{TITLES[screen]}</h1>
        <p>{REMOTE ? "Sign in with your staff account." : "Enter your staff PIN to continue."}</p>
        {REMOTE ? (
          <>
            <input type="email" autoComplete="username" autoFocus value={email} onChange={(e) => { setEmail(e.target.value); setError(""); }} placeholder="Email" aria-label="Email" className="plain" />
            <input type="password" autoComplete="current-password" value={password} onChange={(e) => { setPassword(e.target.value); setError(""); }} placeholder="Password" aria-label="Password" className="plain" />
          </>
        ) : (
          <>
            <input type="text" autoComplete="off" value={name} maxLength={30} onChange={(e) => setName(e.target.value)} placeholder="Your name (optional)" aria-label="Your name" className="plain" />
            <input type="password" inputMode="numeric" autoComplete="off" autoFocus value={pin}
              onChange={(e) => { setPin(e.target.value.replace(/\D/g, "").slice(0, 8)); setError(""); }} placeholder="PIN" aria-label="Staff PIN" />
          </>
        )}
        {error && <div className="form-error" role="alert">{error}</div>}
        <button className="btn primary block" disabled={busy || (REMOTE ? !email || !password : pin.length < 4)}>{busy ? "Signing in…" : "Sign in"}</button>
        {onPin && <button type="button" className="link-btn" onClick={onPin}>Back to PIN sign-in</button>}
      </form>
    </div>
  );
}

function NoAccess({ user }) {
  const links = [["waiter", "/waiter", "Waiter screen"], ["kitchen", "/kitchen", "Kitchen screen"], ["admin", "/admin", "Admin panel"]];
  return (
    <div className="gate">
      <div className="gate-card">
        <span className="brand-mark">N</span>
        <h1>No access</h1>
        <p>You are signed in as {user.name} ({user.role}). Your role can't open this screen.</p>
        {links.filter(([k]) => canOpen(k, user)).map(([k, to, label]) => <Link key={k} className="btn block" to={to}>{label}</Link>)}
        <button className="btn block" onClick={signOut}>Sign out</button>
      </div>
    </div>
  );
}
