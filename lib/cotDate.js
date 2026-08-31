/**
 * Fechas de calendario en Colombia (UTC-5, sin DST) y aritmética YYYY-MM-DD
 * en UTC para que el cron de Vercel (UTC) y el cliente coincidan.
 */

export const COT_OFFSET_MS = 5 * 60 * 60 * 1000;

export function colombiaTodayYmd(now = new Date()) {
  return new Date(now.getTime() - COT_OFFSET_MS).toISOString().slice(0, 10);
}

export function parseYmdUtc(ymd) {
  const m = String(ymd || "").match(/^(\d{4})-(\d{2})-(\d{2})$/);
  if (!m) return null;
  return new Date(Date.UTC(Number(m[1]), Number(m[2]) - 1, Number(m[3])));
}

export function formatYmdUtc(d) {
  return d.toISOString().slice(0, 10);
}

export function addDaysYmd(ymd, n) {
  const d = parseYmdUtc(ymd);
  if (!d) return "";
  d.setUTCDate(d.getUTCDate() + n);
  return formatYmdUtc(d);
}

/** Lunes de la semana lun–dom que contiene `ymd`. */
export function startOfWeekMondayYmd(ymd) {
  const d = parseYmdUtc(ymd);
  if (!d) return "";
  const dow = d.getUTCDay();
  const offset = dow === 0 ? -6 : 1 - dow;
  d.setUTCDate(d.getUTCDate() + offset);
  return formatYmdUtc(d);
}

/** 00:00 Colombia del día `ymd`, en ISO UTC. */
export function colombiaMidnightIso(ymd) {
  const d = parseYmdUtc(ymd);
  if (!d) return null;
  return new Date(d.getTime() + COT_OFFSET_MS).toISOString();
}
