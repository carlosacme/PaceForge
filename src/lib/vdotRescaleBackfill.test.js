import { test } from "node:test";
import assert from "node:assert/strict";
import { spawnSync } from "node:child_process";
import { previewBackfill } from "./vdotRescaleBackfill.js";

test("dry-run: hechos, fecha pasada y sin origen no salen; pendiente sí", () => {
  const today = "2026-10-17";
  const rows = [
    {
      id: 1,
      title: "Hecho",
      scheduled_date: "2026-10-20",
      done: true,
      generated_with_vdot: 41.3,
      structure: [{ target_pace: "6:38-6:03", description: "E pace" }],
    },
    {
      id: 2,
      title: "Pasado",
      scheduled_date: "2026-10-01",
      done: false,
      generated_with_vdot: 41.3,
      structure: [{ target_pace: "6:38-6:03", description: "E pace" }],
    },
    {
      id: 3,
      title: "Sin origen",
      scheduled_date: "2026-10-20",
      done: false,
      generated_with_vdot: null,
      structure: [{ target_pace: "5:38-6:08" }],
    },
    {
      id: 4,
      title: "Pendiente Long Progresivo",
      scheduled_date: "2026-10-20",
      done: false,
      generated_with_vdot: 41.3,
      description: "50' E pace @ 5:38-6:08/km",
      structure: [
        { description: "50' E pace", target_pace: "6:38-6:03" },
        { description: "10' M pace", target_pace: "5:18-5:12" },
      ],
    },
  ];
  const report = previewBackfill(rows, today);
  assert.equal(report.execute, false);
  assert.equal(report.skipped.hecho, 1);
  assert.equal(report.skipped.fecha_pasada, 1);
  assert.equal(report.skipped.sin_origen, 1);
  assert.equal(report.candidates.length, 1);
  assert.equal(report.candidates[0].id, 4);
  assert.equal(report.candidates[0].steps[0].zone_after, "E");
  assert.equal(report.candidates[0].steps[1].zone_after, "M");
});

test("--execute está muerto", () => {
  const r = spawnSync(process.execPath, ["scripts/vdot-rescale-backfill.mjs", "--execute"], {
    encoding: "utf8",
  });
  assert.notEqual(r.status, 0);
  assert.match(r.stderr, /muerto|aprobaci/i);
});
