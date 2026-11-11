import { useCallback, useEffect, useState } from "react";
import { listStaff, createStaff, updateStaff } from "../../lib/staff";
import { listPinned, setStaffPin, listDevices, revokeDevice, registerThisDevice, forgetDevice, useDevice } from "../../lib/pinAuth";
import { signOut } from "../../lib/auth";
import { ROLES, ROLE_LABEL, dateTimeText } from "../../lib/format";
import { Sheet, Empty, Loading } from "../../components/ui";
import { PageHead } from "./shared";

export default function Staff({ show, user }) {
  const isOwner = user.role === "owner";
  const [staff, setStaff] = useState(null);
  const [pinned, setPinned] = useState([]);
  const [devices, setDevices] = useState([]);
  const [adding, setAdding] = useState(false);
  const [pinFor, setPinFor] = useState(null);
  const [settingUp, setSettingUp] = useState(false);
  const thisDevice = useDevice();

  const load = useCallback(async () => {
    const [s, p, d] = await Promise.all([listStaff(), listPinned(), listDevices()]);
    if (s.ok) setStaff(s.staff); else show(s.error);
    setPinned(p);
    if (d.ok) setDevices(d.devices);
  }, [show]);
  useEffect(() => { load(); }, [load]);

  const change = async (p, patch, msg) => {
    const r = await updateStaff(p.id, patch);
    show(r.ok ? msg : r.error);
    load();
  };
  const canSetPin = (p) => isOwner || p.id === user.id || !["owner", "manager"].includes(p.role);

  if (!staff) return <Loading />;
  return (
    <>
      <PageHead title="Staff">{isOwner && <button className="btn primary" onClick={() => setAdding(true)}>Add staff member</button>}</PageHead>
      <p className="muted small-p">Staff sign in with their own account. On shared devices, a manager registers the device once and everyone else signs in with a PIN. Waiters take orders and payments, kitchen staff see the kitchen screen, managers also manage the menu and stock, and owners manage staff.</p>

      {staff.length === 0 ? <Empty title="No staff yet" /> : (
        <div className="table-wrap">
          <table className="data">
            <thead><tr><th>Name</th><th>Role</th><th>PIN</th><th>Status</th><th /></tr></thead>
            <tbody>
              {staff.map((p) => {
                const me = p.id === user.id;
                const has = pinned.includes(p.id);
                return (
                  <tr key={p.id}>
                    <td><strong>{p.name}</strong>{me && <span className="tag">You</span>}</td>
                    <td>
                      <select value={p.role} disabled={me || !isOwner} onChange={(e) => change(p, { role: e.target.value }, "Role updated")} aria-label={`Role for ${p.name}`}>
                        {ROLES.map((r) => <option key={r} value={r}>{ROLE_LABEL[r]}</option>)}
                      </select>
                    </td>
                    <td>
                      <span className={has ? "pill served" : "pill"}>{has ? "PIN set" : "No PIN"}</span>{" "}
                      {canSetPin(p) && <button className="btn sm" onClick={() => setPinFor(p)}>{has ? "Change PIN" : "Set PIN"}</button>}
                    </td>
                    <td><span className={p.active ? "pill served" : "pill cancelled"}>{p.active ? "Active" : "Deactivated"}</span></td>
                    <td className="r">
                      {isOwner && !me && <button className="btn sm" onClick={() => change(p, { active: !p.active }, p.active ? "Account deactivated" : "Account reactivated")}>{p.active ? "Deactivate" : "Reactivate"}</button>}
                    </td>
                  </tr>
                );
              })}
            </tbody>
          </table>
        </div>
      )}

      <section className="panel">
        <h2>PIN sign-in devices</h2>
        <div className="device-card">
          <p className="muted small-p">
            {thisDevice
              ? "This device is set up for PIN sign-in. When someone signs out here, the next person picks their name and enters their PIN."
              : "Set this device up once, and staff can sign in here with a PIN instead of an email and password. You will be signed out afterwards."}
          </p>
          {thisDevice
            ? <button className="btn" onClick={() => window.confirm("Remove PIN sign-in from this device? Staff will need their email and password here.") && (forgetDevice(), show("PIN sign-in removed from this device"))}>Remove from this device</button>
            : <button className="btn primary" onClick={() => setSettingUp(true)}>Set up this device</button>}
        </div>
        {devices.length > 0 && (
          <div className="table-wrap">
            <table className="data">
              <thead><tr><th>Device</th><th>Added</th><th>Last used</th><th /></tr></thead>
              <tbody>
                {devices.map((d) => (
                  <tr key={d.id}>
                    <td><strong>{d.name}</strong>{d.revoked && <span className="tag red">Revoked</span>}</td>
                    <td>{dateTimeText(new Date(d.createdAt).getTime())}</td>
                    <td>{d.lastUsedAt ? dateTimeText(new Date(d.lastUsedAt).getTime()) : "Never"}</td>
                    <td className="r">
                      {!d.revoked && <button className="btn sm danger-text" onClick={async () => { if (!window.confirm(`Revoke “${d.name}”? PIN sign-in will stop working on it.`)) return; const r = await revokeDevice(d.id); show(r.ok ? "Device revoked" : r.error); load(); }}>Revoke</button>}
                    </td>
                  </tr>
                ))}
              </tbody>
            </table>
          </div>
        )}
      </section>

      {adding && <AddStaff onClose={() => setAdding(false)} onDone={() => { setAdding(false); show("Staff member added"); load(); }} />}
      {pinFor && <SetPin person={pinFor} onClose={() => setPinFor(null)} onDone={() => { setPinFor(null); show("PIN saved"); load(); }} />}
      {settingUp && <SetupDevice onClose={() => setSettingUp(false)} />}
    </>
  );
}

function SetPin({ person, onClose, onDone }) {
  const [pin, setPin] = useState("");
  const [err, setErr] = useState("");
  const [busy, setBusy] = useState(false);
  const save = async (e) => {
    e.preventDefault();
    if (!/^\d{4,6}$/.test(pin)) { setErr("A PIN must be 4 to 6 digits."); return; }
    setBusy(true);
    const r = await setStaffPin(person.id, pin);
    setBusy(false);
    if (!r.ok) { setErr(r.error); return; }
    onDone();
  };
  return (
    <Sheet title={`PIN for ${person.name}`} onClose={onClose}
      footer={<><button className="btn" onClick={onClose}>Cancel</button><button className="btn primary" form="pin-set-form" disabled={busy}>{busy ? "Saving…" : "Save PIN"}</button></>}>
      <form id="pin-set-form" onSubmit={save} className="form">
        <p className="muted small-p">Choose 4 to 6 digits that are easy for {person.name} to remember but hard to guess (not 1234 or a birth year). Five wrong tries lock the account for 5 minutes. PINs are stored scrambled and can't be read back.</p>
        <label className="field"><span>New PIN</span>
          <input autoFocus inputMode="numeric" autoComplete="off" value={pin} onChange={(e) => { setPin(e.target.value.replace(/\D/g, "").slice(0, 6)); setErr(""); }} />
        </label>
        {err && <div className="form-error" role="alert">{err}</div>}
      </form>
    </Sheet>
  );
}

function SetupDevice({ onClose }) {
  const [name, setName] = useState("");
  const [err, setErr] = useState("");
  const [busy, setBusy] = useState(false);
  const save = async (e) => {
    e.preventDefault();
    if (!name.trim()) { setErr("Give this device a name."); return; }
    setBusy(true);
    const r = await registerThisDevice(name);
    if (!r.ok) { setBusy(false); setErr(r.error); return; }
    await signOut(); // back to the PIN screen
  };
  return (
    <Sheet title="Set up this device" onClose={onClose}
      footer={<><button className="btn" onClick={onClose}>Cancel</button><button className="btn primary" form="device-form" disabled={busy}>{busy ? "Setting up…" : "Set up and sign out"}</button></>}>
      <form id="device-form" onSubmit={save} className="form">
        <p className="muted small-p">Make sure the staff who will use this device already have a PIN. After setup you are signed out, and the sign-in screen shows staff names with a PIN box.</p>
        <label className="field"><span>Device name</span>
          <input autoFocus value={name} maxLength={40} onChange={(e) => { setName(e.target.value); setErr(""); }} placeholder="e.g. Bar tablet, Kitchen screen" />
        </label>
        {err && <div className="form-error" role="alert">{err}</div>}
      </form>
    </Sheet>
  );
}

function AddStaff({ onClose, onDone }) {
  const [f, setF] = useState({ name: "", email: "", password: "", role: "waiter" });
  const [err, setErr] = useState("");
  const [busy, setBusy] = useState(false);
  const set = (k, v) => { setF((x) => ({ ...x, [k]: v })); setErr(""); };
  const save = async (e) => {
    e.preventDefault();
    if (f.password.length < 8) { setErr("The password needs at least 8 characters."); return; }
    setBusy(true);
    const r = await createStaff(f);
    setBusy(false);
    if (!r.ok) { setErr(r.error); return; }
    onDone();
  };
  return (
    <Sheet title="Add staff member" onClose={onClose}
      footer={<><button className="btn" onClick={onClose}>Cancel</button><button className="btn primary" form="staff-form" disabled={busy}>{busy ? "Creating…" : "Create account"}</button></>}>
      <form id="staff-form" onSubmit={save} className="form">
        <label className="field"><span>Full name</span><input autoFocus required value={f.name} maxLength={40} onChange={(e) => set("name", e.target.value)} /></label>
        <label className="field"><span>Email</span><input type="email" required className="plain" value={f.email} onChange={(e) => set("email", e.target.value)} /></label>
        <label className="field"><span>Password (only used for email sign-in; a PIN can be set afterwards)</span><input type="text" className="plain" value={f.password} autoComplete="off" onChange={(e) => set("password", e.target.value)} /></label>
        <label className="field"><span>Role</span>
          <select value={f.role} onChange={(e) => set("role", e.target.value)}>{ROLES.map((r) => <option key={r} value={r}>{ROLE_LABEL[r]}</option>)}</select>
        </label>
        {err && <div className="form-error" role="alert">{err}</div>}
      </form>
    </Sheet>
  );
}
