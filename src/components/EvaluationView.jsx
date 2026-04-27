import React, { useState, useEffect, useMemo, useCallback } from "react";
import { supabase } from "../lib/supabase";
import { EVAL_DISTANCES, formatDurationClock } from "./shared/appShared";

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

const velocityToVo2 = (vMetersPerMin) => -4.6 + 0.182258 * vMetersPerMin + 0.000104 * vMetersPerMin * vMetersPerMin;

const timePercentVo2 = (tMin) => 0.8 + 0.1894393 * Math.exp(-0.012778 * tMin) + 0.2989558 * Math.exp(-0.1932605 * tMin);

const vdotFromRace = (distanceMeters, totalSeconds) => {
  const tMin = Number(totalSeconds) / 60;
  if (!Number.isFinite(distanceMeters) || !Number.isFinite(tMin) || distanceMeters <= 0 || tMin <= 0) return null;
  const v = distanceMeters / tMin;
  const vo2 = velocityToVo2(v);
  const pct = timePercentVo2(tMin);
  if (!Number.isFinite(vo2) || !Number.isFinite(pct) || pct <= 0) return null;
  return vo2 / pct;
};

const vdotFromCooper = (distanceMeters) => {
  const d = Number(distanceMeters);
  if (!Number.isFinite(d) || d <= 0) return null;
  return (d - 504.9) / 44.73;
};

const velocityFromVo2 = (targetVo2) => {
  const a = 0.000104;
  const b = 0.182258;
  const c = -(targetVo2 + 4.6);
  const disc = b * b - 4 * a * c;
  if (disc <= 0) return null;
  return (-b + Math.sqrt(disc)) / (2 * a);
};

const predictTimeFromVdot = (vdot, distanceMeters) => {
  if (!Number.isFinite(vdot) || vdot <= 0) return null;
  let lo = 5;
  let hi = 360;
  for (let i = 0; i < 60; i += 1) {
    const mid = (lo + hi) / 2;
    const v = distanceMeters / mid;
    const current = velocityToVo2(v) / timePercentVo2(mid);
    if (current > vdot) lo = mid;
    else hi = mid;
  }
  return hi * 60;
};

const computeHrZones = (fcMax, fcRest) => {
  const max = Number(fcMax);
  if (!Number.isFinite(max) || max <= 0) return [];
  const rest = Number(fcRest);
  const useKarvonen = Number.isFinite(rest) && rest > 0 && rest < max;
  const ranges = [
    { z: "Z1", low: 0.5, high: 0.6, color: "#22c55e" },
    { z: "Z2", low: 0.6, high: 0.7, color: "#3b82f6" },
    { z: "Z3", low: 0.7, high: 0.8, color: "#f59e0b" },
    { z: "Z4", low: 0.8, high: 0.9, color: "#f97316" },
    { z: "Z5", low: 0.9, high: 1.0, color: "#ef4444" },
  ];
  return ranges.map((r) => {
    if (useKarvonen) {
      const reserve = max - rest;
      return {
        ...r,
        lowBpm: Math.round(rest + reserve * r.low),
        highBpm: Math.round(rest + reserve * r.high),
      };
    }
    return {
      ...r,
      lowBpm: Math.round(max * r.low),
      highBpm: Math.round(max * r.high),
    };
  });
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
  const [tab, setTab] = useState("race");
  const [raceDistance, setRaceDistance] = useState("10k");
  const [raceTime, setRaceTime] = useState("00:45:00");
  const [cooperDistance, setCooperDistance] = useState("2800");
  const [thresholdTime, setThresholdTime] = useState("00:30:00");
  const [thresholdDistance, setThresholdDistance] = useState("7000");
  const [fcMax, setFcMax] = useState("");
  const [fcRest, setFcRest] = useState("");
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
      if (typeof parsed.fcMax === "string") setFcMax(parsed.fcMax);
      if (typeof parsed.fcRest === "string") setFcRest(parsed.fcRest);
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
      fcMax,
      fcRest,
    };
    localStorage.setItem(EVAL_FORM_STORAGE_KEY, JSON.stringify(payload));
  }, [athleteId, tab, raceDistance, raceTime, cooperDistance, thresholdTime, thresholdDistance, fcMax, fcRest]);

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

    const paceFractions = [
      { key: "Easy", frac: 0.65, color: "#22c55e" },
      { key: "Maratón", frac: 0.76, color: "#3b82f6" },
      { key: "Umbral", frac: 0.84, color: "#f59e0b" },
      { key: "Intervalos", frac: 0.95, color: "#ef4444" },
      { key: "Repeticiones", frac: 1.0, color: "#8b5cf6" },
    ];
    const paces = paceFractions.map((p) => {
      const v = velocityFromVo2(vdot * p.frac);
      const pace = v ? 1000 / v : null;
      return { ...p, paceMinKm: pace };
    });
    const predictions = EVAL_DISTANCES.map((d) => ({
      ...d,
      seconds: predictTimeFromVdot(vdot, d.meters),
    }));
    const zones = computeHrZones(fcMax, fcRest);
    setResults({
      vdot,
      source,
      paces,
      zones,
      predictions,
      fc_max: Number(fcMax) || null,
      fc_reposo: Number(fcRest) || null,
      method: tab,
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
    };
    const { error: insErr } = await supabase.from("athlete_evaluations").insert(payload);
    if (insErr) {
      setSaving(false);
      console.error(insErr);
      notify?.(`No se pudo guardar evaluación: ${insErr.message}`);
      return;
    }
    const { error: updErr } = await supabase
      .from("athletes")
      .update({ fc_max: results.fc_max, fc_reposo: results.fc_reposo })
      .eq("id", athleteId);
    setSaving(false);
    if (updErr) {
      console.error(updErr);
      notify?.(`Evaluación guardada, pero no se pudo actualizar FC: ${updErr.message}`);
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
          <div style={{ fontSize: ".76em", color: "#64748b", fontWeight: 700, marginBottom: 10 }}>ZONAS DE FC</div>
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
            <input value={fcMax} onChange={(e) => setFcMax(e.target.value)} placeholder="Ej. 188" style={{ width: "100%", border: "1px solid #e2e8f0", borderRadius: 8, padding: "10px 12px", fontFamily: "inherit" }} />
          </div>
          <div>
            <div style={{ fontSize: ".74em", color: "#64748b", marginBottom: 6, fontWeight: 700 }}>FC reposo</div>
            <input value={fcRest} onChange={(e) => setFcRest(e.target.value)} placeholder="Ej. 52" style={{ width: "100%", border: "1px solid #e2e8f0", borderRadius: 8, padding: "10px 12px", fontFamily: "inherit" }} />
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
          <div style={{ display: "grid", gap: 12, gridTemplateColumns: "repeat(auto-fit, minmax(220px, 1fr))", marginTop: 14 }}>
            <input value={thresholdTime} onChange={(e) => setThresholdTime(e.target.value)} placeholder="Tiempo hh:mm:ss" style={{ border: "1px solid #e2e8f0", borderRadius: 8, padding: "10px 12px", fontFamily: "inherit" }} />
            <input value={thresholdDistance} onChange={(e) => setThresholdDistance(e.target.value)} placeholder="Distancia (m)" style={{ border: "1px solid #e2e8f0", borderRadius: 8, padding: "10px 12px", fontFamily: "inherit" }} />
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
                  </div>
                  {renderEvaluationCards({
                    vdot: h.vdot,
                    paces: h.paces,
                    zones: h.hr_zones,
                    predictions: (h.predicted_times || []).map((p) => ({
                      id: p.id,
                      label: EVAL_DISTANCES.find((d) => d.id === p.id)?.label || String(p.id || "").toUpperCase(),
                      seconds: p.seconds,
                    })),
                  })}
                </div>
              )}
            </div>
          ))
        )}
      </div>
    </div>
  );
}
