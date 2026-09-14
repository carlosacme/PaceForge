/**
 * Dry-run local del cron watch-sync. No PATCH, no push.
 * Uso: node scripts/dry-watch-sync.mjs 2026-09-11
 */
import { readFileSync } from "node:fs";
import { createClient } from "@supabase/supabase-js";
import { runWatchSyncBackfill } from "../lib/watchSyncBackfill.js";

function loadDotEnv(path = ".env") {
  const text = readFileSync(path, "utf8");
  for (const line of text.split(/\r?\n/)) {
    const t = line.trim();
    if (!t || t.startsWith("#")) continue;
    const i = t.indexOf("=");
    if (i < 0) continue;
    const key = t.slice(0, i).trim();
    let val = t.slice(i + 1).trim();
    if (
      (val.startsWith('"') && val.endsWith('"')) ||
      (val.startsWith("'") && val.endsWith("'"))
    ) {
      val = val.slice(1, -1);
    }
    if (process.env[key] == null) process.env[key] = val;
  }
}

loadDotEnv();

const asOf = process.argv[2] || "2026-09-11";
const url = process.env.SUPABASE_URL || process.env.VITE_SUPABASE_URL;
const key = process.env.SUPABASE_SERVICE_ROLE_KEY;
if (!url || !key) {
  console.error("Faltan SUPABASE_URL / SUPABASE_SERVICE_ROLE_KEY");
  process.exit(1);
}

const supabase = createClient(url, key);
const result = await runWatchSyncBackfill({ supabase, todayYmd: asOf, dry: true });
console.log(JSON.stringify(result, null, 2));
