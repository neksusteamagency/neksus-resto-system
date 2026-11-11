import { useEffect, useState } from "react";
import { useParams } from "react-router-dom";
import { useStore, store, useMyOrders } from "../lib/store";
import { REMOTE } from "../lib/config";
import { money, initials, timeText } from "../lib/format";
import { useTitle } from "../lib/hooks";
import { Empty, Loading } from "../components/ui";
import OrderBuilder from "../components/OrderBuilder";

const mineKey = (t) => `neksus-dine:mine:${t}`;
const readMine = (k) => {
  try { const v = JSON.parse(localStorage.getItem(k)); return Array.isArray(v) ? v : []; } catch { return []; }
};

export default function CustomerRoute() {
  const { tableId } = useParams();
  const { tables, ready } = useStore();
  const [failed, setFailed] = useState(false);
  useEffect(() => {
    let live = true;
    setFailed(false);
    store.loadMenu(tableId).catch(() => live && setFailed(true));
    return () => { live = false; };
  }, [tableId]);

  const table = tables.find((t) => t.id === tableId);
  if (!table) {
    if (REMOTE && !ready && !failed) return <div className="customer"><Loading text="Loading the menu…" /></div>;
    return (
      <div className="customer">
        <div className="notice-page">
          <span className="rest-mark">?</span>
          <h1>{failed ? "We couldn’t load the menu" : "We couldn’t find this table"}</h1>
          <p>{failed ? "Check your connection and try again." : "The QR code may be out of date. Please ask a member of staff for help."}</p>
        </div>
      </div>
    );
  }
  return <Customer key={table.id} table={table} />;
}

function Customer({ table }) {
  const { settings } = useStore();
  const sym = settings.currency;
  useTitle(`${settings.name} · ${table.label}`);
  const [mine, setMine] = useState(() => readMine(mineKey(table.id)));
  const [view, setView] = useState("menu");
  const [notice, setNotice] = useState("");
  const myOrders = useMyOrders(mine);

  useEffect(() => {
    try { localStorage.setItem(mineKey(table.id), JSON.stringify(mine)); } catch { /* ignore */ }
  }, [mine, table.id]);

  const openOrders = myOrders.filter((o) => ["new", "preparing", "ready"].includes(o.status));
  const dineIn = table.id !== "takeaway";
  const canOrder = settings.orderingOpen;

  const place = ({ lines, note }) => store.placeOrder({ tableId: table.id, lines, note });
  const placed = (order) => { setMine((m) => [order.id, ...m].slice(0, 10)); setView("track"); };

  const ask = async (type) => {
    const res = await store.requestService({ tableId: table.id, type });
    setNotice(res.ok ? (type === "bill" ? "We’ve told your waiter you’d like the bill." : "A waiter is on the way.") : res.error);
    setTimeout(() => setNotice(""), 5000);
  };

  if (view === "track") {
    return (
      <div className="customer">
        <Tracking orders={myOrders} sym={sym} takeaway={!dineIn} onBack={() => setView("menu")}
          requests={dineIn && settings.customerRequests ? ask : null} notice={notice} />
      </div>
    );
  }

  const header = (
    <>
      <div className="hero">
        <span className="rest-mark">{initials(settings.name).slice(0, 1) || "N"}</span>
        <div><h1>{settings.name}</h1><small>{settings.openText}</small></div>
        <span className="table-pill">{table.label}</span>
      </div>
      {!canOrder && (
        <div className="banner warn" role="status">Ordering from the table is paused right now. You can still browse the menu, or ask a member of staff.</div>
      )}
      {notice && <div className="banner ok" role="status">{notice}</div>}
      {openOrders.length > 0 && (
        <button className="banner track" onClick={() => setView("track")}>
          <span>Order #{openOrders[0].number}{openOrders.length > 1 ? ` and ${openOrders.length - 1} more` : ""}</span>
          <strong>Track order</strong>
        </button>
      )}
      {dineIn && settings.customerRequests && (
        <div className="quick-actions">
          <button className="btn sm" onClick={() => ask("waiter")}>Call waiter</button>
          <button className="btn sm" onClick={() => ask("bill")}>Request bill</button>
        </div>
      )}
    </>
  );

  return (
    <div className="customer">
      <OrderBuilder tableLabel={table.label} persistKey={`neksus-dine:cart:${table.id}`} onPlace={place} onPlaced={placed} header={header} canOrder={canOrder} />
    </div>
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

function Tracking({ orders, sym, takeaway, onBack, requests, notice }) {
  return (
    <div className="screen-m">
      <button className="back" onClick={onBack}>← Back to menu</button>
      <h1 className="page-title">Your orders</h1>
      {notice && <div className="banner ok" role="status">{notice}</div>}
      {orders.length === 0 && <Empty title="No orders yet">Orders you place from this table appear here.</Empty>}
      {orders.map((o) => {
        const idx = STEPS.findIndex((s) => s.id === o.status);
        return (
          <article key={o.id} className="track-card">
            <div className="track-top"><strong>Order #{o.number}</strong><span>{timeText(o.createdAt)}</span></div>
            {o.status === "cancelled" ? (
              <p className="track-msg err">{MESSAGE(o.status, takeaway)}</p>
            ) : (
              <>
                <ol className="steps" aria-label="Order progress">
                  {STEPS.map((s, i) => (
                    <li key={s.id} className={i < idx ? "done" : i === idx ? "now" : ""} aria-current={i === idx ? "step" : undefined}><span />{s.label}</li>
                  ))}
                </ol>
                <p className="track-msg">{MESSAGE(o.status, takeaway)}</p>
              </>
            )}
            <ul className="track-items">
              {o.items.map((l, i) => (
                <li key={i} className={l.voided ? "voided" : ""}>
                  <span>{l.qty}× {l.name}{l.extras.length > 0 && <small> + {l.extras.map((e) => e.name).join(", ")}</small>}{l.voided && <small> (removed)</small>}</span>
                  <span>{money(l.total, sym)}</span>
                </li>
              ))}
            </ul>
            <div className="track-total"><span>Total</span><strong>{money(o.total, sym)}</strong></div>
          </article>
        );
      })}
      {requests && (
        <div className="quick-actions">
          <button className="btn sm" onClick={() => requests("waiter")}>Call waiter</button>
          <button className="btn sm" onClick={() => requests("bill")}>Request bill</button>
        </div>
      )}
      <button className="btn primary block" onClick={onBack}>Order more</button>
    </div>
  );
}
