# RaktSetu — blood dispatch agent

An agentic dispatch coordinator for emergency blood requests in Bengaluru.
A hospital enters a blood group and unit count; the agent searches nearby
blood banks, places simultaneous calls to verify availability, and reserves
units for 30 minutes.

## What it does

- Blood group compatibility is enforced in code, not by the model. An AB-
  patient can be matched to A-, B- or O- units; an O- patient can only ever
  receive O-. Results are labelled exact or compatible.
- Ranks banks by distance, listing freshness and match quality.
- Simulated calls fail realistically: closed, no answer, reserved for
  surgery, or stale listing. The staler the record, the likelier the call
  finds nothing.
- Holds decrement stock and return it automatically on expiry.
- Splits a request across multiple banks when no single bank can fill it.

## Architecture

- Supabase Postgres: blood_banks, stock, requests, call_log, holds
- Supabase Edge Function (Deno/TypeScript) running a Gemini tool-calling loop
  on gemini-3.5-flash-lite
- Four tools: search_stock, call_banks, rank_banks, place_hold
- React frontend with a Leaflet map, subscribed to call_log via Supabase
  realtime

The model orchestrates. It does not decide compatibility, distance or
eligibility. Those are deterministic functions tested against an
independently written expected table.

## Data

55 blood banks: 40 across Bengaluru, 15 in surrounding districts including
Kolar, Tumakuru, Ramanagara and Chikkaballapur. Rh-negative stock is
deliberately scarce, matching the roughly 6 percent Rh-negative rate in the
Indian population.

## What is simulated

Inventory and phone calls are both simulated. Real blood bank inventory is
not available as an API, and automated outbound calls to hospitals would be
blocked under TRAI rules and ignored by reception staff who do not hold live
stock numbers.

The demo runs in replay mode against a recorded dispatch, so it consumes no
API quota.

## What this does not solve

- e-RaktKosh already exists. India's national portal lists blood bank stock
  and is mandated by MoHFW. The unsolved problem is not discovery, it is that
  listed inventory is stale. This project simulates that staleness but does
  not fix it.
- Blood is not released on availability. It requires a doctor's requisition,
  the patient's own blood sample for crossmatch (about 45 minutes at the
  issuing bank), and in most Indian banks a replacement donor.
- Cold chain. Units move at 2 to 6 degrees Celsius in validated transport
  boxes, not with a relative on a scooter.
- Patients do not travel. In real emergencies the blood moves, or the hospital
  transfuses O- immediately. This flow assumes an attendant can collect.
- No reservation authority. A real hold requires the bank's agreement. Here it
  is a database write.
- Search radius is capped at 80km. Inter-bank transfer over that distance is
  real for rare groups, but it is a two-hour round trip in Bengaluru traffic.
- Every entry is modelled as a licensed blood bank. In reality most hospitals
  hold no stock and source from a smaller number of licensed banks.

## Donor mobilisation

Alerts fire on a blood centre's own stock falling below a per-group floor,
never on a patient's case. That choice is deliberate. India's National Blood
Policy commits to phasing out replacement donation in favour of 100%
voluntary non-remunerated donation, and a patient-linked broadcast is the
route by which paid donors — banned by the 1996 Supreme Court judgment —
re-enter the system. `donor_alerts` has no request or patient column, so the
link cannot be made later by accident.

Eligibility is a Postgres function: exact group match, 90 days since last
donation, within radius, active, and not alerted in the past 30 days. The
rate limit lives inside the eligibility query rather than at the call site,
so it cannot be skipped. Donors give whole blood of their own group, so the
compatibility matrix is not applied here — it governs bank stock, not donors.

The register is not readable with the anon key. That key ships in the
frontend bundle, so the RLS policy allows self-registration and nothing else;
reads happen through the service role in an edge function.

Floors are set per group, higher for rarer ones. Those numbers are judgement,
not evidence.

Not yet built: any delivery channel. `donor_alerts` records who would be
contacted. Nothing is sent.
## Running it

1. Run schema.sql, then seed.sql, in the Supabase SQL editor
2. Deploy dispatch.ts as a Supabase Edge Function
3. Set GEMINI_API_KEY in Edge Function secrets
4. Point the frontend at your Supabase URL and anon key

Test in stages:

- {"action":"test_compat"} — compatibility table, no database, no model
- {"action":"test_search","blood_group":"AB+"} — tools only
- {"action":"test_calls","blood_group":"A+","units":4} — simulated calls
- {"action":"dispatch", ...} — full agent
