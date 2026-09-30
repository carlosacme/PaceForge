import { test } from "node:test";
import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import { dirname, join } from "node:path";
import { fileURLToPath } from "node:url";
import { expandLibraryRecipe, expandLibraryRecipes } from "./libraryRecipes.js";
import { isRunWorkout } from "./intervals.js";
import { paceRangeForZone, paceToZone, PLAN_CALIBRATION_VDOT } from "./vdot.js";

const recipes = JSON.parse(
  readFileSync(join(dirname(fileURLToPath(import.meta.url)), "../../supabase/seed/library_recipes.json"), "utf8"),
);

test("paceRangeForZone a 47.2 coincide con lo que guardan las semillas", () => {
  assert.equal(paceRangeForZone("E", PLAN_CALIBRATION_VDOT), "5:59-5:27");
  assert.equal(paceRangeForZone("M", PLAN_CALIBRATION_VDOT), "4:46-4:40");
  assert.equal(paceRangeForZone("T", PLAN_CALIBRATION_VDOT), "4:28-4:22");
  assert.equal(paceRangeForZone("I", PLAN_CALIBRATION_VDOT), "4:13-4:07");
  assert.equal(paceRangeForZone("R", PLAN_CALIBRATION_VDOT), "3:46-3:40");
});

test("expande 8x400 a bloques sueltos y ritmos R/E", () => {
  const row = expandLibraryRecipe(recipes.find((r) => r.seed_key === "interval-8x400-r"));
  const work = row.structure.filter((b) => String(b.phase).startsWith("Repetition"));
  const rec = row.structure.filter((b) => b.block_type === "Recuperación");
  assert.equal(work.length, 8);
  assert.equal(rec.length, 7);
  assert.equal(work[0].distance_km, "0.4");
  assert.equal(work[0].target_pace, "3:46-3:40");
  assert.equal(paceToZone(work[0].target_pace, PLAN_CALIBRATION_VDOT), "R");
  assert.equal(paceToZone(rec[0].target_pace, PLAN_CALIBRATION_VDOT), "E");
  assert.equal(row.structure[0].block_type, "Calentamiento");
  assert.equal(row.structure.at(-1).block_type, "Enfriamiento");
  assert.equal(isRunWorkout(row, PLAN_CALIBRATION_VDOT), true);
});

test("largo y tempo llevan ritmos que rescale puede mapear a M/T", () => {
  const longRun = expandLibraryRecipe(recipes.find((r) => r.seed_key === "long-20k-m"));
  const mBlock = longRun.structure.find(
    (b) =>
      String(b.description || "").includes("5 km M") ||
      String(b.phase || "").includes("5 km M") ||
      String(b.block_label || "").includes("5 km M"),
  );
  assert.ok(mBlock);
  assert.equal(paceToZone(mBlock.target_pace, PLAN_CALIBRATION_VDOT), "M");
  assert.ok(longRun.total_km >= 20);

  const tempo = expandLibraryRecipe(recipes.find((r) => r.seed_key === "tempo-20min-t"));
  const tBlock = tempo.structure.find((b) => b.block_type === "Intervalo");
  assert.equal(paceToZone(tBlock.target_pace, PLAN_CALIBRATION_VDOT), "T");
  assert.equal(tempo.duration_min, 45);
});

test("TEST 5K marca is_fitness_test y el all-out va sin ritmo", () => {
  const row = expandLibraryRecipe(recipes.find((r) => r.seed_key === "test-5k"));
  assert.equal(row.is_fitness_test, true);
  const allOut = row.structure.find((b) => /all-out/i.test(String(b.description || b.phase || "")));
  assert.ok(allOut);
  assert.equal(allOut.target_pace, undefined);
  assert.equal(allOut.distance_km, "5");
  assert.equal(isRunWorkout(row, PLAN_CALIBRATION_VDOT), true);
});

test("fortalecimiento es recovery sin ritmos: isRunWorkout=false", () => {
  const row = expandLibraryRecipe(recipes.find((r) => r.seed_key === "strength-gym-a"));
  assert.equal(row.type, "recovery");
  assert.ok(row.structure.length >= 3);
  assert.ok(row.structure.every((b) => !b.target_pace && !b.pace));
  assert.equal(isRunWorkout(row, PLAN_CALIBRATION_VDOT), false);
});

test("expandLibraryRecipes rechaza seed_key duplicada", () => {
  assert.throws(() => expandLibraryRecipes([recipes[0], recipes[0]]), /duplicada/);
});

test("el catálogo compacto tiene 110 seed_key únicos", () => {
  assert.equal(recipes.length, 110);
  const rows = expandLibraryRecipes(recipes);
  assert.equal(rows.length, 110);
  assert.equal(new Set(rows.map((r) => r.seed_key)).size, 110);
});
