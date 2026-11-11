export const STATIONS = [
  { id: "grill", label: "Grill" },
  { id: "kitchen", label: "Kitchen" },
  { id: "cold", label: "Cold" },
];

export const STATUS_LABEL = {
  new: "New",
  preparing: "Preparing",
  ready: "Ready",
  served: "Served",
  cancelled: "Cancelled",
};

export const ACTIVE = ["new", "preparing", "ready"];

export const money = (cents, symbol = "$") => `${symbol}${(cents / 100).toFixed(2)}`;

// Returns cents, or null when the text is not a valid non-negative price.
export const parsePrice = (text) => {
  const t = String(text ?? "").trim().replace(",", ".");
  if (t === "") return null;
  const n = Number(t);
  return Number.isFinite(n) && n >= 0 && n < 100000 ? Math.round(n * 100) : null;
};

export const centsToInput = (c) => (c / 100).toFixed(2);

export const minutesSince = (ts, now) => Math.max(0, Math.floor((now - ts) / 60000));
export const waitText = (ts, now) => {
  const m = minutesSince(ts, now);
  return m < 1 ? "just now" : `${m} min`;
};

export const timeText = (ts) =>
  new Date(ts).toLocaleTimeString([], { hour: "numeric", minute: "2-digit" });

export const dateTimeText = (ts) =>
  new Date(ts).toLocaleString([], { month: "short", day: "numeric", hour: "numeric", minute: "2-digit" });

export const startOfToday = () => {
  const d = new Date();
  d.setHours(0, 0, 0, 0);
  return d.getTime();
};

export const initials = (n) =>
  String(n).split(" ").filter(Boolean).slice(0, 2).map((w) => w[0]).join("").toUpperCase();

export const uid = (prefix = "id") =>
  `${prefix}-${Math.random().toString(36).slice(2, 8)}${Date.now().toString(36).slice(-4)}`;

export const slug = (s) =>
  String(s).toLowerCase().trim().replace(/[^a-z0-9]+/g, "-").replace(/^-+|-+$/g, "") || "table";

export const sum = (arr, fn = (x) => x) => arr.reduce((s, x) => s + fn(x), 0);

export const UNITS = ["pcs", "kg", "g", "l", "ml", "portion"];
export const ROLES = ["owner", "manager", "waiter", "kitchen"];
export const ROLE_LABEL = { owner: "Owner", manager: "Manager", waiter: "Waiter", kitchen: "Kitchen" };
export const PAY_METHODS = [
  { id: "cash", label: "Cash" },
  { id: "card", label: "Card" },
  { id: "other", label: "Other" },
];

// Stock quantities may be fractional (e.g. 0.25 kg). Show up to 3 decimals, no trailing zeros.
export const qtyText = (n) => String(Math.round(Number(n) * 1000) / 1000);
