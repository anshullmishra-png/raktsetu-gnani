// RaktSetu — open a browser voice session with a demo blood bank.
//
// GUARDRAIL 2: a session row is only created with consent:true, and the
// consent timestamp is written by the server. voice-reply refuses audio that
// has no session row, so no consent means no transcription.
// GUARDRAIL 1: the database trigger rejects any bank that is not is_demo.
// No telephone call is placed anywhere in this system.

import { audit, json, killSwitch, logCall, one } from "./_lib/core.js";
import { COMPAT, isUuid } from "./_lib/logic.js";

const LANGS = ["en-IN", "hi-IN", "kn-IN"];

export async function POST(request: Request): Promise<Response> {
  try {
    const blocked = await killSwitch("voice-start");
    if (blocked) return blocked;

    const body = await request.json();
    const { request_id, bank_id, blood_group, language_code } = body;

    if (!isUuid(request_id) || !isUuid(bank_id) || !COMPAT[blood_group] || !LANGS.includes(language_code)) {
      return json({ error: "bad_request", message: "request_id, bank_id, blood_group and language_code are required." }, 400);
    }

    const reqRow = await one("select id, blood_group from requests where id = $1", [request_id]);
    if (!reqRow) return json({ error: "unknown_request", message: "That request does not exist." }, 404);

    if (body.consent !== true) {
      await audit("hospital", "voice_refused_no_consent", {}, request_id, bank_id);
      return json({ error: "consent_required", message: "Recording needs the speaker's consent. Nothing was recorded." }, 403);
    }
    if (!COMPAT[reqRow.blood_group].includes(blood_group)) {
      return json({ error: "incompatible_group", message: `${blood_group} cannot be given to a ${reqRow.blood_group} patient.` }, 400);
    }

    let vc: { id: string; consent_at: string } | null = null;
    try {
      vc = await one(
        `insert into voice_calls (request_id, bank_id, blood_group, language_code, consent_at)
         values ($1, $2, $3, $4, now()) returning id, consent_at`,
        [request_id, bank_id, blood_group, language_code]);
    } catch (e) {
      const msg = String((e as Error)?.message ?? e);
      if (msg.includes("bank_not_on_demo_allowlist")) {
        await audit("system", "voice_refused_not_demo_bank", {}, request_id, bank_id);
        return json({ error: "bank_not_on_demo_allowlist", message: "Voice sessions are only allowed with demo banks." }, 403);
      }
      if (msg.includes("calls_disabled")) {
        return json({ error: "calls_disabled", message: "Calls are paused by an admin." }, 423);
      }
      if (msg.includes("foreign key")) return json({ error: "unknown_bank", message: "That bank does not exist." }, 404);
      throw e;
    }

    const bank = await one("select name from blood_banks where id = $1", [bank_id]);
    await logCall(request_id, bank_id, "voice",
      `Voice session opened with ${bank?.name}. AI disclosure read, consent recorded.`);

    return json({ voice_call_id: vc!.id, consent_at: vc!.consent_at });
  } catch (e) {
    return json({ error: "voice_start_failed", message: String(e).slice(0, 300) }, 500);
  }
}
