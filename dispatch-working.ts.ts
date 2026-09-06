// RaktSetu — dispatch agent edge function  (v2)
//
// CHANGES FROM v1:
//   + blood group compatibility matrix (an A+ patient can now receive O+/O-/A-)
//   + expired holds return units to stock (v1 leaked stock permanently)
//   + call/hold/rank all track WHICH group was matched, not just the patient's
//   + .single() -> .maybeSingle() everywhere (v1 threw on missing rows)
//   + stale-listing simulation actually fires now
//
// Deploy: Supabase Dashboard -> Edge Functions -> dispatch -> paste -> Deploy
//
// Test with the "action" field in the POST body:
//   {"action":"test_search","blood_group":"AB+"}  -> tools only, no AI
//   {"action":"test_calls","blood_group":"O-"}    -> simulated calls
//   {"action":"dispatch", ...}                    -> full agent loop
//
// Required secret: GEMINI_API_KEY

import { createClient } from "https://esm.sh/@supabase/supabase-js@2";

const sb = createClient(
  Deno.env.get("SUPABASE_URL")!,
  Deno.env.get("SUPABASE_SERVICE_ROLE_KEY")!,
);

const GEMINI_KEY = Deno.env.get("GEMINI_API_KEY")!;
 const MODEL = "gemini-3.1-flash-lite";

const cors = {
  "Access-Control-Allow-Origin": "*",
  "Access-Control-Allow-Headers": "authorization, x-client-info, apikey, content-type",
  "Content-Type": "application/json",
};

// ────────────────────────────────────────────────────────────
// RED BLOOD CELL COMPATIBILITY
// Who can this patient receive FROM. Verified against standard
// transfusion tables. NOT valid for plasma (plasma rules invert).
// ────────────────────────────────────────────────────────────

const COMPAT: Record<string, string[]> = {
  "O-":  ["O-"],
  "O+":  ["O-", "O+"],
  "A-":  ["O-", "A-"],
  "A+":  ["O-", "O+", "A-", "A+"],
  "B-":  ["O-", "B-"],
  "B+":  ["O-", "O+", "B-", "B+"],
  "AB-": ["O-", "A-", "B-", "AB-"],
  "AB+": ["O-", "O+", "A-", "A+", "B-", "B+", "AB-", "AB+"],
};

// ────────────────────────────────────────────────────────────
// helpers
// ────────────────────────────────────────────────────────────

const BOLNA_KEY = Deno.env.get("BOLNA_API_KEY");
const BOLNA_AGENT = Deno.env.get("BOLNA_AGENT_ID");

// Places ONE real voice call via Bolna.
// Dials demo_phone only — never `phone`, which holds real hospital numbers.
// Returns null if it cannot or should not call.
async function placeRealCall(
  bankId: string,
  group: string,
  units: number,
  hospital: string,
  requestId: string | null,
) {
  if (!BOLNA_KEY || !BOLNA_AGENT) return null;

  const { data: bank } = await sb
    .from("blood_banks")
    .select("name, demo_phone")
    .eq("id", bankId)
    .maybeSingle();

  // HARD GUARD: no demo_phone means no real call, ever.
  if (!bank?.demo_phone) return null;

  try {
    const res = await fetch("https://api.bolna.ai/call", {
      method: "POST",
      headers: {
        "Authorization": `Bearer ${BOLNA_KEY}`,
        "Content-Type": "application/json",
      },
      body: JSON.stringify({
        agent_id: BOLNA_AGENT,
        recipient_phone_number: bank.demo_phone,
                        user_data: {
          bank_name: bank.name,
          blood_group: group,
          units: String(units),
          hospital: hospital,
        },
      }),
    });

    const out = await res.json();

    if (!res.ok) {
      await log(requestId, bankId, "system",
        `Voice call failed: ${JSON.stringify(out).slice(0, 200)}`);
      return null;
    }

       await log(requestId, bankId, "calling",
      `LIVE VOICE CALL to ${bank.name} — execution ${out.execution_id}`);

       await sb.from("voice_calls").insert({
      execution_id: out.execution_id,
      request_id: requestId,
      bank_id: bankId,
      blood_group: group,
      status: "queued",
    });



    return out.execution_id;
  } catch (e) {
    await log(requestId, bankId, "system", `Voice call error: ${String(e)}`);
    return null;
  }
}
const sleep = (ms: number) => new Promise((r) => setTimeout(r, ms));

const key = (bankId: string, group: string) => `${bankId}:${group}`;

function haversine(lat1: number, lng1: number, lat2: number, lng2: number) {
  const R = 6371;
  const dLat = (lat2 - lat1) * Math.PI / 180;
  const dLng = (lng2 - lng1) * Math.PI / 180;
  const a = Math.sin(dLat / 2) ** 2 +
    Math.cos(lat1 * Math.PI / 180) * Math.cos(lat2 * Math.PI / 180) *
      Math.sin(dLng / 2) ** 2;
  return +(R * 2 * Math.atan2(Math.sqrt(a), Math.sqrt(1 - a))).toFixed(2);
}

async function log(
  requestId: string | null,
  bankId: string | null,
  event: string,
  message: string,
  units = 0,
) {
  if (!requestId) return;
  await sb.from("call_log").insert({
    request_id: requestId,
    bank_id: bankId,
    event,
    message,
    units_offered: units,
  });
}

function isOpenNow(hours: string) {
  if (!hours || hours.trim() === "" || /24\s*hour/i.test(hours)) return true;
  // accepts "8:00 AM - 8:00 PM" and "08:00 AM - 08:00 PM"
  const m = hours.match(/(\d{1,2}):(\d{2})\s*(AM|PM)\s*-\s*(\d{1,2}):(\d{2})\s*(AM|PM)/i);
  if (!m) return true; // unparseable -> assume open, don't silently kill a bank

  const to24 = (h: string, ap: string) => {
    let n = parseInt(h, 10);
    const up = ap.toUpperCase();
    if (up === "PM" && n !== 12) n += 12;
    if (up === "AM" && n === 12) n = 0;
    return n;
  };

  const open = to24(m[1], m[3]);
  const close = to24(m[4], m[6]);
  const now = new Date(Date.now() + 5.5 * 3600 * 1000).getUTCHours(); // IST

  // overnight window, e.g. 8 PM - 8 AM
  if (close <= open) return now >= open || now < close;
  return now >= open && now < close;
}

// ────────────────────────────────────────────────────────────
// expired holds -> put the units back
// v1 never did this, so every demo run drained the database
// ────────────────────────────────────────────────────────────

async function releaseExpiredHolds() {
  const { data: expired } = await sb
    .from("holds")
    .select("id, bank_id, units, blood_group")
    .lt("expires_at", new Date().toISOString())
        .eq("status", "active");

  for (const h of expired ?? []) {
    if (!h.blood_group) continue;
    const { data: st } = await sb
      .from("stock").select("units")
      .eq("bank_id", h.bank_id).eq("blood_group", h.blood_group).maybeSingle();

    await sb.from("stock")
      .update({ units: (st?.units ?? 0) + h.units })
      .eq("bank_id", h.bank_id).eq("blood_group", h.blood_group);

        await sb.from("holds")
      .update({ status: "expired", released: true }).eq("id", h.id);
  }
  return (expired ?? []).length;
}

// ────────────────────────────────────────────────────────────
// TOOL 1 — search_stock  (now compatibility-aware)
// ────────────────────────────────────────────────────────────

async function searchStock(
  patientGroup: string,
  minUnits: number,
  radiusKm: number,
  origin: { lat: number; lng: number },
  requestId: string | null,
  alreadyCalled: Set<string>,
) {
  const groups = COMPAT[patientGroup];
  if (!groups) throw new Error(`search_stock: unknown blood group "${patientGroup}"`);

  const { data, error } = await sb
    .from("stock")
    .select("units, last_updated, blood_group, blood_banks(id, name, lat, lng, phone, pickup_hours)")
    .in("blood_group", groups)
        .gte("units", 1);

  if (error) throw new Error("search_stock: " + error.message);

  const candidates = (data ?? [])
    .map((row: any) => {
      const b = row.blood_banks;
      return {
        bank_id: b.id,
        name: b.name,
        phone: b.phone,
        blood_group: row.blood_group,
        match_type: row.blood_group === patientGroup ? "exact" : "compatible",
        pickup_hours: b.pickup_hours,
        units_listed: row.units,
        hours_stale: +((Date.now() - new Date(row.last_updated).getTime()) / 3_600_000).toFixed(1),
        distance_km: haversine(origin.lat, origin.lng, b.lat, b.lng),
      };
    })
    .filter((c) => c.distance_km <= radiusKm && !alreadyCalled.has(key(c.bank_id, c.blood_group)))
    // exact matches first, then by distance
    .sort((a, b) =>
      a.match_type === b.match_type
        ? a.distance_km - b.distance_km
        : a.match_type === "exact" ? -1 : 1
    );

    const exact = candidates.filter((c) => c.match_type === "exact").length;

  await log(
    requestId, null, "system",
    `Searched ${radiusKm}km for ${patientGroup} (compatible: ${groups.join(", ")}) — ` +
    `${candidates.length} candidates, ${exact} exact`,
  );

  // Surface every candidate so the UI can list them, not just a count.
  if (requestId && candidates.length) {
    await sb.from("call_log").insert(
      candidates.slice(0, 20).map((c) => ({
        request_id: requestId,
        bank_id: c.bank_id,
        event: "found",
        units_offered: c.units_listed,
        message:
          `${c.name} — ${c.units_listed} units of ${c.blood_group} ` +
          `(${c.match_type}) · ${c.distance_km}km · ` +
          `${c.hours_stale}h stale · ${c.pickup_hours}`,
      })),
    );
  }

  return {
    patient_group: patientGroup,
    compatible_groups: groups,
    radius_km: radiusKm,
    count: candidates.length,
    candidates,
  };
}

// ────────────────────────────────────────────────────────────
// TOOL 2 — call_banks  (simulated, parallel, per bank+group)
// ────────────────────────────────────────────────────────────

async function callBanks(
  targets: { bank_id: string; blood_group: string }[],
  unitsWanted: number,
  requestId: string | null,
  alreadyCalled: Set<string>,
  hospitalName: string,
) {
    const list = (targets ?? []).slice(0, 10); // cap batch so we don't time out

  const results = await Promise.all(list.map(async (t) => {
    const id = t.bank_id;
    const group = t.blood_group;
    alreadyCalled.add(key(id, group));

    const { data: bank } = await sb
      .from("blood_banks").select("name, phone, pickup_hours").eq("id", id).maybeSingle();
    const name = bank?.name ?? "Unknown bank";

        // First target gets a real voice call; the rest are simulated.
    if (list.indexOf(t) === 0) {
            await placeRealCall(id, group, unitsWanted, hospitalName, requestId);
    }

    await log(requestId, id, "calling", `Calling ${name} — asking about ${group}…`);
    await sleep(1500 + Math.random() * 3000);

    if (!isOpenNow(bank?.pickup_hours ?? "")) {
      await log(requestId, id, "declined", `${name} — closed (${bank?.pickup_hours})`);
      return { bank_id: id, blood_group: group, name, status: "closed", units_offered: 0 };
    }

    const { data: st } = await sb
      .from("stock").select("units, last_updated")
      .eq("bank_id", id).eq("blood_group", group).maybeSingle();

    const actual = st?.units ?? 0;
    const staleH = st ? (Date.now() - new Date(st.last_updated).getTime()) / 3_600_000 : 99;

    const r = Math.random();
    if (r < 0.10) {
      await log(requestId, id, "no_answer", `${name} — no answer after 6 rings`);
      return { bank_id: id, blood_group: group, name, status: "no_answer", units_offered: 0 };
    }
    if (r < 0.20) {
      await log(requestId, id, "declined", `${name} — ${group} reserved for scheduled surgery`);
      return { bank_id: id, blood_group: group, name, status: "declined", units_offered: 0 };
    }

    // the older the listing, the likelier it's wrong (max 40% chance)
    const staleFail = Math.random() < Math.min(staleH / 48, 0.4);
    if (actual === 0 || staleFail) {
      await log(
        requestId, id, "declined",
        `${name} — ${group} exhausted, listing was ${staleH.toFixed(1)}h stale`,
      );
      return { bank_id: id, blood_group: group, name, status: "stale_record", units_offered: 0 };
    }

    const offered = Math.min(actual, unitsWanted);
    const status = offered < unitsWanted ? "partial" : "confirmed";
    await log(
      requestId, id, status === "partial" ? "partial" : "confirmed",
      `${name} — ${offered} units of ${group} ${status === "partial" ? `(of ${unitsWanted} asked)` : "confirmed"}`,
      offered,
    );
    return { bank_id: id, blood_group: group, name, status, units_offered: offered };
  }));

  const total = results.reduce((s, r) => s + r.units_offered, 0);
  return { results, total_units_available: total };
}

// ────────────────────────────────────────────────────────────
// TOOL 3 — rank_banks
// ────────────────────────────────────────────────────────────

async function rankBanks(
  targets: { bank_id: string; blood_group: string }[],
  origin: { lat: number; lng: number },
  patientGroup: string,
) {
  const ranked = [];

  for (const t of targets ?? []) {
    const { data: row } = await sb
      .from("stock")
      .select("units, last_updated, blood_banks(id, name, lat, lng, phone)")
      .eq("bank_id", t.bank_id).eq("blood_group", t.blood_group).maybeSingle();
    if (!row) continue;

    const b: any = (row as any).blood_banks;
    const dist = haversine(origin.lat, origin.lng, b.lat, b.lng);
    const staleH = (Date.now() - new Date(row.last_updated).getTime()) / 3_600_000;
    const exact = t.blood_group === patientGroup;

    ranked.push({
      bank_id: b.id,
      name: b.name,
      phone: b.phone,
      blood_group: t.blood_group,
      match_type: exact ? "exact" : "compatible",
      units_listed: row.units,
      distance_km: dist,
      hours_stale: +staleH.toFixed(1),
      // lower is better: distance + staleness penalty + small penalty for non-exact
      score: +(dist + (staleH / 24) * 2 + (exact ? 0 : 1.5)).toFixed(2),
    });
  }

  ranked.sort((a, b) => a.score - b.score);
  return { ranked };
}

// ────────────────────────────────────────────────────────────
// TOOL 4 — place_hold
// ────────────────────────────────────────────────────────────

async function placeHold(
  bankId: string,
  group: string,
  units: number,
  requestId: string | null,
) {

  const { data: bank } = await sb
    .from("blood_banks").select("name, phone").eq("id", bankId).maybeSingle();
    const { data: r, error: rpcErr } = await sb.rpc("place_hold_atomic", {
    p_request_id: requestId, p_bank_id: bankId,
    p_group: group, p_units: units, p_minutes: 30,
  });
  const res = r as any;

  if (rpcErr || !res?.ok) {
    await log(requestId, bankId, "declined",
      `${bank?.name} — hold failed, no ${group} left`);
    return { ok: false, reason: rpcErr?.message ?? `no ${group} units available` };
  }
  const grantable = res.units;
  const expires   = res.expires_at;

  await log(
    requestId, bankId, "confirmed",
    `${grantable} units of ${group} HELD at ${bank?.name} until ${expires.slice(11, 16)} UTC`,
    grantable,
  );

  return {
    ok: true,
    bank: bank?.name,
    phone: bank?.phone,
    blood_group: group,
    units: grantable,
    expires_at: expires,
  };
}

// ────────────────────────────────────────────────────────────
// Gemini tool declarations
// ────────────────────────────────────────────────────────────

const targetArray = {
  type: "array",
  items: {
    type: "object",
    properties: {
      bank_id: { type: "string" },
      blood_group: { type: "string" },
    },
    required: ["bank_id", "blood_group"],
  },
};

const tools = [{
  functionDeclarations: [
    {
      name: "search_stock",
      description:
        "Find blood banks holding the patient's group OR any compatible group, within a radius. " +
        "Pass the PATIENT's blood group — compatibility is handled internally. " +
        "Excludes bank+group pairs already called.",
      parameters: {
        type: "object",
        properties: {
          blood_group: { type: "string", description: "the patient's blood group" },
          min_units: { type: "integer" },
          radius_km: { type: "number" },
        },
        required: ["blood_group", "min_units", "radius_km"],
      },
    },
    {
      name: "call_banks",
      description:
        "Place simultaneous calls to verify availability. Pass ALL candidates at once as " +
        "{bank_id, blood_group} pairs, copying blood_group from the search result — " +
        "not the patient's group.",
      parameters: {
        type: "object",
        properties: {
          targets: targetArray,
          units: { type: "integer" },
        },
        required: ["targets", "units"],
      },
    },
    {
      name: "rank_banks",
      description: "Rank confirmed bank+group pairs by distance, freshness and match quality. Lower score is better.",
      parameters: {
        type: "object",
        properties: { targets: targetArray },
        required: ["targets"],
      },
    },
    {
      name: "place_hold",
      description:
        "Reserve units of a specific blood group at a bank for 30 minutes. " +
        "Call multiple times to split a request across banks.",
      parameters: {
        type: "object",
        properties: {
          bank_id: { type: "string" },
          blood_group: { type: "string", description: "the group actually being held, from the call result" },
          units: { type: "integer" },
        },
        required: ["bank_id", "blood_group", "units"],
      },
    },
  ],
}];

const SYSTEM = `You are a blood dispatch coordinator for a hospital in Bengaluru.

Blood group compatibility is handled by search_stock. Pass it the PATIENT's group.
It returns candidates tagged match_type "exact" or "compatible" — both are safe to
transfuse. Prefer exact when distance is similar.

Procedure — you have limited turns, be efficient:
1. search_stock ONCE with radius_km = 80 and min_units = 1. Results come back
   sorted exact-first then nearest, so do not search repeatedly at widening
   radii — one search covers the whole region.
2. call_banks on the nearest 10 candidates in ONE call. Copy each candidate's
   blood_group into the target.
3. If still short of the units needed, call_banks on the next 10. Never re-call
   the same bank+group.
4. rank_banks on everything that confirmed or partially confirmed.
5. place_hold on the best-ranked, splitting across banks until covered or
   exhausted. If nothing confirmed, do not keep searching — report the failure.
6. Final message must state: bank name, phone, blood group held and whether it
   is an exact or compatible match, units, hold expiry, distance, and that the
   attendant must bring a doctor's requisition, patient sample for crossmatch,
   and patient ID.

Never invent a bank, a group or a unit count. Report only what the tools returned.`;

// ────────────────────────────────────────────────────────────
// agent loop
// ────────────────────────────────────────────────────────────

async function runAgent(req: any) {
  if (!COMPAT[req.blood_group]) {
    throw new Error(`unknown blood group "${req.blood_group}"`);
  }

  const freed = await releaseExpiredHolds();

  const { data: reqRow, error } = await sb.from("requests").insert({
    hospital: req.hospital,
    lat: req.lat,
    lng: req.lng,
    blood_group: req.blood_group,
    units_needed: req.units_needed,
    urgency: req.urgency ?? "critical",
  }).select().single();
  if (error) throw new Error("create request: " + error.message);

  const requestId = reqRow.id;
  const origin = { lat: req.lat, lng: req.lng };
  const called = new Set<string>();

  await log(requestId, null, "system",
    `Request opened — ${req.units_needed} units ${req.blood_group} for ${req.hospital}` +
    (freed ? ` (${freed} expired holds released)` : ""));

  if (req.blood_group === "O-") {
    await log(requestId, null, "system",
      "O- has no compatible alternatives — only O- can be used. Radius expansion is the only fallback.");
  }

  const contents: any[] = [{
    role: "user",
    parts: [{
      text: `Hospital: ${req.hospital}. Need ${req.units_needed} units for a ${req.blood_group} patient. ` +
            `Urgency: ${req.urgency ?? "critical"}. Find and hold them.`,
    }],
  }];

  let finalText = "";
  let hitTurnLimit = true;

  for (let turn = 0; turn <20; turn++) {
    // Gemini returns 500/503 under load. Retry with backoff — a transient
    // spike upstream shouldn't kill an entire dispatch run.
    let data: any = null;
    for (let attempt = 0; attempt < 4; attempt++) {
      const res = await fetch(
        `https://generativelanguage.googleapis.com/v1beta/models/${MODEL}:generateContent`,
        {
          method: "POST",
          headers: {
            "Content-Type": "application/json",
            "x-goog-api-key": GEMINI_KEY,
          },
          body: JSON.stringify({
            contents,
            tools,
            systemInstruction: { parts: [{ text: SYSTEM }] },
          }),
        },
      );

      if (res.ok) {
        data = await res.json();
        break;
      }

      const errText = await res.text();
      if (res.status !== 503 && res.status !== 500) {
        throw new Error("Gemini: " + errText.slice(0, 400));
      }
      if (attempt === 3) {
        throw new Error("Gemini unavailable after 4 attempts: " + errText.slice(0, 200));
      }
      await sleep(2000 * (attempt + 1));
    }
    if (!data.candidates?.length) {
      throw new Error("Gemini: " + JSON.stringify(data).slice(0, 400));
    }

    const parts = data.candidates[0].content?.parts ?? [];
    contents.push({ role: "model", parts });

    const calls = parts.filter((p: any) => p.functionCall);
    if (calls.length === 0) {
      finalText = parts.map((p: any) => p.text ?? "").join("").trim();
      if (!finalText) finalText = "(model returned no text)";
      await log(requestId, null, "system", finalText);
      hitTurnLimit = false;
      break;
    }

    const responses = await Promise.all(calls.map(async (p: any) => {
      const { name, args } = p.functionCall;
      let result: any;
      try {
        if (name === "search_stock") {
          result = await searchStock(
            args.blood_group, args.min_units, args.radius_km, origin, requestId, called,
          );
        } else if (name === "call_banks") {
                            result = await callBanks(args.targets, args.units, requestId, called, req.hospital);
        } else if (name === "rank_banks") {
          result = await rankBanks(args.targets, origin, req.blood_group);
        } else if (name === "place_hold") {
          result = await placeHold(args.bank_id, args.blood_group, args.units, requestId);
        } else {
          result = { error: "unknown tool: " + name };
        }
      } catch (e) {
        result = { error: String(e) };
      }
      return { functionResponse: { name, response: result } };
    }));

    contents.push({ role: "user", parts: responses });
  }

  if (hitTurnLimit) {
    finalText = "Agent hit the 12-turn limit without producing a final answer.";
    await log(requestId, null, "system", finalText);
  }

  await sb.from("requests")
    .update({ status: hitTurnLimit ? "incomplete" : "resolved" })
    .eq("id", requestId);

  return { request_id: requestId, summary: finalText, incomplete: hitTurnLimit };
}

// ────────────────────────────────────────────────────────────
// entry point
// ────────────────────────────────────────────────────────────

Deno.serve(async (httpReq) => {
  if (httpReq.method === "OPTIONS") return new Response("ok", { headers: cors });

  try {
    const body = await httpReq.json();
    const action = body.action ?? "dispatch";

    // STAGE 0 — sanity check the compatibility table, no DB, no AI
    if (action === "test_compat") {
      const expectedCounts: Record<string, number> = {
        "O-": 1, "O+": 2, "A-": 2, "A+": 4, "B-": 2, "B+": 4, "AB-": 4, "AB+": 8,
      };
      const problems: string[] = [];
      for (const g of Object.keys(expectedCounts)) {
        if (COMPAT[g].length !== expectedCounts[g]) {
          problems.push(`${g}: expected ${expectedCounts[g]} donors, got ${COMPAT[g].length}`);
        }
        if (!COMPAT[g].includes("O-")) problems.push(`${g}: missing universal donor O-`);
      }
      const total = Object.values(COMPAT).reduce((s, v) => s + v.length, 0);
      if (total !== 27) problems.push(`total valid pairs should be 27, got ${total}`);
      return new Response(
        JSON.stringify({ ok: problems.length === 0, problems, table: COMPAT }, null, 2),
        { headers: cors },
      );
    }

    // STAGE 1 — tools only, no AI, no writes
    if (action === "test_search") {
      const out = await searchStock(
        body.blood_group ?? "O-",
        1,
        body.radius_km ?? 5,
        { lat: body.lat ?? 12.9634, lng: body.lng ?? 77.5750 },
        null,
        new Set(),
      );
      return new Response(JSON.stringify(out, null, 2), { headers: cors });
    }

    // STAGE 2 — simulated calls, writes to call_log
    if (action === "test_calls") {
      const group = body.blood_group ?? "O-";
      const { data: reqRow } = await sb.from("requests").insert({
        hospital: "TEST — Victoria Hospital",
        lat: 12.9634, lng: 77.5750,
        blood_group: group,
        units_needed: body.units ?? 4,
      }).select().single();

      const called = new Set<string>();
      const found = await searchStock(group, 1, 10, { lat: 12.9634, lng: 77.5750 }, reqRow.id, called);

      const out = await callBanks(
        found.candidates.slice(0, 6).map((c: any) => ({
          bank_id: c.bank_id,
          blood_group: c.blood_group,
        })),
        body.units ?? 4,
        reqRow.id,
        called,
      );
      return new Response(
        JSON.stringify({ request_id: reqRow.id, ...out }, null, 2),
        { headers: cors },
      );
    }

    // STAGE 3 — release expired holds manually
    if (action === "release_holds") {
      const n = await releaseExpiredHolds();
      return new Response(JSON.stringify({ released: n }), { headers: cors });
    }

    // STAGE 4 — full agent
    const result = await runAgent(body);
    return new Response(JSON.stringify(result, null, 2), { headers: cors });
  } catch (e) {
    return new Response(JSON.stringify({ error: String(e) }), { status: 500, headers: cors });
  }
});