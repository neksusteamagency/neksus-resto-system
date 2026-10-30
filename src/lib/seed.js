import { resolveLines, totals } from "./pricing";
import { startOfToday } from "./format";

export const STATE_VERSION = 1;
const MIN = 60000;

const categories = [
  { id: "c-starters", name: "Starters", order: 1 },
  { id: "c-mains", name: "Mains", order: 2 },
  { id: "c-grill", name: "Grill", order: 3 },
  { id: "c-desserts", name: "Desserts", order: 4 },
  { id: "c-drinks", name: "Drinks", order: 5 },
];

const it = (id, name, description, price, categoryId, station, extra = {}) => ({
  id, name, description, price, categoryId, station,
  popular: false, available: true, extras: [], ...extra,
});

const items = [
  it("i-halloumi", "Grilled Halloumi", "Honey, thyme, toasted sesame", 750, "c-starters", "grill", { popular: true }),
  it("i-hummus", "Hummus Beiruti", "Chickpeas, tahini, chilli oil, warm pita", 600, "c-starters", "cold"),
  it("i-fattoush", "Fattoush", "Crisp greens, sumac, pomegranate molasses", 800, "c-starters", "cold"),
  it("i-kibbeh", "Fried Kibbeh", "Bulgur shell, spiced beef, pine nuts", 900, "c-starters", "kitchen"),
  it("i-burger", "Beef Burger", "Aged cheddar, pickles, house sauce", 1200, "c-mains", "grill", {
    popular: true,
    extras: [{ name: "Extra cheese", price: 150 }, { name: "Bacon", price: 200 }, { name: "Extra patty", price: 400 }],
  }),
  it("i-shawarma", "Chicken Shawarma Plate", "Garlic sauce, pickles, fries", 1050, "c-mains", "kitchen", {
    popular: true,
    extras: [{ name: "Extra garlic sauce", price: 50 }, { name: "Extra fries", price: 200 }],
  }),
  it("i-mujaddara", "Mujaddara", "Lentils, rice, crispy onions, yoghurt", 950, "c-mains", "kitchen"),
  it("i-seabass", "Grilled Sea Bass", "Lemon, herbs, tarator sauce", 1800, "c-mains", "grill", { available: false }),
  it("i-mixed", "Mixed Grill for Two", "Kafta, tawook, lamb chop, sides", 3200, "c-grill", "grill", { popular: true }),
  it("i-tawook", "Shish Tawook", "Marinated chicken skewers, toum, pickles", 1300, "c-grill", "grill"),
  it("i-kafta", "Kafta Skewers", "Spiced beef and parsley, grilled tomato", 1250, "c-grill", "grill"),
  it("i-lamb", "Lamb Chops", "Four chops, garlic, rosemary", 2200, "c-grill", "grill"),
  it("i-knafeh", "Knafeh", "Sweet cheese, semolina, orange blossom syrup", 650, "c-desserts", "kitchen", { popular: true }),
  it("i-baklava", "Pistachio Baklava", "Three pieces, honey syrup", 550, "c-desserts", "cold"),
  it("i-muhallabia", "Muhallabia", "Milk pudding, rose water, pistachio", 500, "c-desserts", "cold"),
  it("i-lemonade", "Fresh Lemonade", "Mint, served over ice", 350, "c-drinks", "cold", { popular: true }),
  it("i-jallab", "Jallab", "Date molasses, rose water, pine nuts", 400, "c-drinks", "cold"),
  it("i-coffee", "Arabic Coffee", "Cardamom, served in a pot", 300, "c-drinks", "kitchen"),
  it("i-water", "Sparkling Water", "500 ml bottle", 250, "c-drinks", "cold"),
];

const tables = [
  { id: "takeaway", label: "Takeaway" },
  ...Array.from({ length: 12 }, (_, i) => ({ id: String(i + 1), label: `Table ${i + 1}` })),
];

const settings = {
  name: "Cedar and Coal",
  openText: "Open until 11:00 PM",
  currency: "$",
  taxRate: 11,
  serviceRate: 0,
  orderingOpen: true,
  publicUrl: "",
  kitchenPin: "1111",
  adminPin: "1234",
};

export function seed() {
  const now = Date.now();
  const today = startOfToday();
  let counter = 200;

  const make = (tableId, lines, ageMin, status, prepMin = 11) => {
    const table = tables.find((t) => t.id === tableId);
    const { lines: priced } = resolveLines(
      items,
      lines.map(([itemId, qty], idx) => ({ key: `${itemId}-${idx}`, itemId, qty, extras: [], note: "" }))
    );
    const t = totals(priced.reduce((s, l) => s + l.total, 0), settings);
    const createdAt = Math.max(today, now - ageMin * MIN);
    counter += 1;
    return {
      id: `o-seed-${counter}`,
      number: counter,
      tableId,
      tableLabel: table.label,
      items: priced.map(({ available, key, itemId, ...rest }) => rest),
      note: "",
      ...t,
      status,
      createdAt,
      startedAt: status !== "new" ? createdAt + 2 * MIN : null,
      readyAt: status === "ready" || status === "served" ? createdAt + prepMin * MIN : null,
      servedAt: status === "served" ? createdAt + (prepMin + 4) * MIN : null,
      cancelledAt: null,
    };
  };

  // A few finished orders so the dashboard has something to show.
  const history = [
    make("3", [["i-mixed", 1], ["i-lemonade", 2]], 300, "served", 16),
    make("8", [["i-burger", 2], ["i-water", 2]], 280, "served", 12),
    make("1", [["i-shawarma", 2], ["i-hummus", 1]], 255, "served", 10),
    make("takeaway", [["i-tawook", 2]], 240, "served", 14),
    make("5", [["i-kafta", 1], ["i-fattoush", 1], ["i-jallab", 2]], 215, "served", 13),
    make("11", [["i-mujaddara", 2], ["i-knafeh", 2]], 190, "served", 9),
    make("2", [["i-lamb", 2], ["i-lemonade", 2]], 170, "served", 18),
    make("6", [["i-burger", 1], ["i-shawarma", 1]], 150, "served", 11),
    make("takeaway", [["i-burger", 3]], 120, "served", 12),
    make("10", [["i-halloumi", 2], ["i-kibbeh", 1], ["i-coffee", 3]], 95, "served", 10),
    make("4", [["i-mixed", 1], ["i-baklava", 2]], 70, "served", 15),
  ];

  const active = [
    make("7", [["i-halloumi", 1], ["i-burger", 1], ["i-lemonade", 2]], 14, "ready"),
    make("takeaway", [["i-burger", 3]], 6, "preparing"),
    make("2", [["i-halloumi", 1], ["i-shawarma", 2]], 8, "preparing"),
    make("4", [["i-burger", 2], ["i-lemonade", 1]], 1, "new"),
    make("9", [["i-mixed", 1], ["i-lemonade", 2]], 0, "new"),
  ];

  return {
    version: STATE_VERSION,
    settings: { ...settings },
    categories: categories.map((c) => ({ ...c })),
    items: items.map((i) => ({ ...i, extras: i.extras.map((e) => ({ ...e })) })),
    tables: tables.map((t) => ({ ...t })),
    orders: [...history, ...active],
    counter,
  };
}
