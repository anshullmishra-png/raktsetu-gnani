# Gnani Prisma speech-to-text: notes from the official docs

Source: https://docs.gnani.ai (pages under `/api/STT/`), read on 10 Nov 2026.
Everything below is what the docs say; the "Real test call" section at the end
is filled in from an actual request.

## Endpoint and auth

- `POST https://api.vachana.ai/stt/v3` — the `3` is the URL version, not the model version.
- `Content-Type: multipart/form-data` (file upload). Realtime streaming exists
  separately at `WS /stt/v3/stream`, and a Batch Jobs API for long files. RaktSetu
  uses REST only.
- Auth: header `X-API-Key-ID: <key>`. Optional `X-API-Request-ID` is echoed back as `request_id`.

## Request fields used by RaktSetu

| Field | Value we send | Notes from docs |
|---|---|---|
| `audio_file` | 16 kHz mono WAV | Accepted: WAV, MP3, OGG, FLAC, AAC, M4A; format detected from file extension |
| `language_code` | `en-IN`, `hi-IN` or `kn-IN` | Required. Prisma v2.5 takes exactly one language per request, no auto-detect |
| `model` | `prisma-v2.5` | Omitting it also selects v2.5 (the default) |
| `format` | `transcribe` | Enables inverse text normalisation, so spoken numbers come back as digits |

Not used: `bias_list` / `bias_score` (v2.5 word boosting), `enable_substitution`.

## Limits

- REST: max **30 seconds** of audio per request; minimum 0.1 s (shorter returns an empty transcript).
- Sample rate 8 to 44.1 kHz (quick-start page).
- Rate limits are not published in the docs (shown in the dashboard); over-limit returns `429 RATE_LIMITED`.
- Because browsers record WebM/Opus, which is not an accepted format, the
  frontend converts every clip to 16 kHz mono WAV before upload.

## Languages

Both Prisma models support: `bn-IN`, `en-IN`, `gu-IN`, `hi-IN`, `kn-IN`, `ml-IN`,
`mr-IN`, `pa-IN`, `ta-IN`, `te-IN`.

- English, Hindi and Kannada are all supported.
- **Code-mixed speech on v2.5:** the only support is `en-IN`, which "accepts
  English-Hindi mixed audio and generates output in English (Latin script)".
  So Hinglish clips are sent as `en-IN`. There is no Kannada-English mixing
  setting on v2.5.
- The `codemix` output format and `indic-auto` detection are Prisma v3.0 only.

## Model named in the submission

**Gnani Prisma v2.5** (`prisma-v2.5`), the default STT model and the one listed on
the challenge page. The docs also list Prisma v3.0 (`prisma-v3.0`); RaktSetu does
not use it. The model is set by the optional `GNANI_MODEL` server environment variable.

## Response shape (from docs)

`success`, `request_id`, `transcript`, `model`; v2.5 responses also include
`output.literal` (the transcript before ITN). `truncated: true` appears only when
the transcript was cut short.

## Real test call

Made on 10 Nov 2026 with `eval/clips-tts/01-en-four.wav` (a Windows
text-to-speech clip, 16 kHz mono WAV), `language_code=en-IN`,
`model=prisma-v2.5`, `format=transcribe`. Raw response:

```json
{
  "success": true,
  "request_id": "01a1c5ed-f9bd-799f-aee7-6c3ca4b4b014",
  "transcript": "yes we have four units of o negative we can hold them for 30 minutes collect before 8 pm",
  "model": "prisma-v2.5",
  "processing_time": 0.19103741645812988,
  "end_to_end_latency": 0.30155467987060547,
  "output": {
    "literal": "yes we have four units of o negative we can hold them for thirty minutes collect before eight pm"
  }
}
```

What this showed that the docs did not spell out:

- Output is lowercase with no punctuation, so capital letters cannot be used
  to spot names.
- With `format=transcribe`, "thirty minutes" and "eight PM" became digits but
  "four units" stayed a word. The unit parser therefore needs number words as
  well as digits, even with ITN on.
- "first come, first served" came back as "1st come 1st served".
