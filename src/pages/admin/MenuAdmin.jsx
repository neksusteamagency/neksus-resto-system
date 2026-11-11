import { useState } from "react";
import { useStore, store } from "../../lib/store";
import { money, parsePrice, centsToInput, STATIONS } from "../../lib/format";
import { Sheet, Empty } from "../../components/ui";
import { PageHead } from "./shared";

export default function MenuAdmin({ show }) {
  const { items, categories, settings } = useStore();
  const sym = settings.currency;
  const [q, setQ] = useState("");
  const [edit, setEdit] = useState(null);
  const [catsOpen, setCatsOpen] = useState(false);
  const cats = [...categories].sort((a, b) => a.order - b.order);
  const t = q.trim().toLowerCase();

  const remove = async (i) => {
    if (!window.confirm(`Delete “${i.name}”? Past orders keep their record of it.`)) return;
    const r = await store.deleteItem(i.id);
    show(r.ok ? "Dish deleted" : r.error);
  };

  return (
    <>
      <PageHead title="Menu">
        <button className="btn" onClick={() => setCatsOpen(true)}>Categories</button>
        <button className="btn primary" onClick={() => setEdit({})} disabled={cats.length === 0} title={cats.length === 0 ? "Create a category first" : undefined}>Add dish</button>
      </PageHead>
      <div className="filters">
        <input type="search" placeholder="Search dishes" value={q} onChange={(e) => setQ(e.target.value)} aria-label="Search dishes" />
      </div>
      {cats.length === 0 && <Empty title="No categories yet">Create a category such as Starters, then add dishes to it.</Empty>}
      {cats.map((c) => {
        const list = items.filter((i) => i.categoryId === c.id && (!t || `${i.name} ${i.description}`.toLowerCase().includes(t)));
        if (t && list.length === 0) return null;
        return (
          <section key={c.id} className="panel flush">
            <h2 className="panel-title">{c.name} <span>{list.length}</span></h2>
            {list.length === 0 ? <p className="muted pad">No dishes in this category yet.</p> : (
              <ul className="menu-rows">
                {list.map((i) => (
                  <li key={i.id}>
                    <div className="mr-main">
                      <strong>{i.name}{i.popular && <span className="tag">Popular</span>}{i.available && i.stockOut && <span className="tag red">Out of stock</span>}</strong>
                      <small>{i.description || "No description"}</small>
                    </div>
                    <span className="mr-station">{STATIONS.find((s) => s.id === i.station)?.label}</span>
                    <b className="mr-price">{money(i.price, sym)}</b>
                    <label className="switch" title={i.available ? "Available" : "Sold out"}>
                      <input type="checkbox" checked={i.available} onChange={(e) => store.setItemAvailable(i.id, e.target.checked)} aria-label={`${i.name} available`} />
                      <span />
                    </label>
                    <button className="btn sm" onClick={() => setEdit(i)}>Edit</button>
                    <button className="btn sm danger-text" onClick={() => remove(i)}>Delete</button>
                  </li>
                ))}
              </ul>
            )}
          </section>
        );
      })}
      {edit && <ItemForm item={edit} cats={cats} sym={sym} onClose={() => setEdit(null)} onSaved={(m) => { setEdit(null); show(m); }} />}
      {catsOpen && <Categories cats={cats} items={items} onClose={() => setCatsOpen(false)} show={show} />}
    </>
  );
}

function ItemForm({ item, cats, sym, onClose, onSaved }) {
  const { ingredients } = useStore();
  const isNew = !item.id;
  const [f, setF] = useState({
    name: item.name || "",
    description: item.description || "",
    price: item.price != null ? centsToInput(item.price) : "",
    categoryId: item.categoryId || cats[0]?.id || "",
    station: item.station || "kitchen",
    popular: !!item.popular,
    available: item.available !== false,
    extras: (item.extras || []).map((e) => ({ name: e.name, price: centsToInput(e.price) })),
    recipe: (item.recipe || []).map((r) => ({ ingredientId: r.ingredientId, qty: String(r.qty) })),
  });
  const [err, setErr] = useState("");
  const [busy, setBusy] = useState(false);
  const set = (k, v) => setF((x) => ({ ...x, [k]: v }));
  const setExtra = (i, k, v) => set("extras", f.extras.map((e, idx) => (idx === i ? { ...e, [k]: v } : e)));
  const setRecipe = (i, k, v) => set("recipe", f.recipe.map((e, idx) => (idx === i ? { ...e, [k]: v } : e)));

  const save = async (e) => {
    e.preventDefault();
    const price = parsePrice(f.price);
    if (price === null) { setErr("Enter a valid price, for example 7.50."); return; }
    const extras = [];
    for (const x of f.extras) {
      if (!x.name.trim() && !String(x.price).trim()) continue;
      const p = parsePrice(x.price);
      if (!x.name.trim() || p === null) { setErr("Each extra needs a name and a valid price."); return; }
      extras.push({ name: x.name, price: p });
    }
    const recipe = [];
    for (const r of f.recipe) {
      if (!r.ingredientId && !String(r.qty).trim()) continue;
      const qty = Number(String(r.qty).replace(",", "."));
      if (!r.ingredientId || !Number.isFinite(qty) || qty <= 0) { setErr("Each recipe line needs an ingredient and a quantity above zero."); return; }
      recipe.push({ ingredientId: r.ingredientId, qty });
    }
    setBusy(true);
    const res = await store.upsertItem({ ...f, id: item.id, price, extras, recipe });
    setBusy(false);
    if (!res.ok) { setErr(res.error); return; }
    onSaved(isNew ? "Dish added" : "Dish saved");
  };
  const unitOf = (id) => ingredients.find((g) => g.id === id)?.unit || "";

  return (
    <Sheet title={isNew ? "Add dish" : "Edit dish"} onClose={onClose} wide
      footer={<><button className="btn" onClick={onClose}>Cancel</button><button className="btn primary" form="item-form" disabled={busy}>Save dish</button></>}>
      <form id="item-form" onSubmit={save} className="form">
        <label className="field"><span>Name</span><input autoFocus value={f.name} onChange={(e) => set("name", e.target.value)} maxLength={60} required /></label>
        <label className="field"><span>Description</span><input value={f.description} onChange={(e) => set("description", e.target.value)} maxLength={120} /></label>
        <div className="grid2">
          <label className="field"><span>Price ({sym})</span><input inputMode="decimal" value={f.price} onChange={(e) => set("price", e.target.value)} placeholder="0.00" required /></label>
          <label className="field"><span>Category</span>
            <select value={f.categoryId} onChange={(e) => set("categoryId", e.target.value)}>{cats.map((c) => <option key={c.id} value={c.id}>{c.name}</option>)}</select>
          </label>
        </div>
        <label className="field"><span>Kitchen station</span>
          <select value={f.station} onChange={(e) => set("station", e.target.value)}>{STATIONS.map((s) => <option key={s.id} value={s.id}>{s.label}</option>)}</select>
        </label>
        <div className="checks">
          <label className="check"><input type="checkbox" checked={f.popular} onChange={(e) => set("popular", e.target.checked)} /><span>Show in Popular</span></label>
          <label className="check"><input type="checkbox" checked={f.available} onChange={(e) => set("available", e.target.checked)} /><span>Available to order</span></label>
        </div>
        <fieldset className="extras-edit">
          <legend>Extras (optional)</legend>
          {f.extras.map((x, i) => (
            <div key={i} className="extra-row">
              <input placeholder="Extra cheese" value={x.name} maxLength={40} onChange={(e) => setExtra(i, "name", e.target.value)} aria-label="Extra name" />
              <input placeholder="1.50" inputMode="decimal" value={x.price} onChange={(e) => setExtra(i, "price", e.target.value)} aria-label="Extra price" />
              <button type="button" className="btn sm danger-text" onClick={() => set("extras", f.extras.filter((_, idx) => idx !== i))}>Remove</button>
            </div>
          ))}
          <button type="button" className="btn sm" onClick={() => set("extras", [...f.extras, { name: "", price: "" }])}>Add extra</button>
        </fieldset>
        <fieldset className="extras-edit">
          <legend>Recipe: stock used per portion (optional)</legend>
          {ingredients.length === 0 && <p className="muted small-p">Add ingredients in Inventory first.</p>}
          {f.recipe.map((r, i) => (
            <div key={i} className="extra-row recipe">
              <select value={r.ingredientId} onChange={(e) => setRecipe(i, "ingredientId", e.target.value)} aria-label="Ingredient">
                <option value="">Choose ingredient</option>
                {ingredients.map((g) => <option key={g.id} value={g.id}>{g.name}</option>)}
              </select>
              <span className="qty-in">
                <input inputMode="decimal" placeholder="1" value={r.qty} onChange={(e) => setRecipe(i, "qty", e.target.value)} aria-label="Quantity per portion" />
                <em>{unitOf(r.ingredientId)}</em>
              </span>
              <button type="button" className="btn sm danger-text" onClick={() => set("recipe", f.recipe.filter((_, idx) => idx !== i))}>Remove</button>
            </div>
          ))}
          {ingredients.length > 0 && <button type="button" className="btn sm" onClick={() => set("recipe", [...f.recipe, { ingredientId: "", qty: "" }])}>Add ingredient</button>}
        </fieldset>
        {err && <div className="form-error" role="alert">{err}</div>}
      </form>
    </Sheet>
  );
}

function Categories({ cats, items, onClose, show }) {
  const [name, setName] = useState("");
  const [editing, setEditing] = useState(null);
  const [err, setErr] = useState("");
  const run = async (promise, msg) => {
    const res = await promise;
    if (!res.ok) setErr(res.error); else { setErr(""); if (msg) show(msg); }
    return res.ok;
  };

  return (
    <Sheet title="Categories" onClose={onClose}>
      <ul className="cat-list">
        {cats.map((c, i) => (
          <li key={c.id}>
            {editing?.id === c.id ? (
              <form onSubmit={async (e) => { e.preventDefault(); if (await run(store.upsertCategory(editing), "Category renamed")) setEditing(null); }}>
                <input autoFocus value={editing.name} maxLength={30} onChange={(e) => setEditing({ ...editing, name: e.target.value })} aria-label="Category name" />
                <button className="btn sm primary">Save</button>
                <button type="button" className="btn sm" onClick={() => setEditing(null)}>Cancel</button>
              </form>
            ) : (
              <>
                <span>{c.name} <small>{items.filter((x) => x.categoryId === c.id).length} dishes</small></span>
                <span className="cat-actions">
                  <button className="btn sm" disabled={i === 0} onClick={() => store.moveCategory(c.id, -1)} aria-label={`Move ${c.name} up`}>↑</button>
                  <button className="btn sm" disabled={i === cats.length - 1} onClick={() => store.moveCategory(c.id, 1)} aria-label={`Move ${c.name} down`}>↓</button>
                  <button className="btn sm" onClick={() => setEditing({ id: c.id, name: c.name })}>Rename</button>
                  <button className="btn sm danger-text" onClick={() => window.confirm(`Delete category “${c.name}”?`) && run(store.deleteCategory(c.id), "Category deleted")}>Delete</button>
                </span>
              </>
            )}
          </li>
        ))}
      </ul>
      <form className="inline-form" onSubmit={async (e) => { e.preventDefault(); if (await run(store.upsertCategory({ name }), "Category added")) setName(""); }}>
        <input placeholder="New category name" value={name} maxLength={30} onChange={(e) => { setName(e.target.value); setErr(""); }} aria-label="New category name" />
        <button className="btn primary" disabled={!name.trim()}>Add category</button>
      </form>
      {err && <div className="form-error" role="alert">{err}</div>}
    </Sheet>
  );
}
