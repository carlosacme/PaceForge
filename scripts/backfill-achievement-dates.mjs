/**
 * Backfill de achieved_on. Default DRY-RUN: no UPDATE.
 *
 * Correr DESPUÉS de PASO 0 (limpieza + unique index).
 *
 *   node scripts/backfill-achievement-dates.mjs
 *
 * Por atleta y código lista: earned_at (actual), proposed_achieved_on,
 * source_workout_id, o unreconstructable. Nunca inventa fecha.
 *
 * --execute está deshabilitado a propósito hasta que apruebes el listado.
 */
import { readFileSync } from "node:fs";
import { createClient } from "@supabase/supabase-js";
import { reconstructAchievedOn } from "../lib/athleteAchievements.js";
import { colombiaTodayYmd } from "../lib/cotDate.js";

function loadDotEnv(path = ".env") {
  try {
    const text = readFileSync(path, "utf8");
    for (const line of text.split(/\r?\n/)) {
      const t = line.trim();
      if (!t || t.startsWith("#")) continue;
      const i = t.indexOf("=");
      if (i < 0) continue;
      const key = t.slice(0, i).trim();
      let val = t.slice(i + 1).trim();
      if ((val.startsWith('"') && val.endsWith('"')) || (val.startsWith("'") && val.endsWith("'"))) {
        val = val.slice(1, -1);
      }
      if (process.env[key] == null) process.env[key] = val;
    }
  } catch {
    // sin .env
  }
}

loadDotEnv();

if (process.argv.includes("--execute")) {
  console.error("UPDATE deshabilitado. Aprueba el dry-run y recién ahí habilitamos --execute.");
  process.exit(2);
}

const url = process.env.SUPABASE_URL || process.env.VITE_SUPABASE_URL;
const key = process.env.SUPABASE_SERVICE_ROLE_KEY;
if (!url || !key) {
  console.error("Faltan SUPABASE_URL / SUPABASE_SERVICE_ROLE_KEY");
  process.exit(1);
}

const supabase = createClient(url, key, { auth: { persistSession: false } });
const todayYmd = colombiaTodayYmd();

async function fetchPaged(table, columns, extra = (q) => q) {
  const page = 1000;
  const rows = [];
  for (let from = 0; ; from += page) {
    let q = supabase.from(table).select(columns).range(from, from + page - 1);
    q = extra(q);
    const { data, error } = await q;
    if (error) throw error;
    rows.push(...(data || []));
    if ((data || []).length < page) break;
  }
  return rows;
}

const awards = await fetchPaged(
  "athlete_achievements",
  "id,athlete_id,achievement_code,earned_at,achieved_on",
  (q) => q.order("id", { ascending: true }),
);

const athleteIds = [...new Set(awards.map((a) => a.athlete_id))];
const workoutsByAthlete = new Map();
const evalsByAthlete = new Map();

for (const athleteId of athleteIds) {
  const workouts = await fetchPaged(
    "workouts",
    "id,athlete_id,scheduled_date,done,total_km,type,completed_at,manual_avg_hr,manual_max_hr,actual_avg_hr,actual_max_hr",
    (q) => q.eq("athlete_id", athleteId).order("id", { ascending: true }),
  );
  workoutsByAthlete.set(athleteId, workouts);
  const evaluations = await fetchPaged(
    "athlete_evaluations",
    "athlete_id,vdot,created_at",
    (q) => q.eq("athlete_id", athleteId).order("created_at", { ascending: true }),
  );
  evalsByAthlete.set(athleteId, evaluations);
}

const listing = [];
for (const row of awards) {
  const rec = reconstructAchievedOn(row.achievement_code, {
    workouts: workoutsByAthlete.get(row.athlete_id) || [],
    evaluations: evalsByAthlete.get(row.athlete_id) || [],
    todayYmd,
  });
  listing.push({
    athlete_id: row.athlete_id,
    achievement_id: row.id,
    achievement_code: row.achievement_code,
    earned_at: row.earned_at || null,
    achieved_on_actual: row.achieved_on || null,
    proposed_achieved_on: rec.achieved_on,
    source_workout_id: rec.source_workout_id,
    unreconstructable: rec.unreconstructable,
    reason: rec.reason,
    would_update: Boolean(rec.achieved_on) && !row.achieved_on,
  });
}

const wouldUpdate = listing.filter((r) => r.would_update);
const unrecon = listing.filter((r) => r.unreconstructable);
console.log(JSON.stringify({
  dry_run: true,
  todayYmd,
  filas: listing.length,
  would_update: wouldUpdate.length,
  unreconstructable: unrecon.length,
  listing,
}, null, 2));
