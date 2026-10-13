import { test } from "node:test";
import assert from "node:assert/strict";
import {
  alreadyHasRule,
  earnedCodesFromRows,
  formatAchievementDate,
  isAlreadyOwnedAward,
  parseAchievementYmd,
  pickAchievedOnForCodes,
  proposeNewAthleteAwards,
  recordAwardPostResult,
  reconstructAchievedOn,
} from "./athleteAchievements.js";

const w = (id, scheduled_date, extra = {}) => ({
  id,
  scheduled_date,
  done: extra.done !== false,
  total_km: extra.total_km ?? 0,
  type: extra.type || "easy",
  completed_at: extra.completed_at,
  manual_avg_hr: extra.manual_avg_hr,
});

test("parseAchievementYmd corta YYYY-MM-DD", () => {
  assert.equal(parseAchievementYmd("2026-10-12"), "2026-10-12");
  assert.equal(parseAchievementYmd("2026-10-12T15:00:00Z"), "2026-10-12");
  assert.equal(parseAchievementYmd(""), "");
});

test("formatAchievementDate no se corre un día por UTC", () => {
  assert.equal(formatAchievementDate("2026-10-12"), "12 oct 2026");
  assert.equal(formatAchievementDate("2026-01-01"), "1 ene 2026");
  assert.equal(formatAchievementDate(null), "Sin fecha registrada");
  assert.equal(formatAchievementDate("2026-10-12T00:00:00.000Z"), "12 oct 2026");
});

test("isAlreadyOwnedAward: 409 y unique no son error visible", () => {
  assert.equal(isAlreadyOwnedAward(409, { error: "already_awarded", code: "23505" }), true);
  assert.equal(isAlreadyOwnedAward(200, { data: [{ id: 1 }] }), false);
  assert.equal(isAlreadyOwnedAward(500, { error: "boom" }), false);
  assert.equal(isAlreadyOwnedAward(400, {
    data: { code: "23505", message: "duplicate key value violates unique constraint" },
  }), true);
});

test("recordAwardPostResult: 409 no entra a newAwards (sin toast)", () => {
  const newAwards = [];
  const proposal = { code: "KM_10", achieved_on: "2026-10-12" };
  const dup = recordAwardPostResult(newAwards, proposal, 409, { error: "already_awarded", code: "23505" });
  assert.equal(dup.toast, false);
  assert.equal(dup.reason, "already_owned");
  assert.equal(newAwards.length, 0);

  const err = recordAwardPostResult(newAwards, proposal, 500, { error: "fail" });
  assert.equal(err.toast, false);
  assert.equal(newAwards.length, 0);

  const ok = recordAwardPostResult(newAwards, proposal, 200, { data: [{ id: 9 }] });
  assert.equal(ok.toast, true);
  assert.equal(newAwards.length, 1);
  assert.equal(newAwards[0].code, "KM_10");
});

test("KM_10 usa la fecha del workout que cruzó 10 km, no now()", () => {
  const workouts = [
    w(1, "2026-10-01", { total_km: 4 }),
    w(2, "2026-10-12", { total_km: 7 }),
    w(3, "2026-10-13", { total_km: 5 }),
  ];
  const rec = reconstructAchievedOn("KM_10", { workouts });
  assert.equal(rec.achieved_on, "2026-10-12");
  assert.equal(rec.source_workout_id, 2);
  assert.equal(rec.unreconstructable, false);
});

test("FIRST_WORKOUT = primer done por scheduled_date", () => {
  const rec = reconstructAchievedOn("FIRST_WORKOUT", {
    workouts: [w(9, "2026-09-20", { total_km: 5 }), w(1, "2026-09-18", { total_km: 3 })],
  });
  assert.equal(rec.achieved_on, "2026-09-18");
  assert.equal(rec.source_workout_id, 1);
});

test("SPEED_DEMON = primer interval", () => {
  const rec = reconstructAchievedOn("SPEED_DEMON", {
    workouts: [
      w(1, "2026-10-01", { type: "easy" }),
      w(2, "2026-10-03", { type: "Interval" }),
    ],
  });
  assert.equal(rec.achieved_on, "2026-10-03");
  assert.equal(rec.source_workout_id, 2);
});

test("STREAK_3 = tercer día consecutivo", () => {
  const rec = reconstructAchievedOn("STREAK_3", {
    workouts: [
      w(1, "2026-10-01"),
      w(2, "2026-10-02"),
      w(3, "2026-10-04"),
      w(4, "2026-10-05"),
      w(5, "2026-10-06"),
    ],
  });
  assert.equal(rec.achieved_on, "2026-10-06");
});

test("WEEK_COMPLETE_1 = último scheduled_date de la primera semana llena", () => {
  const rec = reconstructAchievedOn("WEEK_COMPLETE_1", {
    workouts: [
      w(1, "2026-10-06"), // lun
      w(2, "2026-10-08"), // mié
      w(3, "2026-10-13", { done: false }),
    ],
  });
  assert.equal(rec.achieved_on, "2026-10-08");
  assert.equal(rec.source_workout_id, 2);
});

test("CONSISTENT = último workout de la 4ª semana consecutiva con done", () => {
  const rec = reconstructAchievedOn("CONSISTENT", {
    workouts: [
      w(1, "2026-09-14"),
      w(2, "2026-09-21"),
      w(3, "2026-09-28"),
      w(4, "2026-10-07"),
    ],
  });
  assert.equal(rec.achieved_on, "2026-10-07");
  assert.equal(rec.source_workout_id, 4);
});

test("NO_EXCUSES_10 se resetea con un no-done", () => {
  const rows = [];
  for (let i = 1; i <= 9; i += 1) rows.push(w(i, `2026-10-${String(i).padStart(2, "0")}`));
  rows.push(w(10, "2026-10-10", { done: false }));
  for (let i = 11; i <= 20; i += 1) rows.push(w(i, `2026-10-${i}`));
  const rec = reconstructAchievedOn("NO_EXCUSES_10", { workouts: rows, todayYmd: "2026-10-31" });
  assert.equal(rec.achieved_on, "2026-10-20");
  assert.equal(rec.source_workout_id, 20);
});

test("EARLY_BIRD no inventa fecha", () => {
  const rec = reconstructAchievedOn("EARLY_BIRD", {
    workouts: Array.from({ length: 5 }, (_, i) => w(i + 1, `2026-10-0${i + 1}`, {
      completed_at: "2026-10-01T06:15:00-05:00",
    })),
  });
  assert.equal(rec.unreconstructable, true);
  assert.equal(rec.achieved_on, null);
});

test("VDOT_UP_2 usa el día Colombia de la 2ª mejora", () => {
  const rec = reconstructAchievedOn("VDOT_UP_2", {
    evaluations: [
      { vdot: 40, created_at: "2026-08-01T15:00:00Z" },
      { vdot: 41, created_at: "2026-08-15T15:00:00Z" },
      { vdot: 43, created_at: "2026-09-01T04:30:00Z" }, // 23:30 Colombia 31 ago
    ],
  });
  assert.equal(rec.achieved_on, "2026-08-31");
});

test("proposeNewAthleteAwards no reinserta códigos ni aliases ya ganados", () => {
  const workouts = [
    w(1, "2026-10-01", { total_km: 12, type: "interval" }),
    w(2, "2026-10-02", { total_km: 5 }),
    w(3, "2026-10-03", { total_km: 5 }),
  ];
  const again = proposeNewAthleteAwards({
    workouts,
    earnedCodes: new Set(["FIRST_KM", "KM_10", "SPEED_DEMON", "STREAK_7"]),
    todayYmd: "2026-10-13",
  });
  assert.equal(again.some((p) => p.code === "FIRST_WORKOUT"), false);
  assert.equal(again.some((p) => p.code === "KM_10"), false);
  assert.equal(again.some((p) => p.code === "SPEED_DEMON"), false);
  assert.equal(again.some((p) => p.code === "STREAK_3"), false);
});

test("propose emite KM_10 con achieved_on del cruce", () => {
  const proposals = proposeNewAthleteAwards({
    workouts: [w(1, "2026-10-12", { total_km: 11 })],
    earnedCodes: new Set(),
    todayYmd: "2026-10-13",
    value: 11,
  });
  const km = proposals.find((p) => p.code === "KM_10");
  assert.equal(km.achieved_on, "2026-10-12");
  assert.equal(km.source_workout_id, 1);
  const first = proposals.find((p) => p.code === "FIRST_WORKOUT");
  assert.equal(first.achieved_on, "2026-10-12");
});

test("pickAchievedOnForCodes ignora awarded_at/earned_at y elige min id", () => {
  const ymd = pickAchievedOnForCodes([
    { id: 80, achievement_code: "KM_10", awarded_at: "2020-01-01", earned_at: "2020-01-01", achieved_on: "2026-10-12" },
    { id: 9, achievement_code: "KM_10", achieved_on: "2026-09-01" },
  ], ["KM_10"]);
  assert.equal(ymd, "2026-09-01");
  assert.equal(pickAchievedOnForCodes([{ achievement_code: "KM_10", earned_at: "2026-10-12" }], ["KM_10"]), "");
});

test("alreadyHasRule usa aliases", () => {
  assert.equal(alreadyHasRule(new Set(["FIRST_KM"]), { code: "FIRST_WORKOUT", aliases: ["FIRST_KM"] }), true);
  assert.equal(alreadyHasRule(earnedCodesFromRows([{ achievement_code: "KM_50" }]), { code: "KM_10", aliases: [] }), false);
});
