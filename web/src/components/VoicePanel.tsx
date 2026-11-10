import { ChangeEvent, useEffect, useRef, useState } from "react";
import { LanguageCode, VoiceReplyResult, voiceReply, voiceStart } from "../api";
import { RECORD_LIMIT_SECONDS, Recording, startRecording, toWav16kMono } from "../audio";
import { BloodBank, errText } from "../types";

type LangKey = "en" | "hi" | "hinglish" | "kn";

const LANGS: { key: LangKey; label: string; code: LanguageCode }[] = [
  { key: "en", label: "English", code: "en-IN" },
  { key: "hi", label: "Hindi", code: "hi-IN" },
  { key: "hinglish", label: "Hinglish (Hindi + English mix)", code: "en-IN" },
  { key: "kn", label: "Kannada", code: "kn-IN" },
];

const OUTCOME_LABEL: Record<string, string> = {
  proposal_created: "A hold proposal was created for a person to review",
  hold_confirmed: "The bank confirmed the hold",
  hold_cancelled: "The bank withdrew, so the hold was cancelled",
  declined: "The bank cannot supply this",
  refused_off_topic: "Off-topic reply: nothing was actioned",
  no_speech: "We could not hear any speech",
};

function yesNo(v: boolean | null): string {
  return v == null ? "Not said" : v ? "Yes" : "No";
}

interface Props {
  requestId: string;
  hospitalName: string;
  bloodGroup: string;
  banks: BloodBank[];
  onResult: () => void;
}

export default function VoicePanel({ requestId, hospitalName, bloodGroup, banks, onResult }: Props) {
  const [bankId, setBankId] = useState("");
  const [lang, setLang] = useState<LangKey>("en");
  const [consent, setConsent] = useState(false);
  const [starting, setStarting] = useState(false);
  const [voiceCallId, setVoiceCallId] = useState<string | null>(null);
  const [recording, setRecording] = useState<Recording | null>(null);
  const [elapsed, setElapsed] = useState(0);
  const [processing, setProcessing] = useState<string | null>(null);
  const [result, setResult] = useState<VoiceReplyResult | null>(null);
  const [error, setError] = useState<string | null>(null);
  const [note, setNote] = useState<string | null>(null);
  const [speaking, setSpeaking] = useState(false);

  const recRef = useRef<Recording | null>(null);
  const fileRef = useRef<HTMLInputElement>(null);
  const aliveRef = useRef(true);

  const langDef = LANGS.find((l) => l.key === lang) ?? LANGS[0];
  const canSpeak = typeof window !== "undefined" && "speechSynthesis" in window;

  const script =
    `This is RaktSetu, an AI assistant, calling on behalf of ${hospitalName}. ` +
    "This session is recorded and transcribed by an automated speech-to-text system. " +
    "All data in this demo is synthetic. " +
    `Please tell us how many units of ${bloodGroup} you can supply, whether you can hold them, and your collection hours. ` +
    "Do not share any patient names or phone numbers.";

  // Keep a valid bank selected.
  useEffect(() => {
    if (banks.length === 0) {
      if (bankId) setBankId("");
    } else if (!banks.some((b) => b.id === bankId)) {
      setBankId(banks[0].id);
    }
  }, [banks, bankId]);

  // Any change of request, bank or language needs fresh consent.
  useEffect(() => {
    setConsent(false);
    setVoiceCallId(null);
  }, [requestId, bankId, lang]);

  useEffect(() => {
    setResult(null);
    setError(null);
    setNote(null);
  }, [requestId]);

  useEffect(() => {
    aliveRef.current = true;
    return () => {
      aliveRef.current = false;
      recRef.current?.stop();
      if ("speechSynthesis" in window) window.speechSynthesis.cancel();
    };
  }, []);

  useEffect(() => {
    if (!recording) return;
    const started = Date.now();
    setElapsed(0);
    const t = window.setInterval(() => setElapsed(Math.floor((Date.now() - started) / 1000)), 250);
    return () => window.clearInterval(t);
  }, [recording]);

  function readAloud() {
    if (!canSpeak) return;
    window.speechSynthesis.cancel();
    const u = new SpeechSynthesisUtterance(script);
    u.lang = "en-IN";
    u.rate = 0.95;
    u.onend = () => setSpeaking(false);
    u.onerror = () => setSpeaking(false);
    setSpeaking(true);
    window.speechSynthesis.speak(u);
  }

  function stopReading() {
    if (canSpeak) window.speechSynthesis.cancel();
    setSpeaking(false);
  }

  async function onConsent(e: ChangeEvent<HTMLInputElement>) {
    const ticked = e.target.checked;
    setError(null);
    setNote(null);
    if (!ticked) {
      setConsent(false);
      setVoiceCallId(null);
      return;
    }
    if (!bankId) return;
    setConsent(true);
    setStarting(true);
    try {
      const res = await voiceStart({
        request_id: requestId,
        bank_id: bankId,
        blood_group: bloodGroup,
        language_code: langDef.code,
      });
      if (!aliveRef.current) return;
      setVoiceCallId(res.voice_call_id);
    } catch (err) {
      if (!aliveRef.current) return;
      setConsent(false);
      setVoiceCallId(null);
      setError(errText(err));
    } finally {
      if (aliveRef.current) setStarting(false);
    }
  }

  async function sendAudio(raw: Blob) {
    if (!voiceCallId) return;
    setError(null);
    setNote(null);
    setResult(null);
    try {
      setProcessing("Preparing the audio…");
      const { wav, truncated } = await toWav16kMono(raw);
      if (truncated) setNote("That clip was longer than 30 seconds, so only the first 30 seconds were sent.");
      setProcessing("Transcribing… this can take a few seconds.");
      const res = await voiceReply(voiceCallId, wav);
      if (!aliveRef.current) return;
      setResult(res);
      if (res.outcome !== "no_speech") {
        // One consented session per reply: ask again before recording more.
        setConsent(false);
        setVoiceCallId(null);
      }
      onResult();
    } catch (err) {
      if (aliveRef.current) setError(errText(err));
    } finally {
      if (aliveRef.current) setProcessing(null);
    }
  }

  async function record() {
    if (!consent || !voiceCallId) return;
    setError(null);
    stopReading();
    try {
      const rec = await startRecording(RECORD_LIMIT_SECONDS);
      recRef.current = rec;
      setRecording(rec);
      rec.done
        .then((blob) => {
          recRef.current = null;
          if (!aliveRef.current) return;
          setRecording(null);
          void sendAudio(blob);
        })
        .catch((err: unknown) => {
          recRef.current = null;
          if (!aliveRef.current) return;
          setRecording(null);
          setError(errText(err));
        });
    } catch (err) {
      setError(errText(err));
    }
  }

  function onFile(e: ChangeEvent<HTMLInputElement>) {
    const f = e.target.files?.[0];
    e.target.value = "";
    if (!f || !consent || !voiceCallId) return;
    void sendAudio(f);
  }

  const ready = consent && Boolean(voiceCallId) && !starting;
  const locked = Boolean(recording) || Boolean(processing) || starting;

  if (banks.length === 0) {
    return (
      <p className="muted">
        A voice check becomes available once a demo blood bank appears in this request's call log, proposals or holds.
      </p>
    );
  }

  return (
    <div>
      <p>Ask a blood bank to confirm in their own words. Their reply is transcribed and checked before anything changes.</p>
      <div className="form-grid cols-2">
        <div className="field">
          <label htmlFor="vp-bank">Blood bank</label>
          <select id="vp-bank" value={bankId} disabled={locked} onChange={(e) => setBankId(e.target.value)}>
            {banks.map((b) => (
              <option key={b.id} value={b.id}>
                {b.name}
              </option>
            ))}
          </select>
        </div>
        <div className="field">
          <label htmlFor="vp-lang">Language of the reply</label>
          <select id="vp-lang" value={lang} disabled={locked} onChange={(e) => setLang(e.target.value as LangKey)}>
            {LANGS.map((l) => (
              <option key={l.key} value={l.key}>
                {l.label}
              </option>
            ))}
          </select>
          {lang === "hinglish" && (
            <span className="muted small">Hinglish is transcribed with the Indian English model (en-IN).</span>
          )}
        </div>
      </div>

      <h3 style={{ marginTop: 14 }}>Say this to the person at the blood bank first</h3>
      <div className="script-box" lang="en-IN">
        {script}
      </div>
      <div className="btn-row">
        {speaking ? (
          <button type="button" className="btn btn-ghost" onClick={stopReading}>
            Stop reading
          </button>
        ) : (
          <button type="button" className="btn btn-secondary" onClick={readAloud} disabled={!canSpeak}>
            Read aloud
          </button>
        )}
        <span className="muted small">
          {canSpeak
            ? "Read by your browser's built-in voice (not Gnani)."
            : "Your browser has no built-in voice, so please read the script out yourself."}
        </span>
      </div>

      <label className="check" style={{ marginTop: 12 }}>
        <input type="checkbox" checked={consent} disabled={locked || !bankId} onChange={(e) => void onConsent(e)} />
        <span>The person speaking has heard this and agrees to be recorded and transcribed.</span>
      </label>
      {starting && (
        <p className="muted" role="status">
          Recording consent…
        </p>
      )}

      <div className="btn-row" style={{ marginTop: 12 }}>
        {recording ? (
          <>
            <button type="button" className="btn btn-primary" onClick={() => recording.stop()}>
              Stop and send
            </button>
            <span className="rec-timer" role="timer" aria-live="off">
              ● Recording {elapsed}s / {RECORD_LIMIT_SECONDS}s
            </span>
          </>
        ) : (
          <>
            <button
              type="button"
              className="btn btn-primary"
              disabled={!ready || Boolean(processing)}
              onClick={() => void record()}
            >
              Record reply
            </button>
            <button
              type="button"
              className="btn btn-secondary"
              disabled={!ready || Boolean(processing)}
              onClick={() => fileRef.current?.click()}
            >
              Upload a clip
            </button>
            <input
              ref={fileRef}
              type="file"
              className="sr-only"
              tabIndex={-1}
              aria-hidden="true"
              accept=".wav,.mp3,.m4a,.ogg,.flac,.webm"
              disabled={!ready || Boolean(processing)}
              onChange={onFile}
            />
          </>
        )}
      </div>
      {!ready && !starting && (
        <p className="muted small" style={{ marginTop: 6 }}>
          Record and Upload unlock once the consent box is ticked. Recording stops by itself at {RECORD_LIMIT_SECONDS}{" "}
          seconds.
        </p>
      )}

      {processing && (
        <div className="notice notice-info" role="status">
          <span className="spinner dark" aria-hidden="true" /> {processing}
        </div>
      )}
      {note && <div className="notice notice-warn">{note}</div>}
      {error && (
        <div className="notice notice-error" role="alert">
          {error}
        </div>
      )}

      {result && (
        <div className="item" style={{ marginTop: 12 }} aria-live="polite">
          <div className="item-top">
            <span className="item-title">What we heard</span>
            <span className="muted small">Transcribed by Gnani Prisma ({result.model})</span>
          </div>
          <div className="transcript">{result.transcript || "(no speech detected)"}</div>
          <div className="kv">
            <div>
              <b>Units available</b>
              {result.extraction.units_available ?? "Not said"}
            </div>
            <div>
              <b>Will hold</b>
              {yesNo(result.extraction.will_hold)}
            </div>
            <div>
              <b>Collection hours</b>
              {result.extraction.collection_hours ?? "Not said"}
            </div>
          </div>
          <div className="btn-row">
            {result.extraction.off_topic && <span className="chip chip-bad">Off-topic: refused</span>}
            {result.extraction.pii_redacted && <span className="chip chip-warn">Personal details redacted</span>}
            {result.extraction.needs_review && <span className="chip chip-warn">Needs a person to review</span>}
            <span className="chip">{OUTCOME_LABEL[result.outcome] ?? result.outcome}</span>
          </div>
          {result.message && <p style={{ marginTop: 10 }}>{result.message}</p>}
          {result.outcome !== "no_speech" && (
            <p className="muted small">To record another reply, tick the consent box again.</p>
          )}
        </div>
      )}
    </div>
  );
}
