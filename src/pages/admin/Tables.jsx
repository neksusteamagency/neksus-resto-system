import { useEffect, useState } from "react";
import QRCode from "qrcode";
import { useStore, store } from "../../lib/store";
import { OPEN_TAB } from "../../lib/billing";
import { PageHead } from "./shared";

function QRImage({ url, label, size = 220 }) {
  const [src, setSrc] = useState("");
  useEffect(() => {
    let live = true;
    QRCode.toDataURL(url, { margin: 1, width: size, errorCorrectionLevel: "M" }).then((d) => live && setSrc(d)).catch(() => live && setSrc(""));
    return () => { live = false; };
  }, [url, size]);
  return src ? <img src={src} alt={`QR code for ${label}`} width={size} height={size} /> : <div className="qr-ph" style={{ width: size, height: size }} />;
}

export default function Tables({ show }) {
  const { tables, settings, tabs } = useStore();
  const [label, setLabel] = useState("");
  const [err, setErr] = useState("");
  const base = (settings.publicUrl || window.location.origin).replace(/\/+$/, "");
  const urlFor = (t) => `${base}/t/${t.id}`;

  const add = async (e) => {
    e.preventDefault();
    const r = await store.addTable(label);
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
  const remove = async (t) => {
    if (!window.confirm(`Remove ${t.label}? Its printed QR code will stop working.`)) return;
    const r = await store.deleteTable(t.id);
    show(r.ok ? "Table removed" : r.error);
  };
  const busy = (t) => tabs.some((x) => x.tableId === t.id && OPEN_TAB.includes(x.status));

  return (
    <>
      <PageHead title="Tables & QR codes"><button className="btn" onClick={() => window.print()}>Print all QR codes</button></PageHead>
      {!settings.publicUrl && (
        <div className="banner warn">QR codes currently point to <b>{window.location.origin}</b>. Before printing, set your public website address in Settings so they work for customers.</div>
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
              {t.id !== "takeaway" && <button className="btn sm danger-text" onClick={() => remove(t)} disabled={busy(t)} title={busy(t) ? "This table has an open bill" : undefined}>Remove</button>}
            </div>
          </article>
        ))}
      </div>
    </>
  );
}
