import { useState, useEffect, useMemo, useRef } from "react";
import { supabase } from "../../lib/supabase";
import {
  WORKOUT_TYPES,
  formatLocalYMD,
  getMonthGrid,
  emptyWorkoutStructureRow,
  workoutStructureToEditableRows,
  editableRowsToWorkoutStructure,
  achievementJoinMeta,
  evaluateAndAwardAthleteAchievements,
  deleteIntervalsEvents,
} from "../shared/appShared";

/**
 * Calendario del coach: grid, DnD (calendarDragRef + dragWorkoutId), menú
 * contextual, panel de estructura/mover y borrar rango.
 * `toggleWorkoutDone` es el camino del coach (sin modal RPE de AthleteHome).
 * `workoutPanel` sale hacia arriba para el OR de resumeUiBusy con el chat.
 */
export function useAthleteCalendar({
  workouts,
  setWorkouts,
  athlete,
  notify,
  deviceConnections,
  deviceConnectionsReady,
  onAthleteWorkoutsDoneSync,
  races,
}) {
  const [dragWorkoutId, setDragWorkoutId] = useState(null);
  const calendarDragRef = useRef(false);
  const [calendarCtxMenu, setCalendarCtxMenu] = useState(null);
  const calendarCtxMenuRef = useRef(null);
  const [workoutPanel, setWorkoutPanel] = useState(null);
  const [workoutFormSaving, setWorkoutFormSaving] = useState(false);
  const [workoutEditForm, setWorkoutEditForm] = useState({
    title: "",
    type: "easy",
    total_km: "",
    duration_min: "",
    description: "",
    structureRows: [emptyWorkoutStructureRow()],
  });
  const [moveDateInput, setMoveDateInput] = useState("");

  const workoutsByDate = useMemo(() => {
    const m = {};
    for (const w of workouts) {
      const k = w.scheduled_date;
      if (!m[k]) m[k] = [];
      m[k].push(w);
    }
    return m;
  }, [workouts]);

  const [calendarViewMonth, setCalendarViewMonth] = useState(() => {
    const n = new Date();
    return { y: n.getFullYear(), m: n.getMonth() };
  });
  const calendarCells = useMemo(
    () => getMonthGrid(calendarViewMonth.y, calendarViewMonth.m),
    [calendarViewMonth],
  );
  const calendarMonthLabel = useMemo(
    () =>
      new Date(calendarViewMonth.y, calendarViewMonth.m, 1).toLocaleDateString("es-CO", {
        month: "long",
        year: "numeric",
      }),
    [calendarViewMonth],
  );

  const [rangeDeleteOpen, setRangeDeleteOpen] = useState(false);
  const [rangeDeleteFrom, setRangeDeleteFrom] = useState("");
  const [rangeDeleteTo, setRangeDeleteTo] = useState("");
  const [rangeDeleteBusy, setRangeDeleteBusy] = useState(false);

  const toggleWorkoutDone = async (w) => {
    const next = !w.done;
    const payload = next ? { done: true } : { done: false, rpe: null };
    const { error } = await supabase.from("workouts").update(payload).eq("id", w.id);
    if (error) {
      console.error(error);
      alert(`Error al actualizar: ${error.message}`);
      return;
    }
    const nextWorkouts = workouts.map(x => (x.id === w.id ? { ...x, done: next, rpe: next ? x.rpe : null } : x));
    setWorkouts(nextWorkouts);

    const workoutsDone = nextWorkouts.filter(x => x.done).length;
    onAthleteWorkoutsDoneSync?.(athlete.id, workoutsDone);

    const { error: athleteUpdateError } = await supabase
      .from("athletes")
      .update({ workouts_done: workoutsDone })
      .eq("id", athlete.id);
    if (athleteUpdateError) {
      console.error("Error actualizando workouts_done en athletes:", athleteUpdateError);
    }
    if (next) {
      const { newAwards } = await evaluateAndAwardAthleteAchievements(athlete.id);
      if (newAwards.length > 0) {
        const first = achievementJoinMeta(newAwards[0]);
        notify?.(`¡Nueva medalla desbloqueada! 🎉 ${first?.icon || ""} ${first?.name || ""}`.trim());
      }
    }
  };

  const closeCalendarCtxMenu = () => setCalendarCtxMenu(null);

  const ctxMenuWorkout = useMemo(
    () => (calendarCtxMenu ? workouts.find((x) => String(x.id) === String(calendarCtxMenu.workoutId)) || null : null),
    [workouts, calendarCtxMenu],
  );

  const panelWorkout = useMemo(
    () => (workoutPanel ? workouts.find((x) => String(x.id) === String(workoutPanel.workoutId)) || null : null),
    [workouts, workoutPanel],
  );

  const populateEditFormFromWorkout = (w) => {
    const rows = workoutStructureToEditableRows(w.structure);
    setWorkoutEditForm({
      title: w.title || "",
      type: WORKOUT_TYPES.some((t) => t.id === w.type) ? w.type : "easy",
      total_km: String(Number(w.total_km) || 0),
      duration_min: String(Number(w.duration_min) || 0),
      description: w.description || "",
      structureRows: rows.length ? rows : [emptyWorkoutStructureRow()],
    });
    setMoveDateInput(w.scheduled_date || formatLocalYMD(new Date()));
  };

  /**
   * Suelta el candado DnD↔menú. onDragEnd del chip a menudo NO corre tras un
   * drop exitoso: moveWorkoutToDate hace setWorkouts al instante, el botón
   * cambia de celda (key distinta entre hermanos) y React lo desmonta antes
   * de que el navegador dispare dragend. Hay que llamar esto también desde
   * onDrop (finally), con el mismo setTimeout(0) para tragar el click residual.
   */
  const releaseCalendarDrag = () => {
    setDragWorkoutId(null);
    setTimeout(() => {
      calendarDragRef.current = false;
    }, 0);
  };

  const openCalendarWorkoutMenu = (e, w) => {
    e.preventDefault();
    e.stopPropagation();
    if (calendarDragRef.current) return;
    const pad = 8;
    const mw = 280;
    const mh = 320;
    const vw = typeof window !== "undefined" ? window.innerWidth : 800;
    const vh = typeof window !== "undefined" ? window.innerHeight : 600;
    const x = Math.min(e.clientX, vw - mw - pad);
    const y = Math.min(e.clientY, vh - mh - pad);
    setCalendarCtxMenu({ x, y, workoutId: w.id, view: "actions" });
  };

  const openCalendarWorkoutDetail = (e) => {
    e.preventDefault();
    e.stopPropagation();
    setCalendarCtxMenu((prev) => {
      if (!prev) return prev;
      const pad = 8;
      const mw = Math.min(typeof window !== "undefined" ? window.innerWidth * 0.92 : 320, 340);
      const mh = Math.min(typeof window !== "undefined" ? window.innerHeight * 0.7 : 400, 420);
      const vw = typeof window !== "undefined" ? window.innerWidth : 800;
      const vh = typeof window !== "undefined" ? window.innerHeight : 600;
      const x = Math.max(pad, Math.min(prev.x, vw - mw - pad));
      const y = Math.max(pad, Math.min(prev.y, vh - mh - pad));
      return { ...prev, view: "detail", x, y };
    });
  };

  const openWorkoutEditPanel = (w) => {
    if (!w) return;
    populateEditFormFromWorkout(w);
    setWorkoutPanel({ mode: "edit", workoutId: w.id });
    closeCalendarCtxMenu();
  };

  const openWorkoutMovePanel = (w) => {
    if (!w) return;
    populateEditFormFromWorkout(w);
    setWorkoutPanel({ mode: "move", workoutId: w.id });
    closeCalendarCtxMenu();
  };

  const closeWorkoutPanel = () => {
    setWorkoutPanel(null);
    setWorkoutFormSaving(false);
  };

  useEffect(() => {
    if (!calendarCtxMenu) return;
    const onDown = (ev) => {
      if (calendarCtxMenuRef.current?.contains(ev.target)) return;
      closeCalendarCtxMenu();
    };
    const t = setTimeout(() => document.addEventListener("mousedown", onDown), 0);
    return () => {
      clearTimeout(t);
      document.removeEventListener("mousedown", onDown);
    };
  }, [calendarCtxMenu]);

  const moveWorkoutToDate = async (workoutId, nextDate, withToast = true) => {
    const target = formatLocalYMD(new Date(`${nextDate}T12:00:00`));
    if (!target) return;
    const prev = workouts;
    setWorkouts((rows) => rows.map((x) => (String(x.id) === String(workoutId) ? { ...x, scheduled_date: target } : x)));
    const { error } = await supabase.from("workouts").update({ scheduled_date: target }).eq("id", workoutId);
    if (error) {
      console.error("Error moviendo workout:", error);
      setWorkouts(prev);
      notify?.(`Error moviendo workout: ${error.message}`);
      return;
    }
    if (withToast) notify?.(`Workout movido al ${target}`);
  };

  const saveWorkoutEdits = async () => {
    if (!panelWorkout?.id) return;
    const structure = editableRowsToWorkoutStructure(workoutEditForm.structureRows);
    const payload = {
      title: workoutEditForm.title.trim() || panelWorkout.title,
      type: WORKOUT_TYPES.some((t) => t.id === workoutEditForm.type) ? workoutEditForm.type : panelWorkout.type,
      total_km: Number(workoutEditForm.total_km) || 0,
      duration_min: Math.round(Number(workoutEditForm.duration_min) || 0),
      description: workoutEditForm.description || "",
      structure,
    };
    setWorkoutFormSaving(true);
    const prev = workouts;
    setWorkouts((rows) => rows.map((x) => (String(x.id) === String(panelWorkout.id) ? { ...x, ...payload } : x)));
    const { error } = await supabase.from("workouts").update(payload).eq("id", panelWorkout.id);
    setWorkoutFormSaving(false);
    if (error) {
      console.error("Error editando workout:", error);
      setWorkouts(prev);
      notify?.(`Error editando workout: ${error.message}`);
      return;
    }
    notify?.("Workout actualizado");
    closeWorkoutPanel();
  };

  /**
   * ¿Merece la pena preguntar a intervals.icu por este atleta?
   *
   * Solo se ahorra la llamada cuando SABEMOS que no hay conexion. Si el mapa de
   * conexiones no se pudo leer, se llama: dejar un evento huerfano en el reloj
   * por una consulta que fallo es peor que una peticion de mas, y el servidor ya
   * responde "sin conexión" sin tocar nada.
   */
  const mayHaveIntervals = (athleteId) => {
    if (!deviceConnectionsReady) return true;
    const conns = deviceConnections[String(athleteId)] || [];
    return conns.some((c) => c.provider === "intervals_icu");
  };

  /**
   * Retira los eventos de intervals.icu de unos workouts ya borrados. Best
   * effort y sin await: el borrado local ya termino y no se bloquea al usuario
   * por el reloj. Si falla, queda el aviso en consola y el evento huerfano.
   */
  const forgetIntervalsEvents = (athleteId, ids) => {
    if (!athleteId || !ids.length || !mayHaveIntervals(athleteId)) return;
    deleteIntervalsEvents(athleteId, ids).then((r) => {
      if (r.ok) return;
      notify?.(ids.length === 1
        ? "El entreno se eliminó, pero no pudimos quitarlo del reloj del atleta."
        : "Los entrenos se eliminaron, pero no pudimos quitarlos del reloj del atleta.");
    });
  };

  const deleteCalendarWorkout = async (w) => {
    if (!w?.id) return;
    if (!window.confirm("¿Eliminar este workout? Esta acción no se puede deshacer.")) return;
    closeCalendarCtxMenu();
    closeWorkoutPanel();
    const id = w.id;
    setWorkoutFormSaving(true);
    const prev = workouts;
    setWorkouts((rows) => rows.filter((x) => String(x.id) !== String(id)));
    // El .select() confirma que la fila se borro de verdad: la RLS filtra en
    // silencio (200 y cero filas), y ahi no hay que tocar el reloj ni decir que
    // se elimino algo que sigue en el calendario.
    const { data, error } = await supabase.from("workouts").delete().eq("id", id).select("id");
    setWorkoutFormSaving(false);
    if (error) {
      console.error("Error eliminando workout:", error);
      setWorkouts(prev);
      notify?.(`Error eliminando workout: ${error.message}`);
      return;
    }
    if (!(data || []).length) {
      setWorkouts(prev);
      notify?.("No se eliminó el workout (no tienes permiso sobre esa fila)");
      return;
    }
    notify?.("Workout eliminado");
    // Ya no esta en la app: que tampoco siga llegando al reloj.
    forgetIntervalsEvents(w.athlete_id ?? athlete?.id, [id]);
  };

  /** Fecha legible a partir de un YYYY-MM-DD, sin desfase de zona horaria. */
  const rangeDayLabel = (ymd) => {
    if (!ymd) return "";
    const d = new Date(`${ymd}T12:00:00`);
    if (Number.isNaN(d.getTime())) return ymd;
    return d.toLocaleDateString("es-CO", { day: "2-digit", month: "short", year: "numeric" });
  };

  const openRangeDeleteModal = () => {
    // Arranca con el mes que el coach esta viendo: es el rango que va a querer
    // limpiar el 90% de las veces.
    const { y, m } = calendarViewMonth;
    setRangeDeleteFrom(formatLocalYMD(new Date(y, m, 1)));
    setRangeDeleteTo(formatLocalYMD(new Date(y, m + 1, 0)));
    setRangeDeleteOpen(true);
  };

  const rangeDeleteValid = Boolean(rangeDeleteFrom && rangeDeleteTo && rangeDeleteFrom <= rangeDeleteTo);

  /** Entrenos del atleta actual dentro del rango (scheduled_date es YYYY-MM-DD). */
  const rangeDeleteWorkouts = useMemo(() => {
    if (!rangeDeleteValid) return [];
    return workouts.filter((w) => {
      const d = String(w?.scheduled_date || "");
      return d && d >= rangeDeleteFrom && d <= rangeDeleteTo;
    });
  }, [workouts, rangeDeleteFrom, rangeDeleteTo, rangeDeleteValid]);

  /** Carreras en el rango: solo para avisar de que NO se van a tocar. */
  const rangeDeleteRaces = useMemo(() => {
    if (!rangeDeleteValid) return [];
    return (races || []).filter((r) => {
      const d = String(r?.date || "");
      return d && d >= rangeDeleteFrom && d <= rangeDeleteTo;
    });
  }, [races, rangeDeleteFrom, rangeDeleteTo, rangeDeleteValid]);

  const rangeDeleteDoneCount = useMemo(
    () => rangeDeleteWorkouts.filter((w) => w.done).length,
    [rangeDeleteWorkouts],
  );

  const deleteWorkoutsInRange = async () => {
    if (!athlete?.id) return;
    if (!rangeDeleteFrom || !rangeDeleteTo) {
      notify?.("Elige las dos fechas del rango");
      return;
    }
    if (rangeDeleteFrom > rangeDeleteTo) {
      notify?.('La fecha "Desde" es posterior a "Hasta"');
      return;
    }
    const ids = rangeDeleteWorkouts.map((w) => w.id).filter((id) => id != null);
    if (!ids.length) {
      notify?.("No hay entrenos en ese rango");
      return;
    }
    const lines = [
      `Se eliminarán ${ids.length} ${ids.length === 1 ? "entreno" : "entrenos"} entre ` +
        `${rangeDayLabel(rangeDeleteFrom)} y ${rangeDayLabel(rangeDeleteTo)}. ` +
        "Esta acción no se puede deshacer.",
    ];
    if (rangeDeleteRaces.length) lines.push("Las carreras en este rango NO se eliminarán.");
    if (!window.confirm(lines.join("\n\n"))) return;

    setRangeDeleteBusy(true);
    const prev = workouts;
    const requested = new Set(ids.map(String));
    setWorkouts((rows) => rows.filter((x) => !requested.has(String(x.id))));
    // El .eq("athlete_id") es un cinturon de seguridad: los ids ya salen del
    // atleta seleccionado, pero asi ni un estado obsoleto puede tocar a otro.
    const { data, error } = await supabase
      .from("workouts")
      .delete()
      .in("id", ids)
      .eq("athlete_id", athlete.id)
      .select("id");
    setRangeDeleteBusy(false);
    if (error) {
      console.error("Error eliminando entrenos por rango:", error);
      setWorkouts(prev);
      notify?.(`Error eliminando entrenos: ${error.message}`);
      return;
    }
    // La RLS filtra en silencio lo que no es del coach: se borra sin error pero
    // con menos filas. Se reconstruye el estado con lo que REALMENTE se borro,
    // para no dejar en pantalla un calendario que miente.
    const deletedIds = new Set((data || []).map((r) => String(r.id)));
    setWorkouts(prev.filter((x) => !deletedIds.has(String(x.id))));
    if (deletedIds.size === 0) {
      notify?.("No se eliminó ningún entreno (no tienes permiso sobre esas filas)");
      return;
    }
    if (deletedIds.size < ids.length) {
      notify?.(`Se eliminaron ${deletedIds.size} de ${ids.length} entrenos (el resto no se pudo borrar por permisos).`);
    } else {
      notify?.(`${deletedIds.size} ${deletedIds.size === 1 ? "entreno eliminado" : "entrenos eliminados"}`);
    }
    // Solo los que REALMENTE se borraron: los que la RLS bloqueo siguen en la
    // app, asi que su evento debe seguir en el reloj.
    forgetIntervalsEvents(athlete.id, [...deletedIds]);
    setRangeDeleteOpen(false);
  };

  return {
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
  };
}
