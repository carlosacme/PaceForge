/**
 * Dry-run del backfill de rescale idempotente.
 * SELECT + preview. Sin UPDATE.
 *
 *   node scripts/vdot-rescale-backfill.mjs
 *
 * --execute está muerto hasta que Carlos lo apruebe por escrito.
 */
import { writeFileSync, mkdirSync } from "node:fs";
import { createClient } from "@supabase/supabase-js";
import { previewBackfill, todayYmdColombia } from "../src/lib/vdotRescaleBackfill.js";

if (process.argv.includes("--execute")) {
  console.error("vdot-rescale-backfill: --execute está muerto hasta aprobación de Carlos. Solo dry-run.");
  process.exit(2);
}

const url = process.env.SUPABASE_URL || process.env.VITE_SUPABASE_URL;
const key = process.env.SUPABASE_SERVICE_ROLE_KEY;
if (!url || !key) {
  console.error("Faltan SUPABASE_URL / SUPABASE_SERVICE_ROLE_KEY");
  process.exit(1);
}

const today = process.argv.find((a) => /^\d{4}-\d{2}-\d{2}$/.test(a)) || todayYmdColombia();
const supabase = createClient(url, key);
const { data, error } = await supabase
  .from("workouts")
  .select("id,title,scheduled_date,done,generated_with_vdot,description,structure")
  .not("structure", "is", null);

if (error) {
  console.error(error.message);
  process.exit(1);
}

const report = previewBackfill(data || [], today);
mkdirSync("scripts/output", { recursive: true });
const outPath = "scripts/output/vdot-rescale-backfill-dry.json";
writeFileSync(outPath, JSON.stringify(report, null, 2));
console.log(JSON.stringify({
  today: report.today,
  execute: false,
  skipped: report.skipped,
  candidates: report.candidates.length,
  changed: report.candidates.filter((c) => c.changed).length,
  outPath,
}, null, 2));
