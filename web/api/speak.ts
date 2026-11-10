// RaktSetu — speech out with Gnani Timbre (text-to-speech), server-side.
//
// The browser never sends text to speak. It names one of two fixed things and
// the server composes the words from the database, so this cannot be used as
// an open text-to-speech proxy and cannot be made to say arbitrary content:
//   kind "disclosure": the AI disclosure script for a request
//   kind "reply":      RaktSetu's summary of the latest voice reply for a request

import { audit, json, killSwitch, one } from "./_lib/core.js";
import { isUuid } from "./_lib/logic.js";

const TTS_URL = "https://api.vachana.ai/api/v1/tts/inference";
const TTS_MODEL = process.env.GNANI_TTS_MODEL ?? "timbre-v2.5";
const TTS_VOICE = process.env.GNANI_TTS_VOICE ?? "Kaveri";

const WORDS = ["zero", "one", "two", "three", "four", "five", "six", "seven", "eight", "nine", "ten"];

/** Timbre wants numbers and symbols spelled out. */
export function speakable(text: string): string {
  return text
    .replace(/\b(AB|A|B|O)([+-])(?=[\s.,]|$)/g, (_m, g: string, s: string) => `${g} ${s === "+" ? "positive" : "negative"}`)
    .replace(/\b(\d{1,2})\b/g, (m) => (Number(m) <= 10 ? WORDS[Number(m)] : m))
    .replace(/[—–]/g, ", ")
    .replace(/\s+/g, " ")
    .trim()
    .slice(0, 600);
}

export async function POST(request: Request): Promise<Response> {
  try {
    const blocked = await killSwitch("speak");
    if (blocked) return blocked;

    const { kind, request_id } = await request.json();
    if (!isUuid(request_id) || !["disclosure", "reply"].includes(kind)) {
      return json({ error: "bad_request", message: "kind and request_id are required." }, 400);
    }
    const req = await one("select hospital, blood_group from requests where id = $1", [request_id]);
    if (!req) return json({ error: "unknown_request", message: "That request does not exist." }, 404);

    let text: string;
    if (kind === "disclosure") {
      text =
        `This is RaktSetu, an AI assistant, calling on behalf of ${req.hospital}. ` +
        "This session is recorded and transcribed by an automated speech to text system. " +
        "All data in this demo is synthetic. " +
        `Please tell us how many units of ${req.blood_group} you can supply, whether you can hold them, and your collection hours. ` +
        "Do not share any patient names or phone numbers.";
    } else {
      const vc = await one(
        "select result_message from voice_calls where request_id = $1 and status = 'completed' order by updated_at desc limit 1", [request_id]);
      if (!vc?.result_message) return json({ error: "nothing_to_say", message: "There is no reply to read out yet." }, 404);
      text = vc.result_message;
    }

    const key = process.env.GNANI_API_KEY;
    if (!key) throw new Error("GNANI_API_KEY is not set");
    const res = await fetch(TTS_URL, {
      method: "POST",
      headers: { "Content-Type": "application/json", "X-API-Key-ID": key },
      body: JSON.stringify({
        text: speakable(text), voice: TTS_VOICE, model: TTS_MODEL, language: "en-IN", speed: 1.0,
        audio_config: { sample_rate: 24000, num_channels: 1, sample_width: 2, container: "mp3", bitrate: "64k" },
      }),
    });
    if (!res.ok) throw new Error(`Timbre ${res.status}: ${(await res.text()).slice(0, 200)}`);

    await audit("system", "voice_spoken", { kind, model: TTS_MODEL, voice: TTS_VOICE }, request_id);
    return new Response(await res.arrayBuffer(), {
      status: 200,
      headers: { "Content-Type": "audio/mpeg", "Cache-Control": "no-store", "X-Gnani-Model": TTS_MODEL },
    });
  } catch (e) {
    return json({ error: "speak_failed", message: String(e).slice(0, 300) }, 500);
  }
}
