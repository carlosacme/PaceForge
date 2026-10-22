/**
 * Backfill de achieved_on. Default DRY-RUN: no UPDATE.
 *
 * Correr DESPUÉS de PASO 0 (limpieza + unique index).
 *
 *   node scripts/backfill-achievement-dates.mjs
 *   node scripts/backfill-achievement-dates.mjs --from-json /tmp/achieved-on-dryrun.json
 *
 * Solo UPDATE de filas EXISTENTES con achieved_on IS NULL. Sin INSERT.
 * Usa computeAchievementDates (misma reconstrucción que el award / la grilla
 * una vez persistida). Nunca inventa now() ni earned_at.
 *
 * --execute está deshabilitado a propósito hasta que apruebes el listado.
 */
import { readFileSync, writeFileSync } from "node:fs";
import { createClient } from "@supabase/supabase-js";
import { computeAchievementDates } from "../lib/athleteAchievements.js";
import { colombiaTodayYmd, parseYmdUtc } from "../lib/cotDate.js";

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

/** No backfill: la regla no es fecha-de-evento exacta. */
const INEXACT_SKIP = {
  EARLY_BIRD: "inexacta: completed_at.getHours() es TZ del cliente, no fecha de evento; no se persiste",
  CONSISTENT: "inexacta: histórico se otorgó con doneCount>=10; visual usa completed_at para la semana; regla actual es 4 semanas por scheduled_date",
};

function earnedAtCotYmd(earnedAt) {
  if (!earnedAt) return "";
  const raw = String(earnedAt).trim();
  const iso = /Z|[+-]\d{2}:\d{2}$/.test(raw) ? raw.replace(" ", "T") : `${raw.replace(" ", "T")}Z`;
  const d = new Date(iso);
  if (Number.isNaN(d.getTime())) return "";
  return colombiaTodayYmd(d);
}

function ymdDiffDays(a, b) {
  const da = parseYmdUtc(a);
  const db = parseYmdUtc(b);
  if (!da || !db) return null;
  return Math.round((da.getTime() - db.getTime()) / 86400000);
}

function workoutById(workouts, id) {
  if (id == null) return null;
  return (workouts || []).find((w) => Number(w.id) === Number(id)) || null;
}

export function planBackfillRow(row, { workouts, evaluations, todayYmd }) {
  const rec = computeAchievementDates(row.achievement_code, { workouts, evaluations, todayYmd });
  const source = workoutById(workouts, rec.source_workout_id);
  const earnedCot = earnedAtCotYmd(row.earned_at);
  const proposed = rec.achieved_on || null;
  const diffDays = proposed && earnedCot ? ymdDiffDays(proposed, earnedCot) : null;
  const inexact = INEXACT_SKIP[row.achievement_code] || null;
  const alreadySet = Boolean(row.achieved_on);
  const wouldUpdate = !alreadySet && Boolean(proposed) && !inexact;
  let action = "would_update";
  if (alreadySet) action = "skip_already_set";
  else if (inexact) action = "skip_inexact";
  else if (!proposed) action = "leave_null";
  return {
    id: row.id,
    athlete_id: row.athlete_id,
    athlete_name: row.athlete_name || null,
    achievement_code: row.achievement_code,
    earned_at: row.earned_at || null,
    earned_at_cot: earnedCot || null,
    achieved_on_actual: row.achieved_on || null,
    proposed_achieved_on: proposed,
    source_workout_id: rec.source_workout_id,
    source_scheduled_date: source?.scheduled_date ? String(source.scheduled_date).slice(0, 10) : null,
    unreconstructable: rec.unreconstructable,
    reason: inexact || rec.reason,
    diff_days_vs_earned_cot: diffDays,
    review_gt_3d: Boolean(proposed && diffDays != null && Math.abs(diffDays) > 3),
    would_update: wouldUpdate,
    action,
  };
}

function summarize(listing) {
  return {
    dry_run: true,
    filas: listing.length,
    already_set: listing.filter((r) => r.action === "skip_already_set").length,
    would_update: listing.filter((r) => r.would_update).length,
    skip_inexact: listing.filter((r) => r.action === "skip_inexact").length,
    leave_null: listing.filter((r) => r.action === "leave_null").length,
    review_gt_3d: listing.filter((r) => r.review_gt_3d).length,
  };
}

const fromJsonArg = process.argv.indexOf("--from-json");
const isMain = !process.argv[1]?.includes("node:test") && process.argv[1]?.endsWith("backfill-achievement-dates.mjs");

if (isMain && fromJsonArg >= 0) {
  const payload = JSON.parse(readFileSync(process.argv[fromJsonArg + 1], "utf8"));
  const todayYmd = payload.todayYmd || colombiaTodayYmd();
  const workoutsByAthlete = new Map();
  for (const w of payload.workouts || []) {
    const id = w.athlete_id;
    if (!workoutsByAthlete.has(id)) workoutsByAthlete.set(id, []);
    workoutsByAthlete.get(id).push(w);
  }
  const evalsByAthlete = new Map();
  for (const e of payload.evaluations || []) {
    const id = e.athlete_id;
    if (!evalsByAthlete.has(id)) evalsByAthlete.set(id, []);
    evalsByAthlete.get(id).push(e);
  }
  const listing = (payload.awards || []).map((row) => planBackfillRow(row, {
    workouts: workoutsByAthlete.get(row.athlete_id) || [],
    evaluations: evalsByAthlete.get(row.athlete_id) || [],
    todayYmd,
  }));
  const out = { ...summarize(listing), todayYmd, listing };
  const outPath = payload.outPath;
  if (outPath) writeFileSync(outPath, JSON.stringify(out, null, 2));
  console.log(JSON.stringify(out, null, 2));
} else if (isMain) {
  const url = process.env.SUPABASE_URL || process.env.VITE_SUPABASE_URL;
  const key = process.env.SUPABASE_SERVICE_ROLE_KEY;
  if (!url || !key) {
    console.error("Faltan SUPABASE_URL / SUPABASE_SERVICE_ROLE_KEY (o usa --from-json)");
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
  const athletes = await fetchPaged("athletes", "id,name");
  const nameById = new Map(athletes.map((a) => [Number(a.id), a.name]));
  for (const row of awards) row.athlete_name = nameById.get(Number(row.athlete_id)) || null;

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

  const listing = awards.map((row) => planBackfillRow(row, {
    workouts: workoutsByAthlete.get(row.athlete_id) || [],
    evaluations: evalsByAthlete.get(row.athlete_id) || [],
    todayYmd,
  }));
  console.log(JSON.stringify({ ...summarize(listing), todayYmd, listing }, null, 2));
}
