import { FormEvent, useEffect, useMemo, useState } from "react";
import { publicApi } from "../api";
import { BLOOD_GROUPS, BloodBank, Hold } from "../types";

const NAME_RE = /^[A-Za-z]{1,30}$/;

interface Props {
  requestId: string;
  holds: Hold[];
  bankById: Map<string, BloodBank>;
  onOffered?: () => void;
}

export default function ReplacementPanel({ requestId, holds, bankById, onOffered }: Props) {
  const [offered, setOffered] = useState(false);
  const [offerBusy, setOfferBusy] = useState(false);
  const [offerError, setOfferError] = useState<string | null>(null);

  const [bankId, setBankId] = useState("");
  const [name, setName] = useState("");
  const [group, setGroup] = useState("");
  const [consent, setConsent] = useState(false);
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [pledged, setPledged] = useState<string[]>([]);

  const holdingBanks = useMemo(() => {
    const ids = new Set<string>();
    for (const h of holds) if (h.status === "active" || h.status === "fulfilled") ids.add(h.bank_id);
    return [...ids].map((id) => bankById.get(id)).filter((b): b is BloodBank => Boolean(b));
  }, [holds, bankById]);

  useEffect(() => {
    setOffered(false);
    setPledged([]);
    setOfferError(null);
  }, [requestId]);

  useEffect(() => {
    if (holdingBanks.length === 1) setBankId(holdingBanks[0].id);
    else if (bankId && !holdingBanks.some((b) => b.id === bankId)) setBankId("");
  }, [holdingBanks, bankId]);

  async function markOffered() {
    setOfferBusy(true);
    setOfferError(null);
    let res: { ok?: boolean } | null = null;
    let e = false;
    try {
      res = await publicApi.markReplacementOffered(requestId);
    } catch {
      e = true;
    }
    setOfferBusy(false);
    if (e || (res && res.ok === false)) {
      setOfferError("We could not record that just now. Please try again.");
      return;
    }
    setOffered(true);
    onOffered?.();
  }

  async function submit(e: FormEvent) {
    e.preventDefault();
    setError(null);
    const first = name.trim();
    if (!bankId) return setError("Please choose the blood bank to credit.");
    if (!NAME_RE.test(first)) return setError("Please enter the donor's first name using letters only (up to 30).");
    if (!group) return setError("Please choose the donor's blood group.");
    if (!consent) return setError("Please confirm the donor has agreed.");
    setBusy(true);
    // Write only. No request or patient reference is ever sent with a pledge.
    let failed = false;
    try {
      const res = await publicApi.pledge({ bank_id: bankId, donor_first_name: first, blood_group: group });
      if (res && res.ok === false) failed = true;
    } catch {
      failed = true;
    }
    setBusy(false);
    if (failed) {
      setError("We could not save that pledge. Please try again.");
      return;
    }
    setPledged((p) => [...p, `${first} (${group}) → ${bankById.get(bankId)?.name ?? "blood bank"}`]);
    setName("");
    setGroup("");
    setConsent(false);
  }

  return (
    <div>
      <p>
        Family or friends can donate to top the blood bank back up. Pledges are credited to the blood bank, never
        linked to a patient.
      </p>
      {offered ? (
        <div className="notice notice-ok" role="status">
          Replacement donation has been offered for this request.
        </div>
      ) : (
        <button type="button" className="btn btn-secondary" disabled={offerBusy} onClick={() => void markOffered()}>
          {offerBusy && <span className="spinner dark" aria-hidden="true" />}
          Replacement offered
        </button>
      )}
      {offerError && (
        <div className="notice notice-error" role="alert">
          {offerError}
        </div>
      )}

      {offered && (
        <form onSubmit={submit} noValidate style={{ marginTop: 12 }}>
          <h3>Pledge a donor to a blood bank</h3>
          {holdingBanks.length === 0 ? (
            <p className="muted">
              Pledges can be made once a blood bank is holding units for this request (approve a proposal first).
            </p>
          ) : (
            <>
              <div className="form-grid cols-3">
                <div className="field">
                  <label htmlFor="rp-bank">Blood bank to credit</label>
                  <select id="rp-bank" value={bankId} onChange={(e) => setBankId(e.target.value)}>
                    <option value="">Choose…</option>
                    {holdingBanks.map((b) => (
                      <option key={b.id} value={b.id}>
                        {b.name}
                      </option>
                    ))}
                  </select>
                </div>
                <div className="field">
                  <label htmlFor="rp-name">Donor first name</label>
                  <input
                    id="rp-name"
                    type="text"
                    value={name}
                    maxLength={30}
                    onChange={(e) => setName(e.target.value.replace(/[^A-Za-z]/g, ""))}
                  />
                </div>
                <div className="field">
                  <label htmlFor="rp-group">Donor blood group</label>
                  <select id="rp-group" value={group} onChange={(e) => setGroup(e.target.value)}>
                    <option value="">Choose…</option>
                    {BLOOD_GROUPS.map((g) => (
                      <option key={g} value={g}>
                        {g}
                      </option>
                    ))}
                  </select>
                </div>
              </div>
              <label className="check" style={{ marginTop: 12 }}>
                <input type="checkbox" checked={consent} onChange={(e) => setConsent(e.target.checked)} />
                <span>The donor has agreed to this pledge and to their first name and blood group being stored.</span>
              </label>
              {error && (
                <div className="notice notice-error" role="alert">
                  {error}
                </div>
              )}
              <div className="btn-row" style={{ marginTop: 12 }}>
                <button type="submit" className="btn btn-primary" disabled={busy || !consent}>
                  {busy && <span className="spinner" aria-hidden="true" />}
                  Add pledge
                </button>
              </div>
            </>
          )}
          {pledged.length > 0 && (
            <div className="notice notice-ok" role="status">
              <strong>Pledged in this session:</strong>
              <ul style={{ margin: "6px 0 0", paddingLeft: 20 }}>
                {pledged.map((p, i) => (
                  <li key={i}>{p}</li>
                ))}
              </ul>
            </div>
          )}
        </form>
      )}
    </div>
  );
}
