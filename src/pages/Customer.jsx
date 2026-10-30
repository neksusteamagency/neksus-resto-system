import { useEffect, useMemo, useState } from "react";
import { useParams } from "react-router-dom";
import { useStore, store } from "../lib/store";
import { money, initials, timeText, sum } from "../lib/format";
import { resolveLines, totals } from "../lib/pricing";
import { useTitle } from "../lib/hooks";
import { Sheet, Empty } from "../components/ui";

const cartKey = (t) => `neksus-dine:cart:${t}`;
const mineKey = (t) => `neksus-dine:mine:${t}`;
const read = (k, d) => {
  try { const v = JSON.parse(localStorage.getItem(k)); return Array.isArray(v) ? v : d; } catch { return d; }
};
const write = (k, v) => { try { localStorage.setItem(k, JSON.stringify(v)); } catch { /* ignore */ } };
const lineKey = (itemId, extras, note) =>
  [itemId, [...extras].sort().join("+"), note.trim().toLowerCase()].join("|");

export default function CustomerRoute() {
  const { tableId } = useParams();
  const { tables } = useStore();
  const table = tables.find((t) => t.id === tableId);
  if (!table) {
    return (
      <div className="customer">
        <div className="notice-page">
          <span className="rest-mark">?</span>
          <h1>We couldn’t find this table</h1>
          <p>The QR code may be out of date. Please ask a member of staff for help.</p>
        </div>
      </div>
    );
  }
  return <Customer key={table.id} table={table} />;
}

function Customer({ table }) {
  const { settings, categories, items, orders } = useStore();
  const sym = settings.currency;
  useTitle(`${settings.name} · ${table.label}`);

  const [cart, setCart] = useState(() => read(cartKey(table.id), []));
  const [mine, setMine] = useState(() => read(mineKey(table.id), []));
  const [chip, setChip] = useState(null);
  const [query, setQuery] = useState("");
  const [selected, setSelected] = useState(null);
  const [cartOpen, setCartOpen] = useState(false);
  const [view, setView] = useState("menu");
  const [orderNote, setOrderNote] = useState("");
  const [error, setError] = useState("");

  useEffect(() => write(cartKey(table.id), cart), [cart, table.id]);
  useEffect(() => write(mineKey(table.id), mine), [mine, table.id]);

  const canOrder = settings.orderingOpen;

  // ----- menu -----
  const chips = useMemo(() => {
    const cats = [...categories].sort((a, b) => a.order - b.order).filter((c) => items.some((i) => i.categoryId === c.id));
    return [...(items.some((i) => i.popular) ? [{ id: "popular", name: "Popular" }] : []), ...cats];
  }, [categories, items]);
  const activeChip = chips.some((c) => c.id === chip) ? chip : chips[0]?.id;
  const q = query.trim().toLowerCase();
  const visible = useMemo(() => {
    const list = items.filter((i) =>
      q ? `${i.name} ${i.description}`.toLowerCase().includes(q)
        : activeChip === "popular" ? i.popular : i.categoryId === activeChip
    );
    return [...list].sort((a, b) => Number(b.available) - Number(a.available));
  }, [items, q, activeChip]);

  // ----- cart -----
  const priced = useMemo(() => resolveLines(items, cart), [items, cart]);
  useEffect(() => {
    if (priced.lines.length !== cart.length) {
      const keep = new Set(priced.lines.map((l) => l.key));
      setCart((c) => c.filter((l) => keep.has(l.key)));
    }
  }, [priced, cart.length]);
  const count = sum(priced.lines, (l) => l.qty);
  const sums = totals(sum(priced.lines, (l) => l.total), settings);
  const soldOut = priced.problems;

  const addToCart = (item, qty, extras, note) => {
    const key = lineKey(item.id, extras, note);
    setCart((c) =>
      c.some((l) => l.key === key)
        ? c.map((l) => (l.key === key ? { ...l, qty: Math.min(50, l.qty + qty) } : l))
        : [...c, { key, itemId: item.id, qty, extras, note: note.trim() }]
    );
  };
  const changeQty = (key, d) =>
    setCart((c) => c.flatMap((l) => {
      if (l.key !== key) return [l];
      const qty = Math.min(50, l.qty + d);
      return qty <= 0 ? [] : [{ ...l, qty }];
    }));

  const place = () => {
    const res = store.placeOrder({ tableId: table.id, lines: cart, note: orderNote });
    if (!res.ok) { setError(res.error); return; }
    setMine((m) => [res.order.id, ...m].slice(0, 10));
    setCart([]);
    setOrderNote("");
    setError("");
    setCartOpen(false);
    setView("track");
  };

  // ----- my orders -----
  const myOrders = mine.map((id) => orders.find((o) => o.id === id)).filter(Boolean);
  const openOrders = myOrders.filter((o) => ["new", "preparing", "ready"].includes(o.status));

  if (view === "track") {
    return (
      <div className="customer">
        <Tracking
          orders={myOrders}
          sym={sym}
          takeaway={table.id === "takeaway"}
          onBack={() => setView("menu")}
        />
      </div>
    );
  }

  return (
    <div className="customer">
      <div className="screen-m">
        <div className="hero">
          <span className="rest-mark">{initials(settings.name).slice(0, 1) || "N"}</span>
          <div>
            <h1>{settings.name}</h1>
            <small>{settings.openText}</small>
          </div>
          <span className="table-pill">{table.label}</span>
        </div>

        {!canOrder && (
          <div className="banner warn" role="status">
            Ordering from the table is paused right now. You can still browse the menu, or ask a member of staff.
          </div>
        )}

        {openOrders.length > 0 && (
          <button className="banner track" onClick={() => setView("track")}>
            <span>
              Order #{openOrders[0].number}
              {openOrders.length > 1 ? ` and ${openOrders.length - 1} more` : ""}
            </span>
            <strong>Track order</strong>
          </button>
        )}

        <input
          className="search-m"
          type="search"
          placeholder="Search the menu…"
          value={query}
          onChange={(e) => setQuery(e.target.value)}
          aria-label="Search the menu"
        />

        {!q && (
          <div className="chips" role="tablist" aria-label="Menu categories">
            {chips.map((c) => (
              <button
                key={c.id}
                role="tab"
                aria-selected={c.id === activeChip}
                className={c.id === activeChip ? "chip active" : "chip"}
                onClick={() => setChip(c.id)}
              >
                {c.name}
              </button>
            ))}
          </div>
        )}

        {visible.length === 0 ? (
          <Empty title={q ? "No dishes match your search" : "Nothing here yet"}>
            {q ? "Try a different word, or clear the search." : "Check another category."}
          </Empty>
        ) : (
          <ul className="dishes">
            {visible.map((d) => (
              <li key={d.id} className={d.available ? "" : "soldout"}>
                <button className="dish-main" onClick={() => setSelected(d)} aria-label={`${d.name}, ${money(d.price, sym)}`}>
                  <span className="dish-thumb">{initials(d.name)}</span>
                  <span className="dish-info">
                    <strong>{d.name}</strong>
                    <small>{d.description}</small>
                    <b>{d.available ? money(d.price, sym) : "Sold out"}</b>
                  </span>
                </button>
                {d.available && (
                  <button
                    className="add"
                    disabled={!canOrder}
                    aria-label={`Add ${d.name}`}
                    onClick={() => (d.extras.length ? setSelected(d) : addToCart(d, 1, [], ""))}
                  >
                    +
                  </button>
                )}
              </li>
            ))}
          </ul>
        )}

        {count > 0 && (
          <div className="cart-dock">
            <button className="cart-bar" onClick={() => setCartOpen(true)}>
              <span className="count">{count}</span>
              <span>View your order</span>
              <strong>{money(sums.total, sym)}</strong>
            </button>
          </div>
        )}
      </div>

      {selected && (
        <ItemSheet
          item={items.find((i) => i.id === selected.id) || selected}
          sym={sym}
          canOrder={canOrder}
          onClose={() => setSelected(null)}
          onAdd={(qty, extras, note) => { addToCart(selected, qty, extras, note); setSelected(null); }}
        />
      )}

      {cartOpen && (
        <Sheet
          title={`Your order · ${table.label}`}
          onClose={() => { setCartOpen(false); setError(""); }}
          footer={
            <>
              {error && <div className="form-error" role="alert">{error}</div>}
              {!canOrder && <div className="form-error" role="alert">Ordering is paused right now.</div>}
              <button className="btn primary block" onClick={place} disabled={!canOrder || count === 0 || soldOut.length > 0}>
                Place order · {money(sums.total, sym)}
              </button>
            </>
          }
        >
          {count === 0 ? (
            <Empty title="Your order is empty">Add a dish from the menu to get started.</Empty>
          ) : (
            <>
              <ul className="cart-lines">
                {priced.lines.map((l) => (
                  <li key={l.key} className={l.available ? "" : "bad"}>
                    <div className="cart-line-info">
                      <strong>{l.name}</strong>
                      {l.extras.length > 0 && <small>+ {l.extras.map((e) => e.name).join(", ")}</small>}
                      {l.note && <small className="note">“{l.note}”</small>}
                      {!l.available && <small className="err">Sold out. Please remove it.</small>}
                      <b>{money(l.total, sym)}</b>
                    </div>
                    <div className="stepper" aria-label={`Quantity of ${l.name}`}>
                      <button onClick={() => changeQty(l.key, -1)} aria-label="Decrease quantity">−</button>
                      <span>{l.qty}</span>
                      <button onClick={() => changeQty(l.key, 1)} aria-label="Increase quantity" disabled={l.qty >= 50}>+</button>
                    </div>
                  </li>
                ))}
              </ul>
              <label className="field">
                <span>Note for the kitchen (optional)</span>
                <textarea
                  rows={2}
                  maxLength={200}
                  value={orderNote}
                  onChange={(e) => setOrderNote(e.target.value)}
                  placeholder="Allergies, timing, anything we should know"
                />
              </label>
              <Totals sums={sums} sym={sym} settings={settings} />
            </>
          )}
        </Sheet>
      )}
    </div>
  );
}

function Totals({ sums, sym, settings }) {
  return (
    <dl className="totals">
      <div><dt>Subtotal</dt><dd>{money(sums.subtotal, sym)}</dd></div>
      {settings.taxRate > 0 && <div><dt>VAT ({settings.taxRate}%)</dt><dd>{money(sums.tax, sym)}</dd></div>}
      {settings.serviceRate > 0 && <div><dt>Service ({settings.serviceRate}%)</dt><dd>{money(sums.service, sym)}</dd></div>}
      <div className="grand"><dt>Total</dt><dd>{money(sums.total, sym)}</dd></div>
    </dl>
  );
}

function ItemSheet({ item, sym, canOrder, onClose, onAdd }) {
  const [qty, setQty] = useState(1);
  const [picked, setPicked] = useState([]);
  const [note, setNote] = useState("");
  const extrasTotal = sum(item.extras.filter((e) => picked.includes(e.name)), (e) => e.price);
  const total = (item.price + extrasTotal) * qty;
  const toggle = (name) => setPicked((p) => (p.includes(name) ? p.filter((n) => n !== name) : [...p, name]));

  return (
    <Sheet
      title={item.name}
      onClose={onClose}
      footer={
        <div className="add-row">
          <div className="stepper">
            <button onClick={() => setQty((q) => Math.max(1, q - 1))} aria-label="Decrease quantity">−</button>
            <span>{qty}</span>
            <button onClick={() => setQty((q) => Math.min(50, q + 1))} aria-label="Increase quantity">+</button>
          </div>
          <button
            className="btn primary grow"
            disabled={!item.available || !canOrder}
            onClick={() => onAdd(qty, picked, note)}
          >
            {item.available ? `Add to order · ${money(total, sym)}` : "Sold out"}
          </button>
        </div>
      }
    >
      <div className="item-hero"><span className="dish-thumb big">{initials(item.name)}</span></div>
      <p className="item-desc">{item.description}</p>
      <p className="item-price">{money(item.price, sym)}</p>
      {item.extras.length > 0 && (
        <fieldset className="extras">
          <legend>Extras</legend>
          {item.extras.map((e) => (
            <label key={e.name} className="check">
              <input type="checkbox" checked={picked.includes(e.name)} onChange={() => toggle(e.name)} />
              <span>{e.name}</span>
              <em>+{money(e.price, sym)}</em>
            </label>
          ))}
        </fieldset>
      )}
      <label className="field">
        <span>Special request (optional)</span>
        <input maxLength={140} value={note} onChange={(e) => setNote(e.target.value)} placeholder="e.g. no pickles" />
      </label>
    </Sheet>
  );
}

const STEPS = [
  { id: "new", label: "Received" },
  { id: "preparing", label: "Preparing" },
  { id: "ready", label: "Ready" },
  { id: "served", label: "Served" },
];
const MESSAGE = (status, takeaway) => ({
  new: "We’ve received your order.",
  preparing: "The kitchen is preparing your order.",
  ready: takeaway ? "Your order is ready for pickup." : "Your order is ready and on its way to your table.",
  served: "Enjoy your meal!",
  cancelled: "This order was cancelled. Please ask a member of staff if this is a surprise.",
}[status]);

function Tracking({ orders, sym, takeaway, onBack }) {
  return (
    <div className="screen-m">
      <button className="back" onClick={onBack}>← Back to menu</button>
      <h1 className="page-title">Your orders</h1>
      {orders.length === 0 && <Empty title="No orders yet">Orders you place from this table appear here.</Empty>}
      {orders.map((o) => {
        const idx = STEPS.findIndex((s) => s.id === o.status);
        return (
          <article key={o.id} className="track-card">
            <div className="track-top">
              <strong>Order #{o.number}</strong>
              <span>{timeText(o.createdAt)}</span>
            </div>
            {o.status === "cancelled" ? (
              <p className="track-msg err">{MESSAGE(o.status, takeaway)}</p>
            ) : (
              <>
                <ol className="steps" aria-label="Order progress">
                  {STEPS.map((s, i) => (
                    <li key={s.id} className={i < idx ? "done" : i === idx ? "now" : ""} aria-current={i === idx ? "step" : undefined}>
                      <span />
                      {s.label}
                    </li>
                  ))}
                </ol>
                <p className="track-msg">{MESSAGE(o.status, takeaway)}</p>
              </>
            )}
            <ul className="track-items">
              {o.items.map((l, i) => (
                <li key={i}>
                  <span>{l.qty}× {l.name}{l.extras.length > 0 && <small> + {l.extras.map((e) => e.name).join(", ")}</small>}</span>
                  <span>{money(l.total, sym)}</span>
                </li>
              ))}
            </ul>
            <div className="track-total"><span>Total</span><strong>{money(o.total, sym)}</strong></div>
          </article>
        );
      })}
      <button className="btn primary block" onClick={onBack}>Order more</button>
    </div>
  );
}
