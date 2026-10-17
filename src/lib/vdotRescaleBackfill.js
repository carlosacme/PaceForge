/**
 * Candidatos a backfill de rescale idempotente.
 * Nunca escribe. El apply vive detrás de un flag muerto.
 */
import { athleteVisibleWorkoutDescription, rescaleStructureToVdot } from "./enrichPace.js";

export function todayYmdColombia(base = Date.now()) {
  return new Date(base - 5 * 3600000).toISOString().slice(0, 10);
}

export function classifyBackfillRow(w, todayYmd) {
  const origen = Number(w?.generated_with_vdot);
  if (!Number.isFinite(origen) || origen <= 0) return "sin_origen";
  if (w?.done === true) return "hecho";
  const ymd = String(w?.scheduled_date || "").slice(0, 10);
  if (!ymd || ymd < todayYmd) return "fecha_pasada";
  const structure = Array.isArray(w?.structure) ? w.structure : [];
  if (!structure.length) return "sin_structure";
  return "candidato";
}

function stepPace(step) {
  return String(step?.target_pace ?? step?.pace ?? "").trim();
}

export function previewWorkoutRescale(w, todayYmd) {
  const reason = classifyBackfillRow(w, todayYmd);
  const base = {
    id: w?.id ?? null,
    title: w?.title ?? "",
    scheduled_date: w?.scheduled_date ?? null,
    generated_with_vdot: w?.generated_with_vdot ?? null,
    done: w?.done === true,
    reason,
  };
  if (reason !== "candidato") return base;
  const origen = Number(w.generated_with_vdot);
  const before = Array.isArray(w.structure) ? w.structure : [];
  const after = rescaleStructureToVdot(before, origen, origen);
  const steps = before.map((s, i) => ({
    i,
    block_type: s?.block_type || s?.phase || "",
    zone_before: s?.target_zone || s?.zone || null,
    pace_before: stepPace(s),
    pace_after: stepPace(after[i] || {}),
    zone_after: after[i]?.target_zone || after[i]?.zone || null,
  }));
  return {
    ...base,
    description_has_km: /\d{1,2}:[0-5]\d.*\/\s*km/i.test(String(w.description || "")),
    description_visible: athleteVisibleWorkoutDescription(w.title, w.description || ""),
    steps,
    changed: JSON.stringify(before.map(stepPace)) !== JSON.stringify(after.map(stepPace)),
  };
}

export function previewBackfill(rows, todayYmd) {
  const list = Array.isArray(rows) ? rows : [];
  const previews = list.map((w) => previewWorkoutRescale(w, todayYmd));
  const skipped = { sin_origen: 0, hecho: 0, fecha_pasada: 0, sin_structure: 0 };
  const candidates = [];
  for (const p of previews) {
    if (p.reason === "candidato") candidates.push(p);
    else if (skipped[p.reason] != null) skipped[p.reason] += 1;
  }
  return {
    today: todayYmd,
    execute: false,
    skipped,
    candidates,
  };
}
