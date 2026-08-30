import { useState, useEffect, useMemo, useCallback, useRef } from "react";
import { supabase } from "../../lib/supabase";
import {
  formatLocalYMD,
  getNextRaceCountdown,
  normalizeRaceRow,
  raceDistanceToFormFields,
} from "../shared/appShared";

const EMPTY_RACE_FORM = {
  name: "",
  date: "",
  distance: "21K",
  distanceOther: "",
  city: "",
  priority: "A",
};

/**
 * Carreras futuras del atleta (`races`) — no es el workout type:race / GPX.
 * El grid solo necesita `racesByDate` + `openRaceCalendarMenu`.
 */
export function useAthleteRaces({ athleteId, coachId, notify, workoutsRefresh }) {
  const [races, setRaces] = useState([]);
  const [raceModalOpen, setRaceModalOpen] = useState(false);
  const [raceSaving, setRaceSaving] = useState(false);
  const [raceForm, setRaceForm] = useState(() => ({
    ...EMPTY_RACE_FORM,
    date: formatLocalYMD(new Date()),
  }));
  const [raceCtxMenu, setRaceCtxMenu] = useState(null);
  const raceCtxMenuRef = useRef(null);
  const [racePanel, setRacePanel] = useState(null);
  const [raceEditForm, setRaceEditForm] = useState({ ...EMPTY_RACE_FORM });
  const [raceMoveDate, setRaceMoveDate] = useState("");
  const [raceActionBusy, setRaceActionBusy] = useState(false);

  const fetchRaces = useCallback(async () => {
    if (!athleteId) return { ok: false, rows: [] };
    const { data, error } = await supabase
      .from("races")
      .select("*")
      .eq("athlete_id", athleteId)
      .order("date", { ascending: true });
    if (error) {
      console.error("Error cargando carreras:", error);
      return { ok: false, rows: [] };
    }
    return { ok: true, rows: (data || []).map(normalizeRaceRow) };
  }, [athleteId]);

  useEffect(() => {
    let cancelled = false;
    if (!athleteId) {
      setRaces([]);
      return undefined;
    }
    fetchRaces().then(({ ok, rows }) => {
      if (cancelled) return;
      setRaces(ok ? rows : []);
    });
    return () => {
      cancelled = true;
    };
  }, [athleteId, workoutsRefresh, fetchRaces]);

  const refreshRacesList = useCallback(async () => {
    if (!athleteId) return;
    const { ok, rows } = await fetchRaces();
    if (ok) setRaces(rows);
  }, [athleteId, fetchRaces]);

  const racesByDate = useMemo(() => {
    const m = {};
    for (const r of races) {
      const k = r.date;
      if (!k) continue;
      if (!m[k]) m[k] = [];
      m[k].push(r);
    }
    return m;
  }, [races]);

  const nextRaceCountdown = useMemo(
    () => getNextRaceCountdown(races, formatLocalYMD(new Date())),
    [races],
  );

  const closeRaceCtxMenu = () => setRaceCtxMenu(null);

  const ctxMenuRace = useMemo(
    () => (raceCtxMenu ? races.find((r) => String(r.id) === String(raceCtxMenu.raceId)) || null : null),
    [races, raceCtxMenu],
  );

  const panelRace = useMemo(
    () => (racePanel ? races.find((r) => String(r.id) === String(racePanel.raceId)) || null : null),
    [races, racePanel],
  );

  const openRaceCalendarMenu = (e, race) => {
    e.preventDefault();
    e.stopPropagation();
    const pad = 8;
    const mw = 280;
    const mh = 160;
    const vw = typeof window !== "undefined" ? window.innerWidth : 800;
    const vh = typeof window !== "undefined" ? window.innerHeight : 600;
    const x = Math.min(e.clientX, vw - mw - pad);
    const y = Math.min(e.clientY, vh - mh - pad);
    setRaceCtxMenu({ x, y, raceId: race.id });
  };

  const openRaceEditPanel = (race) => {
    if (!race) return;
    const df = raceDistanceToFormFields(race.distance);
    setRaceEditForm({
      name: race.name || "",
      date: race.date || formatLocalYMD(new Date()),
      ...df,
      city: race.city || "",
      priority: race.priority || "A",
    });
    setRacePanel({ mode: "edit", raceId: race.id });
    closeRaceCtxMenu();
  };

  const openRaceMovePanel = (race) => {
    if (!race) return;
    setRaceMoveDate(race.date || formatLocalYMD(new Date()));
    setRacePanel({ mode: "move", raceId: race.id });
    closeRaceCtxMenu();
  };

  const closeRacePanel = () => {
    setRacePanel(null);
    setRaceActionBusy(false);
  };

  const saveRaceEdits = async () => {
    if (!panelRace?.id) return;
    const dist =
      raceEditForm.distance === "Otro"
        ? (raceEditForm.distanceOther || "").trim() || "Otro"
        : raceEditForm.distance;
    if (raceEditForm.distance === "Otro" && !(raceEditForm.distanceOther || "").trim()) {
      notify?.("Describe la distancia (Otro)");
      return;
    }
    setRaceActionBusy(true);
    const { error } = await supabase
      .from("races")
      .update({
        name: raceEditForm.name.trim() || panelRace.name,
        date: raceEditForm.date,
        distance: dist,
        city: raceEditForm.city.trim() || null,
        priority: raceEditForm.priority || "A",
      })
      .eq("id", panelRace.id);
    setRaceActionBusy(false);
    if (error) {
      console.error(error);
      notify?.(error.message || "Error al guardar");
      return;
    }
    notify?.("Carrera actualizada");
    closeRacePanel();
    await refreshRacesList();
  };

  const applyRaceMoveDate = async () => {
    if (!panelRace?.id || !raceMoveDate) return;
    setRaceActionBusy(true);
    const { error } = await supabase.from("races").update({ date: raceMoveDate }).eq("id", panelRace.id);
    setRaceActionBusy(false);
    if (error) {
      console.error(error);
      notify?.(error.message || "Error al mover");
      return;
    }
    notify?.("Fecha actualizada");
    closeRacePanel();
    await refreshRacesList();
  };

  const deleteRaceFromCalendar = async (race) => {
    if (!race?.id) return;
    if (!window.confirm("¿Eliminar esta carrera?")) return;
    closeRaceCtxMenu();
    closeRacePanel();
    setRaceActionBusy(true);
    const { error } = await supabase.from("races").delete().eq("id", race.id);
    setRaceActionBusy(false);
    if (error) {
      console.error(error);
      notify?.(error.message || "No se pudo eliminar");
      return;
    }
    notify?.("Carrera eliminada");
    await refreshRacesList();
  };

  useEffect(() => {
    if (!raceCtxMenu) return;
    const onDown = (ev) => {
      if (raceCtxMenuRef.current?.contains(ev.target)) return;
      closeRaceCtxMenu();
    };
    const t = setTimeout(() => document.addEventListener("mousedown", onDown), 0);
    return () => {
      clearTimeout(t);
      document.removeEventListener("mousedown", onDown);
    };
  }, [raceCtxMenu]);

  const openRaceModal = () => {
    setRaceForm({
      name: "",
      date: formatLocalYMD(new Date()),
      distance: "21K",
      distanceOther: "",
      city: "",
      priority: "A",
    });
    setRaceModalOpen(true);
  };

  const closeRaceModal = () => setRaceModalOpen(false);

  const saveRace = async () => {
    if (!athleteId || !coachId) return;
    const name = raceForm.name.trim();
    if (!name) {
      notify?.("Indica el nombre de la carrera");
      return;
    }
    if (!raceForm.date) {
      notify?.("Indica la fecha de la carrera");
      return;
    }
    const dist =
      raceForm.distance === "Otro" ? (raceForm.distanceOther || "").trim() || "Otro" : raceForm.distance;
    if (raceForm.distance === "Otro" && !(raceForm.distanceOther || "").trim()) {
      notify?.("Describe la distancia (Otro)");
      return;
    }
    setRaceSaving(true);
    try {
      const { error } = await supabase.from("races").insert({
        athlete_id: athleteId,
        coach_id: coachId,
        name,
        date: raceForm.date,
        distance: dist,
        city: raceForm.city.trim() || null,
        priority: raceForm.priority || "A",
      });
      if (error) {
        console.error(error);
        notify?.(error.message || "No se pudo guardar la carrera");
        return;
      }
      notify?.("Carrera registrada");
      setRaceModalOpen(false);
      await refreshRacesList();
    } finally {
      setRaceSaving(false);
    }
  };

  return {
    races,
    racesByDate,
    nextRaceCountdown,
    openRaceCalendarMenu,
    openRaceModal,
    raceModalOpen,
    raceSaving,
    raceForm,
    setRaceForm,
    closeRaceModal,
    saveRace,
    raceCtxMenu,
    raceCtxMenuRef,
    ctxMenuRace,
    openRaceEditPanel,
    openRaceMovePanel,
    deleteRaceFromCalendar,
    racePanel,
    panelRace,
    raceEditForm,
    setRaceEditForm,
    raceMoveDate,
    setRaceMoveDate,
    raceActionBusy,
    closeRacePanel,
    saveRaceEdits,
    applyRaceMoveDate,
  };
}
