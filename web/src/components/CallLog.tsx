import { useEffect, useRef } from "react";
import { BloodBank, CallLogRow, fmtTime } from "../types";

export const EVENT_LABEL: Record<string, string> = {
  system: "Update",
  found: "Bank found",
  calling: "Calling",
  confirmed: "Confirmed",
  partial: "Partly available",
  declined: "Declined",
  no_answer: "No answer",
  proposed: "Hold proposed",
  voice: "Voice check",
  refused: "Refused",
  held: "Held",
  cancelled: "Cancelled",
};

interface Props {
  rows: CallLogRow[];
  bankById: Map<string, BloodBank>;
  waiting: boolean;
}

export default function CallLog({ rows, bankById, waiting }: Props) {
  const listRef = useRef<HTMLUListElement>(null);

  useEffect(() => {
    const el = listRef.current;
    if (el) el.scrollTop = el.scrollHeight;
  }, [rows.length]);

  if (rows.length === 0) {
    return (
      <p className="muted" role="status">
        {waiting ? "Waiting for the first update… this can take up to a minute." : "No updates yet."}
      </p>
    );
  }

  return (
    <ul className="log" ref={listRef} aria-live="polite" aria-label="Live call log">
      {rows.map((r) => {
        const bank = r.bank_id ? bankById.get(r.bank_id) : undefined;
        return (
          <li key={r.id} className={`ev-${r.event}`}>
            <div className="log-meta">
              <span>{fmtTime(r.created_at)}</span>
              <span className={`chip chip-${r.event}`}>{EVENT_LABEL[r.event] ?? r.event}</span>
              {bank && <strong>{bank.name}</strong>}
              {r.units_offered != null && r.units_offered > 0 && (
                <span>
                  {r.units_offered} {r.units_offered === 1 ? "unit" : "units"} offered
                </span>
              )}
            </div>
            {r.message && <div>{r.message}</div>}
          </li>
        );
      })}
    </ul>
  );
}
