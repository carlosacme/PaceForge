import React from "react";
import WorkoutDetailBreakdown from "../WorkoutDetailBreakdown";
import WorkoutStructureTable from "../shared/WorkoutStructureTable";
import {
  WORKOUT_TYPES,
  WORKOUT_BLOCK_TYPES,
  formatLocalYMD,
  cellIsInViewMonth,
  racePriorityMeta,
  emptyWorkoutStructureRow,
  styles,
} from "../shared/appShared";

const DAYS = ["Lun", "Mar", "Mié", "Jue", "Vie", "Sáb", "Dom"];

/**
 * Pieza única del calendario del coach: toolbar + grid + menú (z 300) +
 * panel de estructura/mover (z 280) + borrar rango (z 215).
 * DnD usa dragWorkoutId + calendarDragRef, no dataTransfer para el drop.
 */
export default function AthleteCalendarSection({
  loadingWorkouts,
  racesByDate,
  onOpenRaceModal,
  onOpenRaceMenu,
  onOpenRegistro,
  athleteName,
  athleteVdot,
  coachWorkoutAnalysis,
  coachWorkoutAnalysisLoading,
  onAnalyze,
  onOpenAnalysis,
  dragWorkoutId,
  setDragWorkoutId,
  calendarDragRef,
  releaseCalendarDrag,
  calendarCtxMenu,
  setCalendarCtxMenu,
  calendarCtxMenuRef,
  workoutPanel,
  workoutFormSaving,
  setWorkoutFormSaving,
  workoutEditForm,
  setWorkoutEditForm,
  moveDateInput,
  setMoveDateInput,
  workoutsByDate,
  calendarViewMonth,
  setCalendarViewMonth,
  calendarCells,
  calendarMonthLabel,
  rangeDeleteOpen,
  setRangeDeleteOpen,
  rangeDeleteFrom,
  setRangeDeleteFrom,
  rangeDeleteTo,
  setRangeDeleteTo,
  rangeDeleteBusy,
  toggleWorkoutDone,
  closeCalendarCtxMenu,
  ctxMenuWorkout,
  panelWorkout,
  openCalendarWorkoutMenu,
  openCalendarWorkoutDetail,
  openWorkoutEditPanel,
  openWorkoutMovePanel,
  closeWorkoutPanel,
  moveWorkoutToDate,
  saveWorkoutEdits,
  deleteCalendarWorkout,
  openRangeDeleteModal,
  rangeDeleteValid,
  rangeDeleteWorkouts,
  rangeDeleteRaces,
  rangeDeleteDoneCount,
  deleteWorkoutsInRange,
  part = "all",
}) {
  const S = styles;
  const showGrid = part === "all" || part === "grid";
  const showOverlays = part === "all" || part === "overlays";

  return (
    <>
      {showGrid ? (
      <div style={{ order: 3, marginBottom: 24, paddingBottom: 20, borderBottom: "1px solid #e2e8f0" }}>
        <div style={{ display: "flex", flexWrap: "wrap", alignItems: "center", justifyContent: "space-between", gap: 10, marginBottom: 10 }}>
          <div style={{ fontSize: ".65em", letterSpacing: ".15em", color: "#334155", textTransform: "uppercase" }}>
            CALENDARIO · {calendarMonthLabel}
          </div>
          <div style={{ display: "flex", flexWrap: "wrap", gap: 8, alignItems: "center" }}>
            <button
              type="button"
              onClick={() => setCalendarViewMonth(({ y, m }) => (m === 0 ? { y: y - 1, m: 11 } : { y, m: m - 1 }))}
              style={{
                background: "#ffffff",
                border: "1px solid #e2e8f0",
                borderRadius: 8,
                padding: "6px 12px",
                color: "#0f172a",
                fontWeight: 700,
                cursor: "pointer",
                fontFamily: "inherit",
                fontSize: ".78em",
              }}
            >
              ← Mes anterior
            </button>
            <button
              type="button"
              onClick={() => setCalendarViewMonth(({ y, m }) => (m === 11 ? { y: y + 1, m: 0 } : { y, m: m + 1 }))}
              style={{
                background: "#ffffff",
                border: "1px solid #e2e8f0",
                borderRadius: 8,
                padding: "6px 12px",
                color: "#0f172a",
                fontWeight: 700,
                cursor: "pointer",
                fontFamily: "inherit",
                fontSize: ".78em",
              }}
            >
              Mes siguiente →
            </button>
            <button
              type="button"
              onClick={onOpenRaceModal}
              style={{
                background: "linear-gradient(135deg,#fffbeb,#ffedd5)",
                border: "1px solid rgba(255,138,61,.45)",
                borderRadius: 8,
                padding: "6px 12px",
                color: "#b45309",
                fontWeight: 800,
                cursor: "pointer",
                fontFamily: "inherit",
                fontSize: ".78em",
              }}
            >
              🏁 Agregar Carrera
            </button>
            <button
              type="button"
              onClick={openRangeDeleteModal}
              title="Eliminar todos los entrenos de un rango de fechas"
              style={{
                background: "#fff",
                border: "1px solid #fecaca",
                borderRadius: 8,
                padding: "6px 12px",
                color: "#b91c1c",
                fontWeight: 800,
                cursor: "pointer",
                fontFamily: "inherit",
                fontSize: ".78em",
              }}
            >
              🗑 Eliminar rango
            </button>
          </div>
        </div>
        {loadingWorkouts ? (
          <div style={{ color: "#64748b", fontSize: ".85em", padding: "20px 0" }}>Cargando...</div>
        ) : (
          <div style={{ display: "grid", gridTemplateColumns: "repeat(7, minmax(0, 1fr))", gap: 4, width: "100%", minWidth: 0 }}>
            {DAYS.map(d => <div key={d} style={{ fontSize: ".65em", textAlign: "center", color: "#334155", padding: "4px 0" }}>{d}</div>)}
            {calendarCells.map((cellDate, i) => {
              const ymd = formatLocalYMD(cellDate);
              const dayWorkouts = workoutsByDate[ymd] || [];
              const dayRaces = racesByDate[ymd] || [];
              const hasWorkout = dayWorkouts.length > 0;
              const hasDoneWorkout = dayWorkouts.some(w => w.done);
              const hasRace = dayRaces.length > 0;
              const todayYmd = formatLocalYMD(new Date());
              const isRaceToday = hasRace && ymd === todayYmd;
              const inViewMonth = cellIsInViewMonth(cellDate, calendarViewMonth.y, calendarViewMonth.m);
              let borderColor = "#f1f5f9";
              if (hasRace) borderColor = "rgba(255,138,61,.55)";
              else if (hasWorkout) borderColor = `${WORKOUT_TYPES.find(t => t.id === dayWorkouts[0].type)?.color || "#64748b"}40`;
              let cellBackground = "transparent";
              if (isRaceToday) cellBackground = "linear-gradient(160deg,#fffbeb 0%,#fde68a 55%,#fff7ed 100%)";
              else if (hasRace) cellBackground = "linear-gradient(145deg,#fffbeb,#ffedd5)";
              else if (hasDoneWorkout) cellBackground = "rgba(34,197,94,.08)";
              else if (hasWorkout) cellBackground = "#f8fafc";
              return (
                <div
                  key={i}
                  className={isRaceToday ? "raf-race-day" : undefined}
                  onDragOver={(e) => e.preventDefault()}
                  onDrop={async () => {
                    if (!dragWorkoutId) return;
                    const id = dragWorkoutId;
                    try {
                      await moveWorkoutToDate(id, ymd, true);
                    } finally {
                      releaseCalendarDrag();
                    }
                  }}
                  style={{
                    minHeight: 64,
                    minWidth: 0,
                    maxWidth: "100%",
                    boxSizing: "border-box",
                    overflow: "hidden",
                    border: `1px solid ${borderColor}`,
                    borderRadius: 6,
                    padding: "3px 2px",
                    display: "flex",
                    flexDirection: "column",
                    alignItems: "stretch",
                    gap: 2,
                    background: cellBackground,
                    opacity: inViewMonth ? 1 : 0.42,
                  }}
                >
                  <div style={{ fontSize: ".58em", color: inViewMonth ? "#475569" : "#94a3b8", textAlign: "center", fontWeight: 600 }}>{cellDate.getDate()}</div>
                  {dayRaces.map((race) => {
                    const pri = racePriorityMeta(race.priority);
                    return (
                      <button
                        key={race.id}
                        type="button"
                        onClick={(e) => onOpenRaceMenu(e, race)}
                        title={`${race.name} · ${race.distance} · Prioridad ${pri.id} (${pri.short})${race.city ? ` · ${race.city}` : ""}`}
                        style={{
                          fontSize: ".48em",
                          fontWeight: 800,
                          color: pri.color,
                          textAlign: "center",
                          lineHeight: 1.15,
                          padding: "2px 2px",
                          borderRadius: 4,
                          background: "rgba(255,255,255,.65)",
                          border: `1px solid ${pri.color}59`,
                          cursor: "pointer",
                          fontFamily: "inherit",
                          width: "100%",
                          boxSizing: "border-box",
                          overflow: "hidden",
                          textOverflow: "ellipsis",
                          whiteSpace: "nowrap",
                        }}
                      >
                        🏁 {pri.id} · {race.name}
                      </button>
                    );
                  })}
                  {dayWorkouts.slice(0, 3).map((w) => {
                    const wt = WORKOUT_TYPES.find((t) => t.id === w.type) || WORKOUT_TYPES[0];
                    const kmNum = Number(w.total_km);
                    const kmLabel = Number.isFinite(kmNum) && kmNum > 0
                      ? `${Number.isInteger(kmNum) ? kmNum : kmNum.toFixed(1)} km`
                      : "";
                    return (
                      <button
                        key={w.id}
                        type="button"
                        draggable
                        onDragStart={(e) => {
                          calendarDragRef.current = true;
                          setDragWorkoutId(w.id);
                          try {
                            e.dataTransfer.setData("text/plain", String(w.id));
                            e.dataTransfer.effectAllowed = "move";
                          } catch (_) {}
                        }}
                        onDragEnd={() => {
                          releaseCalendarDrag();
                        }}
                        onClick={(e) => openCalendarWorkoutMenu(e, w)}
                        title={`${w.title || "Entreno"}${kmLabel ? ` · ${kmLabel}` : ""}${w.done ? " · Hecho" : " · Pendiente"}`}
                        style={{
                          border: `1px solid ${w.done ? "rgba(34,197,94,.45)" : `${wt.color}44`}`,
                          borderRadius: 5,
                          padding: "3px 4px",
                          background: w.done ? "rgba(34,197,94,.14)" : `${wt.color}10`,
                          cursor: "pointer",
                          fontFamily: "inherit",
                          textAlign: "left",
                          width: "100%",
                          minWidth: 0,
                          maxWidth: "100%",
                          boxSizing: "border-box",
                          overflow: "hidden",
                        }}
                      >
                        <div style={{ display: "flex", alignItems: "center", gap: 4, minWidth: 0 }}>
                          <span
                            aria-hidden="true"
                            title={w.done ? "Hecho" : "Pendiente"}
                            style={{
                              flexShrink: 0,
                              width: 7,
                              height: 7,
                              borderRadius: "50%",
                              background: w.done ? "#22c55e" : wt.color,
                              boxShadow: w.done ? "0 0 0 1px rgba(34,197,94,.35)" : "none",
                            }}
                          />
                          <span style={{ flex: "1 1 auto", minWidth: 0, fontSize: ".62em", color: wt.color, fontWeight: 700, lineHeight: 1.15, overflow: "hidden", textOverflow: "ellipsis", whiteSpace: "nowrap" }}>
                            {w.title}
                          </span>
                          {w.done ? <span style={{ flexShrink: 0, fontSize: ".55em", color: "#16a34a", fontWeight: 800 }}>✓</span> : null}
                        </div>
                        {kmLabel ? (
                          <div style={{ fontSize: ".52em", color: "#64748b", fontWeight: 600, marginTop: 1, paddingLeft: 11, lineHeight: 1.1, overflow: "hidden", textOverflow: "ellipsis", whiteSpace: "nowrap" }}>
                            {kmLabel}
                          </div>
                        ) : null}
                      </button>
                    );
                  })}
                  {dayWorkouts.length > 3 ? (
                    <div style={{ fontSize: ".5em", color: "#94a3b8", textAlign: "center", fontWeight: 700 }}>+{dayWorkouts.length - 3}</div>
                  ) : null}
                </div>
              );
            })}
          </div>
        )}
      </div>
      ) : null}

      {showOverlays && calendarCtxMenu && ctxMenuWorkout ? (
        <div
          ref={calendarCtxMenuRef}
          style={{
            position: "fixed",
            left: calendarCtxMenu.x,
            top: calendarCtxMenu.y,
            zIndex: 300,
            minWidth: (calendarCtxMenu.view || "actions") === "detail" ? 260 : 240,
            width: (calendarCtxMenu.view || "actions") === "detail" ? "min(92vw, 340px)" : undefined,
            maxWidth: "min(92vw, 340px)",
            maxHeight: (calendarCtxMenu.view || "actions") === "detail" ? "min(70vh, 420px)" : undefined,
            overflowY: (calendarCtxMenu.view || "actions") === "detail" ? "auto" : "visible",
            background: "#ffffff",
            borderRadius: 10,
            boxShadow: "0 10px 40px rgba(15,23,42,.2)",
            border: "1px solid #e2e8f0",
            padding: (calendarCtxMenu.view || "actions") === "detail" ? 12 : 6,
          }}
        >
          {(calendarCtxMenu.view || "actions") === "detail" ? (
            <>
              <div style={{ display: "flex", alignItems: "center", justifyContent: "space-between", gap: 8, marginBottom: 8 }}>
                <button
                  type="button"
                  onMouseDown={(e) => e.preventDefault()}
                  onClick={(e) => {
                    e.stopPropagation();
                    setCalendarCtxMenu((prev) => (prev ? { ...prev, view: "actions" } : prev));
                  }}
                  style={{ background: "transparent", border: "none", color: "#64748b", fontWeight: 700, cursor: "pointer", fontFamily: "inherit", fontSize: ".78em", padding: "4px 0" }}
                >
                  ← Menú
                </button>
                <button
                  type="button"
                  onMouseDown={(e) => e.preventDefault()}
                  onClick={(e) => { e.stopPropagation(); closeCalendarCtxMenu(); }}
                  style={{ background: "transparent", border: "none", color: "#94a3b8", fontWeight: 700, cursor: "pointer", fontFamily: "inherit", fontSize: ".78em", padding: "4px 0" }}
                >
                  Cerrar
                </button>
              </div>
              <WorkoutDetailBreakdown workout={ctxMenuWorkout} vdot={athleteVdot || 42.5} />
            </>
          ) : (
            <>
              {[
                {
                  label: ctxMenuWorkout.done ? "✓ Marcar pendiente" : "✓ Marcar hecho",
                  onClick: () => {
                    toggleWorkoutDone(ctxMenuWorkout);
                    closeCalendarCtxMenu();
                  },
                },
                {
                  label: "📋 Ver detalle",
                  onClick: null,
                },
                ...(ctxMenuWorkout.done
                  ? [
                      {
                        label: "📊 Ver registro",
                        onClick: () => {
                          onOpenRegistro(ctxMenuWorkout);
                          closeCalendarCtxMenu();
                        },
                      },
                      {
                        label: coachWorkoutAnalysisLoading[ctxMenuWorkout.id]
                          ? "🤖 Analizando…"
                          : "🤖 Analizar IA",
                        disabled: Boolean(coachWorkoutAnalysisLoading[ctxMenuWorkout.id]),
                        onClick: () => {
                          void onAnalyze(ctxMenuWorkout, athleteName);
                        },
                      },
                      ...(coachWorkoutAnalysis[ctxMenuWorkout.id]
                        ? [
                            {
                              label: "📄 Ver análisis",
                              onClick: () => {
                                onOpenAnalysis(ctxMenuWorkout);
                                closeCalendarCtxMenu();
                              },
                            },
                          ]
                        : []),
                    ]
                  : []),
                {
                  label: "✏️ Editar",
                  onClick: () => openWorkoutEditPanel(ctxMenuWorkout),
                },
                {
                  label: "📅 Mover a otra fecha",
                  onClick: () => openWorkoutMovePanel(ctxMenuWorkout),
                },
                {
                  label: "🗑 Eliminar",
                  danger: true,
                  onClick: () => deleteCalendarWorkout(ctxMenuWorkout),
                },
              ].map((item, i) => (
                <button
                  key={i}
                  type="button"
                  disabled={item.disabled}
                  onMouseDown={(e) => e.preventDefault()}
                  onClick={(e) => {
                    e.stopPropagation();
                    if (item.disabled) return;
                    if (item.label === "📋 Ver detalle") {
                      openCalendarWorkoutDetail(e);
                      return;
                    }
                    item.onClick?.();
                  }}
                  style={{
                    display: "block",
                    width: "100%",
                    textAlign: "left",
                    background: "transparent",
                    border: "none",
                    borderRadius: 8,
                    padding: "10px 12px",
                    color: item.disabled ? "#94a3b8" : item.danger ? "#b91c1c" : "#0f172a",
                    fontWeight: 600,
                    cursor: item.disabled ? "not-allowed" : "pointer",
                    fontFamily: "inherit",
                    fontSize: ".82em",
                  }}
                >
                  {item.label}
                </button>
              ))}
            </>
          )}
        </div>
      ) : null}

      {showOverlays && workoutPanel && panelWorkout ? (
        <div style={{ position: "fixed", inset: 0, background: "rgba(15,23,42,0.45)", display: "flex", alignItems: "center", justifyContent: "center", zIndex: 280, padding: 16, overflowY: "auto" }}>
          <div style={{ ...S.card, width: "100%", maxWidth: workoutPanel.mode === "edit" ? 640 : 480, margin: "24px 0", maxHeight: "90vh", overflowY: "auto" }}>
            <div style={{ display: "flex", justifyContent: "space-between", alignItems: "center", gap: 10, marginBottom: 10 }}>
              <div style={{ fontSize: ".95em", fontWeight: 800, color: "#0f172a" }}>
                {workoutPanel.mode === "edit" ? "Editar workout" : "Mover workout"} · {panelWorkout.title}
              </div>
              <button type="button" onClick={closeWorkoutPanel} style={{ background: "transparent", border: "none", color: "#64748b", cursor: "pointer", fontFamily: "inherit", fontWeight: 700 }}>✕</button>
            </div>

            {workoutPanel.mode === "edit" ? (
              <div style={{ display: "grid", gridTemplateColumns: "repeat(2,minmax(0,1fr))", gap: 10 }}>
                <div style={{ gridColumn: "1 / -1" }}>
                  <div style={{ fontSize: ".72em", color: "#64748b", marginBottom: 6 }}>Título</div>
                  <input value={workoutEditForm.title} onChange={(e) => setWorkoutEditForm((f) => ({ ...f, title: e.target.value }))} style={{ width: "100%", background: "#fff", border: "1px solid #e2e8f0", borderRadius: 8, padding: "9px 10px", color: "#0f172a", fontFamily: "inherit", fontSize: ".84em", boxSizing: "border-box" }} />
                </div>
                <div>
                  <div style={{ fontSize: ".72em", color: "#64748b", marginBottom: 6 }}>Tipo</div>
                  <select value={workoutEditForm.type} onChange={(e) => setWorkoutEditForm((f) => ({ ...f, type: e.target.value }))} style={{ width: "100%", background: "#fff", border: "1px solid #e2e8f0", borderRadius: 8, padding: "9px 10px", color: "#0f172a", fontFamily: "inherit", fontSize: ".84em", boxSizing: "border-box" }}>
                    {WORKOUT_TYPES.map((t) => <option key={t.id} value={t.id}>{t.label}</option>)}
                  </select>
                </div>
                <div>
                  <div style={{ fontSize: ".72em", color: "#64748b", marginBottom: 6 }}>Km</div>
                  <input type="number" min={0} step="0.1" value={workoutEditForm.total_km} onChange={(e) => setWorkoutEditForm((f) => ({ ...f, total_km: e.target.value }))} style={{ width: "100%", background: "#fff", border: "1px solid #e2e8f0", borderRadius: 8, padding: "9px 10px", color: "#0f172a", fontFamily: "inherit", fontSize: ".84em", boxSizing: "border-box" }} />
                </div>
                <div>
                  <div style={{ fontSize: ".72em", color: "#64748b", marginBottom: 6 }}>Duración (min)</div>
                  <input type="number" min={0} step="1" value={workoutEditForm.duration_min} onChange={(e) => setWorkoutEditForm((f) => ({ ...f, duration_min: e.target.value }))} style={{ width: "100%", background: "#fff", border: "1px solid #e2e8f0", borderRadius: 8, padding: "9px 10px", color: "#0f172a", fontFamily: "inherit", fontSize: ".84em", boxSizing: "border-box" }} />
                </div>
                <div style={{ gridColumn: "1 / -1" }}>
                  <div style={{ fontSize: ".72em", color: "#64748b", marginBottom: 6 }}>Descripción</div>
                  <textarea rows={3} value={workoutEditForm.description} onChange={(e) => setWorkoutEditForm((f) => ({ ...f, description: e.target.value }))} style={{ width: "100%", background: "#fff", border: "1px solid #e2e8f0", borderRadius: 8, padding: "9px 10px", color: "#0f172a", fontFamily: "inherit", fontSize: ".84em", boxSizing: "border-box", resize: "vertical" }} />
                </div>
                <div style={{ gridColumn: "1 / -1" }}>
                  <WorkoutStructureTable structure={workoutEditForm.structureRows} />
                  <div style={{ fontSize: ".72em", color: "#64748b", marginBottom: 8 }}>Estructura (fases, duración, ritmo objetivo)</div>
                  <div style={{ display: "flex", flexDirection: "column", gap: 10 }}>
                    {workoutEditForm.structureRows.map((row, idx) => (
                      <div
                        key={idx}
                        style={{
                          border: "1px solid #e2e8f0",
                          borderRadius: 8,
                          padding: "10px 12px",
                          background: "#f8fafc",
                        }}
                      >
                        <div style={{ display: "flex", justifyContent: "space-between", alignItems: "center", marginBottom: 8 }}>
                          <span style={{ fontSize: ".75em", fontWeight: 700, color: "#334155" }}>Fase {idx + 1}</span>
                          <button
                            type="button"
                            disabled={workoutEditForm.structureRows.length <= 1}
                            onClick={() =>
                              setWorkoutEditForm((f) => ({
                                ...f,
                                structureRows:
                                  f.structureRows.length <= 1
                                    ? f.structureRows
                                    : f.structureRows.filter((_, j) => j !== idx),
                              }))
                            }
                            style={{
                              background: "transparent",
                              border: "none",
                              color: workoutEditForm.structureRows.length <= 1 ? "#cbd5e1" : "#b91c1c",
                              cursor: workoutEditForm.structureRows.length <= 1 ? "not-allowed" : "pointer",
                              fontSize: ".72em",
                              fontWeight: 700,
                              fontFamily: "inherit",
                            }}
                          >
                            Quitar
                          </button>
                        </div>
                        <div style={{ display: "grid", gridTemplateColumns: "repeat(2,minmax(0,1fr))", gap: 8 }}>
                          <div>
                            <div style={{ fontSize: ".65em", color: "#94a3b8", marginBottom: 4 }}>Tipo de bloque</div>
                            <select
                              value={row.block_type}
                              onChange={(e) =>
                                setWorkoutEditForm((f) => {
                                  const next = [...f.structureRows];
                                  next[idx] = { ...next[idx], block_type: e.target.value };
                                  return { ...f, structureRows: next };
                                })
                              }
                              style={{ width: "100%", background: "#fff", border: "1px solid #e2e8f0", borderRadius: 8, padding: "8px 10px", color: "#0f172a", fontFamily: "inherit", fontSize: ".82em", boxSizing: "border-box" }}
                            >
                              {WORKOUT_BLOCK_TYPES.map((bt) => <option key={bt} value={bt}>{bt}</option>)}
                            </select>
                          </div>
                          <div>
                            <div style={{ fontSize: ".65em", color: "#94a3b8", marginBottom: 4 }}>Duración (min)</div>
                            <input
                              value={row.duration_min}
                              onChange={(e) =>
                                setWorkoutEditForm((f) => {
                                  const next = [...f.structureRows];
                                  next[idx] = { ...next[idx], duration_min: e.target.value };
                                  return { ...f, structureRows: next };
                                })
                              }
                              placeholder="Ej: 12"
                              style={{ width: "100%", background: "#fff", border: "1px solid #e2e8f0", borderRadius: 8, padding: "8px 10px", color: "#0f172a", fontFamily: "inherit", fontSize: ".82em", boxSizing: "border-box" }}
                            />
                          </div>
                          <div>
                            <div style={{ fontSize: ".65em", color: "#94a3b8", marginBottom: 4 }}>Distancia (km)</div>
                            <input
                              value={row.distance_km}
                              onChange={(e) =>
                                setWorkoutEditForm((f) => {
                                  const next = [...f.structureRows];
                                  next[idx] = { ...next[idx], distance_km: e.target.value };
                                  return { ...f, structureRows: next };
                                })
                              }
                              placeholder="Opcional"
                              style={{ width: "100%", background: "#fff", border: "1px solid #e2e8f0", borderRadius: 8, padding: "8px 10px", color: "#0f172a", fontFamily: "inherit", fontSize: ".82em", boxSizing: "border-box" }}
                            />
                          </div>
                          <div>
                            <div style={{ fontSize: ".65em", color: "#94a3b8", marginBottom: 4 }}>Ritmo objetivo</div>
                            <input
                              value={row.target_pace}
                              onChange={(e) =>
                                setWorkoutEditForm((f) => {
                                  const next = [...f.structureRows];
                                  next[idx] = { ...next[idx], target_pace: e.target.value };
                                  return { ...f, structureRows: next };
                                })
                              }
                              placeholder="MM:SS /km"
                              style={{ width: "100%", background: "#fff", border: "1px solid #e2e8f0", borderRadius: 8, padding: "8px 10px", color: "#0f172a", fontFamily: "inherit", fontSize: ".82em", boxSizing: "border-box" }}
                            />
                          </div>
                          <div>
                            <div style={{ fontSize: ".65em", color: "#94a3b8", marginBottom: 4 }}>FC objetivo (lpm)</div>
                            <input
                              value={row.target_hr}
                              onChange={(e) =>
                                setWorkoutEditForm((f) => {
                                  const next = [...f.structureRows];
                                  next[idx] = { ...next[idx], target_hr: e.target.value };
                                  return { ...f, structureRows: next };
                                })
                              }
                              placeholder="Ej: 140-160"
                              style={{ width: "100%", background: "#fff", border: "1px solid #e2e8f0", borderRadius: 8, padding: "8px 10px", color: "#0f172a", fontFamily: "inherit", fontSize: ".82em", boxSizing: "border-box" }}
                            />
                          </div>
                          <div style={{ gridColumn: "1 / -1" }}>
                            <div style={{ fontSize: ".65em", color: "#94a3b8", marginBottom: 4 }}>Descripción</div>
                            <input
                              value={row.description}
                              onChange={(e) =>
                                setWorkoutEditForm((f) => {
                                  const next = [...f.structureRows];
                                  next[idx] = { ...next[idx], description: e.target.value };
                                  return { ...f, structureRows: next };
                                })
                              }
                              placeholder="Notas del bloque"
                              style={{ width: "100%", background: "#fff", border: "1px solid #e2e8f0", borderRadius: 8, padding: "8px 10px", color: "#0f172a", fontFamily: "inherit", fontSize: ".82em", boxSizing: "border-box" }}
                            />
                          </div>
                        </div>
                      </div>
                    ))}
                  </div>
                  <button
                    type="button"
                    onClick={() =>
                      setWorkoutEditForm((f) => ({
                        ...f,
                        structureRows: [...f.structureRows, emptyWorkoutStructureRow()],
                      }))
                    }
                    style={{
                      marginTop: 10,
                      background: "#eff6ff",
                      border: "1px solid #bfdbfe",
                      borderRadius: 8,
                      padding: "8px 12px",
                      color: "#1d4ed8",
                      fontWeight: 700,
                      cursor: "pointer",
                      fontFamily: "inherit",
                      fontSize: ".78em",
                    }}
                  >
                    + Añadir fase
                  </button>
                </div>
                <div style={{ gridColumn: "1 / -1", display: "flex", justifyContent: "flex-end", gap: 8, marginTop: 4 }}>
                  <button type="button" onClick={closeWorkoutPanel} style={{ background: "#fff", border: "1px solid #e2e8f0", borderRadius: 8, padding: "8px 12px", color: "#64748b", cursor: "pointer", fontFamily: "inherit", fontWeight: 700, fontSize: ".8em" }}>Cancelar</button>
                  <button type="button" disabled={workoutFormSaving} onClick={saveWorkoutEdits} style={{ background: workoutFormSaving ? "#e2e8f0" : "linear-gradient(135deg,#e86f28,#ff8a3d)", border: "none", borderRadius: 8, padding: "8px 12px", color: workoutFormSaving ? "#64748b" : "#fff", cursor: workoutFormSaving ? "not-allowed" : "pointer", fontFamily: "inherit", fontWeight: 800, fontSize: ".8em" }}>{workoutFormSaving ? "Guardando…" : "Guardar cambios"}</button>
                </div>
              </div>
            ) : null}

            {workoutPanel.mode === "move" ? (
              <div>
                <div style={{ fontSize: ".72em", color: "#64748b", marginBottom: 6 }}>Nueva fecha</div>
                <input type="date" value={moveDateInput} onChange={(e) => setMoveDateInput(e.target.value)} style={{ width: "100%", background: "#fff", border: "1px solid #e2e8f0", borderRadius: 8, padding: "9px 10px", color: "#0f172a", fontFamily: "inherit", fontSize: ".84em", boxSizing: "border-box" }} />
                <div style={{ marginTop: 10, display: "flex", justifyContent: "flex-end", gap: 8 }}>
                  <button type="button" onClick={closeWorkoutPanel} style={{ background: "#fff", border: "1px solid #e2e8f0", borderRadius: 8, padding: "8px 12px", color: "#64748b", cursor: "pointer", fontFamily: "inherit", fontWeight: 700, fontSize: ".8em" }}>Cancelar</button>
                  <button
                    type="button"
                    disabled={workoutFormSaving}
                    onClick={async () => {
                      setWorkoutFormSaving(true);
                      await moveWorkoutToDate(panelWorkout.id, moveDateInput, true);
                      setWorkoutFormSaving(false);
                      closeWorkoutPanel();
                    }}
                    style={{ background: workoutFormSaving ? "#e2e8f0" : "linear-gradient(135deg,#e86f28,#ff8a3d)", border: "none", borderRadius: 8, padding: "8px 12px", color: workoutFormSaving ? "#64748b" : "#fff", cursor: workoutFormSaving ? "not-allowed" : "pointer", fontFamily: "inherit", fontWeight: 800, fontSize: ".8em" }}
                  >
                    {workoutFormSaving ? "Moviendo…" : "Mover workout"}
                  </button>
                </div>
              </div>
            ) : null}
          </div>
        </div>
      ) : null}

      {showOverlays && rangeDeleteOpen && (
        <div style={{ position: "fixed", inset: 0, background: "rgba(15,23,42,0.45)", display: "flex", alignItems: "center", justifyContent: "center", zIndex: 215, padding: 16 }}>
          <div style={{ ...S.card, width: "100%", maxWidth: 460, margin: 0 }}>
            <div style={{ fontSize: ".95em", fontWeight: 800, color: "#0f172a", marginBottom: 4 }}>🗑 Eliminar entrenos por rango</div>
            <div style={{ fontSize: ".78em", color: "#64748b", marginBottom: 12 }}>
              Solo se eliminan los entrenos de {athleteName || "este atleta"}. Las carreras no se tocan.
            </div>
            <div style={{ display: "grid", gridTemplateColumns: "repeat(2,minmax(0,1fr))", gap: 10 }}>
              <div>
                <div style={{ fontSize: ".72em", color: "#64748b", marginBottom: 6 }}>Desde</div>
                <input
                  type="date"
                  value={rangeDeleteFrom}
                  onChange={(e) => setRangeDeleteFrom(e.target.value)}
                  style={{ width: "100%", background: "#fff", border: "1px solid #e2e8f0", borderRadius: 8, padding: "9px 10px", color: "#0f172a", fontFamily: "inherit", fontSize: ".84em", boxSizing: "border-box" }}
                />
              </div>
              <div>
                <div style={{ fontSize: ".72em", color: "#64748b", marginBottom: 6 }}>Hasta</div>
                <input
                  type="date"
                  value={rangeDeleteTo}
                  onChange={(e) => setRangeDeleteTo(e.target.value)}
                  style={{ width: "100%", background: "#fff", border: "1px solid #e2e8f0", borderRadius: 8, padding: "9px 10px", color: "#0f172a", fontFamily: "inherit", fontSize: ".84em", boxSizing: "border-box" }}
                />
              </div>
            </div>
            <div
              style={{
                marginTop: 12,
                padding: "10px 12px",
                borderRadius: 10,
                background: rangeDeleteWorkouts.length ? "#fef2f2" : "#f8fafc",
                border: `1px solid ${rangeDeleteWorkouts.length ? "#fecaca" : "#e2e8f0"}`,
                fontSize: ".82em",
                color: "#334155",
                lineHeight: 1.5,
              }}
            >
              {!rangeDeleteValid ? (
                <span>Elige un rango válido: la fecha «Desde» no puede ser posterior a «Hasta».</span>
              ) : rangeDeleteWorkouts.length === 0 ? (
                <span>No hay entrenos en ese rango.</span>
              ) : (
                <>
                  <div style={{ fontWeight: 800, color: "#b91c1c" }}>
                    {rangeDeleteWorkouts.length} {rangeDeleteWorkouts.length === 1 ? "entreno" : "entrenos"} en el rango
                  </div>
                  {rangeDeleteDoneCount > 0 ? (
                    <div style={{ marginTop: 4 }}>
                      {rangeDeleteDoneCount} {rangeDeleteDoneCount === 1 ? "ya está marcado" : "ya están marcados"} como hechos: se borra también ese historial.
                    </div>
                  ) : null}
                  {rangeDeleteRaces.length > 0 ? (
                    <div style={{ marginTop: 4, color: "#b45309" }}>
                      🏁 {rangeDeleteRaces.length} {rangeDeleteRaces.length === 1 ? "carrera" : "carreras"} en este rango NO se eliminarán.
                    </div>
                  ) : null}
                </>
              )}
            </div>
            <div style={{ display: "flex", justifyContent: "flex-end", gap: 8, marginTop: 14 }}>
              <button
                type="button"
                onClick={() => setRangeDeleteOpen(false)}
                disabled={rangeDeleteBusy}
                style={{ background: "#fff", border: "1px solid #e2e8f0", borderRadius: 8, padding: "8px 12px", color: "#64748b", cursor: rangeDeleteBusy ? "not-allowed" : "pointer", fontFamily: "inherit", fontWeight: 700, fontSize: ".82em" }}
              >
                Cancelar
              </button>
              <button
                type="button"
                onClick={deleteWorkoutsInRange}
                disabled={rangeDeleteBusy || !rangeDeleteWorkouts.length}
                style={{
                  background: rangeDeleteBusy || !rangeDeleteWorkouts.length ? "#e2e8f0" : "linear-gradient(135deg,#b91c1c,#ef4444)",
                  border: "none",
                  borderRadius: 8,
                  padding: "8px 12px",
                  color: rangeDeleteBusy || !rangeDeleteWorkouts.length ? "#64748b" : "#fff",
                  cursor: rangeDeleteBusy || !rangeDeleteWorkouts.length ? "not-allowed" : "pointer",
                  fontFamily: "inherit",
                  fontWeight: 800,
                  fontSize: ".82em",
                }}
              >
                {rangeDeleteBusy ? "Eliminando…" : `Eliminar ${rangeDeleteWorkouts.length || ""} ${rangeDeleteWorkouts.length === 1 ? "entreno" : "entrenos"}`.trim()}
              </button>
            </div>
          </div>
        </div>
      )}
    </>
  );
}
