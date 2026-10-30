import { useEffect, useMemo, useRef, useState } from "react";
import { Link } from "react-router-dom";
import { useStore, store } from "../lib/store";
import { STATIONS, STATUS_LABEL, waitText, minutesSince, startOfToday } from "../lib/format";
import { useNow, useTitle, useToast, beep } from "../lib/hooks";
import { Toast, Empty } from "../components/ui";

const COLS = [
  { id: "new", title: "New", act: "Start preparing", next: "preparing" },
  { id: "preparing", title: "Preparing", act: "Mark as ready", next: "ready" },
  { id: "ready", title: "Ready", act: "Mark as served", next: "served" },
];
const LATE_MIN = 15;
const SOUND_KEY = "neksus-dine:kitchen-sound";

export default function Kitchen({ onSignOut }) {
  const { orders, settings } = useStore();
  useTitle(`Kitchen · ${settings.name}`);
  const now = useNow(15000);
  const [station, setStation] = useState("all");
  const [sound, setSound] = useState(() => {
    try { return localStorage.getItem(SOUND_KEY) === "1"; } catch { return false; }
  });
  const { toast, show, dismiss } = useToast(6000);
  const embedded = typeof window !== "undefined" && window.self !== window.top;

  const active = useMemo(
    () => orders.filter((o) => ["new", "preparing", "ready"].includes(o.status)),
    [orders]
  );

  // Beep when a new order arrives (not on first load).
  const seen = useRef(null);
  useEffect(() => {
    const ids = new Set(active.filter((o) => o.status === "new").map((o) => o.id));
    if (seen.current && sound) {
      for (const id of ids) if (!seen.current.has(id)) { beep(); break; }
    }
    seen.current = ids;
  }, [active, sound]);

  const toggleSound = () => {
    const next = !sound;
    setSound(next);
    try { localStorage.setItem(SOUND_KEY, next ? "1" : "0"); } catch { /* ignore */ }
    if (next) beep();
  };

  // Today's average time from order placed to ready.
  const avgPrep = useMemo(() => {
    const since = startOfToday();
    const done = orders.filter((o) => o.readyAt && o.createdAt >= since && o.status !== "cancelled");
    if (!done.length) return null;
    return Math.max(1, Math.round(done.reduce((s, o) => s + (o.readyAt - o.createdAt), 0) / done.length / 60000));
  }, [orders]);

  const move = (o, next) => {
    const res = store.setOrderStatus(o.id, next);
    if (!res.ok) { show(res.error); return; }
    show(`Order #${o.number} moved to ${STATUS_LABEL[next]}`, {
      action: { label: "Undo", run: () => store.setOrderStatus(o.id, res.previous, { force: true }) },
    });
  };
  const cancel = (o) => {
    if (!window.confirm(`Cancel order #${o.number} (${o.tableLabel})? The customer will see it as cancelled.`)) return;
    const res = store.setOrderStatus(o.id, "cancelled");
    if (!res.ok) { show(res.error); return; }
    show(`Order #${o.number} cancelled`, {
      action: { label: "Undo", run: () => store.setOrderStatus(o.id, res.previous, { force: true }) },
    });
  };

  const countFor = (st) =>
    active.filter((o) => st === "all" || o.items.some((i) => i.station === st)).length;

  return (
    <div className={embedded ? "kds-page embedded" : "kds-page"}>
      <div className="kds">
        <div className="kds-top">
          <div>
            <h1>Live orders</h1>
            <small>
              {active.length} active · average prep time {avgPrep ? `${avgPrep} min` : "not yet available"}
            </small>
          </div>
          <div className="kds-tools">
            <div className="seg" role="tablist" aria-label="Station">
              {[{ id: "all", label: "All stations" }, ...STATIONS].map((s) => (
                <button
                  key={s.id}
                  role="tab"
                  aria-selected={station === s.id}
                  className={station === s.id ? "active" : ""}
                  onClick={() => setStation(s.id)}
                >
                  {s.label} <em>{countFor(s.id)}</em>
                </button>
              ))}
            </div>
            <button className={sound ? "tool on" : "tool"} onClick={toggleSound} aria-pressed={sound}>
              Sound {sound ? "on" : "off"}
            </button>
            {!embedded && <Link className="tool" to="/admin">Admin</Link>}
            {!embedded && onSignOut && <button className="tool" onClick={onSignOut}>Sign out</button>}
          </div>
        </div>

        <div className="lanes">
          {COLS.map((col) => {
            const list = active
              .filter((o) => o.status === col.id)
              .map((o) => ({ o, lines: o.items.filter((i) => station === "all" || i.station === station) }))
              .filter((x) => x.lines.length > 0)
              .sort((a, b) => a.o.createdAt - b.o.createdAt);
            return (
              <section key={col.id} className="lane" aria-label={col.title}>
                <div className="lane-head">
                  <h2>{col.title}</h2>
                  <span>{list.length}</span>
                </div>
                {list.length === 0 && <Empty title="No orders" />}
                {list.map(({ o, lines }) => {
                  const late = col.id !== "ready" && minutesSince(o.createdAt, now) >= LATE_MIN;
                  return (
                    <article key={o.id} className={["ticket", col.id === "new" ? "fresh" : "", late ? "late" : ""].join(" ").trim()}>
                      <div className="ticket-top">
                        <strong>#{o.number}</strong>
                        <span>{waitText(o.createdAt, now)}</span>
                      </div>
                      <p className="where">{o.tableLabel}</p>
                      <ul>
                        {lines.map((l, i) => (
                          <li key={i}>
                            {l.qty}× {l.name}
                            {l.extras.length > 0 && <small>+ {l.extras.map((e) => e.name).join(", ")}</small>}
                            {l.note && <small className="note">“{l.note}”</small>}
                          </li>
                        ))}
                      </ul>
                      {station !== "all" && lines.length < o.items.length && (
                        <p className="partial">Other stations are preparing the rest of this order.</p>
                      )}
                      {o.note && <p className="order-note">Note: {o.note}</p>}
                      <div className="ticket-actions">
                        <button className={col.id === "ready" ? "act ready" : "act"} onClick={() => move(o, col.next)}>
                          {col.act}
                        </button>
                        {col.id !== "ready" && (
                          <button className="act ghost" onClick={() => cancel(o)} aria-label={`Cancel order ${o.number}`}>
                            Cancel
                          </button>
                        )}
                      </div>
                    </article>
                  );
                })}
              </section>
            );
          })}
        </div>
      </div>
      <Toast toast={toast} onDismiss={dismiss} />
    </div>
  );
}
