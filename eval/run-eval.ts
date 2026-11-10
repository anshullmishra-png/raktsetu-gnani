// RaktSetu — real Prisma eval.
//
//   node --env-file=.env eval/run-eval.ts            human clips in eval/clips/
//   node --env-file=.env eval/run-eval.ts --tts      machine TTS clips in eval/clips-tts/
//
// For each clip listed in eval/clips.json that exists on disk: send the audio
// to Gnani Prisma, redact, extract with Gemini using the SAME prompt and
// validation code as the voice-reply edge function, and compare with the
// expectation. Writes eval/RESULTS.md (or RESULTS-tts.md) and rows in
// eval_runs. Numbers in those files only ever come from this script.

import { existsSync, readdirSync, readFileSync, writeFileSync } from "node:fs";
import { randomUUID } from "node:crypto";
import { basename, extname, join } from "node:path";
import {
  decideVoiceAction, EXTRACT_SCHEMA, EXTRACT_SYSTEM, redactPII, validateExtraction,
} from "../web/api/_lib/logic.ts";

const tts = process.argv.includes("--tts");
const dir = join(import.meta.dirname, tts ? "clips-tts" : "clips");
const source = tts ? "machine_tts" : "human_recording";
const outFile = join(import.meta.dirname, tts ? "RESULTS-tts.md" : "RESULTS.md");

const need = (k: string) => {
  const v = process.env[k];
  if (!v) { console.error(`Missing ${k} in .env`); process.exit(1); }
  return v;
};
const GNANI_KEY = need("GNANI_API_KEY");
const GEMINI_KEY = need("GEMINI_API_KEY");
const SUPABASE_URL = need("VITE_SUPABASE_URL");
const SERVICE_KEY = need("SUPABASE_SERVICE_ROLE_KEY");
const GNANI_MODEL = process.env.GNANI_MODEL ?? "prisma-v2.5";
const GEMINI_MODEL = process.env.GEMINI_MODEL ?? "gemini-3.1-flash-lite";

const MIME: Record<string, string> = {
  ".wav": "audio/wav", ".mp3": "audio/mpeg", ".m4a": "audio/mp4", ".ogg": "audio/ogg",
  ".flac": "audio/flac", ".aac": "audio/aac",
};

type Spec = {
  clip: string; language_code: string; label: string;
  expected_units: number | null; expected_hold: boolean | null; expected_off_topic: boolean;
  must_not_contain?: string[];
};
const specs: Spec[] = JSON.parse(readFileSync(join(import.meta.dirname, "clips.json"), "utf8"));
const files = existsSync(dir) ? readdirSync(dir).filter((f) => MIME[extname(f).toLowerCase()]) : [];

async function prisma(path: string, lang: string) {
  const form = new FormData();
  const ext = extname(path).toLowerCase();
  form.append("audio_file", new Blob([readFileSync(path)], { type: MIME[ext] }), "clip" + ext);
  form.append("language_code", lang);
  form.append("model", GNANI_MODEL);
  form.append("format", "transcribe");
  const t0 = Date.now();
  const res = await fetch("https://api.vachana.ai/stt/v3", { method: "POST", headers: { "X-API-Key-ID": GNANI_KEY }, body: form });
  const text = await res.text();
  if (!res.ok) throw new Error(`Prisma ${res.status}: ${text.slice(0, 200)}`);
  const out = JSON.parse(text);
  const transcript = typeof out.transcript === "string" ? out.transcript
    : out.output?.transcript ?? out.output?.literal ?? "";
  return { transcript: String(transcript).trim(), model: String(out.model ?? GNANI_MODEL), ms: Date.now() - t0, raw: out };
}

async function extract(transcript: string) {
  for (let attempt = 0; attempt < 4; attempt++) {
    const res = await fetch(`https://generativelanguage.googleapis.com/v1beta/models/${GEMINI_MODEL}:generateContent`, {
      method: "POST",
      headers: { "Content-Type": "application/json", "x-goog-api-key": GEMINI_KEY },
      body: JSON.stringify({
        systemInstruction: { parts: [{ text: EXTRACT_SYSTEM }] },
        contents: [{ role: "user", parts: [{ text: `<transcript>\n${transcript}\n</transcript>` }] }],
        generationConfig: { responseMimeType: "application/json", responseSchema: EXTRACT_SCHEMA, temperature: 0 },
      }),
    });
    if (res.ok) {
      const data = await res.json();
      const text = (data.candidates?.[0]?.content?.parts ?? []).map((p: any) => p.text ?? "").join("");
      try { return JSON.parse(text); } catch { return null; }
    }
    if (![429, 500, 503].includes(res.status) || attempt === 3) throw new Error(`Gemini ${res.status}: ${(await res.text()).slice(0, 200)}`);
    await new Promise((r) => setTimeout(r, 2000 * (attempt + 1)));
  }
}

const runId = randomUUID();
const rows: any[] = [];
let printedShape = false;

for (const spec of specs) {
  const file = files.find((f) => basename(f, extname(f)) === spec.clip);
  if (!file) continue;
  const row: any = { ...spec, file, pass: false, notes: "", transcript: "", got_units: null, got_hold: null, got_off_topic: null, model: GNANI_MODEL, ms: null };
  try {
    const stt = await prisma(join(dir, file), spec.language_code);
    if (!printedShape) {
      printedShape = true;
      console.log("Raw Prisma response shape (first clip):");
      console.log(JSON.stringify(stt.raw, null, 2).slice(0, 1500));
    }
    row.model = stt.model; row.ms = stt.ms;
    const first = redactPII(stt.transcript);
    const raw = stt.transcript ? await extract(first.text) : null;
    const spans = Array.isArray(raw?.pii_spans) ? raw.pii_spans.filter((s: unknown) => typeof s === "string") : [];
    const second = redactPII(first.text, spans);
    const ex = validateExtraction(raw, second.text);
    row.transcript = second.text;
    row.got_units = ex.units_available; row.got_hold = ex.will_hold; row.got_off_topic = ex.off_topic;
    row.action = decideVoiceAction(ex);

    const fails: string[] = [];
    if (!stt.transcript) fails.push("empty transcript");
    if (ex.off_topic !== spec.expected_off_topic) fails.push(`off_topic ${ex.off_topic}, expected ${spec.expected_off_topic}`);
    if (!spec.expected_off_topic) {
      if (ex.units_available !== spec.expected_units) fails.push(`units ${ex.units_available}, expected ${spec.expected_units}`);
      // A reply of "none" need not mention holding; no-units implies no hold.
      const gotHold = ex.will_hold ?? (ex.units_available === 0 ? false : null);
      if (gotHold !== spec.expected_hold) fails.push(`hold ${ex.will_hold}, expected ${spec.expected_hold}`);
    } else if (row.action !== "refuse") fails.push(`action ${row.action}, expected refuse`);
    for (const s of spec.must_not_contain ?? []) {
      if (second.text.replace(/\s/g, "").toLowerCase().includes(s.toLowerCase())) fails.push(`PII "${s}" not redacted`);
    }
    if (ex.needs_review) fails.push("needs_review (number not corroborated by transcript)");
    row.pass = fails.length === 0;
    row.notes = fails.join("; ");
  } catch (e) {
    row.notes = "ERROR: " + String(e).slice(0, 200);
  }
  rows.push(row);
  console.log(`${row.pass ? "PASS" : "FAIL"}  ${spec.clip}  [${spec.language_code}]  "${row.transcript}"  ${row.notes}`);
}

if (!rows.length) {
  console.log(`No clips found in ${dir}. See eval/sentences.md. Nothing written.`);
  process.exit(0);
}

// Store in eval_runs (service role; the table is not readable with the anon key).
const ins = await fetch(`${SUPABASE_URL}/rest/v1/eval_runs`, {
  method: "POST",
  headers: { apikey: SERVICE_KEY, Authorization: `Bearer ${SERVICE_KEY}`, "Content-Type": "application/json", Prefer: "return=minimal" },
  body: JSON.stringify(rows.map((r) => ({
    run_id: runId, clip: r.file, source, language_code: r.language_code, model: r.model,
    expected_units: r.expected_units, got_units: r.got_units, expected_hold: r.expected_hold, got_hold: r.got_hold,
    expected_off_topic: r.expected_off_topic, got_off_topic: r.got_off_topic,
    transcript: r.transcript, pass: r.pass, notes: r.notes || null,
  }))),
});
const stored = ins.ok ? "stored in eval_runs" : `NOT stored in eval_runs (HTTP ${ins.status})`;

const passed = rows.filter((r) => r.pass).length;
const byLang = new Map<string, { n: number; p: number }>();
for (const r of rows) {
  const k = r.label.split(",")[0];
  const v = byLang.get(k) ?? { n: 0, p: 0 };
  v.n++; if (r.pass) v.p++;
  byLang.set(k, v);
}
const missing = specs.filter((s) => !rows.some((r) => r.clip === s.clip)).map((s) => s.clip);
const cell = (v: unknown) => (v === null || v === undefined ? "none" : String(v)).replaceAll("|", "\\|");

const md = `# Eval results${tts ? " (machine TTS wiring check, NOT human speech)" : ""}

Generated by \`eval/run-eval.ts\` on ${new Date().toISOString()} (run \`${runId}\`, ${stored}).
Speech-to-text: Gnani **${rows[0].model}**. Extraction: ${GEMINI_MODEL} plus code validation.
Clips: ${tts ? "Windows text-to-speech, synthetic voice" : "recorded by the team, synthetic content"}.

**${passed} of ${rows.length} clips passed** end to end (units, hold and off-topic flag all correct).

| Group | Passed |
|---|---|
${[...byLang].map(([k, v]) => `| ${k} | ${v.p} of ${v.n} |`).join("\n")}

| Clip | Lang | Prisma transcript (after redaction) | Units exp / got | Hold exp / got | Off-topic exp / got | Result | Notes |
|---|---|---|---|---|---|---|---|
${rows.map((r) => `| ${r.file} | ${r.language_code} | ${cell(r.transcript)} | ${cell(r.expected_units)} / ${cell(r.got_units)} | ${cell(r.expected_hold)} / ${cell(r.got_hold)} | ${cell(r.expected_off_topic)} / ${cell(r.got_off_topic)} | ${r.pass ? "PASS" : "**FAIL**"} | ${cell(r.notes || "")} |`).join("\n")}
${missing.length ? `\nNot run (no clip on disk): ${missing.join(", ")}.\n` : ""}`;
writeFileSync(outFile, md);
console.log(`\n${passed} of ${rows.length} passed. Wrote ${outFile}; ${stored}.`);
