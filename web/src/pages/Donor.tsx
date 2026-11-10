import { FormEvent, useEffect, useMemo, useState } from "react";
import { publicApi } from "../api";
import { BLOOD_GROUPS, BankNeed, errText } from "../types";

const LOCALITIES: { name: string; lat: number; lng: number }[] = [
  { name: "Indiranagar", lat: 12.9784, lng: 77.6408 },
  { name: "Jayanagar", lat: 12.925, lng: 77.5938 },
  { name: "Whitefield", lat: 12.9698, lng: 77.75 },
  { name: "Yelahanka", lat: 13.1007, lng: 77.5963 },
  { name: "Malleshwaram", lat: 13.0035, lng: 77.5709 },
  { name: "Koramangala", lat: 12.9352, lng: 77.6245 },
  { name: "Electronic City", lat: 12.8452, lng: 77.6602 },
  { name: "Kengeri", lat: 12.9177, lng: 77.4838 },
  { name: "Kolar", lat: 13.1367, lng: 78.1292 },
  { name: "Tumakuru", lat: 13.3409, lng: 77.101 },
  { name: "Ramanagara", lat: 12.7209, lng: 77.2799 },
];

const NAME_RE = /^[A-Za-z]{1,30}$/;

export default function Donor() {
  const [firstName, setFirstName] = useState("");
  const [group, setGroup] = useState("");
  const [locality, setLocality] = useState("");
  const [lastDonated, setLastDonated] = useState("");
  const [consent, setConsent] = useState(false);
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [done, setDone] = useState(false);

  const [need, setNeed] = useState<BankNeed[] | null>(null);
  const [needError, setNeedError] = useState<string | null>(null);

  useEffect(() => {
    let alive = true;
    (async () => {
      try {
        const res = await publicApi.bankNeed();
        if (alive) setNeed(res.rows ?? []);
      } catch {
        if (alive)
          setNeedError("We could not load where blood is needed right now. Please try again in a little while.");
      }
    })();
    return () => {
      alive = false;
    };
  }, []);

  const grouped = useMemo(() => {
    const map = new Map<string, { name: string; district: string | null; rows: BankNeed[] }>();
    for (const r of need ?? []) {
      if (!(r.shortfall > 0)) continue;
      const g = map.get(r.bank_id) ?? { name: r.name, district: r.district, rows: [] };
      g.rows.push(r);
      map.set(r.bank_id, g);
    }
    return [...map.entries()]
      .map(([id, g]) => ({ id, ...g, total: g.rows.reduce((s, r) => s + r.shortfall, 0) }))
      .sort((a, b) => b.total - a.total);
  }, [need]);

  const today = new Date().toISOString().slice(0, 10);

  async function submit(e: FormEvent) {
    e.preventDefault();
    setError(null);
    const name = firstName.trim();
    if (!NAME_RE.test(name)) {
      setError("Please enter your first name using letters only (up to 30 letters).");
      return;
    }
    const loc = LOCALITIES.find((l) => l.name === locality);
    if (!group || !loc) {
      setError("Please choose your blood group and locality.");
      return;
    }
    if (!consent) {
      setError("Please tick the consent box so we can save your registration.");
      return;
    }
    setBusy(true);
    // Write only: nothing about donors is ever read back. The server stamps the consent time.
    try {
      const res = await publicApi.registerDonor({
        first_name: name,
        blood_group: group,
        locality: loc.name,
        lat: loc.lat,
        lng: loc.lng,
        last_donated: lastDonated || null,
      });
      if (res && res.ok === false) throw new Error("The server did not save it.");
    } catch (err) {
      setBusy(false);
      setError("We could not save your registration. Please try again. (" + errText(err) + ")");
      return;
    }
    setBusy(false);
    setDone(true);
  }

  return (
    <>
      <h1>Become a donor</h1>
      <p className="lead">It takes a minute. We only ask for what a blood bank needs to reach out to donors like you.</p>

      <section className="card" aria-labelledby="reg-h">
        <h2 id="reg-h">Register</h2>
        {done ? (
          <div>
            <div className="notice notice-ok" role="status">
              Thank you, {firstName.trim()}. You are registered as a {group} donor in {locality}.
            </div>
            <button
              type="button"
              className="btn btn-secondary"
              onClick={() => {
                setDone(false);
                setFirstName("");
                setGroup("");
                setLocality("");
                setLastDonated("");
                setConsent(false);
              }}
            >
              Register someone else
            </button>
          </div>
        ) : (
          <form onSubmit={submit} noValidate>
            <div className="form-grid cols-2">
              <div className="field">
                <label htmlFor="d-name">First name</label>
                <input
                  id="d-name"
                  type="text"
                  value={firstName}
                  maxLength={30}
                  autoComplete="given-name"
                  onChange={(e) => setFirstName(e.target.value.replace(/[^A-Za-z]/g, ""))}
                  required
                />
                <span className="muted small">First name only. No surname or phone number.</span>
              </div>
              <div className="field">
                <label htmlFor="d-group">Blood group</label>
                <select id="d-group" value={group} onChange={(e) => setGroup(e.target.value)} required>
                  <option value="">Choose…</option>
                  {BLOOD_GROUPS.map((g) => (
                    <option key={g} value={g}>
                      {g}
                    </option>
                  ))}
                </select>
              </div>
              <div className="field">
                <label htmlFor="d-loc">Locality</label>
                <select id="d-loc" value={locality} onChange={(e) => setLocality(e.target.value)} required>
                  <option value="">Choose…</option>
                  {LOCALITIES.map((l) => (
                    <option key={l.name} value={l.name}>
                      {l.name}
                    </option>
                  ))}
                </select>
              </div>
              <div className="field">
                <label htmlFor="d-last">Last donated (optional)</label>
                <input
                  id="d-last"
                  type="date"
                  value={lastDonated}
                  max={today}
                  onChange={(e) => setLastDonated(e.target.value)}
                />
              </div>
            </div>
            <label className="check" style={{ marginTop: 12 }}>
              <input type="checkbox" checked={consent} onChange={(e) => setConsent(e.target.checked)} />
              <span>
                I agree to RaktSetu storing my first name, blood group, locality and last donation date so that blood
                banks can ask me to donate.
              </span>
            </label>
            {error && (
              <div className="notice notice-error" role="alert">
                {error}
              </div>
            )}
            <div className="btn-row" style={{ marginTop: 12 }}>
              <button type="submit" className="btn btn-primary" disabled={busy || !consent}>
                {busy && <span className="spinner" aria-hidden="true" />}
                {busy ? "Saving…" : "Register as a donor"}
              </button>
            </div>
          </form>
        )}
      </section>

      <section className="card" aria-labelledby="need-h">
        <h2 id="need-h">Where blood is needed</h2>
        <p className="muted">Blood banks that are running below their minimum stock.</p>
        {needError && (
          <div className="notice notice-error" role="alert">
            {needError}
          </div>
        )}
        {!need && !needError && <p className="muted">Loading…</p>}
        {need && grouped.length === 0 && <p>Good news: no blood bank is reporting a shortfall right now.</p>}
        {grouped.map((b) => (
          <div className="item" key={b.id}>
            <div className="item-top">
              <span className="item-title">{b.name}</span>
              {b.district && <span className="muted">{b.district}</span>}
            </div>
            <div className="btn-row">
              {b.rows
                .sort((x, y) => y.shortfall - x.shortfall)
                .map((r) => (
                  <span key={r.blood_group} className="chip chip-bad">
                    {r.blood_group}: short by {r.shortfall} {r.shortfall === 1 ? "unit" : "units"}
                  </span>
                ))}
            </div>
          </div>
        ))}
      </section>
    </>
  );
}
