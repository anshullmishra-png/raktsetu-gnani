// RaktSetu — everything the public pages may do with the database.
//
// Every statement here runs after SET LOCAL ROLE raktsetu_public, so what is
// readable and writable is decided by Postgres grants and row level security
// (db/schema.sql), not by this file. If someone added a "read donors" op
// here, the database would refuse it.

import { asPublic, json } from "./_lib/core.js";
import { GROUPS, isUuid } from "./_lib/logic.js";

const isGroup = (g: unknown) => (GROUPS as readonly string[]).includes(String(g));
const NAME = /^[A-Za-z]{1,30}$/;
const bad = (message: string) => json({ error: "bad_request", message }, 400);

export async function POST(request: Request): Promise<Response> {
  try {
    const body = await request.json();
    const op = String(body.op ?? "");

    if (op === "bootstrap") {
      return json(await asPublic(async (run) => ({
        hospitals: await run("select id, name, lat, lng from hospitals order by name"),
        blood_banks: await run("select id, name, district, lat, lng, phone, pickup_hours, is_demo from blood_banks order by name"),
        calls_enabled: (await run("select calls_enabled from settings where id = 1"))[0]?.calls_enabled === true,
      })));
    }

    if (op === "request_state") {
      if (!isUuid(body.request_id)) return bad("request_id is required.");
      const id = body.request_id;
      return json(await asPublic(async (run) => ({
        request: (await run(
          "select id, hospital, lat, lng, blood_group, units_needed, status, replacement_offered, created_at from requests where id = $1", [id]))[0] ?? null,
        call_log: await run(
          "select id, request_id, bank_id, event, message, units_offered, created_at from call_log where request_id = $1 order by id", [id]),
        proposals: await run(
          "select id, request_id, bank_id, blood_group, units, source, status, created_at from hold_proposals where request_id = $1 order by created_at", [id]),
        holds: await run(
          "select id, request_id, bank_id, blood_group, units, status, expires_at, created_at from holds where request_id = $1 order by created_at", [id]),
        calls_enabled: (await run("select calls_enabled from settings where id = 1"))[0]?.calls_enabled === true,
      })));
    }

    if (op === "bank_need") {
      return json({ rows: await asPublic((run) => run("select * from bank_need limit 400")) });
    }

    if (op === "pending_proposals") {
      return json({
        rows: await asPublic((run) => run(
          `select p.id, p.request_id, p.bank_id, p.blood_group, p.units, p.source, p.status, p.created_at,
                  b.name as bank_name, r.hospital
           from hold_proposals p join blood_banks b on b.id = p.bank_id join requests r on r.id = p.request_id
           where p.status = 'pending' order by p.created_at desc limit 100`)),
      });
    }

    if (op === "register_donor") {
      if (body.consent !== true) {
        return json({ error: "consent_required", message: "Registration needs your explicit consent." }, 403);
      }
      const first = String(body.first_name ?? "").trim();
      if (!NAME.test(first)) return bad("First name: letters only, up to 30.");
      if (!isGroup(body.blood_group)) return bad("Choose a blood group.");
      const lat = Number(body.lat), lng = Number(body.lng);
      if (!Number.isFinite(lat) || !Number.isFinite(lng)) return bad("Choose a locality.");
      const last = typeof body.last_donated === "string" && /^\d{4}-\d{2}-\d{2}$/.test(body.last_donated) ? body.last_donated : null;
      // consent_at is stamped here only because consent === true; the RLS
      // policy rejects a row without a fresh consent timestamp.
      await asPublic((run) => run(
        `insert into donors (first_name, blood_group, locality, lat, lng, last_donated, consent_at)
         values ($1, $2, $3, $4, $5, $6::date, now())`,
        [first, body.blood_group, String(body.locality ?? "").slice(0, 60), lat, lng, last]));
      return json({ ok: true });
    }

    if (op === "pledge") {
      if (body.consent !== true) {
        return json({ error: "consent_required", message: "A pledge needs the donor's explicit consent." }, 403);
      }
      const first = String(body.donor_first_name ?? "").trim();
      if (!isUuid(body.bank_id)) return bad("Choose a blood bank.");
      if (!NAME.test(first)) return bad("First name: letters only, up to 30.");
      if (!isGroup(body.blood_group)) return bad("Choose a blood group.");
      await asPublic((run) => run(
        `insert into replacement_pledges (bank_id, donor_first_name, blood_group, consent_at) values ($1, $2, $3, now())`,
        [body.bank_id, first, body.blood_group]));
      return json({ ok: true });
    }

    if (op === "fulfil_hold") {
      if (!isUuid(body.hold_id)) return bad("hold_id is required.");
      const r = await asPublic((run) => run("select fulfil_hold($1) as r", [body.hold_id]));
      return json(r[0]?.r ?? { ok: false, reason: "failed" });
    }

    if (op === "mark_replacement_offered") {
      if (!isUuid(body.request_id)) return bad("request_id is required.");
      const r = await asPublic((run) => run("select mark_replacement_offered($1) as r", [body.request_id]));
      return json(r[0]?.r ?? { ok: false, reason: "failed" });
    }

    return bad("unknown op");
  } catch (e) {
    return json({ error: "public_failed", message: String(e).slice(0, 300) }, 500);
  }
}
