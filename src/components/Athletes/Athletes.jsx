import React, { useState, useEffect, useMemo, useCallback, useRef } from "react";
import { supabase } from "../../lib/supabase";
import { exportAthletePlanToPdf } from "../../lib/exportAthletePlanPdf";
import WeatherWidget from "../WeatherWidget";
import PushToWatchButton from "../PushToWatchButton";
import StatusBadge from "./StatusBadge";
import FormaFatigaPanel from "./FormaFatigaPanel";
import { AthleteListAvatar, DeviceConnectionBadges, UnreadMessagesBadge, WeeklyLoadLine } from "./listBadges";
import { useAthletePayments } from "./useAthletePayments";
import { useAthleteChat } from "./useAthleteChat";
import AthletePaymentsPanel, { AthletePaymentModal } from "./AthletePaymentsPanel";
import AthleteChatPanel from "./AthleteChatPanel";
import { useAthleteRaces } from "./useAthleteRaces";
import AthleteRaceOverlays from "./AthleteRaceOverlays";
import { useWorkoutRegistro } from "./useWorkoutRegistro";
import WorkoutRegistroModal from "./WorkoutRegistroModal";
import { useAthleteCalendar } from "./useAthleteCalendar";
import AthleteCalendarSection from "./AthleteCalendarSection";
import { useWorkoutAnalysis } from "./useWorkoutAnalysis";
import WorkoutAnalysisOverlays from "./WorkoutAnalysisOverlays";
import { setResumeUiBusy } from "../../lib/resumeGuard";
import {
  computeAthleteAchievementVisualProgress,
  computeHrZones,
  RESTING_HR_MIN,
  RESTING_HR_MAX,
  MIN_HR_RESERVE,
  loadAthleteAchievementSnapshot,
  fetchActiveDeviceConnections,
  fetchUnreadMessageCounts,
  fetchWeeklyKmByAthlete,
  normalizeWorkoutRow,
  styles,
} from "../shared/appShared";

function Athletes({ athletes, selected, onSelect, workoutsRefresh, openRegistroWorkoutId, onRegistroOpened, onAthleteWorkoutsDoneSync, onAthleteFcSync, coachDisplayName, onDeleteAthlete, notify, onOpenInviteModal }) {
  const S = styles;
  const athlete = (selected ? athletes.find(a => String(a.id) === String(selected.id)) : athletes[0]) || null;
  const [searchQuery, setSearchQuery] = useState("");
  const [workouts, setWorkouts] = useState([]);
  const [loadingWorkouts, setLoadingWorkouts] = useState(false);
  const [fcMaxInput, setFcMaxInput] = useState("");
  const [fcReposoInput, setFcReposoInput] = useState("");
  const [fcSaving, setFcSaving] = useState(false);
  const [coachId, setCoachId] = useState(null);
  const [coachAthleteEvaluations, setCoachAthleteEvaluations] = useState([]);
  const [earnedAchievements, setEarnedAchievements] = useState([]);
  const athletePaymentsApi = useAthletePayments({
    athleteId: athlete?.id ?? null,
    athleteEmail: athlete?.email,
    athleteName: athlete?.name,
    coachId,
    notify,
  });
  const normalized = searchQuery.trim().toLowerCase();
  const filteredAthletes = normalized
    ? athletes.filter(a => (a.name || "").toLowerCase().includes(normalized) || (a.goal || "").toLowerCase().includes(normalized))
    : athletes;

  // Conexiones de dispositivo de TODA la lista en una sola consulta. La clave
  // en las dependencias es la lista de ids, no el array: asi no se repite la
  // consulta cada vez que el padre reconstruye el array de atletas.
  const [deviceConnections, setDeviceConnections] = useState({});
  const [deviceConnectionsReady, setDeviceConnectionsReady] = useState(false);
  const athleteIdsKey = athletes
    .map((a) => Number(a.id))
    .filter((n) => Number.isFinite(n))
    .sort((x, y) => x - y)
    .join(",");

  useEffect(() => {
    let cancelled = false;
    const ids = athleteIdsKey ? athleteIdsKey.split(",").map(Number) : [];
    if (!ids.length) {
      setDeviceConnections({});
      setDeviceConnectionsReady(true);
      return undefined;
    }
    setDeviceConnectionsReady(false);
    fetchActiveDeviceConnections(ids).then(({ ok, byAthlete }) => {
      if (cancelled) return;
      setDeviceConnections(byAthlete);
      // Si la consulta falla no se pinta nada: decir "sin conectar" cuando en
      // realidad no pudimos leerlo seria mentir en la ficha del atleta.
      setDeviceConnectionsReady(ok);
    });
    return () => {
      cancelled = true;
    };
  }, [athleteIdsKey, workoutsRefresh]);

  // Carga de la semana (programado vs corrido) de toda la lista, en una sola
  // consulta. Se recalcula al cambiar la lista y cuando se tocan los workouts.
  const [weekLoadByAthlete, setWeekLoadByAthlete] = useState({});
  const [weekLoadReady, setWeekLoadReady] = useState(false);

  useEffect(() => {
    let cancelled = false;
    const ids = athleteIdsKey ? athleteIdsKey.split(",").map(Number) : [];
    if (!ids.length) {
      setWeekLoadByAthlete({});
      setWeekLoadReady(true);
      return undefined;
    }
    setWeekLoadReady(false);
    fetchWeeklyKmByAthlete(ids).then(({ ok, byAthlete }) => {
      if (cancelled) return;
      setWeekLoadByAthlete(byAthlete);
      setWeekLoadReady(ok);
    });
    return () => {
      cancelled = true;
    };
  }, [athleteIdsKey, workoutsRefresh]);

  // Mensajes sin leer de toda la lista, tambien en una sola consulta. El
  // contador se refresca al marcar leido y al llegar un mensaje por realtime.
  const [unreadByAthlete, setUnreadByAthlete] = useState({});
  const [unreadRefresh, setUnreadRefresh] = useState(0);

  const onChatMarkedRead = useCallback((athleteId) => {
    setUnreadByAthlete((prev) => ({ ...prev, [String(athleteId)]: 0 }));
    setUnreadRefresh((n) => n + 1);
  }, []);

  const athleteChat = useAthleteChat({
    athleteId: athlete?.id ?? null,
    athleteName: athlete?.name,
    athleteUserId: athlete?.user_id,
    coachId,
    notify,
    onMarkedRead: onChatMarkedRead,
  });
  const athleteRaces = useAthleteRaces({
    athleteId: athlete?.id ?? null,
    coachId,
    notify,
    workoutsRefresh,
  });
  const athleteCalendar = useAthleteCalendar({
    workouts,
    setWorkouts,
    athlete,
    notify,
    deviceConnections,
    deviceConnectionsReady,
    onAthleteWorkoutsDoneSync,
    setEarnedAchievements,
    races: athleteRaces.races,
  });

  useEffect(() => {
    let cancelled = false;
    const ids = athleteIdsKey ? athleteIdsKey.split(",").map(Number) : [];
    if (!coachId || !ids.length) {
      setUnreadByAthlete({});
      return undefined;
    }
    fetchUnreadMessageCounts({ coachId, athleteIds: ids }).then(({ ok, byAthlete }) => {
      if (cancelled || !ok) return;
      setUnreadByAthlete(byAthlete);
    });
    return () => {
      cancelled = true;
    };
  }, [athleteIdsKey, coachId, unreadRefresh]);

  // Un mensaje nuevo del atleta enciende el punto sin recargar la lista. Si el
  // coach tiene ese chat abierto no se cuenta: lo esta leyendo ahora mismo y el
  // efecto de marcar leido lo dejaria en cero un instante despues.
  useEffect(() => {
    if (!coachId) return undefined;
    const channel = supabase
      .channel(`unread-coach-${coachId}`)
      .on(
        "postgres_changes",
        { event: "INSERT", schema: "public", table: "messages", filter: `coach_id=eq.${coachId}` },
        (payload) => {
          const row = payload?.new;
          if (!row || row.sender_role !== "athlete" || row.read) return;
          const key = String(row.athlete_id ?? "");
          if (!key || key === String(athlete?.id ?? "")) return;
          setUnreadByAthlete((prev) => ({ ...prev, [key]: (Number(prev[key]) || 0) + 1 }));
        },
      )
      .subscribe();
    return () => { supabase.removeChannel(channel); };
  }, [coachId, athlete?.id]);

  // Con que atleta se esta pintando el calendario ahora mismo. Lo consulta
  // refreshWorkouts al recibir la respuesta: si el coach cambio de atleta
  // mientras llegaba, pintar esos workouts seria mostrarle el plan de otro.
  const shownAthleteIdRef = useRef(null);
  useEffect(() => {
    shownAthleteIdRef.current = athlete?.id ?? null;
  }, [athlete?.id]);

  /**
   * Carga los workouts del atleta seleccionado.
   *
   * En modo `silent` no toca el spinner ni vacia la lista si falla: se usa al
   * volver a la app, donde ya hay un calendario en pantalla y hacerlo parpadear
   * (o borrarlo por un fallo de red) seria peor que dejarlo como estaba.
   */
  const refreshWorkouts = useCallback(async (athleteId, { silent = false } = {}) => {
    if (!athleteId) return false;
    if (!silent) setLoadingWorkouts(true);
    const { data, error } = await supabase
      .from("workouts")
      .select("*")
      .eq("athlete_id", athleteId)
      .order("scheduled_date", { ascending: true });
    const stale = String(shownAthleteIdRef.current ?? "") !== String(athleteId);
    if (stale) return false;
    if (error) {
      console.error("Error cargando workouts:", error);
      if (!silent) {
        setWorkouts([]);
        setLoadingWorkouts(false);
      }
      return false;
    }
    setWorkouts((data || []).map(normalizeWorkoutRow));
    if (!silent) setLoadingWorkouts(false);
    return true;
  }, []);

  const calendarLoadedAthleteRef = useRef(null);
  useEffect(() => {
    if (!athlete?.id) {
      setWorkouts([]);
      calendarLoadedAthleteRef.current = null;
      return;
    }
    // Primera carga del atleta: con spinner. Resume / workoutsRefresh: silencioso.
    const sameAthlete = String(calendarLoadedAthleteRef.current ?? "") === String(athlete.id);
    calendarLoadedAthleteRef.current = athlete.id;
    refreshWorkouts(athlete.id, { silent: sameAthlete });
  }, [athlete?.id, workoutsRefresh, refreshWorkouts]);

  useEffect(() => {
    setResumeUiBusy(Boolean(String(athleteChat.chatDraft || "").trim()) || Boolean(athleteCalendar.workoutPanel));
    return () => setResumeUiBusy(false);
  }, [athleteChat.chatDraft, athleteCalendar.workoutPanel]);

  useEffect(() => {
    if (!athlete?.id) {
      setCoachAthleteEvaluations([]);
      return;
    }
    let cancelled = false;
    (async () => {
      const { data, error } = await supabase
        .from("athlete_evaluations")
        .select("vdot, created_at")
        .eq("athlete_id", athlete.id)
        .order("created_at", { ascending: true });
      if (cancelled) return;
      if (error) console.warn("athlete_evaluations (coach):", error);
      setCoachAthleteEvaluations(data || []);
    })();
    return () => {
      cancelled = true;
    };
  }, [athlete?.id]);

  const [expandedWorkoutLogs, setExpandedWorkoutLogs] = useState({});

  // VDOT del atleta desde la evaluacion mas reciente (normalizeAthlete no lo
  // arrastra, por eso athlete.vdot es undefined). coachAthleteEvaluations solo
  // trae { vdot, created_at }, asi que ordenamos por test_date||created_at.
  const athleteVdot = useMemo(() => {
    const evals = coachAthleteEvaluations || [];
    if (!evals.length) return null;
    const latest = [...evals].sort(
      (a, b) => new Date(b.test_date || b.created_at) - new Date(a.test_date || a.created_at)
    )[0];
    const v = Number(latest?.vdot);
    return Number.isFinite(v) && v > 0 ? v : null;
  }, [coachAthleteEvaluations]);

  const {
    registroModal,
    setRegistroModal,
    registroLaps,
    registroLapsLoading,
    registroBlocks,
  } = useWorkoutRegistro({ athleteVdot });

  // Deep link coach_workout_completed: abrir "Ver registro" de ese workout.
  useEffect(() => {
    if (!openRegistroWorkoutId || !workouts.length) return;
    const w = workouts.find((x) => String(x.id) === String(openRegistroWorkoutId));
    if (!w) return;
    setRegistroModal(w);
    onRegistroOpened?.();
  }, [openRegistroWorkoutId, workouts, onRegistroOpened, setRegistroModal]);
  const workoutAnalysis = useWorkoutAnalysis({
    workouts,
    setWorkouts,
    athlete,
    notify,
    registroModal,
    registroLaps,
  });
  const coachAchievementDisplayProgress = useMemo(
    () => computeAthleteAchievementVisualProgress(workouts, coachAthleteEvaluations),
    [workouts, coachAthleteEvaluations],
  );
  const coachEarnedAchievementDateByCode = useMemo(() => {
    const m = {};
    for (const row of earnedAchievements || []) {
      const code = String(row?.achievement_code || "");
      if (!code) continue;
      if (!m[code]) m[code] = row?.awarded_at || null;
    }
    return m;
  }, [earnedAchievements]);

  useEffect(() => {
    let cancelled = false;
    const load = async () => {
      if (!athlete?.id) {
        setEarnedAchievements([]);
        return;
      }
      const snapshot = await loadAthleteAchievementSnapshot(athlete.id);
      if (cancelled) return;
      setEarnedAchievements(snapshot.earned || []);
    };
    load();
    return () => {
      cancelled = true;
    };
  }, [athlete?.id, workouts]);

  useEffect(() => {
    let cancelled = false;
    supabase.auth.getUser().then(({ data }) => {
      if (!cancelled) setCoachId(data?.user?.id ?? null);
    });
    return () => { cancelled = true; };
  }, []);

  useEffect(() => {
    if (!athlete?.id) {
      setFcMaxInput("");
      setFcReposoInput("");
      return;
    }
    setFcMaxInput(athlete.fc_max != null && athlete.fc_max > 0 ? String(athlete.fc_max) : "");
    setFcReposoInput(athlete.fc_reposo != null && athlete.fc_reposo > 0 ? String(athlete.fc_reposo) : "");
  }, [athlete?.id, athlete?.fc_max, athlete?.fc_reposo]);

  const saveAthleteFc = async () => {
    if (!athlete?.id) return;
    const fcmax = fcMaxInput.trim() === "" ? null : Math.round(Number(fcMaxInput));
    const fcr = fcReposoInput.trim() === "" ? null : Math.round(Number(fcReposoInput));
    if (fcmax != null && (!Number.isFinite(fcmax) || fcmax < 30 || fcmax > 250)) {
      alert("FC máxima: indica un valor entre 30 y 250 lpm, o déjalo vacío.");
      return;
    }
    if (fcr != null && (!Number.isFinite(fcr) || fcr < RESTING_HR_MIN || fcr > RESTING_HR_MAX)) {
      alert(`FC reposo: indica un valor entre ${RESTING_HR_MIN} y ${RESTING_HR_MAX} lpm, o déjalo vacío. Por encima de ${RESTING_HR_MAX} lpm suele ser la FC media de esfuerzo, no la de reposo.`);
      return;
    }
    if (fcr != null && fcmax != null && fcmax - fcr < MIN_HR_RESERVE) {
      alert(`La diferencia entre la FC máxima (${fcmax}) y la FC en reposo (${fcr}) es muy pequeña. Revisa ambos datos.`);
      return;
    }
    setFcSaving(true);
    try {
      const { error } = await supabase.from("athletes").update({ fc_max: fcmax, fc_reposo: fcr }).eq("id", athlete.id);
      if (error) {
        console.error(error);
        alert(`Error al guardar FC: ${error.message}`);
        return;
      }
      onAthleteFcSync?.(athlete.id, fcmax, fcr);
    } finally {
      setFcSaving(false);
    }
  };

  const calendarSectionProps = {
    ...athleteCalendar,
    loadingWorkouts,
    racesByDate: athleteRaces.racesByDate,
    onOpenRaceModal: athleteRaces.openRaceModal,
    onOpenRaceMenu: athleteRaces.openRaceCalendarMenu,
    onOpenRegistro: setRegistroModal,
    athleteName: athlete?.name,
    athleteVdot,
    coachWorkoutAnalysis: workoutAnalysis.coachWorkoutAnalysis,
    coachWorkoutAnalysisLoading: workoutAnalysis.coachWorkoutAnalysisLoading,
    onAnalyze: workoutAnalysis.analyzeWorkoutAsCoach,
    onOpenAnalysis: workoutAnalysis.setCoachAnalysisModal,
  };

  if (!athlete) {
    return (
      <div style={S.page}>
        <div style={{ display: "flex", justifyContent: "space-between", alignItems: "center", gap: 12, flexWrap: "wrap", marginBottom: 20 }}>
          <h1 style={{ ...S.pageTitle, marginBottom: 0 }}>Atletas</h1>
          <button
            type="button"
            onClick={onOpenInviteModal}
            style={{ background: "linear-gradient(135deg,#0d9488,#14b8a6)", border: "none", borderRadius: 8, padding: "8px 12px", color: "#fff", fontSize: ".8em", fontWeight: 800, cursor: "pointer", fontFamily: "inherit" }}
          >
            📧 Invitar Atleta
          </button>
        </div>
        <div style={{ color: "#64748b", fontSize: ".9em" }}>No se encontraron atletas</div>
      </div>
    );
  }
  return (
    <div style={S.page}>
      <div style={{ display: "flex", justifyContent: "space-between", alignItems: "center", gap: 12, flexWrap: "wrap", marginBottom: 20 }}>
        <h1 style={{ ...S.pageTitle, marginBottom: 0 }}>Atletas</h1>
        <button
          type="button"
          onClick={onOpenInviteModal}
          style={{ background: "linear-gradient(135deg,#0d9488,#14b8a6)", border: "none", borderRadius: 8, padding: "8px 12px", color: "#fff", fontSize: ".8em", fontWeight: 800, cursor: "pointer", fontFamily: "inherit" }}
        >
          📧 Invitar Atleta
        </button>
      </div>
      <div className="pf-stack-mobile" style={{ display: "grid", gridTemplateColumns: "220px 1fr", gap: 20 }}>
        <div>
          <div style={{ marginBottom: 10 }}>
            <div style={{ fontSize: ".72em", color: "#475569", marginBottom: 6 }}>Buscar</div>
            <input
              value={searchQuery}
              onChange={e => setSearchQuery(e.target.value)}
              placeholder="Nombre o objetivo"
              style={{ width: "100%", background: "#ffffff", border: "1px solid #e2e8f0", borderRadius: 8, padding: "10px 12px", color: "#0f172a", fontFamily: "inherit", fontSize: ".85em", outline: "none", boxSizing: "border-box" }}
            />
          </div>

          {filteredAthletes.length === 0 ? (
            <div style={{ padding: "14px 8px", color: "#64748b", fontSize: ".85em" }}>No se encontraron atletas</div>
          ) : (
            filteredAthletes.map(a => (
              <div
                key={a.id}
                onClick={() => onSelect(a)}
                style={{
                  display: "flex",
                  gap: 10,
                  alignItems: "center",
                  padding: "10px 12px",
                  borderRadius: 10,
                  cursor: "pointer",
                  border: `1px solid ${athlete.id === a.id ? "rgba(255,138,61,.45)" : "#e2e8f0"}`,
                  background: athlete.id === a.id ? "rgba(255,138,61,.1)" : "#ffffff",
                  marginBottom: 8,
                  boxShadow: athlete.id === a.id ? "0 1px 3px rgba(0,0,0,0.08)" : "0 1px 2px rgba(0,0,0,0.04)",
                }}
              >
                <AthleteListAvatar url={a.avatar_url} fallback={a.avatar} />
                <div style={{ flex: 1, minWidth: 0 }}>
                  <div style={{ display: "flex", alignItems: "center", gap: 6, minWidth: 0 }}>
                    <div style={{ flex: 1, minWidth: 0, fontSize: ".85em", fontWeight: 700, color: "#0f172a", overflow: "hidden", textOverflow: "ellipsis", whiteSpace: "nowrap" }}>{a.name}</div>
                    <UnreadMessagesBadge count={unreadByAthlete[String(a.id)]} />
                  </div>
                  <div style={{ fontSize: ".7em", color: "#64748b" }}>
                    {a.pace}
                    {weekLoadReady ? <> · <WeeklyLoadLine load={weekLoadByAthlete[String(a.id)]} /></> : null}
                  </div>
                  {deviceConnectionsReady ? <DeviceConnectionBadges connections={deviceConnections[String(a.id)]} /> : null}
                </div>
                <button
                  type="button"
                  onClick={(e) => {
                    e.stopPropagation();
                    onDeleteAthlete?.(a);
                  }}
                  style={{
                    flexShrink: 0,
                    background: "#fef2f2",
                    border: "1px solid #fecaca",
                    borderRadius: 8,
                    padding: "6px 10px",
                    color: "#b91c1c",
                    fontSize: ".72em",
                    fontWeight: 700,
                    cursor: "pointer",
                    fontFamily: "inherit",
                  }}
                >
                  🗑 Eliminar
                </button>
              </div>
            ))
          )}
        </div>
        <div style={{ ...S.card, display: "flex", flexDirection: "column", gap: 0 }}>
          <div style={{ order: 1 }}>
          <div style={{ display: "flex", flexWrap: "wrap", gap: 14, alignItems: "center", marginBottom: 20 }}>
            <div style={{ ...S.avatar, width: 52, height: 52, fontSize: "1.8em" }}>{athlete.avatar}</div>
            <div style={{ flex: "1 1 180px", minWidth: 0 }}>
              <div style={{ fontSize: "1.3em", fontWeight: 700, color: "#0f172a" }}>{athlete.name}</div>
              <div style={{ color: "#64748b", fontSize: ".85em" }}>{athlete.goal}</div>
              {athleteRaces.nextRaceCountdown ? (
                <div style={{ marginTop: 8, fontSize: ".88em", fontWeight: 700, color: "#b45309", lineHeight: 1.35 }}>
                  🏁 {athleteRaces.nextRaceCountdown.race.name}
                  {" · "}
                  {athleteRaces.nextRaceCountdown.days === 0
                    ? "¡Hoy es la carrera!"
                    : athleteRaces.nextRaceCountdown.days === 1
                      ? "falta 1 día"
                      : `faltan ${athleteRaces.nextRaceCountdown.days} días`}
                </div>
              ) : null}
            </div>
            <button
              type="button"
              onClick={() => {
                try {
                  exportAthletePlanToPdf({
                    athlete,
                    workouts,
                    coachDisplayName,
                  });
                } catch (e) {
                  console.error(e);
                  alert(`No se pudo generar el PDF: ${e?.message || e}`);
                }
              }}
              style={{
                background: "#f1f5f9",
                border: "1px solid #cbd5e1",
                borderRadius: 8,
                padding: "8px 14px",
                color: "#0f172a",
                fontWeight: 700,
                cursor: "pointer",
                fontFamily: "inherit",
                fontSize: ".8em",
                whiteSpace: "nowrap",
              }}
            >
              📄 Exportar PDF
            </button>
            <PushToWatchButton athleteId={athlete?.id} athleteName={athlete?.name} />
            <StatusBadge status={athlete.status} />
          </div>
          <div style={{ display: "grid", gridTemplateColumns: "repeat(3,1fr)", gap: 12, marginBottom: 24 }}>
            {[{ label: "Ritmo", value: athlete.pace, icon: "⚡" }, { label: "Km/Semana", value: `${athlete.weekly_km}km`, icon: "📍" }, { label: "Adherencia", value: `${Math.round(athlete.workouts_done/athlete.workouts_total*100)}%`, icon: "✅" }].map((m,i) => (
              <div key={i} style={{ background: "#f8fafc", borderRadius: 10, padding: "14px 12px", textAlign: "center", border: "1px solid #e2e8f0" }}>
                <div style={{ fontSize: "1.3em" }}>{m.icon}</div>
                <div style={{ fontSize: "1.2em", fontWeight: 700, color: "#ff8a3d", fontFamily: "monospace" }}>{m.value}</div>
                <div style={{ fontSize: ".7em", color: "#64748b" }}>{m.label}</div>
              </div>
            ))}
          </div>
          </div>
<div style={{ order: 2, marginBottom: 14 }}>
  <WeatherWidget compact />
</div>
          <div style={{ order: 5, marginBottom: 24, paddingBottom: 20, borderBottom: "1px solid #e2e8f0" }}>
            <div style={{ fontSize: ".65em", letterSpacing: ".15em", color: "#334155", textTransform: "uppercase", marginBottom: 12 }}>
              ZONAS FC
            </div>
            <div style={{ display: "flex", flexWrap: "wrap", gap: 12, alignItems: "flex-end", marginBottom: 14 }}>
              <div style={{ flex: "1 1 120px", minWidth: 100 }}>
                <div style={{ fontSize: ".72em", color: "#64748b", marginBottom: 6 }}>FC máx (lpm)</div>
                <input
                  type="number"
                  min={30}
                  max={250}
                  placeholder="Ej: 185"
                  value={fcMaxInput}
                  onChange={(e) => setFcMaxInput(e.target.value)}
                  style={{ width: "100%", background: "#ffffff", border: "1px solid #e2e8f0", borderRadius: 8, padding: "8px 10px", color: "#0f172a", fontFamily: "inherit", fontSize: ".85em", outline: "none", boxSizing: "border-box" }}
                />
              </div>
              <div style={{ flex: "1 1 120px", minWidth: 100 }}>
                <div style={{ fontSize: ".72em", color: "#64748b", marginBottom: 6 }}>FC reposo (lpm)</div>
                <input
                  type="number"
                  min={RESTING_HR_MIN}
                  max={RESTING_HR_MAX}
                  placeholder="Ej: 48"
                  value={fcReposoInput}
                  onChange={(e) => setFcReposoInput(e.target.value)}
                  style={{ width: "100%", background: "#ffffff", border: "1px solid #e2e8f0", borderRadius: 8, padding: "8px 10px", color: "#0f172a", fontFamily: "inherit", fontSize: ".85em", outline: "none", boxSizing: "border-box" }}
                />
              </div>
              <button
                type="button"
                onClick={saveAthleteFc}
                disabled={fcSaving}
                style={{
                  background: fcSaving ? "#e2e8f0" : "linear-gradient(135deg,#e86f28,#ff8a3d)",
                  border: "none",
                  borderRadius: 8,
                  padding: "10px 16px",
                  color: fcSaving ? "#64748b" : "white",
                  fontWeight: 800,
                  cursor: fcSaving ? "not-allowed" : "pointer",
                  fontFamily: "inherit",
                  fontSize: ".82em",
                }}
              >
                {fcSaving ? "Guardando…" : "Guardar FC"}
              </button>
            </div>
            {(() => {
              const { zones, warning } = computeHrZones(athlete.fc_max, athlete.fc_reposo);
              return zones.length ? (
              <div style={{ display: "flex", flexDirection: "column", gap: 8 }}>
                {warning ? (
                  <div style={{ padding: "8px 10px", borderRadius: 8, border: "1px solid #fde68a", background: "#fffbeb", color: "#92400e", fontSize: ".72em", lineHeight: 1.45 }}>
                    {warning}
                  </div>
                ) : null}
                {zones.map((z) => (
                  <div key={z.zone}>
                    <div style={{ display: "flex", justifyContent: "space-between", alignItems: "baseline", marginBottom: 4, fontSize: ".78em" }}>
                      <span style={{ color: "#0f172a", fontWeight: 600 }}>
                        Zona {z.zone}: {z.low}–{z.high} lpm
                      </span>
                      <span style={{ color: "#64748b", fontSize: ".72em" }}>{z.pctLabel}</span>
                    </div>
                    <div style={{ fontSize: ".72em", color: "#94a3b8", marginBottom: 4 }}>{z.label}</div>
                    <div style={{ height: 10, borderRadius: 5, background: "#e2e8f0", overflow: "hidden" }}>
                      <div style={{ height: "100%", width: "100%", background: z.color, borderRadius: 5, opacity: 0.95 }} />
                    </div>
                  </div>
                ))}
              </div>
              ) : (
              <div style={{ color: "#64748b", fontSize: ".82em" }}>
                Indica una FC máx válida y pulsa Guardar FC para ver las 5 zonas.
              </div>
              );
            })()}
          </div>

          <AthletePaymentsPanel
            athletePayments={athletePaymentsApi.athletePayments}
            loadingPayments={athletePaymentsApi.loadingPayments}
            paymentActionBusyId={athletePaymentsApi.paymentActionBusyId}
            openPaymentModal={athletePaymentsApi.openPaymentModal}
            updatePaymentStatus={athletePaymentsApi.updatePaymentStatus}
          />

          <FormaFatigaPanel workouts={workouts} loadingWorkouts={loadingWorkouts} />

          <AthleteCalendarSection part="grid" {...calendarSectionProps} />

          <AthleteChatPanel
            coachId={coachId}
            chatMessages={athleteChat.chatMessages}
            chatDraft={athleteChat.chatDraft}
            setChatDraft={athleteChat.setChatDraft}
            chatSending={athleteChat.chatSending}
            chatClearing={athleteChat.chatClearing}
            sendCoachChat={athleteChat.sendCoachChat}
            clearCoachChat={athleteChat.clearCoachChat}
          />

        </div>
      </div>

      <AthleteCalendarSection part="overlays" {...calendarSectionProps} />

      <AthleteRaceOverlays
        raceCtxMenu={athleteRaces.raceCtxMenu}
        raceCtxMenuRef={athleteRaces.raceCtxMenuRef}
        ctxMenuRace={athleteRaces.ctxMenuRace}
        openRaceEditPanel={athleteRaces.openRaceEditPanel}
        openRaceMovePanel={athleteRaces.openRaceMovePanel}
        deleteRaceFromCalendar={athleteRaces.deleteRaceFromCalendar}
        racePanel={athleteRaces.racePanel}
        panelRace={athleteRaces.panelRace}
        raceEditForm={athleteRaces.raceEditForm}
        setRaceEditForm={athleteRaces.setRaceEditForm}
        raceMoveDate={athleteRaces.raceMoveDate}
        setRaceMoveDate={athleteRaces.setRaceMoveDate}
        raceActionBusy={athleteRaces.raceActionBusy}
        closeRacePanel={athleteRaces.closeRacePanel}
        saveRaceEdits={athleteRaces.saveRaceEdits}
        applyRaceMoveDate={athleteRaces.applyRaceMoveDate}
        raceModalOpen={athleteRaces.raceModalOpen}
        raceSaving={athleteRaces.raceSaving}
        raceForm={athleteRaces.raceForm}
        setRaceForm={athleteRaces.setRaceForm}
        closeRaceModal={athleteRaces.closeRaceModal}
        saveRace={athleteRaces.saveRace}
      />

      <WorkoutAnalysisOverlays
        adjustProposalModal={workoutAnalysis.adjustProposalModal}
        setAdjustProposalModal={workoutAnalysis.setAdjustProposalModal}
        applyAdjustment={workoutAnalysis.applyAdjustment}
        notify={notify}
        coachAnalysisModal={workoutAnalysis.coachAnalysisModal}
        setCoachAnalysisModal={workoutAnalysis.setCoachAnalysisModal}
        adjustLoading={workoutAnalysis.adjustLoading}
        adjustPlanWithAI={workoutAnalysis.adjustPlanWithAI}
      />

      <WorkoutRegistroModal
        workout={registroModal}
        athleteVdot={athleteVdot}
        registroLapsLoading={registroLapsLoading}
        registroBlocks={registroBlocks}
        onClose={() => setRegistroModal(null)}
      />
      <AthletePaymentModal
        paymentModalOpen={athletePaymentsApi.paymentModalOpen}
        paymentForm={athletePaymentsApi.paymentForm}
        setPaymentForm={athletePaymentsApi.setPaymentForm}
        paymentSaving={athletePaymentsApi.paymentSaving}
        closePaymentModal={athletePaymentsApi.closePaymentModal}
        registerPayment={athletePaymentsApi.registerPayment}
      />

    </div>
  );
}

export default Athletes;
