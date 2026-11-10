// RaktSetu — transcribe a blood bank's spoken reply with Gnani Prisma, then
// extract structured fields with Gemini. Replaces the old Bolna webhook.
//
// Pipeline: audio -> Prisma (server-side; the Gnani key never reaches the
// browser) -> PII redaction in code -> Gemini extraction with the transcript
// as untrusted data -> validation in code -> call_log + audit_log -> either a
// PENDING hold proposal, a cancel_hold_atomic, or nothing.
//
// GUARDRAIL 4/6: this function has no path that places a hold. The most a
// transcript can cause is a proposal a human must approve, capped at the
// units the hospital asked for.

import { audit, gemini, GEMINI_MODEL, isAdmin, json, killSwitch, logCall, one, q } from "./_lib/core.js";
import {
  decideVoiceAction, EXTRACT_SCHEMA, EXTRACT_SYSTEM, type Extraction, isUuid, redactPII,
  validateExtraction, wavDurationSeconds,
} from "./_lib/logic.js";

const GNANI_URL = "https://api.vachana.ai/stt/v3";
const GNANI_MODEL = process.env.GNANI_MODEL ?? "prisma-v2.5";
const MAX_BYTES = 3 * 1024 * 1024;
const MAX_SECONDS = 30;

async function transcribe(bytes: Uint8Array, languageCode: string): Promise<{ transcript: string; model: string }> {
  const key = process.env.GNANI_API_KEY;
  if (!key) throw new Error("GNANI_API_KEY is not set");

  const form = new FormData();
  form.append("audio_file", new Blob([bytes as BlobPart], { type: "audio/wav" }), "reply.wav");
  form.append("language_code", languageCode);
  form.append("model", GNANI_MODEL);
  form.append("format", "transcribe"); // inverse text normalisation: numbers as digits

  const res = await fetch(GNANI_URL, { method: "POST", headers: { "X-API-Key-ID": key }, body: form });
  const text = await res.text();
  if (!res.ok) throw new Error(`Prisma ${res.status}: ${text.slice(0, 300)}`);

  let out: any;
  try { out = JSON.parse(text); } catch { throw new Error("Prisma returned non-JSON"); }
  const t = typeof out.transcript === "string" ? out.transcript
    : typeof out.output?.transcript === "string" ? out.output.transcript
    : typeof out.output?.literal === "string" ? out.output.literal : "";
  return { transcript: t.trim(), model: String(out.model ?? GNANI_MODEL) };
}

async function extract(transcript: string): Promise<{ raw: unknown; spans: string[] }> {
  const data = await gemini({
    systemInstruction: { parts: [{ text: EXTRACT_SYSTEM }] },
    contents: [{ role: "user", parts: [{ text: `<transcript>\n${transcript}\n</transcript>` }] }],
    generationConfig: { responseMimeType: "application/json", responseSchema: EXTRACT_SCHEMA, temperature: 0 },
  });
  const text = (data.candidates?.[0]?.content?.parts ?? []).map((p: any) => p.text ?? "").join("");
  let raw: unknown = null;
  try { raw = JSON.parse(text); } catch { raw = null; }
  const spans = Array.isArray((raw as any)?.pii_spans)
    ? (raw as any).pii_spans.filter((s: unknown) => typeof s === "string").slice(0, 10) : [];
  return { raw, spans };
}

export async function POST(request: Request): Promise<Response> {
  try {
    const blocked = await killSwitch("voice-reply");
    if (blocked) return blocked;

    // Two input modes. Normal: multipart with a WAV. Test: JSON with
    // test_transcript, accepted ONLY with the admin passcode, used by the
    // automated guardrail tests. It skips Prisma and is recorded as such.
    let voiceCallId = "";
    let audio: Blob | null = null;
    let testTranscript: string | null = null;

    const ctype = request.headers.get("content-type") ?? "";
    if (ctype.includes("multipart/form-data")) {
      const form = await request.formData();
      voiceCallId = String(form.get("voice_call_id") ?? "");
      const f = form.get("audio");
      if (f && typeof f !== "string") audio = f as Blob;
    } else {
      const body = await request.json();
      voiceCallId = String(body.voice_call_id ?? "");
      if (typeof body.test_transcript === "string") {
        if (!isAdmin(request)) return json({ error: "unauthorised", message: "test_transcript needs the admin passcode." }, 401);
        testTranscript = body.test_transcript.slice(0, 2000);
      }
    }

    // GUARDRAIL 2: audio is only accepted against a session that recorded consent.
    const vc = isUuid(voiceCallId) ? await one("select * from voice_calls where id = $1", [voiceCallId]) : null;
    if (!vc || !vc.consent_at) {
      await audit("system", "voice_refused_no_session", {});
      return json({ error: "consent_required", message: "No consented voice session. Nothing was transcribed." }, 403);
    }
    if (vc.status !== "awaiting_audio") {
      return json({ error: "session_already_used", message: "This voice session already has a reply. Start a new one." }, 409);
    }
    if (Date.now() - new Date(vc.consent_at).getTime() > 30 * 60 * 1000) {
      return json({ error: "session_expired", message: "Consent was given more than 30 minutes ago. Start a new session." }, 410);
    }

    const reqRow = await one("select units_needed from requests where id = $1", [vc.request_id]);
    const bank = await one("select name from blood_banks where id = $1", [vc.bank_id]);
    const bankName = bank?.name ?? "the bank";

    // ── 1. Speech to text (Gnani Prisma) ──
    let transcriptRaw = "";
    let model = "";
    if (testTranscript !== null) {
      transcriptRaw = testTranscript;
      model = "test-transcript (Prisma skipped)";
    } else {
      if (!audio) return json({ error: "bad_request", message: "An audio file is required." }, 400);
      if (audio.size > MAX_BYTES) return json({ error: "audio_too_large", message: "Clip is too large. Keep it under 30 seconds." }, 413);
      const bytes = new Uint8Array(await audio.arrayBuffer());
      const secs = wavDurationSeconds(bytes);
      if (secs === null) return json({ error: "bad_audio", message: "Audio must be a WAV file." }, 400);
      if (secs > MAX_SECONDS + 0.5) return json({ error: "audio_too_long", message: "Prisma accepts at most 30 seconds per clip." }, 413);

      const stt = await transcribe(bytes, vc.language_code);
      transcriptRaw = stt.transcript;
      model = stt.model;
      await audit("system", "voice_transcribed",
        { voice_call_id: vc.id, model, language_code: vc.language_code, seconds: +secs.toFixed(1), chars: transcriptRaw.length },
        vc.request_id, vc.bank_id);
    }

    if (!transcriptRaw) {
      await q("update voice_calls set status = 'completed', model = $2, transcript = '', outcome = 'no_speech', updated_at = now() where id = $1",
        [vc.id, model]);
      await logCall(vc.request_id, vc.bank_id, "voice", `Voice reply from ${bankName}: no speech detected. Nothing changed.`);
      await audit("system", "voice_no_speech", { voice_call_id: vc.id }, vc.request_id, vc.bank_id);
      return json({
        transcript: "", model, language_code: vc.language_code,
        extraction: { units_available: null, will_hold: null, collection_hours: null, off_topic: false, pii_redacted: false, needs_review: false },
        outcome: "no_speech", message: "No speech was detected in the clip. Nothing changed.",
      });
    }

    // ── 2. Redact in code, extract with Gemini, redact again with its spans ──
    const first = redactPII(transcriptRaw);
    const { raw, spans } = await extract(first.text);
    const second = redactPII(first.text, spans);
    const transcript = second.text;
    const piiRedacted = first.redacted || second.redacted;

    // ── 3. Validate in code ──
    const ex: Extraction = validateExtraction(raw, transcript);
    const action = decideVoiceAction(ex);

    await audit("system", "voice_extracted", {
      voice_call_id: vc.id, extractor: GEMINI_MODEL, transcript,
      units_available: ex.units_available, will_hold: ex.will_hold, collection_hours: ex.collection_hours,
      off_topic: ex.off_topic, needs_review: ex.needs_review, pii_redacted: piiRedacted,
    }, vc.request_id, vc.bank_id);

    // ── 4. Act. No branch here places a hold. ──
    let outcome = "declined";
    let message = "";
    let proposalId: string | null = null;
    const match = [vc.request_id, vc.bank_id, vc.blood_group];

    if (action === "refuse") {
      outcome = "refused_off_topic";
      message = "That clip was not a reply about blood availability, so it was ignored. Nothing was reserved or changed.";
      await logCall(vc.request_id, vc.bank_id, "refused", `Voice reply from ${bankName} refused as off-topic. No action taken.`);
      await audit("system", "voice_refused_off_topic", { voice_call_id: vc.id }, vc.request_id, vc.bank_id);
    } else if (action === "cancel") {
      const c = (await one<{ r: any }>(
        "select cancel_hold_atomic($1, $2, $3, 'bank said on the voice session it cannot supply') as r", match))?.r;
      // Also withdraw any proposal still waiting for approval at this bank.
      const pend = await q<{ id: string }>(
        "select id from hold_proposals where request_id = $1 and bank_id = $2 and blood_group = $3 and status = 'pending'", match);
      for (const p of pend) await q("select reject_proposal($1, 'system')", [p.id]);

      if (c?.ok) {
        outcome = "hold_cancelled";
        message = `${bankName} cannot supply ${vc.blood_group}. The hold was cancelled and ${c.units_returned} units went back to stock.`;
        await logCall(vc.request_id, vc.bank_id, "cancelled", `VOICE: ${bankName} cannot supply ${vc.blood_group}. Hold cancelled, units returned.`);
      } else {
        outcome = "declined";
        message = `${bankName} cannot supply ${vc.blood_group}.` +
          (pend.length ? " The pending proposal was withdrawn." : " There was no hold to cancel.");
        await logCall(vc.request_id, vc.bank_id, "declined", `VOICE: ${bankName} cannot supply ${vc.blood_group}.`);
      }
    } else if (action === "propose") {
      const existing = await one(
        "select id from holds where request_id = $1 and bank_id = $2 and blood_group = $3 and status = 'active' limit 1", match);
      const pend = await one<{ id: string }>(
        "select id from hold_proposals where request_id = $1 and bank_id = $2 and blood_group = $3 and status = 'pending' limit 1", match);

      if (existing) {
        outcome = "hold_confirmed";
        message = `${bankName} confirmed ${ex.units_available} units of ${vc.blood_group}. The existing hold stands.`;
      } else if (pend) {
        outcome = "proposal_created";
        proposalId = pend.id;
        message = `${bankName} confirmed ${ex.units_available} units of ${vc.blood_group}. A proposal is already waiting for approval.`;
      } else {
        const units = Math.max(1, Math.min(ex.units_available!, reqRow?.units_needed ?? 1, 10));
        const p = await one<{ id: string }>(
          `insert into hold_proposals (request_id, bank_id, blood_group, units, source)
           values ($1, $2, $3, $4, 'voice') returning id`, [...match, units]);
        proposalId = p!.id;
        outcome = "proposal_created";
        message = `${bankName} says ${ex.units_available} units of ${vc.blood_group} and will hold. Proposed ${units} — waiting for a person to approve.`;
      }
      await logCall(vc.request_id, vc.bank_id, outcome === "hold_confirmed" ? "confirmed" : "proposed",
        `VOICE: ${message}`, ex.units_available ?? 0);
    } else {
      outcome = "declined";
      message = ex.needs_review
        ? "The number heard could not be verified against the words spoken. Nothing changed; please re-record or check by hand."
        : "The reply did not clearly state units and a hold. Nothing changed.";
      await logCall(vc.request_id, vc.bank_id, "voice", `Voice reply from ${bankName} was unclear. Nothing changed.`);
    }

    await q(
      `update voice_calls set status = 'completed', model = $2, transcript = $3, units_reported = $4, will_hold = $5,
         collection_hours = $6, off_topic = $7, pii_redacted = $8, needs_review = $9, outcome = $10, updated_at = now()
       where id = $1`,
      [vc.id, model, transcript, ex.units_available, ex.will_hold, ex.collection_hours, ex.off_topic, piiRedacted, ex.needs_review, outcome]);

    return json({
      transcript, model, language_code: vc.language_code,
      extraction: { ...ex, pii_redacted: piiRedacted },
      outcome, message, proposal_id: proposalId,
    });
  } catch (e) {
    return json({ error: "voice_reply_failed", message: String(e).slice(0, 400) }, 500);
  }
}
