// Copy the server secrets from .env into the linked Vercel project (production).
//   node --env-file=.env scripts/push-env.mjs      (run from the repo root)
// Values go to the Vercel CLI over stdin and are never printed.
import { execSync } from "node:child_process";

const keys = ["DATABASE_URL", "GEMINI_API_KEY", "GNANI_API_KEY", "ADMIN_PASSCODE", "GNANI_MODEL", "GEMINI_MODEL"];
for (const k of keys) {
  const v = process.env[k];
  if (!v) { console.log(`${k}: not set locally, skipped`); continue; }
  try {
    execSync(`npx vercel env add ${k} production --force`, { cwd: new URL("../web/", import.meta.url), input: v, stdio: ["pipe", "ignore", "ignore"] });
    console.log(`${k}: set on Vercel (production)`);
  } catch {
    console.log(`${k}: FAILED to set`);
    process.exitCode = 1;
  }
}
