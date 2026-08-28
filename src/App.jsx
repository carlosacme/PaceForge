import React, { Fragment, useState, useEffect, useMemo, useCallback, useRef, Suspense } from "react";
import { supabase } from "./lib/supabase";
import { usePersistedState } from "./hooks/usePersistedState";
import { useAppResumeRefresh } from "./hooks/useAppResumeRefresh";
import Athletes from "./components/Athletes";
import AdminPanel from "./components/Admin";
import Dashboard from "./components/Dashboard";
import {
  normalizeAthlete,
  libraryRowToBuilderWorkout,
  ADMIN_EMAIL,
  PLATFORM_ADMIN_USER_ID,
  COACH_PROFILE_TRIAL_DAYS,
  coachTrialDaysRemainingFromStart,
  formatCopInt,
  registerFcmToken,
  unregisterOwnDeviceToken,
  sendAppEmail,
  ensureOwnProfile,
  acceptPendingInvitationIfAny,
  isAuthLockContentionError,
  withAuthLockRetry,
  styles,
} from "./components/shared/appShared";
import {
  initMessaging,
  onMessage,
  refreshFcmTokenIfGranted,
  requestNotificationPermission,
  clearFcmToken,
} from "./firebase.js";
import { Capacitor } from "@capacitor/core";
import {
  isNativePush,
  registerNativePush,
  nativePushPermissionState,
  clearNativePush,
  consumePendingDeepLink,
  subscribeDeepLink,
} from "./lib/nativePush";
import InstallAppButton from "./components/InstallAppButton";
import ResetPasswordScreen from "./components/ResetPasswordScreen";
import ConfirmEmailScreen from "./components/ConfirmEmailScreen";
import AuthLanding from "./components/AuthLanding";
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




/** Persistencia del atleta seleccionado en la vista Atletas del coach. */
const RAF_SELECTED_ATHLETE_STORAGE_KEY = "raf_selected_athlete";

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

const COACH_SUBSCRIPTION_NEQUI = "3233675434";
const COACH_SUBSCRIPTION_WA_E164 = "573233675434";
const TAB_KEY_ATHLETES = "raf_tab_atletas";
const TAB_KEY_TRAINING = "raf_tab_entrenamientos";


/** Precios COP según tablas del producto (mensual base; semestral −12%; anual −20%). */
const COACH_PLAN_PICKER_DEFS = {
  basico: {
    key: "basico",
    dbPlan: "Basico",
    title: "Básico",
    bullets: ["Hasta 15 atletas", "100 generaciones IA/mes"],
    prices: { monthly: 100000, semestral: 528000, anual: 960000 },
  },
  pro: {
    key: "pro",
    dbPlan: "Pro",
    title: "Pro",
    bullets: ["Atletas ilimitados", "Generaciones IA ilimitadas", "Acceso prioritario"],
    prices: { monthly: 160000, semestral: 844800, anual: 1536000 },
  },
};

const COACH_PLAN_PICKER_PERIODS = [
  { id: "monthly", label: "Mensual", discountPct: 0, badge: null },
  { id: "semestral", label: "Semestral", discountPct: 12, badge: "Ahorra 12%" },
  { id: "anual", label: "Anual", discountPct: 20, badge: "Ahorra 20%" },
];

export default function App() {
  const [view, setView] = useState("dashboard");
  const [selectedAthlete, setSelectedAthlete] = useState(null);
  const [workoutsRefresh, setWorkoutsRefresh] = useState(0);
  /** Deep link: abrir modal Registro de este workout en la vista Atletas. */
  const [pendingRegistroWorkoutId, setPendingRegistroWorkoutId] = useState(null);
  const [aiPrompt, setAiPrompt] = usePersistedState("raf_gen_prompt", "");
  const [aiWorkout, setAiWorkout] = useState(null);
  const [aiLoading, setAiLoading] = useState(false);
  const [libraryRefresh, setLibraryRefresh] = useState(0);
  const [notification, setNotification] = useState(null);
  const [athletes, setAthletes] = useState([]);
  const [loadingAthletes, setLoadingAthletes] = useState(true);
  const [showAddAthleteForm, setShowAddAthleteForm] = useState(false);
  const [planLimitWarning, setPlanLimitWarning] = useState("");
  const [newAthlete, setNewAthlete] = useState({ name: "", email: "", goal: "", pace: "", weekly_km: "" });
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
  const [pushInviteDismissed, setPushInviteDismissed] = useState(() =>
    typeof localStorage !== "undefined" && localStorage.getItem("raf_push_invite_dismissed") === "1",
  );
  const [nativePushPermission, setNativePushPermission] = useState(null);
  const [staffParentCoachId, setStaffParentCoachId] = useState("");
  const [inviteModalOpen, setInviteModalOpen] = useState(false);
  const [inviteEmail, setInviteEmail] = useState("");
  const [inviteSending, setInviteSending] = useState(false);
  const [lastInviteLink, setLastInviteLink] = useState("");
  const [viewRestored, setViewRestored] = useState(false);
  const [coachPlanPickerVoluntary, setCoachPlanPickerVoluntary] = useState(false);
  const [coachPickerPlan, setCoachPickerPlan] = useState(null);
  const [coachPickerPeriod, setCoachPickerPeriod] = useState(null);
  const [coachSubscriptionSaving, setCoachSubscriptionSaving] = useState(false);
  /** Promo del picker canónico (antes vivía en la vista Plans legacy). */
  const [coachPromoInput, setCoachPromoInput] = useState("");
  const [coachAppliedPromo, setCoachAppliedPromo] = useState(null);
  const [coachPromoError, setCoachPromoError] = useState("");
  const [coachPromoLoading, setCoachPromoLoading] = useState(false);

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

  const syncFcmTokenToProfile = useCallback(async () => {
    try {
      const uid = session?.user?.id;
      if (!uid) {
        return;
      }
      // En la APK no existen ni Notification ni el service worker, asi que el
      // flujo web nunca obtenia token. El nativo pide permiso con el plugin y
      // entrega el token por el listener "registration" a la misma
      // registerFcmToken().
      if (Capacitor.isNativePlatform()) {
        await registerNativePush({ notify });
        return;
      }
      const token = await requestNotificationPermission();
      if (!token) {
        return;
      }
      // El backend (service_role) limpia el token de otros perfiles antes de
      // asignarlo al actual: dos usuarios del mismo navegador no pueden
      // compartir token.
      const ok = await registerFcmToken(token);
      if (!ok) {
        console.warn("[FCM] No se pudo registrar el token en el backend");
      }
    } catch (e) {
      console.warn("syncFcmTokenToProfile", e);
    }
  }, [session?.user?.id, notify]);

  const dismissPushInvite = useCallback(() => {
    if (typeof localStorage !== "undefined") localStorage.setItem("raf_push_invite_dismissed", "1");
    setPushInviteDismissed(true);
  }, []);

  /**
   * El banner de "activa las notificaciones" mira Notification.permission en
   * web, pero ese objeto no existe en el WebView: en nativo el estado sale de
   * PushNotifications.checkPermissions().
   */
  const refreshNativePushPermission = useCallback(async () => {
    if (!isNativePush()) return;
    setNativePushPermission(await nativePushPermissionState());
  }, []);

  useEffect(() => {
    if (!session?.user?.id) return;
    void refreshNativePushPermission();
  }, [session?.user?.id, refreshNativePushPermission]);

  const pushPermissionGranted = isNativePush()
    ? nativePushPermission === "granted"
    : typeof Notification !== "undefined" && Notification.permission === "granted";
  const pushPermissionKnown = isNativePush()
    ? nativePushPermission != null
    : typeof Notification !== "undefined";
  const showPushInvite = Boolean(session) && pushPermissionKnown && !pushPermissionGranted && !pushInviteDismissed;

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

  const clearCoachPromo = useCallback(() => {
    setCoachAppliedPromo(null);
    setCoachPromoInput("");
    setCoachPromoError("");
  }, []);

  const closeCoachPlanPicker = useCallback(() => {
    setCoachPlanPickerVoluntary(false);
    clearCoachPromo();
  }, [clearCoachPromo]);

  const applyCoachPromo = useCallback(async () => {
    const code = coachPromoInput.trim();
    setCoachPromoError("");
    if (!code) {
      setCoachPromoError("Escribe un código");
      return;
    }
    setCoachPromoLoading(true);
    const { data, error } = await supabase.rpc("validate_promo_code", { code_input: code });
    setCoachPromoLoading(false);
    if (error) {
      console.error(error);
      setCoachPromoError(error.message || "No se pudo validar el código");
      setCoachAppliedPromo(null);
      return;
    }
    const row = Array.isArray(data) ? data[0] : data;
    if (!row || row.discount_percent == null) {
      setCoachPromoError("Código no válido o sin usos disponibles");
      setCoachAppliedPromo(null);
      return;
    }
    setCoachAppliedPromo({
      code: code.toUpperCase().replace(/\s+/g, ""),
      discount_percent: Number(row.discount_percent),
    });
    notify(`Código aplicado: ${row.discount_percent}% de descuento`);
  }, [coachPromoInput, notify]);

 const handleCoachPlanPagarAhora = useCallback(async () => {
    if (!coachPickerPlan || !coachPickerPeriod) {
      notify("Elige un plan y un período de pago.");
      return;
    }
    const def = COACH_PLAN_PICKER_DEFS[coachPickerPlan];
    const amountCopBase = def?.prices?.[coachPickerPeriod];
    if (!def || amountCopBase == null) {
      notify("Plan o período no válido.");
      return;
    }
    let amountCop = amountCopBase;
    if (coachAppliedPromo?.discount_percent != null) {
      amountCop = Math.max(0, Math.round((amountCopBase * (100 - coachAppliedPromo.discount_percent)) / 100));
    }
    setCoachSubscriptionSaving(true);
    try {
      if (coachAppliedPromo?.code) {
        const { data: ok, error: redeemErr } = await supabase.rpc("redeem_promo_code", {
          code_input: coachAppliedPromo.code,
        });
        if (redeemErr) {
          console.error(redeemErr);
          notify(redeemErr.message || "No se pudo registrar el uso del código");
          return;
        }
        if (!ok) {
          notify("El código ya no es válido o no tiene usos");
          clearCoachPromo();
          return;
        }
      }
      const periodDb = coachPickerPeriod === "monthly" ? "mensual" : coachPickerPeriod;
      const { data: sessData } = await supabase.auth.getSession();
      const accessToken = sessData?.session?.access_token;
      if (!accessToken) {
        notify("Tu sesión expiró. Vuelve a iniciar sesión.");
        return;
      }
      const response = await fetch("/api/wompi-create-checkout", {
        method: "POST",
        headers: {
          "Content-Type": "application/json",
          Authorization: `Bearer ${accessToken}`,
        },
        body: JSON.stringify({
          payer_type: "coach_subscription",
          plan_key: coachPickerPlan,
          plan_period: periodDb,
          amount_cop: amountCop,
        }),
      });
      const data = await response.json();
      if (!response.ok) {
        console.error("create-checkout error:", data);
        notify(data?.error || "No se pudo iniciar el pago.");
        return;
      }
      const params = new URLSearchParams({
        "public-key": data.public_key,
        currency: data.currency,
        "amount-in-cents": String(data.amount_in_cents),
        reference: data.reference,
        "signature:integrity": data.signature,
        "redirect-url": data.redirect_url,
      });
      if (data.customer_email) params.set("customer-data:email", data.customer_email);
      const checkoutUrl = `https://checkout.wompi.co/p/?${params.toString()}`;
      window.location.href = checkoutUrl;
    } catch (e) {
      console.error("handleCoachPlanPagarAhora exception:", e);
      notify("Error al iniciar el pago.");
    } finally {
      setCoachSubscriptionSaving(false);
    }
  }, [coachPickerPlan, coachPickerPeriod, coachAppliedPromo, clearCoachPromo, notify]);

 const coachPlanPickerWhatsAppHref = useMemo(() => {
    if (!coachPickerPlan || !coachPickerPeriod) return `https://wa.me/${COACH_SUBSCRIPTION_WA_E164}`;
    const def = COACH_PLAN_PICKER_DEFS[coachPickerPlan];
    const amountBase = def?.prices?.[coachPickerPeriod];
    const discountPct = coachAppliedPromo?.discount_percent ?? 0;
    const amount =
      amountBase == null
        ? amountBase
        : Math.max(0, Math.round((amountBase * (100 - discountPct)) / 100));
    const periodLabel = COACH_PLAN_PICKER_PERIODS.find((p) => p.id === coachPickerPeriod)?.label || coachPickerPeriod;
    const planTitle = def?.title || coachPickerPlan;
    const amountStr = formatCopInt(amount);
    const text = `Hola, realicé el pago del plan ${planTitle} ${periodLabel} por $${amountStr} COP de RunningApexFlow`;
    return `https://wa.me/${COACH_SUBSCRIPTION_WA_E164}?text=${encodeURIComponent(text)}`;
  }, [coachPickerPlan, coachPickerPeriod, coachAppliedPromo]);

  const S = styles;

  const updateNewAthleteField = (field, value) => {
    setNewAthlete(prev => ({ ...prev, [field]: value }));
  };

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

  // Crea la invitacion (fila en invitations) y expone su link, SIN depender del
  // email. El email es opcional: si el coach lo escribio, se guarda; si no, la
  // fila queda con email null y el coach comparte el link directo.
  const createInviteLink = useCallback(async () => {
    if (!session?.user?.id) {
      notify("No hay sesión activa.");
      return null;
    }
    const code =
      (typeof crypto !== "undefined" && crypto.randomUUID && crypto.randomUUID()) ||
      `${Date.now()}-${Math.random().toString(16).slice(2)}`;
    const inviteLink = `https://www.runningapexflow.com?invite=${encodeURIComponent(code)}`;
    const { error: insError } = await supabase.from("invitations").insert({
      coach_id: session.user.id,
      email: inviteEmail?.trim() || null,
      code,
      status: "pending",
    });
    if (insError) {
      console.error("Error guardando invitación:", insError);
      notify(insError.message || "No se pudo guardar la invitación.");
      return null;
    }
    setLastInviteLink(inviteLink);
    return inviteLink;
  }, [inviteEmail, notify, session?.user?.id]);

  const generateInviteLink = useCallback(async () => {
    setInviteSending(true);
    try {
      await createInviteLink();
    } finally {
      setInviteSending(false);
    }
  }, [createInviteLink]);

  const sendAthleteInvitation = useCallback(async () => {
    const email = inviteEmail.trim().toLowerCase();
    if (!email || !session?.user?.id) {
      notify("Escribe un email o usa el link directo.");
      return;
    }
    setInviteSending(true);
    try {
      const inviteLink = await createInviteLink();
      if (!inviteLink) return;
      const mail = await sendAppEmail({
        template: "athlete_invite",
        to: email,
        vars: {
          inviteLink,
          coachCode: inviteCoachPublicCode || undefined,
        },
      });
      notify(mail.ok ? "Invitación enviada ✓" : `No se pudo enviar el correo (${mail.reason}). Comparte el enlace a mano.`);
    } catch (e) {
      console.error("sendAthleteInvitation:", e);
      notify("No se pudo enviar la invitación.");
    } finally {
      setInviteSending(false);
    }
  }, [inviteEmail, inviteCoachPublicCode, notify, session?.user?.id, createInviteLink]);

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

  // Perfil siempre; coaches tambien lista + km/badges via workoutsRefresh.
  // AthleteHome hace su propio resume (ficha/workouts/intervals) sin duplicar profiles.
  useAppResumeRefresh(() => {
    void refreshProfileSilent();
    if (profile && profile.role !== "athlete") {
      void loadAthletes({ silent: true });
      setWorkoutsRefresh((r) => r + 1);
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
    if (authLoading || !session?.user?.id) return undefined;
    let cancelled = false;
    (async () => {
      // Nativo: register() vuelve a emitir el token en cada arranque, asi que
      // esto cubre tambien las rotaciones que hace FCM.
      if (Capacitor.isNativePlatform()) {
        await registerNativePush({ notify });
        return;
      }
      const tok = await refreshFcmTokenIfGranted();
      if (cancelled || !tok) return;
      await registerFcmToken(tok);
    })();
    return () => {
      cancelled = true;
    };
  }, [authLoading, session?.user?.id, notify]);

  useEffect(() => {
    // En nativo el primer plano lo cubre el listener pushNotificationReceived
    // de nativePush.js; firebase/messaging no funciona en el WebView.
    if (!session || Capacitor.isNativePlatform()) return undefined;
    let unsub = () => {};
    (async () => {
      const m = await initMessaging();
      if (!m) return;
      unsub = onMessage(m, (payload) => {
        const t = payload.notification?.title;
        notify(t || "Nuevo mensaje");
      });
    })();
    return () => {
      if (typeof unsub === "function") unsub();
    };
  }, [session, notify]);

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

  /** Destino de un push que aun no se pudo aplicar porque faltaba el atleta. */
  const pendingCoachDeepLinkRef = useRef(null);
  const [nativeDeepLinkTick, setNativeDeepLinkTick] = useState(0);

  // Un tap con la app ya montada no vuelve a ejecutar el efecto de abajo por si
  // solo (en la APK no hay recarga ni cambio de URL): el plugin avisa y este
  // contador lo despierta.
  useEffect(() => {
    if (!isNativePush()) return undefined;
    return subscribeDeepLink(() => setNativeDeepLinkTick((n) => n + 1));
  }, []);

  /**
   * Salta al destino de un aviso push. La web lo recibe en la URL y la APK en
   * el `data` de la notificacion, pero la navegacion es la misma, asi que vive
   * en un solo sitio. Devuelve false si aun no se puede aplicar.
   */
  const applyCoachDeepLink = useCallback((data) => {
    const athleteId = data?.athlete_id;
    if (athleteId) {
      const found = (athletes || []).find((a) => String(a.id) === String(athleteId));
      if (!found) return false; // aun no cargaron; se reintenta cuando lleguen
      setSelectedAthlete(found);
    }
    setView("athletes");
    // Persistir: el efecto de visibilitychange re-aplica raf_lastView al
    // volver a foco y pisaria el destino del deep link.
    try { localStorage.setItem("raf_lastView", "athletes"); } catch {}
    setViewRestored(true); // evita que el efecto de restauracion lo pise
    if (data?.type === "coach_workout_completed" && data?.workout_id) {
      setPendingRegistroWorkoutId(String(data.workout_id));
    }
    return true;
  }, [athletes]);

  // Deep link desde notificaciones push (tipos coach_*). Requiere que el
  // perfil y la lista de atletas ya esten cargados; si el athlete_id aun no
  // esta en `athletes`, el efecto reintenta cuando llegue (dep [athletes]).
  useEffect(() => {
    if (typeof window === "undefined") return;
    if (!profile || profile.role === "athlete") return;

    const params = new URLSearchParams(window.location.search);
    const open = params.get("open");
    const fromUrl = open && open.startsWith("coach_")
      ? { type: open, athlete_id: params.get("athlete_id"), workout_id: params.get("workout_id") }
      : null;
    // En la APK la URL nunca cambia al tocar la notificacion: el destino lo
    // dejo el listener nativo. Se guarda en el ref si no se pudo aplicar, para
    // no perderlo (consumirlo lo borra del modulo).
    const target = fromUrl || pendingCoachDeepLinkRef.current || consumePendingDeepLink("coach_");
    if (!target) return;

    if (!applyCoachDeepLink(target)) {
      pendingCoachDeepLinkRef.current = target;
      return;
    }
    pendingCoachDeepLinkRef.current = null;

    // Consumir el parametro para que no se reprocese en recargas.
    if (fromUrl) {
      params.delete("open"); params.delete("athlete_id"); params.delete("workout_id");
      const qs = params.toString();
      window.history.replaceState({}, "", window.location.pathname + (qs ? `?${qs}` : ""));
    }
  }, [profile, athletes, applyCoachDeepLink, nativeDeepLinkTick]);

  useEffect(() => {
    if (view === "athletes" || view === "evaluation" || view === "challenges") {
      writeStoredTab(TAB_KEY_ATHLETES, getAthletesTabFromView(view));
    }
    if (view === "plan12" || view === "builder" || view === "carrera_gpx" || view === "training") {
      writeStoredTab(TAB_KEY_TRAINING, getTrainingTabFromView(view));
    }
  }, [view, writeStoredTab, getAthletesTabFromView, getTrainingTabFromView]);

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
      localStorage.removeItem(RAF_SELECTED_ATHLETE_STORAGE_KEY);
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
    setSelectedAthlete(null);
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

  const saveNewAthlete = async () => {
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

    setAthletes(prev => [normalizeAthlete(data), ...prev]);

    setShowAddAthleteForm(false);
    setNewAthlete({ name: "", email: "", goal: "", pace: "", weekly_km: "" });
    setPlanLimitWarning("");
    notify("Atleta agregado ✓");
  };

  const cancelAddAthleteForm = () => {
    setShowAddAthleteForm(false);
    setNewAthlete({ name: "", email: "", goal: "", pace: "", weekly_km: "" });
  };

  const handleDeleteAthlete = async (athleteRow) => {
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
      {inviteModalOpen ? (
        <div style={{ position: "fixed", inset: 0, background: "rgba(15,23,42,.45)", display: "flex", alignItems: "center", justifyContent: "center", zIndex: 500, padding: 16 }}>
          <div style={{ ...S.card, width: "100%", maxWidth: 460, margin: 0 }}>
            <div style={{ fontSize: ".95em", fontWeight: 800, color: "#0f172a", marginBottom: 10 }}>📧 Invitar Atleta</div>
            <div style={{ fontSize: ".8em", color: "#64748b", marginBottom: 8 }}>Email del atleta (opcional)</div>
            <input
              type="email"
              value={inviteEmail}
              onChange={(e) => setInviteEmail(e.target.value)}
              placeholder="atleta@email.com"
              style={{ width: "100%", background: "#fff", border: "1px solid #e2e8f0", borderRadius: 8, padding: "10px 12px", color: "#0f172a", fontFamily: "inherit", fontSize: ".85em", boxSizing: "border-box" }}
            />
            <div style={{ fontSize: ".8em", color: "#64748b", marginTop: 14, marginBottom: 4 }}>Código coach</div>
            <input
              type="text"
              readOnly
              value={inviteCoachPublicCode}
              aria-readonly="true"
              style={{ width: "100%", background: "#f8fafc", border: "1px solid #e2e8f0", borderRadius: 8, padding: "10px 12px", color: "#0f172a", fontFamily: "ui-monospace,monospace", fontSize: ".9em", fontWeight: 700, boxSizing: "border-box" }}
            />
            <div style={{ fontSize: ".72em", color: "#94a3b8", marginTop: 6, lineHeight: 1.45 }}>El atleta usará este código al registrarse.</div>
            <div style={{ marginTop: 12, display: "flex", justifyContent: "flex-end", gap: 8, flexWrap: "wrap" }}>
              <button type="button" onClick={() => { setInviteModalOpen(false); setLastInviteLink(""); }} style={{ background: "#fff", border: "1px solid #e2e8f0", borderRadius: 8, padding: "8px 12px", color: "#64748b", cursor: "pointer", fontFamily: "inherit", fontWeight: 700, fontSize: ".8em" }}>Cerrar</button>
              <button
                type="button"
                onClick={sendAthleteInvitation}
                disabled={inviteSending}
                style={{ background: inviteSending ? "#e2e8f0" : "linear-gradient(135deg,#0d9488,#14b8a6)", border: "none", borderRadius: 8, padding: "8px 12px", color: inviteSending ? "#64748b" : "#fff", cursor: inviteSending ? "not-allowed" : "pointer", fontFamily: "inherit", fontWeight: 800, fontSize: ".8em" }}
              >
                {inviteSending ? "Enviando..." : "📧 Enviar por correo"}
              </button>
              <button
                type="button"
                onClick={generateInviteLink}
                disabled={inviteSending}
                style={{ background: inviteSending ? "#e2e8f0" : "#0f172a", border: "none", borderRadius: 8, padding: "8px 12px", color: inviteSending ? "#64748b" : "#fff", cursor: inviteSending ? "not-allowed" : "pointer", fontFamily: "inherit", fontWeight: 800, fontSize: ".8em" }}
              >
                🔗 Generar link
              </button>
            </div>
            {lastInviteLink && (
              <div style={{ marginTop: 14, paddingTop: 14, borderTop: "1px solid #e2e8f0" }}>
                <div style={{ fontSize: ".82em", color: "#166534", fontWeight: 700, marginBottom: 8 }}>
                  ✅ Invitación enviada por correo. También puedes compartir el link:
                </div>
                <div style={{ display: "flex", gap: 8, flexWrap: "wrap" }}>
                  <button type="button" onClick={() => {
                    const msg = `¡Te invito a entrenar conmigo en RunningApexFlow! 🏃 Regístrate aquí y recibe tus entrenamientos directo en tu reloj: ${lastInviteLink}`;
                    window.open(`https://wa.me/?text=${encodeURIComponent(msg)}`, "_blank");
                  }} style={{ background:"#25D366", color:"#fff", border:"none", borderRadius:8, padding:"10px 16px", fontWeight:800, fontFamily:"inherit", cursor:"pointer", fontSize:".85em" }}>
                    💬 Compartir por WhatsApp
                  </button>
                  <button type="button" onClick={async () => {
                    try { await navigator.clipboard.writeText(lastInviteLink); alert("Link copiado"); }
                    catch { alert("No se pudo copiar"); }
                  }} style={{ background:"#f1f5f9", color:"#334155", border:"1px solid #cbd5e1", borderRadius:8, padding:"10px 16px", fontWeight:700, fontFamily:"inherit", cursor:"pointer", fontSize:".85em" }}>
                    📋 Copiar link
                  </button>
                </div>
              </div>
            )}
          </div>
        </div>
      ) : null}

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
        {showPushInvite && (
            <div
              style={{
                margin: "12px 16px 0",
                padding: "12px 16px",
                borderRadius: 12,
                background: "#fffbeb",
                border: "1px solid #fde68a",
                display: "flex",
                flexWrap: "wrap",
                alignItems: "center",
                gap: 12,
                boxShadow: "0 1px 3px rgba(0,0,0,0.08)",
              }}
            >
              <span style={{ flex: "1 1 200px", color: "#78350f", fontSize: ".88em", fontWeight: 600 }}>
                Activa las notificaciones para recibir mensajes
              </span>
              <div style={{ display: "flex", gap: 8, flexWrap: "wrap" }}>
                <button
                  type="button"
                  onClick={async () => {
                    if (typeof localStorage !== "undefined") localStorage.removeItem("raf_push_invite_dismissed");
                    await syncFcmTokenToProfile();
                    await refreshNativePushPermission();
                  }}
                  style={{
                    padding: "8px 14px",
                    borderRadius: 8,
                    border: "none",
                    background: "linear-gradient(135deg,#e86f28,#ff8a3d)",
                    color: "#fff",
                    fontWeight: 800,
                    fontSize: ".8em",
                    cursor: "pointer",
                    fontFamily: "inherit",
                  }}
                >
                  Activar
                </button>
                <button
                  type="button"
                  onClick={dismissPushInvite}
                  style={{
                    padding: "8px 14px",
                    borderRadius: 8,
                    border: "1px solid #e2e8f0",
                    background: "#fff",
                    color: "#64748b",
                    fontWeight: 700,
                    fontSize: ".8em",
                    cursor: "pointer",
                    fontFamily: "inherit",
                  }}
                >
                  Ahora no
                </button>
              </div>
            </div>
          )}
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
            onRequestAddAthlete={() => { setLastInviteLink(""); setInviteModalOpen(true); }}
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
                onAthleteWorkoutsDoneSync={(athleteId, workoutsDone) => {
                  setAthletes(prev => prev.map(a => (String(a.id) === String(athleteId) ? { ...a, workouts_done: workoutsDone } : a)));
                  setSelectedAthlete(prev => (prev && String(prev.id) === String(athleteId) ? { ...prev, workouts_done: workoutsDone } : prev));
                }}
                onAthleteFcSync={(athleteId, fc_max, fc_reposo) => {
                  setAthletes((prev) =>
                    prev.map((a) => (String(a.id) === String(athleteId) ? normalizeAthlete({ ...a, fc_max, fc_reposo }) : a)),
                  );
                  setSelectedAthlete((prev) =>
                    prev && String(prev.id) === String(athleteId) ? normalizeAthlete({ ...prev, fc_max, fc_reposo }) : prev,
                  );
                }}
                coachDisplayName={
                  profile?.name ||
                  session?.user?.user_metadata?.full_name ||
                  (session?.user?.email ? session.user.email.split("@")[0] : null) ||
                  "Coach"
                }
                onDeleteAthlete={handleDeleteAthlete}
                notify={notify}
                onOpenInviteModal={() => { setLastInviteLink(""); setInviteModalOpen(true); }}
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
                onPlanAssigned={() => setWorkoutsRefresh((r) => r + 1)}
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
                onWorkoutAssigned={() => setWorkoutsRefresh(r => r + 1)}
                onSavedToLibrary={() => setLibraryRefresh((r) => r + 1)}
              />
            )}
            {view === "carrera_gpx" && (
              <GpxRacePlan
                athletes={athletes}
                coachUserId={session?.user?.id ?? null}
                notify={notify}
                onSavedToLibrary={() => setLibraryRefresh((r) => r + 1)}
                onWorkoutAssigned={() => setWorkoutsRefresh((r) => r + 1)}
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
            onUseWorkout={(row) => {
              setAiWorkout(libraryRowToBuilderWorkout(row));
              setView("builder");
              notify("Workout cargado en el generador. Puedes asignarlo a un atleta.");
            }}
            onCopiedGlobalToLibrary={() => setLibraryRefresh((r) => r + 1)}
            onOpenAdminMarketplaceDraft={() => setView("admin")}
            onAfterLibraryImportSuccess={() => {
              setView("library");
              try {
                if (typeof window !== "undefined") localStorage.setItem("raf_lastView", "library");
              } catch {
                /* ignore */
              }
              setLibraryRefresh((r) => r + 1);
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

      {showCoachPlanPickerScreen ? (
        <div
          style={{
            position: "fixed",
            inset: 0,
            zIndex: 4000,
            background: "linear-gradient(165deg, #f8fafc 0%, #e2e8f0 45%, #f1f5f9 100%)",
            overflowY: "auto",
            WebkitOverflowScrolling: "touch",
            boxSizing: "border-box",
          }}
        >
          <div style={{ maxWidth: 1040, margin: "0 auto", padding: "28px 18px 48px", position: "relative" }}>
            {!coachPlanBlockedUi ? (
              <button
                type="button"
                onClick={closeCoachPlanPicker}
                style={{
                  position: "absolute",
                  top: 18,
                  right: 12,
                  padding: "8px 12px",
                  borderRadius: 8,
                  border: "1px solid #e2e8f0",
                  background: "#fff",
                  color: "#64748b",
                  fontWeight: 700,
                  fontSize: ".78em",
                  cursor: "pointer",
                  fontFamily: "inherit",
                }}
              >
                Cerrar
              </button>
            ) : null}
            <h1
              style={{
                fontSize: "clamp(1.35rem, 3.5vw, 1.85rem)",
                fontWeight: 900,
                color: "#0f172a",
                textAlign: "center",
                margin: "8px 0 10px",
                lineHeight: 1.2,
              }}
            >
              Elige tu plan RunningApexFlow
            </h1>
            <p style={{ textAlign: "center", color: "#64748b", fontSize: ".95em", maxWidth: 560, margin: "0 auto 20px", lineHeight: 1.45 }}>
              Comienza a transformar el rendimiento de tus atletas
            </p>

            <div
              style={{
                background: "#fff",
                borderRadius: 14,
                border: "1px solid #e2e8f0",
                padding: "16px 18px",
                marginBottom: 22,
                boxShadow: "0 4px 16px rgba(15,23,42,.04)",
              }}
            >
              <div style={{ fontSize: ".72em", letterSpacing: ".12em", color: "#64748b", fontWeight: 700, marginBottom: 10 }}>
                CÓDIGO PROMOCIONAL
              </div>
              <div style={{ display: "flex", flexWrap: "wrap", gap: 10, alignItems: "center" }}>
                <input
                  value={coachPromoInput}
                  onChange={(e) => setCoachPromoInput(e.target.value)}
                  placeholder="Ingresa tu código"
                  disabled={!!coachAppliedPromo}
                  style={{
                    flex: "1 1 200px",
                    minWidth: 160,
                    padding: "10px 12px",
                    borderRadius: 8,
                    border: "1px solid #e2e8f0",
                    background: coachAppliedPromo ? "#f1f5f9" : "#fff",
                    color: "#0f172a",
                    fontFamily: "inherit",
                    fontSize: ".88em",
                  }}
                />
                {coachAppliedPromo ? (
                  <button
                    type="button"
                    onClick={clearCoachPromo}
                    style={{
                      padding: "10px 16px",
                      borderRadius: 8,
                      border: "1px solid #e2e8f0",
                      background: "#fff",
                      color: "#64748b",
                      fontWeight: 700,
                      cursor: "pointer",
                      fontFamily: "inherit",
                    }}
                  >
                    Quitar
                  </button>
                ) : (
                  <button
                    type="button"
                    onClick={applyCoachPromo}
                    disabled={coachPromoLoading}
                    style={{
                      padding: "10px 18px",
                      borderRadius: 8,
                      border: "none",
                      background: coachPromoLoading ? "#e2e8f0" : "linear-gradient(135deg,#2563eb,#3b82f6)",
                      color: coachPromoLoading ? "#64748b" : "#fff",
                      fontWeight: 800,
                      cursor: coachPromoLoading ? "not-allowed" : "pointer",
                      fontFamily: "inherit",
                    }}
                  >
                    {coachPromoLoading ? "…" : "Aplicar"}
                  </button>
                )}
              </div>
              {coachPromoError ? <div style={{ color: "#dc2626", fontSize: ".8em", marginTop: 8 }}>{coachPromoError}</div> : null}
              {coachAppliedPromo ? (
                <div style={{ color: "#15803d", fontSize: ".82em", marginTop: 8, fontWeight: 600 }}>
                  Descuento del {coachAppliedPromo.discount_percent}% aplicado a los precios mostrados.
                </div>
              ) : null}
            </div>

            <div
              style={{
                display: "grid",
                gridTemplateColumns: "repeat(auto-fit, minmax(280px, 1fr))",
                gap: 20,
                alignItems: "stretch",
              }}
            >
              {["basico", "pro"].map((planKey) => {
                const def = COACH_PLAN_PICKER_DEFS[planKey];
                const selectedPlan = coachPickerPlan === planKey;
                const discountPct = coachAppliedPromo?.discount_percent ?? 0;
                return (
                  <div
                    key={planKey}
                    style={{
                      background: "#fff",
                      borderRadius: 16,
                      padding: "22px 18px 20px",
                      border: selectedPlan ? "2px solid #ff8a3d" : "1px solid #e2e8f0",
                      boxShadow: selectedPlan ? "0 12px 40px rgba(255,138,61,.12)" : "0 4px 20px rgba(15,23,42,.06)",
                      display: "flex",
                      flexDirection: "column",
                      gap: 14,
                    }}
                  >
                    <div style={{ fontSize: "1.25em", fontWeight: 900, color: "#0f172a" }}>{def.title}</div>
                    <ul style={{ margin: 0, paddingLeft: 18, color: "#475569", fontSize: ".86em", lineHeight: 1.55 }}>
                      {def.bullets.map((b) => (
                        <li key={b}>{b}</li>
                      ))}
                    </ul>
                    <div style={{ display: "flex", flexDirection: "column", gap: 10, marginTop: 4 }}>
                      {COACH_PLAN_PICKER_PERIODS.map((per) => {
                        const amount = def.prices[per.id];
                        const amountAfter = Math.max(0, Math.round((amount * (100 - discountPct)) / 100));
                        const selected = selectedPlan && coachPickerPeriod === per.id;
                        const priceLine =
                          per.id === "monthly"
                            ? `$${formatCopInt(amountAfter)} COP/mes`
                            : `$${formatCopInt(amountAfter)} COP`;
                        return (
                          <button
                            key={per.id}
                            type="button"
                            onClick={() => {
                              setCoachPickerPlan(planKey);
                              setCoachPickerPeriod(per.id);
                            }}
                            style={{
                              textAlign: "left",
                              padding: "12px 14px",
                              borderRadius: 12,
                              border: selected ? "2px solid #ea580c" : "1px solid #e2e8f0",
                              background: selected ? "rgba(251,146,60,.08)" : "#f8fafc",
                              cursor: "pointer",
                              fontFamily: "inherit",
                              display: "flex",
                              flexWrap: "wrap",
                              alignItems: "center",
                              justifyContent: "space-between",
                              gap: 8,
                            }}
                          >
                            <div>
                              <div style={{ fontWeight: 800, color: "#0f172a", fontSize: ".88em" }}>{per.label}</div>
                              <div style={{ fontSize: ".82em", color: "#64748b", marginTop: 4 }}>
                                {discountPct > 0 ? (
                                  <>
                                    <span style={{ textDecoration: "line-through", color: "#94a3b8", marginRight: 6 }}>
                                      ${formatCopInt(amount)}
                                    </span>
                                    <span style={{ color: "#15803d", fontWeight: 800 }}>{priceLine}</span>
                                  </>
                                ) : (
                                  priceLine
                                )}
                              </div>
                            </div>
                            {per.badge ? (
                              <span
                                style={{
                                  fontSize: ".68em",
                                  fontWeight: 800,
                                  color: "#15803d",
                                  background: "rgba(34,197,94,.14)",
                                  border: "1px solid rgba(34,197,94,.35)",
                                  borderRadius: 999,
                                  padding: "4px 10px",
                                  whiteSpace: "nowrap",
                                }}
                              >
                                {per.badge}
                              </span>
                            ) : null}
                          </button>
                        );
                      })}
                    </div>
                  </div>
                );
              })}
            </div>

            <div style={{ marginTop: 28, display: "flex", flexDirection: "column", alignItems: "center", gap: 12 }}>
              <button
                type="button"
                disabled={!coachPickerPlan || !coachPickerPeriod || coachSubscriptionSaving}
                onClick={handleCoachPlanPagarAhora}
                style={{
                  padding: "14px 28px",
                  borderRadius: 12,
                  border: "none",
                  background:
                    !coachPickerPlan || !coachPickerPeriod || coachSubscriptionSaving ? "#e2e8f0" : "linear-gradient(135deg,#e86f28,#ff8a3d)",
                  color: !coachPickerPlan || !coachPickerPeriod || coachSubscriptionSaving ? "#94a3b8" : "#fff",
                  fontWeight: 900,
                  fontSize: ".95em",
                  cursor: !coachPickerPlan || !coachPickerPeriod || coachSubscriptionSaving ? "not-allowed" : "pointer",
                  fontFamily: "inherit",
                  boxShadow: "0 6px 20px rgba(255,138,61,.25)",
                }}
              >
                {coachSubscriptionSaving ? "Guardando…" : "Pagar ahora"}
              </button>
              {coachPlanBlockedUi ? (
                <p style={{ fontSize: ".78em", color: "#64748b", textAlign: "center", maxWidth: 420 }}>
                  Tu cuenta está bloqueada hasta que se verifique el pago. Si necesitas ayuda, contacta al administrador.
                </p>
              ) : null}
            </div>
          </div>

          {false ? (
            <div
              style={{
                position: "fixed",
                inset: 0,
                zIndex: 4100,
                background: "rgba(15,23,42,.55)",
                display: "flex",
                alignItems: "center",
                justifyContent: "center",
                padding: 16,
                boxSizing: "border-box",
              }}
              role="dialog"
              aria-modal="true"
              aria-labelledby="coach-pay-modal-title"
            >
              <div
                style={{
                  width: "100%",
                  maxWidth: 460,
                  background: "#fff",
                  borderRadius: 16,
                  padding: "24px 22px",
                  border: "1px solid #e2e8f0",
                  boxShadow: "0 20px 50px rgba(15,23,42,.2)",
                }}
              >
                <h2 id="coach-pay-modal-title" style={{ margin: "0 0 14px", fontSize: "1.1em", fontWeight: 900, color: "#0f172a" }}>
                  Instrucciones de pago
                </h2>
                <div style={{ color: "#334155", fontSize: ".88em", lineHeight: 1.65, marginBottom: 18 }}>
                  <div>Realiza tu pago a:</div>
                  <div style={{ marginTop: 10 }}>
                    📱 Nequi: <strong>{COACH_SUBSCRIPTION_NEQUI}</strong>
                  </div>
                  <div style={{ marginTop: 10 }}>📸 Envía el comprobante por WhatsApp al mismo número</div>
                  <div style={{ marginTop: 10 }}>✅ Tu cuenta será activada en menos de 24 horas</div>
                </div>
                <div style={{ display: "flex", flexDirection: "column", gap: 10 }}>
                  <a
                    href={coachPlanPickerWhatsAppHref}
                    target="_blank"
                    rel="noopener noreferrer"
                    style={{
                      display: "block",
                      textAlign: "center",
                      padding: "12px 16px",
                      borderRadius: 10,
                      background: "linear-gradient(135deg,#22c55e,#16a34a)",
                      color: "#fff",
                      fontWeight: 800,
                      fontSize: ".88em",
                      textDecoration: "none",
                      fontFamily: "inherit",
                    }}
                  >
                    Enviar comprobante por WhatsApp
                  </a>
                  <button
                    type="button"
                    onClick={() => setCoachPaymentModalOpen(false)}
                    style={{
                      padding: "10px 14px",
                      borderRadius: 10,
                      border: "1px solid #e2e8f0",
                      background: "#f8fafc",
                      color: "#64748b",
                      fontWeight: 700,
                      fontSize: ".82em",
                      cursor: "pointer",
                      fontFamily: "inherit",
                    }}
                  >
                    Cerrar
                  </button>
                </div>
              </div>
            </div>
          ) : null}
        </div>
      ) : null}
    </div>
    </Suspense>
  );
}

