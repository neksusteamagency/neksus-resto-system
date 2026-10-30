import { useEffect, useMemo, useState } from "react";
import { NavLink, Route, Routes, Link, Navigate } from "react-router-dom";
import QRCode from "qrcode";
import { useStore, store } from "../lib/store";
import {
  money, parsePrice, centsToInput, startOfToday, dateTimeText, timeText, STATIONS, STATUS_LABEL, sum,
} from "../lib/format";
import { useTitle, useToast } from "../lib/hooks";
import { Sheet, Toast, Empty } from "../components/ui";

export default function Admin({ onSignOut }) {
  const { settings } = useStore();
  useTitle(`Admin · ${settings.name}`);
  const { toast, show, dismiss } = useToast(4000);
  const links = [
    ["/admin", "Dashboard", true],
    ["/admin/orders", "Orders"],
    ["/admin/menu", "Menu"],
    ["/admin/tables", "Tables & QR"],
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
            <NavLink key={to} to={to} end={end} className={({ isActive }) => (isActive ? "nav active" : "nav")}>
              {label}
            </NavLink>
          ))}
        </nav>
        <div className="side-foot">
          <Link className="nav" to="/kitchen">Kitchen screen</Link>
          <Link className="nav" to="/t/1" target="_blank">Preview menu</Link>
          <button className="nav" onClick={onSignOut}>Sign out</button>
        </div>
      </aside>
      <main className="content">
        <Routes>
          <Route index element={<Dashboard />} />
          <Route path="orders" element={<Orders show={show} />} />
          <Route path="menu" element={<MenuAdmin show={show} />} />
          <Route path="tables" element={<Tables show={show} />} />
          <Route path="settings" element={<Settings show={show} />} />
          <Route path="*" element={<Navigate to="/admin" replace />} />
        </Routes>
      </main>
      <Toast toast={toast} onDismiss={dismiss} />
    </div>
  );
}

function PageHead({ title, children }) {
  return (
    <div className="page-head">
      <h1>{title}</h1>
      <div className="page-actions">{children}</div>
    </div>
  );
}

const StatusPill = ({ status }) => <span className={`pill ${status}`}>{STATUS_LABEL[status]}</span>;

/* ---------------- Dashboard ---------------- */
function Dashboard() {
  const { orders, settings } = useStore();
  const sym = settings.currency;
  const data = useMemo(() => {
    const since = startOfToday();
    const today = orders.filter((o) => o.createdAt >= since && o.status !== "cancelled");
    const revenue = sum(today, (o) => o.total);
    const done = today.filter((o) => o.readyAt);
    const prep = done.length ? Math.max(1, Math.round(sum(done, (o) => o.readyAt - o.createdAt) / done.length / 60000)) : null;
    const byItem = new Map();
    for (const o of today) for (const l of o.items) byItem.set(l.name, (byItem.get(l.name) || 0) + l.qty);
    const top = [...byItem.entries()].sort((a, b) => b[1] - a[1]).slice(0, 5);
    const hour = new Date().getHours();
    const hours = Array.from({ length: 12 }, (_, i) => {
      const h = hour - 11 + i;
      return { h, n: h < 0 ? 0 : today.filter((o) => new Date(o.createdAt).getHours() === h).length };
    }).filter((x) => x.h >= 0);
    return {
      count: today.length,
      revenue,
      avg: today.length ? Math.round(revenue / today.length) : 0,
      prep,
      active: orders.filter((o) => ["new", "preparing", "ready"].includes(o.status)).length,
      top,
      hours,
      max: Math.max(1, ...hours.map((x) => x.n)),
    };
  }, [orders]);

  return (
    <>
      <PageHead title="Dashboard" />
      <div className="kpis">
        <Kpi label="Revenue today" value={money(data.revenue, sym)} />
        <Kpi label="Orders today" value={data.count} />
        <Kpi label="Average order" value={money(data.avg, sym)} />
        <Kpi label="Average prep time" value={data.prep ? `${data.prep} min` : "–"} />
        <Kpi label="Active right now" value={data.active} />
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
            <ol className="top-list">
              {data.top.map(([name, qty]) => (
                <li key={name}><span>{name}</span><strong>{qty}</strong></li>
              ))}
            </ol>
          )}
        </section>
      </div>
    </>
  );
}
const Kpi = ({ label, value }) => (
  <div className="kpi"><span>{label}</span><strong>{value}</strong></div>
);

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

  const act = (o, next) => {
    const r = store.setOrderStatus(o.id, next);
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
            <thead><tr><th>Order</th><th>Time</th><th>Table</th><th>Items</th><th className="r">Total</th><th>Status</th></tr></thead>
            <tbody>
              {list.slice(0, limit).map((o) => (
                <FragmentRow key={o.id} o={o} sym={sym} isOpen={open === o.id} toggle={() => setOpen(open === o.id ? null : o.id)} act={act} NEXT={NEXT} />
              ))}
            </tbody>
          </table>
        </div>
      )}
      {list.length > limit && <button className="btn" onClick={() => setLimit((l) => l + 30)}>Show more</button>}
    </>
  );
}

function FragmentRow({ o, sym, isOpen, toggle, act, NEXT }) {
  const count = sum(o.items, (l) => l.qty);
  return (
    <>
      <tr className="row-click" onClick={toggle} tabIndex={0} onKeyDown={(e) => { if (e.key === "Enter" || e.key === " ") { e.preventDefault(); toggle(); } }} aria-expanded={isOpen}>
        <td><strong>#{o.number}</strong></td>
        <td>{dateTimeText(o.createdAt)}</td>
        <td>{o.tableLabel}</td>
        <td>{count} item{count === 1 ? "" : "s"}</td>
        <td className="r">{money(o.total, sym)}</td>
        <td><StatusPill status={o.status} /></td>
      </tr>
      {isOpen && (
        <tr className="detail"><td colSpan={6}>
          <div className="detail-grid">
            <ul>
              {o.items.map((l, i) => (
                <li key={i}>
                  <span>{l.qty}× {l.name}{l.extras.length > 0 && <small> + {l.extras.map((e) => e.name).join(", ")}</small>}{l.note && <small className="note"> “{l.note}”</small>}</span>
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

/* ---------------- Menu ---------------- */
function MenuAdmin({ show }) {
  const { items, categories, settings } = useStore();
  const sym = settings.currency;
  const [q, setQ] = useState("");
  const [edit, setEdit] = useState(null); // item object, or {} for new
  const [catsOpen, setCatsOpen] = useState(false);
  const cats = [...categories].sort((a, b) => a.order - b.order);
  const t = q.trim().toLowerCase();

  const remove = (i) => {
    if (window.confirm(`Delete “${i.name}”? Past orders keep their record of it.`)) { store.deleteItem(i.id); show("Dish deleted"); }
  };

  return (
    <>
      <PageHead title="Menu">
        <button className="btn" onClick={() => setCatsOpen(true)}>Categories</button>
        <button className="btn primary" onClick={() => setEdit({})} disabled={cats.length === 0} title={cats.length === 0 ? "Create a category first" : undefined}>Add dish</button>
      </PageHead>
      <div className="filters">
        <input type="search" placeholder="Search dishes" value={q} onChange={(e) => setQ(e.target.value)} aria-label="Search dishes" />
      </div>
      {cats.length === 0 && <Empty title="No categories yet">Create a category such as Starters, then add dishes to it.</Empty>}
      {cats.map((c) => {
        const list = items.filter((i) => i.categoryId === c.id && (!t || `${i.name} ${i.description}`.toLowerCase().includes(t)));
        if (t && list.length === 0) return null;
        return (
          <section key={c.id} className="panel flush">
            <h2 className="panel-title">{c.name} <span>{list.length}</span></h2>
            {list.length === 0 ? <p className="muted pad">No dishes in this category yet.</p> : (
              <ul className="menu-rows">
                {list.map((i) => (
                  <li key={i.id}>
                    <div className="mr-main">
                      <strong>{i.name}{i.popular && <span className="tag">Popular</span>}</strong>
                      <small>{i.description || "No description"}</small>
                    </div>
                    <span className="mr-station">{STATIONS.find((s) => s.id === i.station)?.label}</span>
                    <b className="mr-price">{money(i.price, sym)}</b>
                    <label className="switch" title={i.available ? "Available" : "Sold out"}>
                      <input type="checkbox" checked={i.available} onChange={(e) => store.setItemAvailable(i.id, e.target.checked)} aria-label={`${i.name} available`} />
                      <span />
                    </label>
                    <button className="btn sm" onClick={() => setEdit(i)}>Edit</button>
                    <button className="btn sm danger-text" onClick={() => remove(i)}>Delete</button>
                  </li>
                ))}
              </ul>
            )}
          </section>
        );
      })}
      {edit && <ItemForm item={edit} cats={cats} sym={sym} onClose={() => setEdit(null)} onSaved={(m) => { setEdit(null); show(m); }} />}
      {catsOpen && <Categories cats={cats} items={items} onClose={() => setCatsOpen(false)} show={show} />}
    </>
  );
}

function ItemForm({ item, cats, sym, onClose, onSaved }) {
  const isNew = !item.id;
  const [f, setF] = useState({
    name: item.name || "",
    description: item.description || "",
    price: item.price != null ? centsToInput(item.price) : "",
    categoryId: item.categoryId || cats[0]?.id || "",
    station: item.station || "kitchen",
    popular: !!item.popular,
    available: item.available !== false,
    extras: (item.extras || []).map((e) => ({ name: e.name, price: centsToInput(e.price) })),
  });
  const [err, setErr] = useState("");
  const set = (k, v) => setF((x) => ({ ...x, [k]: v }));
  const setExtra = (i, k, v) => set("extras", f.extras.map((e, idx) => (idx === i ? { ...e, [k]: v } : e)));

  const save = (e) => {
    e.preventDefault();
    const price = parsePrice(f.price);
    if (price === null) { setErr(`Enter a valid price, for example 7.50.`); return; }
    const extras = [];
    for (const x of f.extras) {
      if (!x.name.trim() && !String(x.price).trim()) continue;
      const p = parsePrice(x.price);
      if (!x.name.trim() || p === null) { setErr("Each extra needs a name and a valid price."); return; }
      extras.push({ name: x.name, price: p });
    }
    const res = store.upsertItem({ ...f, id: item.id, price, extras });
    if (!res.ok) { setErr(res.error); return; }
    onSaved(isNew ? "Dish added" : "Dish saved");
  };

  return (
    <Sheet
      title={isNew ? "Add dish" : "Edit dish"}
      onClose={onClose}
      wide
      footer={<><button className="btn" onClick={onClose}>Cancel</button><button className="btn primary" form="item-form">Save dish</button></>}
    >
      <form id="item-form" onSubmit={save} className="form">
        <label className="field"><span>Name</span><input autoFocus value={f.name} onChange={(e) => set("name", e.target.value)} maxLength={60} required /></label>
        <label className="field"><span>Description</span><input value={f.description} onChange={(e) => set("description", e.target.value)} maxLength={120} /></label>
        <div className="grid2">
          <label className="field"><span>Price ({sym})</span><input inputMode="decimal" value={f.price} onChange={(e) => set("price", e.target.value)} placeholder="0.00" required /></label>
          <label className="field"><span>Category</span>
            <select value={f.categoryId} onChange={(e) => set("categoryId", e.target.value)}>{cats.map((c) => <option key={c.id} value={c.id}>{c.name}</option>)}</select>
          </label>
        </div>
        <label className="field"><span>Kitchen station</span>
          <select value={f.station} onChange={(e) => set("station", e.target.value)}>{STATIONS.map((s) => <option key={s.id} value={s.id}>{s.label}</option>)}</select>
        </label>
        <div className="checks">
          <label className="check"><input type="checkbox" checked={f.popular} onChange={(e) => set("popular", e.target.checked)} /><span>Show in Popular</span></label>
          <label className="check"><input type="checkbox" checked={f.available} onChange={(e) => set("available", e.target.checked)} /><span>Available to order</span></label>
        </div>
        <fieldset className="extras-edit">
          <legend>Extras (optional)</legend>
          {f.extras.map((x, i) => (
            <div key={i} className="extra-row">
              <input placeholder="Extra cheese" value={x.name} maxLength={40} onChange={(e) => setExtra(i, "name", e.target.value)} aria-label="Extra name" />
              <input placeholder="1.50" inputMode="decimal" value={x.price} onChange={(e) => setExtra(i, "price", e.target.value)} aria-label="Extra price" />
              <button type="button" className="btn sm danger-text" onClick={() => set("extras", f.extras.filter((_, idx) => idx !== i))}>Remove</button>
            </div>
          ))}
          <button type="button" className="btn sm" onClick={() => set("extras", [...f.extras, { name: "", price: "" }])}>Add extra</button>
        </fieldset>
        {err && <div className="form-error" role="alert">{err}</div>}
      </form>
    </Sheet>
  );
}

function Categories({ cats, items, onClose, show }) {
  const [name, setName] = useState("");
  const [editing, setEditing] = useState(null); // { id, name }
  const [err, setErr] = useState("");
  const run = (res, msg) => { if (!res.ok) setErr(res.error); else { setErr(""); if (msg) show(msg); } return res.ok; };

  return (
    <Sheet title="Categories" onClose={onClose}>
      <ul className="cat-list">
        {cats.map((c, i) => (
          <li key={c.id}>
            {editing?.id === c.id ? (
              <form onSubmit={(e) => { e.preventDefault(); if (run(store.upsertCategory(editing), "Category renamed")) setEditing(null); }}>
                <input autoFocus value={editing.name} maxLength={30} onChange={(e) => setEditing({ ...editing, name: e.target.value })} aria-label="Category name" />
                <button className="btn sm primary">Save</button>
                <button type="button" className="btn sm" onClick={() => setEditing(null)}>Cancel</button>
              </form>
            ) : (
              <>
                <span>{c.name} <small>{items.filter((x) => x.categoryId === c.id).length} dishes</small></span>
                <span className="cat-actions">
                  <button className="btn sm" disabled={i === 0} onClick={() => store.moveCategory(c.id, -1)} aria-label={`Move ${c.name} up`}>↑</button>
                  <button className="btn sm" disabled={i === cats.length - 1} onClick={() => store.moveCategory(c.id, 1)} aria-label={`Move ${c.name} down`}>↓</button>
                  <button className="btn sm" onClick={() => setEditing({ id: c.id, name: c.name })}>Rename</button>
                  <button className="btn sm danger-text" onClick={() => window.confirm(`Delete category “${c.name}”?`) && run(store.deleteCategory(c.id), "Category deleted")}>Delete</button>
                </span>
              </>
            )}
          </li>
        ))}
      </ul>
      <form className="inline-form" onSubmit={(e) => { e.preventDefault(); if (run(store.upsertCategory({ name }), "Category added")) setName(""); }}>
        <input placeholder="New category name" value={name} maxLength={30} onChange={(e) => { setName(e.target.value); setErr(""); }} aria-label="New category name" />
        <button className="btn primary" disabled={!name.trim()}>Add category</button>
      </form>
      {err && <div className="form-error" role="alert">{err}</div>}
    </Sheet>
  );
}

/* ---------------- Tables ---------------- */
function QRImage({ url, label, size = 220 }) {
  const [src, setSrc] = useState("");
  useEffect(() => {
    let live = true;
    QRCode.toDataURL(url, { margin: 1, width: size, errorCorrectionLevel: "M" }).then((d) => live && setSrc(d)).catch(() => live && setSrc(""));
    return () => { live = false; };
  }, [url, size]);
  return src ? <img src={src} alt={`QR code for ${label}`} width={size} height={size} /> : <div className="qr-ph" style={{ width: size, height: size }} />;
}

function Tables({ show }) {
  const { tables, settings, orders } = useStore();
  const [label, setLabel] = useState("");
  const [err, setErr] = useState("");
  const base = (settings.publicUrl || window.location.origin).replace(/\/+$/, "");
  const urlFor = (t) => `${base}/t/${t.id}`;

  const add = (e) => {
    e.preventDefault();
    const r = store.addTable(label);
    if (!r.ok) { setErr(r.error); return; }
    setLabel(""); setErr(""); show("Table added");
  };
  const copy = async (t) => {
    try { await navigator.clipboard.writeText(urlFor(t)); show("Link copied"); } catch { show(urlFor(t)); }
  };
  const download = async (t) => {
    const data = await QRCode.toDataURL(urlFor(t), { margin: 2, width: 900, errorCorrectionLevel: "M" });
    const a = document.createElement("a");
    a.href = data; a.download = `qr-${t.id}.png`; a.click();
  };
  const remove = (t) => {
    if (!window.confirm(`Remove ${t.label}? Its printed QR code will stop working.`)) return;
    const r = store.deleteTable(t.id);
    show(r.ok ? "Table removed" : r.error);
  };
  const busy = (t) => orders.some((o) => o.tableId === t.id && ["new", "preparing", "ready"].includes(o.status));

  return (
    <>
      <PageHead title="Tables & QR codes">
        <button className="btn" onClick={() => window.print()}>Print all QR codes</button>
      </PageHead>
      {!settings.publicUrl && (
        <div className="banner warn">
          QR codes currently point to <b>{window.location.origin}</b>. Before printing, set your public website address in Settings so they work for customers.
        </div>
      )}
      <form className="inline-form" onSubmit={add}>
        <input placeholder="New table name, e.g. Terrace 1" value={label} maxLength={30} onChange={(e) => { setLabel(e.target.value); setErr(""); }} aria-label="New table name" />
        <button className="btn primary" disabled={!label.trim()}>Add table</button>
      </form>
      {err && <div className="form-error" role="alert">{err}</div>}
      <div className="qr-grid print-area">
        {tables.map((t) => (
          <article key={t.id} className="qr-card">
            <h3>{settings.name}</h3>
            <QRImage url={urlFor(t)} label={t.label} />
            <strong>{t.label}</strong>
            <small className="print-only">Scan to view the menu and order</small>
            <div className="qr-actions no-print">
              <a className="btn sm" href={urlFor(t)} target="_blank" rel="noreferrer">Open</a>
              <button className="btn sm" onClick={() => copy(t)}>Copy link</button>
              <button className="btn sm" onClick={() => download(t)}>Download</button>
              {t.id !== "takeaway" && <button className="btn sm danger-text" onClick={() => remove(t)} disabled={busy(t)} title={busy(t) ? "This table has an active order" : undefined}>Remove</button>}
            </div>
          </article>
        ))}
      </div>
    </>
  );
}

/* ---------------- Settings ---------------- */
function Settings({ show }) {
  const { settings } = useStore();
  const [f, setF] = useState({ ...settings, taxRate: String(settings.taxRate), serviceRate: String(settings.serviceRate) });
  const [err, setErr] = useState("");
  const set = (k, v) => { setF((x) => ({ ...x, [k]: v })); setErr(""); };
  const pct = (v) => { const n = Number(String(v).replace(",", ".")); return Number.isFinite(n) && n >= 0 && n <= 100 ? n : null; };

  const save = (e) => {
    e.preventDefault();
    const tax = pct(f.taxRate), service = pct(f.serviceRate);
    if (!f.name.trim()) return setErr("Enter the restaurant name.");
    if (!f.currency.trim()) return setErr("Enter a currency symbol.");
    if (tax === null || service === null) return setErr("VAT and service must be numbers between 0 and 100.");
    if (!/^\d{4,8}$/.test(f.kitchenPin) || !/^\d{4,8}$/.test(f.adminPin)) return setErr("PINs must be 4 to 8 digits.");
    if (f.kitchenPin === f.adminPin) return setErr("Use a different PIN for the kitchen and the admin panel.");
    let url = f.publicUrl.trim();
    if (url && !/^https?:\/\/[^\s]+$/i.test(url)) return setErr("The public website address must start with http:// or https://");
    store.updateSettings({
      name: f.name.trim(), openText: f.openText.trim(), currency: f.currency.trim().slice(0, 3),
      taxRate: tax, serviceRate: service, orderingOpen: f.orderingOpen, publicUrl: url.replace(/\/+$/, ""),
      kitchenPin: f.kitchenPin, adminPin: f.adminPin,
    });
    show("Settings saved");
  };

  return (
    <>
      <PageHead title="Settings" />
      <form className="panel form settings" onSubmit={save}>
        <label className="check big">
          <input type="checkbox" checked={f.orderingOpen} onChange={(e) => set("orderingOpen", e.target.checked)} />
          <span>Accept orders from customers<small>Turn this off during a rush or when the kitchen is closed. Customers can still browse.</small></span>
        </label>
        <div className="grid2">
          <label className="field"><span>Restaurant name</span><input value={f.name} maxLength={40} onChange={(e) => set("name", e.target.value)} /></label>
          <label className="field"><span>Opening hours text</span><input value={f.openText} maxLength={40} onChange={(e) => set("openText", e.target.value)} placeholder="Open until 11:00 PM" /></label>
        </div>
        <div className="grid3">
          <label className="field"><span>Currency symbol</span><input value={f.currency} maxLength={3} onChange={(e) => set("currency", e.target.value)} /></label>
          <label className="field"><span>VAT (%)</span><input inputMode="decimal" value={f.taxRate} onChange={(e) => set("taxRate", e.target.value)} /></label>
          <label className="field"><span>Service charge (%)</span><input inputMode="decimal" value={f.serviceRate} onChange={(e) => set("serviceRate", e.target.value)} /></label>
        </div>
        <label className="field"><span>Public website address (used in QR codes)</span><input value={f.publicUrl} onChange={(e) => set("publicUrl", e.target.value)} placeholder="https://menu.yourrestaurant.com" /></label>
        <div className="grid2">
          <label className="field"><span>Kitchen PIN</span><input inputMode="numeric" value={f.kitchenPin} onChange={(e) => set("kitchenPin", e.target.value.replace(/\D/g, ""))} maxLength={8} /></label>
          <label className="field"><span>Admin PIN</span><input inputMode="numeric" value={f.adminPin} onChange={(e) => set("adminPin", e.target.value.replace(/\D/g, ""))} maxLength={8} /></label>
        </div>
        {err && <div className="form-error" role="alert">{err}</div>}
        <div className="form-actions"><button className="btn primary">Save settings</button></div>
      </form>
      <section className="panel danger-zone">
        <h2>Demo data</h2>
        <p className="muted">Restore the sample menu, tables and orders. This removes everything you have added in this browser.</p>
        <button className="btn danger" onClick={() => window.confirm("Reset all data to the sample restaurant?") && (store.resetDemo(), show("Sample data restored"))}>Reset demo data</button>
      </section>
    </>
  );
}
