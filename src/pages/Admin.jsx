import { useMemo, useState } from "react";
import { NavLink, Route, Routes, Link, Navigate } from "react-router-dom";
import { useStore, store } from "../lib/store";
import { REMOTE } from "../lib/config";
import { money, startOfToday, dateTimeText, timeText, STATUS_LABEL, sum, qtyText } from "../lib/format";
import { billOf, OPEN_TAB } from "../lib/billing";
import { canOpen } from "../lib/auth";
import { useTitle, useToast } from "../lib/hooks";
import { Toast, Empty } from "../components/ui";
import { PageHead, StatusPill, Kpi } from "./admin/shared";
import MenuAdmin from "./admin/MenuAdmin";
import Inventory from "./admin/Inventory";
import Tables from "./admin/Tables";
import Settings from "./admin/Settings";
import Staff from "./admin/Staff";

export default function Admin({ user, onSignOut }) {
  const { settings } = useStore();
  useTitle(`Admin · ${settings.name}`);
  const { toast, show, dismiss } = useToast(4000);
  const isOwner = user.role === "owner";
  const links = [
    ["/admin", "Dashboard", true],
    ["/admin/orders", "Orders"],
    ["/admin/menu", "Menu"],
    ["/admin/inventory", "Inventory"],
    ["/admin/tables", "Tables & QR"],
    ...(REMOTE ? [["/admin/staff", "Staff"]] : []),
    ["/admin/settings", "Settings"],
  ];
  return (
    <div className="admin">
      <aside className="side">
        <div className="brand">
          <span className="brand-mark">N</span>
          <span className="brand-name">Neksus Dine</span>
        </div>
        <nav aria-label="Admin">
          {links.map(([to, label, end]) => (
            <NavLink key={to} to={to} end={end} className={({ isActive }) => (isActive ? "nav active" : "nav")}>{label}</NavLink>
          ))}
        </nav>
        <div className="side-foot">
          {canOpen("waiter", user) && <Link className="nav" to="/waiter">Waiter screen</Link>}
          <Link className="nav" to="/kitchen">Kitchen screen</Link>
          <Link className="nav" to="/t/1" target="_blank">Preview menu</Link>
          <button className="nav" onClick={onSignOut}>Sign out ({user.name})</button>
        </div>
      </aside>
      <main className="content">
        <Routes>
          <Route index element={<Dashboard />} />
          <Route path="orders" element={<Orders show={show} />} />
          <Route path="menu" element={<MenuAdmin show={show} />} />
          <Route path="inventory" element={<Inventory show={show} />} />
          <Route path="tables" element={<Tables show={show} />} />
          {REMOTE && <Route path="staff" element={<Staff show={show} user={user} />} />}
          <Route path="settings" element={<Settings show={show} />} />
          <Route path="*" element={<Navigate to="/admin" replace />} />
        </Routes>
      </main>
      <Toast toast={toast} onDismiss={dismiss} />
    </div>
  );
}

/* ---------------- Dashboard ---------------- */
function Dashboard() {
  const { orders, tabs, ingredients, audit, settings } = useStore();
  const sym = settings.currency;
  const data = useMemo(() => {
    const since = startOfToday();
    const today = orders.filter((o) => o.createdAt >= since && o.status !== "cancelled");
    const payments = tabs.flatMap((t) => t.payments).filter((p) => p.at >= since);
    const sales = sum(payments, (p) => p.amount);
    const cash = sum(payments.filter((p) => p.method === "cash"), (p) => p.amount);
    const card = sum(payments.filter((p) => p.method === "card"), (p) => p.amount);
    const openTabs = tabs.filter((t) => OPEN_TAB.includes(t.status));
    const openValue = sum(openTabs, (t) => billOf(t, orders).due);
    const done = today.filter((o) => o.readyAt);
    const prep = done.length ? Math.max(1, Math.round(sum(done, (o) => o.readyAt - o.createdAt) / done.length / 60000)) : null;
    const byItem = new Map();
    for (const o of today) for (const l of o.items) if (!l.voided) byItem.set(l.name, (byItem.get(l.name) || 0) + l.qty);
    const top = [...byItem.entries()].sort((a, b) => b[1] - a[1]).slice(0, 5);
    const hour = new Date().getHours();
    const hours = Array.from({ length: 12 }, (_, i) => {
      const h = hour - 11 + i;
      return { h, n: h < 0 ? 0 : today.filter((o) => new Date(o.createdAt).getHours() === h).length };
    }).filter((x) => x.h >= 0);
    return {
      count: today.length, sales, cash, card, openCount: openTabs.length, openValue, prep, top, hours,
      max: Math.max(1, ...hours.map((x) => x.n)),
      low: ingredients.filter((g) => g.onHand <= g.lowAt || g.onHand <= 0).sort((a, b) => a.onHand - b.onHand),
    };
  }, [orders, tabs, ingredients]);
  const recent = [...audit].reverse().filter((a) => ["line.void", "discount.set", "order.cancel", "stock.waste"].includes(a.action)).slice(0, 6);
  const LABEL = { "line.void": "Item removed", "discount.set": "Discount", "order.cancel": "Order cancelled", "stock.waste": "Waste logged" };

  return (
    <>
      <PageHead title="Dashboard" />
      <div className="kpis">
        <Kpi label="Sales today" value={money(data.sales, sym)} hint={`Cash ${money(data.cash, sym)} · Card ${money(data.card, sym)}`} />
        <Kpi label="Orders today" value={data.count} />
        <Kpi label="Open bills" value={data.openCount} hint={`${money(data.openValue, sym)} unpaid`} />
        <Kpi label="Average prep time" value={data.prep ? `${data.prep} min` : "–"} />
        <Kpi label="Low stock" value={data.low.length} hint={data.low.length ? "Needs restocking" : "All good"} />
      </div>
      <div className="two-col">
        <section className="panel">
          <h2>Orders per hour</h2>
          {data.count === 0 ? <Empty title="No orders yet today" /> : (
            <div className="bars" role="img" aria-label="Orders per hour">
              {data.hours.map((x) => (
                <div key={x.h} className="bar-col">
                  <span className="bar-val">{x.n || ""}</span>
                  <div className="bar-fill" style={{ height: `${(x.n / data.max) * 100}%` }} />
                  <span className="bar-lbl">{x.h % 12 || 12}{x.h < 12 ? "a" : "p"}</span>
                </div>
              ))}
            </div>
          )}
        </section>
        <section className="panel">
          <h2>Top dishes today</h2>
          {data.top.length === 0 ? <Empty title="No sales yet today" /> : (
            <ol className="top-list">{data.top.map(([name, qty]) => <li key={name}><span>{name}</span><strong>{qty}</strong></li>)}</ol>
          )}
        </section>
      </div>
      <div className="two-col even">
        <section className="panel">
          <h2>Low stock <Link className="panel-link" to="/admin/inventory">Open inventory</Link></h2>
          {data.low.length === 0 ? <Empty title="Everything is stocked" /> : (
            <ol className="top-list">
              {data.low.slice(0, 6).map((g) => (
                <li key={g.id}><span>{g.name}</span><strong className={g.onHand <= 0 ? "err-text" : ""}>{qtyText(g.onHand)} {g.unit}</strong></li>
              ))}
            </ol>
          )}
        </section>
        <section className="panel">
          <h2>Recent staff actions</h2>
          {recent.length === 0 ? <Empty title="Nothing to review" /> : (
            <ol className="top-list">
              {recent.map((a) => <li key={a.id}><span>{LABEL[a.action]}: {a.detail}<small className="muted"> · {a.by}, {timeText(a.at)}</small></span></li>)}
            </ol>
          )}
        </section>
      </div>
    </>
  );
}

/* ---------------- Orders ---------------- */
function Orders({ show }) {
  const { orders, settings } = useStore();
  const sym = settings.currency;
  const [status, setStatus] = useState("all");
  const [range, setRange] = useState("today");
  const [q, setQ] = useState("");
  const [open, setOpen] = useState(null);
  const [limit, setLimit] = useState(30);

  const since = startOfToday();
  const list = useMemo(() => {
    const t = q.trim().toLowerCase().replace("#", "");
    return orders
      .filter((o) => (range === "today" ? o.createdAt >= since : true))
      .filter((o) => (status === "all" ? true : status === "active" ? ["new", "preparing", "ready"].includes(o.status) : o.status === status))
      .filter((o) => !t || String(o.number).includes(t) || o.tableLabel.toLowerCase().includes(t))
      .sort((a, b) => b.createdAt - a.createdAt);
  }, [orders, status, range, q, since]);

  const act = async (o, next) => {
    const r = await store.setOrderStatus(o.id, next);
    show(r.ok ? `Order #${o.number} updated` : r.error);
  };
  const NEXT = { new: "preparing", preparing: "ready", ready: "served" };

  return (
    <>
      <PageHead title="Orders" />
      <div className="filters">
        <input type="search" placeholder="Search by number or table" value={q} onChange={(e) => setQ(e.target.value)} aria-label="Search orders" />
        <select value={status} onChange={(e) => setStatus(e.target.value)} aria-label="Status">
          <option value="all">All statuses</option>
          <option value="active">Active</option>
          <option value="served">Served</option>
          <option value="cancelled">Cancelled</option>
        </select>
        <select value={range} onChange={(e) => setRange(e.target.value)} aria-label="Date range">
          <option value="today">Today</option>
          <option value="all">All stored orders</option>
        </select>
      </div>
      {list.length === 0 ? <Empty title="No orders match">Change the filters, or wait for the next order.</Empty> : (
        <div className="table-wrap">
          <table className="data">
            <thead><tr><th>Order</th><th>Time</th><th>Table</th><th>Taken by</th><th>Items</th><th className="r">Total</th><th>Status</th></tr></thead>
            <tbody>
              {list.slice(0, limit).map((o) => (
                <OrderRow key={o.id} o={o} sym={sym} isOpen={open === o.id} toggle={() => setOpen(open === o.id ? null : o.id)} act={act} NEXT={NEXT} />
              ))}
            </tbody>
          </table>
        </div>
      )}
      {list.length > limit && <button className="btn" onClick={() => setLimit((l) => l + 30)}>Show more</button>}
    </>
  );
}

function OrderRow({ o, sym, isOpen, toggle, act, NEXT }) {
  const count = sum(o.items.filter((l) => !l.voided), (l) => l.qty);
  return (
    <>
      <tr className="row-click" onClick={toggle} tabIndex={0} onKeyDown={(e) => { if (e.key === "Enter" || e.key === " ") { e.preventDefault(); toggle(); } }} aria-expanded={isOpen}>
        <td><strong>#{o.number}</strong></td>
        <td>{dateTimeText(o.createdAt)}</td>
        <td>{o.tableLabel}</td>
        <td>{o.placedBy || "Guest"}</td>
        <td>{count} item{count === 1 ? "" : "s"}</td>
        <td className="r">{money(o.total, sym)}</td>
        <td><StatusPill status={o.status} /></td>
      </tr>
      {isOpen && (
        <tr className="detail"><td colSpan={7}>
          <div className="detail-grid">
            <ul>
              {o.items.map((l, i) => (
                <li key={i} className={l.voided ? "voided" : ""}>
                  <span>{l.qty}× {l.name}{l.extras.length > 0 && <small> + {l.extras.map((e) => e.name).join(", ")}</small>}{l.note && <small className="note"> “{l.note}”</small>}{l.voided && <small className="err-text"> removed by {l.voided.by}: {l.voided.reason}</small>}</span>
                  <span>{money(l.total, sym)}</span>
                </li>
              ))}
              {o.note && <li className="order-note"><span>Note: {o.note}</span></li>}
            </ul>
            <div className="detail-side">
              <small>Subtotal {money(o.subtotal, sym)}{o.tax > 0 && ` · VAT ${money(o.tax, sym)}`}{o.service > 0 && ` · Service ${money(o.service, sym)}`}</small>
              <small>Placed {timeText(o.createdAt)}{o.readyAt && ` · ready ${timeText(o.readyAt)}`}{o.servedAt && ` · served ${timeText(o.servedAt)}`}</small>
              <div className="row-actions">
                {NEXT[o.status] && <button className="btn primary" onClick={() => act(o, NEXT[o.status])}>Mark as {STATUS_LABEL[NEXT[o.status]].toLowerCase()}</button>}
                {["new", "preparing", "ready"].includes(o.status) && (
                  <button className="btn danger" onClick={() => window.confirm(`Cancel order #${o.number}?`) && act(o, "cancelled")}>Cancel order</button>
                )}
              </div>
            </div>
          </div>
        </td></tr>
      )}
    </>
  );
}
