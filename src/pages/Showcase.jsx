import { Link } from "react-router-dom";
import { useState } from "react";
import { ensureDemoUser } from "../lib/auth";
import { useTitle } from "../lib/hooks";

// Side-by-side demo for presenting to clients: a live customer phone and a live kitchen
// screen. Orders placed on the phone appear on the kitchen screen instantly.
export default function Showcase() {
  useTitle("Neksus Dine");
  // The embedded kitchen screen needs staff access for this demo session only.
  useState(() => { ensureDemoUser("kitchen"); return null; });

  return (
    <div className="page">
      <header className="bar">
        <div className="brand">
          <span className="brand-mark">N</span>
          <span className="brand-name">Neksus Dine</span>
        </div>
        <nav className="bar-links" aria-label="Demo links">
          <Link to="/t/7">Customer menu</Link>
          <Link to="/waiter">Waiter</Link>
          <Link to="/kitchen">Kitchen</Link>
          <Link to="/admin">Admin</Link>
        </nav>
      </header>
      <main className="stage">
        <section className="col-phone">
          <h2 className="label">Customer view</h2>
          <div className="phone">
            <iframe className="phone-frame" src="/t/7" title="Customer menu for Table 7" />
          </div>
        </section>
        <section className="col-kds">
          <h2 className="label">Kitchen screen</h2>
          <iframe className="kds-frame" src="/kitchen" title="Kitchen screen" />
          <p className="hint">Add dishes on the phone and place an order. It appears on the kitchen screen right away.</p>
        </section>
      </main>
    </div>
  );
}
