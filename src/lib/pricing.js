// Prices are stored as integer cents everywhere to avoid floating point errors.

// lines: [{ key, itemId, qty, extras: [extraName], note }]
// Returns lines priced from the *current* menu, plus any problems (sold-out items).
export function resolveLines(items, lines) {
  const resolved = [];
  const problems = [];
  for (const l of lines) {
    const it = items.find((i) => i.id === l.itemId);
    if (!it) continue; // item was deleted from the menu
    const extras = (l.extras || [])
      .map((n) => (it.extras || []).find((e) => e.name === n))
      .filter(Boolean)
      .map((e) => ({ name: e.name, price: e.price }));
    const unit = it.price + extras.reduce((s, e) => s + e.price, 0);
    const qty = Math.max(1, Math.min(50, Math.floor(Number(l.qty)) || 1));
    const soldOut = it.soldOut ?? !it.available;
    if (soldOut) problems.push({ key: l.key, name: it.name });
    resolved.push({
      key: l.key,
      itemId: it.id,
      name: it.name,
      station: it.station,
      extras,
      note: String(l.note || "").trim().slice(0, 140),
      qty,
      unit,
      total: unit * qty,
      available: !soldOut,
    });
  }
  return { lines: resolved, problems };
}

export function totals(subtotal, settings) {
  const tax = Math.round((subtotal * (Number(settings.taxRate) || 0)) / 100);
  const service = Math.round((subtotal * (Number(settings.serviceRate) || 0)) / 100);
  return { subtotal, tax, service, total: subtotal + tax + service };
}
