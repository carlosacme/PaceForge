import { test } from "node:test";
import assert from "node:assert/strict";
import {
  pickBestActivity,
  activityRaw,
  activityDate,
  localDateStr,
  mapActivityToActual,
  completeFromNormalizedActivity,
} from "./icuAutoComplete.js";
import { watchSyncYesterday, watchSyncMissCopy } from "./watchSyncBackfill.js";

test("pickBestActivity prefiere Run con mas distancia", () => {
  const best = pickBestActivity([
    { id: 1, type: "Ride", distance: 40000 },
    { id: 2, type: "Run", distance: 5000 },
    { id: 3, type: "Run", distance: 6000 },
  ]);
  assert.equal(best.id, 3);
});

test("pickBestActivity cae al pool entero si no hay Run", () => {
  const best = pickBestActivity([
    { id: 1, type: "Ride", distance: 10 },
    { id: 2, type: "Walk", distance: 99 },
  ]);
  assert.equal(best.id, 2);
});

test("activityRaw y umbral de muy corta (300s / 500m)", () => {
  const short = activityRaw({ moving_time: 47, distance: 80 });
  assert.equal(short.movS < 300 || short.distM < 500, true);
  const ok = activityRaw({ moving_time: 1800, distance: 5990 });
  assert.equal(ok.movS < 300 || ok.distM < 500, false);
});

test("activityDate corta start_date_local", () => {
  assert.equal(activityDate({ start_date_local: "2026-09-10T06:12:00" }), "2026-09-10");
  assert.equal(activityDate({ start_date: "2026-09-10T11:12:00Z" }), "2026-09-10");
});

test("localDateStr UTC-5 no usa UTC crudo", () => {
  // 2026-09-11 01:00 UTC = 2026-09-10 20:00 Colombia
  const d = Date.parse("2026-09-11T01:00:00Z");
  assert.equal(localDateStr(-5, d), "2026-09-10");
});

test("mapActivityToActual convierte metros y segundos", () => {
  const actual = mapActivityToActual({
    id: "i185604713",
    distance: 5990,
    moving_time: 1920,
    average_speed: 5990 / 1920,
    average_heartrate: 140,
    max_heartrate: 160,
    total_elevation_gain: 12.4,
  });
  assert.equal(actual.actual_distance_km, 5.99);
  assert.equal(actual.actual_duration_min, 32);
  assert.equal(actual.intervals_activity_id, "i185604713");
  assert.equal(actual.actual_avg_hr, 140);
  assert.equal(actual.actual_elevation_m, 12);
});

test("watchSyncYesterday: as_of es 'hoy', el candidato es el dia anterior", () => {
  // Caso Julio: cron de la mañana del 11 mira el entreno del 10.
  assert.equal(watchSyncYesterday("2026-09-11"), "2026-09-10");
  assert.equal(watchSyncYesterday("2026-09-10"), "2026-09-09");
});

test("copy del aviso miss", () => {
  const c = watchSyncMissCopy("Julio Santana", "S03 Jue - Rodaje E");
  assert.equal(c.title, "⌚ Sin datos de reloj");
  assert.equal(c.body, "Julio Santana — S03 Jue - Rodaje E");
});

const GOLDEN_ACT = {
  id: "i185604713",
  start_date_local: "2026-09-10T06:12:00",
  moving_time: 1920,
  distance: 5990,
};

test("golden: actividad corta (<300 s o <500 m) no completa el entreno", async () => {
  let patched = 0;
  let notified = 0;
  const r = await completeFromNormalizedActivity({
    athleteId: 1,
    activity: { id: "i-short", start_date_local: "2026-09-10T06:00:00", moving_time: 47, distance: 80 },
    fetchDup: async () => null,
    fetchPending: async () => ({ id: 99 }),
    patchWorkout: async () => { patched += 1; },
    notifyCoach: async () => { notified += 1; return { sent: true }; },
  });
  assert.equal(r.discarded, true);
  assert.match(r.reason, /muy corta/);
  assert.equal(patched, 0);
  assert.equal(notified, 0);
});

test("golden: duplicado por intervals_activity_id no reescribe ni notifica dos veces", async () => {
  let patched = 0;
  let notified = 0;
  const r = await completeFromNormalizedActivity({
    athleteId: 1,
    activity: GOLDEN_ACT,
    fetchDup: async (id) => (id === GOLDEN_ACT.id ? { id: 77 } : null),
    fetchPending: async () => ({ id: 88 }),
    patchWorkout: async () => { patched += 1; },
    notifyCoach: async () => { notified += 1; return { sent: true }; },
  });
  assert.equal(r.reason, "ya procesada");
  assert.equal(r.rewritten, false);
  assert.equal(r.notified, false);
  assert.equal(r.workout_id, 77);
  assert.equal(patched, 0);
  assert.equal(notified, 0);
});

test("golden: sin entreno pendiente no crea nada", async () => {
  let patched = 0;
  let created = 0;
  const r = await completeFromNormalizedActivity({
    athleteId: 1,
    activity: GOLDEN_ACT,
    fetchDup: async () => null,
    fetchPending: async () => null,
    patchWorkout: async () => { patched += 1; created += 1; },
    notifyCoach: async () => ({ sent: true }),
  });
  assert.equal(r.created, false);
  assert.match(r.reason, /sin workout planeado pendiente/);
  assert.equal(patched, 0);
  assert.equal(created, 0);
});
