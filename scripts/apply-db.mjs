// Apply db/schema.sql and db/seed.sql to the Neon database in DATABASE_URL.
//   node --env-file=.env scripts/apply-db.mjs            schema + seed
//   node --env-file=.env scripts/apply-db.mjs --check    only list existing public tables
// Run from the repo root. Uses the pg driver installed in web/.
import { readFileSync } from "node:fs";
import { createRequire } from "node:module";
const require = createRequire(new URL("../web/package.json", import.meta.url));
const pg = require("pg");

const url = process.env.DATABASE_URL;
if (!url) { console.error("DATABASE_URL is not set in .env"); process.exit(1); }

const client = new pg.Client({ connectionString: url });
await client.connect();
try {
  const v = await client.query("select current_user, current_database(), split_part(version(), ' ', 2) as pg");
  console.log(`Connected: db=${v.rows[0].current_database} pg=${v.rows[0].pg}`);
  const t = await client.query("select table_name from information_schema.tables where table_schema = 'public' order by 1");
  console.log("Existing public tables:", t.rows.map((r) => r.table_name).join(", ") || "(none)");
  if (process.argv.includes("--check")) process.exit(0);

  for (const f of ["schema.sql", "seed.sql"]) {
    await client.query(readFileSync(new URL(`../db/${f}`, import.meta.url), "utf8"));
    console.log(`Applied db/${f}`);
  }
  const c = await client.query(`select
    (select count(*) from blood_banks) as banks,
    (select count(*) from blood_banks where district = 'Bengaluru') as bengaluru,
    (select count(*) from hospitals) as hospitals,
    (select count(*) from stock) as stock_rows,
    (select count(*) from stock where blood_group like '%-' and units > 0) as rh_neg_in_stock,
    (select count(*) from stock where last_updated < now() - interval '24 hours') as stale_rows`);
  console.log("Seeded:", c.rows[0]);
} finally {
  await client.end();
}
