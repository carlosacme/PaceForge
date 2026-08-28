import { useState, useEffect, useMemo, useCallback } from "react";
import { ADMIN_EMAIL } from "../components/shared/appShared";

const COACH_NAV_BASE_ITEMS = [
  { id: "dashboard", icon: "▤", label: "Panel", shortLabel: "Inicio", color: "#ff8a3d" },
  { id: "athletes", icon: "◉", label: "Atletas", shortLabel: "Atletas", color: "#3b82f6" },
  { id: "training", icon: "💪", label: "Entrenamientos", shortLabel: "Entreno", color: "#ea580c" },
  { id: "library", icon: "◈", label: "Biblioteca", shortLabel: "Biblio", color: "#6366f1" },
  { id: "marketplace", icon: "🛒", label: "Marketplace", shortLabel: "Market", color: "#0ea5e9" },
];

const TAB_KEY_ATHLETES = "raf_tab_atletas";
const TAB_KEY_TRAINING = "raf_tab_entrenamientos";

/**
 * Estado y lógica de navegación coach (`view` / tabs LS / lastView / gates).
 *
 * Vive en App (no dentro del JSX de CoachChrome) para que
 * `useBuilderLibraryBridge` y `useCoachPushDeepLinks` reciban `setView` /
 * `setViewRestored` en el mismo nivel de hooks — sin Context ni ref.
 *
 * @param {{
 *   session: object | null,
 *   profile: object | null,
 *   onCloseAddAthleteForm?: () => void,
 * }} args
 */
export function useCoachNavigation({ session, profile, onCloseAddAthleteForm }) {
  const [view, setView] = useState("dashboard");
  const [viewRestored, setViewRestored] = useState(false);

  const readStoredTab = useCallback((key, allowed, fallback) => {
    if (typeof window === "undefined") return fallback;
    const saved = localStorage.getItem(key);
    return saved && allowed.has(saved) ? saved : fallback;
  }, []);
  const writeStoredTab = useCallback((key, value) => {
    if (typeof window === "undefined") return;
    localStorage.setItem(key, value);
  }, []);
  const getAthletesViewFromTab = useCallback((tab) => {
    if (tab === "evaluacion") return "evaluation";
    if (tab === "retos") return "challenges";
    return "athletes";
  }, []);
  const getAthletesTabFromView = useCallback((v) => {
    if (v === "evaluation") return "evaluacion";
    if (v === "challenges") return "retos";
    return "lista";
  }, []);
  const getTrainingViewFromTab = useCallback((tab) => {
    if (tab === "crear_workout") return "builder";
    if (tab === "carrera_gpx") return "carrera_gpx";
    return "plan12";
  }, []);
  const getTrainingTabFromView = useCallback((v) => {
    if (v === "builder") return "crear_workout";
    if (v === "carrera_gpx") return "carrera_gpx";
    return "plan_2_semanas";
  }, []);

  const coachNavItems = useMemo(() => {
    const role = profile?.role;
    const items = [...COACH_NAV_BASE_ITEMS];
    items.push({ id: "settings", icon: "⚙", label: "Configuración", shortLabel: "Ajustes", color: "#64748b" });
    const em = session?.user?.email?.toLowerCase();
    if (role === "admin" || em === ADMIN_EMAIL) {
      items.push({ id: "admin", icon: "🔐", label: "Admin", shortLabel: "Admin", color: "#7c3aed" });
    }
    return items;
  }, [profile?.role, session?.user?.email]);

  const allowedCoachViews = useMemo(() => {
    const hiddenViews = ["evaluation", "plan12", "builder", "carrera_gpx", "challenges"];
    return new Set([...coachNavItems.map((item) => item.id), ...hiddenViews]);
  }, [coachNavItems]);

  useEffect(() => {
    setViewRestored(false);
  }, [session?.user?.id]);

  useEffect(() => {
    if (typeof window === "undefined") return;
    if (!session?.user?.id || !profile || profile.role === "athlete" || viewRestored) return;
    const saved = localStorage.getItem("raf_lastView");
    if (saved && allowedCoachViews.has(saved)) {
      setView(saved);
    }
    setViewRestored(true);
  }, [session?.user?.id, profile, viewRestored, allowedCoachViews]);

  useEffect(() => {
    const em = session?.user?.email?.toLowerCase();
    const role = profile?.role;
    if (view === "admin" && role !== "admin" && em !== ADMIN_EMAIL) {
      setView("dashboard");
    }
    if (view === "admin-coaches") {
      setView("dashboard");
    }
  }, [view, session?.user?.email, profile?.role]);

  useEffect(() => {
    if (typeof window === "undefined") return;
    if (!session?.user?.id || !profile || profile.role === "athlete" || !viewRestored) return;
    localStorage.setItem("raf_lastView", view);
  }, [view, session?.user?.id, profile, viewRestored]);

  useEffect(() => {
    if (typeof document === "undefined") return undefined;
    const onVisibilityChange = () => {
      if (document.visibilityState === "visible" && session?.user?.id && profile?.role !== "athlete") {
        const saved = localStorage.getItem("raf_lastView");
        if (saved && allowedCoachViews.has(saved)) setView(saved);
      }
    };
    document.addEventListener("visibilitychange", onVisibilityChange);
    return () => {
      document.removeEventListener("visibilitychange", onVisibilityChange);
    };
  }, [session?.user?.id, profile?.role, allowedCoachViews]);

  useEffect(() => {
    if (view === "athletes" || view === "evaluation" || view === "challenges") {
      writeStoredTab(TAB_KEY_ATHLETES, getAthletesTabFromView(view));
    }
    if (view === "plan12" || view === "builder" || view === "carrera_gpx" || view === "training") {
      writeStoredTab(TAB_KEY_TRAINING, getTrainingTabFromView(view));
    }
  }, [view, writeStoredTab, getAthletesTabFromView, getTrainingTabFromView]);

  const goCoachView = useCallback(
    (id) => {
      if (id === "athletes") {
        const athletesTab = readStoredTab(TAB_KEY_ATHLETES, new Set(["lista", "evaluacion", "retos"]), "lista");
        setView(getAthletesViewFromTab(athletesTab));
        onCloseAddAthleteForm?.();
        return;
      }
      if (id === "training") {
        const trainingTab = readStoredTab(TAB_KEY_TRAINING, new Set(["plan_2_semanas", "crear_workout", "carrera_gpx"]), "plan_2_semanas");
        setView(getTrainingViewFromTab(trainingTab));
        onCloseAddAthleteForm?.();
        return;
      }
      setView(id);
      onCloseAddAthleteForm?.();
    },
    [readStoredTab, getAthletesViewFromTab, getTrainingViewFromTab, onCloseAddAthleteForm],
  );

  const selectAthletesTab = useCallback(
    (tab) => {
      writeStoredTab(TAB_KEY_ATHLETES, tab);
      setView(getAthletesViewFromTab(tab));
    },
    [writeStoredTab, getAthletesViewFromTab],
  );

  const selectTrainingTab = useCallback(
    (tab) => {
      writeStoredTab(TAB_KEY_TRAINING, tab);
      setView(getTrainingViewFromTab(tab));
    },
    [writeStoredTab, getTrainingViewFromTab],
  );

  return {
    view,
    setView,
    viewRestored,
    setViewRestored,
    coachNavItems,
    goCoachView,
    selectAthletesTab,
    selectTrainingTab,
  };
}
