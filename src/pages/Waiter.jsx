import { useMemo, useState } from "react";
import { Link } from "react-router-dom";
import { useStore, store } from "../lib/store";
import { money, parsePrice, centsToInput, waitText, minutesSince, timeText, STATUS_LABEL, PAY_METHODS, sum } from "../lib/format";
import { billOf, tableStatus, OPEN_TAB } from "../lib/billing";
import { receiptHtml } from "../lib/print";
import { canOpen } from "../lib/auth";
import { useNow, useTitle, useToast } from "../lib/hooks";
import { Sheet, Toast, Empty } from "../components/ui";
import OrderBuilder, { Totals } from "../components/OrderBuilder";
import PrintPreview from "../components/PrintPreview";

const STATE_LABEL = { free: "Free", busy: "Ordering", ready: "Food ready", bill: "Bill requested", call: "Needs you" };
const VOID_REASONS = ["Guest changed their mind", "Wrong item", "Kitchen error", "Quality issue"];

export default function Waiter({ user, onSignOut }) {
  const { tables, tabs, orders, requests, settings } = useStore();
  useTitle(`Waiter · ${settings.name}`);
  const now = useNow(20000);
  const { toast, show, dismiss } = useToast(4000);
  const [sel, setSel] = useState(null); // { tableId, tabId }
  const [picker, setPicker] = useState(null); // table to order for

  const rows = useMemo(
    () => tables.filter((t) => t.id !== "takeaway").map((t) => ({ table: t, ...tableStatus(t, tabs, orders, requests) })),
    [tables, tabs, orders, requests]
  );
  const takeawayTable = tables.find((t) => t.id === "takeaway");
  const takeaways = tabs.filter((t) => t.tableId === "takeaway" && OPEN_TAB.includes(t.status));
  const openRequests = requests.filter((r) => r.status === "open");
  const readyOrders = orders.filter((o) => o.status === "ready" && tabs.find((t) => t.id === o.tabId && OPEN_TAB.includes(t.status)));
  const attention = openRequests.length + readyOrders.length;

  const act = async (promise, ok) => {
    const r = await promise;
    show(r.ok ? ok : r.error);
    return r;
  };

  return (
    <div className="waiter">
      <header className="w-top">
        <div className="brand"><span className="brand-mark">N</span><span className="brand-name">Waiter</span></div>
        <div className="w-user">
          <span>{user.name}</span>
          {canOpen("kitchen", user) && <Link className="tool light" to="/kitchen">Kitchen</Link>}
          {canOpen("admin", user) && <Link className="tool light" to="/admin">Admin</Link>}
          <button className="tool light" onClick={onSignOut}>Sign out</button>
        </div>
      </header>

      <main className="w-main">
        {!settings.orderingOpen && <div className="banner warn">Customer ordering is paused. You can still take orders here.</div>}

        <section aria-label="Needs attention">
          <h2 className="w-h">Needs attention {attention > 0 && <span className="count-pill">{attention}</span>}</h2>
          {attention === 0 ? <p className="muted">Nothing waiting. New calls and ready orders appear here.</p> : (
            <ul className="alerts">
              {openRequests.map((r) => (
                <li key={r.id} className={r.type === "bill" ? "bill" : "call"}>
                  <div><strong>{r.tableLabel}</strong><span>{r.type === "bill" ? "wants the bill" : "needs a waiter"} · {waitText(r.createdAt, now)}</span></div>
                  <div className="alert-actions">
                    <button className="btn sm" onClick={() => setSel({ tableId: r.tableId, tabId: tabs.find((t) => t.tableId === r.tableId && OPEN_TAB.includes(t.status))?.id })}>Open</button>
                    <button className="btn sm primary" onClick={() => act(store.resolveRequest(r.id), "Marked as done")}>Done</button>
                  </div>
                </li>
              ))}
              {readyOrders.map((o) => (
                <li key={o.id} className="ready">
                  <div><strong>{o.tableLabel}</strong><span>order #{o.number} is ready · {waitText(o.readyAt, now)}</span></div>
                  <div className="alert-actions">
                    <button className="btn sm primary" onClick={() => act(store.setOrderStatus(o.id, "served"), `Order #${o.number} served`)}>Mark served</button>
                  </div>
                </li>
              ))}
            </ul>
          )}
        </section>

        <section aria-label="Tables">
          <h2 className="w-h">Tables</h2>
          <div className="t-grid">
            {rows.map(({ table, key, tab, reqs }) => {
              const bill = tab ? billOf(tab, orders) : null;
              return (
                <button key={table.id} className={`t-tile ${key}`} onClick={() => setSel({ tableId: table.id, tabId: tab?.id })}>
                  <strong>{table.label}</strong>
                  <span className="t-state">{STATE_LABEL[key]}</span>
                  {tab ? <span className="t-meta">{money(bill.total, settings.currency)} · {minutesSince(tab.openedAt, now)} min</span> : <span className="t-meta">Tap to start</span>}
                  {reqs.length > 0 && <i className="t-dot" aria-label="Request waiting" />}
                </button>
              );
            })}
          </div>
        </section>

        {takeawayTable && (
          <section aria-label="Takeaway">
            <h2 className="w-h">Takeaway <button className="btn sm primary" onClick={() => setPicker(takeawayTable)}>New takeaway order</button></h2>
            {takeaways.length === 0 ? <p className="muted">No open takeaway orders.</p> : (
              <ul className="alerts plain">
                {takeaways.map((t) => {
                  const b = billOf(t, orders);
                  const ready = orders.some((o) => o.tabId === t.id && o.status === "ready");
                  return (
                    <li key={t.id} className={ready ? "ready" : ""}>
                      <div><strong>Takeaway #{t.number}</strong><span>{money(b.total, settings.currency)} · {waitText(t.openedAt, now)}{ready ? " · ready" : ""}</span></div>
                      <button className="btn sm" onClick={() => setSel({ tableId: "takeaway", tabId: t.id })}>Open</button>
                    </li>
                  );
                })}
              </ul>
            )}
          </section>
        )}
      </main>

      {sel && (
        <TablePanel
          key={`${sel.tableId}:${sel.tabId || "new"}`}
          sel={sel}
          user={user}
          now={now}
          show={show}
          act={act}
          onClose={() => setSel(null)}
          onOrder={(table) => setPicker(table)}
        />
      )}
      {picker && (
        <Picker table={picker} onClose={() => setPicker(null)} show={show}
          onDone={(order) => { setPicker(null); setSel({ tableId: order.tableId, tabId: order.tabId }); }} />
      )}
      <Toast toast={toast} onDismiss={dismiss} />
    </div>
  );
}

/* ---------- order entry ---------- */
function Picker({ table, onClose, onDone, show }) {
  const header = (
    <div className="picker-head">
      <button className="back" onClick={onClose}>← Back</button>
      <strong>{table.label}</strong>
    </div>
  );
  return (
    <div className="fullscreen">
      <OrderBuilder
        staff
        tableLabel={table.label}
        canOrder
        header={header}
        onPlace={({ lines, note }) => store.placeOrder({ tableId: table.id, lines, note })}
        onPlaced={(order) => { show(`Order #${order.number} sent to the kitchen`); onDone(order); }}
      />
    </div>
  );
}

/* ---------- table / bill ---------- */
function TablePanel({ sel, user, now, show, act, onClose, onOrder }) {
  const { tables, tabs, orders, requests, settings } = useStore();
  const sym = settings.currency;
  const table = tables.find((t) => t.id === sel.tableId);
  const tab = tabs.find((t) => t.id === sel.tabId);
  const [sheet, setSheet] = useState(null); // "pay" | "discount" | "move" | "merge" | "bill" | { void: {order, idx} } | "receipt"

  if (!table) return null;
  const isOpen = tab && OPEN_TAB.includes(tab.status);
  const tabOrders = tab ? orders.filter((o) => o.tabId === tab.id).sort((a, b) => a.createdAt - b.createdAt) : [];
  const bill = tab ? billOf(tab, orders) : null;
  const reqs = requests.filter((r) => r.tableId === table.id && r.status === "open");
  const canVoid = user.role === "owner" || user.role === "manager" || (user.role === "waiter" && settings.waiterCanVoid);
  const vis = tabOrders.filter((o) => o.status !== "cancelled");
  const others = tabs.filter((t) => OPEN_TAB.includes(t.status) && t.id !== tab?.id);
  const freeTables = tables.filter((t) => t.id !== "takeaway" && t.id !== table.id && !tabs.some((x) => x.tableId === t.id && OPEN_TAB.includes(x.status)));

  return (
    <div className="fullscreen">
      <div className="panel-top">
        <button className="back" onClick={onClose}>← Tables</button>
        <div className="pt-title">
          <h2>{tab && table.id === "takeaway" ? `Takeaway #${tab.number}` : table.label}</h2>
          {tab && <small>Bill #{tab.number}{tab.waiter ? ` · ${tab.waiter}` : ""} · open {timeText(tab.openedAt)}</small>}
        </div>
        {tab && <span className={`pill ${tab.status === "paid" ? "served" : tab.status === "bill" ? "preparing" : tab.status === "void" ? "cancelled" : "new"}`}>{tab.status === "bill" ? "Bill requested" : tab.status === "void" ? "Closed" : tab.status === "paid" ? "Paid" : "Open"}</span>}
      </div>

      <div className="panel-body">
        {reqs.map((r) => (
          <div key={r.id} className={`banner ${r.type === "bill" ? "warn" : "alert"}`}>
            <span>{r.type === "bill" ? "Guests asked for the bill" : "Guests called a waiter"} · {waitText(r.createdAt, now)}</span>
            <button className="btn sm" onClick={() => act(store.resolveRequest(r.id), "Marked as done")}>Done</button>
          </div>
        ))}

        {!tab && (
          <Empty title={`${table.label} is free`}>Start an order to open a bill for this table.</Empty>
        )}

        {vis.map((o) => (
          <article key={o.id} className="w-order">
            <div className="w-order-top">
              <strong>#{o.number}</strong>
              <span className="muted">{timeText(o.createdAt)} · {o.placedBy || "Guest"}</span>
              <span className={`pill ${o.status}`}>{STATUS_LABEL[o.status]}</span>
            </div>
            <ul>
              {o.items.map((l, i) => (
                <li key={i} className={l.voided ? "voided" : ""}>
                  <div>
                    <span>{l.qty}× {l.name}</span>
                    {l.extras.length > 0 && <small>+ {l.extras.map((e) => e.name).join(", ")}</small>}
                    {l.note && <small className="note">“{l.note}”</small>}
                    {l.voided && <small className="err">Removed: {l.voided.reason}</small>}
                  </div>
                  <div className="w-line-right">
                    <b>{money(l.total, sym)}</b>
                    {isOpen && !l.voided && canVoid && <button className="link-btn" onClick={() => setSheet({ void: { order: o, idx: i } })}>Remove</button>}
                  </div>
                </li>
              ))}
            </ul>
            {o.note && <p className="order-note">Note: {o.note}</p>}
            {o.status === "ready" && <button className="btn primary block sm-block" onClick={() => act(store.setOrderStatus(o.id, "served"), `Order #${o.number} served`)}>Mark as served</button>}
          </article>
        ))}

        {tab && (
          <div className="bill-box">
            <dl className="totals">
              <div><dt>Subtotal</dt><dd>{money(bill.subtotal, sym)}</dd></div>
              {bill.discount > 0 && <div><dt>Discount{tab.discount?.type === "percent" ? ` (${tab.discount.value}%)` : ""}</dt><dd>−{money(bill.discount, sym)}</dd></div>}
              {tab.taxRate > 0 && <div><dt>VAT ({tab.taxRate}%)</dt><dd>{money(bill.tax, sym)}</dd></div>}
              {tab.serviceRate > 0 && <div><dt>Service ({tab.serviceRate}%)</dt><dd>{money(bill.service, sym)}</dd></div>}
              <div className="grand"><dt>Total</dt><dd>{money(bill.total, sym)}</dd></div>
              {tab.payments.map((p) => <div key={p.id}><dt>Paid · {p.method}</dt><dd>{money(p.amount, sym)}</dd></div>)}
              {bill.paid > 0 && <div className="grand"><dt>Balance due</dt><dd>{money(bill.due, sym)}</dd></div>}
            </dl>
          </div>
        )}
      </div>

      <div className="panel-actions">
        {!tab && <button className="btn primary block" onClick={() => onOrder(table)}>Start order</button>}
        {isOpen && (
          <>
            <div className="pa-row">
              <button className="btn grow" onClick={() => onOrder(table)}>Add items</button>
              <button className="btn primary grow" disabled={bill.total <= 0} onClick={() => setSheet("pay")}>Take payment</button>
            </div>
            <div className="pa-row small">
              <button className="btn sm" onClick={() => setSheet("discount")}>Discount</button>
              <button className="btn sm" onClick={() => setSheet("bill")}>Print bill</button>
              <button className="btn sm" onClick={() => setSheet("move")}>Move</button>
              <button className="btn sm" disabled={others.length === 0} onClick={() => setSheet("merge")}>Merge</button>
              {bill.total <= 0 && <button className="btn sm danger-text" onClick={async () => { const r = await act(store.closeTab(tab.id), "Bill closed"); if (r.ok) onClose(); }}>Close empty bill</button>}
            </div>
          </>
        )}
        {tab && !isOpen && tab.status === "paid" && <button className="btn block" onClick={() => setSheet("receipt")}>Print receipt</button>}
      </div>

      {sheet === "pay" && (
        <PaySheet tab={tab} bill={bill} sym={sym} onClose={() => setSheet(null)}
          onPaid={(closed) => { show(closed ? "Paid in full" : "Payment recorded"); setSheet(closed ? "receipt" : null); }} />
      )}
      {sheet === "discount" && <DiscountSheet tab={tab} bill={bill} sym={sym} settings={settings} onClose={() => setSheet(null)} show={show} />}
      {sheet === "move" && (
        <PickSheet title="Move to table" empty="No free tables." options={freeTables.map((t) => ({ id: t.id, label: t.label }))} onClose={() => setSheet(null)}
          onPick={async (id) => { const r = await act(store.moveTab(tab.id, id), "Table moved"); if (r.ok) onClose(); else setSheet(null); }} />
      )}
      {sheet === "merge" && (
        <PickSheet title="Merge this bill into" empty="No other open bills."
          options={others.map((t) => ({ id: t.id, label: t.tableId === "takeaway" ? `Takeaway #${t.number}` : t.tableLabel }))} onClose={() => setSheet(null)}
          onPick={async (id) => { const r = await act(store.mergeTabs(tab.id, id), "Bills merged"); if (r.ok) onClose(); else setSheet(null); }} />
      )}
      {sheet && sheet.void && <VoidSheet target={sheet.void} onClose={() => setSheet(null)} show={show} />}
      {(sheet === "bill" || sheet === "receipt") && (
        <PrintPreview
          title={sheet === "bill" ? `Bill · ${table.label}` : `Receipt · ${table.label}`}
          width={settings.paperWidth}
          html={receiptHtml({ settings, tab, bill, orders })}
          onClose={() => { const wasReceipt = sheet === "receipt"; setSheet(null); if (wasReceipt && !isOpen) onClose(); }}
        />
      )}
    </div>
  );
}

function PaySheet({ tab, bill, sym, onClose, onPaid }) {
  const [method, setMethod] = useState("cash");
  const [amount, setAmount] = useState(centsToInput(bill.due));
  const [received, setReceived] = useState("");
  const [people, setPeople] = useState("");
  const [err, setErr] = useState("");
  const [busy, setBusy] = useState(false);

  const cents = parsePrice(amount);
  const rec = parsePrice(received);
  const change = method === "cash" && rec !== null && cents !== null ? rec - cents : null;
  const n = Math.floor(Number(people));
  const share = n >= 2 && n <= 30 ? Math.ceil(bill.due / n) : null;

  const submit = async (e) => {
    e.preventDefault();
    if (cents === null || cents <= 0) { setErr("Enter a valid amount."); return; }
    setBusy(true);
    const r = await store.addPayment(tab.id, { method, amount: cents });
    setBusy(false);
    if (!r.ok) { setErr(r.error); return; }
    onPaid(r.closed);
  };

  return (
    <Sheet title="Take payment" onClose={onClose}
      footer={<button className="btn primary block" form="pay-form" disabled={busy}>{busy ? "Saving…" : `Record ${cents ? money(cents, sym) : "payment"}`}</button>}>
      <form id="pay-form" onSubmit={submit} className="form">
        <dl className="totals"><div className="grand"><dt>Balance due</dt><dd>{money(bill.due, sym)}</dd></div></dl>
        <div className="seg-light" role="radiogroup" aria-label="Payment method">
          {PAY_METHODS.map((m) => (
            <button type="button" key={m.id} role="radio" aria-checked={method === m.id} className={method === m.id ? "active" : ""} onClick={() => setMethod(m.id)}>{m.label}</button>
          ))}
        </div>
        <label className="field"><span>Amount ({sym})</span>
          <input inputMode="decimal" value={amount} onChange={(e) => { setAmount(e.target.value); setErr(""); }} />
        </label>
        {method === "cash" && (
          <label className="field"><span>Cash received (optional)</span>
            <input inputMode="decimal" value={received} onChange={(e) => setReceived(e.target.value)} placeholder="0.00" />
            {change !== null && <small className={change < 0 ? "err-text" : "ok-text"}>{change < 0 ? `Short by ${money(-change, sym)}` : `Change to give back: ${money(change, sym)}`}</small>}
          </label>
        )}
        <label className="field"><span>Split evenly between (optional)</span>
          <input inputMode="numeric" value={people} onChange={(e) => setPeople(e.target.value.replace(/\D/g, "").slice(0, 2))} placeholder="Number of guests" />
          {share !== null && (
            <small>Each guest pays {money(share, sym)}. <button type="button" className="link-btn" onClick={() => setAmount(centsToInput(Math.min(share, bill.due)))}>Use this amount</button></small>
          )}
        </label>
        {err && <div className="form-error" role="alert">{err}</div>}
      </form>
    </Sheet>
  );
}

function DiscountSheet({ tab, bill, sym, settings, onClose, show }) {
  const cur = tab.discount;
  const [type, setType] = useState(cur?.type || "percent");
  const [value, setValue] = useState(cur ? (cur.type === "percent" ? String(cur.value) : centsToInput(cur.value)) : "");
  const [reason, setReason] = useState(cur?.reason || "");
  const [err, setErr] = useState("");

  const save = async (e) => {
    e.preventDefault();
    const v = type === "percent" ? Number(String(value).replace(",", ".")) : parsePrice(value);
    if (v === null || !Number.isFinite(v) || v <= 0) { setErr("Enter a discount greater than zero."); return; }
    const r = await store.setDiscount(tab.id, { type, value: v, reason });
    if (!r.ok) { setErr(r.error); return; }
    show("Discount applied"); onClose();
  };
  const clear = async () => {
    const r = await store.setDiscount(tab.id, null);
    if (!r.ok) { setErr(r.error); return; }
    show("Discount removed"); onClose();
  };

  return (
    <Sheet title="Discount" onClose={onClose}
      footer={<>{cur && <button className="btn danger-text" onClick={clear}>Remove discount</button>}<button className="btn primary" form="disc-form">Apply</button></>}>
      <form id="disc-form" onSubmit={save} className="form">
        <p className="muted small-p">Bill subtotal {money(bill.subtotal, sym)}. Waiters can give up to {settings.waiterMaxDiscount}%; larger discounts need a manager.</p>
        <div className="seg-light" role="radiogroup" aria-label="Discount type">
          <button type="button" role="radio" aria-checked={type === "percent"} className={type === "percent" ? "active" : ""} onClick={() => setType("percent")}>Percent</button>
          <button type="button" role="radio" aria-checked={type === "amount"} className={type === "amount" ? "active" : ""} onClick={() => setType("amount")}>Amount</button>
        </div>
        <label className="field"><span>{type === "percent" ? "Percent off" : `Amount off (${sym})`}</span>
          <input inputMode="decimal" autoFocus value={value} onChange={(e) => { setValue(e.target.value); setErr(""); }} />
        </label>
        <label className="field"><span>Reason</span>
          <input value={reason} maxLength={120} onChange={(e) => { setReason(e.target.value); setErr(""); }} placeholder="e.g. Regular guest, service delay" />
        </label>
        {err && <div className="form-error" role="alert">{err}</div>}
      </form>
    </Sheet>
  );
}

function VoidSheet({ target, onClose, show }) {
  const { order, idx } = target;
  const line = order.items[idx];
  const [reason, setReason] = useState("");
  const [err, setErr] = useState("");
  const submit = async (e) => {
    e.preventDefault();
    const r = await store.voidLine(order.id, idx, reason);
    if (!r.ok) { setErr(r.error); return; }
    show("Item removed"); onClose();
  };
  return (
    <Sheet title="Remove item" onClose={onClose} footer={<button className="btn danger" form="void-form">Remove {line.qty}× {line.name}</button>}>
      <form id="void-form" onSubmit={submit} className="form">
        <p className="muted small-p">This removes the item from the bill. If the kitchen hasn't started it, the ingredients go back into stock.</p>
        <div className="chips wrap">
          {VOID_REASONS.map((r) => <button type="button" key={r} className={reason === r ? "chip active" : "chip"} onClick={() => { setReason(r); setErr(""); }}>{r}</button>)}
        </div>
        <label className="field"><span>Reason</span>
          <input value={reason} maxLength={120} onChange={(e) => { setReason(e.target.value); setErr(""); }} />
        </label>
        {err && <div className="form-error" role="alert">{err}</div>}
      </form>
    </Sheet>
  );
}

function PickSheet({ title, options, empty, onPick, onClose }) {
  return (
    <Sheet title={title} onClose={onClose}>
      {options.length === 0 ? <Empty title={empty} /> : (
        <ul className="pick-list">
          {options.map((o) => <li key={o.id}><button className="btn block" onClick={() => onPick(o.id)}>{o.label}</button></li>)}
        </ul>
      )}
    </Sheet>
  );
}
