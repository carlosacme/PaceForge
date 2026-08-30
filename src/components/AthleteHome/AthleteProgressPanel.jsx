import React, { useMemo, useState, useEffect } from "react";
import {
  formatLocalYMD,
  startOfWeekMonday,
  addDays,
  normalizeScheduledDateYmd,
  formatDurationMinutesTotal,
} from "../shared/appShared";

const RAF_ATHLETE_PROGRESS_TAB_KEY = "raf_athlete_progress_tab";
const ATHLETE_PROGRESS_TAB_IDS = ["week", "month", "year"];

function readStoredAthleteProgressTab() {
  if (typeof localStorage === "undefined") return "week";
  const raw = localStorage.getItem(RAF_ATHLETE_PROGRESS_TAB_KEY);
  if (raw && ATHLETE_PROGRESS_TAB_IDS.includes(raw)) return raw;
  return "week";
}

/**
 * Home: card Semana/Mes/Año (encima del calendario).
 * Independiente de forma/fatiga y de logros. Solo lee `workouts`.
 * El tab Semana/Mes/Año vive aqui (raf_athlete_progress_tab).
 */
export function AthleteHomeProgress({ cardStyle, workouts }) {
  const [progressTab, setProgressTab] = useState(() => readStoredAthleteProgressTab());

  useEffect(() => {
    if (typeof localStorage === "undefined") return;
    localStorage.setItem(RAF_ATHLETE_PROGRESS_TAB_KEY, progressTab);
  }, [progressTab]);

  const todayYmd = formatLocalYMD(new Date());
  const progressRangeYmd = useMemo(() => {
    const now = new Date();
    if (progressTab === "week") {
      const start = startOfWeekMonday(now);
      return { startYmd: formatLocalYMD(start), endYmd: formatLocalYMD(addDays(start, 6)) };
    }
    if (progressTab === "month") {
      const start = new Date(now.getFullYear(), now.getMonth(), 1);
      const end = new Date(now.getFullYear(), now.getMonth() + 1, 0);
      return { startYmd: formatLocalYMD(start), endYmd: formatLocalYMD(end) };
    }
    return { startYmd: formatLocalYMD(new Date(now.getFullYear(), 0, 1)), endYmd: formatLocalYMD(new Date(now.getFullYear(), 11, 31)) };
  }, [progressTab, todayYmd]);

  const progressStats = useMemo(() => {
    const { startYmd, endYmd } = progressRangeYmd;
    const doneInRange = (workouts || []).filter((w) => {
      const ymd = normalizeScheduledDateYmd(w.scheduled_date);
      return ymd && ymd >= startYmd && ymd <= endYmd && w.done;
    });
    const totalKm = doneInRange.reduce((s, w) => s + (Number(w.distance_km) || 0), 0);
    const totalMin = doneInRange.reduce((s, w) => s + (Number(w.duration_min) || 0), 0);
    return { sessions: doneInRange.length, totalKm, totalMin, rangeLabel: `${startYmd} → ${endYmd}` };
  }, [workouts, progressRangeYmd]);

  return (
    <div style={{ ...cardStyle, marginBottom: 14, overflow: "visible" }}>
      <div style={{ display: "flex", gap: 6, marginBottom: 10, flexWrap: "wrap", alignItems: "center" }}>
        {[{ id: "week", label: "Semana" }, { id: "month", label: "Mes" }, { id: "year", label: "Año" }].map((t) => (
          <button key={t.id} type="button" onClick={() => setProgressTab(t.id)} style={{ border: "1px solid #e2e8f0", borderRadius: 8, padding: "8px 12px", background: progressTab === t.id ? "rgba(255,138,61,.14)" : "#fff", fontWeight: progressTab === t.id ? 800 : 600, cursor: "pointer", fontFamily: "inherit", fontSize: ".78em", color: progressTab === t.id ? "#c2410c" : "#64748b" }}>{t.label}</button>
        ))}
      </div>
      <div style={{ color: "#64748b", fontSize: ".8em", marginBottom: 12 }}>{progressStats.rangeLabel}</div>
      <div style={{ display: "flex", flexDirection: "column", gap: 12 }}>
        <div style={{ display: "flex", justifyContent: "space-between", alignItems: "baseline", gap: 12, flexWrap: "wrap" }}>
          <span style={{ color: "#64748b", fontSize: ".85em" }}>🏃 Kilometraje total</span>
          <span style={{ fontSize: "1.35em", fontWeight: 900, color: "#22c55e", fontFamily: "monospace" }}>{progressStats.totalKm.toFixed(1)} km</span>
        </div>
        <div style={{ display: "flex", justifyContent: "space-between", alignItems: "baseline", gap: 12, flexWrap: "wrap" }}>
          <span style={{ color: "#64748b", fontSize: ".85em" }}>⏱️ Tiempo total</span>
          <span style={{ fontSize: "1.35em", fontWeight: 900, color: "#22c55e", fontFamily: "monospace" }}>{formatDurationMinutesTotal(progressStats.totalMin)}</span>
        </div>
        <div style={{ display: "flex", justifyContent: "space-between", alignItems: "baseline", gap: 12, flexWrap: "wrap" }}>
          <span style={{ color: "#64748b", fontSize: ".85em" }}>🗓️ Sesiones completadas</span>
          <span style={{ fontSize: "1.35em", fontWeight: 900, color: "#22c55e", fontFamily: "monospace" }}>{progressStats.sessions}</span>
        </div>
      </div>
    </div>
  );
}

/** Tira “Progreso semanal” del home. Va debajo del calendario, no junto a la card. */
export function AthleteWeeklyStrip({ cardStyle, workouts }) {
  const last4WeeksSummary = useMemo(() => {
    const rows = [];
    const currentStart = startOfWeekMonday(new Date());
    for (let i = 0; i < 4; i += 1) {
      const start = addDays(currentStart, -(i * 7));
      const end = addDays(start, 6);
      const startYmd = formatLocalYMD(start);
      const endYmd = formatLocalYMD(end);
      const weekRows = (workouts || []).filter((w) => {
        const ymd = normalizeScheduledDateYmd(w.scheduled_date);
        return ymd && ymd >= startYmd && ymd <= endYmd;
      });
      const kmTotal = weekRows.reduce((sum, w) => sum + (Number(w.total_km) || 0), 0);
      const completed = weekRows.filter((w) => w.done).length;
      const adherence = weekRows.length > 0 ? Math.round((completed / weekRows.length) * 100) : 0;
      rows.push({ key: `${startYmd}-${endYmd}`, label: i === 0 ? "Semana actual" : `Hace ${i} semana${i === 1 ? "" : "s"}`, range: `${startYmd} → ${endYmd}`, kmTotal, completed, total: weekRows.length, adherence });
    }
    return rows;
  }, [workouts]);

  return (
    <div style={{ ...cardStyle, marginBottom: 14, maxWidth: "100%", minWidth: 0, overflow: "hidden" }}>
      <div style={{ fontSize: ".72em", letterSpacing: ".13em", color: "#475569", textTransform: "uppercase", marginBottom: 12 }}>Progreso semanal</div>
      <div style={{ display: "flex", gap: 8, overflowX: "auto", paddingBottom: 4, maxWidth: "100%", minWidth: 0, WebkitOverflowScrolling: "touch" }}>
        {last4WeeksSummary.map((week, idx) => {
          const isCurrentWeek = idx === 0;
          const adherencePct = week.adherence;
          const adherenceColor = adherencePct >= 80 ? "#22c55e" : adherencePct >= 50 ? "#f59e0b" : "#ef4444";
          const maxKm = Math.max(...last4WeeksSummary.map((w) => w.kmTotal), 1);
          const kmPct = Math.round((week.kmTotal / maxKm) * 100);
          return (
            <div key={week.key} style={{ flex: "0 0 auto", width: 140, border: isCurrentWeek ? "2px solid rgba(255,138,61,.5)" : "1px solid #e2e8f0", borderRadius: 12, padding: "12px 10px", background: isCurrentWeek ? "rgba(255,138,61,.04)" : "#fafafa" }}>
              <div style={{ fontWeight: 800, fontSize: ".78em", color: isCurrentWeek ? "#b45309" : "#475569" }}>{week.label}</div>
              <div style={{ fontSize: ".6em", color: "#94a3b8", marginBottom: 10 }}>{week.range}</div>
              <div style={{ marginBottom: 8 }}>
                <div style={{ display: "flex", justifyContent: "space-between", fontSize: ".65em", color: "#64748b", marginBottom: 3 }}>
                  <span>Km</span><span style={{ fontWeight: 800, color: "#0f172a" }}>{week.kmTotal.toFixed(1)}</span>
                </div>
                <div style={{ height: 5, background: "#e2e8f0", borderRadius: 999 }}>
                  <div style={{ height: "100%", width: kmPct + "%", background: "linear-gradient(90deg,#ff8a3d,#f97316)", borderRadius: 999, transition: "width .3s" }} />
                </div>
              </div>
              <div style={{ marginBottom: 8 }}>
                <div style={{ display: "flex", justifyContent: "space-between", fontSize: ".65em", color: "#64748b", marginBottom: 3 }}>
                  <span>Adherencia</span><span style={{ fontWeight: 800, color: adherenceColor }}>{adherencePct}%</span>
                </div>
                <div style={{ height: 5, background: "#e2e8f0", borderRadius: 999 }}>
                  <div style={{ height: "100%", width: adherencePct + "%", background: adherenceColor, borderRadius: 999, transition: "width .3s" }} />
                </div>
              </div>
              <div style={{ fontSize: ".62em", color: "#94a3b8" }}>{week.completed}/{week.total} sesiones</div>
            </div>
          );
        })}
      </div>
    </div>
  );
}

/**
 * Perfil -> Mes: resumen del mes actual vs el anterior.
 * 0 estados. No comparte memos con el home ni con forma/logros.
 */
export function AthleteMonthSummary({ cardStyle, workouts }) {
  const now = new Date();
  const y = now.getFullYear();
  const m = now.getMonth();
  const p2 = (n) => String(n).padStart(2, "0");
  const startThisMonth = `${y}-${p2(m + 1)}-01`;
  const endThisMonth = `${y}-${p2(m + 1)}-${p2(new Date(y, m + 1, 0).getDate())}`;
  const startLastMonth = `${y}-${p2(m === 0 ? 12 : m)}-01`;
  const endLastMonth = `${y}-${p2(m === 0 ? 12 : m)}-${p2(new Date(y, m, 0).getDate())}`;
  const monthLabel = now.toLocaleDateString("es", { month: "long", year: "numeric" });
  const thisMonthWorkouts = (workouts || []).filter((w) => w.scheduled_date >= startThisMonth && w.scheduled_date <= endThisMonth);
  const lastMonthWorkouts = (workouts || []).filter((w) => w.scheduled_date >= startLastMonth && w.scheduled_date <= endLastMonth);
  const doneThis = thisMonthWorkouts.filter((w) => w.done);
  const doneLast = lastMonthWorkouts.filter((w) => w.done);
  const kmThis = doneThis.reduce((s, w) => s + (Number(w.total_km) || 0), 0);
  const kmLast = doneLast.reduce((s, w) => s + (Number(w.total_km) || 0), 0);
  const adherenceThis = thisMonthWorkouts.length ? Math.round((doneThis.length / thisMonthWorkouts.length) * 100) : 0;
  const bestSession = doneThis.sort((a, b) => (Number(b.total_km) || 0) - (Number(a.total_km) || 0))[0];
  const kmDelta = kmThis - kmLast;
  const kmDeltaColor = kmDelta >= 0 ? "#16a34a" : "#dc2626";

  return (
    <div style={{ display: "flex", flexDirection: "column", gap: 12 }}>
      <div style={{ ...cardStyle }}>
        <div style={{ fontSize: ".68em", color: "#64748b", textTransform: "uppercase", letterSpacing: ".13em", marginBottom: 10 }}>Resumen · {monthLabel}</div>
        <div style={{ display: "grid", gridTemplateColumns: "1fr 1fr", gap: 10, marginBottom: 12 }}>
          <div style={{ background: "#f8fafc", borderRadius: 10, padding: "12px 14px" }}>
            <div style={{ fontSize: ".68em", color: "#64748b", marginBottom: 4 }}>Km totales</div>
            <div style={{ fontSize: "1.6em", fontWeight: 900, color: "#0f172a", fontFamily: "monospace" }}>{kmThis.toFixed(1)}</div>
            <div style={{ fontSize: ".7em", color: kmDeltaColor, fontWeight: 700, marginTop: 2 }}>
              {kmDelta >= 0 ? "+" : ""}{kmDelta.toFixed(1)} vs mes anterior
            </div>
          </div>
          <div style={{ background: "#f8fafc", borderRadius: 10, padding: "12px 14px" }}>
            <div style={{ fontSize: ".68em", color: "#64748b", marginBottom: 4 }}>Sesiones</div>
            <div style={{ fontSize: "1.6em", fontWeight: 900, color: "#0f172a", fontFamily: "monospace" }}>{doneThis.length}/{thisMonthWorkouts.length}</div>
            <div style={{ fontSize: ".7em", color: adherenceThis >= 80 ? "#16a34a" : "#ff8a3d", fontWeight: 700, marginTop: 2 }}>
              {adherenceThis}% adherencia
            </div>
          </div>
        </div>
        {bestSession && (
          <div style={{ background: "rgba(255,138,61,.06)", border: "1px solid rgba(255,138,61,.25)", borderRadius: 10, padding: "10px 14px" }}>
            <div style={{ fontSize: ".68em", color: "#b45309", fontWeight: 700, marginBottom: 4 }}>🏆 Mejor sesión</div>
            <div style={{ fontWeight: 800, fontSize: ".88em", color: "#0f172a" }}>{bestSession.title}</div>
            <div style={{ fontSize: ".75em", color: "#64748b", marginTop: 2 }}>{Number(bestSession.total_km || 0).toFixed(1)} km · {bestSession.duration_min || 0} min{bestSession.rpe ? " · RPE " + bestSession.rpe : ""}</div>
          </div>
        )}
      </div>
      <div style={{ ...cardStyle }}>
        <div style={{ fontSize: ".68em", color: "#64748b", textTransform: "uppercase", letterSpacing: ".13em", marginBottom: 10 }}>Comparativa vs mes anterior</div>
        <div style={{ display: "flex", flexDirection: "column", gap: 8 }}>
          {[
            { label: "Km totales", val: kmThis.toFixed(1), prev: kmLast.toFixed(1), unit: "km" },
            { label: "Sesiones completadas", val: doneThis.length, prev: doneLast.length, unit: "" },
            { label: "Adherencia", val: adherenceThis + "%", prev: (lastMonthWorkouts.length ? Math.round((doneLast.length / lastMonthWorkouts.length) * 100) : 0) + "%", unit: "" },
          ].map((row) => (
            <div key={row.label} style={{ display: "flex", justifyContent: "space-between", alignItems: "center", padding: "8px 0", borderBottom: "1px solid #f1f5f9" }}>
              <span style={{ fontSize: ".8em", color: "#475569" }}>{row.label}</span>
              <div style={{ display: "flex", gap: 12, alignItems: "center" }}>
                <span style={{ fontSize: ".72em", color: "#94a3b8" }}>{row.prev}</span>
                <span style={{ fontSize: ".72em", color: "#94a3b8" }}>→</span>
                <span style={{ fontWeight: 800, fontSize: ".88em", color: "#0f172a" }}>{row.val}</span>
              </div>
            </div>
          ))}
        </div>
      </div>
    </div>
  );
}
