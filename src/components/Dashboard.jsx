import React, { useState, useEffect, useMemo, useCallback } from "react";
import { supabase } from "../lib/supabase";
import { useAppResumeRefresh } from "../hooks/useAppResumeRefresh";
import {
  styles,
  sumWeekKm,
  formatLocalYMD,
  startOfWeekMonday,
  addDays,
  normalizeWorkoutRow,
  isAuthLockContentionError,
  withAuthLockRetry,
} from "./shared/appShared";
import CoachRequestsInbox from "./CoachRequestsInbox";
import { useCoachRequests } from "../hooks/useCoachRequests";

const MONTH_INDEX = {
  Jan: 0, Feb: 1, Mar: 2, Apr: 3, May: 4, Jun: 5,
  Jul: 6, Aug: 7, Sep: 8, Oct: 9, Nov: 10, Dec: 11,
};

/** Etiqueta de carrera y días restantes (para tablas y métricas). */
export const getRaceMeta = (nextRace) => {
  if (!nextRace || typeof nextRace !== "string") return { name: "—", daysLeft: null };
  const [raceNameRaw, datePartRaw] = nextRace.split(" - ");
  const raceName = (raceNameRaw || "Próxima carrera").trim();
  const datePart = (datePartRaw || "").trim();
  const [monthAbbr, dayRaw] = datePart.split(/\s+/);
  const month = MONTH_INDEX[monthAbbr];
  const day = Number(dayRaw);
  if (month === undefined || !Number.isFinite(day)) {
    return { name: raceName, daysLeft: null };
  }
  const now = new Date();
  const today = new Date(now.getFullYear(), now.getMonth(), now.getDate());
  let raceDate = new Date(today.getFullYear(), month, day);
  if (raceDate < today) raceDate = new Date(today.getFullYear() + 1, month, day);
  const diffMs = raceDate.getTime() - today.getTime();
  const daysLeft = Math.ceil(diffMs / (1000 * 60 * 60 * 24));
  return { name: raceName, daysLeft };
};

export const ProgressBar = ({ value, total, color = "#ff8a3d" }) => (
  <div style={{ background: "#f1f5f9", borderRadius: 4, height: 5, overflow: "hidden", marginTop: 6 }}>
    <div style={{ width: `${(value / total) * 100}%`, height: "100%", background: color, borderRadius: 4 }} />
  </div>
);

/**
 * Panel coach: métricas de la semana + detalle por atleta.
 * Los atletas vienen del shell (misma lista que Athletes); solo se consultan
 * workouts de la semana (incluye coach_id del staff del equipo).
 */
function Dashboard({
  athletes = [],
  coachUserId,
  onSelect,
  onRequestAddAthlete,
  showAddAthleteForm,
  planLimitWarning,
  onGoToPlans,
  onDismissPlanLimitWarning,
  newAthlete,
  onChangeNewAthleteField,
  onSaveNewAthlete,
  onCancelAddAthlete,
  notify,
  onReloadAthletes,
}) {
  const S = styles;
  const weekStart = useMemo(() => startOfWeekMonday(new Date()), []);
  const weekEnd = useMemo(() => addDays(weekStart, 6), [weekStart]);
  const weekRangeLabel = useMemo(() => {
    const opt = { day: "numeric", month: "long", year: "numeric" };
    return `Semana del ${weekStart.toLocaleDateString("es", opt)} al ${weekEnd.toLocaleDateString("es", opt)}`;
  }, [weekStart, weekEnd]);

  const [weekWorkouts, setWeekWorkouts] = useState([]);
  const [dashLoading, setDashLoading] = useState(true);

  const handleRequestAccepted = useCallback(async () => {
    if (typeof onReloadAthletes === "function") {
      await onReloadAthletes({ silent: true });
    }
  }, [onReloadAthletes]);

  const { pendingRequests, requestsBusyId, loadingRequests, updateCoachRequestStatus } = useCoachRequests({
    coachUserId,
    notify,
    onAccepted: handleRequestAccepted,
  });

  useEffect(() => {
    if (typeof sessionStorage === "undefined") return;
    if (sessionStorage.getItem("raf_scroll_coach_requests") !== "1") return;
    sessionStorage.removeItem("raf_scroll_coach_requests");
    const t = window.setTimeout(() => {
      document.getElementById("coach-pending-requests")?.scrollIntoView({ behavior: "smooth", block: "start" });
    }, 80);
    return () => window.clearTimeout(t);
  }, [pendingRequests.length]);

  const loadDashboardData = useCallback(async (silent) => {
    if (!coachUserId) {
      setWeekWorkouts([]);
      setDashLoading(false);
      return;
    }
    if (!silent) setDashLoading(true);
    const ws = formatLocalYMD(weekStart);
    const we = formatLocalYMD(weekEnd);
    try {
      await withAuthLockRetry(async () => {
        const { data: staffRows, error: staffErr } = await supabase
          .from("coach_staff")
          .select("staff_id")
          .eq("coach_id", coachUserId);
        if (isAuthLockContentionError(staffErr)) throw staffErr;
        const staffIds = (staffRows || []).map((s) => s.staff_id);
        // Workouts del coach y del staff (coach_id del autor del workout).
        const allCoachIds = [coachUserId, ...staffIds];

        const { data, error } = await supabase
          .from("workouts")
          .select("*")
          .in("coach_id", allCoachIds)
          .gte("scheduled_date", ws)
          .lte("scheduled_date", we);
        if (isAuthLockContentionError(error)) throw error;
        if (error) {
          console.error("Dashboard workouts:", error);
          setWeekWorkouts([]);
        } else {
          setWeekWorkouts((data || []).map(normalizeWorkoutRow));
        }
      });
    } catch (err) {
      console.error("Dashboard load:", err);
      setWeekWorkouts([]);
    } finally {
      if (!silent) setDashLoading(false);
    }
  }, [coachUserId, weekStart, weekEnd]);

  useEffect(() => {
    loadDashboardData(false);
  }, [loadDashboardData]);

  // athletes/workouts NO estan en supabase_realtime (solo messages). Una
  // suscripcion aqui era ruido: el canal "ok" no traia eventos. El dashboard
  // se actualiza al volver a la app (resume) y al montar/cambiar de semana.
  useAppResumeRefresh(() => {
    loadDashboardData(true);
  }, Boolean(coachUserId));

  // Km de la semana a partir de los workouts que ya estan cargados (misma
  // consulta de siempre), no del weekly_km declarado en la ficha del atleta.
  const weekKm = useMemo(() => sumWeekKm(weekWorkouts), [weekWorkouts]);

  const weekKmDonePct = weekKm.planned > 0 ? Math.round((weekKm.actual / weekKm.planned) * 100) : 0;

  const { weekWorkoutsTotal, weekWorkoutsDone, weekAvgRpe, weekRpeCount } = useMemo(() => {
    const total = weekWorkouts.length;
    const done = weekWorkouts.filter((w) => w.done).length;
    const rpeVals = weekWorkouts.filter((w) => w.done && w.rpe != null).map((w) => w.rpe);
    const avgRpe = rpeVals.length ? rpeVals.reduce((a, b) => a + b, 0) / rpeVals.length : null;
    return { weekWorkoutsTotal: total, weekWorkoutsDone: done, weekAvgRpe: avgRpe, weekRpeCount: rpeVals.length };
  }, [weekWorkouts]);

  const globalAdherencePct = weekWorkoutsTotal > 0
    ? Math.round((weekWorkoutsDone / weekWorkoutsTotal) * 100)
    : 0;

  const athleteRows = useMemo(() => {
    return (athletes || []).map((a) => {
      const forAthlete = weekWorkouts.filter((w) => String(w.athlete_id) === String(a.id));
      const weekTotal = forAthlete.length;
      const weekDone = forAthlete.filter((w) => w.done).length;
      const adherencePct = weekTotal > 0 ? Math.round((weekDone / weekTotal) * 100) : 0;
      const { name: raceName, daysLeft } = getRaceMeta(a.next_race);
      return { athlete: a, weekTotal, weekDone, adherencePct, raceName, daysLeft, km: sumWeekKm(forAthlete) };
    });
  }, [athletes, weekWorkouts]);

  const maxWeeklyKm = useMemo(
    () => Math.max(1, ...athleteRows.map((r) => r.km.planned)),
    [athleteRows],
  );

  return (
    <div style={{ ...S.page, display: "flex", flexDirection: "column" }}>
      <div style={{ marginBottom: 28 }}>
        <div style={{ display: "flex", alignItems: "flex-start", justifyContent: "space-between", gap: 16 }}>
          <div>
            <h1 style={S.pageTitle}>Panel</h1>
            <p style={{ color: "#475569", fontSize: ".82em", marginTop: 4 }}>{weekRangeLabel} · datos en vivo</p>
          </div>
          <button
            onClick={onRequestAddAthlete}
            style={{
              background: "#f8fafc",
              border: "1px solid #e2e8f0",
              borderRadius: 10,
              padding: "10px 14px",
              color: "#0f172a",
              cursor: "pointer",
              fontFamily: "inherit",
              fontSize: ".85em",
              fontWeight: 700,
              whiteSpace: "nowrap",
            }}
          >
            ＋ Nuevo Atleta
          </button>
        </div>
      </div>

      <div style={{ ...S.card, marginBottom: 16, border: pendingRequests.length ? "1px solid rgba(255,138,61,.4)" : "1px solid #e2e8f0" }}>
        <CoachRequestsInbox
          pendingRequests={pendingRequests}
          requestsBusyId={requestsBusyId}
          loading={loadingRequests}
          onAccept={(r) => updateCoachRequestStatus(r, "accepted")}
          onReject={(r) => updateCoachRequestStatus(r, "rejected")}
          emptyText="Cuando un atleta pida entrenador, la solicitud aparece aquí para que no tengas que ir a Configuración."
        />
      </div>

      {planLimitWarning ? (
        <div style={{ ...S.card, marginBottom: 16, border: "1px solid rgba(255,138,61,.4)", background: "#fffbeb" }}>
          <div style={{ color: "#92400e", fontSize: ".86em", fontWeight: 700, marginBottom: 10 }}>
            {planLimitWarning}
          </div>
          <div style={{ display: "flex", gap: 8, justifyContent: "flex-end", flexWrap: "wrap" }}>
            <button
              type="button"
              onClick={onDismissPlanLimitWarning}
              style={{ background: "#fff", border: "1px solid #e2e8f0", borderRadius: 8, padding: "8px 12px", color: "#64748b", fontWeight: 700, cursor: "pointer", fontFamily: "inherit", fontSize: ".8em" }}
            >
              Cerrar
            </button>
            <button
              type="button"
              onClick={onGoToPlans}
              style={{ background: "linear-gradient(135deg,#0d9488,#14b8a6)", border: "none", borderRadius: 8, padding: "8px 12px", color: "#fff", fontWeight: 800, cursor: "pointer", fontFamily: "inherit", fontSize: ".8em" }}
            >
              Ver Planes
            </button>
          </div>
        </div>
      ) : null}

      {!dashLoading && athletes.length === 0 && !showAddAthleteForm ? (
        <div style={{ marginBottom: 20, borderRadius: 14, background: "linear-gradient(135deg,rgba(13,148,136,.07),rgba(20,184,166,.04))", border: "1px solid rgba(13,148,136,.25)", padding: "20px 22px" }}>
          <div style={{ fontWeight: 900, color: "#0f172a", fontSize: "1.05em", marginBottom: 6 }}>Bienvenido a RunningApexFlow</div>
          <div style={{ color: "#475569", fontSize: ".84em", marginBottom: 18 }}>Sigue estos pasos para comenzar a entrenar a tus atletas:</div>
          <div style={{ display: "flex", flexDirection: "column", gap: 12 }}>
            <div style={{ display: "flex", alignItems: "center", gap: 12 }}>
              <div style={{ width: 28, height: 28, borderRadius: 999, background: "#0d9488", color: "#fff", fontWeight: 900, fontSize: ".8em", display: "flex", alignItems: "center", justifyContent: "center", flexShrink: 0 }}>1</div>
              <div style={{ flex: 1 }}>
                <div style={{ fontWeight: 800, color: "#0f172a", fontSize: ".88em" }}>Cuenta creada</div>
                <div style={{ color: "#64748b", fontSize: ".78em" }}>Ya tienes acceso a todas las funciones durante 7 dias</div>
              </div>
              <span style={{ color: "#0d9488", fontWeight: 900 }}>Listo</span>
            </div>
            <div style={{ display: "flex", alignItems: "center", gap: 12 }}>
              <div style={{ width: 28, height: 28, borderRadius: 999, background: "#ff8a3d", color: "#fff", fontWeight: 900, fontSize: ".8em", display: "flex", alignItems: "center", justifyContent: "center", flexShrink: 0 }}>2</div>
              <div style={{ flex: 1 }}>
                <div style={{ fontWeight: 800, color: "#0f172a", fontSize: ".88em" }}>Agrega tu primer atleta</div>
                <div style={{ color: "#64748b", fontSize: ".78em" }}>Comparte tu codigo de coach o invitalo por email</div>
              </div>
              <button type="button" onClick={onRequestAddAthlete} style={{ padding: "6px 14px", borderRadius: 8, border: "none", background: "linear-gradient(135deg,#ff8a3d,#d97706)", color: "#fff", fontWeight: 800, cursor: "pointer", fontFamily: "inherit", fontSize: ".75em", whiteSpace: "nowrap" }}>Agregar</button>
            </div>
            <div style={{ display: "flex", alignItems: "center", gap: 12, opacity: 0.5 }}>
              <div style={{ width: 28, height: 28, borderRadius: 999, background: "#94a3b8", color: "#fff", fontWeight: 900, fontSize: ".8em", display: "flex", alignItems: "center", justifyContent: "center", flexShrink: 0 }}>3</div>
              <div style={{ flex: 1 }}>
                <div style={{ fontWeight: 800, color: "#0f172a", fontSize: ".88em" }}>Crea el primer workout</div>
                <div style={{ color: "#64748b", fontSize: ".78em" }}>Ve a Entrenamientos y usa el Builder con IA</div>
              </div>
              <span style={{ color: "#94a3b8", fontSize: ".75em", fontWeight: 700 }}>Pendiente</span>
            </div>
          </div>
        </div>
      ) : null}

      {showAddAthleteForm && (
        <div style={{ marginBottom: 22, background: "#ffffff", border: "1px solid #e2e8f0", borderRadius: 12, padding: 18 }}>
          <div style={{ fontSize: ".75em", letterSpacing: ".13em", color: "#475569", textTransform: "uppercase", marginBottom: 14 }}>
            Nuevo Atleta
          </div>
          <div style={{ display: "grid", gridTemplateColumns: "1fr 1fr", gap: 12, marginBottom: 14 }}>
            <div>
              <div style={{ fontSize: ".72em", color: "#64748b", marginBottom: 6 }}>Nombre</div>
              <input
                value={newAthlete.name}
                onChange={e => onChangeNewAthleteField("name", e.target.value)}
                placeholder="Ej: Carlos Rojas"
                style={{ width: "100%", background: "#ffffff", border: "1px solid #e2e8f0", borderRadius: 8, padding: "10px 12px", color: "#0f172a", fontFamily: "inherit", fontSize: ".85em", outline: "none", boxSizing: "border-box" }}
              />
            </div>
            <div>
              <div style={{ fontSize: ".72em", color: "#64748b", marginBottom: 6 }}>Correo</div>
              <input
                type="email"
                value={newAthlete.email}
                onChange={e => onChangeNewAthleteField("email", e.target.value)}
                placeholder="atleta@correo.com"
                style={{ width: "100%", background: "#ffffff", border: "1px solid #e2e8f0", borderRadius: 8, padding: "10px 12px", color: "#0f172a", fontFamily: "inherit", fontSize: ".85em", outline: "none", boxSizing: "border-box" }}
              />
            </div>
            <div>
              <div style={{ fontSize: ".72em", color: "#64748b", marginBottom: 6 }}>Ritmo por km</div>
              <input
                value={newAthlete.pace}
                onChange={e => onChangeNewAthleteField("pace", e.target.value)}
                placeholder="Ej: 5:10/km"
                style={{ width: "100%", background: "#ffffff", border: "1px solid #e2e8f0", borderRadius: 8, padding: "10px 12px", color: "#0f172a", fontFamily: "inherit", fontSize: ".85em", outline: "none", boxSizing: "border-box" }}
              />
            </div>
            <div style={{ gridColumn: "1 / -1" }}>
              <div style={{ fontSize: ".72em", color: "#64748b", marginBottom: 6 }}>Objetivo</div>
              <input
                value={newAthlete.goal}
                onChange={e => onChangeNewAthleteField("goal", e.target.value)}
                placeholder="Ej: Sub 3:45 Maratón"
                style={{ width: "100%", background: "#ffffff", border: "1px solid #e2e8f0", borderRadius: 8, padding: "10px 12px", color: "#0f172a", fontFamily: "inherit", fontSize: ".85em", outline: "none", boxSizing: "border-box" }}
              />
            </div>
            <div>
              <div style={{ fontSize: ".72em", color: "#64748b", marginBottom: 6 }}>Km semanales</div>
              <input
                type="number"
                value={newAthlete.weekly_km}
                onChange={e => onChangeNewAthleteField("weekly_km", e.target.value)}
                placeholder="Ej: 65"
                min="1"
                step="1"
                style={{ width: "100%", background: "#ffffff", border: "1px solid #e2e8f0", borderRadius: 8, padding: "10px 12px", color: "#0f172a", fontFamily: "inherit", fontSize: ".85em", outline: "none", boxSizing: "border-box" }}
              />
            </div>
            <div style={{ display: "flex", alignItems: "flex-end", justifyContent: "flex-end" }}>
              <div style={{ fontSize: ".72em", color: "#64748b", paddingBottom: 2, textAlign: "right" }}>
                Se agrega con estado “En ruta” y calendario básico.
              </div>
            </div>
          </div>

          <div style={{ display: "flex", gap: 10, justifyContent: "flex-end" }}>
            <button
              onClick={onCancelAddAthlete}
              style={{
                background: "#f8fafc",
                border: "1px solid #e2e8f0",
                borderRadius: 10,
                padding: "10px 14px",
                color: "#94a3b8",
                cursor: "pointer",
                fontFamily: "inherit",
                fontWeight: 700,
                fontSize: ".85em",
              }}
            >
              Cancelar
            </button>
            <button
              onClick={onSaveNewAthlete}
              style={{
                background: "linear-gradient(135deg,#e86f28,#ff8a3d)",
                border: "none",
                borderRadius: 10,
                padding: "10px 14px",
                color: "white",
                cursor: "pointer",
                fontFamily: "inherit",
                fontWeight: 800,
                fontSize: ".85em",
              }}
            >
              Guardar
            </button>
          </div>
        </div>
      )}

      {dashLoading ? (
        <div style={{ color: "#94a3b8", padding: "24px 0" }}>Cargando métricas desde Supabase…</div>
      ) : (
        <>
          <div style={{ display: "grid", gridTemplateColumns: "repeat(auto-fit, minmax(200px, 1fr))", gap: 14, marginBottom: 28 }}>
            {[
              { label: "Atletas activos", value: athletes.length, sub: "Registrados bajo tu cuenta", icon: "🏃", color: "#ff8a3d" },
              { label: "Km programados / semana", value: `${weekKm.planned} km`, sub: "Suma de los workouts de esta semana", icon: "📍", color: "#3b82f6" },
              {
                label: "Km corridos / semana",
                value: `${weekKm.actual} km`,
                sub: weekKm.planned > 0
                  ? `${weekKmDonePct}% de lo programado · solo sesiones marcadas como hechas`
                  : "Sin kilómetros programados esta semana",
                icon: "🏁",
                color: weekKm.planned > 0 && weekKm.actual >= weekKm.planned ? "#16a34a" : "#d97706",
              },
              {
                label: "Adherencia global",
                value: weekWorkoutsTotal ? `${globalAdherencePct}%` : "—",
                sub: weekWorkoutsTotal ? `${weekWorkoutsDone} de ${weekWorkoutsTotal} workouts esta semana` : "Sin entrenamientos programados esta semana",
                icon: "✅",
                color: "#22c55e",
              },
              {
                label: "Carga promedio RPE",
                value: weekAvgRpe != null ? weekAvgRpe.toFixed(1) : "—",
                sub:
                  weekAvgRpe != null
                    ? `Promedio de RPE en sesiones completadas con registro (${weekRpeCount} sesiones)`
                    : "Ningún workout completado con RPE esta semana",
                icon: "📊",
                color: "#a855f7",
              },
            ].map((s, i) => (
              <div key={i} style={S.card}>
                <div style={{ fontSize: "1.8em", marginBottom: 8 }}>{s.icon}</div>
                <div style={{ fontSize: "2em", fontWeight: 700, color: s.color, fontFamily: "monospace", lineHeight: 1.1 }}>{s.value}</div>
                <div style={{ fontSize: ".75em", color: "#64748b", marginTop: 6 }}>{s.label}</div>
                <div style={{ fontSize: ".68em", color: "#475569", marginTop: 8, lineHeight: 1.35 }}>{s.sub}</div>
              </div>
            ))}
          </div>

          <div style={{ fontSize: ".72em", letterSpacing: ".15em", color: "#475569", textTransform: "uppercase", marginBottom: 14 }}>Detalle por atleta</div>
          <div style={{ ...S.card, padding: 0, overflow: "hidden", marginBottom: 24 }}>
            <div style={{ overflowX: "auto" }}>
              <table style={{ width: "100%", borderCollapse: "collapse", fontSize: ".82em" }}>
                <thead>
                  <tr style={{ background: "#f1f5f9", textAlign: "left", color: "#94a3b8" }}>
                    <th style={{ padding: "12px 14px", fontWeight: 700 }}>Atleta</th>
                    <th style={{ padding: "12px 14px", fontWeight: 700 }}>Km sem · plan / real</th>
                    <th style={{ padding: "12px 14px", fontWeight: 700, minWidth: 160 }}>Adherencia (semana)</th>
                    <th style={{ padding: "12px 14px", fontWeight: 700 }}>Próxima carrera</th>
                    <th style={{ padding: "12px 14px", fontWeight: 700 }}>Días restantes</th>
                  </tr>
                </thead>
                <tbody>
                  {athleteRows.length === 0 ? (
                    <tr>
                      <td colSpan={5} style={{ padding: "20px 14px", color: "#64748b" }}>
                        Aún no hay atletas. Usa «Nuevo Atleta» para comenzar.
                      </td>
                    </tr>
                  ) : (
                    athleteRows.map(({ athlete: a, weekTotal, weekDone, adherencePct, raceName, daysLeft, km }) => (
                      <tr
                        key={a.id}
                        onClick={() => onSelect(a)}
                        style={{ borderTop: "1px solid #e2e8f0", cursor: "pointer" }}
                      >
                        <td style={{ padding: "12px 14px", color: "#0f172a", fontWeight: 600 }}>{a.name}</td>
                        <td style={{ padding: "12px 14px", color: "#64748b", fontFamily: "monospace" }}>
                          {km.planned > 0 ? (
                            <>
                              {km.planned} /{" "}
                              <span style={{ color: km.actual >= km.planned ? "#16a34a" : "#d97706", fontWeight: 700 }}>{km.actual}</span> km
                            </>
                          ) : (
                            "—"
                          )}
                        </td>
                        <td style={{ padding: "12px 14px" }}>
                          <div style={{ fontSize: ".72em", color: "#64748b", marginBottom: 4 }}>
                            {weekTotal ? `${weekDone}/${weekTotal} · ${adherencePct}%` : "Sin workouts esta semana"}
                          </div>
                          <ProgressBar value={weekDone} total={weekTotal || 1} color={adherencePct >= 70 ? "#22c55e" : adherencePct >= 40 ? "#ff8a3d" : "#ef4444"} />
                        </td>
                        <td style={{ padding: "12px 14px", color: "#94a3b8", maxWidth: 200 }}>{raceName}</td>
                        <td style={{ padding: "12px 14px", color: "#cbd5e1", fontFamily: "monospace" }}>
                          {daysLeft == null ? "—" : `${daysLeft} ${daysLeft === 1 ? "día" : "días"}`}
                        </td>
                      </tr>
                    ))
                  )}
                </tbody>
              </table>
            </div>
          </div>

          <div style={{ fontSize: ".72em", letterSpacing: ".15em", color: "#475569", textTransform: "uppercase", marginBottom: 14 }}>Km programados esta semana, por atleta</div>
          <div style={{ ...S.card, padding: "18px 16px 22px" }}>
            {athletes.length === 0 ? (
              <div style={{ color: "#64748b", fontSize: ".85em" }}>Sin datos para graficar.</div>
            ) : (
              <div
                style={{
                  display: "flex",
                  alignItems: "flex-end",
                  justifyContent: "flex-start",
                  gap: 10,
                  minHeight: 140,
                  paddingTop: 8,
                }}
              >
                {athleteRows.map(({ athlete: a, km: weekKmForAthlete }) => {
                  const km = weekKmForAthlete.planned;
                  const hPct = Math.max(6, (km / maxWeeklyKm) * 100);
                  return (
                    <div
                      key={a.id}
                      style={{
                        flex: "1 1 0",
                        minWidth: 36,
                        maxWidth: 72,
                        display: "flex",
                        flexDirection: "column",
                        alignItems: "center",
                        gap: 8,
                      }}
                      title={`${a.name}: ${km} km programados · ${weekKmForAthlete.actual} km corridos`}
                    >
                      <div
                        style={{
                          width: "100%",
                          height: 110,
                          display: "flex",
                          alignItems: "flex-end",
                          justifyContent: "center",
                          background: "#f8fafc",
                          borderRadius: 8,
                          padding: "0 6px",
                          boxSizing: "border-box",
                        }}
                      >
                        <div
                          style={{
                            width: "72%",
                            height: `${hPct}%`,
                            maxHeight: "100%",
                            background: "linear-gradient(180deg,#fbbf24,#b45309)",
                            borderRadius: "6px 6px 2px 2px",
                            boxShadow: "0 0 12px rgba(255,138,61,.25)",
                          }}
                        />
                      </div>
                      <div style={{ fontSize: ".62em", color: "#94a3b8", textAlign: "center", lineHeight: 1.2, wordBreak: "break-word" }}>
                        {(a.name || "").split(/\s+/)[0]}
                      </div>
                      <div style={{ fontSize: ".65em", color: "#64748b", fontFamily: "monospace" }}>{km}</div>
                    </div>
                  );
                })}
              </div>
            )}
          </div>
        </>
      )}
    </div>
  );
}

export default Dashboard;
