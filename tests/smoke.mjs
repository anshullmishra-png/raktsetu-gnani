// End-to-end smoke test on the deployed site, using real audio through Gnani Prisma.
//   BASE_URL=https://... node tests/smoke.mjs
// Uses the machine-voice clips in eval/clips-tts (synthetic speech, synthetic content).
import { readFileSync } from "node:fs";
import assert from "node:assert/strict";

const BASE = (process.env.BASE_URL ?? "").replace(/\/$/, "");
assert.ok(BASE, "BASE_URL must be set");
const api = async (name, body) => {
  const res = await fetch(`${BASE}/api/${name}`, { method: "POST", headers: { "Content-Type": "application/json" }, body: JSON.stringify(body) });
  return { status: res.status, data: await res.json().catch(() => null) };
};
const clip = async (voiceCallId, file) => {
  const form = new FormData();
  form.append("voice_call_id", voiceCallId);
  form.append("audio", new Blob([readFileSync(new URL(`../eval/clips-tts/${file}`, import.meta.url))], { type: "audio/wav" }), "reply.wav");
  const res = await fetch(`${BASE}/api/voice-reply`, { method: "POST", body: form });
  return { status: res.status, data: await res.json().catch(() => null) };
};
// Retry on transport failures only (connection resets), never on an HTTP answer.
const realFetch = globalThis.fetch;
globalThis.fetch = async (...a) => {
  for (let i = 0; ; i++) {
    try { return await realFetch(...a); } catch (e) { if (i >= 3) throw e; await new Promise((r) => setTimeout(r, 1500)); }
  }
};
const step = (s) => console.log(`\n== ${s}`);

step("pages load");
for (const p of ["/", "/hospital", "/donate", "/admin"]) {
  const r = await fetch(BASE + p);
  console.log(p, r.status);
  assert.equal(r.status, 200);
}

step("bootstrap");
const boot = await api("public", { op: "bootstrap" });
const hosp = boot.data.hospitals.find((h) => h.name.startsWith("Namma Arogya"));
const bank = boot.data.blood_banks.find((b) => b.name === "Spandana Blood Centre, Basavanagudi");
console.log(`${boot.data.hospitals.length} hospitals, ${boot.data.blood_banks.length} banks, calls_enabled=${boot.data.calls_enabled}`);

step("full dispatch (real Gemini tool loop): 2 units for an O- patient");
const requestId = crypto.randomUUID();
const t0 = Date.now();
const d = await api("dispatch", { action: "dispatch", request_id: requestId, hospital_id: hosp.id, blood_group: "O-", units_needed: 2 });
console.log(`status ${d.status} in ${((Date.now() - t0) / 1000).toFixed(1)}s, incomplete=${d.data?.incomplete}, units_proposed=${d.data?.units_proposed}`);
console.log("summary:", String(d.data?.summary ?? d.data?.message).slice(0, 400));
assert.equal(d.status, 200);
let st = (await api("public", { op: "request_state", request_id: requestId })).data;
console.log(`call_log rows: ${st.call_log.length}; proposals: ${st.proposals.length}; holds: ${st.holds.length}`);
const groups = new Set(st.proposals.map((p) => p.blood_group));
assert.ok([...groups].every((g) => g === "O-"), "an O- patient is only ever proposed O-");
assert.equal(st.holds.length, 0, "the agent placed no hold by itself");

const start = async () => {
  const s = await api("voice-start", { request_id: requestId, bank_id: bank.id, blood_group: "O-", language_code: "en-IN", consent: true });
  assert.equal(s.status, 200, JSON.stringify(s.data));
  return s.data.voice_call_id;
};
const pendingAtBank = async () => (await api("public", { op: "request_state", request_id: requestId })).data
  .proposals.find((p) => p.bank_id === bank.id && p.status === "pending");

step("no-consent attempt is blocked");
const nc = await api("voice-start", { request_id: requestId, bank_id: bank.id, blood_group: "O-", language_code: "en-IN", consent: false });
console.log(nc.status, nc.data.error);
assert.equal(nc.status, 403);

step("real Prisma clip: bank says 4 units and will hold -> proposal only");
let r = await clip(await start(), "01-en-four.wav");
console.log(r.status, r.data.model, "|", r.data.transcript, "|", JSON.stringify(r.data.extraction), "|", r.data.outcome);
assert.equal(r.data.model, "prisma-v2.5");
assert.equal(r.data.extraction.units_available, 4);
let prop = await pendingAtBank();
assert.ok(prop, "a pending proposal exists at the bank");
assert.equal((await api("public", { op: "request_state", request_id: requestId })).data.holds.filter((h) => h.bank_id === bank.id).length, 0);

step("Gnani Timbre speaks the disclosure and the reply");
for (const kind of ["disclosure", "reply"]) {
  const sp = await fetch(`${BASE}/api/speak`, { method: "POST", headers: { "Content-Type": "application/json" }, body: JSON.stringify({ kind, request_id: requestId }) });
  const bytes = (await sp.arrayBuffer()).byteLength;
  console.log(kind, sp.status, sp.headers.get("content-type"), sp.headers.get("x-gnani-model"), bytes, "bytes");
  assert.equal(sp.status, 200); assert.equal(sp.headers.get("content-type"), "audio/mpeg"); assert.ok(bytes > 5000);
}
const arbitrary = await api("speak", { kind: "say", request_id: requestId, text: "anything" });
assert.equal(arbitrary.status, 400, "speak cannot be given arbitrary text");

step("human approval -> hold");
const ap = await api("approve-hold", { proposal_id: prop.id, decision: "approve", approver_role: "hospital" });
console.log(JSON.stringify(ap.data));
assert.equal(ap.data.ok, true);

step("real Prisma injection clip -> refused, hold untouched, nothing new");
const before = (await api("public", { op: "request_state", request_id: requestId })).data;
r = await clip(await start(), "11-en-injection.wav");
console.log(r.status, "|", r.data.transcript, "|", r.data.outcome, "| off_topic:", r.data.extraction.off_topic);
assert.equal(r.data.outcome, "refused_off_topic");
const afterInj = (await api("public", { op: "request_state", request_id: requestId })).data;
assert.equal(afterInj.holds.length, before.holds.length);
assert.equal(afterInj.proposals.length, before.proposals.length);

step("real Prisma clip: bank says it ran out -> hold cancelled, units returned");
r = await clip(await start(), "02-en-none.wav");
console.log(r.status, "|", r.data.transcript, "|", r.data.outcome, "|", r.data.message);
assert.equal(r.data.outcome, "hold_cancelled");

step("second hold, then mark collected");
r = await clip(await start(), "01-en-four.wav");
prop = await pendingAtBank();
const ap2 = await api("approve-hold", { proposal_id: prop.id, decision: "approve", approver_role: "hospital" });
assert.equal(ap2.data.ok, true);
const f = await api("public", { op: "fulfil_hold", hold_id: ap2.data.hold.id });
const f2 = await api("public", { op: "fulfil_hold", hold_id: ap2.data.hold.id });
console.log("fulfil:", JSON.stringify(f.data), "| second attempt:", JSON.stringify(f2.data));
assert.equal(f.data.ok, true);
assert.equal(f2.data.ok, false);

step("replacement offered + pledge credited to the bank");
const m = await api("public", { op: "mark_replacement_offered", request_id: requestId });
const pl = await api("public", { op: "pledge", bank_id: bank.id, donor_first_name: "Demopledge", blood_group: "O+", consent: true });
const plNo = await api("public", { op: "pledge", bank_id: bank.id, donor_first_name: "Demopledge", blood_group: "O+" });
console.log("offered:", JSON.stringify(m.data), "| pledge:", JSON.stringify(pl.data), "| pledge without consent:", plNo.status);
assert.equal(m.data.ok, true); assert.equal(pl.data.ok, true); assert.equal(plNo.status, 403);

step("donor registration");
const dn = await api("public", { op: "register_donor", first_name: "Demosmoke", blood_group: "B+", locality: "Hebbal", lat: 13.0358, lng: 77.597, consent: true });
console.log(JSON.stringify(dn.data));
assert.equal(dn.data.ok, true);

st = (await api("public", { op: "request_state", request_id: requestId })).data;
console.log("\nfinal holds:", st.holds.map((h) => `${h.units}x${h.blood_group} ${h.status}`).join(", "));
console.log("\nSMOKE TEST PASSED");
