import { useMemo, useState } from "react";
import { useStore, store } from "../../lib/store";
import { UNITS, qtyText, dateTimeText } from "../../lib/format";
import { Sheet, Empty } from "../../components/ui";
import { PageHead, Kpi } from "./shared";

const stateOf = (g) => (g.onHand <= 0 ? "out" : g.lowAt > 0 && g.onHand <= g.lowAt ? "low" : "ok");
const STATE_LABEL = { ok: "In stock", low: "Low", out: "Out" };
const REASON = { restock: "Delivery", waste: "Waste", adjust: "Stock count", sale: "Sold", return: "Returned" };

export default function Inventory({ show }) {
  const { ingredients, items, stockMoves } = useStore();
  const [tab, setTab] = useState("stock");
  const [q, setQ] = useState("");
  const [sheet, setSheet] = useState(null); // {form: ing|{}} | {adjust: ing, mode}
  const list = useMemo(() => {
    const t = q.trim().toLowerCase();
    return [...ingredients].filter((g) => !t || g.name.toLowerCase().includes(t)).sort((a, b) => a.name.localeCompare(b.name));
  }, [ingredients, q]);
  const usedBy = (id) => items.filter((i) => (i.recipe || []).some((r) => r.ingredientId === id));
  const lowCount = ingredients.filter((g) => stateOf(g) !== "ok").length;
  const soldOutDishes = items.filter((i) => i.available && i.stockOut).length;

  const remove = async (g) => {
    if (!window.confirm(`Delete “${g.name}”? Its movement history is removed too.`)) return;
    const r = await store.deleteIngredient(g.id);
    show(r.ok ? "Ingredient deleted" : r.error);
  };

  return (
    <>
      <PageHead title="Inventory">
        <button className="btn primary" onClick={() => setSheet({ form: {} })}>Add ingredient</button>
      </PageHead>
      <div className="kpis three">
        <Kpi label="Ingredients tracked" value={ingredients.length} />
        <Kpi label="Low or out of stock" value={lowCount} />
        <Kpi label="Dishes sold out by stock" value={soldOutDishes} hint="Hidden from ordering automatically" />
      </div>
      <div className="tabs-row" role="tablist">
        <button role="tab" aria-selected={tab === "stock"} className={tab === "stock" ? "active" : ""} onClick={() => setTab("stock")}>Stock</button>
        <button role="tab" aria-selected={tab === "history"} className={tab === "history" ? "active" : ""} onClick={() => setTab("history")}>History</button>
      </div>

      {tab === "stock" && (
        <>
          <div className="filters"><input type="search" placeholder="Search ingredients" value={q} onChange={(e) => setQ(e.target.value)} aria-label="Search ingredients" /></div>
          {list.length === 0 ? <Empty title="No ingredients yet">Add what you cook with, then list it in each dish's recipe so stock goes down automatically.</Empty> : (
            <div className="table-wrap">
              <table className="data">
                <thead><tr><th>Ingredient</th><th className="r">On hand</th><th className="r">Low at</th><th>Status</th><th>Used in</th><th /></tr></thead>
                <tbody>
                  {list.map((g) => {
                    const st = stateOf(g);
                    const used = usedBy(g.id);
                    return (
                      <tr key={g.id}>
                        <td><strong>{g.name}</strong></td>
                        <td className="r">{qtyText(g.onHand)} {g.unit}</td>
                        <td className="r">{qtyText(g.lowAt)} {g.unit}</td>
                        <td><span className={`pill stock-${st}`}>{STATE_LABEL[st]}</span></td>
                        <td className="muted">{used.length ? `${used.length} dish${used.length === 1 ? "" : "es"}` : "Not used yet"}</td>
                        <td className="r nowrap">
                          <button className="btn sm" onClick={() => setSheet({ adjust: g, mode: "restock" })}>Restock</button>{" "}
                          <button className="btn sm" onClick={() => setSheet({ adjust: g, mode: "waste" })}>Waste</button>{" "}
                          <button className="btn sm" onClick={() => setSheet({ adjust: g, mode: "count" })}>Count</button>{" "}
                          <button className="btn sm" onClick={() => setSheet({ form: g })}>Edit</button>{" "}
                          <button className="btn sm danger-text" onClick={() => remove(g)}>Delete</button>
                        </td>
                      </tr>
                    );
                  })}
                </tbody>
              </table>
            </div>
          )}
        </>
      )}

      {tab === "history" && (
        stockMoves.length === 0 ? <Empty title="No stock movements yet">Deliveries, waste, counts and sales appear here.</Empty> : (
          <div className="table-wrap">
            <table className="data">
              <thead><tr><th>When</th><th>Ingredient</th><th className="r">Change</th><th>Reason</th><th>Note</th><th>By</th></tr></thead>
              <tbody>
                {[...stockMoves].reverse().slice(0, 150).map((m) => {
                  const g = ingredients.find((x) => x.id === m.ingredientId);
                  return (
                    <tr key={m.id}>
                      <td>{dateTimeText(m.at)}</td>
                      <td>{g?.name || "Deleted"}</td>
                      <td className={`r ${m.delta < 0 ? "err-text" : "ok-text"}`}>{m.delta > 0 ? "+" : ""}{qtyText(m.delta)} {g?.unit}</td>
                      <td>{REASON[m.reason]}</td>
                      <td className="muted">{m.note}</td>
                      <td>{m.by}</td>
                    </tr>
                  );
                })}
              </tbody>
            </table>
          </div>
        )
      )}

      {sheet?.form && <IngredientForm ing={sheet.form} onClose={() => setSheet(null)} onSaved={(m) => { setSheet(null); show(m); }} />}
      {sheet?.adjust && <AdjustForm ing={sheet.adjust} mode={sheet.mode} onClose={() => setSheet(null)} onSaved={(m) => { setSheet(null); show(m); }} />}
    </>
  );
}

function IngredientForm({ ing, onClose, onSaved }) {
  const isNew = !ing.id;
  const [f, setF] = useState({ name: ing.name || "", unit: ing.unit || "pcs", onHand: "", lowAt: ing.lowAt != null ? String(ing.lowAt) : "0" });
  const [err, setErr] = useState("");
  const set = (k, v) => { setF((x) => ({ ...x, [k]: v })); setErr(""); };
  const num = (v) => Number(String(v).replace(",", "."));

  const save = async (e) => {
    e.preventDefault();
    const res = await store.upsertIngredient({ id: ing.id, name: f.name, unit: f.unit, lowAt: num(f.lowAt), onHand: f.onHand === "" ? 0 : num(f.onHand) });
    if (!res.ok) { setErr(res.error); return; }
    onSaved(isNew ? "Ingredient added" : "Ingredient saved");
  };

  return (
    <Sheet title={isNew ? "Add ingredient" : "Edit ingredient"} onClose={onClose}
      footer={<><button className="btn" onClick={onClose}>Cancel</button><button className="btn primary" form="ing-form">Save</button></>}>
      <form id="ing-form" onSubmit={save} className="form">
        <label className="field"><span>Name</span><input autoFocus value={f.name} maxLength={50} onChange={(e) => set("name", e.target.value)} required /></label>
        <div className="grid2">
          <label className="field"><span>Unit</span>
            <select value={f.unit} onChange={(e) => set("unit", e.target.value)}>{UNITS.map((u) => <option key={u} value={u}>{u}</option>)}</select>
          </label>
          <label className="field"><span>Warn me when stock is at or below</span><input inputMode="decimal" value={f.lowAt} onChange={(e) => set("lowAt", e.target.value)} /></label>
        </div>
        {isNew && <label className="field"><span>Opening stock</span><input inputMode="decimal" value={f.onHand} onChange={(e) => set("onHand", e.target.value)} placeholder="0" /></label>}
        {!isNew && <p className="muted small-p">To change how much is on hand, use Restock, Waste or Count so the history stays accurate.</p>}
        {err && <div className="form-error" role="alert">{err}</div>}
      </form>
    </Sheet>
  );
}

function AdjustForm({ ing, mode, onClose, onSaved }) {
  const [qty, setQty] = useState("");
  const [note, setNote] = useState("");
  const [err, setErr] = useState("");
  const n = Number(String(qty).replace(",", "."));
  const TITLE = { restock: "Record a delivery", waste: "Log waste", count: "Stock count" };
  const LABEL = { restock: "Quantity received", waste: "Quantity wasted", count: "Counted quantity" };

  const save = async (e) => {
    e.preventDefault();
    if (qty.trim() === "" || !Number.isFinite(n) || n < 0 || (mode !== "count" && n === 0)) { setErr("Enter a valid quantity."); return; }
    const payload = mode === "restock" ? { delta: n, reason: "restock" }
      : mode === "waste" ? { delta: -n, reason: "waste" }
      : { delta: n - ing.onHand, reason: "adjust" };
    if (payload.delta === 0) { setErr("That matches the current stock."); return; }
    const res = await store.adjustStock({ ingredientId: ing.id, ...payload, note });
    if (!res.ok) { setErr(res.error); return; }
    onSaved("Stock updated");
  };

  return (
    <Sheet title={`${TITLE[mode]} · ${ing.name}`} onClose={onClose}
      footer={<><button className="btn" onClick={onClose}>Cancel</button><button className="btn primary" form="adj-form">Save</button></>}>
      <form id="adj-form" onSubmit={save} className="form">
        <p className="muted small-p">Currently on hand: {qtyText(ing.onHand)} {ing.unit}</p>
        <label className="field"><span>{LABEL[mode]} ({ing.unit})</span>
          <input autoFocus inputMode="decimal" value={qty} onChange={(e) => { setQty(e.target.value); setErr(""); }} />
        </label>
        <label className="field"><span>Note (optional)</span>
          <input value={note} maxLength={120} onChange={(e) => setNote(e.target.value)} placeholder={mode === "restock" ? "Supplier, invoice number" : mode === "waste" ? "Spoiled, dropped, expired" : "Weekly count"} />
        </label>
        {err && <div className="form-error" role="alert">{err}</div>}
      </form>
    </Sheet>
  );
}
