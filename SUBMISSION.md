# Submission: RaktSetu

Gnani.ai Great Indian AI Internship Challenge 2026

## Project title

RaktSetu — a blood dispatch assistant that checks stale blood bank listings by voice before anyone travels

## The problem

When a hospital needs blood, staff look up which banks list stock and start
phoning. The listings are often out of date: a portal can show 4 units of O-
at a bank that ran out the day before. Each wrong listing costs a phone call
at best and a wasted trip at worst, and for Rh-negative groups there may be
only a handful of banks worth calling.

RaktSetu is a working demo of the checking step. It searches nearby banks
with blood group compatibility enforced in code, verifies listings, takes a
bank's spoken reply in English, Hindi or Kannada and turns it into units,
hold and collection hours, and proposes a 30-minute hold that a person at the
hospital approves. If a bank says it cannot supply, the hold is cancelled and
the units are returned.

## Target users

- Hospital blood-requisition staff and duty doctors in Bengaluru and the
  surrounding districts (Kolar, Tumakuru, Ramanagara, Chikkaballapur).
- Blood bank staff, who answer in their own language.
- Voluntary donors, who see which blood banks are short of which group.

## Models used

| Model | Role |
|---|---|
| **Gnani Prisma v2.5** (`prisma-v2.5`, speech-to-text) | Transcribes the blood bank's spoken reply. Called server-side through the REST API at `api.vachana.ai/stt/v3` with language codes `en-IN`, `hi-IN` and `kn-IN`. This is the only Gnani model used. |
| Gemini (`gemini-3.1-flash-lite`) | Runs the dispatch tool loop and extracts structured fields from the Prisma transcript. Not a Gnani model. |

## Guardrails

Demo-only phone numbers and banks, AI disclosure and recorded consent before
any audio, no patient data anywhere, human approval before every hold, an
admin kill switch, refusal of injected or off-topic audio, and an append-only
audit log. Each is enforced in code or in the database and has an automated
test. Details and test results are in the README.

## What is real and what is not

Real: Gnani Prisma transcription, the Gemini agent, the database rules, the
deployed site. Simulated: blood bank inventory, the agent's own bank calls,
and the hold itself. All data is synthetic. No real call is placed.

Measured so far: the pipeline passed 5 of 5 machine-generated English clips
(4 of 5 before a redaction fix). Human recordings in English, Hindi, Kannada
and Hinglish have **not** been evaluated yet.

## Who did what

> Anshull: please edit this section before submitting. It is written from the
> git history only; I do not know how you two split the work beyond that.

- **Agnesh M P** started the project and wrote the original repository
  ([`agneshmp07/raktsetu`](https://github.com/agneshmp07/raktsetu)): the
  dispatch agent and its tool loop, the blood group compatibility table, the
  hold lifecycle design, the donor eligibility rules and the reasoning about
  replacement donation.
- **Anshull Mishra** rebuilt it for this challenge: Gnani Prisma voice
  pipeline in place of Bolna, the database schema and seed, the guardrails
  and their tests, the frontend, deployment and the eval harness.

## Links

- Demo: https://raktsetu-gnani.vercel.app
- Repository: https://github.com/GITHUB_USERNAME/raktsetu-gnani
- Admin page: `/admin`, behind a passcode shared separately with the judges
