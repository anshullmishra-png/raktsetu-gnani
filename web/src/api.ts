import type { BankNeed, BloodBank, CallLogRow, Hold, HoldProposal, Hospital } from "./types";

export class ApiError extends Error {
  status: number;
  code: string;
  constructor(status: number, code: string, message: string) {
    super(message);
    this.name = "ApiError";
    this.status = status;
    this.code = code;
  }
}

export const CALLS_PAUSED_MESSAGE =
  "Calls are paused by an admin right now. Nothing was sent. Please try again once calls are switched back on.";

function friendly(status: number, code: string, message?: string): string {
  if (status === 423 || code === "calls_disabled") return CALLS_PAUSED_MESSAGE;
  if (status === 401) return "That passcode was not accepted.";
  if (code === "consent_required") return "Consent is needed before we can record or transcribe anything.";
  if (message) return message;
  if (code) return `The server could not do that (${code}).`;
  return `The server could not do that (HTTP ${status}).`;
}

async function callFn<T>(name: string, init: { body: BodyInit; headers?: Record<string, string> }): Promise<T> {
  let res: Response;
  try {
    // Same-origin serverless functions: no keys or auth headers are needed in the browser.
    res = await fetch(`/api/${name}`, {
      method: "POST",
      headers: { ...(init.headers ?? {}) },
      body: init.body,
    });
  } catch {
    throw new ApiError(0, "network", "We could not reach the server. Please check your connection and try again.");
  }
  let data: unknown = null;
  try {
    data = await res.json();
  } catch {
    data = null;
  }
  if (!res.ok) {
    const d = (data ?? {}) as { error?: unknown; message?: unknown };
    const code = typeof d.error === "string" ? d.error : "";
    const msg = typeof d.message === "string" ? d.message : undefined;
    throw new ApiError(res.status, code, friendly(res.status, code, msg));
  }
  return data as T;
}

function postJson<T>(name: string, body: unknown, headers?: Record<string, string>): Promise<T> {
  return callFn<T>(name, {
    body: JSON.stringify(body),
    headers: { "Content-Type": "application/json", ...(headers ?? {}) },
  });
}

/* ---------- public (reads, registrations, pledges) ---------- */

export interface BootstrapResult {
  hospitals: Hospital[];
  blood_banks: BloodBank[];
  calls_enabled: boolean;
}

export interface RequestRow {
  id: string;
  hospital: string;
  lat: number;
  lng: number;
  blood_group: string;
  units_needed: number;
  status: string;
  replacement_offered: boolean;
  created_at: string;
}

export interface RequestState {
  /** null until the dispatch function has created the request (normal for the first second or two). */
  request: RequestRow | null;
  call_log: CallLogRow[];
  proposals: HoldProposal[];
  holds: Hold[];
  calls_enabled: boolean;
}

export interface PendingProposalRow extends HoldProposal {
  bank_name: string | null;
  hospital: string | null;
}

function publicCall<T>(op: string, body?: Record<string, unknown>): Promise<T> {
  return postJson<T>("public", { op, ...(body ?? {}) });
}

export const publicApi = {
  bootstrap: () => publicCall<BootstrapResult>("bootstrap"),
  requestState: (request_id: string) => publicCall<RequestState>("request_state", { request_id }),
  bankNeed: () => publicCall<{ rows: BankNeed[] }>("bank_need"),
  pendingProposals: () => publicCall<{ rows: PendingProposalRow[] }>("pending_proposals"),
  /** Only ever called after the consent box is ticked. The server stamps the consent time. */
  registerDonor: (args: {
    first_name: string;
    blood_group: string;
    locality: string;
    lat: number;
    lng: number;
    last_donated: string | null;
  }) => publicCall<{ ok: boolean }>("register_donor", { ...args, consent: true }),
  /** Only ever called after the consent box is ticked. No request or patient reference is sent. */
  pledge: (args: { bank_id: string; donor_first_name: string; blood_group: string }) =>
    publicCall<{ ok: boolean }>("pledge", { ...args, consent: true }),
  fulfilHold: (hold_id: string) => publicCall<{ ok: boolean; reason?: string }>("fulfil_hold", { hold_id }),
  markReplacementOffered: (request_id: string) =>
    publicCall<{ ok: boolean }>("mark_replacement_offered", { request_id }),
};

/* ---------- dispatch ---------- */

export interface DispatchResult {
  request_id: string;
  summary: string;
  incomplete: boolean;
}

export function dispatchRequest(args: {
  request_id: string;
  hospital_id: string;
  blood_group: string;
  units_needed: number;
}): Promise<DispatchResult> {
  return postJson<DispatchResult>("dispatch", { action: "dispatch", ...args });
}

/* ---------- approve-hold ---------- */

export interface ApproveResult {
  ok: boolean;
  hold?: { id: string; units: number; expires_at: string };
  reason?: string;
}

export function decideProposal(
  proposal_id: string,
  decision: "approve" | "reject",
  approver_role: "hospital" | "admin",
): Promise<ApproveResult> {
  // Admin decisions are checked against the admin passcode on the server.
  let headers: Record<string, string> | undefined;
  if (approver_role === "admin") {
    let p = "";
    try {
      p = sessionStorage.getItem("raktsetu_admin_passcode") ?? "";
    } catch {
      p = "";
    }
    headers = { "x-admin-passcode": p };
  }
  return postJson<ApproveResult>("approve-hold", { proposal_id, decision, approver_role }, headers);
}

/* ---------- voice ---------- */

export type LanguageCode = "en-IN" | "hi-IN" | "kn-IN";

export interface VoiceStartResult {
  voice_call_id: string;
  consent_at: string;
}

export function voiceStart(args: {
  request_id: string;
  bank_id: string;
  blood_group: string;
  language_code: LanguageCode;
}): Promise<VoiceStartResult> {
  // Only ever called after the consent box is ticked.
  return postJson<VoiceStartResult>("voice-start", { ...args, consent: true });
}

export interface VoiceExtraction {
  units_available: number | null;
  will_hold: boolean | null;
  collection_hours: string | null;
  off_topic: boolean;
  pii_redacted: boolean;
  needs_review: boolean;
}

export type VoiceOutcome =
  | "proposal_created"
  | "hold_confirmed"
  | "hold_cancelled" | "declined" | "refused_off_topic" | "no_speech";

export interface VoiceReplyResult {
  transcript: string;
  model: string;
  language_code: string;
  extraction: VoiceExtraction;
  outcome: VoiceOutcome;
  message: string;
}

export function voiceReply(voice_call_id: string, wav: Blob): Promise<VoiceReplyResult> {
  const form = new FormData();
  form.append("voice_call_id", voice_call_id);
  form.append("audio", new File([wav], "reply.wav", { type: "audio/wav" }));
  // No Content-Type header: the browser sets the multipart boundary.
  return callFn<VoiceReplyResult>("voice-reply", { body: form });
}

/* ---------- admin ---------- */

export interface AuditRow {
  id: number | string;
  created_at: string;
  actor: string | null;
  event: string;
  request_id: string | null;
  bank_id: string | null;
  detail: unknown;
}

export interface TranscriptRow {
  id: number | string;
  created_at: string;
  bank_name: string | null;
  blood_group: string | null;
  language_code: string | null;
  transcript: string | null;
  units_reported: number | null;
  will_hold: boolean | null;
  off_topic: boolean | null;
  consent_at: string | null;
  outcome: string | null;
}

export interface EvalRow {
  id: number | string;
  created_at: string;
  clip: string | null;
  language_code: string | null;
  model: string | null;
  expected_units: number | null;
  got_units: number | null;
  expected_hold: boolean | null;
  got_hold: boolean | null;
  transcript: string | null;
  pass: boolean;
  notes: string | null;
}

export interface PledgeRow {
  id: number | string;
  created_at: string;
  bank_name: string | null;
  donor_first_name: string;
  blood_group: string;
}

function adminCall<T>(passcode: string, body: Record<string, unknown>): Promise<T> {
  return postJson<T>("admin", body, { "x-admin-passcode": passcode });
}

export const adminApi = {
  status: (p: string) => adminCall<{ calls_enabled: boolean }>(p, { action: "status" }),
  setCallsEnabled: (p: string, enabled: boolean) =>
    adminCall<{ calls_enabled: boolean }>(p, { action: "set_calls_enabled", enabled }),
  audit: (p: string) => adminCall<{ rows: AuditRow[] }>(p, { action: "audit" }),
  transcripts: (p: string) => adminCall<{ rows: TranscriptRow[] }>(p, { action: "transcripts" }),
  evals: (p: string) => adminCall<{ rows: EvalRow[] }>(p, { action: "evals" }),
  pledges: (p: string) => adminCall<{ rows: PledgeRow[] }>(p, { action: "pledges" }),
};

/* ---------- speak (Gnani Timbre) ---------- */

/** Fetches speech from the server (Gnani Timbre). Returns an object URL for an <audio> element. */
export async function speak(kind: "disclosure" | "reply", request_id: string): Promise<string> {
  const res = await fetch("/api/speak", {
    method: "POST",
    headers: { "Content-Type": "application/json" },
    body: JSON.stringify({ kind, request_id }),
  });
  if (!res.ok) {
    const d = (await res.json().catch(() => ({}))) as { error?: string; message?: string };
    throw new ApiError(res.status, d.error ?? "", friendly(res.status, d.error ?? "", d.message));
  }
  return URL.createObjectURL(await res.blob());
}
