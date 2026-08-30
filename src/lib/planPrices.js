/**
 * Catálogo de precios de suscripción (COP).
 *
 * Fuente única para el frontend (PlanPicker, AthleteHome) y
 * api/wompi-create-checkout.js. El patrón ya existe: analyze-workout
 * importa src/lib/workoutStructure.js desde /api.
 *
 * Marketplace NO va aquí: el monto sale de plan_marketplace.price_cop.
 *
 * Coach: mensual = base; semestral −12% (×6); anual −20% (×12).
 * Períodos del body de checkout: mensual|semestral|anual (no "monthly").
 */

export const MIN_CHECKOUT_COP = 5000;

export const COACH_LIST_COP = Object.freeze({
  basico: Object.freeze({ mensual: 100000, semestral: 528000, anual: 960000 }),
  pro: Object.freeze({ mensual: 160000, semestral: 844800, anual: 1536000 }),
});

export const ATHLETE_SOLO_COP = Object.freeze({
  monthly: 25000,
  annual: 250000,
});

export function normalizeCoachPeriod(planPeriod) {
  const p = String(planPeriod || "").toLowerCase().trim();
  if (p === "monthly" || p === "mensual") return "mensual";
  if (p === "semestral") return "semestral";
  if (p === "anual" || p === "annual" || p === "yearly") return "anual";
  return null;
}

export function normalizeAthletePeriod(planPeriod) {
  const p = String(planPeriod || "").toLowerCase().trim();
  if (p === "monthly" || p === "mensual") return "monthly";
  if (p === "annual" || p === "anual" || p === "yearly") return "annual";
  return null;
}

export function coachListCop(planKey, planPeriod) {
  const key = String(planKey || "").toLowerCase().trim();
  const period = normalizeCoachPeriod(planPeriod);
  if (!period || !COACH_LIST_COP[key]) return null;
  const n = COACH_LIST_COP[key][period];
  return Number.isFinite(n) ? n : null;
}

export function athleteListCop(planKey, planPeriod) {
  if (String(planKey || "").toLowerCase().trim() !== "premium") return null;
  const period = normalizeAthletePeriod(planPeriod);
  if (!period) return null;
  const n = ATHLETE_SOLO_COP[period];
  return Number.isFinite(n) ? n : null;
}

/** Precio de lista. null si el combo no es de catálogo (p. ej. marketplace). */
export function resolveListAmountCop(payerType, planKey, planPeriod) {
  if (payerType === "coach_subscription") return coachListCop(planKey, planPeriod);
  if (payerType === "athlete_solo_subscription") return athleteListCop(planKey, planPeriod);
  return null;
}

/** Misma fórmula que PlanPicker: round(lista × (100 − %) / 100). */
export function applyPromoPercent(listCop, discountPercent) {
  const list = Number(listCop);
  const pct = Number(discountPercent);
  if (!Number.isFinite(list) || !Number.isFinite(pct) || pct < 0 || pct > 100) return null;
  return Math.max(0, Math.round((list * (100 - pct)) / 100));
}
