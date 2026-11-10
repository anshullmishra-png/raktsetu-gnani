// Generate the home page video narration with Gnani Timbre.
//   node --env-file=.env scripts/gen-narration.mjs
// Writes web/public/narration/NN.mp3 and scripts/narration.json (text + duration).
import { mkdirSync, writeFileSync } from "node:fs";

export const LINES = [
  ["The portal lists 4 units of O−. The listing is 31 hours old.", "The portal lists four units of O negative at this blood bank. But the listing is thirty one hours old."],
  ["RaktSetu checks before anyone travels.", "RaktSetu checks before anyone travels."],
  ["A hospital asks for 2 units of O−. No patient details.", "A hospital asks for two units of O negative. No patient details are needed."],
  ["Nearby banks are checked at once. Stale listings drop off the map.", "Nearby blood banks are checked at once. Stale listings drop off the map."],
  ["One bank really has it. The assistant proposes a hold.", "One bank really has it. The assistant proposes a hold."],
  ["Nothing is reserved until a person approves.", "Nothing is reserved until a person approves."],
  ["Approved: 2 units held for 30 minutes.", "Approved. Two units are held for thirty minutes."],
  ["Then hear it from the bank. Gnani Timbre speaks the AI disclosure.", "Then we hear it from the bank. A Gnani Timbre voice speaks the A I disclosure."],
  ["The speaker consents to being recorded.", "The speaker consents to being recorded."],
  ["The bank replies: “Sorry, we ran out of O negative yesterday.”", "The bank replies. Sorry, we ran out of O negative yesterday."],
  ["Gnani Prisma transcribes the reply.", "Gnani Prisma transcribes the reply."],
  ["The bank cannot supply, so the hold is cancelled and the units go back.", "The bank cannot supply, so the hold is cancelled, and the units go back to stock."],
  ["Admin: one switch pauses everything.", "In admin, one switch pauses everything."],
  ["Every step is in an audit log nobody can edit.", "Every step is written to an audit log that nobody can edit."],
  ["RaktSetu. All data in this demo is synthetic.", "RaktSetu. All data in this demo is synthetic."],
];

const key = process.env.GNANI_API_KEY;
if (!key) { console.error("GNANI_API_KEY missing"); process.exit(1); }
const dir = new URL("../web/public/narration/", import.meta.url);
mkdirSync(dir, { recursive: true });
const out = [];
for (const [i, [caption, spoken]] of LINES.entries()) {
  let buf;
  for (let a = 0; ; a++) {
    try {
      const r = await fetch("https://api.vachana.ai/api/v1/tts/inference", {
        method: "POST", headers: { "Content-Type": "application/json", "X-API-Key-ID": key },
        body: JSON.stringify({ text: spoken, voice: "Kaveri", model: "timbre-v2.5", language: "en-IN", speed: 1.0,
          audio_config: { sample_rate: 24000, num_channels: 1, sample_width: 2, container: "mp3", bitrate: "64k" } }),
      });
      if (!r.ok) throw new Error(`Timbre ${r.status}: ${(await r.text()).slice(0, 120)}`);
      buf = Buffer.from(await r.arrayBuffer()); break;
    } catch (e) { if (a >= 3) throw e; await new Promise((r) => setTimeout(r, 1500)); }
  }
  const name = String(i).padStart(2, "0") + ".mp3";
  writeFileSync(new URL(name, dir), buf);
  const dur = +(buf.length / 8000).toFixed(2); // 64 kbit/s constant bitrate
  out.push({ caption, src: "/narration/" + name, dur });
  console.log(name, dur + "s", buf.length, "bytes");
}
writeFileSync(new URL("./narration.json", import.meta.url), JSON.stringify(out, null, 2));
console.log("total speech:", out.reduce((s, x) => s + x.dur, 0).toFixed(1), "s");
