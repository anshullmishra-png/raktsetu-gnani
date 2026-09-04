// RaktSetu — Bolna post-call webhook receiver
//
// Deployed as a Supabase Edge Function (named `smooth-handler` in this
// project — Supabase auto-generates a name if you don't set one).
//
// IMPORTANT: turn OFF "Verify JWT" in the function's Settings tab. Bolna
// sends no Supabase auth header; with JWT on, every webhook is rejected
// before this code runs.
//
// Register the URL in Bolna: agent → Analytics tab → Webhook URL.
//
// Required secrets: SUPABASE_URL, SUPABASE_SERVICE_ROLE_KEY, BOLNA_API_KEY

import { createClient } from "https://esm.sh/@supabase/supabase-js@2";

const sb = createClient(
  Deno.env.get("SUPABASE_URL")!,
  Deno.env.get("SUPABASE_SERVICE_ROLE_KEY")!,
);

const BOLNA_KEY = Deno.env.get("BOLNA_API_KEY");

// The `completed` webhook can fire before Bolna has finished assembling the
// transcript and extractions, so its payload arrives half-populated — often
// with a one-line transcript containing only the agent's greeting. Fetching
// the execution record gives the authoritative version.
async function fetchExecution(execId: string) {
  if (!BOLNA_KEY) return null;
  try {
    const res = await fetch(`https://api.bolna.ai/executions/${execId}`, {
      headers: { "Authorization": `Bearer ${BOLNA_KEY}` },
    });
    if (!res.ok) return null;
    return await res.json();
  } catch {
    return null;
  }
}

// Bolna posts on every status change: initiated, ringing, in-progress,
// call-disconnected, completed. Only `completed` carries transcript and
// extracted_data.
const TERMINAL = [
  "completed", "no-answer", "busy", "failed",
  "canceled", "stopped", "error", "balance-low",
];

// extracted_data is nested by category, e.g.
//   { "Blood Request": { "units_available": { objective: null,
//                                             subjective: "They have 4 units" } } }
// The category name isn't known at runtime, so walk them all.
//
// Pre-defined answer types populate `objective` with the chosen option.
// Free Text types leave `objective` null and put a full sentence in
// `subjective`. Both are returned here; the caller decides how to read it.
function pick(extracted: any, name: string) {
  if (!extracted) return null;
  for (const category of Object.values(extracted) as any[]) {
    if (category?.[name]) {
      return category[name].objective ?? category[name].subjective ?? null;
    }
  }
  return null;
}

// Callers say "four units" as often as "4 units", and Free Text extractions
// wrap the answer in a sentence, so parse rather than cast.
const WORDS: Record<string, number> = {
  zero: 0, one: 1, two: 2, three: 3, four: 4, five: 5,
  six: 6, seven: 7, eight: 8, nine: 9, ten: 10,
  eleven: 11, twelve: 12, fifteen: 15, twenty: 20,
};

function parseUnits(raw: unknown): number {
  const text = String(raw ?? "").toLowerCase();
  const digits = text.match(/\d+/);
  if (digits) return parseInt(digits[0], 10);
  for (const [word, n] of Object.entries(WORDS)) {
    if (new RegExp(`\\b${word}\\b`).test(text)) return n;
  }
  return 0;
}

Deno.serve(async (req) => {
  try {
    let p = await req.json();
    const execId = String(p.execution_id ?? p.id ?? "");
    if (!execId) return new Response("no execution id", { status: 400 });

    const { data: vc } = await sb
      .from("voice_calls")
      .select("*")
      .eq("execution_id", execId)
      .maybeSingle();

    // Not a call we placed (e.g. Bolna's "Send test" payload) — ignore.
    if (!vc) return new Response("ok — unknown execution, ignored");

    await sb.from("voice_calls")
      .update({ status: p.status, updated_at: new Date().toISOString() })
      .eq("execution_id", execId);

    if (!TERMINAL.includes(p.status)) return new Response("ok — interim status");

    const { data: bank } = await sb
      .from("blood_banks").select("name").eq("id", vc.bank_id).maybeSingle();
    const name = bank?.name ?? "Unknown bank";

    // Hard failure — nobody answered, line busy, etc.
    if (p.status !== "completed") {
      await sb.from("call_log").insert({
        request_id: vc.request_id,
        bank_id: vc.bank_id,
        event: "no_answer",
        message: `VOICE CALL to ${name} ended without a conversation: ${p.status}`,
      });
      return new Response("ok — terminal failure logged");
    }

    // Give Bolna a moment, then pull the finalized record over the webhook
    // payload. Without this the transcript is usually just the greeting.
    await new Promise((r) => setTimeout(r, 3000));
    const full = await fetchExecution(execId);
    if (full) p = { ...p, ...full };

    const unitsRaw = pick(p.extracted_data, "units_available");
    const holdRaw = pick(p.extracted_data, "will_hold");
    const hoursRaw = pick(p.extracted_data, "collection_hours");

    const units = parseUnits(unitsRaw);
    const willHold = String(holdRaw ?? "").trim().toLowerCase().startsWith("y");

    await sb.from("voice_calls").update({
      transcript: p.transcript ?? null,
      units_reported: units,
      will_hold: willHold,
    }).eq("execution_id", execId);

    await sb.from("call_log").insert({
      request_id: vc.request_id,
      bank_id: vc.bank_id,
      event: units > 0 && willHold ? "confirmed" : "declined",
      units_offered: willHold ? units : 0,
      message:
        `VOICE CALL RESULT — ${name} reported ${units} units of ${vc.blood_group}, ` +
        `hold ${willHold ? "agreed" : "refused"}` +
        (hoursRaw ? `, collection ${hoursRaw}` : "") +
        ` (${p.conversation_duration ?? "?"}s call)`,
    });

    // Raw extraction kept for debugging. If the parsed values above look
    // wrong, read this row to see the actual payload shape.
    await sb.from("call_log").insert({
      request_id: vc.request_id,
      bank_id: vc.bank_id,
      event: "system",
      message: `Raw extraction: ${JSON.stringify(p.extracted_data ?? {}).slice(0, 1500)}`,
    });

    return new Response("ok — result logged");
  } catch (e) {
    return new Response("error: " + String(e), { status: 500 });
  }
});