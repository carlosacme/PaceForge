import React, { useState, useEffect, useMemo, useRef } from "react";
import WorkoutDetailSheet from "../shared/WorkoutDetailSheet";
import { useWorkoutRegistro } from "../Athletes/useWorkoutRegistro";
import {
  calendarCellToIsoYmd,
  getMonthGrid,
  cellIsInViewMonth,
  DAYS,
  WORKOUT_TYPES,
  normalizeScheduledDateYmd,
} from "../shared/appShared";

/**
 * Calendario del atleta: grid mensual + menú (z 10002).
 * Sin DnD, sin editar, sin chips de carrera. DAYS de appShared (sin acentos).
 * No reusar Athletes/AthleteCalendarSection.
 * toggleDone / RPE viven en el padre (onToggleDone).
 */
export default function AthleteOwnCalendar({
  cardStyle,
  workouts,
  loading,
  evaluations,
  onToggleDone,
  onOpenNot100,
  onOpenBriefing,
  emptyHint = null,
}) {
  const [calendarViewMonth, setCalendarViewMonth] = useState(() => {
    const n = new Date();
    return { y: n.getFullYear(), m: n.getMonth() };
  });
  const [athleteCalendarCtxMenu, setAthleteCalendarCtxMenu] = useState(null);
  const [detailWorkoutId, setDetailWorkoutId] = useState(null);
  const athleteCalendarCtxMenuRef = useRef(null);

  const workoutsByDate = useMemo(() => {
    const m = {};
    for (const w of workouts || []) {
      const k = normalizeScheduledDateYmd(w.scheduled_date);
      if (!k) continue;
      if (!m[k]) m[k] = [];
      m[k].push(w);
    }
    return m;
  }, [workouts]);

  const calendarCells = useMemo(
    () => getMonthGrid(calendarViewMonth.y, calendarViewMonth.m),
    [calendarViewMonth.y, calendarViewMonth.m],
  );
  const calendarMonthLabel = useMemo(
    () => new Date(calendarViewMonth.y, calendarViewMonth.m, 1).toLocaleDateString("es-CO", { month: "long", year: "numeric" }),
    [calendarViewMonth.y, calendarViewMonth.m],
  );

  const closeAthleteCalendarCtxMenu = () => setAthleteCalendarCtxMenu(null);
  const ctxMenuWorkoutId = athleteCalendarCtxMenu?.workoutId ?? null;
  const ctxMenuAthleteWorkout = useMemo(
    () => (ctxMenuWorkoutId ? (workouts || []).find((x) => String(x.id) === String(ctxMenuWorkoutId)) || null : null),
    [workouts, ctxMenuWorkoutId],
  );
  const detailSheetWorkout = useMemo(
    () => (detailWorkoutId ? (workouts || []).find((x) => String(x.id) === String(detailWorkoutId)) || null : null),
    [workouts, detailWorkoutId],
  );

  const athleteLatestVdot = useMemo(() => {
    const rows = evaluations || [];
    if (!rows.length) return 42.5;
    const last = rows[rows.length - 1];
    const v = Number(last?.vdot);
    return Number.isFinite(v) && v > 0 ? v : 42.5;
  }, [evaluations]);

  const { setRegistroModal, registroLapsLoading, registroBlocks } = useWorkoutRegistro({
    athleteVdot: athleteLatestVdot,
  });

  useEffect(() => {
    setRegistroModal(detailSheetWorkout);
  }, [detailSheetWorkout, setRegistroModal]);

  const closeWorkoutDetailSheet = () => {
    setDetailWorkoutId(null);
  };

  const openAthleteWorkoutMenu = (e, w) => {
    e.preventDefault();
    e.stopPropagation();
    const pad = 8; const mw = 280; const mh = 160;
    const vw = typeof window !== "undefined" ? window.innerWidth : 800;
    const vh = typeof window !== "undefined" ? window.innerHeight : 600;
    const x = Math.max(pad, Math.min(e.clientX, vw - mw - pad));
    const y = Math.max(pad, Math.min(e.clientY, vh - mh - pad));
    setAthleteCalendarCtxMenu({ x, y, workoutId: w.id, view: "actions" });
  };

  const openAthleteWorkoutDetail = (e) => {
    e.preventDefault();
    e.stopPropagation();
    const w = ctxMenuAthleteWorkout;
    closeAthleteCalendarCtxMenu();
    if (!w) return;
    setDetailWorkoutId(w.id);
  };

  const ctxMenuListenerKey = athleteCalendarCtxMenu
    ? `${athleteCalendarCtxMenu.workoutId}:${athleteCalendarCtxMenu.x}:${athleteCalendarCtxMenu.y}`
    : "";
  useEffect(() => {
    if (!ctxMenuListenerKey) return;
    const onDown = (ev) => {
      if (athleteCalendarCtxMenuRef.current?.contains(ev.target)) return;
      closeAthleteCalendarCtxMenu();
    };
    const t = setTimeout(() => document.addEventListener("mousedown", onDown), 0);
    return () => { clearTimeout(t); document.removeEventListener("mousedown", onDown); };
  }, [ctxMenuListenerKey]);

  return (
    <>
      <div style={{ ...cardStyle, marginBottom: 14, maxWidth: "100%", minWidth: 0, overflow: "hidden" }}>
        <div style={{ display: "flex", flexWrap: "wrap", alignItems: "center", justifyContent: "space-between", gap: 10, marginBottom: 10 }}>
          <div style={{ fontSize: ".65em", letterSpacing: ".15em", color: "#334155", textTransform: "uppercase" }}>CALENDARIO · {calendarMonthLabel}</div>
          <div style={{ display: "flex", gap: 8, alignItems: "center" }}>
            <button type="button" onClick={() => setCalendarViewMonth(({ y, m }) => (m === 0 ? { y: y - 1, m: 11 } : { y, m: m - 1 }))} style={{ background: "#fff", border: "1px solid #e2e8f0", borderRadius: 8, padding: "6px 10px", color: "#0f172a", fontWeight: 700, cursor: "pointer", fontFamily: "inherit", fontSize: ".78em" }}>←</button>
            <button type="button" onClick={() => setCalendarViewMonth(({ y, m }) => (m === 11 ? { y: y + 1, m: 0 } : { y, m: m + 1 }))} style={{ background: "#fff", border: "1px solid #e2e8f0", borderRadius: 8, padding: "6px 10px", color: "#0f172a", fontWeight: 700, cursor: "pointer", fontFamily: "inherit", fontSize: ".78em" }}>→</button>
          </div>
        </div>
        {emptyHint && !(workouts || []).length ? (
          <div style={{ fontSize: ".8em", color: "#475569", lineHeight: 1.45, marginBottom: 10, padding: "10px 12px", borderRadius: 8, background: "rgba(255,138,61,.08)", border: "1px solid rgba(255,138,61,.25)" }}>
            {emptyHint}
          </div>
        ) : null}
        {loading ? (
          <div style={{ color: "#64748b", fontSize: ".85em", padding: "20px 0" }}>Cargando...</div>
        ) : (
          <div style={{ display: "grid", gridTemplateColumns: "repeat(7, minmax(0, 1fr))", gap: 4, width: "100%", minWidth: 0, maxWidth: "100%", boxSizing: "border-box" }}>
            {DAYS.map((d) => <div key={d} style={{ fontSize: ".65em", textAlign: "center", color: "#334155", padding: "4px 0" }}>{d}</div>)}
            {calendarCells.map((cellDate, i) => {
              const ymd = calendarCellToIsoYmd(cellDate);
              const dayWorkouts = workoutsByDate[ymd] || [];
              const inViewMonth = cellIsInViewMonth(cellDate, calendarViewMonth.y, calendarViewMonth.m);
              const hasDoneWorkout = dayWorkouts.some((w) => w.done);
              return (
                <div key={i} style={{ minHeight: 72, minWidth: 0, maxWidth: "100%", boxSizing: "border-box", overflow: "hidden", border: "1px solid #e2e8f0", borderRadius: 6, padding: "3px 2px", opacity: inViewMonth ? 1 : 0.42, background: hasDoneWorkout ? "rgba(34,197,94,.08)" : "#fff", display: "flex", flexDirection: "column", gap: 2 }}>
                  <div style={{ fontSize: ".62em", color: inViewMonth ? "#475569" : "#94a3b8", textAlign: "center", fontWeight: 600 }}>{cellDate.getDate()}</div>
                  {dayWorkouts.slice(0, 2).map((w) => {
                    const wt = WORKOUT_TYPES.find((t) => t.id === w.type) || WORKOUT_TYPES[0];
                    const kmNum = Number(w.total_km);
                    const kmLabel = Number.isFinite(kmNum) && kmNum > 0
                      ? `${Number.isInteger(kmNum) ? kmNum : kmNum.toFixed(1)} km`
                      : "";
                    return (
                      <button
                        key={w.id}
                        type="button"
                        onClick={(e) => openAthleteWorkoutMenu(e, w)}
                        title={`${w.title || "Entreno"}${kmLabel ? ` · ${kmLabel}` : ""}${w.done ? " · Hecho" : " · Pendiente"}`}
                        style={{
                          width: "100%",
                          minWidth: 0,
                          maxWidth: "100%",
                          boxSizing: "border-box",
                          border: `1px solid ${w.done ? "rgba(34,197,94,.4)" : "#e2e8f0"}`,
                          borderRadius: 5,
                          padding: "3px 4px",
                          background: w.done ? "rgba(34,197,94,.14)" : "#f8fafc",
                          cursor: "pointer",
                          fontFamily: "inherit",
                          textAlign: "left",
                          position: "relative",
                          zIndex: 1,
                          overflow: "hidden",
                        }}
                      >
                        <div style={{ display: "flex", alignItems: "center", gap: 4, minWidth: 0 }}>
                          <span
                            aria-hidden="true"
                            style={{
                              flexShrink: 0,
                              width: 7,
                              height: 7,
                              borderRadius: "50%",
                              background: w.done ? "#22c55e" : (wt?.color || "#94a3b8"),
                            }}
                          />
                          <span style={{ flex: "1 1 auto", minWidth: 0, fontSize: ".62em", lineHeight: 1.15, color: "#334155", fontWeight: 700, overflow: "hidden", textOverflow: "ellipsis", whiteSpace: "nowrap" }}>
                            {w.title}
                          </span>
                          {w.done ? <span style={{ flexShrink: 0, fontSize: ".55em", color: "#16a34a", fontWeight: 800 }}>✓</span> : null}
                        </div>
                        {kmLabel ? (
                          <div style={{ fontSize: ".5em", color: "#64748b", fontWeight: 600, marginTop: 1, paddingLeft: 11, lineHeight: 1.1, overflow: "hidden", textOverflow: "ellipsis", whiteSpace: "nowrap" }}>
                            {kmLabel}
                          </div>
                        ) : null}
                      </button>
                    );
                  })}
                </div>
              );
            })}
          </div>
        )}
      </div>

      {athleteCalendarCtxMenu && ctxMenuAthleteWorkout ? (
        <div
          ref={athleteCalendarCtxMenuRef}
          style={{
            position: "fixed",
            left: athleteCalendarCtxMenu.x,
            top: athleteCalendarCtxMenu.y,
            zIndex: 10002,
            minWidth: 240,
            maxWidth: "min(92vw, 340px)",
            background: "#ffffff",
            borderRadius: 10,
            boxShadow: "0 10px 40px rgba(15,23,42,.2)",
            border: "1px solid #e2e8f0",
            padding: 6,
          }}
        >
          <button
            type="button"
            onMouseDown={(e) => e.preventDefault()}
            onClick={(e) => { e.stopPropagation(); const row = ctxMenuAthleteWorkout; closeAthleteCalendarCtxMenu(); void onToggleDone(row); }}
            style={{ display: "block", width: "100%", textAlign: "left", background: "transparent", border: "none", borderRadius: 8, padding: "10px 12px", color: "#0f172a", fontWeight: 600, cursor: "pointer", fontFamily: "inherit", fontSize: ".82em" }}
          >
            {ctxMenuAthleteWorkout.done ? "✓ Marcar pendiente" : "✓ Marcar hecho"}
          </button>
          {!ctxMenuAthleteWorkout.done && (
            <button
              type="button"
              onMouseDown={(e) => e.preventDefault()}
              onClick={(e) => { e.stopPropagation(); onOpenNot100(ctxMenuAthleteWorkout); closeAthleteCalendarCtxMenu(); }}
              style={{ display: "block", width: "100%", textAlign: "left", background: "transparent", border: "none", borderRadius: 8, padding: "10px 12px", color: "#ff8a3d", fontWeight: 600, cursor: "pointer", fontFamily: "inherit", fontSize: ".82em" }}
            >
              😓 No estoy al 100%
            </button>
          )}
          <button
            type="button"
            onMouseDown={(e) => e.preventDefault()}
            onClick={openAthleteWorkoutDetail}
            style={{ display: "block", width: "100%", textAlign: "left", background: "transparent", border: "none", borderRadius: 8, padding: "10px 12px", color: "#0d1f38", fontWeight: 600, cursor: "pointer", fontFamily: "inherit", fontSize: ".82em" }}
          >
            📋 Ver detalle
          </button>
          <button
            type="button"
            onMouseDown={(e) => e.preventDefault()}
            onClick={(e) => { e.stopPropagation(); onOpenBriefing(ctxMenuAthleteWorkout); closeAthleteCalendarCtxMenu(); }}
            style={{ display: "block", width: "100%", textAlign: "left", background: "transparent", border: "none", borderRadius: 8, padding: "10px 12px", color: "#6366f1", fontWeight: 600, cursor: "pointer", fontFamily: "inherit", fontSize: ".82em" }}
          >
            ⚡ Briefing IA
          </button>
        </div>
      ) : null}

      <WorkoutDetailSheet
        workout={detailSheetWorkout}
        vdot={athleteLatestVdot}
        onClose={closeWorkoutDetailSheet}
        canEditPlan={false}
        registroLapsLoading={registroLapsLoading}
        registroBlocks={registroBlocks}
      />
    </>
  );
}
