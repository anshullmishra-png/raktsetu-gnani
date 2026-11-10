import { useState } from "react";
import { decideProposal } from "../api";
import { BloodBank, HoldProposal, distanceKm, errText, fmtDateTime } from "../types";

interface Props {
  proposals: HoldProposal[];
  bankById: Map<string, BloodBank>;
  origin?: { lat: number; lng: number } | null;
  role: "hospital" | "admin";
  onDecided: () => void;
  emptyText?: string;
  showRequest?: boolean;
}

export default function Proposals({ proposals, bankById, origin, role, onDecided, emptyText, showRequest }: Props) {
  const [busyId, setBusyId] = useState<string | null>(null);
  const [error, setError] = useState<string | null>(null);
  const [info, setInfo] = useState<string | null>(null);

  async function decide(p: HoldProposal, decision: "approve" | "reject") {
    setBusyId(p.id);
    setError(null);
    setInfo(null);
    try {
      const res = await decideProposal(p.id, decision, role);
      if (!res.ok) {
        setError(
          res.reason
            ? `That could not be done: ${res.reason}`
            : "That could not be done. The proposal may have changed. Please refresh and try again.",
        );
      } else if (decision === "approve") {
        setInfo(
          res.hold
            ? `Approved. ${res.hold.units} ${res.hold.units === 1 ? "unit is" : "units are"} now on hold.`
            : "Approved. The hold is now in place.",
        );
      } else {
        setInfo("Rejected. Nothing was reserved.");
      }
    } catch (e) {
      setError(errText(e));
    } finally {
      setBusyId(null);
      onDecided();
    }
  }

  return (
    <div>
      {error && (
        <div className="notice notice-error" role="alert">
          {error}
        </div>
      )}
      {info && (
        <div className="notice notice-ok" role="status">
          {info}
        </div>
      )}
      {proposals.length === 0 && <p className="muted">{emptyText ?? "No proposals are waiting for a decision."}</p>}
      {proposals.map((p) => {
        const bank = bankById.get(p.bank_id);
        const km = bank && origin ? distanceKm(origin.lat, origin.lng, bank.lat, bank.lng) : null;
        const busy = busyId === p.id;
        return (
          <div className="item" key={p.id}>
            <div className="item-top">
              <span className="item-title">{bank?.name ?? "Blood bank"}</span>
              <span className={`chip ${p.source === "voice" ? "chip-voice" : "chip-pending"}`}>
                {p.source === "voice" ? "From voice check" : "From the assistant"}
              </span>
            </div>
            <p>
              <strong>
                {p.units} {p.units === 1 ? "unit" : "units"} of {p.blood_group}
              </strong>
              {km != null && <> · about {km.toFixed(1)} km away</>}
              {bank?.pickup_hours && <> · pickup {bank.pickup_hours}</>}
            </p>
            {showRequest && (
              <p className="muted small">
                Request {p.request_id.slice(0, 8)} · proposed {fmtDateTime(p.created_at)}
              </p>
            )}
            <div className="btn-row">
              <button
                type="button"
                className="btn btn-sage"
                disabled={busyId !== null}
                onClick={() => void decide(p, "approve")}
              >
                {busy && <span className="spinner" aria-hidden="true" />}
                Approve hold
              </button>
              <button
                type="button"
                className="btn btn-ghost"
                disabled={busyId !== null}
                onClick={() => void decide(p, "reject")}
              >
                Reject
              </button>
            </div>
          </div>
        );
      })}
    </div>
  );
}
