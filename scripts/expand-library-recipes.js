#!/usr/bin/env node
/**
 * Expande supabase/seed/library_recipes.json al SQL de siembra idempotente.
 * Usa vdot.js a PLAN_CALIBRATION_VDOT para que los ritmos coincidan con la app.
 *
 *   node scripts/expand-library-recipes.js
 *   node scripts/expand-library-recipes.js --stdout
 */
import { readFileSync, writeFileSync } from "node:fs";
import { dirname, join } from "node:path";
import { fileURLToPath } from "node:url";
import { expandLibraryRecipes } from "../src/lib/libraryRecipes.js";

const ROOT = join(dirname(fileURLToPath(import.meta.url)), "..");
const RECIPES_PATH = join(ROOT, "supabase/seed/library_recipes.json");
const OUT_PATH = join(ROOT, "supabase/seed/library_catalog.sql");
const ADMIN_ID = "b5c9e44a-6695-4800-99bd-f19b05d2f66f";

const sqlLiteral = (value) => {
  if (value == null) return "NULL";
  if (typeof value === "boolean") return value ? "TRUE" : "FALSE";
  if (typeof value === "number") return String(value);
  return `'${String(value).replace(/'/g, "''")}'`;
};

const jsonLiteral = (value) => `'${JSON.stringify(value).replace(/'/g, "''")}'::jsonb`;

const recipes = JSON.parse(readFileSync(RECIPES_PATH, "utf8"));
const rows = expandLibraryRecipes(recipes);

const values = rows.map((row) => `(
    ${sqlLiteral(ADMIN_ID)},
    ${sqlLiteral(row.title)},
    ${sqlLiteral(row.type)},
    ${sqlLiteral(row.workout_type)},
    ${sqlLiteral(row.total_km)},
    ${sqlLiteral(row.distance_km)},
    ${sqlLiteral(row.duration_min)},
    ${sqlLiteral(row.description)},
    ${jsonLiteral(row.structure)},
    ${sqlLiteral(row.is_fitness_test)},
    TRUE,
    ${sqlLiteral(row.category)},
    ${sqlLiteral(row.seed_key)}
  )`);

const sql = `-- Semillas de catálogo público (idempotente por seed_key).
-- Generado por scripts/expand-library-recipes.js — no editar a mano.
-- Ritmos escritos a VDOT 47.2 vía src/lib/vdot.js.

INSERT INTO public.workout_library (
  coach_id, title, type, workout_type, total_km, distance_km, duration_min,
  description, structure, is_fitness_test, is_system, category, seed_key
) VALUES
  ${values.join(",\n  ")}
ON CONFLICT (seed_key) DO UPDATE SET
  title = EXCLUDED.title,
  type = EXCLUDED.type,
  workout_type = EXCLUDED.workout_type,
  total_km = EXCLUDED.total_km,
  distance_km = EXCLUDED.distance_km,
  duration_min = EXCLUDED.duration_min,
  description = EXCLUDED.description,
  structure = EXCLUDED.structure,
  is_fitness_test = EXCLUDED.is_fitness_test,
  is_system = TRUE,
  category = EXCLUDED.category;
`;

if (process.argv.includes("--stdout")) {
  process.stdout.write(sql);
} else {
  writeFileSync(OUT_PATH, sql);
  console.log(`Wrote ${rows.length} seeds → ${OUT_PATH}`);
}
