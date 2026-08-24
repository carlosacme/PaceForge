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
 * Validado: VDOT 42.5 -> E 6:30-5:55 | M 5:08 | T 4:49 | I 4:32 | R 4:03
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
  // Recalibrados contra los tiempos de carrera equivalentes de Daniels
  // (ancla estable entre fuentes). Los valores previos corrian ~4-13 s/km
  // rapidos, con sesgo mayor a VDOT bajo (justo el rango de los atletas).
  M:      0.8201,  // antes 0.8369 -> M = ritmo maraton exacto
  T:      0.8889,  // antes 0.9030 -> techo textbook de Daniels (88% VO2max)
  I:      0.9579,  // antes 0.9975 -> I anclado a ritmo 5K
  R:      1.0998,  // ritmo de repeticiones (~milla); sin ancla en carrera, se deja
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
  T:  "#ff8a3d",
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

/**
 * VDOT al que estan escritos los ritmos de los workouts importados a la
 * biblioteca (los JSON del plan de 24 semanas).
 *
 * No es un dato que traigan los archivos: se midio por minimos cuadrados
 * comparando los ritmos que sus propios stepName declaran por zona
 * (E 5:53, M 4:39, T 4:23, I 4:03, R 3:43) contra pacesForVdot. El ajuste global
 * da 47.2 y zona a zona cae entre 45.5 y 48.8. Cuadra con el objetivo declarado
 * del plan (maraton 3:15, y sus tests dicen "VDOT 46-47"): son ritmos OBJETIVO,
 * no del estado actual de nadie.
 *
 * Si algun dia se importa un plan calibrado a otro VDOT, esto tiene que pasar a
 * ser un dato por workout en vez de una constante.
 */
export const PLAN_CALIBRATION_VDOT = 47.2;

/**
 * Zonas que se consideran al deducir la zona de un ritmo absoluto.
 *
 * A proposito NO estan HM ni T10: son mezclas de M/T/I (ver pacesForVdot), caen
 * a pocos segundos de sus vecinas y le robarian el match a la zona real.
 */
const REVERSE_MAP_ZONES = ["E", "M", "T", "I", "R"];

/** Centro de una zona en seg/km. E es rango, el resto valor unico. */
function zoneCenterSecs(paces, zone) {
  const v = paces?.[zone];
  if (v == null) return null;
  return Array.isArray(v) ? (v[0] + v[1]) / 2 : v;
}

/**
 * Ritmo escrito -> seg/km. Acepta valor unico ("4:23"), rango ("3:39-3:47", del
 * que devuelve el punto medio) y sufijos ("4:23 min/km", "3:39-3:47/km").
 * null si no hay ningun m:ss dentro.
 */
export function paceTextToSecs(text) {
  const s = String(text ?? "").trim();
  if (!s) return null;
  const range = s.match(/(\d{1,2}):([0-5]\d)\s*[-–]\s*(\d{1,2}):([0-5]\d)/);
  if (range) {
    const a = +range[1] * 60 + +range[2];
    const b = +range[3] * 60 + +range[4];
    return (a + b) / 2;
  }
  const one = s.match(/(\d{1,2}):([0-5]\d)/);
  return one ? +one[1] * 60 + +one[2] : null;
}

/** Margen para aceptar que un ritmo pertenece a una zona (seg/km). */
export const PACE_ZONE_TOLERANCE_SECS = 15;

/**
 * Operacion inversa de pacesForVdot: de un ritmo ABSOLUTO a su zona Daniels,
 * sabiendo a que VDOT se escribio.
 *
 * Hace falta para reescalar un workout de ritmos fijos al VDOT de otro atleta:
 * sin la zona, un "4:23/km" es un numero opaco. El VDOT de calibracion es
 * imprescindible y no se puede adivinar; con el equivocado el mapeo se desplaza
 * de zona (a VDOT 42.5 la R son 4:03, que en este plan es la I).
 *
 * Devuelve null si el ritmo no se parece a ninguna zona (mas de `tolerance`
 * segundos de la mas cercana), para no forzar una zona incorrecta: los trotes de
 * recuperacion, mas lentos que E a proposito, caen aqui y se quedan como estan.
 */
export function paceToZone(paceStr, calibrationVdot, tolerance = PACE_ZONE_TOLERANCE_SECS) {
  const secs = paceTextToSecs(paceStr);
  if (secs == null) return null;
  const paces = pacesForVdot(calibrationVdot);
  if (!paces) return null;

  let best = null;
  let bestDiff = Infinity;
  for (const zone of REVERSE_MAP_ZONES) {
    const center = zoneCenterSecs(paces, zone);
    if (center == null) continue;
    const diff = Math.abs(center - secs);
    if (diff < bestDiff) {
      bestDiff = diff;
      best = zone;
    }
  }
  return bestDiff <= tolerance ? best : null;
}

/**
 * Cuanto VDOT se le suma al atleta para fijar los ritmos del entreno.
 *
 * Se entrena apuntando algo por encima del estado actual, y el margen es mayor
 * cuanto mas abajo esta el atleta: a VDOT 30 los saltos son grandes y baratos, a
 * VDOT 60 arañar un punto cuesta meses. null si no hay VDOT con el que calcular.
 */
export function progressionDelta(vdot) {
  const v = Number(vdot);
  if (!Number.isFinite(v) || v <= 0) return null;
  if (v < 35) return 4;
  if (v < 45) return 3;
  if (v < 55) return 2;
  return 1;
}

/**
 * Tope de mejora acumulada sobre el PRIMER test del atleta. Sin el, cada
 * evaluacion apila su delta aspiracional y a los seis tests el plan pide ritmos
 * que el atleta no ha demostrado nunca.
 */
export const VDOT_MAX_CUMULATIVE_GAIN = 8;

/**
 * VDOT al que se escriben los ritmos tras un test.
 *
 * El caso normal apunta algo por encima de lo medido (progressionDelta), que es
 * como se entrena. Las guardas existen porque esto se aplica AUTOMATICAMENTE y
 * los ritmos llegan al reloj sin que nadie los revise:
 *
 *  - Si el VDOT bajo (lesion, mala racha) se usa lo medido y punto. Apretar a
 *    quien retrocedio es como un bajon se convierte en una lesion.
 *  - Si la mejora real ya alcanzo el delta que se le habia aplicado, tampoco se
 *    suma otra vez: el atleta ya sube mas rapido que lo aspiracional, y volver a
 *    adelantarle los ritmos solo acumula riesgo.
 *  - El tope sobre el primer test solo QUITA el delta; nunca devuelve un VDOT por
 *    debajo del medido, porque a quien demostro 53 no se le entrena a 50.
 *
 * @param {{measured:number, previous?:number|null, first?:number|null}} args
 * @returns {{target:number, delta:number, reason:string}|null}
 */
export function resolveTargetVdotAfterTest({ measured, previous = null, first = null }) {
  // OJO: Number(null) es 0 y Number.isFinite(0) es true, asi que un atleta sin
  // test anterior entraria en las ramas de comparacion con un "anterior = 0" y
  // saldria siempre por "ya mejoró". Solo un VDOT positivo cuenta como dato.
  const vdotOrNull = (v) => {
    const n = Number(v);
    return Number.isFinite(n) && n > 0 ? n : null;
  };
  const medido = vdotOrNull(measured);
  if (medido == null) return null;
  const anterior = vdotOrNull(previous);
  const primero = vdotOrNull(first);

  const delta = progressionDelta(medido) ?? 0;
  let target = medido + delta;
  let reason = `+${delta} por nivel`;

  if (anterior != null && medido < anterior) {
    target = medido;
    reason = `bajó desde ${anterior}: sin delta`;
  } else if (anterior != null) {
    const deltaPrevio = progressionDelta(anterior) ?? delta;
    const mejora = medido - anterior;
    if (mejora >= deltaPrevio) {
      target = medido;
      reason = `ya mejoró ${mejora.toFixed(1)} (>= ${deltaPrevio}): sin delta`;
    }
  }

  if (primero != null && target > primero + VDOT_MAX_CUMULATIVE_GAIN) {
    target = Math.max(medido, primero + VDOT_MAX_CUMULATIVE_GAIN);
    reason += ` · tope de +${VDOT_MAX_CUMULATIVE_GAIN} sobre el primer test (${primero})`;
  }

  return {
    target: Number(target.toFixed(2)),
    delta: Number((target - medido).toFixed(2)),
    reason,
  };
}

/** "7:14" -> 434 segundos. null si no es un ritmo. */
export function parsePaceToSeconds(text) {
  const m = String(text || "").trim().match(/^(\d{1,2}):([0-5]\d)$/);
  if (!m) return null;
  return Number(m[1]) * 60 + Number(m[2]);
}

/**
 * Punto medio de un rango de ritmo: "7:14-7:55" -> 449 s/km. Acepta guion
 * normal o en, y tambien un ritmo suelto ("7:30").
 */
export function midPaceSecondsFromRange(range) {
  const text = String(range || "").replace(/\s|min\/km/gi, "");
  if (!text) return null;
  const parts = text.split(/[-–—]/).map(parsePaceToSeconds).filter((n) => n != null);
  if (!parts.length) return null;
  return parts.reduce((a, b) => a + b, 0) / parts.length;
}

/**
 * Busca el ritmo dentro de un texto libre ("...a ritmo de 7:14-7:55 min/km").
 * Se queda con el primer rango o ritmo que encuentre.
 */
export function extractPaceSecondsFromText(text) {
  const source = String(text || "");
  if (!source) return null;
  const range = source.match(/(\d{1,2}:[0-5]\d)\s*[-–—]\s*(\d{1,2}:[0-5]\d)/);
  if (range) return midPaceSecondsFromRange(`${range[1]}-${range[2]}`);
  const single = source.match(/(\d{1,2}:[0-5]\d)\s*(?:min\s*\/\s*km|min\/km)/i);
  if (single) return parsePaceToSeconds(single[1]);
  return null;
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

/* ============================================================
 * VDOT <-> TIEMPOS DE CARRERA
 * ============================================================
 * Vivian duplicadas dentro de EvaluationView.jsx. Se centralizan aqui
 * porque el aviso de coherencia de Plan2Weeks necesita la operacion
 * inversa (que VDOT hace falta para un tiempo objetivo) y este archivo
 * es la fuente unica de verdad declarada.
 */

/** %VO2max sostenible en una carrera de t minutos (Daniels & Gilbert). */
const timePercentVo2 = (tMin) =>
  0.8 + 0.1894393 * Math.exp(-0.012778 * tMin) + 0.2989558 * Math.exp(-0.1932605 * tMin);

/** "h:mm:ss" | "mm:ss" | segundos -> segundos. null si no es valido. */
export function parseTimeToSeconds(raw) {
  if (typeof raw === "number") return Number.isFinite(raw) && raw > 0 ? raw : null;
  const parts = String(raw || "").trim().split(":").map((x) => Number(x));
  if (!parts.length || parts.some((n) => !Number.isFinite(n) || n < 0)) return null;
  let secs = null;
  if (parts.length === 3) secs = parts[0] * 3600 + parts[1] * 60 + parts[2];
  else if (parts.length === 2) secs = parts[0] * 60 + parts[1];
  else if (parts.length === 1) secs = parts[0];
  return secs && secs > 0 ? secs : null;
}

/** VDOT implicito en una marca de carrera. */
export function vdotFromRace(distanceMeters, totalSeconds) {
  const tMin = Number(totalSeconds) / 60;
  const d = Number(distanceMeters);
  if (!Number.isFinite(d) || !Number.isFinite(tMin) || d <= 0 || tMin <= 0) return null;
  const vo2 = vo2AtVelocity(d / tMin);
  const pct = timePercentVo2(tMin);
  if (!Number.isFinite(vo2) || !Number.isFinite(pct) || pct <= 0) return null;
  return vo2 / pct;
}

/** Tiempo Daniels puro para una distancia, por biseccion sobre la duracion. */
function danielsRaceSeconds(vdot, distanceMeters) {
  if (!Number.isFinite(vdot) || vdot <= 0) return null;
  let lo = 5;
  let hi = 360;
  for (let i = 0; i < 60; i += 1) {
    const mid = (lo + hi) / 2;
    const current = vo2AtVelocity(distanceMeters / mid) / timePercentVo2(mid);
    if (current > vdot) lo = mid;
    else hi = mid;
  }
  return hi * 60;
}

/**
 * Tiempo estimado de carrera para un VDOT.
 * 5K/10K salen directos de Daniels. 21K y 42K se extrapolan con Riegel desde
 * la prediccion de 10K, porque Daniels puro sobrestima la resistencia en
 * distancias largas. `longExponent` sube para tests cortos (Cooper).
 */
export function predictRaceSeconds(vdot, distanceMeters, { longExponent = 1.07 } = {}) {
  const d = Number(distanceMeters);
  if (!Number.isFinite(d) || d <= 0) return null;
  if (d <= 10000) return danielsRaceSeconds(vdot, d);
  const base10k = danielsRaceSeconds(vdot, 10000);
  if (!Number.isFinite(base10k) || base10k <= 0) return null;
  return base10k * Math.pow(d / 10000, longExponent);
}

/**
 * Operacion inversa: VDOT necesario para correr `distanceMeters` en `time`.
 * Usa la MISMA cadena de prediccion que la evaluacion, para que el numero sea
 * comparable con el VDOT que ve el coach. Devuelve null si los datos no valen.
 */
export function vdotRequiredForRace(distanceMeters, time, opts) {
  const secs = parseTimeToSeconds(time);
  const d = Number(distanceMeters);
  if (!secs || !Number.isFinite(d) || d <= 0) return null;
  let lo = 20;
  let hi = 85;
  for (let i = 0; i < 60; i += 1) {
    const mid = (lo + hi) / 2;
    const t = predictRaceSeconds(mid, d, opts);
    if (t == null) return null;
    if (t > secs) lo = mid;
    else hi = mid;
  }
  return hi;
}

/* ============================================================
 * VOLUMEN SEMANAL (la CARGA del plan)
 * ============================================================
 * El VDOT dice a que ritmos corre el atleta, no cuanto aguanta. La carga
 * arranca del kilometraje que el atleta declara en su evaluacion
 * (weekly_km_declared); el nivel solo pone el techo de seguridad.
 */

/**
 * Piso de arranque en km/semana cuando el atleta declara 0 (vuelve de una
 * pausa) o menos de lo minimo para sostener un bloque de 2 semanas.
 */
export const STARTING_WEEKLY_KM = {
  principiante: 12,
  intermedio: 20,
  avanzado: 30,
};

/**
 * Techo de km/semana por nivel y distancia objetivo: `base` es el bloque 1 y
 * sube `perBlock` en cada bloque. Es un limite de seguridad, no un objetivo:
 * un atleta que ya corre mas de esto conserva su volumen real hasta el techo.
 */
const WEEKLY_KM_CAP = {
  principiante: {
    "5k":      { base: 15, perBlock: 2 },
    "10k":     { base: 20, perBlock: 3 },
    half:      { base: 25, perBlock: 4 },
    marathon:  { base: 30, perBlock: 5 },
  },
  intermedio: {
    "5k":      { base: 25, perBlock: 2 },
    "10k":     { base: 30, perBlock: 3 },
    half:      { base: 40, perBlock: 4 },
    marathon:  { base: 50, perBlock: 5 },
  },
  avanzado: {
    "5k":      { base: 35, perBlock: 2 },
    "10k":     { base: 45, perBlock: 3 },
    half:      { base: 60, perBlock: 4 },
    marathon:  { base: 75, perBlock: 5 },
  },
};

/** Nivel a clave conocida ('principiante' | 'intermedio' | 'avanzado'). */
export function levelKeyOf(level) {
  const key = String(level || "").toLowerCase();
  return STARTING_WEEKLY_KM[key] ? key : "intermedio";
}

/**
 * Los dos vocabularios de distancia que convivan en la app:
 * la ficha de carrera (races.distance) usa "5K/10K/21K/42K" y el generador
 * usa "5K/10K/Media Maratón/Maratón". Sin esta tabla, "42K" no se reconocia
 * como maraton y heredaba el techo de volumen de un 10K.
 */
export const RACE_DISTANCE_TO_COMPETITION = {
  "5K": "5K",
  "10K": "10K",
  "21K": "Media Maratón",
  "42K": "Maratón",
};

export const COMPETITION_TO_RACE_DISTANCE = {
  "5K": "5K",
  "10K": "10K",
  "Media Maratón": "21K",
  "Maratón": "42K",
};

/** "21K" -> "Media Maratón". Devuelve null si la distancia es libre ("Otro"). */
export function competitionFromRaceDistance(distance) {
  const key = String(distance || "").trim().toUpperCase();
  return RACE_DISTANCE_TO_COMPETITION[key] || null;
}

/** "Media Maratón" -> "21K". Devuelve null para competencias sin equivalente. */
export function raceDistanceFromCompetition(competition) {
  return COMPETITION_TO_RACE_DISTANCE[String(competition || "").trim()] || null;
}

/**
 * Competencia (texto libre de la UI o distancia de la ficha) a clave interna.
 * Acepta los dos vocabularios: "Maratón", "42K" y "42" caen en marathon.
 */
export function raceKeyOf(competition) {
  const text = String(competition || "").toLowerCase();
  if (text.includes("media")) return "half";               // antes que "maraton"
  if (text.includes("21")) return "half";
  if (text.includes("marat") || text.includes("42")) return "marathon";
  if (text.includes("10")) return "10k";
  if (text.includes("5")) return "5k";
  return "10k";
}

/** Techo de km/semana para el bloque dado. */
export function weeklyKmCap(level, competition, blockNumber = 1) {
  const cap = WEEKLY_KM_CAP[levelKeyOf(level)][raceKeyOf(competition)];
  const block = Math.max(1, Math.round(Number(blockNumber) || 1));
  return cap.base + cap.perBlock * (block - 1);
}

/**
 * Progresion del bloque en %. Sube 5-10% mientras se construye y baja en el
 * taper (bloque 9+), coherente con las fases del prompt.
 */
export function blockProgressionPct(blockNumber) {
  const b = Math.max(1, Math.round(Number(blockNumber) || 1));
  if (b <= 1) return 0;
  if (b <= 2) return 5;
  if (b <= 6) return 8;
  if (b <= 8) return 10;
  return -20;
}

/** Progresion acumulada desde el bloque 1 hasta `blockNumber`. */
function cumulativeProgressionFactor(blockNumber) {
  const target = Math.max(1, Math.round(Number(blockNumber) || 1));
  let factor = 1;
  for (let b = 2; b <= target; b += 1) factor *= 1 + blockProgressionPct(b) / 100;
  return factor;
}

/**
 * Volumen semanal objetivo de la semana 1 del bloque.
 *
 * @param {object}  args
 * @param {number?} args.declaredKm   km/semana declarados por el atleta
 * @param {string}  args.level        nivel (techo de seguridad)
 * @param {string}  args.competition  distancia objetivo (techo de seguridad)
 * @param {number}  args.blockNumber  bloque actual (progresion acumulada)
 * @returns {{
 *   levelKey: string, declaredKm: number|null, floorKm: number, baseKm: number,
 *   usedFloor: boolean, progressionPct: number, cumulativePct: number,
 *   levelCapKm: number, capKm: number, targetKm: number, cappedByLevel: boolean
 * }}
 */
export function planWeeklyVolume({ declaredKm, level, competition, blockNumber = 1 } = {}) {
  const levelKey = levelKeyOf(level);
  const floorKm = STARTING_WEEKLY_KM[levelKey];
  // Number(null) es 0, y aqui 0 significa "viene de una pausa" (dato real),
  // mientras que null significa "no lo sabemos". No se pueden confundir.
  const raw = declaredKm == null || declaredKm === "" ? NaN : Number(declaredKm);
  const declared = Number.isFinite(raw) && raw >= 0 ? Math.round(raw) : null;
  const baseKm = Math.max(declared ?? 0, floorKm);
  const levelCapKm = weeklyKmCap(levelKey, competition, blockNumber);
  // El techo limita cuanto se SUBE, nunca obliga a bajar: a un atleta que ya
  // corre mas que el techo de su nivel se le mantiene su volumen, no se le
  // desentrena.
  const capKm = Math.max(levelCapKm, baseKm);
  const factor = cumulativeProgressionFactor(blockNumber);
  const progressed = Math.round(baseKm * factor);
  const targetKm = Math.max(floorKm, Math.min(progressed, capKm));
  return {
    levelKey,
    declaredKm: declared,
    floorKm,
    baseKm,
    usedFloor: declared == null || declared < floorKm,
    progressionPct: blockProgressionPct(blockNumber),
    cumulativePct: Math.round((factor - 1) * 100),
    levelCapKm,
    capKm,
    targetKm,
    cappedByLevel: progressed > capKm,
  };
}

/**
 * Guia de trabajo de CALIDAD segun VDOT: series y recuperaciones. Un atleta de
 * VDOT 35 no puede hacer las mismas series que uno de 55, aunque el volumen
 * semanal sea parecido.
 */
export function qualityWorkGuide(vdot) {
  const v = Number(vdot);
  if (!Number.isFinite(v) || v <= 0 || v < 40) {
    return {
      band: "<40",
      intervalRange: "200-600m",
      reps: "4-6",
      recovery: "full recovery (equal to or longer than the interval)",
    };
  }
  if (v <= 50) {
    return {
      band: "40-50",
      intervalRange: "400-1000m",
      reps: "5-8",
      recovery: "50-100% of the interval time",
    };
  }
  return {
    band: ">50",
    intervalRange: "800-2000m",
    reps: "6-10",
    recovery: "50% of the interval time",
  };
}

/* ─────────────────── Carreras y afinamiento (taper) ─────────────────── */

/**
 * Semanas de afinamiento por distancia. Un 5K se afina en unos dias; un
 * maraton necesita tres semanas de bajada progresiva.
 * (half = 21K, marathon = 42K en el vocabulario de la ficha de carrera.)
 */
export const TAPER_WEEKS = {
  "5k": 1,
  "10k": 1,
  half: 2,
  marathon: 3,
};

/**
 * Recorte de volumen por semana, en % sobre la carga normal del bloque.
 * El indice 0 es la semana de la carrera y se va alejando hacia atras:
 * maraton = -60% la semana de la carrera, -40% la anterior, -25% la previa.
 */
const TAPER_VOLUME_CUT = {
  "5k": [40],
  "10k": [40],
  half: [50, 25],
  marathon: [60, 40, 25],
};

/**
 * Carrera B: no se afina el bloque, solo se suavizan los ultimos dias. Aun
 * asi la semana de la competicion no puede ir a carga completa, asi que se
 * le aplica un recorte corto.
 */
const PRIORITY_B_RACE_WEEK_CUT = 25;

/** Prioridad valida ('A' objetivo, 'B' importante, 'C' de entrenamiento). */
export function normalizeRacePriority(priority) {
  const p = String(priority || "A").trim().toUpperCase();
  return p === "B" || p === "C" ? p : "A";
}

/** Semanas de taper de una distancia (0 si no se reconoce). */
export function taperWeeksFor(raceKey) {
  return TAPER_WEEKS[raceKey] || 1;
}

const ymdOf = (value) => String(value || "").slice(0, 10);
const dateOfYmd = (ymd) => new Date(`${ymdOf(ymd)}T12:00:00`);

function addDaysYmd(ymd, days) {
  const d = dateOfYmd(ymd);
  d.setDate(d.getDate() + days);
  const m = String(d.getMonth() + 1).padStart(2, "0");
  const day = String(d.getDate()).padStart(2, "0");
  return `${d.getFullYear()}-${m}-${day}`;
}

function diffDaysYmd(fromYmd, toYmd) {
  return Math.round((dateOfYmd(toYmd).getTime() - dateOfYmd(fromYmd).getTime()) / 86400000);
}

/** Normaliza una fila de races al formato que entiende el generador. */
function toPlanRace(row) {
  const distance = String(row?.distance || "").trim();
  const competition = competitionFromRaceDistance(distance);
  return {
    id: row?.id,
    name: String(row?.name || "Carrera"),
    date: ymdOf(row?.date),
    distance,
    competition,
    raceKey: raceKeyOf(competition || distance),
    priority: normalizeRacePriority(row?.priority),
  };
}

/**
 * Que carrera manda en una semana concreta y cuanto hay que recortar.
 * @returns {{mode:'full'|'short', cutPct:number, weeksToRace:number, race:object}|null}
 */
function taperForWeek(races, weekStartYmd) {
  const applicable = [];
  for (const race of races) {
    if (race.priority === "C" || race.date < weekStartYmd) continue;
    const weeksToRace = Math.floor(diffDaysYmd(weekStartYmd, race.date) / 7) + 1;
    if (weeksToRace < 1) continue;
    if (race.priority === "A") {
      const cuts = TAPER_VOLUME_CUT[race.raceKey] || TAPER_VOLUME_CUT["10k"];
      const cutPct = cuts[weeksToRace - 1];
      if (cutPct != null) applicable.push({ mode: "full", cutPct, weeksToRace, race });
    } else if (weeksToRace === 1) {
      applicable.push({ mode: "short", cutPct: PRIORITY_B_RACE_WEEK_CUT, weeksToRace, race });
    }
  }
  if (!applicable.length) return null;
  // Con varias carreras en juego (una B de preparacion antes de la A objetivo)
  // manda la que mas exige bajar: nunca se compite con carga alta.
  return applicable.sort((a, b) => b.cutPct - a.cutPct)[0];
}

/**
 * Contexto de carreras del bloque que se va a generar.
 *
 * El afinamiento pasa a depender de la carrera real (fecha, distancia y
 * prioridad) en vez del numero de bloque: si hay una carrera A cerca manda
 * ella, y si no hay ninguna el generador sigue con la fase por bloque.
 *
 * @param {object}   args
 * @param {Array}    args.races          filas de la tabla races (futuras)
 * @param {string}   args.blockStartYmd  lunes de inicio del bloque
 * @param {number}   args.weekCount      semanas del bloque (2)
 */
export function planRaceContext({ races = [], blockStartYmd, weekCount = 2 } = {}) {
  const start = ymdOf(blockStartYmd);
  const empty = {
    blockStartYmd: start,
    blockEndYmd: start ? addDaysYmd(start, weekCount * 7 - 1) : "",
    weeks: [],
    racesInBlock: [],
    nextTargetRace: null,
    daysToNextTarget: null,
    taperActive: false,
  };
  if (!start) return empty;

  const list = (races || [])
    .filter((r) => r && r.date)
    .map(toPlanRace)
    .filter((r) => r.date)
    .sort((a, b) => a.date.localeCompare(b.date));

  const weeks = [];
  for (let i = 0; i < weekCount; i += 1) {
    const startYmd = addDaysYmd(start, i * 7);
    const endYmd = addDaysYmd(start, i * 7 + 6);
    const race = list.find((r) => r.date >= startYmd && r.date <= endYmd) || null;
    weeks.push({ weekNumber: i + 1, startYmd, endYmd, race, taper: taperForWeek(list, startYmd) });
  }

  const nextTargetRace = list.find((r) => r.priority === "A" && r.date >= start) || null;
  return {
    ...empty,
    weeks,
    racesInBlock: weeks.map((w) => w.race).filter(Boolean),
    nextTargetRace,
    daysToNextTarget: nextTargetRace ? diffDaysYmd(start, nextTargetRace.date) : null,
    taperActive: weeks.some((w) => w.taper),
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
