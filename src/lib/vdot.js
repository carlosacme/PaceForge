/**
 * src/lib/vdot.js
 * -----------------------------------------------------------
 * FUENTE UNICA DE VERDAD para ritmos de entrenamiento.
 * Formulas de Daniels & Gilbert, calibradas contra las tablas
 * oficiales del "Daniels' Running Formula".
 *
 * Usar desde el frontend (evaluacion, UI) y desde api/ (serverless).
 * NO duplicar porcentajes ni ritmos en ningun otro archivo.
 *
 * Validado: VDOT 42.5 -> E 6:30-5:55 | M 5:03 | T 4:45 | I 4:23 | R 4:03
 * -----------------------------------------------------------
 */

// VO2 consumido a velocidad v (m/min) — Daniels & Gilbert
const vo2AtVelocity = (v) => -4.60 + 0.182258 * v + 0.000104 * v * v;

// Inversa: velocidad (m/min) para un VO2 objetivo
function velocityAtVO2(vo2) {
  const a = 0.000104, b = 0.182258, c = -4.60 - vo2;
  return (-b + Math.sqrt(b * b - 4 * a * c)) / (2 * a);
}

const secsPerKm = (v) => 60000 / v;

/**
 * %VO2max por zona, calibrados contra las tablas de Daniels.
 * OJO: los valores anteriores de la app (0.65/0.76/0.84/0.95/1.00)
 * producian ritmos hasta 19 s/km mas lentos de lo correcto.
 */
export const ZONE_PCT = {
  E_slow: 0.6094,
  E_fast: 0.6865,
  E_mid:  0.6480,  // punto medio del rango facil (para UI de valor unico)
  M:      0.8369,  // antes 0.76  -> daba ~19 s/km de mas
  T:      0.9030,  // antes 0.84  -> daba ~14 s/km de mas
  I:      0.9975,  // antes 0.95  -> daba ~8 s/km de mas
  R:      1.0998,  // antes 1.00  -> daba ~16 s/km de mas (R casi pegado a I)
};

/** Etiquetas en español para la UI */
export const ZONE_LABELS = {
  E:  "Easy",
  M:  "Maratón",
  HM: "Medio maratón",
  T:  "Umbral",
  T10:"Ritmo 10K",
  I:  "Intervalos",
  R:  "Repeticiones",
};

export const ZONE_COLORS = {
  E:  "#22c55e",
  M:  "#3b82f6",
  HM: "#0ea5e9",
  T:  "#f59e0b",
  T10:"#fb923c",
  I:  "#ef4444",
  R:  "#8b5cf6",
};

/**
 * Ritmos en SEGUNDOS por km para un VDOT dado.
 * E devuelve [lento, rapido]; el resto, valor unico.
 */
export function pacesForVdot(vdot) {
  const v = Number(vdot);
  if (!Number.isFinite(v) || v <= 0) return null;

  const p = {};
  for (const [k, pct] of Object.entries(ZONE_PCT)) {
    p[k] = secsPerKm(velocityAtVO2(v * pct));
  }

  return {
    E:   [p.E_slow, p.E_fast],
    M:   p.M,
    HM:  (p.M + p.T) / 2,          // medio maraton: entre M y T
    T:   p.T,
    T10: p.T * 0.65 + p.I * 0.35,  // 10K: entre T e I
    I:   p.I,
    R:   p.R,
  };
}

/** segundos -> "m:ss" (con acarreo correcto: 359.7 -> "6:00", no "5:60") */
export function fmtPace(secs) {
  const total = Math.round(secs);
  const m = Math.floor(total / 60);
  const s = total % 60;
  return `${m}:${String(s).padStart(2, "0")}`;
}

/** minutos decimales -> "m:ss"  (compat con paceMinKm del jsonb viejo) */
export function fmtDecimalMin(min) {
  return fmtPace(min * 60);
}

/**
 * Rango de ritmo listo para Garmin: "4:26-4:20".
 * Garmin exige RANGO; un valor unico no se traduce a objetivo.
 */
export function paceRangeFor(zone, vdot, tolerance = 3) {
  const p = pacesForVdot(vdot);
  if (!p) return null;
  const v = p[zone];
  if (v === undefined) return null;
  if (Array.isArray(v)) return `${fmtPace(v[0])}-${fmtPace(v[1])}`;
  return `${fmtPace(v + tolerance)}-${fmtPace(v - tolerance)}`;
}

/**
 * Estructura para la UI de evaluacion.
 * Reemplaza el array 'paces' que se guardaba con fracs incorrectos.
 */
export function paceZonesForUi(vdot) {
  const p = pacesForVdot(vdot);
  if (!p) return [];
  return [
    { key: "E",  zone: "E",  label: ZONE_LABELS.E,   color: ZONE_COLORS.E,
      pace: `${fmtPace(p.E[0])}-${fmtPace(p.E[1])}`, secsPerKm: p.E },
    { key: "M",  zone: "M",  label: ZONE_LABELS.M,   color: ZONE_COLORS.M,
      pace: fmtPace(p.M),   secsPerKm: p.M },
    { key: "T",  zone: "T",  label: ZONE_LABELS.T,   color: ZONE_COLORS.T,
      pace: fmtPace(p.T),   secsPerKm: p.T },
    { key: "I",  zone: "I",  label: ZONE_LABELS.I,   color: ZONE_COLORS.I,
      pace: fmtPace(p.I),   secsPerKm: p.I },
    { key: "R",  zone: "R",  label: ZONE_LABELS.R,   color: ZONE_COLORS.R,
      pace: fmtPace(p.R),   secsPerKm: p.R },
  ];
}

/**
 * Compat con la UI existente de EvaluationView.
 * Devuelve la MISMA forma que el array 'paces' que ya se guarda en
 * athlete_evaluations.paces: [{ key, frac, color, paceMinKm }]
 * con paceMinKm en MINUTOS DECIMALES (4.878 = 4:52.7).
 *
 * Unico cambio: los 'frac' ahora salen de ZONE_PCT (calibrados),
 * no de los valores hardcodeados que estaban incorrectos.
 */
export function pacesLegacyShape(vdot) {
  const v = Number(vdot);
  if (!Number.isFinite(v) || v <= 0) return [];

  const fractions = [
    { key: "Easy",         frac: ZONE_PCT.E_mid, color: ZONE_COLORS.E },
    { key: "Maratón",      frac: ZONE_PCT.M,     color: ZONE_COLORS.M },
    { key: "Umbral",       frac: ZONE_PCT.T,     color: ZONE_COLORS.T },
    { key: "Intervalos",   frac: ZONE_PCT.I,     color: ZONE_COLORS.I },
    { key: "Repeticiones", frac: ZONE_PCT.R,     color: ZONE_COLORS.R },
  ];

  return fractions.map((p) => {
    const vel = velocityAtVO2(v * p.frac);   // m/min
    return { ...p, paceMinKm: vel ? 1000 / vel : null };
  });
}

/* ============================================================
 * RITMOS PARA PROMPTS DE IA (planes 2 semanas / marketplace)
 * ============================================================
 * Reemplaza a MARKETPLACE_AI_PACE_RANGES_BY_LEVEL, que usaba
 * rangos fijos por nivel NO derivados del VDOT. Ese enfoque
 * producia errores de hasta 91 s/km en atletas rapidos
 * (VDOT 57 etiquetado "intermedio" recibia tempo a 5:00-5:30
 * cuando su umbral real es 3:44).
 */

/**
 * VDOT por defecto cuando el atleta AUN NO tiene evaluacion.
 * Derivados del ritmo facil que implicaba la tabla vieja por nivel.
 * En cuanto exista una evaluacion real, se usa el VDOT medido.
 */
export const LEVEL_DEFAULT_VDOT = {
  principiante: 33,
  intermedio:   41,
  avanzado:     51,
};

/** Ritmo mas lento en N segundos (para recuperacion) */
const slower = (secs, delta) => secs + delta;

/**
 * Rangos de ritmo para el prompt de la IA, derivados del VDOT.
 * Devuelve la MISMA forma que MARKETPLACE_AI_PACE_RANGES_BY_LEVEL:
 *   { easy: {desc, pace_range}, tempo: {...}, interval: {...}, recovery: {...} }
 *
 * @param {number} vdot   VDOT medido del atleta (preferido)
 * @param {string} level  nivel, solo como fallback si no hay VDOT
 */
export function paceRangesForPrompt(vdot, level = "intermedio") {
  const key = String(level || "intermedio").toLowerCase();
  const v = Number(vdot) > 0
    ? Number(vdot)
    : (LEVEL_DEFAULT_VDOT[key] ?? LEVEL_DEFAULT_VDOT.intermedio);

  const p = pacesForVdot(v);
  if (!p) return null;

  // Rangos con tolerancia +-5 s/km para que la IA tenga margen legible
  const range = (secs, tol = 5) => `${fmtPace(secs + tol)}-${fmtPace(secs - tol)}`;
  const easyRange = `${fmtPace(p.E[1])}-${fmtPace(p.E[0])}`;   // rapido-lento
  const recEasy   = `${fmtPace(p.E[0])}-${fmtPace(slower(p.E[0], 30))}`;

  const mk = (r) => ({ desc: `${r.replace("-", "–")} min/km`, pace_range: r });

  return {
    vdotUsed: v,
    isEstimated: !(Number(vdot) > 0),   // true = derivado del nivel, no medido
    easy:     mk(easyRange),
    marathon: mk(range(p.M)),
    tempo:    mk(range(p.T)),
    interval: mk(range(p.I)),
    rep:      mk(range(p.R)),
    recovery: {
      desc: `${recEasy.replace("-", "–")} min/km (recuperación activa)`,
      pace_range: recEasy,
    },
  };
}

/**
 * Tabla por nivel, ahora DERIVADA de vdot.js.
 * Se mantiene el nombre y la forma para no romper a los consumidores
 * que no conocen el VDOT del atleta (marketplace generico).
 */
export const PACE_RANGES_BY_LEVEL = Object.fromEntries(
  Object.entries(LEVEL_DEFAULT_VDOT).map(([lvl, v]) => {
    const r = paceRangesForPrompt(v, lvl);
    return [lvl, { easy: r.easy, tempo: r.tempo, interval: r.interval }];
  })
);
