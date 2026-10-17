/**
 * src/lib/registroComparisonView.js
 * Presentacion de la comparacion por bloque (Registro estilo Garmin).
 * No calcula emparejamiento: solo etiquetas, formato y que pintar.
 */

import { fmtPace } from "./vdot.js";
import { UNGUIDED_MESSAGE } from "./blockComparison.js";

export { UNGUIDED_MESSAGE };

/** Chips con relleno saturado + texto claro: contraste en claro y en oscuro. */
export const KIND_BADGE = {
  warmup: { key: "warmup", text: "CALENTAMIENTO", bg: "#b45309", fg: "#fff", darkBg: "#fdba74", darkFg: "#431407" },
  cooldown: { key: "cooldown", text: "ENFRIAMIENTO", bg: "#334155", fg: "#fff", darkBg: "#94a3b8", darkFg: "#0f172a" },
  recovery: { key: "recovery", text: "RECUPERACIÓN", bg: "#0f766e", fg: "#fff", darkBg: "#2dd4bf", darkFg: "#042f2e" },
  fast: { key: "fast", text: "RÁPIDO", bg: "#9f1239", fg: "#fff", darkBg: "#fb7185", darkFg: "#4c0519" },
  easy: { key: "easy", text: "RODAJE", bg: "#1d4ed8", fg: "#fff", darkBg: "#93c5fd", darkFg: "#1e3a8a" },
};

export function fmtDistM(m) {
  if (m == null || !Number.isFinite(Number(m))) return "—";
  const n = Number(m);
  if (n >= 1000) return `${(n / 1000).toFixed(2)} km`;
  return `${Math.round(n)} m`;
}

export function fmtDurS(s) {
  if (s == null || !Number.isFinite(Number(s)) || Number(s) <= 0) return null;
  return fmtPace(Number(s));
}

function isEasyEndurance(block) {
  if (block?.target_zone === "E") return true;
  const name = String(block?.step_name || "").toLowerCase();
  return /rodaje|easy|largo|long run|tirada|conversational/.test(name);
}

/** Etiqueta de fila para un atleta nuevo: fuerte vs trote vs WU/CD. */
export function kindBadge(block) {
  const kind = block?.kind;
  if (kind === "warmup") return KIND_BADGE.warmup;
  if (kind === "cooldown") return KIND_BADGE.cooldown;
  if (kind === "rest" || kind === "recovery") return KIND_BADGE.recovery;
  if (isEasyEndurance(block)) return KIND_BADGE.easy;
  return KIND_BADGE.fast;
}

/** UI: sin Δ en recuperaciones aunque el objeto traiga delta_s. */
export function showsDelta(block) {
  if (!block || block.kind === "rest" || block.kind === "recovery") return false;
  return block.delta_s != null;
}

export function deltaDisplay(block) {
  if (!showsDelta(block)) return { text: "—", faster: null };
  const d = Number(block.delta_s);
  const faster = d <= 0;
  return { text: `${d <= 0 ? "" : "+"}${Math.round(d)}s`, faster };
}

export function plannedObjectiveText(block) {
  if (!block) return "—";
  const bits = [];
  if (block.planned_pace_s != null) bits.push(`${fmtPace(block.planned_pace_s)}/km`);
  else if (block.has_objective === false) bits.push("sin objetivo");
  if (block.planned_dur_s > 0) {
    const d = fmtDurS(block.planned_dur_s);
    if (d) bits.push(d);
  } else if (block.planned_dist_m > 0) {
    bits.push(fmtDistM(block.planned_dist_m));
  }
  return bits.join(" · ") || "—";
}

export function actualText(block) {
  if (!block || block.no_data) return "—";
  const bits = [];
  const skipPace = block.kind === "rest" || block.kind === "recovery";
  if (!skipPace && block.actual_pace_s != null) bits.push(`${fmtPace(block.actual_pace_s)}/km`);
  const dur = fmtDurS(block.actual_dur_s);
  if (dur) bits.push(dur);
  if (block.actual_dist_m > 0) bits.push(fmtDistM(block.actual_dist_m));
  return bits.join(" · ") || "—";
}

export function summaryText(summary) {
  if (!summary) return "";
  const bits = [];
  if (summary.actual_dist_m > 0) bits.push(fmtDistM(summary.actual_dist_m));
  const dur = fmtDurS(summary.actual_dur_s);
  if (dur) bits.push(dur);
  if (summary.actual_pace_s != null) bits.push(`${fmtPace(summary.actual_pace_s)}/km`);
  if (summary.actual_hr) bits.push(`${summary.actual_hr} lpm`);
  return bits.join(" · ");
}

export function isUnguidedComparison(comparison) {
  return comparison?.mode === "unguided";
}

/** km_splits visibles: unguided, o rodaje/long de una sola fila. */
export function shouldShowKmSplits(comparison) {
  const kms = comparison?.km_splits;
  if (!Array.isArray(kms) || kms.length === 0) return false;
  if (comparison.mode === "unguided") return true;
  return comparison.mode === "matched" && (comparison.blocks || []).length === 1;
}

export function extraLabel(row) {
  if (row?.reason === "glitch") return "Vuelta muy corta";
  return row?.name || "Vuelta extra";
}

export function blockStatusNote(block) {
  if (!block) return null;
  if (block.no_data) return "Sin datos del reloj";
  if (block.incomplete) return "Registro parcial";
  if (block.dur_mismatch) return "Duración distinta al plan";
  return null;
}
