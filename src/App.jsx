import React, { useState, useEffect, useMemo, useCallback, Suspense } from "react";
import { supabase } from "./lib/supabase";
import { useAppResumeRefresh } from "./hooks/useAppResumeRefresh";
import { useCoachPushDeepLinks } from "./hooks/useCoachPushDeepLinks";
import { useBuilderLibraryBridge } from "./hooks/useBuilderLibraryBridge";
import { useCoachAthletes } from "./hooks/useCoachAthletes";
import { useCoachNavigation } from "./hooks/useCoachNavigation";
import CoachChrome from "./components/CoachChrome";
import {
  COACH_PROFILE_TRIAL_DAYS,
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
import ResetPasswordScreen from "./components/ResetPasswordScreen";
import ConfirmEmailScreen from "./components/ConfirmEmailScreen";
import AuthLanding from "./components/AuthLanding";
import { isConfirmEmailRoute } from "./lib/authRoutes";
import { initNativeAppLinks, consumePendingAppLink, subscribeAppLink, applyAppLink } from "./lib/nativeAppLinks";
const AthleteHome = React.lazy(() => import("./components/AthleteHome"));




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

export default function App() {
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
  const [coachPlanPickerVoluntary, setCoachPlanPickerVoluntary] = useState(false);

  const notify = useCallback((msg) => {
    setNotification(msg);
    setTimeout(() => setNotification(null), 3000);
  }, []);

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

  const closeAddAthleteForm = useCallback(() => {
    setShowAddAthleteForm(false);
  }, [setShowAddAthleteForm]);

  /**
   * Diseño setView: el estado vive en useCoachNavigation (llamado desde App),
   * no dentro del JSX de CoachChrome. Así App puede pasar setView /
   * setViewRestored a useBuilderLibraryBridge y useCoachPushDeepLinks en el
   * mismo nivel de hooks (sin Context ni forward-ref).
   */
  const {
    view,
    setView,
    setViewRestored,
    coachNavItems,
    goCoachView,
    selectAthletesTab,
    selectTrainingTab,
  } = useCoachNavigation({
    session,
    profile,
    onCloseAddAthleteForm: closeAddAthleteForm,
  });

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

  return (
    <CoachChrome
      notification={notification}
      session={session}
      profile={profile}
      notify={notify}
      view={view}
      setView={setView}
      coachNavItems={coachNavItems}
      goCoachView={goCoachView}
      selectAthletesTab={selectAthletesTab}
      selectTrainingTab={selectTrainingTab}
      inviteModalOpen={inviteModalOpen}
      setInviteModalOpen={setInviteModalOpen}
      inviteCoachPublicCode={inviteCoachPublicCode}
      coachPlanPickerVoluntary={coachPlanPickerVoluntary}
      setCoachPlanPickerVoluntary={setCoachPlanPickerVoluntary}
      athletes={athletes}
      setAthletes={setAthletes}
      loadingAthletes={loadingAthletes}
      selectedAthlete={selectedAthlete}
      setSelectedAthlete={setSelectedAthlete}
      workoutsRefresh={workoutsRefresh}
      bumpWorkoutsRefresh={bumpWorkoutsRefresh}
      pendingRegistroWorkoutId={pendingRegistroWorkoutId}
      setPendingRegistroWorkoutId={setPendingRegistroWorkoutId}
      showAddAthleteForm={showAddAthleteForm}
      setShowAddAthleteForm={setShowAddAthleteForm}
      newAthlete={newAthlete}
      updateNewAthleteField={updateNewAthleteField}
      planLimitWarning={planLimitWarning}
      setPlanLimitWarning={setPlanLimitWarning}
      staffParentCoachId={staffParentCoachId}
      saveNewAthlete={saveNewAthlete}
      cancelAddAthleteForm={cancelAddAthleteForm}
      handleDeleteAthlete={handleDeleteAthlete}
      onAthleteWorkoutsDoneSync={onAthleteWorkoutsDoneSync}
      onAthleteFcSync={onAthleteFcSync}
      aiPrompt={aiPrompt}
      setAiPrompt={setAiPrompt}
      aiWorkout={aiWorkout}
      setAiWorkout={setAiWorkout}
      aiLoading={aiLoading}
      setAiLoading={setAiLoading}
      libraryRefresh={libraryRefresh}
      bumpLibraryRefresh={bumpLibraryRefresh}
      useLibraryWorkout={useLibraryWorkout}
      showPushInvite={showPushInvite}
      syncFcmTokenToProfile={syncFcmTokenToProfile}
      refreshNativePushPermission={refreshNativePushPermission}
      dismissPushInvite={dismissPushInvite}
      handleSignOut={handleSignOut}
    />
  );
}
