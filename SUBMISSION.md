# Submission: RaktSetu

Gnani.ai Great Indian AI Internship Challenge 2026

- **Demo:** https://raktsetu-gnani.vercel.app
- **Repository:** https://github.com/anshullmishra-png/raktsetu-gnani
- **Team:** Anshull Mishra and Agnesh M P

## Project title

RaktSetu — a voice assistant that verifies blood bank stock before anyone travels

## One-line summary

The portal says a bank has 4 units of O−; the listing is 31 hours old and the
shelf is empty. RaktSetu checks every nearby listing at once, hears the bank's
answer by voice, and lines up a hold for a person at the hospital to approve.

## The problem

India already has a national portal that lists blood bank stock, so finding a
bank is not the hard part. The hard part is that a listing can be a day old,
and the only way to know is to phone banks one at a time while someone waits.
For Rh-negative groups, which roughly 6 percent of people in India have, most
banks hold nothing, and an O-negative patient can receive only O-negative.
Each wrong listing costs a call at best and a wasted trip at worst.

## The solution

1. **Ask.** A hospital enters a blood group, a unit count and its name. No
   patient details are collected.
2. **Search.** Compatible stock within 80 km, exact matches first. Blood group
   compatibility is enforced in code, never decided by a model.
3. **Verify.** Nearby banks are checked together on a live map. Banks being
   called light up, banks with blood turn green, banks without it drop off,
   and a route is drawn to the banks that will fill the request.
4. **Speak and listen.** Gnani Timbre speaks an AI disclosure. After the
   speaker consents, their reply is transcribed by Gnani Prisma and turned
   into units, hold and collection hours.
5. **A person approves.** The assistant only proposes. Approval places a
   30-minute hold. If the bank says it cannot supply, the hold is cancelled
   and the units are returned.

## Target users

- Hospital blood-requisition staff and duty doctors in Bengaluru and the
  surrounding districts (Kolar, Tumakuru, Ramanagara, Chikkaballapur).
- Blood bank staff, who answer by voice.
- Voluntary donors, who see which blood banks are short of which group.

## Gnani models used

| Model | Role in RaktSetu |
|---|---|
| **Gnani Prisma v2.5** (`prisma-v2.5`, speech-to-text) | Transcribes the blood bank's spoken reply in each voice session. Language codes used: `en-IN`, `hi-IN`, `kn-IN`. Hinglish is sent as `en-IN`. |
| **Gnani Timbre v2.5** (`timbre-v2.5`, text-to-speech, voice "Kaveri") | Speaks the AI disclosure at the start of each voice session and speaks RaktSetu's reply after the bank answers. English only. |

Both are called server-side through the Gnani Voice API, so the key never
reaches the browser. Gemini (`gemini-3.1-flash-lite`) runs the dispatch tool
loop and extracts fields from the Prisma transcript; it is not a Gnani model.

## Guardrails

Each is enforced in code or in the database, not only in a prompt, and each
has an automated test.

1. Demo banks and obviously fictional numbers only; nothing is dialled.
2. AI disclosure and recorded consent before any audio is accepted.
3. No patient data: requests have no patient or free-text field, and names
   and numbers heard in audio are redacted before storage.
4. Human approval before any hold; the model has no tool that places one.
5. An admin kill switch that makes every acting function refuse.
6. Injected or off-topic audio is refused and changes nothing.
7. An append-only audit log of every step.

## What is real and what is simulated

**Real:** Gnani Prisma transcription, Gnani Timbre speech, the Gemini dispatch
agent, the database rules, the deployed site.

**Simulated:** blood bank inventory (all 55 banks are fictional), the agent's
own calls to banks, and the hold itself (no real bank has agreed to anything).
No phone call is placed; the voice session happens in the browser. All data
is synthetic.

## Test results (run on the live site, 10 Nov 2026)

| Suite | Result |
|---|---|
| Compatibility and guardrail logic, offline | 16 of 16 |
| Guardrails against the deployed site and database | 19 of 19 |
| End-to-end run with real Gemini, Prisma and Timbre | passed |
| Voice round trip: Timbre's audio transcribed back by Prisma | passed |
| Prisma on five machine-voice English clips | 5 of 5 (4 of 5 before a redaction fix) |

**Not yet measured:** accuracy on human speech, on Hindi, Kannada or Hinglish,
or in noisy rooms. The recording sentences for that are in `eval/sentences.md`.

## Who did what

- **Agnesh M P** started RaktSetu and wrote the original repository
  ([`agneshmp07/raktsetu`](https://github.com/agneshmp07/raktsetu), kept in
  this repo's history): the dispatch agent and its tool loop, the blood group
  compatibility table, the hold lifecycle, the donor eligibility rules, and
  the reasoning on why donor alerts must never be tied to a patient.
- **Anshull Mishra** led the rebuild for this challenge: replacing the earlier
  voice provider with Gnani Prisma and Timbre, the database and its
  guardrails, the test suites, deployment, and this repository.
- **Together** on the day: product direction, the visual design brief, the
  animated dispatch map, the home page narrative, and reviewing the result.

The rebuild was written with an AI coding assistant (Claude Code) working
under our direction; the commits are marked as co-authored accordingly.

## What we would do next

- Record and publish accuracy for Hindi, Kannada, Hinglish and noisy audio.
- Real calls, limited to blood banks that have agreed to take them.
- Stock data from the banks themselves, since stale listings are the root
  cause; every verified call is a fresh data point.
- Sign-in and roles, which any real deployment needs.
