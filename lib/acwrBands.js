/**
 * Bandas ACWR (Acute:Chronic Workload Ratio) de volumen.
 * El ratio lo calcula computeGarminLoadMetricsFromWorkouts; aquí solo el encuadre.
 *
 *  < 0.8        Desentrenado
 *  0.8 – 1.3    Óptimo (seguro)
 *  > 1.3 – 1.5  Precaución
 *  > 1.5        Sobreentrenado (riesgo de sobrecarga)
 */

export const COLOR_GREEN = "#16a34a";
export const COLOR_RED = "#dc2626";
export const COLOR_ORANGE = "#f97316";
export const COLOR_AMBER = "#f59e0b";
export const COLOR_YELLOW = "#eab308";
export const COLOR_GRAY = "#64748b";

export const ACWR_SAFE_MIN = 0.8;
export const ACWR_SAFE_MAX = 1.3;
export const ACWR_CAUTION_MAX = 1.5;

export function acwrBandFromRatio(ratio) {
  if (ratio == null || !Number.isFinite(ratio)) {
    return { key: "none", label: "Sin datos suficientes", color: COLOR_GRAY };
  }
  if (ratio < ACWR_SAFE_MIN) {
    return { key: "low", label: "Desentrenado", color: COLOR_AMBER };
  }
  if (ratio <= ACWR_SAFE_MAX) {
    return { key: "safe", label: "Óptimo", color: COLOR_GREEN };
  }
  if (ratio <= ACWR_CAUTION_MAX) {
    return { key: "caution", label: "Precaución", color: COLOR_YELLOW };
  }
  return { key: "overload", label: "Sobreentrenado", color: COLOR_RED };
}

/** Posición 0–100 del marcador en una escala 0–2. */
export function acwrGaugePercent(ratio) {
  if (ratio == null || !Number.isFinite(ratio)) return null;
  return Math.min(100, Math.max(0, (ratio / 2) * 100));
}
