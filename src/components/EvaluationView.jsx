import React, { useState, useEffect, useMemo, useCallback } from "react";
import { supabase } from "../lib/supabase";
import { pacesLegacyShape, vdotFromRace, predictRaceSeconds } from "../lib/vdot";
import {
  EVAL_DISTANCES,
  formatDurationClock,
  computeHrZones,
  isValidRestingHr,
  RESTING_HR_MIN,
  RESTING_HR_MAX,
  MIN_HR_RESERVE,
} from "./shared/appShared";
import { usePersistedState } from "../hooks/usePersistedState";

const evalStyles = {
  page: { padding: "28px 32px", maxWidth: 1120, width: "100%" },
  pageTitle: { fontSize: "1.65em", fontWeight: 800, color: "#0f172a", margin: 0, letterSpacing: "-0.02em" },
  card: {
    background: "#ffffff",
    border: "1px solid #f1f5f9",
    borderRadius: 12,
    padding: 22,
    boxShadow: "0 1px 3px rgba(0,0,0,0.1)",
  },
};

const parseHmsToSeconds = (raw) => {
  const parts = String(raw || "")
    .trim()
    .split(":")
    .map((x) => Number(x));
  if (parts.some((n) => !Number.isFinite(n) || n < 0)) return null;
  if (parts.length === 3) return parts[0] * 3600 + parts[1] * 60 + parts[2];
  if (parts.length === 2) return parts[0] * 60 + parts[1];
  if (parts.length === 1) return parts[0];
  return null;
};

const formatPaceMinKm = (paceMinPerKm) => {
  if (!Number.isFinite(paceMinPerKm) || paceMinPerKm <= 0) return "—";
  const totalSec = Math.round(paceMinPerKm * 60);
  const m = Math.floor(totalSec / 60);
  const s = totalSec % 60;
  return `${m}:${String(s).padStart(2, "0")} /km`;
};

const vdotFromCooper = (distanceMeters) => {
  const d = Number(distanceMeters);
  if (!Number.isFinite(d) || d <= 0) return null;
  return (d - 504.9) / 44.73;
};

/**
 * Mensaje de error del campo FC en reposo. Cadena vacía = el dato sirve.
 * Un 140 lpm es FC media de esfuerzo, no de reposo, y con Karvonen deja las
 * cinco zonas apretadas en pocos latidos.
 */
const restingHrErrorFor = (fcRest, fcMax) => {
  const text = String(fcRest ?? "").trim();
  if (text === "") return "";
  const rest = Number(text);
  if (!Number.isFinite(rest) || rest <= 0) return "Indica la FC en reposo en latidos por minuto.";
  if (rest > RESTING_HR_MAX) {
    return `Una FC en reposo por encima de ${RESTING_HR_MAX} lpm es inusual. ¿Seguro que no es tu FC media de esfuerzo? La FC en reposo se mide al despertar, acostado.`;
  }
  if (rest < RESTING_HR_MIN) return `Una FC en reposo por debajo de ${RESTING_HR_MIN} lpm no es creíble. Revisa el dato.`;
  const max = Number(String(fcMax ?? "").trim());
  if (!Number.isFinite(max) || max <= 0) return "";
  if (!isValidRestingHr(rest, max)) {
    return `La diferencia entre tu FC máxima (${Math.round(max)}) y tu FC en reposo (${Math.round(rest)}) es muy pequeña. Revisa ambos datos.`;
  }
  return "";
};

/** FC media del test de umbral: entero de referencia, o null. */
const parseAvgHr = (raw) => {
  const text = String(raw ?? "").trim();
  if (text === "") return null;
  const n = Number(text);
  if (!Number.isFinite(n) || n < 60 || n > 250) return null;
  return Math.round(n);
};

/**
 * Km/semana declarados -> entero para la BD. Cadena vacía = no declarado (null);
 * 0 sí es un dato real y significa "viene de una pausa".
 */
const parseWeeklyKm = (raw) => {
  const text = String(raw ?? "").trim();
  if (text === "") return null;
  const n = Number(text);
  if (!Number.isFinite(n) || n < 0) return null;
  return Math.min(400, Math.round(n));
};

export default function EvaluationView({ athletes, currentUserId, notify, athleteOnlyId = null }) {
  const S = evalStyles;
  const EVAL_FORM_STORAGE_KEY = "raf_eval_form";
  const canSelect = !athleteOnlyId;
  const athleteOptions = useMemo(
    () => (athleteOnlyId ? (athletes || []).filter((a) => String(a.id) === String(athleteOnlyId)) : athletes || []),
    [athletes, athleteOnlyId],
  );
  const [athleteId, setAthleteId] = useState(athleteOnlyId ? String(athleteOnlyId) : String(athleteOptions[0]?.id || ""));
  const [tab, setTab] = usePersistedState("raf_eval_tab", "race");
  const [raceDistance, setRaceDistance] = usePersistedState("raf_eval_raceDistance", "10k");
  const [raceTime, setRaceTime] = usePersistedState("raf_eval_raceTime", "00:45:00");
  const [cooperDistance, setCooperDistance] = usePersistedState("raf_eval_cooperDistance", "2800");
  const [thresholdTime, setThresholdTime] = usePersistedState("raf_eval_thresholdTime", "00:30:00");
  const [thresholdDistance, setThresholdDistance] = usePersistedState("raf_eval_thresholdDistance", "7000");
  const [thresholdAvgHr, setThresholdAvgHr] = usePersistedState("raf_eval_thresholdAvgHr", "");
  const [fcMax, setFcMax] = usePersistedState("raf_eval_fcMax", "");
  const [fcRest, setFcRest] = usePersistedState("raf_eval_fcRest", "");
  const [weeklyKm, setWeeklyKm] = usePersistedState("raf_eval_weeklyKm", "");
  const [results, setResults] = useState(null);
  const [saving, setSaving] = useState(false);
  const [history, setHistory] = useState([]);
  const [openHistoryId, setOpenHistoryId] = useState(null);

  const methodDescription =
    tab === "race"
      ? "Ingresa tu mejor tiempo reciente en una carrera oficial o entrenamiento de tiempo. Cuanto más reciente, más preciso será el cálculo."
      : tab === "cooper"
        ? "Corre durante exactamente 12 minutos al máximo esfuerzo sostenible e ingresa la distancia total recorrida en metros."
        : "Corre durante 30 minutos al máximo esfuerzo que puedas mantener de forma constante e ingresa la distancia total y tu FC promedio si tienes monitor.";

  /** Aviso del campo FC en reposo. Vacío = el dato sirve para Karvonen. */
  const restingHrError = useMemo(() => restingHrErrorFor(fcRest, fcMax), [fcRest, fcMax]);

  useEffect(() => {
    if (!athleteOptions.length) return;
    if (!athleteId) setAthleteId(String(athleteOptions[0].id));
  }, [athleteOptions, athleteId]);

  const selectedAthlete = useMemo(
    () => athleteOptions.find((a) => String(a.id) === String(athleteId)) || null,
    [athleteOptions, athleteId],
  );

  useEffect(() => {
    if (!selectedAthlete) return;
    setFcMax(selectedAthlete.fc_max ? String(selectedAthlete.fc_max) : "");
    setFcRest(selectedAthlete.fc_reposo ? String(selectedAthlete.fc_reposo) : "");
    setWeeklyKm(selectedAthlete.weekly_km != null ? String(selectedAthlete.weekly_km) : "");
  }, [selectedAthlete?.id]);

  useEffect(() => {
    if (typeof localStorage === "undefined") return;
    try {
      const raw = localStorage.getItem(EVAL_FORM_STORAGE_KEY);
      if (!raw) return;
      const parsed = JSON.parse(raw);
      if (!parsed || typeof parsed !== "object") return;
      if (typeof parsed.athleteId === "string" && parsed.athleteId) setAthleteId(parsed.athleteId);
      if (typeof parsed.tab === "string") setTab(parsed.tab);
      if (typeof parsed.raceDistance === "string") setRaceDistance(parsed.raceDistance);
      if (typeof parsed.raceTime === "string") setRaceTime(parsed.raceTime);
      if (typeof parsed.cooperDistance === "string") setCooperDistance(parsed.cooperDistance);
      if (typeof parsed.thresholdTime === "string") setThresholdTime(parsed.thresholdTime);
      if (typeof parsed.thresholdDistance === "string") setThresholdDistance(parsed.thresholdDistance);
      if (typeof parsed.thresholdAvgHr === "string") setThresholdAvgHr(parsed.thresholdAvgHr);
      if (typeof parsed.fcMax === "string") setFcMax(parsed.fcMax);
      if (typeof parsed.fcRest === "string") setFcRest(parsed.fcRest);
      if (typeof parsed.weeklyKm === "string") setWeeklyKm(parsed.weeklyKm);
    } catch (err) {
      console.warn("No se pudo restaurar raf_eval_form", err);
    }
  }, []);

  useEffect(() => {
    if (typeof localStorage === "undefined") return;
    const payload = {
      athleteId,
      tab,
      raceDistance,
      raceTime,
      cooperDistance,
      thresholdTime,
      thresholdDistance,
      thresholdAvgHr,
      fcMax,
      fcRest,
      weeklyKm,
    };
    localStorage.setItem(EVAL_FORM_STORAGE_KEY, JSON.stringify(payload));
  }, [athleteId, tab, raceDistance, raceTime, cooperDistance, thresholdTime, thresholdDistance, thresholdAvgHr, fcMax, fcRest, weeklyKm]);

  const loadHistory = useCallback(async () => {
    if (!athleteId) {
      setHistory([]);
      return;
    }
    const { data, error } = await supabase
      .from("athlete_evaluations")
      .select("*")
      .eq("athlete_id", athleteId)
      .order("created_at", { ascending: false });
    if (error) {
      console.warn("load evaluations", error);
      setHistory([]);
      return;
    }
    setHistory(data || []);
  }, [athleteId]);

  useEffect(() => {
    loadHistory();
  }, [loadHistory]);

  const calculate = () => {
    let vdot = null;
    let source = {};
    if (tab === "race") {
      const dist = EVAL_DISTANCES.find((d) => d.id === raceDistance)?.meters;
      const sec = parseHmsToSeconds(raceTime);
      vdot = vdotFromRace(dist, sec);
      source = { method: "race", distance_id: raceDistance, time: raceTime };
    } else if (tab === "cooper") {
      const dist = Number(cooperDistance);
      vdot = vdotFromCooper(dist);
      source = { method: "cooper", distance_m: dist };
    } else {
      const sec = parseHmsToSeconds(thresholdTime);
      const dist = Number(thresholdDistance);
      vdot = vdotFromRace(dist, sec);
      source = { method: "threshold", distance_m: dist, time: thresholdTime };
    }
    if (!Number.isFinite(vdot) || vdot <= 0) {
      notify?.("No se pudo calcular VDOT. Revisa los datos.");
      return;
    }

    const paces = pacesLegacyShape(vdot);
    // 5K y 10K: directo desde VDOT (fiable). 21K y 42K: Riegel desde el 10K
    // con exponente mayor para no sobrestimar la resistencia.
    // Exponente más agresivo si el test fue corto (cooper/umbral corto)
    const longExponent = tab === "cooper" ? 1.09 : 1.07;
    const predictions = EVAL_DISTANCES.map((d) => ({
      ...d,
      seconds: predictRaceSeconds(vdot, d.meters, { longExponent }),
    }));
    // Las zonas salen de la funcion unica: si la FC en reposo no pasa la
    // validacion, ella misma cae a %FCmax y devuelve el aviso.
    const hr = computeHrZones(fcMax, fcRest);
    const restingHrOk = isValidRestingHr(fcRest, fcMax);
    setResults({
      vdot,
      source,
      paces,
      zones: hr.zones,
      zonesMethod: hr.method,
      zonesWarning: hr.warning,
      predictions,
      fc_max: Number(fcMax) || null,
      fc_reposo: restingHrOk ? Math.round(Number(fcRest)) : null,
      weekly_km_declared: parseWeeklyKm(weeklyKm),
      threshold_avg_hr: tab === "threshold" ? parseAvgHr(thresholdAvgHr) : null,
      method: tab,
      eval_method: tab,
    });
    if (typeof localStorage !== "undefined") {
      localStorage.removeItem(EVAL_FORM_STORAGE_KEY);
    }
  };

  const saveAndApply = async () => {
    if (!results || !athleteId) {
      notify?.("Primero calcula la evaluación");
      return;
    }
    // Nada de FC en reposo dudosa en la base: o se corrige o se deja vacía.
    if (restingHrError) {
      notify?.(`Corrige la FC en reposo antes de guardar (o déjala vacía). ${restingHrError}`);
      return;
    }
    setSaving(true);
    const payload = {
      athlete_id: athleteId,
      coach_id: currentUserId,
      method: results.method,
      input_data: results.source,
      vdot: Number(results.vdot.toFixed(2)),
      paces: results.paces,
      hr_zones: results.zones,
      predicted_times: results.predictions.map((p) => ({ id: p.id, seconds: p.seconds })),
      fc_max: results.fc_max,
      fc_reposo: results.fc_reposo,
      weekly_km_declared: results.weekly_km_declared,
      threshold_avg_hr: results.threshold_avg_hr,
    };
    const { error: insErr } = await supabase.from("athlete_evaluations").insert(payload);
    if (insErr) {
      setSaving(false);
      console.error(insErr);
      notify?.(`No se pudo guardar evaluación: ${insErr.message}`);
      return;
    }
    const athleteUpdate = { fc_max: results.fc_max, fc_reposo: results.fc_reposo };
    if (results.weekly_km_declared != null) athleteUpdate.weekly_km = results.weekly_km_declared;
    const { error: updErr } = await supabase
      .from("athletes")
      .update(athleteUpdate)
      .eq("id", athleteId);
    setSaving(false);
    if (updErr) {
      console.error(updErr);
      notify?.(`Evaluación guardada, pero no se pudo actualizar el perfil del atleta: ${updErr.message}`);
    } else {
      notify?.("Evaluación guardada y aplicada al atleta");
    }
    loadHistory();
  };

  const renderEvaluationCards = (dataObj) => {
    const paces = Array.isArray(dataObj?.paces) ? dataObj.paces : [];
    const zones = Array.isArray(dataObj?.zones) ? dataObj.zones : [];
    const predictions = Array.isArray(dataObj?.predictions) ? dataObj.predictions : [];
    const vdot = Number(dataObj?.vdot);
    return (
      <>
        <div style={{ display: "grid", gap: 12, gridTemplateColumns: "repeat(auto-fit, minmax(220px, 1fr))", marginBottom: 16 }}>
          <div style={{ ...S.card, padding: 16 }}>
            <div style={{ color: "#64748b", fontSize: ".75em", fontWeight: 700 }}>VDOT</div>
            <div style={{ fontSize: "2em", fontWeight: 900, color: "#0f172a" }}>{Number.isFinite(vdot) ? vdot.toFixed(2) : "—"}</div>
          </div>
          {paces.map((p) => (
            <div key={p.key} style={{ ...S.card, padding: 16 }}>
              <div style={{ color: p.color || "#64748b", fontSize: ".75em", fontWeight: 700 }}>{p.key || "Ritmo"}</div>
              <div style={{ fontSize: "1.2em", fontWeight: 800, color: "#0f172a" }}>{p.paceMinKm != null ? formatPaceMinKm(p.paceMinKm) : "—"}</div>
            </div>
          ))}
        </div>

        <div style={{ ...S.card, marginBottom: 16 }}>
          <div style={{ fontSize: ".76em", color: "#64748b", fontWeight: 700, marginBottom: 10 }}>
            ZONAS DE FC{dataObj?.zonesMethod === "karvonen" ? " · KARVONEN (FC RESERVA)" : dataObj?.zonesMethod === "fcmax" ? " · % FC MÁXIMA" : ""}
          </div>
          {dataObj?.zonesWarning ? (
            <div style={{ marginBottom: 10, padding: "8px 10px", borderRadius: 8, border: "1px solid #fde68a", background: "#fffbeb", color: "#92400e", fontSize: ".72em", lineHeight: 1.45 }}>
              {dataObj.zonesWarning}
            </div>
          ) : null}
          <div style={{ display: "grid", gap: 10, gridTemplateColumns: "repeat(auto-fit, minmax(160px, 1fr))" }}>
            {zones.map((z) => (
              <div key={z.z} style={{ border: `1px solid ${(z.color || "#94a3b8")}66`, borderRadius: 10, padding: "10px 12px", background: `${z.color || "#94a3b8"}14` }}>
                <div style={{ color: z.color || "#64748b", fontWeight: 800 }}>{z.z || "Z"}</div>
                <div style={{ color: "#0f172a", fontSize: ".9em" }}>
                  {z.lowBpm ?? "—"}-{z.highBpm ?? "—"} lpm
                </div>
              </div>
            ))}
          </div>
        </div>

        <div style={{ ...S.card, marginBottom: 16 }}>
          <div style={{ fontSize: ".76em", color: "#64748b", fontWeight: 700, marginBottom: 10 }}>TIEMPOS PREDICHOS</div>
          <div style={{ display: "grid", gap: 12, gridTemplateColumns: "repeat(2, minmax(0, 1fr))" }}>
            {predictions.map((p) => {
              const pid = String(p.id || "").toLowerCase();
              const totalSec = Number(p.seconds) || 0;
              const palette =
                pid === "5k"
                  ? { border: "#22c55e55", bg: "#f0fdf4", accent: "#15803d" }
                  : pid === "10k"
                    ? { border: "#3b82f655", bg: "#eff6ff", accent: "#1d4ed8" }
                    : pid === "21k"
                      ? { border: "#f59e0b55", bg: "#fffbeb", accent: "#b45309" }
                      : { border: "#ef444455", bg: "#fef2f2", accent: "#b91c1c" };
              const level = (() => {
                if (pid === "5k") {
                  if (totalSec <= 1080) return { label: "Élite", color: "#065f46", bg: "#d1fae5" };
                  if (totalSec <= 1320) return { label: "Avanzado", color: "#1d4ed8", bg: "#dbeafe" };
                  if (totalSec <= 1620) return { label: "Intermedio", color: "#b45309", bg: "#fef3c7" };
                  return { label: "Principiante", color: "#92400e", bg: "#ffedd5" };
                }
                if (pid === "10k") {
                  if (totalSec <= 2280) return { label: "Élite", color: "#065f46", bg: "#d1fae5" };
                  if (totalSec <= 2820) return { label: "Avanzado", color: "#1d4ed8", bg: "#dbeafe" };
                  if (totalSec <= 3480) return { label: "Intermedio", color: "#b45309", bg: "#fef3c7" };
                  return { label: "Principiante", color: "#92400e", bg: "#ffedd5" };
                }
                if (pid === "21k") {
                  if (totalSec <= 4800) return { label: "Élite", color: "#065f46", bg: "#d1fae5" };
                  if (totalSec <= 6000) return { label: "Avanzado", color: "#1d4ed8", bg: "#dbeafe" };
                  if (totalSec <= 7500) return { label: "Intermedio", color: "#b45309", bg: "#fef3c7" };
                  return { label: "Principiante", color: "#92400e", bg: "#ffedd5" };
                }
                if (totalSec <= 10200) return { label: "Élite", color: "#065f46", bg: "#d1fae5" };
                if (totalSec <= 12600) return { label: "Avanzado", color: "#1d4ed8", bg: "#dbeafe" };
                if (totalSec <= 15600) return { label: "Intermedio", color: "#b45309", bg: "#fef3c7" };
                return { label: "Principiante", color: "#92400e", bg: "#ffedd5" };
              })();
              const hhmmss = formatDurationClock(totalSec);
              return (
                <div key={p.id || p.label} style={{ border: `1px solid ${palette.border}`, borderRadius: 12, padding: "12px 10px", background: palette.bg, textAlign: "center" }}>
                  <div style={{ color: palette.accent, fontSize: ".98em", fontWeight: 900, letterSpacing: ".02em", marginBottom: 8 }}>
                    {p.label || String(p.id || "").toUpperCase()}
                  </div>
                  <div style={{ color: "#0f172a", fontWeight: 900, fontSize: "1.26em", marginBottom: 10, fontFamily: "monospace" }}>{hhmmss}</div>
                  <span style={{ display: "inline-flex", padding: "3px 9px", borderRadius: 999, fontSize: ".68em", fontWeight: 800, background: level.bg, color: level.color }}>
                    {level.label}
                  </span>
                </div>
              );
            })}
          </div>
          {(dataObj?.method === "cooper" || dataObj?.eval_method === "cooper") && (
            <div style={{ marginTop: 12, padding: "10px 12px", background: "#fffbeb", border: "1px solid #fde68a", borderRadius: 10, fontSize: ".74em", color: "#92400e", lineHeight: 1.5 }}>
              ⚠️ Las predicciones de 21K y 42K son estimaciones a partir de un test corto. La resistencia real a esas distancias depende del entrenamiento de fondo y puede diferir de estos tiempos.
            </div>
          )}
        </div>
      </>
    );
  };

  return (
    <div style={S.page}>
      <div style={{ marginBottom: 16 }}>
        <h1 style={S.pageTitle}>Evaluación</h1>
        <p style={{ color: "#64748b", fontSize: ".86em", marginTop: 4 }}>Calcula VDOT, ritmos y zonas para actualizar el plan del atleta.</p>
      </div>

      <div style={{ ...S.card, marginBottom: 16 }}>
        <div style={{ display: "grid", gap: 14, gridTemplateColumns: "repeat(auto-fit, minmax(220px, 1fr))" }}>
          <div>
            <div style={{ fontSize: ".74em", color: "#64748b", marginBottom: 6, fontWeight: 700 }}>Atleta</div>
            <select
              value={athleteId}
              disabled={!canSelect}
              onChange={(e) => setAthleteId(e.target.value)}
              style={{ width: "100%", border: "1px solid #e2e8f0", borderRadius: 8, padding: "10px 12px", fontFamily: "inherit" }}
            >
              {athleteOptions.map((a) => (
                <option key={a.id} value={String(a.id)}>
                  {a.name}
                </option>
              ))}
            </select>
          </div>
          <div>
            <div style={{ fontSize: ".74em", color: "#64748b", marginBottom: 6, fontWeight: 700 }}>FC máxima</div>
            <input
              type="number"
              min={100}
              max={250}
              value={fcMax}
              onChange={(e) => setFcMax(e.target.value)}
              placeholder="Ej. 188"
              style={{ width: "100%", border: "1px solid #e2e8f0", borderRadius: 8, padding: "10px 12px", fontFamily: "inherit" }}
            />
            <div style={{ fontSize: ".68em", color: "#64748b", marginTop: 6, lineHeight: 1.4 }}>
              Idealmente de un test de esfuerzo o del valor máximo registrado por tu reloj en una sesión intensa. Evita la fórmula 220-edad, que es poco precisa.
            </div>
          </div>
          <div>
            <div style={{ fontSize: ".74em", color: "#64748b", marginBottom: 6, fontWeight: 700 }}>FC reposo</div>
            <input
              type="number"
              min={RESTING_HR_MIN}
              max={RESTING_HR_MAX}
              value={fcRest}
              onChange={(e) => setFcRest(e.target.value)}
              placeholder="Ej. 52"
              style={{ width: "100%", border: `1px solid ${restingHrError ? "#fca5a5" : "#e2e8f0"}`, borderRadius: 8, padding: "10px 12px", fontFamily: "inherit", background: restingHrError ? "#fef2f2" : "#fff" }}
            />
            {restingHrError ? (
              <div style={{ fontSize: ".68em", color: "#b91c1c", marginTop: 6, lineHeight: 1.45, fontWeight: 600 }}>{restingHrError}</div>
            ) : null}
            <div style={{ fontSize: ".68em", color: "#64748b", marginTop: 6, lineHeight: 1.4 }}>
              Mídela al despertar, acostado y antes de levantarte. Cuenta tus pulsaciones durante 60 segundos (o usa tu reloj). Repítelo 3 días y usa el promedio. Valores típicos: 40-70 lpm en corredores entrenados, 60-80 en personas activas.
            </div>
          </div>
          <div>
            <div style={{ fontSize: ".74em", color: "#64748b", marginBottom: 6, fontWeight: 700 }}>Kilometraje semanal actual (km)</div>
            <input
              type="number"
              min={0}
              max={400}
              step={1}
              value={weeklyKm}
              onChange={(e) => setWeeklyKm(e.target.value)}
              placeholder="Ej. 30"
              style={{ width: "100%", border: "1px solid #e2e8f0", borderRadius: 8, padding: "10px 12px", fontFamily: "inherit" }}
            />
            <div style={{ fontSize: ".68em", color: "#64748b", marginTop: 6, lineHeight: 1.4 }}>
              ¿Cuántos km corre el atleta a la semana actualmente? Si viene de una pausa, indica 0. Es el dato con el que se calcula el volumen de sus planes.
            </div>
          </div>
        </div>

        <div style={{ display: "flex", gap: 8, marginTop: 14, flexWrap: "wrap" }}>
          {[
            { id: "race", label: "Carrera Reciente" },
            { id: "cooper", label: "Test Cooper" },
            { id: "threshold", label: "Test Umbral" },
          ].map((x) => (
            <button
              key={x.id}
              type="button"
              onClick={() => setTab(x.id)}
              style={{
                border: "1px solid #e2e8f0",
                borderRadius: 8,
                padding: "8px 12px",
                background: tab === x.id ? "rgba(245,158,11,.14)" : "#fff",
                color: tab === x.id ? "#b45309" : "#475569",
                fontWeight: 700,
                fontFamily: "inherit",
                cursor: "pointer",
              }}
            >
              {x.label}
            </button>
          ))}
        </div>
        <div style={{ marginTop: 10, color: "#64748b", fontSize: ".84em", lineHeight: 1.35 }}>{methodDescription}</div>

        {tab === "race" && (
          <div style={{ display: "grid", gap: 12, gridTemplateColumns: "repeat(auto-fit, minmax(220px, 1fr))", marginTop: 14 }}>
            <select value={raceDistance} onChange={(e) => setRaceDistance(e.target.value)} style={{ border: "1px solid #e2e8f0", borderRadius: 8, padding: "10px 12px", fontFamily: "inherit" }}>
              {EVAL_DISTANCES.map((d) => (
                <option key={d.id} value={d.id}>
                  {d.label}
                </option>
              ))}
            </select>
            <input value={raceTime} onChange={(e) => setRaceTime(e.target.value)} placeholder="hh:mm:ss" style={{ border: "1px solid #e2e8f0", borderRadius: 8, padding: "10px 12px", fontFamily: "inherit" }} />
          </div>
        )}
        {tab === "cooper" && (
          <div style={{ marginTop: 14 }}>
            <input
              value={cooperDistance}
              onChange={(e) => setCooperDistance(e.target.value)}
              placeholder="Distancia en 12 minutos (m)"
              style={{ width: "100%", border: "1px solid #e2e8f0", borderRadius: 8, padding: "10px 12px", fontFamily: "inherit" }}
            />
          </div>
        )}
        {tab === "threshold" && (
          <div style={{ marginTop: 14 }}>
            <div style={{ display: "grid", gap: 12, gridTemplateColumns: "repeat(auto-fit, minmax(220px, 1fr))" }}>
              <input value={thresholdTime} onChange={(e) => setThresholdTime(e.target.value)} placeholder="Tiempo hh:mm:ss" style={{ border: "1px solid #e2e8f0", borderRadius: 8, padding: "10px 12px", fontFamily: "inherit" }} />
              <input value={thresholdDistance} onChange={(e) => setThresholdDistance(e.target.value)} placeholder="Distancia (m)" style={{ border: "1px solid #e2e8f0", borderRadius: 8, padding: "10px 12px", fontFamily: "inherit" }} />
              <div>
                <input
                  type="number"
                  min={60}
                  max={250}
                  value={thresholdAvgHr}
                  onChange={(e) => setThresholdAvgHr(e.target.value)}
                  placeholder="FC media del test (opcional)"
                  style={{ width: "100%", border: "1px solid #e2e8f0", borderRadius: 8, padding: "10px 12px", fontFamily: "inherit" }}
                />
                <div style={{ fontSize: ".68em", color: "#64748b", marginTop: 6, lineHeight: 1.4 }}>
                  FC media de los 30 minutos, si llevaste monitor. Es solo un registro para el coach: no cambia el VDOT ni las zonas.
                </div>
              </div>
            </div>
          </div>
        )}

        <div style={{ display: "flex", gap: 10, marginTop: 16, flexWrap: "wrap" }}>
          <button type="button" onClick={calculate} style={{ background: "linear-gradient(135deg,#b45309,#f59e0b)", border: "none", borderRadius: 10, padding: "10px 16px", color: "#fff", fontFamily: "inherit", fontWeight: 800, cursor: "pointer" }}>
            Calcular
          </button>
          <button
            type="button"
            disabled={!results || saving}
            onClick={saveAndApply}
            style={{
              background: !results || saving ? "#e2e8f0" : "#0ea5e9",
              border: "none",
              borderRadius: 10,
              padding: "10px 16px",
              color: !results || saving ? "#64748b" : "#fff",
              fontFamily: "inherit",
              fontWeight: 800,
              cursor: !results || saving ? "not-allowed" : "pointer",
            }}
          >
            Guardar y Aplicar al Atleta
          </button>
        </div>
      </div>

      {results && renderEvaluationCards(results)}

      <div style={{ ...S.card }}>
        <div style={{ fontSize: ".76em", color: "#64748b", fontWeight: 700, marginBottom: 10 }}>Historial de evaluaciones</div>
        {history.length >= 2 ? (() => {
          const sorted = [...history].sort((a, b) => new Date(a.created_at) - new Date(b.created_at));
          const vdots = sorted.map(h => Number(h.vdot) || 0);
          const dates = sorted.map(h => new Date(h.created_at).toLocaleDateString("es", { day: "numeric", month: "short" }));
          const minV = Math.max(0, Math.min(...vdots) - 2);
          const maxV = Math.max(...vdots) + 2;
          const W = 320, H = 100, padL = 30, padR = 10, padT = 10, padB = 24;
          const innerW = W - padL - padR;
          const innerH = H - padT - padB;
          const toX = (i) => padL + (i / (vdots.length - 1)) * innerW;
          const toY = (v) => padT + innerH - ((v - minV) / (maxV - minV)) * innerH;
          const points = vdots.map((v, i) => toX(i) + "," + toY(v)).join(" ");
          return (
            <div style={{ marginBottom: 14, padding: "10px 12px", background: "#f8fafc", borderRadius: 10, border: "1px solid #e2e8f0" }}>
              <div style={{ fontSize: ".68em", color: "#64748b", marginBottom: 6, fontWeight: 700 }}>EVOLUCION VDOT</div>
              <svg viewBox={"0 0 " + W + " " + H} style={{ width: "100%", height: "auto", display: "block" }}>
                {[0, 0.5, 1].map((t) => {
                  const y = padT + innerH * (1 - t);
                  const v = (minV + (maxV - minV) * t).toFixed(1);
                  return (
                    <g key={t}>
                      <line x1={padL} y1={y} x2={W - padR} y2={y} stroke="#e2e8f0" strokeWidth={1} />
                      <text x={padL - 4} y={y + 3} textAnchor="end" fontSize={7} fill="#94a3b8">{v}</text>
                    </g>
                  );
                })}
                <polyline fill="none" stroke="#f59e0b" strokeWidth={2} strokeLinejoin="round" strokeLinecap="round" points={points} />
                {vdots.map((v, i) => (
                  <g key={i}>
                    <circle cx={toX(i)} cy={toY(v)} r={4} fill="#f59e0b" stroke="#fff" strokeWidth={1.5} />
                    <text x={toX(i)} y={toY(v) - 7} textAnchor="middle" fontSize={7} fontWeight="700" fill="#b45309">{v.toFixed(1)}</text>
                    <text x={toX(i)} y={H - 6} textAnchor="middle" fontSize={6.5} fill="#94a3b8">{dates[i]}</text>
                  </g>
                ))}
              </svg>
              <div style={{ display: "flex", justifyContent: "space-between", fontSize: ".68em", marginTop: 6 }}>
                <span style={{ color: "#64748b" }}>Inicio: <strong style={{ color: "#0f172a" }}>{vdots[0].toFixed(1)}</strong></span>
                <span style={{ color: vdots[vdots.length-1] >= vdots[0] ? "#16a34a" : "#dc2626", fontWeight: 800 }}>
                  {vdots[vdots.length-1] >= vdots[0] ? "+" : ""}{(vdots[vdots.length-1] - vdots[0]).toFixed(1)} puntos
                </span>
                <span style={{ color: "#64748b" }}>Actual: <strong style={{ color: "#0f172a" }}>{vdots[vdots.length-1].toFixed(1)}</strong></span>
              </div>
            </div>
          );
        })() : null}
        {history.length === 0 ? (
          <div style={{ color: "#94a3b8", fontSize: ".9em" }}>Sin evaluaciones previas.</div>
        ) : (
          history.map((h) => (
            <div key={h.id} style={{ border: "1px solid #e2e8f0", borderRadius: 10, marginBottom: 8, overflow: "hidden" }}>
              <button
                type="button"
                onClick={() => setOpenHistoryId((prev) => (prev === h.id ? null : h.id))}
                style={{
                  width: "100%",
                  textAlign: "left",
                  padding: "10px 12px",
                  border: "none",
                  background: "#f8fafc",
                  fontFamily: "inherit",
                  cursor: "pointer",
                  display: "flex",
                  justifyContent: "space-between",
                }}
              >
                <span style={{ color: "#0f172a", fontWeight: 700 }}>
                  {new Date(h.created_at).toLocaleString("es")} · {String(h.method || "").toUpperCase()} · VDOT {Number(h.vdot || 0).toFixed(2)}
                </span>
                <span style={{ color: "#64748b" }}>{openHistoryId === h.id ? "▲" : "▼"}</span>
              </button>
              {openHistoryId === h.id && (
                <div style={{ padding: "10px 12px", background: "#fff" }}>
                  <div style={{ fontSize: ".78em", color: "#64748b", marginBottom: 10 }}>
                    Método: <strong style={{ color: "#0f172a" }}>{String(h.method || "").toUpperCase()}</strong>
                    {h.threshold_avg_hr ? <> · FC media del test: <strong style={{ color: "#0f172a" }}>{h.threshold_avg_hr} lpm</strong></> : null}
                  </div>
                  {(() => {
                    // Las zonas se recalculan con la funcion unica en vez de
                    // pintar el jsonb guardado: las evaluaciones viejas se
                    // guardaron con reglas distintas y mostraban rangos que ya
                    // no coinciden con los del panel del coach.
                    const hr = h.fc_max ? computeHrZones(h.fc_max, h.fc_reposo) : null;
                    return renderEvaluationCards({
                      vdot: h.vdot,
                      paces: h.paces,
                      zones: hr ? hr.zones : h.hr_zones,
                      zonesMethod: hr ? hr.method : null,
                      zonesWarning: hr ? hr.warning : null,
                      predictions: (h.predicted_times || []).map((p) => ({
                        id: p.id,
                        label: EVAL_DISTANCES.find((d) => d.id === p.id)?.label || String(p.id || "").toUpperCase(),
                        seconds: p.seconds,
                      })),
                    });
                  })()}
                </div>
              )}
            </div>
          ))
        )}
      </div>
    </div>
  );
}
