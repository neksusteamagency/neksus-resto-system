import { useEffect, useMemo, useRef, useState } from "react";
import { useStore } from "../lib/store";
import { money, initials, sum } from "../lib/format";
import { resolveLines, totals } from "../lib/pricing";
import { Sheet, Empty } from "./ui";

const read = (k) => {
  if (!k) return [];
  try { const v = JSON.parse(localStorage.getItem(k)); return Array.isArray(v) ? v : []; } catch { return []; }
};
const lineKey = (itemId, extras, note) =>
  [itemId, [...extras].sort().join("+"), note.trim().toLowerCase()].join("|");

export const stockLabel = (d) => (!d.available ? "Sold out" : "Out of stock");

export function Totals({ sums, sym, settings }) {
  return (
    <dl className="totals">
      <div><dt>Subtotal</dt><dd>{money(sums.subtotal, sym)}</dd></div>
      {settings.taxRate > 0 && <div><dt>VAT ({settings.taxRate}%)</dt><dd>{money(sums.tax, sym)}</dd></div>}
      {settings.serviceRate > 0 && <div><dt>Service ({settings.serviceRate}%)</dt><dd>{money(sums.service, sym)}</dd></div>}
      <div className="grand"><dt>Total</dt><dd>{money(sums.total, sym)}</dd></div>
    </dl>
  );
}

// The menu, item sheet and cart. Used by customers (scanning a QR code) and by waiters.
//   onPlace({ lines, note }) -> Promise<{ ok, error?, order? }>
export default function OrderBuilder({ tableLabel, persistKey = null, onPlace, onPlaced, header, canOrder, blocked, staff = false }) {
  const { settings, categories, items } = useStore();
  const sym = settings.currency;
  const [cart, setCart] = useState(() => read(persistKey));
  const [chip, setChip] = useState(null);
  const [query, setQuery] = useState("");
  const [selected, setSelected] = useState(null);
  const [cartOpen, setCartOpen] = useState(false);
  const [orderNote, setOrderNote] = useState("");
  const [error, setError] = useState("");
  const [placing, setPlacing] = useState(false);
  const placingRef = useRef(false);

  useEffect(() => {
    if (!persistKey) return;
    try { localStorage.setItem(persistKey, JSON.stringify(cart)); } catch { /* ignore */ }
  }, [cart, persistKey]);

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
    return [...list].sort((a, b) => Number(a.soldOut) - Number(b.soldOut));
  }, [items, q, activeChip]);

  const priced = useMemo(() => resolveLines(items, cart), [items, cart]);
  useEffect(() => {
    if (priced.lines.length !== cart.length) {
      const keep = new Set(priced.lines.map((l) => l.key));
      setCart((c) => c.filter((l) => keep.has(l.key)));
    }
  }, [priced, cart.length]);
  const count = sum(priced.lines, (l) => l.qty);
  const sums = totals(sum(priced.lines, (l) => l.total), settings);

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

  const place = async () => {
    if (placingRef.current) return;
    placingRef.current = true;
    setPlacing(true);
    let res;
    try { res = await onPlace({ lines: cart, note: orderNote }); } catch { res = { ok: false, error: "Something went wrong. Please try again." }; }
    placingRef.current = false;
    setPlacing(false);
    if (!res.ok) { setError(res.error); return; }
    setCart([]); setOrderNote(""); setError(""); setCartOpen(false);
    onPlaced?.(res.order);
  };

  return (
    <>
      <div className="screen-m">
        {header}
        <input className="search-m" type="search" placeholder="Search the menu…" value={query} onChange={(e) => setQuery(e.target.value)} aria-label="Search the menu" />
        {!q && (
          <div className="chips" role="tablist" aria-label="Menu categories">
            {chips.map((c) => (
              <button key={c.id} role="tab" aria-selected={c.id === activeChip} className={c.id === activeChip ? "chip active" : "chip"} onClick={() => setChip(c.id)}>
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
              <li key={d.id} className={d.soldOut ? "soldout" : ""}>
                <button className="dish-main" onClick={() => setSelected(d)} aria-label={`${d.name}, ${money(d.price, sym)}`}>
                  <span className="dish-thumb">{initials(d.name)}</span>
                  <span className="dish-info">
                    <strong>{d.name}</strong>
                    <small>{d.description}</small>
                    <b>{d.soldOut ? stockLabel(d) : money(d.price, sym)}</b>
                  </span>
                </button>
                {!d.soldOut && (
                  <button className="add" disabled={!canOrder} aria-label={`Add ${d.name}`} onClick={() => (d.extras.length ? setSelected(d) : addToCart(d, 1, [], ""))}>+</button>
                )}
              </li>
            ))}
          </ul>
        )}
        {count > 0 && (
          <div className="cart-dock">
            <button className="cart-bar" onClick={() => setCartOpen(true)}>
              <span className="count">{count}</span>
              <span>{staff ? "Review order" : "View your order"}</span>
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
          title={`${staff ? "New order" : "Your order"} · ${tableLabel}`}
          onClose={() => { setCartOpen(false); setError(""); }}
          footer={
            <>
              {error && <div className="form-error" role="alert">{error}</div>}
              {!canOrder && <div className="form-error" role="alert">{blocked || "Ordering is paused right now."}</div>}
              <button className="btn primary block" onClick={place} disabled={!canOrder || count === 0 || priced.problems.length > 0 || placing}>
                {placing ? "Sending…" : `${staff ? "Send to kitchen" : "Place order"} · ${money(sums.total, sym)}`}
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
                <textarea rows={2} maxLength={200} value={orderNote} onChange={(e) => setOrderNote(e.target.value)} placeholder="Allergies, timing, anything we should know" />
              </label>
              <Totals sums={sums} sym={sym} settings={settings} />
            </>
          )}
        </Sheet>
      )}
    </>
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
          <button className="btn primary grow" disabled={item.soldOut || !canOrder} onClick={() => onAdd(qty, picked, note)}>
            {item.soldOut ? stockLabel(item) : `Add to order · ${money(total, sym)}`}
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
