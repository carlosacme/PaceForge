import { describe, expect, it, vi } from "vitest";

vi.mock("./lib/supabase", () => ({ supabase: {} }));

import {
  computeAthleteAchievementVisualProgress,
  computeGarminLoadMetricsFromWorkouts,
} from "./components/shared/appShared";

const SUNDAY_2330_BOGOTA = new Date("2026-03-02T04:30:00.000Z");

describe("corte de carga y racha en Bogotá", () => {
  it("el domingo 23:30 Bogotá cuenta en la semana que cierra, no en la siguiente", () => {
    const metrics = computeGarminLoadMetricsFromWorkouts([
      { scheduled_date: "2026-03-01", done: true, total_km: 10, duration_min: 40 },
      { scheduled_date: "2026-03-02", done: true, total_km: 12, duration_min: 50 },
    ], SUNDAY_2330_BOGOTA);
    const current = metrics.weekBarsOldestFirst.find((bar) => bar.key === "2026-02-23");
    const next = metrics.weekBarsOldestFirst.find((bar) => bar.key === "2026-03-02");
    expect(current?.km).toBe(10);
    expect(next).toBeUndefined();
    expect(metrics.acuteKm).toBe(10);
  });

  it("la racha visual mete ese instante en la semana que cierra el domingo", () => {
    const progress = computeAthleteAchievementVisualProgress([
      { scheduled_date: "2026-02-18", done: true, total_km: 5 },
      {
        scheduled_date: "2026-03-01",
        completed_at: "2026-03-02T04:30:00.000Z",
        done: true,
        total_km: 8,
      },
    ], []);
    expect(progress.consecutiveDoneWeeks).toBe(2);
  });
});
