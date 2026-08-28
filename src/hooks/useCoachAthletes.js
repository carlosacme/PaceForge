import { useState, useEffect, useCallback } from "react";
import { supabase } from "../lib/supabase";
import {
  normalizeAthlete,
  isAuthLockContentionError,
  withAuthLockRetry,
} from "../components/shared/appShared";

/** Persistencia del atleta seleccionado en la vista Atletas del coach. */
const RAF_SELECTED_ATHLETE_STORAGE_KEY = "raf_selected_athlete";

/**
 * Lista canónica de atletas del coach (+ staff) y CRUD shell.
 *
 * Incluye form Dashboard (showAddAthleteForm / saveNewAthlete) tal cual —
 * hoy inalcanzable en UI (alta real = InviteModal); no purgar aquí.
 *
 * @param {{
 *   session: object | null,
 *   authLoading: boolean,
 *   notify: (msg: string) => void,
 *   profile: object | null,
 * }} args
 */
export function useCoachAthletes({ session, authLoading, notify, profile }) {
  const [selectedAthlete, setSelectedAthlete] = useState(null);
  const [workoutsRefresh, setWorkoutsRefresh] = useState(0);
  /** Deep link: abrir modal Registro de este workout en la vista Atletas. */
  const [pendingRegistroWorkoutId, setPendingRegistroWorkoutId] = useState(null);
  const [athletes, setAthletes] = useState([]);
  const [loadingAthletes, setLoadingAthletes] = useState(true);
  const [showAddAthleteForm, setShowAddAthleteForm] = useState(false);
  const [planLimitWarning, setPlanLimitWarning] = useState("");
  const [newAthlete, setNewAthlete] = useState({ name: "", email: "", goal: "", pace: "", weekly_km: "" });
  const [staffParentCoachId, setStaffParentCoachId] = useState("");

  const updateNewAthleteField = useCallback((field, value) => {
    setNewAthlete((prev) => ({ ...prev, [field]: value }));
  }, []);

  const bumpWorkoutsRefresh = useCallback(() => {
    setWorkoutsRefresh((r) => r + 1);
  }, []);

  const loadAthletes = useCallback(async ({ silent = false } = {}) => {
    if (authLoading || !session) {
      setAthletes([]);
      setLoadingAthletes(false);
      return;
    }
    if (!silent) setLoadingAthletes(true);
    try {
      await withAuthLockRetry(async () => {
        const { data: userData, error: userError } = await supabase.auth.getUser();
        if (isAuthLockContentionError(userError)) throw userError;
        if (userError || !userData?.user) {
          console.error("Error obteniendo usuario para filtrar atletas:", userError);
          if (!silent) notify("Error cargando atletas");
          setAthletes([]);
          return;
        }
        const coachId = userData.user.id;

        const { data: staffRow, error: staffErr } = await supabase
          .from("coach_staff")
          .select("coach_id")
          .eq("staff_id", coachId)
          .maybeSingle();
        if (isAuthLockContentionError(staffErr)) throw staffErr;
        if (staffRow?.coach_id) setStaffParentCoachId(staffRow.coach_id);

        let data;
        let error;
        if (staffRow) {
          const { data: assignedRows, error: assignedErr } = await supabase
            .from("staff_athletes")
            .select("athlete_id")
            .eq("staff_id", coachId)
            .eq("coach_id", staffRow.coach_id);
          if (isAuthLockContentionError(assignedErr)) throw assignedErr;
          const assignedIds = [...new Set((assignedRows || []).map((r) => r.athlete_id))];
          if (assignedIds.length === 0) {
            setAthletes([]);
          } else {
            const res = await supabase.from("athletes").select("*").in("id", assignedIds).order("id", { ascending: true });
            data = res.data;
            error = res.error;
          }
        } else {
          const res = await supabase.from("athletes").select("*").eq("coach_id", coachId).order("id", { ascending: true });
          data = res.data;
          error = res.error;
        }

        if (isAuthLockContentionError(error)) throw error;

        if (error) {
          if (!silent) notify("Error cargando atletas");
          setAthletes([]);
        } else if (data !== undefined) {
          setAthletes((data || []).map(normalizeAthlete));
        }
      });
    } catch (error) {
      console.error("Error inesperado cargando atletas:", error);
      if (!silent) {
        notify(
          isAuthLockContentionError(error)
            ? "No se pudieron sincronizar los datos. Recarga la página e inténtalo de nuevo."
            : "Error cargando atletas",
        );
      }
      setAthletes([]);
    } finally {
      if (!silent) setLoadingAthletes(false);
    }
  }, [authLoading, session, notify]);

  useEffect(() => {
    loadAthletes({ silent: false });
  }, [loadAthletes]);

  useEffect(() => {
    if (typeof localStorage === "undefined") return;
    if (selectedAthlete?.id != null) {
      localStorage.setItem(RAF_SELECTED_ATHLETE_STORAGE_KEY, String(selectedAthlete.id));
    }
  }, [selectedAthlete?.id]);

  useEffect(() => {
    if (!athletes.length || typeof localStorage === "undefined") return;
    const raw = localStorage.getItem(RAF_SELECTED_ATHLETE_STORAGE_KEY);
    const foundByLs = raw ? athletes.find((a) => String(a.id) === String(raw)) : null;
    if (raw && !foundByLs) {
      localStorage.removeItem(RAF_SELECTED_ATHLETE_STORAGE_KEY);
    }
    setSelectedAthlete((prev) => {
      if (prev && athletes.some((a) => String(a.id) === String(prev.id))) {
        return prev;
      }
      return foundByLs || null;
    });
  }, [athletes]);

  const saveNewAthlete = useCallback(async () => {
    const name = newAthlete.name.trim();
    const email = newAthlete.email.trim();
    const goal = newAthlete.goal.trim();
    const pace = newAthlete.pace.trim();
    const weeklyKm = Number(newAthlete.weekly_km);

    if (!name || !email || !goal || !pace || !Number.isFinite(weeklyKm) || weeklyKm <= 0) {
      notify("Completa todos los campos ✓");
      return;
    }

    const rawPlan = String(profile?.subscription_plan || "Basico").toLowerCase();
    const isBasicPlan = rawPlan === "basico" || rawPlan === "básico" || rawPlan === "starter";
    if (isBasicPlan && athletes.length >= 15) {
      const limitMsg = "Has alcanzado el límite de tu plan. Actualiza al plan Pro para agregar más atletas.";
      setPlanLimitWarning(limitMsg);
      notify(limitMsg);
      return;
    }

    const { data: userData, error: userError } = await supabase.auth.getUser();
    if (userError || !userData?.user) {
      console.error("Error obteniendo usuario para guardar atleta:", userError);
      alert(userError?.message || "No se pudo obtener el usuario autenticado.");
      notify("Error al guardar atleta");
      return;
    }

    const payload = { name, email, goal, pace, weekly_km: weeklyKm, coach_id: userData.user.id };
    const { data, error } = await supabase.from("athletes").insert(payload).select().single();
    if (error) {
      const errorText = [
        "Error al guardar atleta en Supabase:",
        `message: ${error.message || "N/A"}`,
        `details: ${error.details || "N/A"}`,
        `hint: ${error.hint || "N/A"}`,
        `code: ${error.code || "N/A"}`,
      ].join("\n");
      console.error(errorText, error);
      alert(errorText);
      notify("Error al guardar atleta");
      return;
    }

    setAthletes((prev) => [normalizeAthlete(data), ...prev]);

    setShowAddAthleteForm(false);
    setNewAthlete({ name: "", email: "", goal: "", pace: "", weekly_km: "" });
    setPlanLimitWarning("");
    notify("Atleta agregado ✓");
  }, [newAthlete, profile?.subscription_plan, athletes.length, notify]);

  const cancelAddAthleteForm = useCallback(() => {
    setShowAddAthleteForm(false);
    setNewAthlete({ name: "", email: "", goal: "", pace: "", weekly_km: "" });
  }, []);

  const handleDeleteAthlete = useCallback(async (athleteRow) => {
    if (!athleteRow?.id) return;
    const name = athleteRow.name || "este atleta";
    if (!window.confirm(`¿Eliminar a ${name}? Se borrarán sus mensajes y workouts asociados. Esta acción no se puede deshacer.`)) {
      return;
    }
    const id = athleteRow.id;
    const { error: mErr } = await supabase.from("messages").delete().eq("athlete_id", id);
    if (mErr) console.warn("messages delete:", mErr);
    const { error: wErr } = await supabase.from("workouts").delete().eq("athlete_id", id);
    if (wErr) console.warn("workouts delete:", wErr);
    const { error } = await supabase.from("athletes").delete().eq("id", id);
    if (error) {
      console.error(error);
      alert(`No se pudo eliminar: ${error.message}`);
      return;
    }
    setAthletes((prev) => prev.filter((a) => String(a.id) !== String(id)));
    setSelectedAthlete((prev) => {
      if (prev && String(prev.id) === String(id) && typeof localStorage !== "undefined") {
        localStorage.removeItem(RAF_SELECTED_ATHLETE_STORAGE_KEY);
        return null;
      }
      return prev;
    });
    setWorkoutsRefresh((r) => r + 1);
    notify("Atleta eliminado");
  }, [notify]);

  const onAthleteWorkoutsDoneSync = useCallback((athleteId, workoutsDone) => {
    setAthletes((prev) => prev.map((a) => (String(a.id) === String(athleteId) ? { ...a, workouts_done: workoutsDone } : a)));
    setSelectedAthlete((prev) => (prev && String(prev.id) === String(athleteId) ? { ...prev, workouts_done: workoutsDone } : prev));
  }, []);

  const onAthleteFcSync = useCallback((athleteId, fc_max, fc_reposo) => {
    setAthletes((prev) =>
      prev.map((a) => (String(a.id) === String(athleteId) ? normalizeAthlete({ ...a, fc_max, fc_reposo }) : a)),
    );
    setSelectedAthlete((prev) =>
      prev && String(prev.id) === String(athleteId) ? normalizeAthlete({ ...prev, fc_max, fc_reposo }) : prev,
    );
  }, []);

  const clearSelectedOnSignOut = useCallback(() => {
    if (typeof localStorage !== "undefined") {
      localStorage.removeItem(RAF_SELECTED_ATHLETE_STORAGE_KEY);
    }
    setSelectedAthlete(null);
  }, []);

  return {
    athletes,
    setAthletes,
    loadingAthletes,
    selectedAthlete,
    setSelectedAthlete,
    workoutsRefresh,
    setWorkoutsRefresh,
    bumpWorkoutsRefresh,
    pendingRegistroWorkoutId,
    setPendingRegistroWorkoutId,
    showAddAthleteForm,
    setShowAddAthleteForm,
    newAthlete,
    updateNewAthleteField,
    planLimitWarning,
    setPlanLimitWarning,
    staffParentCoachId,
    loadAthletes,
    saveNewAthlete,
    cancelAddAthleteForm,
    handleDeleteAthlete,
    onAthleteWorkoutsDoneSync,
    onAthleteFcSync,
    clearSelectedOnSignOut,
  };
}
