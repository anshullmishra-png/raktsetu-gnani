import { useEffect, useState } from "react";
import { publicApi } from "../api";
import { BloodBank, Hold } from "../types";

const STATUS_LABEL: Record<Hold["status"], string> = {
  active: "On hold",
  fulfilled: "Collected",
  cancelled: "Cancelled",
  expired: "Expired",
};

function remaining(expiresAt: string, now: number): string {
  const ms = new Date(expiresAt).getTime() - now;
  if (!Number.isFinite(ms) || ms <= 0) return "00:00";
  const total = Math.floor(ms / 1000);
  const m = Math.floor(total / 60);
  const s = total % 60;
  return `${String(m).padStart(2, "0")}:${String(s).padStart(2, "0")}`;
}

interface Props {
  holds: Hold[];
  bankById: Map<string, BloodBank>;
  onChanged: () => void;
}

export default function HoldsPanel({ holds, bankById, onChanged }: Props) {
  const [now, setNow] = useState(() => Date.now());
  const [busyId, setBusyId] = useState<string | null>(null);
  const [error, setError] = useState<string | null>(null);

  useEffect(() => {
    const t = window.setInterval(() => setNow(Date.now()), 1000);
    return () => window.clearInterval(t);
  }, []);

  async function collect(h: Hold) {
    setBusyId(h.id);
    setError(null);
    let res: { ok?: boolean; reason?: string } | null = null;
    let e = false;
    try {
      res = await publicApi.fulfilHold(h.id);
    } catch {
      e = true;
    }
    setBusyId(null);
    if (e) {
      setError("We could not mark that as collected. Please try again.");
    } else if (res && res.ok === false) {
      setError(
        res.reason
          ? `That hold could not be marked as collected: ${res.reason}`
          : "That hold could not be marked as collected. It may have expired.",
      );
    }
    onChanged();
  }

  return (
    <div>
      {error && (
        <div className="notice notice-error" role="alert">
          {error}
        </div>
      )}
      {holds.length === 0 && <p className="muted">Nothing is on hold yet. Approve a proposal above to reserve units.</p>}
      {holds.map((h) => {
        const bank = bankById.get(h.bank_id);
        const timeUp = new Date(h.expires_at).getTime() <= now;
        const active = h.status === "active";
        return (
          <div className="item" key={h.id}>
            <div className="item-top">
              <span className="item-title">{bank?.name ?? "Blood bank"}</span>
              <span className={`chip chip-${active && timeUp ? "expired" : h.status}`}>
                {active && timeUp ? "Time is up" : STATUS_LABEL[h.status] ?? h.status}
              </span>
            </div>
            <p>
              <strong>
                {h.units} {h.units === 1 ? "unit" : "units"} of {h.blood_group}
              </strong>
              {bank?.pickup_hours && <> · pickup {bank.pickup_hours}</>}
            </p>
            {active && (
              <p>
                Held for another{" "}
                <span className="countdown" aria-label={`${remaining(h.expires_at, now)} remaining`}>
                  {remaining(h.expires_at, now)}
                </span>
              </p>
            )}
            {active && (
              <button
                type="button"
                className="btn btn-primary"
                disabled={busyId !== null}
                onClick={() => void collect(h)}
              >
                {busyId === h.id && <span className="spinner" aria-hidden="true" />}
                Mark collected
              </button>
            )}
          </div>
        );
      })}
      <div className="notice notice-info">
        <strong>Before you send someone to collect:</strong> the attendant must bring the doctor's requisition, the
        patient's blood sample for crossmatch, and an ID. Your hospital handles those. RaktSetu stores none of them.
      </div>
    </div>
  );
}
