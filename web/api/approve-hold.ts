// RaktSetu — GUARDRAIL 4: the only path that places a hold.
// A person (hospital user, or admin with the passcode) approves or rejects a
// pending proposal. Approval runs place_hold_atomic; nothing else does.

import { audit, isAdmin, json, killSwitch, logCall, one } from "./_lib/core.js";
import { isUuid } from "./_lib/logic.js";

export async function POST(request: Request): Promise<Response> {
  try {
    const blocked = await killSwitch("approve-hold");
    if (blocked) return blocked;

    const { proposal_id, decision, approver_role } = await request.json();
    if (!isUuid(proposal_id) || !["approve", "reject"].includes(decision) || !["hospital", "admin"].includes(approver_role)) {
      return json({ error: "bad_request", message: "proposal_id, decision and approver_role are required." }, 400);
    }
    if (approver_role === "admin" && !isAdmin(request)) {
      await audit("system", "admin_passcode_rejected", { function: "approve-hold" });
      return json({ error: "unauthorised", message: "Admin approval needs the admin passcode." }, 401);
    }

    const prop = await one(
      `select p.id, p.request_id, p.bank_id, b.name as bank_name
       from hold_proposals p join blood_banks b on b.id = p.bank_id where p.id = $1`, [proposal_id]);
    if (!prop) return json({ error: "not_found", message: "Proposal not found." }, 404);
    const bankName = prop.bank_name;

    if (decision === "reject") {
      const r = (await one<{ r: any }>("select reject_proposal($1, $2) as r", [proposal_id, approver_role]))?.r;
      if (r?.ok) {
        await logCall(prop.request_id, prop.bank_id, "declined", `Proposal for ${bankName} rejected by ${approver_role}. Nothing reserved.`);
      }
      return json(r ?? { ok: false, reason: "failed" });
    }

    const r = (await one<{ r: any }>("select place_hold_atomic($1, $2, 30) as r", [proposal_id, approver_role]))?.r;
    if (!r?.ok) {
      await logCall(prop.request_id, prop.bank_id, "declined",
        `Hold at ${bankName} could not be placed: ${String(r?.reason ?? "unknown").replaceAll("_", " ")}.`);
      return json({ ok: false, reason: r?.reason ?? "unknown" });
    }

    await logCall(prop.request_id, prop.bank_id, "held",
      `${r.units} units of ${r.blood_group} HELD at ${bankName} for 30 minutes — approved by ${approver_role}.`, r.units);

    return json({
      ok: true,
      hold: { id: r.hold_id, units: r.units, expires_at: r.expires_at, blood_group: r.blood_group, bank: bankName },
    });
  } catch (e) {
    return json({ error: "approve_failed", message: String(e).slice(0, 300) }, 500);
  }
}
