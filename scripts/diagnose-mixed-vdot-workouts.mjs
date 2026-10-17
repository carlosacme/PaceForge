/**
 * Diagnóstico de VDOT mezclado dentro de un mismo workout.
 * SOLO LECTURA (SELECT). Default dry-run: imprime conteos y escribe JSON.
 *
 *   node scripts/diagnose-mixed-vdot-workouts.mjs
 *   node scripts/diagnose-mixed-vdot-workouts.mjs --out /tmp/mixed-vdot.json
 *
 * No tiene --execute. No hace UPDATE.
 *
 * Requiere SUPABASE_URL + SUPABASE_SERVICE_ROLE_KEY (o SUPABASE_ANON_KEY
 * si RLS te deja leer workouts). No lo corras contra producción sin
 * aprobación de Carlos.
 */
import { writeFileSync } from "node:fs";
import { createClient } from "@supabase/supabase-js";
import { pacesForVdot, paceTextToSecs, PLAN_CALIBRATION_VDOT } from "../src/lib/vdot.js";

const ZONES = ["E", "M", "T", "I", "R"];
const SPREAD_MIN = 0.5;

function zoneCenter(paces, zone) {
  const v = paces?.[zone];
  if (v == null) return null;
  return Array.isArray(v) ? (v[0] + v[1]) / 2 : v;
}

/** VDOT 30–70 (paso 0.1) cuya zona más cercana encaja con el ritmo. */
function impliedVdotForPace(paceStr) {
  const secs = paceTextToSecs(paceStr);
  if (secs == null) return null;
  let best = null;
  let bestDiff = Infinity;
  for (let v = 30; v <= 70; v = Math.round((v + 0.1) * 10) / 10) {
    const p = pacesForVdot(v);
    if (!p) continue;
    for (const zone of ZONES) {
      const c = zoneCenter(p, zone);
      if (c == null) continue;
      const diff = Math.abs(c - secs);
      if (diff < bestDiff) {
        bestDiff = diff;
        best = { vdot: v, zone, diff };
      }
    }
  }
  if (!best || best.diff > 20) return null;
  return best;
}

function stepPace(step) {
  return String(step?.target_pace || step?.pace || "").trim();
}

function descriptionPaces(text) {
  const s = String(text || "");
  const out = [];
  const re = /(\d{1,2}:[0-5]\d(?:\s*[-–]\s*\d{1,2}:[0-5]\d)?)\s*(?:min\s*)?\/\s*km/gi;
  let m;
  while ((m = re.exec(s))) out.push(m[1]);
  return out;
}

function pacesMatch(a, b, tol = 3) {
  const sa = paceTextToSecs(a);
  const sb = paceTextToSecs(b);
  if (sa == null || sb == null) return false;
  return Math.abs(sa - sb) <= tol;
}

async function fetchWorkouts(supabase) {
  const page = 1000;
  const rows = [];
  for (let from = 0; ; from += page) {
    const { data, error } = await supabase
      .from("workouts")
      .select("id, athlete_id, title, scheduled_date, done, generated_with_vdot, description, structure")
      .not("structure", "is", null)
      .order("id", { ascending: true })
      .range(from, from + page - 1);
    if (error) throw error;
    if (!data?.length) break;
    rows.push(...data);
    if (data.length < page) break;
  }
  return rows;
}

function analyze(row) {
  const steps = Array.isArray(row.structure) ? row.structure : [];
  const stepInfos = [];
  for (const step of steps) {
    const pace = stepPace(step);
    if (!/\d{1,2}:[0-5]\d/.test(pace)) continue;
    const implied = impliedVdotForPace(pace);
    stepInfos.push({
      block_type: step.block_type || step.phase || "",
      description: String(step.description || "").slice(0, 80),
      pace,
      target_zone: step.target_zone || null,
      implied_vdot: implied?.vdot ?? null,
      implied_zone: implied?.zone ?? null,
    });
  }
  const implieds = stepInfos.map((s) => s.implied_vdot).filter((v) => v != null);
  const spread = implieds.length
    ? Math.max(...implieds) - Math.min(...implieds)
    : 0;
  const descPaces = descriptionPaces(row.description);
  const descMismatch = descPaces.some(
    (dp) => !stepInfos.some((s) => pacesMatch(dp, s.pace)),
  );
  return {
    id: row.id,
    athlete_id: row.athlete_id,
    title: row.title,
    scheduled_date: row.scheduled_date,
    done: row.done === true,
    generated_with_vdot: row.generated_with_vdot ?? null,
    calibration_ref: PLAN_CALIBRATION_VDOT,
    step_implied_spread: Math.round(spread * 10) / 10,
    mixed_steps: spread >= SPREAD_MIN,
    description_paces: descPaces,
    description_mismatch: descPaces.length > 0 && descMismatch,
    pending_future:
      row.done !== true
      && row.scheduled_date
      && String(row.scheduled_date) >= new Date().toISOString().slice(0, 10),
    steps: stepInfos,
  };
}

async function main() {
  if (process.argv.includes("--execute")) {
    console.error("Este script no tiene apply. Quita --execute.");
    process.exit(2);
  }
  const url = process.env.SUPABASE_URL;
  const key = process.env.SUPABASE_SERVICE_ROLE_KEY || process.env.SUPABASE_ANON_KEY;
  if (!url || !key) {
    console.error("Falta SUPABASE_URL y SUPABASE_SERVICE_ROLE_KEY (o ANON).");
    process.exit(2);
  }
  const supabase = createClient(url, key, { auth: { persistSession: false } });
  const rows = await fetchWorkouts(supabase);
  const reports = rows
    .filter((r) => Array.isArray(r.structure) && r.structure.length)
    .map(analyze);

  const mixed = reports.filter((r) => r.mixed_steps);
  const descOff = reports.filter((r) => r.description_mismatch);
  const pendingMixed = mixed.filter((r) => r.pending_future);
  const doneMixed = mixed.filter((r) => r.done);

  const summary = {
    scanned: reports.length,
    mixed_steps: mixed.length,
    mixed_pending_future: pendingMixed.length,
    mixed_done: doneMixed.length,
    description_mismatch: descOff.length,
    description_mismatch_pending: descOff.filter((r) => r.pending_future).length,
    with_origin: reports.filter((r) => r.generated_with_vdot != null).length,
    without_origin: reports.filter((r) => r.generated_with_vdot == null).length,
  };
  console.log(JSON.stringify(summary, null, 2));

  const outIdx = process.argv.indexOf("--out");
  const outPath = outIdx >= 0 ? process.argv[outIdx + 1] : "/tmp/mixed-vdot-dryrun.json";
  writeFileSync(
    outPath,
    JSON.stringify({ summary, mixed, description_mismatch: descOff }, null, 2),
  );
  console.log(`detalle: ${outPath}`);
}

main().catch((e) => {
  console.error(e);
  process.exit(1);
});
