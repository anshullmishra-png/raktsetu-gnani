// Voice round trip on the deployed site: Gnani Timbre speaks, Gnani Prisma
// listens to that same audio, and the words must match what was meant.
//   BASE_URL=https://... node --env-file=.env tests/voice-roundtrip.mjs
import assert from "node:assert/strict";

const BASE = (process.env.BASE_URL ?? "").replace(/\/$/, "");
const KEY = process.env.GNANI_API_KEY;
assert.ok(BASE && KEY, "BASE_URL and GNANI_API_KEY must be set");

const post = async (name, body) => {
  for (let i = 0; ; i++) {
    try {
      return await fetch(`${BASE}/api/${name}`, { method: "POST", headers: { "Content-Type": "application/json" }, body: JSON.stringify(body) });
    } catch (e) { if (i >= 3) throw e; await new Promise((r) => setTimeout(r, 1500)); }
  }
};
const hear = async (mp3) => {
  const form = new FormData();
  form.append("audio_file", new Blob([mp3], { type: "audio/mpeg" }), "speech.mp3");
  form.append("language_code", "en-IN");
  form.append("model", "prisma-v2.5");
  form.append("format", "transcribe");
  const r = await fetch("https://api.vachana.ai/stt/v3", { method: "POST", headers: { "X-API-Key-ID": KEY }, body: form });
  assert.equal(r.status, 200, "Prisma accepted the Timbre audio");
  return (await r.json()).transcript.toLowerCase();
};

// A request to speak about.
const t = await (await post("dispatch", { action: "test_calls", blood_group: "O+", units: 2 })).json();
const requestId = t.request_id;
const boot = await (await post("public", { op: "bootstrap" })).json();
const bank = boot.blood_banks[0];

// 1. Disclosure
let r = await post("speak", { kind: "disclosure", request_id: requestId });
assert.equal(r.status, 200);
assert.equal(r.headers.get("content-type"), "audio/mpeg");
let heard = await hear(await r.arrayBuffer());
console.log("Timbre disclosure, as heard by Prisma:\n  " + heard);
for (const w of ["ai assistant", "recorded", "transcribed", "synthetic", "positive", "patient"]) {
  assert.ok(heard.includes(w), `disclosure audio contains "${w}"`);
}
// Prisma may write the brand name several ways; just require something close.
assert.ok(/rak|rock|rakt|setu|sethu/.test(heard), "brand name is spoken");

// 2. Reply: create a voice result, then have Timbre speak it.
const vs = await (await post("voice-start", { request_id: requestId, bank_id: bank.id, blood_group: "O+", language_code: "en-IN", consent: true })).json();
const vr = await fetch(`${BASE}/api/voice-reply`, {
  method: "POST",
  headers: { "Content-Type": "application/json", "x-admin-passcode": process.env.ADMIN_PASSCODE },
  body: JSON.stringify({ voice_call_id: vs.voice_call_id, test_transcript: "Sorry, we ran out of O positive yesterday. We cannot supply." }),
});
const vrj = await vr.json();
console.log("\nRaktSetu's reply text:\n  " + vrj.message);
r = await post("speak", { kind: "reply", request_id: requestId });
assert.equal(r.status, 200);
heard = await hear(await r.arrayBuffer());
console.log("Timbre reply, as heard by Prisma:\n  " + heard);
assert.ok(heard.includes("cannot supply"), 'reply audio contains "cannot supply"');
assert.ok(heard.includes("positive"), 'reply audio says the blood group in words');

console.log("\nVOICE ROUND TRIP PASSED");
