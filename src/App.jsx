import React, { useState, useEffect, useMemo, useCallback, Suspense } from "react";
import { supabase } from "./lib/supabase";
import { useAppResumeRefresh } from "./hooks/useAppResumeRefresh";
import { useCoachPushDeepLinks } from "./hooks/useCoachPushDeepLinks";
import { useBuilderLibraryBridge } from "./hooks/useBuilderLibraryBridge";
import { useCoachAthletes } from "./hooks/useCoachAthletes";
import Athletes from "./components/Athletes";
import AdminPanel from "./components/Admin";
import Dashboard from "./components/Dashboard";
import {
  ADMIN_EMAIL,
  PLATFORM_ADMIN_USER_ID,
  COACH_PROFILE_TRIAL_DAYS,
  coachTrialDaysRemainingFromStart,
  unregisterOwnDeviceToken,
  ensureOwnProfile,
  acceptPendingInvitationIfAny,
  isAuthLockContentionError,
  withAuthLockRetry,
  styles,
} from "./components/shared/appShared";
import {
  clearFcmToken,
} from "./firebase.js";
import { Capacitor } from "@capacitor/core";
import {
  clearNativePush,
} from "./lib/nativePush";
import InstallAppButton from "./components/InstallAppButton";
import ResetPasswordScreen from "./components/ResetPasswordScreen";
import ConfirmEmailScreen from "./components/ConfirmEmailScreen";
import AuthLanding from "./components/AuthLanding";
import InviteModal from "./components/InviteModal";
import PlanPicker from "./components/PlanPicker";
import PushInviteBanner from "./components/PushInviteBanner";
import { isConfirmEmailRoute } from "./lib/authRoutes";
import { initNativeAppLinks, consumePendingAppLink, subscribeAppLink, applyAppLink } from "./lib/nativeAppLinks";
const CoachSettings = React.lazy(() => import("./components/CoachSettings"));
const WorkoutLibrary = React.lazy(() => import("./components/WorkoutLibrary"));
const MarketplaceHub = React.lazy(() => import("./components/MarketplaceHub"));
const ChallengesHub = React.lazy(() => import("./components/ChallengesHub"));
const AthleteHome = React.lazy(() => import("./components/AthleteHome"));
const Plan2Weeks = React.lazy(() => import("./components/Plan2Weeks"));
const Builder = React.lazy(() => import("./components/Builder"));
const EvaluationView = React.lazy(() => import("./components/EvaluationView"));
const GpxRacePlan = React.lazy(() => import("./components/GpxRacePlan"));




/** Marca de "estamos restableciendo la contraseña", para sobrevivir a un refresco. */
const RAF_PASSWORD_RECOVERY_KEY = "raf_password_recovery";

/** La ruta no cambia sin recargar, asi que se resuelve una sola vez. */
const CONFIRM_EMAIL_ROUTE = isConfirmEmailRoute();

/**
 * ¿La URL viene del enlace de "restablecer contraseña"?
 *
 * Se lee en el cuerpo del modulo, ANTES de que supabase-js procese la URL:
 * detectSessionInUrl le quita el hash con replaceState y dispara
 * PASSWORD_RECOVERY en cuanto puede, que puede ser antes de que este componente
 * monte su listener. Leerlo aqui es la red que no depende de ese orden.
 *
 * El hash es el sitio habitual (flujo implicito: #access_token=...&type=recovery);
 * el query se mira tambien por si el enlace llega reescrito.
 */
function detectPasswordRecoveryFromUrl() {
  if (typeof window === "undefined") return false;
  // En /auth/confirm el type=recovery lo atiende la pantalla de confirmacion:
  // primero hay que canjear el token_hash, y solo despues redirige aqui.
  if (CONFIRM_EMAIL_ROUTE) return false;
  try {
    const rawHash = window.location.hash?.startsWith("#") ? window.location.hash.slice(1) : "";
    if (new URLSearchParams(rawHash).get("type") === "recovery") return true;
    return new URLSearchParams(window.location.search).get("type") === "recovery";
  } catch {
    return false;
  }
}

const PASSWORD_RECOVERY_IN_URL = detectPasswordRecoveryFromUrl();
if (PASSWORD_RECOVERY_IN_URL && typeof sessionStorage !== "undefined") {
  // Si el usuario refresca en medio del cambio, el hash ya no esta: sin esta
  // marca caeria dentro de la app con la contraseña vieja.
  try {
    sessionStorage.setItem(RAF_PASSWORD_RECOVERY_KEY, "1");
  } catch {
    /* ignore */
  }
}


const COACH_NAV_BASE_ITEMS = [
  { id: "dashboard", icon: "▤", label: "Panel", shortLabel: "Inicio", color: "#ff8a3d" },
  { id: "athletes", icon: "◉", label: "Atletas", shortLabel: "Atletas", color: "#3b82f6" },
  { id: "training", icon: "💪", label: "Entrenamientos", shortLabel: "Entreno", color: "#ea580c" },
  { id: "library", icon: "◈", label: "Biblioteca", shortLabel: "Biblio", color: "#6366f1" },
  { id: "marketplace", icon: "🛒", label: "Marketplace", shortLabel: "Market", color: "#0ea5e9" },
];

const TAB_KEY_ATHLETES = "raf_tab_atletas";
const TAB_KEY_TRAINING = "raf_tab_entrenamientos";

export default function App() {
  const [view, setView] = useState("dashboard");
  const [notification, setNotification] = useState(null);
  const [session, setSession] = useState(null);
  const [authLoading, setAuthLoading] = useState(true);
  /**
   * Estamos en el flujo de restablecer contraseña. Gana a TODAS las pantallas,
   * incluida la app ya logueada: el enlace del correo trae sesion propia, y
   * dejarlo pasar es justamente lo que hacia que nadie viera el formulario.
   */
  const [passwordRecovery, setPasswordRecovery] = useState(() => {
    if (PASSWORD_RECOVERY_IN_URL) return true;
    try {
      return sessionStorage.getItem(RAF_PASSWORD_RECOVERY_KEY) === "1";
    } catch {
      return false;
    }
  });
  /** AuthLanding: abrir login tras recovery sin sesión (id fuerza efecto). */
  const [authLandingOpenRequest, setAuthLandingOpenRequest] = useState(null);
  const [profile, setProfile] = useState(() => {
    try {
      const cached = localStorage.getItem("raf_cached_profile");
      return cached ? JSON.parse(cached) : null;
    } catch { return null; }
  });
  const [profileLoading, setProfileLoading] = useState(false);
  const [inviteModalOpen, setInviteModalOpen] = useState(false);
  const [viewRestored, setViewRestored] = useState(false);
  const [coachPlanPickerVoluntary, setCoachPlanPickerVoluntary] = useState(false);

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

  const notify = useCallback((msg) => {
    setNotification(msg);
    setTimeout(() => setNotification(null), 3000);
  }, []);

  const {
    aiPrompt,
    setAiPrompt,
    aiWorkout,
    setAiWorkout,
    aiLoading,
    setAiLoading,
    libraryRefresh,
    bumpLibraryRefresh,
    useLibraryWorkout,
  } = useBuilderLibraryBridge({ setView, notify });

  const {
    athletes,
    setAthletes,
    loadingAthletes,
    selectedAthlete,
    setSelectedAthlete,
    workoutsRefresh,
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
  } = useCoachAthletes({ session, authLoading, notify, profile });

  const {
    syncFcmTokenToProfile,
    showPushInvite,
    dismissPushInvite,
    refreshNativePushPermission,
    setNativePushPermission,
  } = useCoachPushDeepLinks({
    session,
    authLoading,
    profile,
    athletes,
    notify,
    setView,
    setSelectedAthlete,
    setViewRestored,
    setPendingRegistroWorkoutId,
  });

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

  const S = styles;

  const coachCodeFromId = useCallback((userId) => String(userId || "").replace(/-/g, "").slice(0, 8).toUpperCase(), []);

  /** Código que el atleta puede ingresar al registrarse (coincide con `profiles.coach_id` o derivado del user_id). */
  const inviteCoachPublicCode = useMemo(() => {
    const raw = String(profile?.coach_id || "").trim();
    if (raw && !raw.includes("-")) return raw.toUpperCase();
    return coachCodeFromId(session?.user?.id);
  }, [profile?.coach_id, session?.user?.id, coachCodeFromId]);

  const resolveCoachIdByCode = useCallback(async (codeInput) => {
    const codigoIngresado = String(codeInput || "").trim().toUpperCase();
    if (!codigoIngresado || codigoIngresado.length !== 8) return null;
    const { data, error } = await supabase.rpc("find_coach_by_code", { code: codigoIngresado });
    if (error) { console.error("resolveCoachIdByCode:", error); return null; }
    return data || null;
  }, []);

  // App Links de la APK: el enlace del correo llega por intent y el WebView
  // arranca en la raiz, asi que hay que llevar la vista a la ruta a mano. Fuera
  // de la APK el modulo no hace nada: en el navegador la URL ya es la correcta.
  useEffect(() => {
    let cancelled = false;
    const applyPending = () => {
      if (cancelled) return;
      const target = consumePendingAppLink();
      if (target) applyAppLink(target);
    };
    const unsubscribe = subscribeAppLink(applyPending);
    initNativeAppLinks().then(applyPending);
    return () => {
      cancelled = true;
      unsubscribe();
    };
  }, []);

  useEffect(() => {
    let mounted = true;
    const bootstrapAuth = async () => {
      try {
        const { data, error } = await withAuthLockRetry(async () => {
          const r = await supabase.auth.getSession();
          if (isAuthLockContentionError(r.error)) throw r.error;
          return r;
        });
        if (error) {
          console.error("Error leyendo sesión:", error);
        }
        if (mounted) {
          setSession(data?.session ?? null);
          setAuthLoading(false);
        }
      } catch (err) {
        console.error("Error leyendo sesión:", err);
        if (mounted) {
          setSession(null);
          setAuthLoading(false);
        }
      }
    };

    bootstrapAuth();

    const { data } = supabase.auth.onAuthStateChange((event, nextSession) => {
      if (!mounted) return;
      // Supabase avisa del enlace de recuperacion con este evento. Se atiende
      // aunque ya hubiera sesion en el navegador, que es el caso que fallaba.
      if (event === "PASSWORD_RECOVERY") {
        try {
          sessionStorage.setItem(RAF_PASSWORD_RECOVERY_KEY, "1");
        } catch {
          /* ignore */
        }
        setPasswordRecovery(true);
      }
      setSession(nextSession ?? null);
      if (nextSession?.user && typeof window !== "undefined" && window.posthog) {
  window.posthog.identify(nextSession.user.id, {
    email: nextSession.user.email,
  });
}
    });

    return () => {
      mounted = false;
      data.subscription.unsubscribe();
    };
  }, []);

  useEffect(() => {
    setViewRestored(false);
  }, [session?.user?.id]);

  useEffect(() => {
    const cacheAndSetProfile = (p) => {
      setProfile(p);
      try {
        if (p) localStorage.setItem("raf_cached_profile", JSON.stringify(p));
        else localStorage.removeItem("raf_cached_profile");
      } catch {}
    };

    const loadProfile = async () => {
      if (!session?.user) {
        setProfile(null);
        try { localStorage.removeItem("raf_cached_profile"); } catch {}
        return;
      }
      // Solo mostrar loading si NO hay perfil cacheado (primera vez)
      const hasCached = (() => { try { return !!localStorage.getItem("raf_cached_profile"); } catch { return false; } })();
      if (!hasCached) setProfileLoading(true);
      let data;
      let error;
      try {
        const res = await withAuthLockRetry(async () => {
          const r = await supabase
            .from("profiles")
            .select("*")
            .eq("user_id", session.user.id)
            .maybeSingle();
          if (isAuthLockContentionError(r.error)) throw r.error;
          return r;
        });
        data = res.data;
        error = res.error;
      } catch (err) {
        console.error("Error cargando perfil:", err);
        // Tras reintentos de lock: conservar cache si existe; no mostrar error técnico.
        if (!hasCached) setProfile(null);
        setProfileLoading(false);
        return;
      }
      if (error) {
        console.error("Error cargando perfil:", error);
        if (!hasCached) setProfile(null);
        setProfileLoading(false);
        return;
      }

      const processPendingStaffInvite = async (prof) => {
        if (!prof || prof.role !== "coach") return;
        // Estrategia confiable: buscar invitacion type='staff' por el email del coach.
        // No depende de localStorage ni de parametros de URL.
        let parentCoach = null;
        const profEmail = (prof.email || "").trim().toLowerCase();
        if (profEmail) {
          const { data: inv } = await supabase
            .from("invitations")
            .select("coach_id, status, type")
            .eq("email", profEmail)
            .eq("type", "staff")
            .order("created_at", { ascending: false })
            .limit(1)
            .maybeSingle();
          if (inv && inv.coach_id) parentCoach = inv.coach_id;
        }
        // Fallback: localStorage por si la invitacion no quedo en la tabla
        if (!parentCoach) {
          try {
            const raw = window.localStorage.getItem("pendingStaffInvite");
            if (raw) {
              const pending = JSON.parse(raw);
              if (pending && pending.parentCoach) parentCoach = pending.parentCoach;
            }
          } catch (_) {}
        }
        if (!parentCoach || parentCoach === prof.user_id) {
          try { window.localStorage.removeItem("pendingStaffInvite"); } catch (_) {}
          return;
        }
        // Verificar si ya esta vinculado
        const { data: existing } = await supabase
          .from("coach_staff")
          .select("id")
          .eq("coach_id", parentCoach)
          .eq("staff_id", prof.user_id)
          .maybeSingle();
        if (existing) {
          try { window.localStorage.removeItem("pendingStaffInvite"); } catch (_) {}
          return;
        }
        const { error: csErr } = await supabase.from("coach_staff").insert({
          coach_id: parentCoach,
          staff_id: prof.user_id,
          billing_type: "included",
        });
        if (csErr) {
          console.error("Error vinculando staff:", csErr);
        } else {
          console.log("Staff vinculado al coach principal:", parentCoach);
          try { window.localStorage.removeItem("pendingStaffInvite"); } catch (_) {}
          // Marcar el perfil como staff para que la UI lo reconozca
          const { error: profErr } = await supabase
            .from("profiles")
            .update({ is_staff: true, parent_coach_id: parentCoach })
            .eq("user_id", prof.user_id);
          if (profErr) console.error("Error marcando perfil como staff:", profErr);
          // Marcar invitacion como aceptada
          if (profEmail) {
            await supabase.from("invitations").update({ status: "accepted" }).eq("email", profEmail).eq("type", "staff");
          }
        }
      };

      const syncCoachPlanIfNeeded = async (prof) => {
        if (!prof || prof.role !== "coach") return prof;
        if (prof.plan_status === "trial" && prof.trial_started_at) {
          const start = new Date(prof.trial_started_at);
          if (!Number.isNaN(start.getTime()) && Date.now() > start.getTime() + COACH_PROFILE_TRIAL_DAYS * 86400000) {
            const { data: upd, error: upErr } = await supabase
              .from("profiles")
              .update({ plan_status: "blocked" })
              .eq("user_id", prof.user_id)
              .select()
              .maybeSingle();
            if (upErr) console.error("syncCoachPlanIfNeeded blocked:", upErr);
            return upd || { ...prof, plan_status: "blocked" };
          }
        }
        return prof;
      };

      if (data == null) {
        // Perfil huérfano: auth existe pero create-profile no corrió (p.ej.
        // registro sin sesion hasta confirmar correo). Reintentar desde
        // metadata / pending local.
        let pending = null;
        try {
          const raw = localStorage.getItem("raf_pending_profile");
          if (raw) pending = JSON.parse(raw);
        } catch {
          pending = null;
        }
        const u = session.user;
        const metaRole = u.user_metadata?.role === "coach" ? "coach" : u.user_metadata?.role === "athlete" ? "athlete" : null;
        const role = pending?.role === "coach" || pending?.role === "athlete"
          ? pending.role
          : metaRole || "athlete";
        const displayName =
          (typeof pending?.name === "string" && pending.name.trim()) ||
          (typeof u.user_metadata?.full_name === "string" && u.user_metadata.full_name.trim()) ||
          (u.email ? u.email.split("@")[0] : "") ||
          "Usuario";
        const coachId =
          role === "athlete"
            ? (pending?.coach_id ?? u.user_metadata?.coach_id ?? null)
            : null;
        const healed = await ensureOwnProfile({
          name: displayName,
          role,
          coach_id: coachId,
        });
        if (healed.ok) {
          try { localStorage.removeItem("raf_pending_profile"); } catch { /* ignore */ }
          const { data: again } = await supabase
            .from("profiles")
            .select("*")
            .eq("user_id", u.id)
            .maybeSingle();
          if (again) {
            await processPendingStaffInvite(again);
            await acceptPendingInvitationIfAny();
            cacheAndSetProfile(await syncCoachPlanIfNeeded(again));
            setProfileLoading(false);
            return;
          }
        } else {
          console.warn("ensureOwnProfile (perfil ausente):", healed.reason);
        }
        setProfile(null);
        setProfileLoading(false);
        return;
      }
      await processPendingStaffInvite(data);
      await acceptPendingInvitationIfAny();

      const roleMissing = data.role == null || String(data.role).trim() === "";
      if (roleMissing) {
        const u = session.user;
        const displayName =
          (typeof u.user_metadata?.full_name === "string" && u.user_metadata.full_name.trim()) ||
          (u.email ? u.email.split("@")[0] : "") ||
          "Coach";
        const nowIso = new Date().toISOString();
        const payload = {
          user_id: u.id,
          role: "coach",
          name: (typeof data?.name === "string" && data.name.trim()) || displayName,
          coach_id: null,
          plan_status: "trial",
          trial_started_at: nowIso,
        };
        const { data: saved, error: upErr } = await supabase
          .from("profiles")
          .insert(payload)
          .select()
          .single();
        if (upErr) {
          console.error("Error creando perfil coach por defecto (completo):", {
            message: upErr.message,
            details: upErr.details,
            hint: upErr.hint,
            code: upErr.code,
            status: upErr.status,
            fullError: upErr,
          });
          cacheAndSetProfile(data ?? null);
        } else {
          cacheAndSetProfile(await syncCoachPlanIfNeeded(saved));
        }
      } else {
        cacheAndSetProfile(await syncCoachPlanIfNeeded(data));
      }
      setProfileLoading(false);
    };

    loadProfile();
  }, [session]);

  // Al volver a la app: invalidar raf_cached_profile releiendo profiles.
  // Silencioso (sin profileLoading) para no parpadear la UI.
  const refreshProfileSilent = useCallback(async () => {
    const uid = session?.user?.id;
    if (!uid) return;
    try {
      const { data, error } = await withAuthLockRetry(async () => {
        const r = await supabase
          .from("profiles")
          .select("*")
          .eq("user_id", uid)
          .maybeSingle();
        if (isAuthLockContentionError(r.error)) throw r.error;
        return r;
      });
      if (error) {
        console.warn("[resume] profiles:", error);
        return;
      }
      if (!data) return;
      setProfile(data);
      try {
        localStorage.setItem("raf_cached_profile", JSON.stringify(data));
      } catch {
        /* ignore */
      }
    } catch (err) {
      console.warn("[resume] profiles:", err);
    }
  }, [session?.user?.id]);

  // Perfil siempre; coaches tambien lista + km/badges via workoutsRefresh.
  // AthleteHome hace su propio resume (ficha/workouts/intervals) sin duplicar profiles.
  useAppResumeRefresh(() => {
    void refreshProfileSilent();
    if (profile && profile.role !== "athlete") {
      void loadAthletes({ silent: true });
      bumpWorkoutsRefresh();
    }
  }, Boolean(session?.user?.id));

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

const handleSignOut = async () => {
  if (typeof window !== "undefined" && window.posthog) window.posthog.reset();
    // Retirar el token de push de ESTE dispositivo ANTES de salir, para que el
    // proximo usuario no herede las notificaciones del que se va. Los otros
    // dispositivos del coach siguen recibiendo. Nunca debe impedir el logout si
    // algo falla.
    try {
      await unregisterOwnDeviceToken();
      const uid = session?.user?.id;
      if (uid) {
        const { data: cleared, error: fcmErr } = await supabase
          .from("profiles")
          .update({ fcm_token: null })
          .eq("user_id", uid)
          .select("user_id");
        if (fcmErr) {
          console.warn("[FCM] no se pudo limpiar fcm_token en logout:", fcmErr.message);
        } else if (!(cleared || []).length) {
          console.warn("[FCM] fcm_token no se actualizó (0 filas) en logout");
        }
      }
      if (Capacitor.isNativePlatform()) await clearNativePush();
      else await clearFcmToken();
      setNativePushPermission(null);
    } catch (e) {
      console.warn("[FCM] limpieza en logout:", e);
    }
    const { error } = await supabase.auth.signOut();
    if (error) {
      console.error("Error al cerrar sesión:", error);
      alert(`Error al cerrar sesión: ${error.message}`);
    }
    if (typeof localStorage !== "undefined") {
      localStorage.removeItem("raf_lastView");
      localStorage.removeItem("raf_tab_atletas");
      localStorage.removeItem("raf_tab_entrenamientos");
      localStorage.removeItem("raf_tab_biblioteca");
      localStorage.removeItem("raf_tab_crear_workout");
      localStorage.removeItem("raf_athlete_tab");          // ← ESTA ES LA CLAVE CORRECTA (era "raf_athlete_nav_tab")
      localStorage.removeItem("raf_athlete_eval_open");    // ← agregar también
      localStorage.removeItem("raf_athlete_profile_tab");
      localStorage.removeItem("raf_athlete_progress_tab");
      localStorage.removeItem("raf_admin_tab");
      localStorage.removeItem("raf_plan2_athlete");
      localStorage.removeItem("raf_admin_plan_draft");
      localStorage.removeItem("raf_push_invite_dismissed");
    }
    setView("dashboard");
    clearSelectedOnSignOut();
  };

  /**
   * Cierra el flujo de restablecimiento.
   *
   * Limpia la marca y los parametros del enlace: sin eso, un refresco volveria
   * a plantar el formulario delante de alguien que ya cambio la contraseña.
   */
  const closePasswordRecovery = (successMsg) => {
    try {
      sessionStorage.removeItem(RAF_PASSWORD_RECOVERY_KEY);
    } catch {
      /* ignore */
    }
    if (typeof window !== "undefined") {
      try {
        const params = new URLSearchParams(window.location.search);
        params.delete("type");
        const qs = params.toString();
        window.history.replaceState({}, "", window.location.pathname + (qs ? `?${qs}` : ""));
      } catch {
        /* ignore */
      }
    }
    setPasswordRecovery(false);
    if (successMsg) {
      // Con sesion aterriza en la app (toast); sin sesion, AuthLanding muestra aviso.
      notify(successMsg);
      setAuthLandingOpenRequest({
        id: Date.now(),
        step: "login",
        mode: "login",
        info: successMsg,
        error: "",
      });
    }
  };

  // El enlace del correo aterriza en /auth/confirm: canjear el token antes de
  // cualquier otra pantalla, tambien con sesion previa en el navegador.
  if (CONFIRM_EMAIL_ROUTE) {
    return <ConfirmEmailScreen />;
  }

  // Igual con el enlace de restablecimiento: el formulario va delante de la app.
  if (passwordRecovery) {
    return (
      <ResetPasswordScreen
        onDone={(msg) => closePasswordRecovery(msg)}
        onCancel={() => closePasswordRecovery("")}
      />
    );
  }

  if (authLoading) {
    return (
      <div style={S.root}>
        <main style={{ ...S.page, display: "flex", alignItems: "center", justifyContent: "center", width: "100%" }}>
          <h1 style={S.pageTitle}>Cargando sesión...</h1>
        </main>
      </div>
    );
  }

  if (!session) {
    return (
      <AuthLanding
        notify={notify}
        resolveCoachIdByCode={resolveCoachIdByCode}
        onLoginSuccess={syncFcmTokenToProfile}
        onAthleteProfileDraft={setProfile}
        openRequest={authLandingOpenRequest}
      />
    );
  }

  if (profileLoading) {
    return (
      <div style={S.root}>
        <main style={{ ...S.page, display: "flex", alignItems: "center", justifyContent: "center", width: "100%" }}>
          <h1 style={S.pageTitle}>Cargando perfil...</h1>
        </main>
      </div>
    );
  }

  if (profile && profile.role === "athlete") {
    return (
      <Suspense fallback={<div style={{display:"flex",alignItems:"center",justifyContent:"center",height:"100vh"}}><p>Cargando...</p></div>}>
        <AthleteHome profile={profile} />
      </Suspense>
    );
  }

  const isCoachUi = Boolean(profile && profile.role !== "athlete");
  const sessionEmailLower = session?.user?.email?.toLowerCase() ?? "";
  const sessionUserId = session?.user?.id ?? "";
  const isProfilesAdmin = profile?.role === "admin";
  const coachPlanBlockedUi =
    profile?.role === "coach" && profile?.plan_status === "blocked" && !isProfilesAdmin;
  const showCoachPlanPickerScreen =
    profile?.role === "coach" && !isProfilesAdmin && (coachPlanBlockedUi || coachPlanPickerVoluntary);

  const trialBannerDays =
    profile?.role === "coach" ? coachTrialDaysRemainingFromStart(profile) : null;
  const showTrialBanner =
    profile?.role === "coach" &&
    profile?.plan_status === "trial" &&
    trialBannerDays != null &&
    trialBannerDays > 0 &&
    !coachPlanBlockedUi;

  const goCoachView = (id) => {
    if (id === "athletes") {
      const athletesTab = readStoredTab(TAB_KEY_ATHLETES, new Set(["lista", "evaluacion", "retos"]), "lista");
      setView(getAthletesViewFromTab(athletesTab));
      setShowAddAthleteForm(false);
      return;
    }
    if (id === "training") {
      const trainingTab = readStoredTab(TAB_KEY_TRAINING, new Set(["plan_2_semanas", "crear_workout", "carrera_gpx"]), "plan_2_semanas");
      setView(getTrainingViewFromTab(trainingTab));
      setShowAddAthleteForm(false);
      return;
    }
    setView(id);
    setShowAddAthleteForm(false);
  };

  const selectAthletesTab = (tab) => {
    writeStoredTab(TAB_KEY_ATHLETES, tab);
    setView(getAthletesViewFromTab(tab));
  };

  const selectTrainingTab = (tab) => {
    writeStoredTab(TAB_KEY_TRAINING, tab);
    setView(getTrainingViewFromTab(tab));
  };

  return (
    <Suspense fallback={<div style={{display:"flex",alignItems:"center",justifyContent:"center",height:"100vh"}}><p>Cargando...</p></div>}>
    <div style={S.root}>
      {notification && <div style={S.notification}>✓ {notification}</div>}
      <InviteModal
        open={inviteModalOpen}
        onClose={() => setInviteModalOpen(false)}
        coachUserId={session?.user?.id}
        coachPublicCode={inviteCoachPublicCode}
        notify={notify}
      />

      <aside className="pf-sidebar-desktop" style={S.sidebar}>
        <div style={S.logo}>
          <img src="/pwa-192.png" alt="RunningApexFlow" style={{ width: 36, height: 36, borderRadius: 8, objectFit: "cover", flexShrink: 0 }} />
          <div>
            <div style={S.logoTitle}>
              RUNNING<span style={{ color: "#ff8a3d" }}>APEX</span>FLOW
            </div>
            <div style={S.logoSub}>Plataforma de Coach</div>
          </div>
        </div>
        <nav style={{ flex: 1, paddingTop: 8 }}>
          {coachNavItems.map((item) => {
            const active =
              view === item.id ||
              (item.id === "athletes" && (view === "evaluation" || view === "challenges")) ||
              (item.id === "training" && (view === "plan12" || view === "builder" || view === "carrera_gpx"));
            return (
            <button
              key={item.id}
              type="button"
              onClick={() => goCoachView(item.id)}
              style={{ ...S.navBtn, ...(active ? S.navBtnActive : {}) }}
            >
              <span style={{ fontSize: "1.15em", color: item.color, width: 22, textAlign: "center" }}>{item.icon}</span>
              <span>{item.label}</span>
            </button>
            );
          })}
        </nav>
        <div style={S.sidebarFooter}>
          <div style={{ fontSize: ".82em", color: "#64748b", fontWeight: 600 }}>
            👤 {profile?.name || session?.user?.email?.split("@")[0] || "Coach"}
          </div>
          <div style={{ fontSize: ".7em", color: "#94a3b8", marginTop: 4 }}>
            {athletes.length} atletas · {athletes.reduce((a, b) => a + b.weekly_km, 0)} km
          </div>
          <button
            type="button"
            onClick={handleSignOut}
            style={{
              marginTop: 10,
              width: "100%",
              background: "#fef2f2",
              border: "1px solid #fecaca",
              borderRadius: 8,
              padding: "9px 10px",
              color: "#dc2626",
              cursor: "pointer",
              fontFamily: "inherit",
              fontSize: ".78em",
              fontWeight: 700,
            }}
          >
            Cerrar sesión
          </button>
        </div>
      </aside>

      <main
        className="pf-main-mobile-pad"
        style={{ flex: 1, overflowY: "auto", background: "#f8fafc", position: "relative" }}
      >
        <div style={{ padding: "12px 16px 0" }}>
          <InstallAppButton />
        </div>
        <PushInviteBanner
          visible={showPushInvite}
          onActivate={async () => {
            if (typeof localStorage !== "undefined") localStorage.removeItem("raf_push_invite_dismissed");
            await syncFcmTokenToProfile();
            await refreshNativePushPermission();
          }}
          onDismiss={dismissPushInvite}
        />
        {showTrialBanner ? (
          <div
            style={{
              position: "sticky",
              top: 0,
              zIndex: 25,
              margin: "0 0 0",
              padding: "12px 16px",
              background: "linear-gradient(90deg, rgba(255,138,61,.22), rgba(251,191,36,.16))",
              borderBottom: "1px solid rgba(255,138,61,.45)",
              color: "#92400e",
              fontSize: ".82em",
              fontWeight: 700,
              boxShadow: "0 2px 8px rgba(15,23,42,.06)",
              display: "flex",
              flexWrap: "wrap",
              alignItems: "center",
              justifyContent: "space-between",
              gap: 12,
            }}
          >
            <span>
              ⏳ Período de prueba: {trialBannerDays} día{trialBannerDays === 1 ? "" : "s"} restantes
            </span>
            <button
              type="button"
              onClick={() => {
                setCoachPlanPickerVoluntary(true);
              }}
              style={{
                padding: "8px 14px",
                borderRadius: 8,
                border: "1px solid rgba(180,83,9,.45)",
                background: "#fff",
                color: "#b45309",
                fontWeight: 800,
                fontSize: ".78em",
                cursor: "pointer",
                fontFamily: "inherit",
                whiteSpace: "nowrap",
              }}
            >
              Ver planes
            </button>
          </div>
        ) : null}
        {loadingAthletes ? (
          <div style={S.page}>
            <h1 style={S.pageTitle}>Cargando atletas...</h1>
          </div>
        ) : (
          <>
        {view === "dashboard" && (
          <Dashboard
            athletes={athletes}
            coachUserId={session?.user?.id ?? null}
            onSelect={(a) => {
              setSelectedAthlete(a);
              setView("athletes");
              setShowAddAthleteForm(false);
            }}
            onRequestAddAthlete={() => setInviteModalOpen(true)}
            showAddAthleteForm={showAddAthleteForm}
            planLimitWarning={planLimitWarning}
            onGoToPlans={() => setCoachPlanPickerVoluntary(true)}
            onDismissPlanLimitWarning={() => setPlanLimitWarning("")}
            newAthlete={newAthlete}
            onChangeNewAthleteField={updateNewAthleteField}
            onSaveNewAthlete={saveNewAthlete}
            onCancelAddAthlete={cancelAddAthleteForm}
          />
        )}
        {(view === "athletes" || view === "evaluation" || view === "challenges") && (
          <>
            <div style={{ display: "flex", gap: 8, flexWrap: "wrap", margin: "0 16px 10px" }}>
              <button type="button" onClick={() => selectAthletesTab("lista")} style={{ border: "1px solid #e2e8f0", borderRadius: 8, padding: "8px 10px", background: view === "athletes" ? "rgba(59,130,246,.12)" : "#fff", color: view === "athletes" ? "#1d4ed8" : "#334155", fontWeight: 800, cursor: "pointer", fontFamily: "inherit" }}>👥 Lista atletas</button>
              <button type="button" onClick={() => selectAthletesTab("evaluacion")} style={{ border: "1px solid #e2e8f0", borderRadius: 8, padding: "8px 10px", background: view === "evaluation" ? "rgba(14,165,233,.12)" : "#fff", color: view === "evaluation" ? "#0369a1" : "#334155", fontWeight: 800, cursor: "pointer", fontFamily: "inherit" }}>📊 Evaluación</button>
              <button type="button" onClick={() => selectAthletesTab("retos")} style={{ border: "1px solid #e2e8f0", borderRadius: 8, padding: "8px 10px", background: view === "challenges" ? "rgba(168,85,247,.12)" : "#fff", color: view === "challenges" ? "#7e22ce" : "#334155", fontWeight: 800, cursor: "pointer", fontFamily: "inherit" }}>🏆 Retos</button>
            </div>
            {view === "athletes" && (
              <Athletes
                athletes={athletes}
                selected={selectedAthlete}
                onSelect={setSelectedAthlete}
                workoutsRefresh={workoutsRefresh}
                openRegistroWorkoutId={pendingRegistroWorkoutId}
                onRegistroOpened={() => setPendingRegistroWorkoutId(null)}
                onAthleteWorkoutsDoneSync={onAthleteWorkoutsDoneSync}
                onAthleteFcSync={onAthleteFcSync}
                coachDisplayName={
                  profile?.name ||
                  session?.user?.user_metadata?.full_name ||
                  (session?.user?.email ? session.user.email.split("@")[0] : null) ||
                  "Coach"
                }
                onDeleteAthlete={handleDeleteAthlete}
                notify={notify}
                onOpenInviteModal={() => setInviteModalOpen(true)}
              />
            )}
            {view === "evaluation" && (
              <Suspense fallback={<div style={{ padding: 24, color: "#64748b" }}>Cargando evaluación…</div>}>
                <EvaluationView athletes={athletes} currentUserId={session?.user?.id ?? null} notify={notify} />
              </Suspense>
            )}
            {view === "challenges" && (
              <ChallengesHub
                profileRole={profile?.role ?? ""}
                currentUserId={sessionUserId || null}
                athleteId={null}
                workouts={[]}
                coachAthletes={athletes}
                notify={notify}
                styles={styles}
              />
            )}
          </>
        )}
        {view === "settings" && (
          <CoachSettings
            coachUserId={session?.user?.id ?? null}
            sessionEmail={session?.user?.email ?? ""}
            profileName={profile?.name ?? ""}
            athletes={athletes}
            setAthletes={setAthletes}
            notify={notify}
            onSignOut={handleSignOut}
            styles={styles}
            isStaff={Boolean(profile?.is_staff || staffParentCoachId)}
          />
        )}
        {view === "admin" && (profile?.role === "admin" || sessionEmailLower === ADMIN_EMAIL) && (
          <AdminPanel notify={notify} adminUserId={PLATFORM_ADMIN_USER_ID} />
        )}
        {(view === "plan12" || view === "builder" || view === "carrera_gpx" || view === "training") && (
          <>
            <div style={{ display: "flex", gap: 8, flexWrap: "wrap", margin: "0 16px 10px" }}>
              <button type="button" onClick={() => selectTrainingTab("plan_2_semanas")} style={{ border: "1px solid #e2e8f0", borderRadius: 8, padding: "8px 10px", background: (view === "plan12" || view === "training") ? "rgba(139,92,246,.12)" : "#fff", color: (view === "plan12" || view === "training") ? "#6d28d9" : "#334155", fontWeight: 800, cursor: "pointer", fontFamily: "inherit" }}>◇ Plan 2 Semanas</button>
              <button type="button" onClick={() => selectTrainingTab("crear_workout")} style={{ border: "1px solid #e2e8f0", borderRadius: 8, padding: "8px 10px", background: view === "builder" ? "rgba(234,88,12,.12)" : "#fff", color: view === "builder" ? "#c2410c" : "#334155", fontWeight: 800, cursor: "pointer", fontFamily: "inherit" }}>◎ Crear Workout con IA</button>
              <button type="button" onClick={() => selectTrainingTab("carrera_gpx")} style={{ border: "1px solid #e2e8f0", borderRadius: 8, padding: "8px 10px", background: view === "carrera_gpx" ? "rgba(220,38,38,.12)" : "#fff", color: view === "carrera_gpx" ? "#b91c1c" : "#334155", fontWeight: 800, cursor: "pointer", fontFamily: "inherit" }}>⛰ Carrera GPX</button>
            </div>
            {(view === "plan12" || view === "training") && (
              <Plan2Weeks
                athletes={athletes}
                notify={notify}
                coachUserId={session?.user?.id ?? null}
                coachPlan={String(profile?.subscription_plan || "Basico")}
                profileRole={profile?.role ?? ""}
                onGoToPlans={() => setCoachPlanPickerVoluntary(true)}
                onPlanAssigned={bumpWorkoutsRefresh}
              />
            )}
            {view === "builder" && (
              <Builder
                athletes={athletes}
                aiPrompt={aiPrompt}
                setAiPrompt={setAiPrompt}
                aiWorkout={aiWorkout}
                setAiWorkout={setAiWorkout}
                aiLoading={aiLoading}
                setAiLoading={setAiLoading}
                notify={notify}
                coachUserId={session?.user?.id ?? null}
                coachPlan={String(profile?.subscription_plan || "Basico")}
                profileRole={profile?.role ?? ""}
                onGoToPlans={() => setCoachPlanPickerVoluntary(true)}
                onWorkoutAssigned={bumpWorkoutsRefresh}
                onSavedToLibrary={bumpLibraryRefresh}
              />
            )}
            {view === "carrera_gpx" && (
              <GpxRacePlan
                athletes={athletes}
                coachUserId={session?.user?.id ?? null}
                notify={notify}
                onSavedToLibrary={bumpLibraryRefresh}
                onWorkoutAssigned={bumpWorkoutsRefresh}
              />
            )}
          </>
        )}
        {view === "library" && (
          <WorkoutLibrary
            coachUserId={sessionUserId || null}
            libraryRefresh={libraryRefresh}
            athletes={athletes}
            profileRole={profile?.role ?? ""}
            adminLibraryOwnerId={PLATFORM_ADMIN_USER_ID}
            parentCoachId={staffParentCoachId || null}
            onUseWorkout={useLibraryWorkout}
            onCopiedGlobalToLibrary={bumpLibraryRefresh}
            onOpenAdminMarketplaceDraft={() => setView("admin")}
            onAfterLibraryImportSuccess={() => {
              setView("library");
              try {
                if (typeof window !== "undefined") localStorage.setItem("raf_lastView", "library");
              } catch {
                /* ignore */
              }
              bumpLibraryRefresh();
            }}
            notify={notify}
            styles={styles}
          />
        )}
        {view === "marketplace" && (
          <MarketplaceHub
            profileRole={profile?.role ?? ""}
            currentUserId={sessionUserId || null}
            coachUserId={sessionUserId || null}
            notify={notify}
            styles={styles}
          />
        )}
          </>
        )}
      </main>

      <nav className="pf-bottom-nav" aria-label="Navegación principal">
        {coachNavItems.map((item) => {
          const active =
            view === item.id ||
            (item.id === "athletes" && (view === "evaluation" || view === "challenges")) ||
            (item.id === "training" && (view === "plan12" || view === "builder" || view === "carrera_gpx"));
          return (
            <button
              key={`m-${item.id}`}
              type="button"
              onClick={() => goCoachView(item.id)}
              style={{
                color: active ? "#c2410c" : "#64748b",
                background: active ? "rgba(255,138,61, 0.14)" : "transparent",
                fontWeight: active ? 800 : 600,
              }}
            >
              <span className="pf-bnav-icon" style={{ color: item.color }}>
                {item.icon}
              </span>
              <span style={{ fontSize: "0.62rem", lineHeight: 1.15, textAlign: "center" }}>{item.shortLabel || item.label}</span>
            </button>
          );
        })}
      </nav>

      <PlanPicker
        open={showCoachPlanPickerScreen}
        locked={coachPlanBlockedUi}
        onClose={() => setCoachPlanPickerVoluntary(false)}
        notify={notify}
      />
    </div>
    </Suspense>
  );
}

