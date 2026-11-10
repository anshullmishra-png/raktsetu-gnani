import { FormEvent, useCallback, useEffect, useMemo, useState } from "react";
import { ApiError, AuditRow, EvalRow, PledgeRow, TranscriptRow, adminApi, publicApi } from "../api";
import { BloodBank, HoldProposal, errText, fmtDateTime } from "../types";
import Proposals from "../components/Proposals";

const KEY = "raktsetu_admin_passcode";

function loadPasscode(): string {
  try {
    return sessionStorage.getItem(KEY) ?? "";
  } catch {
    return "";
  }
}
function savePasscode(p: string | null) {
  try {
    if (p) sessionStorage.setItem(KEY, p);
    else sessionStorage.removeItem(KEY);
  } catch {
    /* storage unavailable: the passcode simply is not remembered */
  }
}

type Tab = "proposals" | "audit" | "transcripts" | "evals" | "pledges";
const TABS: { key: Tab; label: string }[] = [
  { key: "proposals", label: "Pending holds" },
  { key: "audit", label: "Audit log" },
  { key: "transcripts", label: "Transcripts" },
  { key: "evals", label: "Eval results" },
  { key: "pledges", label: "Pledges" },
];

function newestFirst<T extends { created_at: string }>(rows: T[] | undefined | null): T[] {
  return [...(rows ?? [])].sort((a, b) => (a.created_at < b.created_at ? 1 : a.created_at > b.created_at ? -1 : 0));
}

function bool(v: boolean | null | undefined): string {
  return v == null ? "—" : v ? "Yes" : "No";
}

function pretty(v: unknown): string {
  try {
    return JSON.stringify(v, null, 2);
  } catch {
    return String(v);
  }
}

export default function Admin() {
  const [passcode, setPasscode] = useState<string | null>(null);
  const [entry, setEntry] = useState("");
  const [checking, setChecking] = useState(false);
  const [loginError, setLoginError] = useState<string | null>(null);

  const [callsEnabled, setCallsEnabled] = useState<boolean | null>(null);
  const [switchBusy, setSwitchBusy] = useState(false);
  const [tab, setTab] = useState<Tab>("proposals");
  const [loading, setLoading] = useState(false);
  const [error, setError] = useState<string | null>(null);

  const [audit, setAudit] = useState<AuditRow[]>([]);
  const [transcripts, setTranscripts] = useState<TranscriptRow[]>([]);
  const [evals, setEvals] = useState<EvalRow[]>([]);
  const [pledges, setPledges] = useState<PledgeRow[]>([]);
  const [proposals, setProposals] = useState<HoldProposal[]>([]);
  const [banks, setBanks] = useState<BloodBank[]>([]);

  const bankById = useMemo(() => new Map(banks.map((b) => [b.id, b])), [banks]);

  const signOut = useCallback((message?: string) => {
    savePasscode(null);
    setPasscode(null);
    setCallsEnabled(null);
    setLoginError(message ?? null);
  }, []);

  const verify = useCallback(async (p: string): Promise<boolean> => {
    setChecking(true);
    setLoginError(null);
    try {
      const res = await adminApi.status(p);
      setCallsEnabled(Boolean(res.calls_enabled));
      setPasscode(p);
      savePasscode(p);
      return true;
    } catch (e) {
      savePasscode(null);
      setLoginError(
        e instanceof ApiError && e.status === 401
          ? "That passcode was not accepted. Please check it and try again."
          : errText(e),
      );
      return false;
    } finally {
      setChecking(false);
    }
  }, []);

  // Resume a session kept in sessionStorage.
  useEffect(() => {
    const saved = loadPasscode();
    if (saved) void verify(saved);
  }, [verify]);

  const loadProposals = useCallback(async () => {
    const [p, b] = await Promise.allSettled([publicApi.pendingProposals(), publicApi.bootstrap()]);
    if (p.status === "rejected") throw new Error("We could not load the pending hold proposals.");
    setProposals(newestFirst(p.value.rows));
    if (b.status === "fulfilled") setBanks(b.value.blood_banks ?? []);
  }, []);

  const refresh = useCallback(async () => {
    if (!passcode) return;
    setLoading(true);
    setError(null);
    const results = await Promise.allSettled([
      adminApi.status(passcode).then((r) => setCallsEnabled(Boolean(r.calls_enabled))),
      adminApi.audit(passcode).then((r) => setAudit(newestFirst(r.rows))),
      adminApi.transcripts(passcode).then((r) => setTranscripts(newestFirst(r.rows))),
      adminApi.evals(passcode).then((r) => setEvals(newestFirst(r.rows))),
      adminApi.pledges(passcode).then((r) => setPledges(newestFirst(r.rows))),
      loadProposals(),
    ]);
    setLoading(false);
    const failed = results.filter((r): r is PromiseRejectedResult => r.status === "rejected");
    if (failed.some((f) => f.reason instanceof ApiError && f.reason.status === 401)) {
      signOut("Your passcode is no longer accepted. Please enter it again.");
      return;
    }
    if (failed.length > 0) {
      setError(`Some sections could not be loaded (${failed.length} of ${results.length}). ${errText(failed[0].reason)}`);
    }
  }, [passcode, loadProposals, signOut]);

  useEffect(() => {
    if (passcode) void refresh();
  }, [passcode, refresh]);

  async function login(e: FormEvent) {
    e.preventDefault();
    const p = entry.trim();
    if (!p) {
      setLoginError("Please enter the admin passcode.");
      return;
    }
    if (await verify(p)) setEntry("");
  }

  async function toggleCalls() {
    if (!passcode || callsEnabled == null) return;
    setSwitchBusy(true);
    setError(null);
    try {
      const res = await adminApi.setCallsEnabled(passcode, !callsEnabled);
      setCallsEnabled(Boolean(res.calls_enabled));
    } catch (e) {
      if (e instanceof ApiError && e.status === 401) signOut("Your passcode is no longer accepted.");
      else setError(errText(e));
    } finally {
      setSwitchBusy(false);
    }
  }

  if (!passcode) {
    return (
      <>
        <h1>Admin</h1>
        <p className="lead">Enter the admin passcode to continue.</p>
        <form className="card" onSubmit={login} noValidate>
          <div className="field">
            <label htmlFor="a-pass">Passcode</label>
            <input
              id="a-pass"
              type="password"
              value={entry}
              autoComplete="off"
              onChange={(e) => setEntry(e.target.value)}
            />
            <span className="muted small">Kept only for this browser tab, and forgotten when you close it.</span>
          </div>
          {loginError && (
            <div className="notice notice-error" role="alert">
              {loginError}
            </div>
          )}
          <div className="btn-row" style={{ marginTop: 12 }}>
            <button type="submit" className="btn btn-primary" disabled={checking}>
              {checking && <span className="spinner" aria-hidden="true" />}
              {checking ? "Checking…" : "Continue"}
            </button>
          </div>
        </form>
      </>
    );
  }

  const passed = evals.filter((r) => r.pass).length;

  return (
    <>
      <div className="item-top">
        <h1>Admin</h1>
        <div className="btn-row">
          <button type="button" className="btn btn-secondary" onClick={() => void refresh()} disabled={loading}>
            {loading && <span className="spinner dark" aria-hidden="true" />}
            Refresh
          </button>
          <button type="button" className="btn btn-ghost" onClick={() => signOut()}>
            Sign out
          </button>
        </div>
      </div>

      {error && (
        <div className="notice notice-error" role="alert">
          {error}
        </div>
      )}

      <section className="card switch-card" aria-labelledby="ks-h">
        <div>
          <h2 id="ks-h">Kill switch</h2>
          <div className={`switch-state ${callsEnabled ? "on" : "off"}`} role="status">
            {callsEnabled == null ? "Checking…" : callsEnabled ? "Calls enabled" : "Calls paused"}
          </div>
          <p className="muted" style={{ margin: 0 }}>
            {callsEnabled
              ? "The assistant can contact blood banks and run voice checks."
              : "No new searches or voice checks will go out until you resume."}
          </p>
        </div>
        <button
          type="button"
          role="switch"
          aria-checked={Boolean(callsEnabled)}
          className={`btn ${callsEnabled ? "btn-primary" : "btn-sage"}`}
          disabled={switchBusy || callsEnabled == null}
          onClick={() => void toggleCalls()}
        >
          {switchBusy && <span className="spinner" aria-hidden="true" />}
          {callsEnabled ? "Pause all calls" : "Resume calls"}
        </button>
      </section>

      <div className="tabs" role="tablist" aria-label="Admin sections">
        {TABS.map((t) => (
          <button
            key={t.key}
            type="button"
            role="tab"
            className="tab"
            aria-selected={tab === t.key}
            onClick={() => setTab(t.key)}
          >
            {t.label}
            {t.key === "proposals" && proposals.length > 0 ? ` (${proposals.length})` : ""}
          </button>
        ))}
      </div>

      <section className="card" role="tabpanel">
        {tab === "proposals" && (
          <>
            <h2>Pending hold proposals</h2>
            <p className="muted">Across all requests. The assistant proposes. A person decides.</p>
            <Proposals
              proposals={proposals}
              bankById={bankById}
              role="admin"
              showRequest
              onDecided={() => void refresh()}
            />
          </>
        )}

        {tab === "audit" && (
          <>
            <h2>Audit log</h2>
            {audit.length === 0 ? (
              <p className="muted">{loading ? "Loading…" : "Nothing has been logged yet."}</p>
            ) : (
              <div className="table-wrap">
                <table>
                  <thead>
                    <tr>
                      <th>When</th>
                      <th>Actor</th>
                      <th>Event</th>
                      <th>Request</th>
                      <th>Bank</th>
                      <th>Detail</th>
                    </tr>
                  </thead>
                  <tbody>
                    {audit.map((r) => (
                      <tr key={String(r.id)}>
                        <td>{fmtDateTime(r.created_at)}</td>
                        <td>{r.actor ?? "—"}</td>
                        <td>
                          <span className="chip">{r.event}</span>
                        </td>
                        <td>{r.request_id ? r.request_id.slice(0, 8) : "—"}</td>
                        <td>{r.bank_id ? bankById.get(r.bank_id)?.name ?? r.bank_id.slice(0, 8) : "—"}</td>
                        <td>
                          {r.detail == null ? (
                            "—"
                          ) : (
                            <details>
                              <summary>Show</summary>
                              <pre>{pretty(r.detail)}</pre>
                            </details>
                          )}
                        </td>
                      </tr>
                    ))}
                  </tbody>
                </table>
              </div>
            )}
          </>
        )}

        {tab === "transcripts" && (
          <>
            <h2>Transcripts</h2>
            {transcripts.length === 0 ? (
              <p className="muted">{loading ? "Loading…" : "No voice checks have been transcribed yet."}</p>
            ) : (
              <div className="table-wrap">
                <table>
                  <thead>
                    <tr>
                      <th>When</th>
                      <th>Bank</th>
                      <th>Group</th>
                      <th>Language</th>
                      <th>Transcript</th>
                      <th>Units</th>
                      <th>Will hold</th>
                      <th>Off-topic</th>
                      <th>Consent at</th>
                      <th>Outcome</th>
                    </tr>
                  </thead>
                  <tbody>
                    {transcripts.map((r) => (
                      <tr key={String(r.id)}>
                        <td>{fmtDateTime(r.created_at)}</td>
                        <td>{r.bank_name ?? "—"}</td>
                        <td>{r.blood_group ?? "—"}</td>
                        <td>{r.language_code ?? "—"}</td>
                        <td className="wrap">{r.transcript || "—"}</td>
                        <td>{r.units_reported ?? "—"}</td>
                        <td>{bool(r.will_hold)}</td>
                        <td>{r.off_topic ? <span className="chip chip-bad">Yes</span> : bool(r.off_topic)}</td>
                        <td>{fmtDateTime(r.consent_at)}</td>
                        <td>{r.outcome ?? "—"}</td>
                      </tr>
                    ))}
                  </tbody>
                </table>
              </div>
            )}
          </>
        )}

        {tab === "evals" && (
          <>
            <h2>Eval results</h2>
            {evals.length === 0 ? (
              <p className="muted">{loading ? "Loading…" : "No eval runs recorded yet"}</p>
            ) : (
              <>
                <p>
                  <strong>
                    {passed} of {evals.length} passed
                  </strong>
                </p>
                <div className="table-wrap">
                  <table>
                    <thead>
                      <tr>
                        <th>Result</th>
                        <th>When</th>
                        <th>Clip</th>
                        <th>Language</th>
                        <th>Model</th>
                        <th>Units (expected → got)</th>
                        <th>Hold (expected → got)</th>
                        <th>Transcript</th>
                        <th>Notes</th>
                      </tr>
                    </thead>
                    <tbody>
                      {evals.map((r) => (
                        <tr key={String(r.id)}>
                          <td>
                            <span className={`chip ${r.pass ? "chip-ok" : "chip-bad"}`}>{r.pass ? "Pass" : "Fail"}</span>
                          </td>
                          <td>{fmtDateTime(r.created_at)}</td>
                          <td>{r.clip ?? "—"}</td>
                          <td>{r.language_code ?? "—"}</td>
                          <td>{r.model ?? "—"}</td>
                          <td>
                            {r.expected_units ?? "—"} → {r.got_units ?? "—"}
                          </td>
                          <td>
                            {bool(r.expected_hold)} → {bool(r.got_hold)}
                          </td>
                          <td className="wrap">{r.transcript || "—"}</td>
                          <td>{r.notes || "—"}</td>
                        </tr>
                      ))}
                    </tbody>
                  </table>
                </div>
              </>
            )}
          </>
        )}

        {tab === "pledges" && (
          <>
            <h2>Replacement pledges</h2>
            <p className="muted">Pledges are credited to the blood bank, never linked to a patient.</p>
            {pledges.length === 0 ? (
              <p className="muted">{loading ? "Loading…" : "No pledges have been made yet."}</p>
            ) : (
              <div className="table-wrap">
                <table>
                  <thead>
                    <tr>
                      <th>When</th>
                      <th>Blood bank</th>
                      <th>Donor first name</th>
                      <th>Blood group</th>
                    </tr>
                  </thead>
                  <tbody>
                    {pledges.map((r) => (
                      <tr key={String(r.id)}>
                        <td>{fmtDateTime(r.created_at)}</td>
                        <td>{r.bank_name ?? "—"}</td>
                        <td>{r.donor_first_name}</td>
                        <td>{r.blood_group}</td>
                      </tr>
                    ))}
                  </tbody>
                </table>
              </div>
            )}
          </>
        )}
      </section>
    </>
  );
}
