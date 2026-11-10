// RaktSetu — admin function. Every action needs the ADMIN_PASSCODE secret in
// the x-admin-passcode header. There is no login in this demo, so without
// this anyone who clicked "Admin" could pause the system or read the audit log.
//
// This is the one acting function that does NOT refuse when the kill switch is
// off: it has to stay reachable to turn calls back on. It places no calls and no holds.

import { audit, isAdmin, json, one, q } from "./_lib/core.js";
import { COMPAT, isUuid } from "./_lib/logic.js";

export async function POST(request: Request): Promise<Response> {
  try {
    if (!isAdmin(request)) {
      await audit("system", "admin_passcode_rejected", { function: "admin" });
      return json({ error: "unauthorised", message: "Wrong passcode." }, 401);
    }
    const body = await request.json();
    const action = body.action ?? "status";

    if (action === "status") {
      const s = await one("select calls_enabled, updated_at from settings where id = 1");
      return json({ calls_enabled: s?.calls_enabled === true, updated_at: s?.updated_at });
    }

    if (action === "set_calls_enabled") {
      if (typeof body.enabled !== "boolean") return json({ error: "bad_request", message: "enabled must be true or false." }, 400);
      // The settings trigger writes the kill_switch_changed audit entry.
      await q("update settings set calls_enabled = $1, updated_at = now() where id = 1", [body.enabled]);
      return json({ calls_enabled: body.enabled });
    }

    if (action === "audit") {
      return json({
        rows: await q("select id, created_at, actor, event, request_id, bank_id, detail from audit_log order by id desc limit 300"),
      });
    }

    if (action === "transcripts") {
      return json({
        rows: await q(
          `select v.id, v.created_at, b.name as bank_name, v.blood_group, v.language_code, v.model, v.transcript,
                  v.units_reported, v.will_hold, v.off_topic, v.pii_redacted, v.needs_review, v.consent_at, v.outcome
           from voice_calls v join blood_banks b on b.id = v.bank_id
           order by v.created_at desc limit 100`),
      });
    }

    if (action === "evals") {
      return json({ rows: await q("select * from eval_runs order by created_at desc, clip limit 200") });
    }

    if (action === "pledges") {
      return json({
        rows: await q(
          `select p.id, p.created_at, b.name as bank_name, p.donor_first_name, p.blood_group
           from replacement_pledges p join blood_banks b on b.id = p.bank_id
           order by p.created_at desc limit 100`),
      });
    }

    // Bank-level donor alert: records who WOULD be contacted. Nothing is sent.
    if (action === "broadcast_donor_alert") {
      if (!isUuid(body.bank_id) || !COMPAT[body.blood_group]) return json({ error: "bad_request" }, 400);
      const r = (await one<{ r: any }>("select broadcast_donor_alert($1, $2) as r", [body.bank_id, body.blood_group]))?.r;
      await audit("admin", "donor_alert_recorded", { result: r }, null, body.bank_id);
      return json(r);
    }

    return json({ error: "bad_request", message: "unknown action" }, 400);
  } catch (e) {
    return json({ error: "admin_failed", message: String(e).slice(0, 300) }, 500);
  }
}
