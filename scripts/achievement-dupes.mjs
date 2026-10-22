/**
 * PASO 0.2 — listado dry-run de duplicados en athlete_achievements.
 *
 * Default: SOLO SELECT. No CREATE, no DELETE.
 *
 *   node scripts/achievement-dupes.mjs
 *   node scripts/achievement-dupes.mjs --backup     # CREATE TABLE backup (exige --i-approve-write)
 *   node scripts/achievement-dupes.mjs --delete     # borra id > min(id) (exige --i-approve-write)
 *
 * Credenciales: SUPABASE_URL + SUPABASE_SERVICE_ROLE_KEY (.env).
 */
import { readFileSync } from "node:fs";
import { createClient } from "@supabase/supabase-js";

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
    // sin .env: se usan process.env
  }
}

loadDotEnv();

const args = new Set(process.argv.slice(2));
const approveWrite = args.has("--i-approve-write");
const doBackup = args.has("--backup");
const doDelete = args.has("--delete");

const url = process.env.SUPABASE_URL || process.env.VITE_SUPABASE_URL;
const key = process.env.SUPABASE_SERVICE_ROLE_KEY;
if (!url || !key) {
  console.error("Faltan SUPABASE_URL / SUPABASE_SERVICE_ROLE_KEY");
  process.exit(1);
}

const supabase = createClient(url, key, { auth: { persistSession: false } });

async function fetchAllAwards() {
  const page = 1000;
  const rows = [];
  for (let from = 0; ; from += page) {
    const { data, error } = await supabase
      .from("athlete_achievements")
      .select("id,athlete_id,achievement_code,value,earned_at,achieved_on")
      .order("id", { ascending: true })
      .range(from, from + page - 1);
    if (error) {
      if (!String(error.message || "").includes("achieved_on")) throw error;
      const retry = await supabase
        .from("athlete_achievements")
        .select("id,athlete_id,achievement_code,value,earned_at")
        .order("id", { ascending: true })
        .range(from, from + page - 1);
      if (retry.error) throw retry.error;
      rows.push(...(retry.data || []));
      if ((retry.data || []).length < page) break;
      continue;
    }
    rows.push(...(data || []));
    if ((data || []).length < page) break;
  }
  return rows;
}

function duplicatePlan(rows) {
  const groups = new Map();
  for (const row of rows) {
    const key = `${row.athlete_id}\t${row.achievement_code}`;
    if (!groups.has(key)) groups.set(key, []);
    groups.get(key).push(row);
  }
  const summary = [];
  const toDelete = [];
  for (const [, list] of groups) {
    if (list.length < 2) continue;
    list.sort((a, b) => Number(a.id) - Number(b.id));
    const keep = list[0];
    const drop = list.slice(1);
    summary.push({
      athlete_id: keep.athlete_id,
      achievement_code: keep.achievement_code,
      copias: list.length,
      keep_id: keep.id,
      a_borrar: drop.length,
      delete_ids: drop.map((r) => r.id),
      earned_at_keep: keep.earned_at || null,
    });
    toDelete.push(...drop);
  }
  summary.sort((a, b) => b.a_borrar - a.a_borrar);
  return { summary, toDelete };
}

if (doBackup || doDelete) {
  if (!approveWrite) {
    console.error("Escritura bloqueada. Pasa --i-approve-write además de --backup/--delete.");
    process.exit(2);
  }
  console.error("Este script no ejecuta SQL arbitrario de backup/delete: usa supabase/manual/athlete_achievements_paso0.sql en el SQL editor (secciones A/C comentadas). Aquí solo hay SELECT.");
  process.exit(2);
}

const rows = await fetchAllAwards();
const { summary, toDelete } = duplicatePlan(rows);
console.log(JSON.stringify({
  dry_run: true,
  filas_totales: rows.length,
  grupos_duplicados: summary.length,
  filas_a_borrar: toDelete.length,
  resumen: summary,
  filas_a_borrar_detalle: toDelete.map((r) => ({
    id: r.id,
    athlete_id: r.athlete_id,
    achievement_code: r.achievement_code,
    earned_at: r.earned_at || null,
  })),
}, null, 2));
