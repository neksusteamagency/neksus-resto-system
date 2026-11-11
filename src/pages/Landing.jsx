import { useEffect } from "react";
import { Link } from "react-router-dom";
import { useStore, store } from "../lib/store";
import { useAuth, canOpen, signOut } from "../lib/auth";
import { REMOTE } from "../lib/config";
import { ROLE_LABEL } from "../lib/format";
import { useTitle } from "../lib/hooks";

const SCREENS = [
  { screen: "waiter", to: "/waiter", title: "Waiter", hint: "Take orders and payments", icon: "W" },
  { screen: "kitchen", to: "/kitchen", title: "Kitchen", hint: "See and prepare orders", icon: "K" },
  { screen: "admin", to: "/admin", title: "Admin", hint: "Menu, stock, tables and settings", icon: "A" },
];

// The front door for staff: choose where you are working, then sign in with your PIN.
export default function Landing() {
  const { settings } = useStore();
  const { user } = useAuth();
  const name = settings.name || "Neksus Dine";
  useTitle(`${name} · Staff`);

  // Load the restaurant name (Supabase mode only).
  useEffect(() => { if (REMOTE) store.loadMenu("takeaway").catch(() => {}); }, []);

  const options = user ? SCREENS.filter((s) => canOpen(s.screen, user)) : SCREENS;

  return (
    <div className="landing">
      <div className="landing-card">
        <span className="brand-mark big">{name.slice(0, 1).toUpperCase()}</span>
        <h1>{name}</h1>
        {user ? (
          <p className="muted">Signed in as <strong>{user.name}</strong> ({ROLE_LABEL[user.role] || user.role}). Where are you working?</p>
        ) : (
          <p className="muted">Staff sign in. Choose where you are working.</p>
        )}

        <div className="role-grid">
          {options.map((s) => (
            <Link key={s.screen} to={s.to} className="role-card">
              <span className="role-icon" aria-hidden="true">{s.icon}</span>
              <span><strong>{s.title}</strong><small>{s.hint}</small></span>
            </Link>
          ))}
        </div>

        {user && <button className="btn block" onClick={signOut}>Sign out</button>}

        <p className="landing-foot">
          Guests: scan the QR code on your table to order. <Link to="/t/takeaway">Order takeaway</Link>
        </p>
      </div>
    </div>
  );
}
