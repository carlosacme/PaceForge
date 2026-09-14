/**
 * Simula el dry-run del caso Julio (mañana del 11 mirando el 10) sin tocar
 * prod: ICU responde [] → would_notify_miss.
 */
import { test } from "node:test";
import assert from "node:assert/strict";
import { runWatchSyncBackfill } from "./watchSyncBackfill.js";

function fakeSupabase({ workouts, connections, athletes }) {
  return {
    from(table) {
      const state = { table, filters: [], inFilter: null };
      const api = {
        select() { return api; },
        eq(col, val) { state.filters.push({ col, val, op: "eq" }); return api; },
        not(col, op, val) {
          state.filters.push({ col, op: `not.${op}`, val });
          return api;
        },
        in(col, vals) { state.inFilter = { col, vals }; return api; },
        order() { return api; },
        then(resolve, reject) {
          try {
            let rows = [];
            if (state.table === "workouts") rows = [...workouts];
            if (state.table === "device_connections") rows = [...connections];
            if (state.table === "athletes") rows = [...athletes];
            for (const f of state.filters) {
              if (f.op === "eq") rows = rows.filter((r) => r[f.col] === f.val);
              if (f.op === "not.is" && f.val === true) {
                rows = rows.filter((r) => r[f.col] !== true);
              }
            }
            if (state.inFilter) {
              const set = new Set(state.inFilter.vals.map(String));
              rows = rows.filter((r) => set.has(String(r[state.inFilter.col])));
            }
            resolve({ data: rows, error: null });
          } catch (e) {
            reject(e);
          }
        },
      };
      return api;
    },
  };
}

test("dry-run caso Julio: as_of 2026-09-11, ICU vacío → would_notify_miss", async (t) => {
  const prevFetch = globalThis.fetch;
  t.after(() => { globalThis.fetch = prevFetch; });
  globalThis.fetch = async (url) => {
    if (String(url).includes("/activities")) {
      return { ok: true, status: 200, async text() { return "[]"; } };
    }
    throw new Error(`unexpected fetch ${url}`);
  };

  const supabase = fakeSupabase({
    workouts: [{
      id: 1124,
      athlete_id: 85,
      title: "S03 Jue - Rodaje E",
      type: "easy",
      structure: [{ phase: "Run", duration: "30 min", pace: "5:30-6:00" }],
      total_km: 6,
      duration_min: 30,
      done: false,
      watch_sync_miss_notified_at: null,
      scheduled_date: "2026-09-10",
    }],
    connections: [{
      id: 13,
      athlete_id: 85,
      provider: "intervals_icu",
      status: "active",
      auth_type: "oauth",
      access_token: "test-token",
      provider_athlete_id: "i666720",
    }],
    athletes: [{
      id: 85,
      name: "Julio Santana",
      coach_id: "coach-uuid",
      user_id: "athlete-uuid",
    }],
  });

  const result = await runWatchSyncBackfill({
    supabase,
    todayYmd: "2026-09-11",
    dry: true,
  });

  assert.equal(result.yesterday, "2026-09-10");
  assert.equal(result.candidates, 1);
  assert.equal(result.icuCalls, 1);
  assert.equal(result.marked, 0);
  assert.equal(result.notified, 1);
  assert.equal(result.preview.length, 1);
  assert.equal(result.preview[0].action, "would_notify_miss");
  assert.equal(result.preview[0].athleteName, "Julio Santana");
  assert.equal(result.preview[0].workoutId, 1124);
  assert.equal(result.preview[0].title, "S03 Jue - Rodaje E");
});

test("dry-run caso Julio YA sincronizado: done=true → 0 candidatos", async () => {
  const supabase = fakeSupabase({
    workouts: [{
      id: 1124,
      athlete_id: 85,
      title: "S03 Jue - Rodaje E",
      type: "easy",
      structure: [{ phase: "Run", duration: "30 min", pace: "5:30-6:00" }],
      done: true,
      watch_sync_miss_notified_at: null,
      scheduled_date: "2026-09-10",
    }],
    connections: [],
    athletes: [],
  });

  const result = await runWatchSyncBackfill({
    supabase,
    todayYmd: "2026-09-11",
    dry: true,
  });

  assert.equal(result.candidates, 0);
  assert.equal(result.icuCalls, 0);
  assert.equal(result.preview.length, 0);
});
