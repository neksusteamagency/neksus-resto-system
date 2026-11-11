import { useState } from "react";
import { useStore, store } from "../../lib/store";
import { REMOTE } from "../../lib/config";
import { receiptHtml, kitchenTicketsHtml, sampleReceiptData, sampleOrder } from "../../lib/print";
import PrintPreview from "../../components/PrintPreview";
import { PageHead } from "./shared";

const pct = (v) => { const n = Number(String(v).replace(",", ".")); return Number.isFinite(n) && n >= 0 && n <= 100 ? n : null; };

export default function Settings({ show }) {
  const { settings } = useStore();
  const [f, setF] = useState({
    ...settings,
    taxRate: String(settings.taxRate), serviceRate: String(settings.serviceRate),
    waiterMaxDiscount: String(settings.waiterMaxDiscount ?? 10), receiptCopies: String(settings.receiptCopies ?? 1),
    paperWidth: String(settings.paperWidth ?? 80),
  });
  const [err, setErr] = useState("");
  const [preview, setPreview] = useState(null);
  const [busy, setBusy] = useState(false);
  const set = (k, v) => { setF((x) => ({ ...x, [k]: v })); setErr(""); };

  const parsed = () => {
    const tax = pct(f.taxRate), service = pct(f.serviceRate), maxDisc = pct(f.waiterMaxDiscount);
    const copies = Math.floor(Number(f.receiptCopies));
    if (!f.name.trim()) return "Enter the restaurant name.";
    if (!f.currency.trim()) return "Enter a currency symbol.";
    if (tax === null || service === null) return "VAT and service must be numbers between 0 and 100.";
    if (maxDisc === null) return "The waiter discount limit must be between 0 and 100.";
    if (!Number.isFinite(copies) || copies < 1 || copies > 5) return "Receipt copies must be between 1 and 5.";
    if (!REMOTE) {
      if (![f.kitchenPin, f.waiterPin, f.adminPin].every((p) => /^\d{4,8}$/.test(p))) return "PINs must be 4 to 8 digits.";
      if (new Set([f.kitchenPin, f.waiterPin, f.adminPin]).size !== 3) return "Use a different PIN for each role.";
    }
    if (f.publicUrl.trim() && !/^https?:\/\/[^\s]+$/i.test(f.publicUrl.trim())) return "The public website address must start with http:// or https://";
    return { tax, service, maxDisc, copies };
  };

  const values = (p) => ({
    name: f.name.trim(), openText: f.openText.trim(), currency: f.currency.trim().slice(0, 3),
    taxRate: p.tax, serviceRate: p.service, orderingOpen: f.orderingOpen, customerRequests: f.customerRequests,
    blockOutOfStock: f.blockOutOfStock, publicUrl: f.publicUrl.trim().replace(/\/+$/, ""),
    waiterCanVoid: f.waiterCanVoid, waiterMaxDiscount: p.maxDisc,
    businessAddress: f.businessAddress.trim(), businessPhone: f.businessPhone.trim(), taxId: f.taxId.trim(),
    receiptHeader: f.receiptHeader.trim(), receiptFooter: f.receiptFooter.trim(),
    paperWidth: Number(f.paperWidth) === 58 ? 58 : 80, receiptCopies: p.copies,
    kitchenAutoPrint: f.kitchenAutoPrint, kitchenSplitStations: f.kitchenSplitStations,
    ...(REMOTE ? {} : { kitchenPin: f.kitchenPin, waiterPin: f.waiterPin, adminPin: f.adminPin }),
  });

  const save = async (e) => {
    e.preventDefault();
    const p = parsed();
    if (typeof p === "string") { setErr(p); return; }
    setBusy(true);
    const r = await store.updateSettings(values(p));
    setBusy(false);
    if (!r.ok) { setErr(r.error); return; }
    show("Settings saved");
  };

  // Test prints use what is typed in the form, even before saving.
  const test = (kind) => {
    const p = parsed();
    if (typeof p === "string") { setErr(p); return; }
    const s = { ...settings, ...values(p) };
    setPreview(kind === "receipt"
      ? { title: "Test receipt", html: receiptHtml(sampleReceiptData(s)), width: s.paperWidth }
      : { title: "Test kitchen ticket", html: kitchenTicketsHtml(sampleOrder(), s), width: s.paperWidth });
  };

  const Toggle = ({ k, title, hint }) => (
    <label className="check big">
      <input type="checkbox" checked={!!f[k]} onChange={(e) => set(k, e.target.checked)} />
      <span>{title}<small>{hint}</small></span>
    </label>
  );

  return (
    <>
      <PageHead title="Settings" />
      <form className="settings" onSubmit={save}>
        <section className="panel form">
          <h2>Ordering</h2>
          <Toggle k="orderingOpen" title="Accept orders from customers" hint="Turn this off during a rush or when the kitchen is closed. Customers can still browse, and waiters can still take orders." />
          <Toggle k="customerRequests" title="Show “Call waiter” and “Request bill” to customers" hint="Customers at a table can alert their waiter from the menu." />
          <Toggle k="blockOutOfStock" title="Hide dishes automatically when ingredients run out" hint="Uses the recipes in Inventory. When off, stock still goes down but ordering is never blocked." />
        </section>

        <section className="panel form">
          <h2>Restaurant</h2>
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
          <p className="muted small-p">VAT and service rates are fixed on a bill when it is opened, so changing them affects new bills only.</p>
        </section>

        <section className="panel form">
          <h2>Waiters and bills</h2>
          <Toggle k="waiterCanVoid" title="Waiters can remove items from a bill" hint="A reason is always required and every removal is logged. Managers can always remove items." />
          <label className="field narrow"><span>Largest discount a waiter can give (%)</span><input inputMode="decimal" value={f.waiterMaxDiscount} onChange={(e) => set("waiterMaxDiscount", e.target.value)} /></label>
        </section>

        <section className="panel form">
          <h2>Printing</h2>
          <div className="grid2">
            <label className="field"><span>Paper width</span>
              <select value={f.paperWidth} onChange={(e) => set("paperWidth", e.target.value)}>
                <option value="80">80 mm</option>
                <option value="58">58 mm</option>
              </select>
            </label>
            <label className="field"><span>Receipt copies</span><input inputMode="numeric" value={f.receiptCopies} onChange={(e) => set("receiptCopies", e.target.value.replace(/\D/g, "").slice(0, 1))} /></label>
          </div>
          <label className="field"><span>Business address (on receipt)</span><input value={f.businessAddress} maxLength={80} onChange={(e) => set("businessAddress", e.target.value)} /></label>
          <div className="grid2">
            <label className="field"><span>Phone (on receipt)</span><input value={f.businessPhone} maxLength={30} onChange={(e) => set("businessPhone", e.target.value)} /></label>
            <label className="field"><span>Tax registration number</span><input value={f.taxId} maxLength={30} onChange={(e) => set("taxId", e.target.value)} /></label>
          </div>
          <label className="field"><span>Receipt header line</span><input value={f.receiptHeader} maxLength={60} onChange={(e) => set("receiptHeader", e.target.value)} placeholder="Optional" /></label>
          <label className="field"><span>Receipt footer</span><textarea rows={2} value={f.receiptFooter} maxLength={120} onChange={(e) => set("receiptFooter", e.target.value)} /></label>
          <Toggle k="kitchenSplitStations" title="Print one kitchen ticket per station" hint="An order with grill and cold items prints a separate ticket for each station." />
          <Toggle k="kitchenAutoPrint" title="Print kitchen tickets automatically when an order arrives" hint="Works while the kitchen screen is open. For silent printing without the print dialog, start Chrome with --kiosk-printing on the kitchen device." />
          <div className="row-actions">
            <button type="button" className="btn" onClick={() => test("ticket")}>Preview kitchen ticket</button>
            <button type="button" className="btn" onClick={() => test("receipt")}>Preview receipt</button>
          </div>
        </section>

        <section className="panel form">
          <h2>Staff access</h2>
          {REMOTE ? (
            <p className="muted small-p">Staff sign in with their own accounts. The owner manages them on the Staff page.</p>
          ) : (
            <>
              <p className="muted small-p">Demo PINs. In Supabase mode these are replaced by real staff accounts.</p>
              <div className="grid3">
                <label className="field"><span>Kitchen PIN</span><input inputMode="numeric" value={f.kitchenPin} maxLength={8} onChange={(e) => set("kitchenPin", e.target.value.replace(/\D/g, ""))} /></label>
                <label className="field"><span>Waiter PIN</span><input inputMode="numeric" value={f.waiterPin} maxLength={8} onChange={(e) => set("waiterPin", e.target.value.replace(/\D/g, ""))} /></label>
                <label className="field"><span>Admin PIN</span><input inputMode="numeric" value={f.adminPin} maxLength={8} onChange={(e) => set("adminPin", e.target.value.replace(/\D/g, ""))} /></label>
              </div>
            </>
          )}
        </section>

        {err && <div className="form-error" role="alert">{err}</div>}
        <div className="form-actions"><button className="btn primary" disabled={busy}>Save settings</button></div>
      </form>

      {!REMOTE && (
        <section className="panel danger-zone">
          <h2>Demo data</h2>
          <p className="muted">Restore the sample menu, tables, stock and orders. This removes everything you have added in this browser.</p>
          <button className="btn danger" onClick={async () => { if (window.confirm("Reset all data to the sample restaurant?")) { await store.resetDemo(); show("Sample data restored"); } }}>Reset demo data</button>
        </section>
      )}
      {preview && <PrintPreview {...preview} onClose={() => setPreview(null)} />}
    </>
  );
}
