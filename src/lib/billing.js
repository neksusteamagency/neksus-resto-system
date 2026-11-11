import { sum } from "./format.js";

export const OPEN_TAB = ["open", "bill"];

// The bill for a tab, calculated from its non-cancelled orders and non-voided lines.
// VAT and service are charged on the amount after the discount.
export function billOf(tab, orders) {
  const lines = orders
    .filter((o) => o.tabId === tab.id && o.status !== "cancelled")
    .flatMap((o) => o.items.filter((l) => !l.voided));
  const subtotal = sum(lines, (l) => l.total);
  let discount = 0;
  if (tab.discount) {
    discount = tab.discount.type === "percent"
      ? Math.round((subtotal * tab.discount.value) / 100)
      : Math.min(subtotal, tab.discount.value);
  }
  const net = subtotal - discount;
  const tax = Math.round((net * tab.taxRate) / 100);
  const service = Math.round((net * tab.serviceRate) / 100);
  const total = net + tax + service;
  const paid = sum(tab.payments, (p) => p.amount);
  return { subtotal, discount, net, tax, service, total, paid, due: Math.max(0, total - paid) };
}

export const discountPercent = (tab, subtotal) => {
  if (!tab.discount || subtotal <= 0) return 0;
  return tab.discount.type === "percent" ? tab.discount.value : (tab.discount.value / subtotal) * 100;
};

// What a table looks like to a waiter.
export function tableStatus(table, tabs, orders, requests) {
  const tab = tabs.find((t) => t.tableId === table.id && OPEN_TAB.includes(t.status));
  const reqs = requests.filter((r) => r.tableId === table.id && r.status === "open");
  if (!tab) return { key: reqs.length ? "call" : "free", tab: null, reqs };
  const mine = orders.filter((o) => o.tabId === tab.id);
  let key = "busy";
  if (tab.status === "bill") key = "bill";
  if (mine.some((o) => o.status === "ready")) key = "ready";
  if (reqs.some((r) => r.type === "waiter") && key === "busy") key = "call";
  return { key, tab, reqs };
}
