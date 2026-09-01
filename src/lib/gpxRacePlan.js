/**
 * Plan de carrera desde GPX: parseo, segmentos ~1 km y Grade Adjusted Pace (Minetti 2002).
 *
 * Por qué DOMParser (sin @tmcw/togeojson): el GPX de carrera es XML plano
 * (trkpt/lat/lon/ele); DOMParser del navegador basta, cero deps y mismo resultado.
 *
 * Segmentación ~1 km: tamaño habitual de pacing en carrera; tramos más cortos
 * hacen ruido de GPS; más largos suavizan pendientes reales de demasiada.
 */
import { fmtPace, pacesForVdot } from "./vdot";

export const GPX_SEGMENT_TARGET_KM = 1;
/** No dejar un coletazo menor a esto: se fusiona con el tramo anterior. */
export const GPX_MIN_TAIL_KM = 0.15;

export const GPX_RACE_ZONE_OPTIONS = [
  { id: "M", label: "Maratón (ritmo M)" },
  { id: "HM", label: "Media maratón (HM)" },
  { id: "T10", label: "10K" },
  { id: "I", label: "5K (intervalos I)" },
];

const GRADE_MIN = -0.1;
const GRADE_MAX = 0.2;
/** Nunca más rápido que ~15% sobre el ritmo llano. */
const DOWNHILL_FACTOR_FLOOR = 0.85;

function toRad(d) {
  return (d * Math.PI) / 180;
}

/** Distancia en metros (Haversine). */
export function haversineMeters(lat1, lon1, lat2, lon2) {
  const R = 6371000;
  const dLat = toRad(lat2 - lat1);
  const dLon = toRad(lon2 - lon1);
  const a =
    Math.sin(dLat / 2) ** 2 +
    Math.cos(toRad(lat1)) * Math.cos(toRad(lat2)) * Math.sin(dLon / 2) ** 2;
  return 2 * R * Math.asin(Math.min(1, Math.sqrt(a)));
}

/**
 * Coste energético de carrera Minetti 2002 (J·kg⁻¹·m⁻¹).
 * i = pendiente como fracción (5% → 0.05).
 */
export function minettiRunningCost(i) {
  const x = Number(i) || 0;
  return 155.4 * x ** 5 - 30.4 * x ** 4 - 43.3 * x ** 3 + 46.3 * x ** 2 + 19.5 * x + 3.6;
}

/**
 * Ritmo ajustado por pendiente (s/km).
 * gradePct: pendiente media del tramo en % (positivo = subida).
 */
export function gradeAdjustedPaceSecs(basePaceSecs, gradePct) {
  const base = Number(basePaceSecs);
  if (!Number.isFinite(base) || base <= 0) return null;
  let i = Number(gradePct) / 100;
  if (!Number.isFinite(i)) i = 0;
  i = Math.max(GRADE_MIN, Math.min(GRADE_MAX, i));
  let f = minettiRunningCost(i) / minettiRunningCost(0);
  if (!Number.isFinite(f) || f <= 0) f = 1;
  f = Math.max(DOWNHILL_FACTOR_FLOOR, f);
  return base * f;
}

export function basePaceSecsForRaceZone(vdot, zoneId) {
  const paces = pacesForVdot(vdot);
  if (!paces) return null;
  const z = String(zoneId || "M").toUpperCase();
  const val = paces[z];
  if (Array.isArray(val)) return (val[0] + val[1]) / 2;
  return Number.isFinite(val) ? val : paces.M;
}

/**
 * Parsea texto GPX → puntos { lat, lng, ele, dist_m cumul }.
 */
export function parseGpxText(gpxText) {
  const text = String(gpxText || "");
  if (!text.trim()) throw new Error("El archivo GPX está vacío.");
  if (typeof DOMParser === "undefined") {
    throw new Error("Este navegador no puede leer GPX (falta DOMParser).");
  }
  const doc = new DOMParser().parseFromString(text, "application/xml");
  const parseErr = doc.querySelector("parsererror");
  if (parseErr) throw new Error("GPX inválido o mal formado.");

  const nodes = [
    ...doc.getElementsByTagName("trkpt"),
    ...doc.getElementsByTagNameNS("http://www.topografix.com/GPX/1/1", "trkpt"),
    ...doc.getElementsByTagName("rtept"),
  ];
  // Dedup by reference if both NS and non-NS returned same nodes
  const seen = new Set();
  const pts = [];
  for (const el of nodes) {
    if (seen.has(el)) continue;
    seen.add(el);
    const lat = Number(el.getAttribute("lat"));
    const lon = Number(el.getAttribute("lon"));
    if (!Number.isFinite(lat) || !Number.isFinite(lon)) continue;
    const eleEl =
      el.getElementsByTagName("ele")[0] ||
      el.getElementsByTagNameNS("http://www.topografix.com/GPX/1/1", "ele")[0];
    const eleRaw = eleEl ? Number(eleEl.textContent) : null;
    const ele = Number.isFinite(eleRaw) ? eleRaw : null;
    pts.push({ lat, lng: lon, ele });
  }
  if (pts.length < 2) throw new Error("El GPX no tiene suficientes puntos de ruta.");

  let cum = 0;
  const withDist = pts.map((p, i) => {
    if (i > 0) {
      cum += haversineMeters(pts[i - 1].lat, pts[i - 1].lng, p.lat, p.lng);
    }
    return { ...p, dist_m: cum };
  });
  return withDist;
}

/**
 * Segmenta en tramos de ~targetKm.
 * Cada segmento: distance_km, elev_gain_m, elev_loss_m, grade_pct, lat/lng extremos.
 */
export function segmentGpxPoints(points, targetKm = GPX_SEGMENT_TARGET_KM) {
  const pts = Array.isArray(points) ? points : [];
  if (pts.length < 2) return [];
  const targetM = Math.max(200, Number(targetKm) * 1000 || 1000);
  const out = [];
  let startIdx = 0;

  const makeSeg = (from, to) => {
    const a = pts[from];
    const b = pts[to];
    const distM = Math.max(0, (b.dist_m || 0) - (a.dist_m || 0));
    if (distM < 1) return null;
    let gain = 0;
    let loss = 0;
    for (let i = from + 1; i <= to; i++) {
      const prev = pts[i - 1].ele;
      const cur = pts[i].ele;
      if (prev == null || cur == null) continue;
      const d = cur - prev;
      if (d > 0) gain += d;
      else loss += -d;
    }
    const elevNet = a.ele != null && b.ele != null ? b.ele - a.ele : gain - loss;
    const grade_pct = (elevNet / distM) * 100;
    return {
      distance_km: distM / 1000,
      elev_gain_m: gain,
      elev_loss_m: loss,
      grade_pct: Number.isFinite(grade_pct) ? grade_pct : 0,
      start_lat: a.lat,
      start_lng: a.lng,
      end_lat: b.lat,
      end_lng: b.lng,
    };
  };

  for (let i = 1; i < pts.length; i++) {
    const span = (pts[i].dist_m || 0) - (pts[startIdx].dist_m || 0);
    if (span >= targetM || i === pts.length - 1) {
      const seg = makeSeg(startIdx, i);
      if (seg) out.push(seg);
      startIdx = i;
    }
  }

  // Fusionar coletazo corto con el anterior
  if (out.length >= 2 && out[out.length - 1].distance_km < GPX_MIN_TAIL_KM) {
    const tail = out.pop();
    const prev = out[out.length - 1];
    const dist = prev.distance_km + tail.distance_km;
    const elevNet =
      (prev.grade_pct / 100) * prev.distance_km * 1000 +
      (tail.grade_pct / 100) * tail.distance_km * 1000;
    out[out.length - 1] = {
      ...prev,
      distance_km: dist,
      elev_gain_m: prev.elev_gain_m + tail.elev_gain_m,
      elev_loss_m: prev.elev_loss_m + tail.elev_loss_m,
      grade_pct: dist > 0 ? (elevNet / (dist * 1000)) * 100 : prev.grade_pct,
      end_lat: tail.end_lat,
      end_lng: tail.end_lng,
    };
  }

  return out;
}

export function summarizeGpxRoute(points, segments) {
  const last = points?.[points.length - 1];
  const total_km = last ? (last.dist_m || 0) / 1000 : 0;
  let elev_gain_m = 0;
  let elev_loss_m = 0;
  for (const s of segments || []) {
    elev_gain_m += s.elev_gain_m || 0;
    elev_loss_m += s.elev_loss_m || 0;
  }
  return {
    total_km: Math.round(total_km * 100) / 100,
    elev_gain_m: Math.round(elev_gain_m),
    elev_loss_m: Math.round(elev_loss_m),
    segment_count: (segments || []).length,
  };
}

export function buildGpxRaceStructure(segments, vdot, zoneId = "M") {
  const base = basePaceSecsForRaceZone(vdot, zoneId);
  if (base == null) throw new Error("VDOT inválido para calcular ritmos.");
  const zone = String(zoneId || "M").toUpperCase();
  return (segments || []).map((seg, i) => {
    const adj = gradeAdjustedPaceSecs(base, seg.grade_pct);
    const paceStr = fmtPace(adj);
    const g = Number(seg.grade_pct) || 0;
    const gLabel = `${g >= 0 ? "+" : ""}${g.toFixed(1)}%`;
    return {
      block_type: "Rodaje",
      duration_min: "",
      distance_km: String(Math.round(seg.distance_km * 100) / 100),
      target_pace: paceStr,
      target_hr: "",
      description: `Tramo ${i + 1}: pendiente ${gLabel} · ↑${Math.round(seg.elev_gain_m || 0)} m ↓${Math.round(seg.elev_loss_m || 0)} m`,
      block_label: `Km ${i + 1}`,
      grade_pct: Math.round(g * 100) / 100,
      race_zone: zone,
      phase: `Km ${i + 1}`,
      pace: paceStr,
    };
  });
}

/**
 * grade_pct solo cuenta si es un number finito.
 * Number(null) y Number("") dan 0, y Number.isFinite(0) es true — eso
 * activaba Minetti en bloques sin pendiente.
 */
function isExplicitGradePct(value) {
  return typeof value === "number" && Number.isFinite(value);
}

export function structureHasGradePct(structure) {
  return (Array.isArray(structure) ? structure : []).some((s) => isExplicitGradePct(s?.grade_pct));
}

export function raceZoneFromStructure(structure, fallback = "M") {
  const row = (Array.isArray(structure) ? structure : []).find((s) => s?.race_zone);
  const z = String(row?.race_zone || fallback).toUpperCase();
  return GPX_RACE_ZONE_OPTIONS.some((o) => o.id === z) ? z : fallback;
}

/** Recalcula target_pace de cada tramo con grade_pct al VDOT del atleta. */
export function applyGradeAdjustedPacesToStructure(structure, vdot, zoneId) {
  const zone = zoneId || raceZoneFromStructure(structure, "M");
  const base = basePaceSecsForRaceZone(vdot, zone);
  if (base == null) return Array.isArray(structure) ? structure : [];
  return (Array.isArray(structure) ? structure : []).map((s) => {
    if (!isExplicitGradePct(s?.grade_pct)) return s;
    const adj = gradeAdjustedPaceSecs(base, s.grade_pct);
    if (adj == null) return s;
    const paceStr = fmtPace(adj);
    return {
      ...s,
      race_zone: zone,
      target_pace: paceStr,
      pace: paceStr,
    };
  });
}

export function estimateDurationMinFromStructure(structure) {
  let secs = 0;
  for (const s of structure || []) {
    const km = Number(String(s.distance_km || "").replace(",", "."));
    const pace = String(s.target_pace || "");
    const m = pace.match(/^(\d+):([0-5]\d)$/);
    if (!Number.isFinite(km) || km <= 0 || !m) continue;
    secs += km * (Number(m[1]) * 60 + Number(m[2]));
  }
  return Math.round(secs / 60);
}

export function parseAndSegmentGpx(gpxText) {
  const points = parseGpxText(gpxText);
  const segments = segmentGpxPoints(points);
  if (!segments.length) throw new Error("No se pudieron formar tramos de la ruta.");
  const summary = summarizeGpxRoute(points, segments);
  return { points, segments, summary };
}
