// RaktSetu — shared helpers for the Vercel serverless API (Node runtime, Neon Postgres).
import pg from "pg";

const pool = new pg.Pool({ connectionString: process.env.DATABASE_URL, max: 3, idleTimeoutMillis: 10_000 });

/** Privileged query as the database owner. Only ever called with parameterised SQL. */
export async function q<T = any>(text: string, params: unknown[] = []): Promise<T[]> {
  const res = await pool.query(text, params as any[]);
  return res.rows as T[];
}
export async function one<T = any>(text: string, params: unknown[] = []): Promise<T | null> {
  return (await q<T>(text, params))[0] ?? null;
}

/**
 * Run statements as the restricted role. Postgres grants and RLS decide what
 * is allowed; this is how the public pages reach the database.
 */
export async function asPublic<T>(fn: (run: (text: string, params?: unknown[]) => Promise<any[]>) => Promise<T>): Promise<T> {
  const client = await pool.connect();
  try {
    await client.query("begin");
    await client.query("set local role raktsetu_public");
    const out = await fn(async (text, params = []) => (await client.query(text, params as any[])).rows);
    await client.query("commit");
    return out;
  } catch (e) {
    await client.query("rollback").catch(() => {});
    throw e;
  } finally {
    client.release();
  }
}

export const json = (body: unknown, status = 200) =>
  new Response(JSON.stringify(body), { status, headers: { "Content-Type": "application/json", "Cache-Control": "no-store" } });

export const sleep = (ms: number) => new Promise((r) => setTimeout(r, ms));

/** GUARDRAIL 7 — append-only audit entry. Never include secrets or raw audio. */
export async function audit(
  actor: string, event: string, detail: Record<string, unknown> = {},
  requestId: string | null = null, bankId: string | null = null,
) {
  try {
    await q("insert into audit_log (actor, event, detail, request_id, bank_id) values ($1, $2, $3::jsonb, $4, $5)",
      [actor, event, JSON.stringify(detail), requestId, bankId]);
  } catch (e) {
    console.error("audit insert failed:", String(e).slice(0, 200));
  }
}

/**
 * GUARDRAIL 5 — kill switch. Every acting function calls this first. Returns
 * a 423 response when calls are disabled, or when the setting cannot be read
 * (fail closed).
 */
export async function killSwitch(fn: string): Promise<Response | null> {
  let enabled = false;
  try {
    enabled = (await one<{ calls_enabled: boolean }>("select calls_enabled from settings where id = 1"))?.calls_enabled === true;
  } catch {
    enabled = false;
  }
  if (enabled) return null;
  await audit("system", "refused_calls_disabled", { function: fn });
  return json({ error: "calls_disabled", message: "Calls are paused by an admin. Nothing was done." }, 423);
}

/** Constant-time passcode check against the ADMIN_PASSCODE secret. */
export function isAdmin(req: Request): boolean {
  const expected = process.env.ADMIN_PASSCODE ?? "";
  const given = req.headers.get("x-admin-passcode") ?? "";
  if (expected.length < 8 || given.length !== expected.length) return false;
  let diff = 0;
  for (let i = 0; i < expected.length; i++) diff |= expected.charCodeAt(i) ^ given.charCodeAt(i);
  return diff === 0;
}

export async function logCall(requestId: string | null, bankId: string | null, event: string, message: string, units = 0) {
  if (!requestId) return;
  await q("insert into call_log (request_id, bank_id, event, message, units_offered) values ($1, $2, $3, $4, $5)",
    [requestId, bankId, event, message, units]);
}

export const GEMINI_MODEL = process.env.GEMINI_MODEL ?? "gemini-3.1-flash-lite";

/** Gemini generateContent with backoff on 429/500/503. Key goes in a header, never the URL. */
export async function gemini(body: Record<string, unknown>): Promise<any> {
  const key = process.env.GEMINI_API_KEY;
  if (!key) throw new Error("GEMINI_API_KEY is not set");
  for (let attempt = 0; attempt < 4; attempt++) {
    const res = await fetch(
      `https://generativelanguage.googleapis.com/v1beta/models/${GEMINI_MODEL}:generateContent`,
      { method: "POST", headers: { "Content-Type": "application/json", "x-goog-api-key": key }, body: JSON.stringify(body) },
    );
    if (res.ok) return await res.json();
    const errText = await res.text();
    if (![429, 500, 503].includes(res.status)) throw new Error(`Gemini ${res.status}: ${errText.slice(0, 300)}`);
    if (attempt === 3) throw new Error(`Gemini unavailable after 4 attempts: ${errText.slice(0, 200)}`);
    await sleep(1500 * (attempt + 1));
  }
  throw new Error("unreachable");
}
