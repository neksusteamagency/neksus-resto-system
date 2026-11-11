// Receipt and kitchen ticket printing for thermal printers (58 mm and 80 mm paper).
// The browser's print dialog is used, so it works with any printer installed on the device.
// For one-click printing without the dialog, start Chrome with --kiosk-printing.
import { money, dateTimeText, STATIONS, STATUS_LABEL } from "./format.js";

export const esc = (s) =>
  String(s ?? "").replace(/[&<>"']/g, (c) => ({ "&": "&amp;", "<": "&lt;", ">": "&gt;", '"': "&quot;", "'": "&#39;" }[c]));

const css = (w) => `
@page { size: ${w}mm auto; margin: 0; }
* { box-sizing: border-box; }
html, body { margin: 0; background: #fff; }
body { width: ${w}mm; padding: 4mm 3mm; font: ${w === 58 ? 11 : 12.5}px/1.35 "Courier New", ui-monospace, monospace; color: #000; }
.page { break-after: page; }
.page:last-child { break-after: auto; }
.c { text-align: center; }
.b { font-weight: 700; }
.big { font-size: 1.6em; line-height: 1.15; }
.xl { font-size: 2.2em; line-height: 1.1; font-weight: 700; }
.row { display: flex; justify-content: space-between; gap: 6px; }
.row > span:first-child { flex: 1; min-width: 0; overflow-wrap: anywhere; }
.row > span:last-child { white-space: nowrap; }
.sub { padding-left: 1.2em; }
.mut { opacity: 0.8; }
hr { border: 0; border-top: 1px dashed #000; margin: 6px 0; }
.item { font-size: 1.15em; font-weight: 700; margin-top: 4px; }
.note { font-weight: 700; }
.stamp { border: 2px solid #000; display: inline-block; padding: 1px 8px; margin: 4px 0; font-weight: 700; letter-spacing: .1em; }
`;

export const wrapDoc = (pages, width = 80, title = "Print") =>
  `<!doctype html><html><head><meta charset="utf-8"><title>${esc(title)}</title><style>${css(Number(width) === 58 ? 58 : 80)}</style></head><body>${pages
    .map((p) => `<div class="page">${p}</div>`).join("")}</body></html>`;

/* ---------- receipt ---------- */
export function receiptBody({ settings, tab, bill, orders }) {
  const sym = settings.currency;
  const lines = [];
  for (const o of orders.filter((x) => x.tabId === tab.id && x.status !== "cancelled")) {
    for (const l of o.items) if (!l.voided) lines.push(l);
  }
  // Merge identical lines so the receipt is short.
  const merged = [];
  for (const l of lines) {
    const key = [l.name, l.unit, l.extras.map((e) => e.name).join("+")].join("|");
    const hit = merged.find((m) => m.key === key);
    if (hit) { hit.qty += l.qty; hit.total += l.total; } else merged.push({ key, ...l });
  }
  const row = (a, b, cls = "") => `<div class="row ${cls}"><span>${esc(a)}</span><span>${esc(b)}</span></div>`;
  const h = [];
  h.push(`<div class="c b big">${esc(settings.name)}</div>`);
  if (settings.receiptHeader) h.push(`<div class="c">${esc(settings.receiptHeader)}</div>`);
  if (settings.businessAddress) h.push(`<div class="c">${esc(settings.businessAddress)}</div>`);
  if (settings.businessPhone) h.push(`<div class="c">${esc(settings.businessPhone)}</div>`);
  if (settings.taxId) h.push(`<div class="c">Tax ID: ${esc(settings.taxId)}</div>`);
  h.push("<hr>");
  h.push(row(`Bill #${tab.number}`, tab.tableLabel));
  h.push(row(dateTimeText(tab.openedAt), tab.waiter ? `Served by ${tab.waiter}` : ""));
  h.push("<hr>");
  for (const l of merged) {
    h.push(row(`${l.qty}× ${l.name}`, money(l.total, sym)));
    for (const e of l.extras) h.push(`<div class="sub mut">+ ${esc(e.name)}</div>`);
  }
  h.push("<hr>");
  h.push(row("Subtotal", money(bill.subtotal, sym)));
  if (bill.discount > 0) {
    const d = tab.discount;
    h.push(row(`Discount${d?.type === "percent" ? ` (${d.value}%)` : ""}`, `-${money(bill.discount, sym)}`));
  }
  if (tab.taxRate > 0) h.push(row(`VAT (${tab.taxRate}%)`, money(bill.tax, sym)));
  if (tab.serviceRate > 0) h.push(row(`Service (${tab.serviceRate}%)`, money(bill.service, sym)));
  h.push(row("TOTAL", money(bill.total, sym), "b big"));
  if (tab.payments.length) {
    h.push("<hr>");
    for (const p of tab.payments) h.push(row(`Paid · ${p.method}`, money(p.amount, sym)));
    if (bill.due > 0) h.push(row("Balance due", money(bill.due, sym), "b"));
    else h.push(`<div class="c"><span class="stamp">PAID</span></div>`);
  }
  h.push("<hr>");
  if (settings.receiptFooter) h.push(`<div class="c">${esc(settings.receiptFooter)}</div>`);
  return h.join("");
}

export function receiptHtml(data) {
  const copies = Math.max(1, Math.min(5, Number(data.settings.receiptCopies) || 1));
  const body = receiptBody(data);
  return wrapDoc(Array.from({ length: copies }, () => body), data.settings.paperWidth, `Receipt #${data.tab.number}`);
}

/* ---------- kitchen ticket ---------- */
export function ticketGroups(order, settings) {
  const live = order.items.filter((l) => !l.voided);
  if (!settings.kitchenSplitStations) return [{ station: null, lines: live }];
  return STATIONS.map((s) => ({ station: s.id, lines: live.filter((l) => l.station === s.id) })).filter((g) => g.lines.length);
}

export function ticketBody(order, group) {
  const h = [];
  h.push(`<div class="c xl">#${order.number}</div>`);
  h.push(`<div class="c b big">${esc(order.tableLabel)}</div>`);
  if (group.station) h.push(`<div class="c"><span class="stamp">${esc(STATIONS.find((s) => s.id === group.station)?.label.toUpperCase())}</span></div>`);
  h.push(`<div class="row"><span>${esc(dateTimeText(order.createdAt))}</span><span>${esc(order.placedBy ? order.placedBy : "Guest order")}</span></div>`);
  h.push("<hr>");
  for (const l of group.lines) {
    h.push(`<div class="item">${l.qty}× ${esc(l.name)}</div>`);
    for (const e of l.extras) h.push(`<div class="sub">+ ${esc(e.name)}</div>`);
    if (l.note) h.push(`<div class="sub note">** ${esc(l.note)} **</div>`);
  }
  if (order.note) { h.push("<hr>"); h.push(`<div class="note">NOTE: ${esc(order.note)}</div>`); }
  h.push("<hr>");
  h.push(`<div class="c mut">${esc(STATUS_LABEL[order.status] || "")} · end of ticket</div>`);
  return h.join("");
}

// One document with a ticket per order (and per station when tickets are split).
export function kitchenTicketsHtml(orders, settings) {
  const list = Array.isArray(orders) ? orders : [orders];
  const pages = list.flatMap((o) => ticketGroups(o, settings).map((g) => ticketBody(o, g)));
  return wrapDoc(pages, settings.paperWidth, `Ticket #${list[0]?.number ?? ""}`);
}

/* ---------- printing ---------- */
export function printHtml(html) {
  const f = document.createElement("iframe");
  f.setAttribute("aria-hidden", "true");
  f.setAttribute("tabindex", "-1");
  Object.assign(f.style, { position: "fixed", right: "0", bottom: "0", width: "0", height: "0", border: "0" });
  document.body.appendChild(f);
  const w = f.contentWindow;
  const d = f.contentDocument;
  d.open(); d.write(html); d.close();
  const cleanup = () => setTimeout(() => f.remove(), 500);
  const go = () => {
    try { w.addEventListener("afterprint", cleanup); w.focus(); w.print(); } catch { cleanup(); }
    setTimeout(() => f.isConnected && f.remove(), 120000);
  };
  setTimeout(go, 150);
}

// Sample data for the "test print" buttons in Settings.
export function sampleReceiptData(settings) {
  const now = Date.now();
  const line = (name, qty, unit, extras = []) => ({ name, qty, unit: unit, total: unit * qty, extras, note: "", station: "grill", voided: null });
  const items = [line("Grilled Halloumi", 1, 750), line("Beef Burger", 2, 1350, [{ name: "Extra cheese", price: 150 }]), line("Fresh Lemonade", 2, 350)];
  const subtotal = items.reduce((s, l) => s + l.total, 0);
  const tax = Math.round((subtotal * settings.taxRate) / 100);
  const service = Math.round((subtotal * settings.serviceRate) / 100);
  const total = subtotal + tax + service;
  const tab = {
    id: "sample", number: 123, tableLabel: "Table 7", tableId: "7", status: "paid", openedAt: now, waiter: "Rami",
    taxRate: settings.taxRate, serviceRate: settings.serviceRate, discount: null,
    payments: [{ id: "p", method: "cash", amount: total, at: now, by: "Rami" }],
  };
  const orders = [{ id: "o", tabId: "sample", status: "served", items }];
  return { settings, tab, orders, bill: { subtotal, discount: 0, net: subtotal, tax, service, total, paid: total, due: 0 } };
}

export function sampleOrder() {
  const now = Date.now();
  const l = (name, qty, station, extras = [], note = "") => ({ name, qty, station, extras, note, voided: null });
  return {
    number: 214, tableLabel: "Table 7", placedBy: "Rami", createdAt: now, status: "new", note: "Birthday table, bring dessert last",
    items: [l("Beef Burger", 2, "grill", [{ name: "Extra cheese", price: 150 }], "no pickles"), l("Fresh Lemonade", 2, "cold"), l("Hummus Beiruti", 1, "cold")],
  };
}
