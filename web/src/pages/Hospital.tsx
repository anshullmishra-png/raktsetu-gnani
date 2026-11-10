import { FormEvent, useEffect, useMemo, useState } from "react";
import { ApiError, CALLS_PAUSED_MESSAGE, dispatchRequest, publicApi } from "../api";
import { BLOOD_GROUPS, BloodBank, Hospital as HospitalRow, errText } from "../types";
import { useRequestLive } from "../components/useRequestLive";
import CallLog from "../components/CallLog";
import BankMap, { MapBank } from "../components/BankMap";
import Proposals from "../components/Proposals";
import VoicePanel from "../components/VoicePanel";
import HoldsPanel from "../components/HoldsPanel";
import ReplacementPanel from "../components/ReplacementPanel";

function newRequestId(): string {
  if (typeof crypto !== "undefined" && typeof crypto.randomUUID === "function") return crypto.randomUUID();
  // Fallback for non-secure contexts (plain http on a LAN address).
  const b = new Uint8Array(16);
  crypto.getRandomValues(b);
  b[6] = (b[6] & 0x0f) | 0x40;
  b[8] = (b[8] & 0x3f) | 0x80;
  const h = [...b].map((x) => x.toString(16).padStart(2, "0")).join("");
  return `${h.slice(0, 8)}-${h.slice(8, 12)}-${h.slice(12, 16)}-${h.slice(16, 20)}-${h.slice(20)}`;
}

function Step({ n, title, children }: { n: number; title: string; children: React.ReactNode }) {
  return (
    <section className="card" aria-labelledby={`step-${n}`}>
      <div className="step-head">
        <span className="step-num" aria-hidden="true">
          {n}
        </span>
        <h2 id={`step-${n}`}>
          <span className="sr-only">Step {n}: </span>
          {title}
        </h2>
      </div>
      {children}
    </section>
  );
}

export default function Hospital() {
  const [hospitals, setHospitals] = useState<HospitalRow[]>([]);
  const [banks, setBanks] = useState<BloodBank[]>([]);
  const [loading, setLoading] = useState(true);
  const [loadError, setLoadError] = useState<string | null>(null);
  const [callsEnabled, setCallsEnabled] = useState<boolean | null>(null);

  const [hospitalId, setHospitalId] = useState("");
  const [group, setGroup] = useState("");
  const [units, setUnits] = useState(1);

  // Snapshot of what was actually requested, so later steps stay consistent if the form is edited.
  const [active, setActive] = useState<{ hospital: HospitalRow; group: string; units: number } | null>(null);
  const [dispatching, setDispatching] = useState(false);
  const [summary, setSummary] = useState<{ text: string; incomplete: boolean } | null>(null);
  const [dispatchError, setDispatchError] = useState<string | null>(null);

  const live = useRequestLive();

  useEffect(() => {
    let alive = true;
    (async () => {
      try {
        const res = await publicApi.bootstrap();
        if (!alive) return;
        setHospitals(res.hospitals ?? []);
        setBanks(res.blood_banks ?? []);
        if (typeof res.calls_enabled === "boolean") setCallsEnabled(res.calls_enabled);
      } catch {
        if (!alive) return;
        setLoadError("We could not load the list of hospitals and blood banks. Please refresh the page to try again.");
      }
      setLoading(false);
    })();
    return () => {
      alive = false;
    };
  }, []);

  // Admin kill switch. While a request is active the live poll reports it;
  // otherwise it is re-checked every 10 s.
  const liveRequestId = live.requestId;
  useEffect(() => {
    if (liveRequestId) return;
    let alive = true;
    const t = window.setInterval(() => {
      publicApi
        .bootstrap()
        .then((res) => {
          if (alive && typeof res.calls_enabled === "boolean") setCallsEnabled(res.calls_enabled);
        })
        .catch(() => {
          /* keep the last known state; we will try again */
        });
    }, 10000);
    return () => {
      alive = false;
      window.clearInterval(t);
    };
  }, [liveRequestId]);

  useEffect(() => {
    if (live.callsEnabled != null) setCallsEnabled(live.callsEnabled);
  }, [live.callsEnabled]);

  const bankById = useMemo(() => new Map(banks.map((b) => [b.id, b])), [banks]);

  const mapBanks = useMemo<MapBank[]>(() => {
    const latest = new Map<string, string>();
    for (const r of live.log) if (r.bank_id) latest.set(r.bank_id, r.event);
    const out: MapBank[] = [];
    for (const [id, event] of latest) {
      const bank = bankById.get(id);
      if (bank) out.push({ bank, event });
    }
    return out;
  }, [live.log, bankById]);

  const pending = useMemo(() => live.proposals.filter((p) => p.status === "pending"), [live.proposals]);

  const voiceBanks = useMemo(() => {
    const ids = new Set<string>();
    for (const p of live.proposals) ids.add(p.bank_id);
    for (const h of live.holds) ids.add(h.bank_id);
    for (const r of live.log) if (r.bank_id) ids.add(r.bank_id);
    return [...ids]
      .map((id) => bankById.get(id))
      .filter((b): b is BloodBank => Boolean(b && b.is_demo));
  }, [live.proposals, live.holds, live.log, bankById]);

  async function submit(e: FormEvent) {
    e.preventDefault();
    setDispatchError(null);
    const hospital = hospitals.find((h) => h.id === hospitalId);
    if (!hospital || !group) {
      setDispatchError("Please choose your hospital and the blood group you need.");
      return;
    }
    const n = Math.round(Number(units));
    if (!Number.isFinite(n) || n < 1 || n > 10) {
      setDispatchError("Please ask for between 1 and 10 units.");
      return;
    }
    const requestId = newRequestId();
    setSummary(null);
    setActive({ hospital, group, units: n });
    setDispatching(true);
    try {
      // Start polling for live updates, then ask the assistant to start (it can take 30 to 90 seconds).
      live.start(requestId);
      const res = await dispatchRequest({
        request_id: requestId,
        hospital_id: hospital.id,
        blood_group: group,
        units_needed: n,
      });
      setSummary({ text: res.summary, incomplete: Boolean(res.incomplete) });
    } catch (err) {
      if (err instanceof ApiError && (err.status === 423 || err.code === "calls_disabled")) {
        setCallsEnabled(false);
        setDispatchError(CALLS_PAUSED_MESSAGE);
      } else {
        setDispatchError(errText(err));
      }
    } finally {
      setDispatching(false);
      void live.refetch();
    }
  }

  const requestId = live.requestId;

  return (
    <>
      <h1>Find blood for your hospital</h1>
      <p className="lead">
        Tell us what you need. The assistant checks nearby blood banks and proposes a hold. Nothing is reserved until
        a person approves it.
      </p>

      {callsEnabled === false && (
        <div className="notice notice-warn" role="alert">
          <strong>Calls are paused by an admin.</strong> You can still look around, but new searches will not go out
          until calls are switched back on.
        </div>
      )}
      {loadError && (
        <div className="notice notice-error" role="alert">
          {loadError}
        </div>
      )}

      <Step n={1} title="What do you need?">
        <form onSubmit={submit} noValidate>
          <div className="form-grid cols-3">
            <div className="field">
              <label htmlFor="h-hospital">Hospital</label>
              <select
                id="h-hospital"
                value={hospitalId}
                onChange={(e) => setHospitalId(e.target.value)}
                disabled={loading || dispatching}
              >
                <option value="">{loading ? "Loading hospitals…" : "Choose your hospital…"}</option>
                {hospitals.map((h) => (
                  <option key={h.id} value={h.id}>
                    {h.name}
                  </option>
                ))}
              </select>
            </div>
            <div className="field">
              <label htmlFor="h-group">Blood group</label>
              <select id="h-group" value={group} onChange={(e) => setGroup(e.target.value)} disabled={dispatching}>
                <option value="">Choose…</option>
                {BLOOD_GROUPS.map((g) => (
                  <option key={g} value={g}>
                    {g}
                  </option>
                ))}
              </select>
            </div>
            <div className="field">
              <label htmlFor="h-units">Units (1 to 10)</label>
              <input
                id="h-units"
                type="number"
                inputMode="numeric"
                min={1}
                max={10}
                step={1}
                value={units}
                disabled={dispatching}
                onChange={(e) => setUnits(Number(e.target.value))}
              />
            </div>
          </div>
          <p className="muted" style={{ marginTop: 10 }}>
            We never ask for patient details.
          </p>
          <div className="btn-row">
            <button
              type="submit"
              className="btn btn-primary"
              disabled={dispatching || loading || callsEnabled === false}
            >
              {dispatching && <span className="spinner" aria-hidden="true" />}
              {dispatching ? "Checking blood banks…" : "Find blood"}
            </button>
            {dispatching && <span className="muted">This usually takes 30 to 90 seconds. Updates appear below.</span>}
          </div>
          {dispatchError && (
            <div className="notice notice-error" role="alert">
              {dispatchError}
            </div>
          )}
        </form>
      </Step>

      {requestId && active && (
        <>
          <Step n={2} title="Live updates">
            <p className="muted">
              {active.units} {active.units === 1 ? "unit" : "units"} of {active.group} for {active.hospital.name}.{" "}
              Refreshing every few seconds.
            </p>
            {live.loadError && (
              <div className="notice notice-warn" role="status">
                {live.loadError}
              </div>
            )}
            <div className="live-grid">
              <CallLog rows={live.log} bankById={bankById} waiting={dispatching} />
              <BankMap hospital={active.hospital} banks={mapBanks} />
            </div>
            {summary && (
              <div className={`notice ${summary.incomplete ? "notice-warn" : "notice-ok"}`} role="status">
                <strong>{summary.incomplete ? "Search finished early: " : "Search finished: "}</strong>
                {summary.text}
              </div>
            )}
          </Step>

          <Step n={3} title="Proposed holds">
            <p>
              <strong>The assistant proposes. A person decides.</strong> Nothing is reserved until you press Approve.
            </p>
            <Proposals
              proposals={pending}
              bankById={bankById}
              origin={active.hospital}
              role="hospital"
              onDecided={() => void live.refetch()}
              emptyText={
                dispatching
                  ? "No proposals yet. They will appear here as blood banks respond."
                  : "No proposals are waiting for your decision."
              }
            />
          </Step>

          <Step n={4} title="Hear it from the bank">
            <VoicePanel
              requestId={requestId}
              hospitalName={active.hospital.name}
              bloodGroup={active.group}
              banks={voiceBanks}
              onResult={() => void live.refetch()}
            />
          </Step>

          <Step n={5} title="Units on hold">
            <HoldsPanel holds={live.holds} bankById={bankById} onChanged={() => void live.refetch()} />
          </Step>

          <Step n={6} title="Replacement donation">
            <ReplacementPanel requestId={requestId} holds={live.holds} bankById={bankById} />
          </Step>
        </>
      )}
    </>
  );
}
