import React, { useMemo, useState, useEffect } from "react";
import {
  bogotaSummaryRanges,
  executedActivities,
  formatExecutedDuration,
  monthLabelEs,
  recentBogotaWeeks,
  summarizeExecuted,
  workoutsInRange,
  yearMonthBreakdown,
} from "../../../lib/executedSummaries.js";

const RAF_ATHLETE_PROGRESS_TAB_KEY = "raf_athlete_progress_tab";
const ATHLETE_PROGRESS_TAB_IDS = ["week", "month", "year"];

function readStoredAthleteProgressTab() {
  if (typeof localStorage === "undefined") return "week";
  const raw = localStorage.getItem(RAF_ATHLETE_PROGRESS_TAB_KEY);
  if (raw && ATHLETE_PROGRESS_TAB_IDS.includes(raw)) return raw;
  return "week";
}

function rangeForTab(tab, ranges) {
  if (tab === "week") return ranges.week;
  if (tab === "month") return ranges.month;
  return ranges.year;
}

function ActivityList({ activities }) {
  if (!activities.length) {
    return <div style={{ fontSize: ".82em", color: "#64748b" }}>Sin entrenamientos realizados en este periodo.</div>;
  }
  return (
    <div style={{ display: "flex", flexDirection: "column", gap: 8 }}>
      {activities.map((a) => (
        <div key={a.id || `${a.date}-${a.title}`} style={{ display: "flex", justifyContent: "space-between", gap: 8, fontSize: ".82em" }}>
          <div style={{ minWidth: 0 }}>
            <div style={{ fontWeight: 700, color: "#0f172a" }}>{a.title}</div>
            <div style={{ color: "#64748b" }}>{a.date}</div>
          </div>
          <div style={{ textAlign: "right", color: "#334155", flexShrink: 0 }}>
            <div>{a.missingDistance ? "sin distancia" : `${a.km.toFixed(1)} km`}</div>
            <div style={{ color: "#64748b" }}>
              {[a.durationMin ? `${a.durationMin} min` : null, a.paceLabel].filter(Boolean).join(" · ") || "—"}
            </div>
          </div>
        </div>
      ))}
    </div>
  );
}

function ExecutedFooter({ summary }) {
  return (
    <div style={{ marginTop: 12, paddingTop: 10, borderTop: "1px solid #e2e8f0", fontSize: ".84em", color: "#0f172a", fontWeight: 700 }}>
      {summary.sessions} realizados · {summary.km.toFixed(1)} km reales
      {summary.missingDistance > 0 ? ` · ${summary.missingDistance} sin distancia real` : ""}
    </div>
  );
}

/**
 * Home: card Semana/Mes/Año (encima del calendario).
 * Independiente de forma/fatiga y de logros. Solo lee `workouts`.
 * El tab Semana/Mes/Año vive aqui (raf_athlete_progress_tab).
 * Totales: solo done, km de la ejecución, fechas en America/Bogota.
 */
export function AthleteHomeProgress({ cardStyle, workouts }) {
  const [progressTab, setProgressTab] = useState(() => readStoredAthleteProgressTab());

  useEffect(() => {
    if (typeof localStorage === "undefined") return;
    localStorage.setItem(RAF_ATHLETE_PROGRESS_TAB_KEY, progressTab);
  }, [progressTab]);

  const progressStats = useMemo(() => {
    const ranges = bogotaSummaryRanges(new Date());
    const range = rangeForTab(progressTab, ranges);
    const inRange = workoutsInRange(workouts, range.start, range.end);
    const summary = summarizeExecuted(inRange);
    return {
      ...summary,
      rangeLabel: `${range.start} → ${range.end}`,
      activities: executedActivities(inRange),
      months: progressTab === "year" ? yearMonthBreakdown(workouts, ranges.year.year) : [],
    };
  }, [workouts, progressTab]);

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
          <span style={{ color: "#64748b", fontSize: ".85em" }}>🏃 Kilometraje real</span>
          <span style={{ fontSize: "1.35em", fontWeight: 900, color: "#22c55e", fontFamily: "monospace" }}>{progressStats.km.toFixed(1)} km</span>
        </div>
        <div style={{ display: "flex", justifyContent: "space-between", alignItems: "baseline", gap: 12, flexWrap: "wrap" }}>
          <span style={{ color: "#64748b", fontSize: ".85em" }}>⏱️ Tiempo real</span>
          <span style={{ fontSize: "1.35em", fontWeight: 900, color: "#22c55e", fontFamily: "monospace" }}>{formatExecutedDuration(progressStats.durationMin)}</span>
        </div>
        <div style={{ display: "flex", justifyContent: "space-between", alignItems: "baseline", gap: 12, flexWrap: "wrap" }}>
          <span style={{ color: "#64748b", fontSize: ".85em" }}>🗓️ Sesiones realizadas</span>
          <span style={{ fontSize: "1.35em", fontWeight: 900, color: "#22c55e", fontFamily: "monospace" }}>{progressStats.sessions}</span>
        </div>
      </div>
      {progressStats.missingDistance > 0 ? (
        <div style={{ marginTop: 10, fontSize: ".75em", color: "#b45309" }}>
          {progressStats.missingDistance} realizado{progressStats.missingDistance === 1 ? "" : "s"} sin distancia real: no suma km.
        </div>
      ) : null}
      {progressTab === "month" ? (
        <div style={{ marginTop: 14 }}>
          <ActivityList activities={progressStats.activities} />
          <ExecutedFooter summary={progressStats} />
        </div>
      ) : null}
      {progressTab === "year" ? (
        <div style={{ marginTop: 14 }}>
          {progressStats.months.length === 0 ? (
            <div style={{ fontSize: ".82em", color: "#64748b" }}>Sin entrenamientos realizados este año.</div>
          ) : (
            <div style={{ display: "flex", flexDirection: "column", gap: 6 }}>
              {progressStats.months.map((m) => (
                <div key={m.start} style={{ display: "flex", justifyContent: "space-between", gap: 8, fontSize: ".82em" }}>
                  <span style={{ textTransform: "capitalize", color: "#0f172a", fontWeight: 700 }}>{monthLabelEs(m.year, m.month)}</span>
                  <span style={{ color: "#334155", textAlign: "right" }}>
                    {m.sessions} realizados · {m.km.toFixed(1)} km
                    {m.missingDistance > 0 ? ` · ${m.missingDistance} sin km` : ""}
                  </span>
                </div>
              ))}
            </div>
          )}
          <ExecutedFooter summary={progressStats} />
        </div>
      ) : null}
    </div>
  );
}

/** Tira “Progreso semanal” del home. Va debajo del calendario, no junto a la card. */
export function AthleteWeeklyStrip({ cardStyle, workouts }) {
  const last4WeeksSummary = useMemo(() => {
    return recentBogotaWeeks(new Date(), 4).map((range) => {
      const weekRows = workoutsInRange(workouts, range.start, range.end);
      const summary = summarizeExecuted(weekRows);
      const adherence = weekRows.length > 0 ? Math.round((summary.sessions / weekRows.length) * 100) : 0;
      return {
        key: `${range.start}-${range.end}`,
        label: range.offset === 0 ? "Semana actual" : `Hace ${range.offset} semana${range.offset === 1 ? "" : "s"}`,
        range: `${range.start} → ${range.end}`,
        kmTotal: summary.km,
        completed: summary.sessions,
        total: weekRows.length,
        adherence,
        missingDistance: summary.missingDistance,
      };
    });
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
                  <span>Km reales</span><span style={{ fontWeight: 800, color: "#0f172a" }}>{week.kmTotal.toFixed(1)}</span>
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
 * Perfil -> Mes: lo corrido del mes en Bogotá, contra el mes anterior.
 * Lista las actividades realizadas y cierra con el acumulado real.
 */
export function AthleteMonthSummary({ cardStyle, workouts }) {
  const ranges = bogotaSummaryRanges(new Date());
  const thisMonthWorkouts = workoutsInRange(workouts, ranges.month.start, ranges.month.end);
  const lastMonthWorkouts = workoutsInRange(workouts, ranges.lastMonth.start, ranges.lastMonth.end);
  const thisSummary = summarizeExecuted(thisMonthWorkouts);
  const lastSummary = summarizeExecuted(lastMonthWorkouts);
  const activities = executedActivities(thisMonthWorkouts);
  const bestSession = [...activities].filter((a) => a.km > 0).sort((a, b) => b.km - a.km)[0];
  const adherenceThis = thisMonthWorkouts.length ? Math.round((thisSummary.sessions / thisMonthWorkouts.length) * 100) : 0;
  const adherenceLast = lastMonthWorkouts.length ? Math.round((lastSummary.sessions / lastMonthWorkouts.length) * 100) : 0;
  const kmDelta = thisSummary.km - lastSummary.km;
  const kmDeltaColor = kmDelta >= 0 ? "#16a34a" : "#dc2626";
  const monthLabel = monthLabelEs(ranges.month.year, ranges.month.month);

  return (
    <div style={{ display: "flex", flexDirection: "column", gap: 12 }}>
      <div style={{ ...cardStyle }}>
        <div style={{ fontSize: ".68em", color: "#64748b", textTransform: "uppercase", letterSpacing: ".13em", marginBottom: 10 }}>Resumen · {monthLabel}</div>
        <div style={{ display: "grid", gridTemplateColumns: "1fr 1fr", gap: 10, marginBottom: 12 }}>
          <div style={{ background: "#f8fafc", borderRadius: 10, padding: "12px 14px" }}>
            <div style={{ fontSize: ".68em", color: "#64748b", marginBottom: 4 }}>Km reales</div>
            <div style={{ fontSize: "1.6em", fontWeight: 900, color: "#0f172a", fontFamily: "monospace" }}>{thisSummary.km.toFixed(1)}</div>
            <div style={{ fontSize: ".7em", color: kmDeltaColor, fontWeight: 700, marginTop: 2 }}>
              {kmDelta >= 0 ? "+" : ""}{kmDelta.toFixed(1)} vs mes anterior
            </div>
          </div>
          <div style={{ background: "#f8fafc", borderRadius: 10, padding: "12px 14px" }}>
            <div style={{ fontSize: ".68em", color: "#64748b", marginBottom: 4 }}>Realizados</div>
            <div style={{ fontSize: "1.6em", fontWeight: 900, color: "#0f172a", fontFamily: "monospace" }}>{thisSummary.sessions}</div>
            <div style={{ fontSize: ".7em", color: adherenceThis >= 80 ? "#16a34a" : "#ff8a3d", fontWeight: 700, marginTop: 2 }}>
              {adherenceThis}% adherencia
            </div>
          </div>
        </div>
        {bestSession ? (
          <div style={{ background: "rgba(255,138,61,.06)", border: "1px solid rgba(255,138,61,.25)", borderRadius: 10, padding: "10px 14px", marginBottom: 12 }}>
            <div style={{ fontSize: ".68em", color: "#b45309", fontWeight: 700, marginBottom: 4 }}>🏆 Mejor sesión</div>
            <div style={{ fontWeight: 800, fontSize: ".88em", color: "#0f172a" }}>{bestSession.title}</div>
            <div style={{ fontSize: ".75em", color: "#64748b", marginTop: 2 }}>
              {bestSession.km.toFixed(1)} km
              {bestSession.durationMin ? ` · ${bestSession.durationMin} min` : ""}
              {bestSession.paceLabel ? ` · ${bestSession.paceLabel}` : ""}
              {bestSession.rpe ? ` · RPE ${bestSession.rpe}` : ""}
            </div>
          </div>
        ) : null}
        <div style={{ fontSize: ".68em", color: "#64748b", textTransform: "uppercase", letterSpacing: ".13em", marginBottom: 8 }}>Actividades</div>
        <ActivityList activities={activities} />
        <ExecutedFooter summary={thisSummary} />
      </div>
      <div style={{ ...cardStyle }}>
        <div style={{ fontSize: ".68em", color: "#64748b", textTransform: "uppercase", letterSpacing: ".13em", marginBottom: 10 }}>Comparativa vs mes anterior</div>
        <div style={{ display: "flex", flexDirection: "column", gap: 8 }}>
          {[
            { label: "Km reales", val: thisSummary.km.toFixed(1), prev: lastSummary.km.toFixed(1) },
            { label: "Sesiones realizadas", val: thisSummary.sessions, prev: lastSummary.sessions },
            { label: "Adherencia", val: `${adherenceThis}%`, prev: `${adherenceLast}%` },
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
