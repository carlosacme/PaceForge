import React, { Fragment, useState, useEffect, useMemo, useCallback, useRef, Suspense } from "react";
import { supabase } from "./lib/supabase";
import { readStructure } from "./lib/workoutStructure";
import { usePersistedState } from "./hooks/usePersistedState";
import { useAppResumeRefresh } from "./hooks/useAppResumeRefresh";
import Athletes from "./components/Athletes";
import {
  BRAND_NAME,
  WORKOUT_TYPES,
  EVAL_DISTANCES,
  PLAN_PREVIEW_FULL_DAYS,
  PLAN_SESSION_TYPE_OPTIONS,
  normalizeAthlete,
  sumWeekKm,
  formatLocalYMD,
  normalizeScheduledDateYmd,
  startOfWeekMonday,
  addDays,
  normalizeWorkoutStructure,
  libraryRowToBuilderWorkout,
  ADMIN_EMAIL,
  PLATFORM_ADMIN_USER_ID,
  formatCopInt,
  registerFcmToken,
  unregisterOwnDeviceToken,
  resendSignupConfirmation,
  sendAppEmail,
  ensureOwnProfile,
  stashPendingInviteCode,
  acceptPendingInvitationIfAny,
  userFacingError,
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
import { isConfirmEmailRoute, CONFIRM_EMAIL_PATH } from "./lib/authRoutes";
import { initNativeAppLinks, consumePendingAppLink, subscribeAppLink, applyAppLink } from "./lib/nativeAppLinks";
const CoachSettings = React.lazy(() => import("./components/CoachSettings"));
const WorkoutLibrary = React.lazy(() => import("./components/WorkoutLibrary"));
const MarketplaceHub = React.lazy(() => import("./components/MarketplaceHub"));
const ChallengesHub = React.lazy(() => import("./components/ChallengesHub"));
const AdminMarketplacePanel = React.lazy(() => import("./components/AdminMarketplacePanel"));
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


/** Días completos para planes marketplace (admin) y formulario de sesión. */


/** Ritmos (min/km) para generación IA de marketplace: pace_range = H:MM-H:MM con guión ASCII. */


/** easy/long/recovery/fartlek → banda "fácil"; tempo / interval según tipo. */



/** Sesiones para "Ver plan": plan completo en `plan_sessions` (o alias) si hay más filas que en `preview_workouts`. */

const DAYS = ["Lun", "Mar", "Mié", "Jue", "Vie", "Sáb", "Dom"];

const MONTH_INDEX = {
  Jan: 0, Feb: 1, Mar: 2, Apr: 3, May: 4, Jun: 5,
  Jul: 6, Aug: 7, Sep: 8, Oct: 9, Nov: 10, Dec: 11,
};

const getRaceCountdownText = (nextRace) => {
  if (!nextRace || typeof nextRace !== "string") return "🏁 Próxima carrera · fecha pendiente";

  const [raceNameRaw, datePartRaw] = nextRace.split(" - ");
  const raceName = (raceNameRaw || "Próxima carrera").trim();
  const datePart = (datePartRaw || "").trim();
  const [monthAbbr, dayRaw] = datePart.split(/\s+/);
  const month = MONTH_INDEX[monthAbbr];
  const day = Number(dayRaw);

  if (month === undefined || !Number.isFinite(day)) {
    return `🏁 ${raceName} · fecha pendiente`;
  }

  const now = new Date();
  const today = new Date(now.getFullYear(), now.getMonth(), now.getDate());
  let raceDate = new Date(today.getFullYear(), month, day);
  if (raceDate < today) raceDate = new Date(today.getFullYear() + 1, month, day);

  const diffMs = raceDate.getTime() - today.getTime();
  const daysLeft = Math.ceil(diffMs / (1000 * 60 * 60 * 24));
  const label = daysLeft === 1 ? "día" : "días";

  return `🏁 ${raceName} · faltan ${daysLeft} ${label}`;
};

/** Etiqueta de carrera y días restantes (para tablas y métricas). */
const getRaceMeta = (nextRace) => {
  if (!nextRace || typeof nextRace !== "string") return { name: "—", daysLeft: null };
  const [raceNameRaw, datePartRaw] = nextRace.split(" - ");
  const raceName = (raceNameRaw || "Próxima carrera").trim();
  const datePart = (datePartRaw || "").trim();
  const [monthAbbr, dayRaw] = datePart.split(/\s+/);
  const month = MONTH_INDEX[monthAbbr];
  const day = Number(dayRaw);
  if (month === undefined || !Number.isFinite(day)) {
    return { name: raceName, daysLeft: null };
  }
  const now = new Date();
  const today = new Date(now.getFullYear(), now.getMonth(), now.getDate());
  let raceDate = new Date(today.getFullYear(), month, day);
  if (raceDate < today) raceDate = new Date(today.getFullYear() + 1, month, day);
  const diffMs = raceDate.getTime() - today.getTime();
  const daysLeft = Math.ceil(diffMs / (1000 * 60 * 60 * 24));
  return { name: raceName, daysLeft };
};


// sendChatPushNotification, sendWorkoutAssignmentPushToAthlete y pushBodySnippet
// viven ahora en src/components/shared/appShared.js (fuente unica) y se importan arriba.








const getCurrentMonthKey = () => {
  const d = new Date();
  const m = String(d.getMonth() + 1).padStart(2, "0");
  return `${d.getFullYear()}-${m}`;
};

/** YYYY-MM-DD desde componentes locales (celdas del calendario); evita desfaces vs strings ISO del workout. */

/** Normaliza scheduled_date del workout a YYYY-MM-DD sin depender de Date cuando ya viene como fecha. */



/** Primer día del mes siguiente (YYYY-MM-DD, calendario local). */

/** Último día del mes siguiente (YYYY-MM-DD, calendario local). */

/** Lunes a domingo de la próxima semana (respecto a hoy), calendario local. */

/** Suma de minutos → texto legible (horas y minutos). */

/** Lunes de la semana que contiene el primer día del mes */

/** 42 celdas (6 semanas), vista mensual */






/** Carreras con fecha >= todayYmd, la primera es la más próxima */


const PLAN_12_LEVELS = [
  { id: "principiante", label: "Principiante" },
  { id: "intermedio", label: "Intermedio" },
  { id: "avanzado", label: "Avanzado" },
];

const clampWorkoutRpe = (n) => {
  const v = Number(n);
  if (!Number.isFinite(v)) return null;
  const i = Math.round(v);
  if (i < 1 || i > 10) return null;
  return i;
};




/** Emoji por banda RPE (1–10). */
const rpeBandMeta = (rpe) => {
  if (rpe == null || rpe < 1 || rpe > 10) return { emoji: "", label: "" };
  if (rpe <= 3) return { emoji: "😌", label: "Muy fácil" };
  if (rpe <= 5) return { emoji: "🙂", label: "Moderado" };
  if (rpe <= 7) return { emoji: "😤", label: "Duro" };
  if (rpe <= 9) return { emoji: "😰", label: "Muy duro" };
  return { emoji: "🔥", label: "Máximo" };
};


const normalizeWorkoutRow = (row) => {
  const structure = normalizeWorkoutStructure(readStructure(row));
  const scheduled = normalizeScheduledDateYmd(row.scheduled_date);
  const type = row.type && WORKOUT_TYPES.some(t => t.id === row.type) ? row.type : "easy";
  return {
    id: row.id,
    athlete_id: row.athlete_id,
    coach_id: row.coach_id,
    scheduled_date: scheduled,
    type,
    title: row.title || WORKOUT_TYPES.find(t => t.id === type)?.label || "Entrenamiento",
    total_km: Number.isFinite(Number(row.total_km)) ? Number(row.total_km) : 0,
    distance_km: Number.isFinite(Number(row.distance_km))
      ? Number(row.distance_km)
      : Number.isFinite(Number(row.total_km))
        ? Number(row.total_km)
        : 0,
    duration_min: Number.isFinite(Number(row.duration_min)) ? Number(row.duration_min) : 0,
    description: row.description || "",
    structure: Array.isArray(structure) ? structure : [],
    done: Boolean(row.done),
    rpe: clampWorkoutRpe(row.rpe),
    manual_distance_km: Number.isFinite(Number(row.manual_distance_km)) ? Number(row.manual_distance_km) : null,
    manual_duration_min: Number.isFinite(Number(row.manual_duration_min)) ? Number(row.manual_duration_min) : null,
    manual_avg_hr: Number.isFinite(Number(row.manual_avg_hr)) ? Math.round(Number(row.manual_avg_hr)) : null,
    manual_max_hr: Number.isFinite(Number(row.manual_max_hr)) ? Math.round(Number(row.manual_max_hr)) : null,
    manual_calories: Number.isFinite(Number(row.manual_calories)) ? Math.round(Number(row.manual_calories)) : null,
    athlete_notes: typeof row.athlete_notes === "string" ? row.athlete_notes : "",
    completed_at: row.completed_at || null,
    actual_distance_km: row.actual_distance_km ?? null,
    actual_duration_min: row.actual_duration_min ?? null,
    actual_avg_pace_s: row.actual_avg_pace_s ?? null,
    actual_avg_hr: row.actual_avg_hr ?? null,
    actual_max_hr: row.actual_max_hr ?? null,
    actual_elevation_m: row.actual_elevation_m ?? null,
    actual_synced_at: row.actual_synced_at ?? null,
    intervals_activity_id: row.intervals_activity_id ?? null,
  };
};


/** Convierte structure del workout a filas editables (fases). */

/** Filas del formulario → JSON guardado en workouts.structure */



const fitTitleKeywords = {
  tempo: /\btempo\b/i,
  interval: /\b(interval|intervalos|repeats?|series)\b/i,
};

const getFitAvgSpeedChanges = (records) => {
  const speeds = (Array.isArray(records) ? records : [])
    .map((r) => Number(r?.enhanced_speed ?? r?.speed))
    .filter((s) => Number.isFinite(s) && s > 0);
  if (speeds.length < 3) return 0;
  let changes = 0;
  for (let i = 1; i < speeds.length; i += 1) {
    const prev = speeds[i - 1];
    const curr = speeds[i];
    if (prev <= 0 || curr <= 0) continue;
    const delta = Math.abs(curr - prev) / prev;
    if (delta >= 0.15) changes += 1;
  }
  return changes;
};

const mapFitWorkoutType = ({ sport, title, speedChanges, durationMin, distanceKm }) => {
  const sportKey = String(sport || "").toLowerCase();
  const safeTitle = String(title || "").trim();
  const hasTempoWord = fitTitleKeywords.tempo.test(safeTitle);
  const hasIntervalWord = fitTitleKeywords.interval.test(safeTitle);
  const isIntervalBySpeed = Number(speedChanges) > 3;
  const isLong = Number(durationMin) >= 80 || Number(distanceKm) >= 14;
  if (sportKey === "running") {
    if (hasTempoWord) return "tempo";
    if (hasIntervalWord || isIntervalBySpeed) return "interval";
    if (isLong) return "long";
    return "easy";
  }
  if (sportKey === "walking") return "recovery";
  return "easy";
};





const ProgressBar = ({ value, total, color = "#ff8a3d" }) => (
  <div style={{ background: "#f1f5f9", borderRadius: 4, height: 5, overflow: "hidden", marginTop: 6 }}>
    <div style={{ width: `${(value / total) * 100}%`, height: "100%", background: color, borderRadius: 4 }} />
  </div>
);


/** Admin plataforma (Coaches, biblioteca global, prioridad en directorio). */

const ADMIN_WHATSAPP_E164 = "573233675434";
const COACH_PROFILE_TRIAL_DAYS = 7;

/** Días restantes de trial: max(0, 7 − días transcurridos desde trial_started_at). */
const coachTrialDaysRemainingFromStart = (prof) => {
  if (!prof || prof.plan_status !== "trial" || !prof.trial_started_at) return null;
  const start = new Date(prof.trial_started_at);
  if (Number.isNaN(start.getTime())) return null;
  const elapsedDays = Math.floor((Date.now() - start.getTime()) / 86400000);
  return Math.max(0, COACH_PROFILE_TRIAL_DAYS - elapsedDays);
};

async function resolveCoachUserIdFromPublicCode(codeInput) {
  const codigoIngresado = String(codeInput || "").trim();
  if (!codigoIngresado) return null;
  const { data, error } = await supabase
    .from("profiles")
    .select("user_id, role, name")
    .eq("coach_id", codigoIngresado.trim().toUpperCase())
    .maybeSingle();
  if (error) {
    console.error("resolveCoachUserIdFromPublicCode:", error);
    return null;
  }
  return data?.user_id ?? null;
}

function coachDirectorySpecialtyLabel(row) {
  const city = (row?.city || "").trim();
  const country = (row?.country || "").trim();
  const loc = [city, country].filter(Boolean).join(" · ");
  if (loc) return loc;
  const plan = (row?.subscription_plan || "").trim();
  if (plan) return plan;
  return "Entrenador de running";
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

const TAB_KEY_CREATE_WORKOUT = "raf_tab_crear_workout";


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
  const [authMode, setAuthMode] = useState("login");
  const [authEmail, setAuthEmail] = useState("");
  const [authPassword, setAuthPassword] = useState("");
  const [authError, setAuthError] = useState("");
  const [authInfo, setAuthInfo] = useState("");
  const [authSubmitting, setAuthSubmitting] = useState(false);
  /**
   * Ofrecer el reenvio del correo de confirmacion junto al error del login.
   * Se enciende tanto cuando GoTrue confirma que el correo esta sin verificar
   * como cuando responde el genérico "Invalid login credentials", porque ahi las
   * dos causas (sin confirmar / contraseña mala) son indistinguibles y el propio
   * reenvio es lo que las separa.
   */
  const [authCanResend, setAuthCanResend] = useState(false);
  const [authResending, setAuthResending] = useState(false);
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
  const [landingAuthOpen, setLandingAuthOpen] = useState(false);
  /** Pantalla dentro del flujo de auth: elección inicial, login o registro. */
  const [authLandingStep, setAuthLandingStep] = useState("choice");
  const [demoModalOpen, setDemoModalOpen] = useState(false);
  const [authRole, setAuthRole] = useState("");
  const [authName, setAuthName] = useState("");
  const [authCoachCode, setAuthCoachCode] = useState("");
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
  const [inviteCodeFromUrl, setInviteCodeFromUrl] = useState("");
  const [inviteParentCoachId, setInviteParentCoachId] = useState("");
  const [staffParentCoachId, setStaffParentCoachId] = useState("");
  const [inviteModalOpen, setInviteModalOpen] = useState(false);
  const [inviteEmail, setInviteEmail] = useState("");
  const [inviteSending, setInviteSending] = useState(false);
  const [lastInviteLink, setLastInviteLink] = useState("");
  const [pendingCoachRequestId, setPendingCoachRequestId] = useState("");
  const [viewRestored, setViewRestored] = useState(false);
  const [coachPlanPickerVoluntary, setCoachPlanPickerVoluntary] = useState(false);
  const [coachPickerPlan, setCoachPickerPlan] = useState(null);
  const [coachPickerPeriod, setCoachPickerPeriod] = useState(null);
  const [coachSubscriptionSaving, setCoachSubscriptionSaving] = useState(false);

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
    const hiddenViews = ["evaluation", "plan12", "builder", "carrera_gpx", "challenges", "plans"];
    return new Set([...coachNavItems.map((item) => item.id), ...hiddenViews]);
  }, [coachNavItems]);

 const handleCoachPlanPagarAhora = useCallback(async () => {
    if (!coachPickerPlan || !coachPickerPeriod) {
      notify("Elige un plan y un período de pago.");
      return;
    }
    const def = COACH_PLAN_PICKER_DEFS[coachPickerPlan];
    const amountCop = def?.prices?.[coachPickerPeriod];
    if (!def || amountCop == null) {
      notify("Plan o período no válido.");
      return;
    }
    setCoachSubscriptionSaving(true);
    try {
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
  }, [coachPickerPlan, coachPickerPeriod, notify]);

 const coachPlanPickerWhatsAppHref = useMemo(() => {
    if (!coachPickerPlan || !coachPickerPeriod) return `https://wa.me/${COACH_SUBSCRIPTION_WA_E164}`;
    const def = COACH_PLAN_PICKER_DEFS[coachPickerPlan];
    const amount = def?.prices?.[coachPickerPeriod];
    const periodLabel = COACH_PLAN_PICKER_PERIODS.find((p) => p.id === coachPickerPeriod)?.label || coachPickerPeriod;
    const planTitle = def?.title || coachPickerPlan;
    const amountStr = formatCopInt(amount);
    const text = `Hola, realicé el pago del plan ${planTitle} ${periodLabel} por $${amountStr} COP de RunningApexFlow`;
    return `https://wa.me/${COACH_SUBSCRIPTION_WA_E164}?text=${encodeURIComponent(text)}`;
  }, [coachPickerPlan, coachPickerPeriod]);

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
      const { data, error } = await supabase.auth.getSession();
      if (error) {
        console.error("Error leyendo sesión:", error);
      }
      if (mounted) {
        setSession(data?.session ?? null);
        setAuthLoading(false);
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

  // Tras delete_own_account + signOut: mostrar confirmación en la pantalla de login.
  useEffect(() => {
    if (session || authLoading) return;
    try {
      if (sessionStorage.getItem("raf_account_deleted") === "1") {
        sessionStorage.removeItem("raf_account_deleted");
        setAuthInfo("Tu cuenta y datos asociados fueron eliminados correctamente.");
        setAuthError("");
        setLandingAuthOpen(true);
        setAuthLandingStep("login");
        setAuthMode("login");
      }
    } catch {
      /* ignore */
    }
  }, [session, authLoading]);

  useEffect(() => {
    if (typeof window === "undefined") return;
    const params = new URLSearchParams(window.location.search);
    const invite = (params.get("invite") || "").trim();
    if (!invite) return;
    const inviteType = (params.get("type") || "").trim();
    const inviteParentCoach = (params.get("coach") || "").trim();
    setInviteCodeFromUrl(invite);
    setAuthMode("register");
    if (inviteType === "staff") {
      setAuthRole("coach");
      if (inviteParentCoach) {
        setInviteParentCoachId(inviteParentCoach);
        // Persistir para sobrevivir al email de confirmacion y recargas
        try { window.localStorage.setItem("pendingStaffInvite", JSON.stringify({ parentCoach: inviteParentCoach, code: invite })); } catch (_) {}
      }
    } else {
      setAuthRole("athlete");
    }
    setAuthLandingStep("register");
    setLandingAuthOpen(true);
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
      const { data, error } = await supabase
        .from("profiles")
        .select("*")
        .eq("user_id", session.user.id)
        .maybeSingle();
      if (error) {
        console.error("Error cargando perfil:", error);
        setProfile(null);
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
    const { data, error } = await supabase
      .from("profiles")
      .select("*")
      .eq("user_id", uid)
      .maybeSingle();
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
  }, [session?.user?.id]);

  const loadAthletes = useCallback(async ({ silent = false } = {}) => {
    if (authLoading || !session) {
      setAthletes([]);
      setLoadingAthletes(false);
      return;
    }
    if (!silent) setLoadingAthletes(true);
    try {
      const { data: userData, error: userError } = await supabase.auth.getUser();
      if (userError || !userData?.user) {
        console.error("Error obteniendo usuario para filtrar atletas:", userError);
        if (!silent) notify("Error cargando atletas");
        setAthletes([]);
        throw new Error("No user");
      }
      const coachId = userData.user.id;

      const { data: staffRow } = await supabase
        .from("coach_staff")
        .select("coach_id")
        .eq("staff_id", coachId)
        .maybeSingle();
      if (staffRow?.coach_id) setStaffParentCoachId(staffRow.coach_id);

      let data;
      let error;
      if (staffRow) {
        const { data: assignedRows } = await supabase
          .from("staff_athletes")
          .select("athlete_id")
          .eq("staff_id", coachId)
          .eq("coach_id", staffRow.coach_id);
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

      if (error) {
        if (!silent) notify("Error cargando atletas");
        setAthletes([]);
      } else if (data !== undefined) {
        setAthletes((data || []).map(normalizeAthlete));
      }
    } catch (error) {
      console.error("Error inesperado cargando atletas:", error);
      if (!silent) notify("Error cargando atletas");
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

  /**
   * Reenvia el correo de confirmacion, y de paso DESAMBIGUA por qué falló el
   * login: si GoTrue responde que el usuario ya está confirmado, el problema era
   * la contraseña. Es la unica forma de distinguirlo sin montar un endpoint que
   * conteste "este correo existe" a cualquiera que pregunte.
   */
  const handleResendConfirmation = async () => {
    const email = authEmail.trim().toLowerCase();
    if (!email) {
      setAuthError("Escribe tu correo para poder reenviarte la confirmación.");
      return;
    }
    setAuthResending(true);
    setAuthInfo("");
    try {
      const res = await resendSignupConfirmation(email);
      if (res.alreadyConfirmed) {
        // Aqui el reenvio se ofrecio porque el error de Supabase era ambiguo:
        // si el correo ya estaba confirmado, el problema era la contraseña.
        setAuthCanResend(false);
        setAuthError(
          "Tu correo ya está confirmado, así que lo que no coincide es la contraseña. " +
          "Usa «¿Olvidaste tu contraseña?» para cambiarla.",
        );
        return;
      }
      if (!res.ok) {
        setAuthError(res.message);
        return;
      }
      setAuthError("");
      setAuthInfo(res.message);
    } finally {
      setAuthResending(false);
    }
  };

  const handleAuthSubmit = async (e) => {
    e.preventDefault();
    setAuthError("");
    setAuthInfo("");
    setAuthCanResend(false);
    if (!authEmail.trim() || !authPassword.trim()) {
      setAuthError("Completa email y contraseña.");
      return;
    }
    if (authMode === "register") {
      if (!authRole) {
        alert("Selecciona si eres coach o atleta.");
        return;
      }
      if (!authName.trim()) {
        alert("Completa tu nombre.");
        return;
      }
      const emailRegex = /^[^\s@]+@[^\s@]+\.[^\s@]{2,}$/;
      const blockedDomains = ["test.com", "fake.com", "example.com", "correo.com", "mail.com", "temp.com", "yopmail.com"];
      const emailDomain = authEmail.trim().toLowerCase().split("@")[1];
      if (!emailRegex.test(authEmail.trim()) || blockedDomains.includes(emailDomain)) {
        setAuthError("Por favor ingresa un correo electrónico válido.");
        return;
      }
    }

    // Un correo con mayusculas o un espacio pegado al copiar no deben ser una
    // cuenta distinta: se normaliza igual en login y en registro.
    const emailNorm = authEmail.trim().toLowerCase();
    const passwordNorm = authPassword.trim();

    setAuthSubmitting(true);
    try {
      if (authMode === "login") {
        const { error } = await supabase.auth.signInWithPassword({
          email: emailNorm,
          password: passwordNorm,
        });
        if (error) {
          console.error("Error en login:", error);
          const code = String(error.code || "").toLowerCase();
          const msg = String(error.message || "").toLowerCase();
          // GoTrue solo dice "Email not confirmed" cuando la contraseña ES la
          // correcta. Si tambien falla la contraseña responde el genérico
          // invalid_credentials, y ahi las dos causas son indistinguibles: por
          // eso el segundo caso ofrece las dos salidas en vez de acusar a la
          // contraseña, que es lo que dejaba al tester dando vueltas.
          if (code === "email_not_confirmed" || msg.includes("not confirmed")) {
            setAuthCanResend(true);
            setAuthError("Tu correo aún no está confirmado. Revisa tu bandeja de entrada y la carpeta de spam.");
          } else if (code === "invalid_credentials" || msg.includes("invalid login credentials")) {
            setAuthCanResend(true);
            setAuthError(
              "No pudimos iniciar sesión. Si acabas de registrarte, puede que tu correo siga sin confirmar: " +
              "revisa tu bandeja de entrada y la carpeta de spam. Si ya lo confirmaste, la contraseña no coincide " +
              "(volver a registrarte NO la cambia; usa «¿Olvidaste tu contraseña?»).",
            );
          } else {
            setAuthError(userFacingError(error, "No se pudo iniciar sesión."));
          }
          return;
        }
        await syncFcmTokenToProfile();
      } else {
        let linkedCoachId = null;
        let inviteRow = null;
        const hasInviteCode = Boolean(inviteCodeFromUrl);
        const hasManualCoachCode = Boolean(authCoachCode.trim());
        if (hasInviteCode) {
          // Via RPC: durante el registro todavia no hay sesion y las policies
          // de invitations solo dejan leer al coach dueño de la fila.
          const { data: invRows, error: invErr } = await supabase.rpc("find_invitation_by_code", { p_code: inviteCodeFromUrl });
          if (invErr) {
            console.error("Error consultando invitación:", invErr);
          }
          const inv = Array.isArray(invRows) ? invRows[0] : invRows;
          if (inv) {
            const inviteEmail = String(inv.email || "").trim().toLowerCase();
            if (inviteEmail && inviteEmail !== emailNorm) {
              alert("Este link de invitación fue emitido para otro correo.");
              setAuthSubmitting(false);
              return;
            }
            linkedCoachId = inv.coach_id || null;
            inviteRow = inv;
          }
          if (!linkedCoachId) {
            const seguir = window.confirm(
              "El link de invitación no es válido o ya se usó, así que no podemos conectarte con tu coach automáticamente.\n\n¿Continuar el registro sin coach? Podrás conectarte después con el código de tu coach.",
            );
            if (!seguir) {
              setAuthSubmitting(false);
              return;
            }
          }
        } else if (hasManualCoachCode) {
          const coachIdFromCode = await resolveCoachIdByCode(authCoachCode);
          if (!coachIdFromCode) {
            alert("No encontramos un coach con ese código.");
            setAuthSubmitting(false);
            return;
          }
          linkedCoachId = coachIdFromCode;
        }

        const selectedRole = authRole === "coach" ? "coach" : "athlete";
        const resolvedCoachId =
          selectedRole === "athlete"
            ? (() => {
                if (linkedCoachId == null) return null;
                const c = String(linkedCoachId).trim();
                if (c === "" || c === "undefined" || c === "null") return null;
                return c;
              })()
            : null;

        // Forzar aterrizaje en /auth/confirm (token_hash), no depender solo
        // de Site URL / plantilla de Supabase.
        const origin = typeof window !== "undefined" ? window.location.origin : "";
        const { data, error } = await supabase.auth.signUp({
          email: emailNorm,
          password: passwordNorm,
          options: {
            emailRedirectTo: origin ? `${origin}${CONFIRM_EMAIL_PATH}` : undefined,
            data: {
              full_name: authName.trim(),
              role: selectedRole,
              coach_id: resolvedCoachId,
            },
          },
        });
        if (error) {
          console.error("Error en registro:", error);
          setAuthError(userFacingError(error, "No se pudo crear la cuenta."));
          return;
        }

        // Correo YA registrado: con la confirmacion activada, Supabase no da un
        // error (para no revelar quien esta registrado) y devuelve un usuario
        // falso con identities vacio. Sin este aviso el tester cree que acaba de
        // crear la cuenta con la contraseña que escribió, cuando en realidad la
        // contraseña sigue siendo la de su registro original: de ahi el bucle de
        // "me registro otra vez y tampoco entro".
        if (Array.isArray(data?.user?.identities) && data.user.identities.length === 0) {
          setAuthMode("login");
          setAuthLandingStep("login");
          setAuthCanResend(true);
          setAuthError(
            "Ese correo ya tiene una cuenta. Si nunca confirmaste el correo, reenvíate la confirmación aquí abajo. " +
            "Y ojo: registrarte de nuevo NO cambia la contraseña; si no la recuerdas, usa «¿Olvidaste tu contraseña?».",
          );
          return;
        }

        const newUserId = data?.user?.id;
        if (!newUserId) {
          if (typeof localStorage !== "undefined") {
            localStorage.removeItem("raf_athlete_profile_tab");
            localStorage.removeItem("raf_athlete_nav_tab");
            localStorage.removeItem("raf_tab_atletas");
            localStorage.removeItem("raf_tab_entrenamientos");
            localStorage.removeItem("raf_tab_biblioteca");
            localStorage.removeItem("raf_tab_crear_workout");
            localStorage.removeItem("raf_athlete_progress_tab");
            localStorage.removeItem("raf_lastView");
          }
          setAuthInfo(
            `Cuenta creada. Te enviamos un correo de confirmación a ${emailNorm}: ábrelo antes de iniciar sesión ` +
            "(mira también la carpeta de spam).",
          );
          setAuthCanResend(true);
          setAuthMode("login");
          setAuthLandingStep("login");
          return;
        }

        /**
         * Atleta sin código de coach: null explícito.
         * Nunca persistir el propio user_id como coach_id (resolvedCoachId || null no aplica aquí).
         */
        const athleteCoachIdNeverSelf =
          selectedRole !== "athlete" || !resolvedCoachId || String(resolvedCoachId) === String(newUserId) ? null : resolvedCoachId;

        const roleForProfile = authRole === "coach" ? "coach" : "athlete";
        // Con confirmacion de correo activa, signUp a menudo NO deja sesion.
        // Si hay access_token, creamos el perfil ya; si no, lo deja pending
        // para ConfirmEmailScreen / primer login (ensureOwnProfile).
        const signupToken = data?.session?.access_token || null;
        if (signupToken) {
          const created = await ensureOwnProfile({
            name: authName.trim(),
            role: roleForProfile,
            coach_id: athleteCoachIdNeverSelf,
            accessToken: signupToken,
          });
          if (!created.ok) {
            console.error("create-profile API:", created.reason);
            setAuthError(
              created.reason
                ? `Cuenta creada, pero no se guardó tu nombre: ${created.reason}. Completa tu perfil al entrar.`
                : "Cuenta creada, pero no se pudo guardar el perfil. Completa tu nombre al entrar.",
            );
          }
        } else {
          try {
            localStorage.setItem(
              "raf_pending_profile",
              JSON.stringify({
                name: authName.trim(),
                role: roleForProfile,
                coach_id: athleteCoachIdNeverSelf,
              }),
            );
          } catch {
            /* ignore */
          }
        }
        if (roleForProfile === "athlete") {
          setProfile({ user_id: newUserId, role: "athlete", name: authName.trim(), coach_id: athleteCoachIdNeverSelf });
        }
        await syncFcmTokenToProfile();

        if (roleForProfile === "coach" || authRole === "admin") {
          const cpPayload = {
            user_id: newUserId,
            full_name: authName.trim(),
            email: emailNorm,
            trial_start: new Date().toISOString(),
            trial_days: 10,
            subscription_status: "trial",
            approved_by_admin: false,
            registered_at: new Date().toISOString(),
          };
          const { error: cpErr } = await supabase.from("coach_profiles").insert(cpPayload);
          if (cpErr) console.error("Error creando coach_profiles en registro:", cpErr);
          // Si es invitacion de staff, registrar en coach_staff
          // Leer el parametro coach directamente de la URL para evitar problemas de timing/closure
          let parentCoachForStaff = inviteParentCoachId;
          try {
            if (typeof window !== "undefined") {
              const urlCoach = new URLSearchParams(window.location.search).get("coach");
              const urlType = new URLSearchParams(window.location.search).get("type");
              if (urlType === "staff" && urlCoach) parentCoachForStaff = urlCoach.trim();
            }
          } catch (_) {}
          if (parentCoachForStaff && newUserId && parentCoachForStaff !== newUserId) {
            const { error: csErr } = await supabase.from("coach_staff").insert({
              coach_id: parentCoachForStaff,
              staff_id: newUserId,
              billing_type: "included",
            });
            if (csErr) console.error("Error vinculando staff a coach principal:", csErr);
            else console.log("Staff vinculado al coach principal:", parentCoachForStaff);
          }
        }

        if (roleForProfile === "athlete" && pendingCoachRequestId) {
          setPendingCoachRequestId("");
        }

        if (inviteRow) {
          // accept_invitation_by_code exige sesion + email (0064). Sin JWT en
          // el registro se guarda el codigo y se acepta al confirmar / entrar.
          stashPendingInviteCode(inviteCodeFromUrl);
          if (signupToken) {
            const acc = await acceptPendingInvitationIfAny();
            if (!acc.ok && !acc.keep) {
              console.warn("No se pudo marcar la invitación como aceptada:", acc.reason);
            }
          }
          setInviteCodeFromUrl("");
          if (typeof window !== "undefined") {
            window.history.replaceState({}, "", "/");
          }
        }

        if (typeof localStorage !== "undefined") {
          localStorage.removeItem("raf_athlete_profile_tab");
          localStorage.removeItem("raf_athlete_nav_tab");
          localStorage.removeItem("raf_tab_atletas");
          localStorage.removeItem("raf_tab_entrenamientos");
          localStorage.removeItem("raf_tab_biblioteca");
          localStorage.removeItem("raf_tab_crear_workout");
          localStorage.removeItem("raf_athlete_progress_tab");
          localStorage.removeItem("raf_lastView");
        }
        setAuthInfo(
          `Cuenta creada. Te enviamos un correo de confirmación a ${emailNorm}: ábrelo antes de iniciar sesión ` +
          "(mira también la carpeta de spam).",
        );
        setAuthCanResend(true);
        setAuthMode("login");
        setAuthLandingStep("login");
        setAuthRole("");
        setAuthName("");
        setAuthCoachCode("");
      }
    } finally {
      setAuthSubmitting(false);
    }
  };

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
    setLandingAuthOpen(false);
    setDemoModalOpen(false);
    setAuthMode("login");
    setAuthLandingStep("choice");
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
      // Con sesion aterriza en la app (toast); sin sesion, en el login (aviso verde).
      notify(successMsg);
      setAuthError("");
      setAuthInfo(successMsg);
      setAuthMode("login");
      setAuthLandingStep("login");
      setLandingAuthOpen(true);
    }
  };

  const handleForgotPasswordClick = async () => {
    const email = authEmail.trim().toLowerCase();
    setAuthInfo("");
    setAuthCanResend(false);
    if (!email) {
      setAuthError("Escribe el correo de tu cuenta y vuelve a pulsar «¿Olvidaste tu contraseña?».");
      return;
    }
    const origin = typeof window !== "undefined" ? window.location.origin : "";
    // El ?type=recovery viaja de vuelta en el enlace y hace que la pantalla de
    // nueva contraseña se muestre aunque el hash con los tokens ya se haya
    // consumido (o el navegador lo pierda).
    const { error } = await supabase.auth.resetPasswordForEmail(email, {
      redirectTo: origin ? `${origin}/?type=recovery` : undefined,
    });
    if (error) {
      setAuthError(userFacingError(error, "No se pudo enviar el correo de recuperación. Inténtalo de nuevo."));
      return;
    }
    setAuthError("");
    setAuthInfo(
      `Si ${email} está registrado, te llegará un enlace para elegir una contraseña nueva. Ábrelo y escribe la contraseña ahí mismo.`
    );
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

    const rawPlan = String(profile?.subscription_plan || athletes?.find((a) => a.plan)?.plan || "Basico").toLowerCase();
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
    if (landingAuthOpen) {
      const inputBase = {
        width: "100%",
        background: "#ffffff",
        border: "1px solid #e2e8f0",
        borderRadius: 8,
        padding: "10px 12px",
        color: "#0f172a",
        fontFamily: "inherit",
        fontSize: ".85em",
        outline: "none",
        boxSizing: "border-box",
      };
      const bigBtn = {
        width: "100%",
        padding: "14px 18px",
        borderRadius: 12,
        border: "none",
        fontFamily: "inherit",
        fontWeight: 800,
        fontSize: ".95em",
        cursor: "pointer",
      };

      return (
        <div style={S.root}>
          <main style={{ ...S.page, display: "flex", alignItems: "center", justifyContent: "center", width: "100%", minHeight: "70vh", padding: "20px 16px" }}>
            {authLandingStep === "choice" ? (
              <div style={{ ...S.card, width: "100%", maxWidth: 440, padding: "32px 28px 36px" }}>
                <div style={{ display: "flex", alignItems: "center", justifyContent: "center", gap: 12, marginBottom: 22 }}>
                  <img
                    src="/pwa-192.png"
                    alt=""
                    width={48}
                    height={48}
                    style={{ width: 48, height: 48, borderRadius: 12, objectFit: "cover", flexShrink: 0 }}
                  />
                  <div style={{ fontSize: "1.35em", fontWeight: 900, letterSpacing: ".04em", color: "#0f172a" }}>
                    RUNNING<span style={{ color: "#ff8a3d" }}>APEX</span>FLOW
                  </div>
                </div>
                <h1 style={{ ...S.pageTitle, fontSize: "1.45em", textAlign: "center", marginBottom: 10, lineHeight: 1.25 }}>
                  Bienvenido a {BRAND_NAME}
                </h1>
                <p style={{ textAlign: "center", color: "#64748b", fontSize: ".9em", lineHeight: 1.5, marginBottom: 28 }}>
                  Entrena con datos, IA y seguimiento real. Elige cómo quieres continuar.
                </p>
                <div style={{ display: "flex", flexDirection: "column", gap: 14 }}>
                  <button
                    type="button"
                    onClick={(e) => {
                      e.preventDefault();
                      e.stopPropagation();
                      setAuthError("");
                      setAuthMode("login");
                      setAuthLandingStep("login");
                      setLandingAuthOpen(true);
                    }}
                    style={{
                      ...bigBtn,
                      background: "linear-gradient(135deg,#0f172a,#334155)",
                      color: "#fff",
                      boxShadow: "0 8px 24px rgba(15,23,42,.2)",
                    }}
                  >
                    Iniciar sesión
                  </button>
                  <button
                    type="button"
                    onClick={(e) => {
                      e.preventDefault();
                      e.stopPropagation();
                      setAuthError("");
                      setAuthMode("register");
                      setAuthLandingStep("register");
                      setLandingAuthOpen(true);
                    }}
                    style={{
                      ...bigBtn,
                      background: "linear-gradient(135deg,#e86f28,#ff8a3d)",
                      color: "#fff",
                      boxShadow: "0 8px 24px rgba(255,138,61,.25)",
                    }}
                  >
                    Registrarse
                  </button>
                </div>
              </div>
            ) : authLandingStep === "login" ? (
              <div style={{ ...S.card, width: "100%", maxWidth: 400, padding: "28px 24px 32px" }}>
                <h1 style={{ ...S.pageTitle, fontSize: "1.25em", marginBottom: 18 }}>Iniciar sesión</h1>
                {authInfo ? (
                  <div style={{ marginBottom: 14, background: "rgba(34,197,94,.12)", border: "1px solid rgba(34,197,94,.4)", color: "#166534", borderRadius: 8, padding: "10px 12px", fontSize: ".8em", fontWeight: 700, lineHeight: 1.45 }}>
                    {authInfo}
                  </div>
                ) : null}
                {authError ? (
                  <div style={{ marginBottom: 12, background: "rgba(220,38,38,.08)", border: "1px solid rgba(220,38,38,.35)", color: "#991b1b", borderRadius: 8, padding: "10px 12px", fontSize: ".78em", fontWeight: 600, lineHeight: 1.5 }}>
                    {authError}
                  </div>
                ) : null}
                {authCanResend ? (
                  <button
                    type="button"
                    onClick={handleResendConfirmation}
                    disabled={authResending}
                    style={{
                      width: "100%",
                      marginBottom: 14,
                      padding: "10px 12px",
                      borderRadius: 10,
                      border: "1px solid rgba(148,163,184,.5)",
                      background: authResending ? "#f1f5f9" : "#fff",
                      color: "#0f172a",
                      cursor: authResending ? "not-allowed" : "pointer",
                      fontFamily: "inherit",
                      fontWeight: 800,
                      fontSize: ".8em",
                    }}
                  >
                    {authResending ? "Enviando…" : "Reenviar correo de confirmación"}
                  </button>
                ) : null}
                <form onSubmit={handleAuthSubmit}>
                  <div style={{ marginBottom: 12 }}>
                    <div style={{ fontSize: ".72em", color: "#64748b", marginBottom: 6, fontWeight: 600 }}>Correo</div>
                    <input
                      type="email"
                      value={authEmail}
                      onChange={(e) => {
                        setAuthEmail(e.target.value);
                        if (authError) setAuthError("");
                        if (authInfo) setAuthInfo("");
                        if (authCanResend) setAuthCanResend(false);
                      }}
                      placeholder="correo@ejemplo.com"
                      autoComplete="email"
                      style={inputBase}
                    />
                  </div>
                  <div style={{ marginBottom: 14 }}>
                    <div style={{ fontSize: ".72em", color: "#64748b", marginBottom: 6, fontWeight: 600 }}>Contraseña</div>
                    <input
                      type="password"
                      value={authPassword}
                      onChange={(e) => {
                        setAuthPassword(e.target.value);
                        if (authError) setAuthError("");
                      }}
                      placeholder="••••••••"
                      autoComplete="current-password"
                      style={inputBase}
                    />
                  </div>
                  <button
                    type="submit"
                    disabled={authSubmitting}
                    style={{
                      width: "100%",
                      ...bigBtn,
                      marginBottom: 12,
                      background: authSubmitting ? "#e2e8f0" : "linear-gradient(135deg,#e86f28,#ff8a3d)",
                      color: authSubmitting ? "#334155" : "white",
                      cursor: authSubmitting ? "not-allowed" : "pointer",
                    }}
                  >
                    {authSubmitting ? "Procesando…" : "Iniciar sesión"}
                  </button>
                </form>
                <div style={{ display: "flex", flexDirection: "column", gap: 10, alignItems: "center" }}>
                  <button
                    type="button"
                    onClick={() => {
                      setAuthError("");
                      setAuthMode("register");
                      setAuthLandingStep("register");
                    }}
                    style={{ background: "none", border: "none", color: "#3b82f6", cursor: "pointer", fontFamily: "inherit", fontSize: ".82em", fontWeight: 600, textDecoration: "underline" }}
                  >
                    ¿No tienes cuenta? Regístrate
                  </button>
                  <button
                    type="button"
                    onClick={handleForgotPasswordClick}
                    style={{ background: "none", border: "none", color: "#64748b", cursor: "pointer", fontFamily: "inherit", fontSize: ".8em", fontWeight: 600, textDecoration: "underline" }}
                  >
                    ¿Olvidaste tu contraseña?
                  </button>
                  <button
                    type="button"
                    onClick={() => setAuthLandingStep("choice")}
                    style={{ background: "none", border: "none", color: "#94a3b8", cursor: "pointer", fontFamily: "inherit", fontSize: ".78em", marginTop: 4 }}
                  >
                    ← Volver
                  </button>
                </div>
              </div>
            ) : (
              <div style={{ ...S.card, width: "100%", maxWidth: 420, padding: "28px 24px 32px" }}>
                <h1 style={{ ...S.pageTitle, fontSize: "1.25em", marginBottom: 18 }}>Crear cuenta</h1>
                <form onSubmit={handleAuthSubmit}>
                  <div style={{ marginBottom: 12 }}>
                    <div style={{ fontSize: ".72em", color: "#64748b", marginBottom: 6, fontWeight: 600 }}>Nombre completo</div>
                    <input
                      type="text"
                      value={authName}
                      onChange={(e) => setAuthName(e.target.value)}
                      placeholder="Tu nombre completo"
                      style={inputBase}
                    />
                  </div>
                  <div style={{ marginBottom: 12 }}>
                    <div style={{ fontSize: ".72em", color: "#64748b", marginBottom: 6, fontWeight: 600 }}>Rol</div>
                    <div style={{ display: "flex", gap: 8 }}>
                      <button
                        type="button"
                        onClick={() => setAuthRole("coach")}
                        style={{
                          flex: 1,
                          padding: "10px 12px",
                          borderRadius: 10,
                          border: authRole === "coach" ? "2px solid #ff8a3d" : "1px solid rgba(148,163,184,.4)",
                          background: authRole === "coach" ? "rgba(255,138,61,.15)" : "#f1f5f9",
                          color: "#0f172a",
                          cursor: "pointer",
                          fontFamily: "inherit",
                          fontWeight: 800,
                          fontSize: ".8em",
                        }}
                      >
                        Coach
                      </button>
                      <button
                        type="button"
                        onClick={() => setAuthRole("athlete")}
                        style={{
                          flex: 1,
                          padding: "10px 12px",
                          borderRadius: 10,
                          border: authRole === "athlete" ? "2px solid #3b82f6" : "1px solid rgba(148,163,184,.4)",
                          background: authRole === "athlete" ? "rgba(59,130,246,.15)" : "#f1f5f9",
                          color: "#0f172a",
                          cursor: "pointer",
                          fontFamily: "inherit",
                          fontWeight: 800,
                          fontSize: ".8em",
                        }}
                      >
                        Atleta
                      </button>
                    </div>
                  </div>
                  {authRole === "athlete" && (
                    <div style={{ marginBottom: 12 }}>
                      <div style={{ fontSize: ".72em", color: "#64748b", marginBottom: 6, fontWeight: 600 }}>Código de coach (Opcional)</div>
                      <input
                        type="text"
                        value={authCoachCode}
                        onChange={(e) => {
                          setAuthCoachCode(e.target.value.toUpperCase());
                          if (authError) setAuthError("");
                        }}
                        placeholder="Ej: B5C9E44A"
                        style={inputBase}
                      />
                      {inviteCodeFromUrl ? (
                        <div style={{ marginTop: 6, fontSize: ".7em", color: "#b45309", fontWeight: 700 }}>
                          Invitación detectada por link: se priorizará esa vinculación.
                        </div>
                      ) : null}
                    </div>
                  )}
                  <div style={{ marginBottom: 12 }}>
                    <div style={{ fontSize: ".72em", color: "#64748b", marginBottom: 6, fontWeight: 600 }}>Correo</div>
                    <input
                      type="email"
                      value={authEmail}
                      onChange={(e) => {
                        setAuthEmail(e.target.value);
                        if (authError) setAuthError("");
                      }}
                      placeholder="correo@ejemplo.com"
                      autoComplete="email"
                      style={inputBase}
                    />
                    {authError ? <div style={{ marginTop: 6, fontSize: ".74em", color: "#dc2626", fontWeight: 600 }}>{authError}</div> : null}
                  </div>
                  <div style={{ marginBottom: 16 }}>
                    <div style={{ fontSize: ".72em", color: "#64748b", marginBottom: 6, fontWeight: 600 }}>Contraseña</div>
                    <input
                      type="password"
                      value={authPassword}
                      onChange={(e) => setAuthPassword(e.target.value)}
                      placeholder="••••••••"
                      autoComplete="new-password"
                      style={inputBase}
                    />
                  </div>
                  <button
                    type="submit"
                    disabled={authSubmitting}
                    style={{
                      width: "100%",
                      ...bigBtn,
                      background: authSubmitting ? "#e2e8f0" : "linear-gradient(135deg,#e86f28,#ff8a3d)",
                      color: authSubmitting ? "#334155" : "white",
                      cursor: authSubmitting ? "not-allowed" : "pointer",
                    }}
                  >
                    {authSubmitting
                      ? "Procesando…"
                      : authRole === "athlete"
                        ? "Crear cuenta como Atleta"
                        : authRole === "coach"
                          ? "Crear cuenta como Coach"
                          : "Crear cuenta"}
                  </button>
                </form>
                <div style={{ display: "flex", flexDirection: "column", gap: 10, alignItems: "center", marginTop: 14 }}>
                  <button
                    type="button"
                    onClick={() => {
                      setAuthError("");
                      setAuthMode("login");
                      setAuthLandingStep("login");
                    }}
                    style={{ background: "none", border: "none", color: "#3b82f6", cursor: "pointer", fontFamily: "inherit", fontSize: ".82em", fontWeight: 600, textDecoration: "underline" }}
                  >
                    ¿Ya tienes cuenta? Inicia sesión
                  </button>
                  <button
                    type="button"
                    onClick={() => setAuthLandingStep("choice")}
                    style={{ background: "none", border: "none", color: "#94a3b8", cursor: "pointer", fontFamily: "inherit", fontSize: ".78em" }}
                  >
                    ← Volver
                  </button>
                </div>
              </div>
            )}
          </main>
        </div>
      );
    }

    return (
      <div style={{ ...S.root, background: "linear-gradient(165deg,#0d1f38 0%,#12294a 45%,#0d1f38 100%)", minHeight: "100vh" }}>
        <main style={{ ...S.page, width: "100%", display: "flex", flexDirection: "column", minHeight: "100vh", background: "transparent" }}>
          <header
            style={{
              display: "flex",
              alignItems: "center",
              justifyContent: "space-between",
              gap: 16,
              flexWrap: "wrap",
              marginBottom: 8,
              paddingBottom: 16,
              borderBottom: "1px solid rgba(23,198,163,.22)",
            }}
          >
            <div style={{ display: "flex", alignItems: "center", gap: 10 }}>
              <img
                src="/pwa-192.png"
                alt=""
                width={40}
                height={40}
                style={{ width: 40, height: 40, borderRadius: 10, objectFit: "cover", flexShrink: 0 }}
              />
              <div style={{ fontSize: "1.2em", fontWeight: 900, letterSpacing: ".04em", color: "#f8fafc" }}>
                RUNNING<span style={{ color: "#ff8a3d" }}>APEX</span>FLOW
              </div>
            </div>
            <div style={{ display: "flex", gap: 10, flexWrap: "wrap" }}>
            <button
              type="button"
              onClick={() => {
                setAuthError("");
                setAuthMode("login");
                setAuthLandingStep("login");
                setLandingAuthOpen(true);
              }}
              style={{
                padding: "10px 18px",
                borderRadius: 10,
                border: "1px solid rgba(255,255,255,.18)",
                background: "rgba(255,255,255,.06)",
                color: "#f8fafc",
                fontWeight: 800,
                fontSize: ".85em",
                cursor: "pointer",
                fontFamily: "inherit",
              }}
            >
              Iniciar sesión
            </button>
            <button
              type="button"
              onClick={() => {
                setAuthError("");
                setAuthMode("register");
                setAuthRole("athlete");
                setAuthLandingStep("register");
                setLandingAuthOpen(true);
              }}
              style={{
                padding: "10px 18px",
                borderRadius: 10,
                border: "none",
                background: "linear-gradient(135deg,#e86f28,#ff8a3d)",
                color: "#fff",
                fontWeight: 800,
                fontSize: ".85em",
                cursor: "pointer",
                fontFamily: "inherit",
                boxShadow: "0 8px 22px rgba(255,138,61,.35)",
              }}
            >
              Crear cuenta gratis
            </button>
            </div>
          </header>

          <div
            style={{
              marginTop: 8,
              marginBottom: 32,
              padding: "32px 0 8px",
              textAlign: "center",
              maxWidth: 720,
              marginLeft: "auto",
              marginRight: "auto",
            }}
          >
            <div style={{ fontSize: "0.78em", color: "#17c6a3", letterSpacing: ".12em", textTransform: "uppercase", fontWeight: 800, marginBottom: 10 }}>
              Plataforma de coaching para runners
            </div>
            <h1 style={{ fontSize: "clamp(1.75rem, 4vw, 2.45rem)", fontWeight: 900, color: "#f8fafc", margin: "0 0 14px", lineHeight: 1.15 }}>
              Entrena con datos. Mejora con inteligencia.
            </h1>
            <p style={{ color: "rgba(248,250,252,.72)", fontSize: "1.05em", margin: "0 0 26px", lineHeight: 1.6 }}>
              {BRAND_NAME} conecta coaches y atletas con IA, evaluaciones VDOT, zonas de FC y sincronización con tu reloj para llevar el rendimiento al siguiente nivel.
            </p>
            <div style={{ display: "flex", gap: 12, justifyContent: "center", flexWrap: "wrap" }}>
              <button
                type="button"
                onClick={() => {
                  setAuthError("");
                  setAuthMode("register");
                  setAuthRole("athlete");
                  setAuthLandingStep("register");
                  setLandingAuthOpen(true);
                }}
                style={{
                  background: "linear-gradient(135deg,#e86f28,#ff8a3d)",
                  border: "none",
                  borderRadius: 12,
                  padding: "14px 28px",
                  color: "white",
                  cursor: "pointer",
                  fontFamily: "inherit",
                  fontWeight: 800,
                  fontSize: "1em",
                  boxShadow: "0 8px 24px rgba(255,138,61,.35)",
                }}
              >
                Crear cuenta gratis
              </button>
              <button
                type="button"
                onClick={() => {
                  setAuthError("");
                  setAuthMode("login");
                  setAuthLandingStep("login");
                  setLandingAuthOpen(true);
                }}
                style={{
                  background: "rgba(255,255,255,.06)",
                  border: "1px solid rgba(23,198,163,.45)",
                  borderRadius: 12,
                  padding: "14px 28px",
                  color: "#f8fafc",
                  cursor: "pointer",
                  fontFamily: "inherit",
                  fontWeight: 800,
                  fontSize: "1em",
                }}
              >
                Iniciar sesión
              </button>
            </div>
          </div>

          <section style={{ marginBottom: 44, maxWidth: 1100, marginLeft: "auto", marginRight: "auto", width: "100%", padding: "0 4px" }}>
            <div style={{ fontSize: ".72em", letterSpacing: ".14em", color: "#17c6a3", textTransform: "uppercase", marginBottom: 16, fontWeight: 800 }}>
              Características
            </div>
            <div style={{ display: "grid", gridTemplateColumns: "repeat(auto-fill, minmax(260px, 1fr))", gap: 16 }}>
              {[
                {
                  title: "Evaluación VDOT",
                  body: "Calcula VDOT, ritmos y zonas FC con 3 métodos: carrera reciente, test Cooper o umbral.",
                },
                {
                  title: "Workouts con IA",
                  body: "Genera sesiones personalizadas en segundos basadas en el VDOT y objetivos del atleta.",
                },
                {
                  title: "Plan flexible",
                  body: "Planes de 2 semanas renovables con 3, 4 o 5 sesiones semanales según la disponibilidad del atleta.",
                },
                {
                  title: "Análisis IA",
                  body: "Seguimiento inteligente del rendimiento con ajuste automático de entrenamientos para mejores resultados.",
                },
                {
                  title: "Sincronización",
                  body: "Conecta tu reloj Garmin o COROS para recibir los entrenamientos y sincronizar tus actividades automáticamente.",
                },
                {
                  title: "Chat en tiempo real",
                  body: "Comunicación directa coach-atleta con notificaciones push dentro de la plataforma.",
                },
              ].map((f) => (
                <div
                  key={f.title}
                  style={{
                    border: "1px solid rgba(23,198,163,.22)",
                    borderRadius: 14,
                    padding: "18px 16px",
                    background: "rgba(255,255,255,.05)",
                    boxShadow: "0 8px 24px rgba(0,0,0,.18)",
                    textAlign: "left",
                  }}
                >
                  <div style={{ fontWeight: 800, color: "#f8fafc", fontSize: ".98em", marginBottom: 8 }}>{f.title}</div>
                  <div style={{ color: "rgba(248,250,252,.68)", fontSize: ".88em", lineHeight: 1.5 }}>{f.body}</div>
                </div>
              ))}
            </div>
          </section>

          <section style={{ marginBottom: 48, maxWidth: 1100, marginLeft: "auto", marginRight: "auto", width: "100%", padding: "0 4px" }}>
            <div style={{ fontSize: ".72em", letterSpacing: ".14em", color: "#17c6a3", textTransform: "uppercase", marginBottom: 16, fontWeight: 800 }}>
              Coaches y atletas
            </div>
            <div style={{ display: "grid", gridTemplateColumns: "repeat(auto-fit, minmax(280px, 1fr))", gap: 16 }}>
              <div
                style={{
                  border: "1px solid rgba(255,138,61,.35)",
                  borderRadius: 14,
                  padding: "20px 18px",
                  background: "linear-gradient(145deg,rgba(255,138,61,.14),rgba(18,41,74,.9))",
                  textAlign: "left",
                }}
              >
                <div style={{ fontWeight: 900, color: "#ff8a3d", fontSize: "1.1em", marginBottom: 8 }}>Coach</div>
                <div style={{ fontSize: ".82em", fontWeight: 700, color: "#f8fafc", marginBottom: 12 }}>7 días de prueba gratis</div>
                <ul style={{ margin: 0, paddingLeft: 18, color: "rgba(248,250,252,.7)", fontSize: ".88em", lineHeight: 1.55 }}>
                  <li>Panel en vivo</li>
                  <li>Biblioteca de workouts</li>
                  <li>Evaluación VDOT</li>
                  <li>Generación IA</li>
                  <li>Chat con atletas</li>
                </ul>
              </div>
              <div
                style={{
                  border: "1px solid rgba(23,198,163,.35)",
                  borderRadius: 14,
                  padding: "20px 18px",
                  background: "linear-gradient(145deg,rgba(23,198,163,.12),rgba(18,41,74,.9))",
                  textAlign: "left",
                }}
              >
                <div style={{ fontWeight: 900, color: "#17c6a3", fontSize: "1.1em", marginBottom: 8 }}>Atleta</div>
                <div style={{ fontSize: ".82em", fontWeight: 700, color: "#f8fafc", marginBottom: 12 }}>Plan Premium disponible</div>
                <ul style={{ margin: 0, paddingLeft: 18, color: "rgba(248,250,252,.7)", fontSize: ".88em", lineHeight: 1.55 }}>
                  <li>Calendario personalizado</li>
                  <li>Evaluación VDOT propia</li>
                  <li>Análisis IA de rendimiento</li>
                  <li>Historial de evaluaciones</li>
                  <li>Logros avanzados</li>
                </ul>
              </div>
            </div>
          </section>

          <footer style={{ marginTop: "auto", paddingTop: 22, borderTop: "1px solid rgba(23,198,163,.22)", color: "rgba(248,250,252,.55)", fontSize: ".85em" }}>
            <div style={{ display: "flex", alignItems: "center", justifyContent: "space-between", gap: 12, flexWrap: "wrap" }}>
              <div style={{ display: "flex", alignItems: "center", gap: 8, color: "#f8fafc", fontWeight: 900 }}>
                <img src="/pwa-192.png" alt="" width={22} height={22} style={{ width: 22, height: 22, borderRadius: 6, objectFit: "cover" }} />
                {BRAND_NAME}
              </div>
              <div>© 2026</div>
            </div>
          </footer>
        </main>

        {demoModalOpen && (
          <div style={{ position: "fixed", inset: 0, background: "rgba(15,23,42,0.45)", display: "flex", alignItems: "center", justifyContent: "center", zIndex: 300, padding: 16 }}>
            <div style={{ ...S.card, width: "100%", maxWidth: 520, margin: 0 }}>
              <div style={{ fontSize: "1.05em", fontWeight: 900, marginBottom: 6 }}>Demo simulada</div>
              <div style={{ color: "#94a3b8", fontSize: ".9em", marginBottom: 14 }}>
                En esta demo verás cómo, con {BRAND_NAME}, un coach crea entrenamientos con IA, los asigna al atleta y marca progreso en el calendario.
              </div>
              <div style={{ display: "flex", gap: 10, justifyContent: "flex-end" }}>
                <button
                  type="button"
                  onClick={() => setDemoModalOpen(false)}
                  style={{ background: "#f8fafc", border: "1px solid #e2e8f0", borderRadius: 8, padding: "8px 14px", color: "#94a3b8", cursor: "pointer", fontFamily: "inherit", fontWeight: 900, fontSize: ".82em" }}
                >
                  Cerrar
                </button>
              </div>
            </div>
          </div>
        )}
      </div>
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
            coachUserId={session?.user?.id ?? null}
            onSelect={(a) => {
              setSelectedAthlete(a);
              setView("athletes");
              setShowAddAthleteForm(false);
            }}
            onRequestAddAthlete={() => { setLastInviteLink(""); setInviteModalOpen(true); }}
            showAddAthleteForm={showAddAthleteForm}
            planLimitWarning={planLimitWarning}
            onGoToPlans={() => setView("plans")}
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
                normalizeWorkoutRow={normalizeWorkoutRow}
              />
            )}
          </>
        )}
        {view === "plans" && <Plans athletes={athletes} notify={notify} />}
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
                coachPlan={String(profile?.subscription_plan || athletes?.find((a) => a.plan)?.plan || "Basico")}
                profileRole={profile?.role ?? ""}
                onGoToPlans={() => setView("plans")}
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
                coachPlan={String(profile?.subscription_plan || athletes?.find((a) => a.plan)?.plan || "Basico")}
                profileRole={profile?.role ?? ""}
                onGoToPlans={() => setView("plans")}
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
                onClick={() => {
                  setCoachPlanPickerVoluntary(false);
                }}
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
            <p style={{ textAlign: "center", color: "#64748b", fontSize: ".95em", maxWidth: 560, margin: "0 auto 28px", lineHeight: 1.45 }}>
              Comienza a transformar el rendimiento de tus atletas
            </p>

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
                        const selected = selectedPlan && coachPickerPeriod === per.id;
                        const priceLine =
                          per.id === "monthly"
                            ? `$${formatCopInt(amount)} COP/mes`
                            : `$${formatCopInt(amount)} COP`;
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
                              <div style={{ fontSize: ".82em", color: "#64748b", marginTop: 4 }}>{priceLine}</div>
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

function Dashboard({
  coachUserId,
  onSelect,
  onRequestAddAthlete,
  showAddAthleteForm,
  planLimitWarning,
  onGoToPlans,
  onDismissPlanLimitWarning,
  newAthlete,
  onChangeNewAthleteField,
  onSaveNewAthlete,
  onCancelAddAthlete,
}) {
  const S = styles;
  const weekStart = useMemo(() => startOfWeekMonday(new Date()), []);
  const weekEnd = useMemo(() => addDays(weekStart, 6), [weekStart]);
  const weekRangeLabel = useMemo(() => {
    const opt = { day: "numeric", month: "long", year: "numeric" };
    return `Semana del ${weekStart.toLocaleDateString("es", opt)} al ${weekEnd.toLocaleDateString("es", opt)}`;
  }, [weekStart, weekEnd]);

  const [dashAthletes, setDashAthletes] = useState([]);
  const [weekWorkouts, setWeekWorkouts] = useState([]);
  const [dashLoading, setDashLoading] = useState(true);

  const loadDashboardData = useCallback(async (silent) => {
    if (!coachUserId) {
      setDashAthletes([]);
      setWeekWorkouts([]);
      setDashLoading(false);
      return;
    }
    if (!silent) setDashLoading(true);
    const ws = formatLocalYMD(weekStart);
    const we = formatLocalYMD(weekEnd);
    // Get staff IDs for this coach
    const { data: staffRows } = await supabase.from("coach_staff").select("staff_id").eq("coach_id", coachUserId);
    const staffIds = (staffRows || []).map((s) => s.staff_id);
    const allCoachIds = [coachUserId, ...staffIds];

    const [aRes, wRes] = await Promise.all([
      supabase.from("athletes").select("*").in("coach_id", allCoachIds).order("id", { ascending: true }),
      supabase.from("workouts").select("*").in("coach_id", allCoachIds).gte("scheduled_date", ws).lte("scheduled_date", we),
    ]);
    if (aRes.error) console.error("Dashboard athletes:", aRes.error);
    else setDashAthletes((aRes.data || []).map(normalizeAthlete));
    if (wRes.error) console.error("Dashboard workouts:", wRes.error);
    else setWeekWorkouts((wRes.data || []).map(normalizeWorkoutRow));
    if (!silent) setDashLoading(false);
  }, [coachUserId, weekStart, weekEnd]);

  useEffect(() => {
    loadDashboardData(false);
  }, [loadDashboardData]);

  // athletes/workouts NO estan en supabase_realtime (solo messages). Una
  // suscripcion aqui era ruido: el canal "ok" no traia eventos. El dashboard
  // se actualiza al volver a la app (resume) y al montar/cambiar de semana.
  useAppResumeRefresh(() => {
    loadDashboardData(true);
  }, Boolean(coachUserId));

  // Km de la semana a partir de los workouts que ya estan cargados (misma
  // consulta de siempre), no del weekly_km declarado en la ficha del atleta.
  const weekKm = useMemo(() => sumWeekKm(weekWorkouts), [weekWorkouts]);

  const weekKmDonePct = weekKm.planned > 0 ? Math.round((weekKm.actual / weekKm.planned) * 100) : 0;

  const { weekWorkoutsTotal, weekWorkoutsDone, weekAvgRpe, weekRpeCount } = useMemo(() => {
    const total = weekWorkouts.length;
    const done = weekWorkouts.filter((w) => w.done).length;
    const rpeVals = weekWorkouts.filter((w) => w.done && w.rpe != null).map((w) => w.rpe);
    const avgRpe = rpeVals.length ? rpeVals.reduce((a, b) => a + b, 0) / rpeVals.length : null;
    return { weekWorkoutsTotal: total, weekWorkoutsDone: done, weekAvgRpe: avgRpe, weekRpeCount: rpeVals.length };
  }, [weekWorkouts]);

  const globalAdherencePct = weekWorkoutsTotal > 0
    ? Math.round((weekWorkoutsDone / weekWorkoutsTotal) * 100)
    : 0;

  const athleteRows = useMemo(() => {
    return dashAthletes.map((a) => {
      const forAthlete = weekWorkouts.filter((w) => String(w.athlete_id) === String(a.id));
      const weekTotal = forAthlete.length;
      const weekDone = forAthlete.filter((w) => w.done).length;
      const adherencePct = weekTotal > 0 ? Math.round((weekDone / weekTotal) * 100) : 0;
      const { name: raceName, daysLeft } = getRaceMeta(a.next_race);
      return { athlete: a, weekTotal, weekDone, adherencePct, raceName, daysLeft, km: sumWeekKm(forAthlete) };
    });
  }, [dashAthletes, weekWorkouts]);

  const maxWeeklyKm = useMemo(
    () => Math.max(1, ...athleteRows.map((r) => r.km.planned)),
    [athleteRows],
  );

  return (
    <div style={{ ...S.page, display: "flex", flexDirection: "column" }}>
      <div style={{ marginBottom: 28 }}>
        <div style={{ display: "flex", alignItems: "flex-start", justifyContent: "space-between", gap: 16 }}>
          <div>
            <h1 style={S.pageTitle}>Panel</h1>
            <p style={{ color: "#475569", fontSize: ".82em", marginTop: 4 }}>{weekRangeLabel} · datos en vivo</p>
          </div>
          <button
            onClick={onRequestAddAthlete}
            style={{
              background: "#f8fafc",
              border: "1px solid #e2e8f0",
              borderRadius: 10,
              padding: "10px 14px",
              color: "#0f172a",
              cursor: "pointer",
              fontFamily: "inherit",
              fontSize: ".85em",
              fontWeight: 700,
              whiteSpace: "nowrap",
            }}
          >
            ＋ Nuevo Atleta
          </button>
        </div>
      </div>

      {planLimitWarning ? (
        <div style={{ ...S.card, marginBottom: 16, border: "1px solid rgba(255,138,61,.4)", background: "#fffbeb" }}>
          <div style={{ color: "#92400e", fontSize: ".86em", fontWeight: 700, marginBottom: 10 }}>
            {planLimitWarning}
          </div>
          <div style={{ display: "flex", gap: 8, justifyContent: "flex-end", flexWrap: "wrap" }}>
            <button
              type="button"
              onClick={onDismissPlanLimitWarning}
              style={{ background: "#fff", border: "1px solid #e2e8f0", borderRadius: 8, padding: "8px 12px", color: "#64748b", fontWeight: 700, cursor: "pointer", fontFamily: "inherit", fontSize: ".8em" }}
            >
              Cerrar
            </button>
            <button
              type="button"
              onClick={onGoToPlans}
              style={{ background: "linear-gradient(135deg,#0d9488,#14b8a6)", border: "none", borderRadius: 8, padding: "8px 12px", color: "#fff", fontWeight: 800, cursor: "pointer", fontFamily: "inherit", fontSize: ".8em" }}
            >
              Ver Planes
            </button>
          </div>
        </div>
      ) : null}

      {!dashLoading && dashAthletes.length === 0 && !showAddAthleteForm ? (
        <div style={{ marginBottom: 20, borderRadius: 14, background: "linear-gradient(135deg,rgba(13,148,136,.07),rgba(20,184,166,.04))", border: "1px solid rgba(13,148,136,.25)", padding: "20px 22px" }}>
          <div style={{ fontWeight: 900, color: "#0f172a", fontSize: "1.05em", marginBottom: 6 }}>Bienvenido a RunningApexFlow</div>
          <div style={{ color: "#475569", fontSize: ".84em", marginBottom: 18 }}>Sigue estos pasos para comenzar a entrenar a tus atletas:</div>
          <div style={{ display: "flex", flexDirection: "column", gap: 12 }}>
            <div style={{ display: "flex", alignItems: "center", gap: 12 }}>
              <div style={{ width: 28, height: 28, borderRadius: 999, background: "#0d9488", color: "#fff", fontWeight: 900, fontSize: ".8em", display: "flex", alignItems: "center", justifyContent: "center", flexShrink: 0 }}>1</div>
              <div style={{ flex: 1 }}>
                <div style={{ fontWeight: 800, color: "#0f172a", fontSize: ".88em" }}>Cuenta creada</div>
                <div style={{ color: "#64748b", fontSize: ".78em" }}>Ya tienes acceso a todas las funciones durante 7 dias</div>
              </div>
              <span style={{ color: "#0d9488", fontWeight: 900 }}>Listo</span>
            </div>
            <div style={{ display: "flex", alignItems: "center", gap: 12 }}>
              <div style={{ width: 28, height: 28, borderRadius: 999, background: "#ff8a3d", color: "#fff", fontWeight: 900, fontSize: ".8em", display: "flex", alignItems: "center", justifyContent: "center", flexShrink: 0 }}>2</div>
              <div style={{ flex: 1 }}>
                <div style={{ fontWeight: 800, color: "#0f172a", fontSize: ".88em" }}>Agrega tu primer atleta</div>
                <div style={{ color: "#64748b", fontSize: ".78em" }}>Comparte tu codigo de coach o invitalo por email</div>
              </div>
              <button type="button" onClick={onRequestAddAthlete} style={{ padding: "6px 14px", borderRadius: 8, border: "none", background: "linear-gradient(135deg,#ff8a3d,#d97706)", color: "#fff", fontWeight: 800, cursor: "pointer", fontFamily: "inherit", fontSize: ".75em", whiteSpace: "nowrap" }}>Agregar</button>
            </div>
            <div style={{ display: "flex", alignItems: "center", gap: 12, opacity: 0.5 }}>
              <div style={{ width: 28, height: 28, borderRadius: 999, background: "#94a3b8", color: "#fff", fontWeight: 900, fontSize: ".8em", display: "flex", alignItems: "center", justifyContent: "center", flexShrink: 0 }}>3</div>
              <div style={{ flex: 1 }}>
                <div style={{ fontWeight: 800, color: "#0f172a", fontSize: ".88em" }}>Crea el primer workout</div>
                <div style={{ color: "#64748b", fontSize: ".78em" }}>Ve a Entrenamientos y usa el Builder con IA</div>
              </div>
              <span style={{ color: "#94a3b8", fontSize: ".75em", fontWeight: 700 }}>Pendiente</span>
            </div>
          </div>
        </div>
      ) : null}

      {showAddAthleteForm && (
        <div style={{ marginBottom: 22, background: "#ffffff", border: "1px solid #e2e8f0", borderRadius: 12, padding: 18 }}>
          <div style={{ fontSize: ".75em", letterSpacing: ".13em", color: "#475569", textTransform: "uppercase", marginBottom: 14 }}>
            Nuevo Atleta
          </div>
          <div style={{ display: "grid", gridTemplateColumns: "1fr 1fr", gap: 12, marginBottom: 14 }}>
            <div>
              <div style={{ fontSize: ".72em", color: "#64748b", marginBottom: 6 }}>Nombre</div>
              <input
                value={newAthlete.name}
                onChange={e => onChangeNewAthleteField("name", e.target.value)}
                placeholder="Ej: Carlos Rojas"
                style={{ width: "100%", background: "#ffffff", border: "1px solid #e2e8f0", borderRadius: 8, padding: "10px 12px", color: "#0f172a", fontFamily: "inherit", fontSize: ".85em", outline: "none", boxSizing: "border-box" }}
              />
            </div>
            <div>
              <div style={{ fontSize: ".72em", color: "#64748b", marginBottom: 6 }}>Correo</div>
              <input
                type="email"
                value={newAthlete.email}
                onChange={e => onChangeNewAthleteField("email", e.target.value)}
                placeholder="atleta@correo.com"
                style={{ width: "100%", background: "#ffffff", border: "1px solid #e2e8f0", borderRadius: 8, padding: "10px 12px", color: "#0f172a", fontFamily: "inherit", fontSize: ".85em", outline: "none", boxSizing: "border-box" }}
              />
            </div>
            <div>
              <div style={{ fontSize: ".72em", color: "#64748b", marginBottom: 6 }}>Ritmo por km</div>
              <input
                value={newAthlete.pace}
                onChange={e => onChangeNewAthleteField("pace", e.target.value)}
                placeholder="Ej: 5:10/km"
                style={{ width: "100%", background: "#ffffff", border: "1px solid #e2e8f0", borderRadius: 8, padding: "10px 12px", color: "#0f172a", fontFamily: "inherit", fontSize: ".85em", outline: "none", boxSizing: "border-box" }}
              />
            </div>
            <div style={{ gridColumn: "1 / -1" }}>
              <div style={{ fontSize: ".72em", color: "#64748b", marginBottom: 6 }}>Objetivo</div>
              <input
                value={newAthlete.goal}
                onChange={e => onChangeNewAthleteField("goal", e.target.value)}
                placeholder="Ej: Sub 3:45 Maratón"
                style={{ width: "100%", background: "#ffffff", border: "1px solid #e2e8f0", borderRadius: 8, padding: "10px 12px", color: "#0f172a", fontFamily: "inherit", fontSize: ".85em", outline: "none", boxSizing: "border-box" }}
              />
            </div>
            <div>
              <div style={{ fontSize: ".72em", color: "#64748b", marginBottom: 6 }}>Km semanales</div>
              <input
                type="number"
                value={newAthlete.weekly_km}
                onChange={e => onChangeNewAthleteField("weekly_km", e.target.value)}
                placeholder="Ej: 65"
                min="1"
                step="1"
                style={{ width: "100%", background: "#ffffff", border: "1px solid #e2e8f0", borderRadius: 8, padding: "10px 12px", color: "#0f172a", fontFamily: "inherit", fontSize: ".85em", outline: "none", boxSizing: "border-box" }}
              />
            </div>
            <div style={{ display: "flex", alignItems: "flex-end", justifyContent: "flex-end" }}>
              <div style={{ fontSize: ".72em", color: "#64748b", paddingBottom: 2, textAlign: "right" }}>
                Se agrega con estado “En ruta” y calendario básico.
              </div>
            </div>
          </div>

          <div style={{ display: "flex", gap: 10, justifyContent: "flex-end" }}>
            <button
              onClick={onCancelAddAthlete}
              style={{
                background: "#f8fafc",
                border: "1px solid #e2e8f0",
                borderRadius: 10,
                padding: "10px 14px",
                color: "#94a3b8",
                cursor: "pointer",
                fontFamily: "inherit",
                fontWeight: 700,
                fontSize: ".85em",
              }}
            >
              Cancelar
            </button>
            <button
              onClick={onSaveNewAthlete}
              style={{
                background: "linear-gradient(135deg,#e86f28,#ff8a3d)",
                border: "none",
                borderRadius: 10,
                padding: "10px 14px",
                color: "white",
                cursor: "pointer",
                fontFamily: "inherit",
                fontWeight: 800,
                fontSize: ".85em",
              }}
            >
              Guardar
            </button>
          </div>
        </div>
      )}

      {dashLoading ? (
        <div style={{ color: "#94a3b8", padding: "24px 0" }}>Cargando métricas desde Supabase…</div>
      ) : (
        <>
          <div style={{ display: "grid", gridTemplateColumns: "repeat(auto-fit, minmax(200px, 1fr))", gap: 14, marginBottom: 28 }}>
            {[
              { label: "Atletas activos", value: dashAthletes.length, sub: "Registrados bajo tu cuenta", icon: "🏃", color: "#ff8a3d" },
              { label: "Km programados / semana", value: `${weekKm.planned} km`, sub: "Suma de los workouts de esta semana", icon: "📍", color: "#3b82f6" },
              {
                label: "Km corridos / semana",
                value: `${weekKm.actual} km`,
                sub: weekKm.planned > 0
                  ? `${weekKmDonePct}% de lo programado · solo sesiones marcadas como hechas`
                  : "Sin kilómetros programados esta semana",
                icon: "🏁",
                color: weekKm.planned > 0 && weekKm.actual >= weekKm.planned ? "#16a34a" : "#d97706",
              },
              {
                label: "Adherencia global",
                value: weekWorkoutsTotal ? `${globalAdherencePct}%` : "—",
                sub: weekWorkoutsTotal ? `${weekWorkoutsDone} de ${weekWorkoutsTotal} workouts esta semana` : "Sin entrenamientos programados esta semana",
                icon: "✅",
                color: "#22c55e",
              },
              {
                label: "Carga promedio RPE",
                value: weekAvgRpe != null ? weekAvgRpe.toFixed(1) : "—",
                sub:
                  weekAvgRpe != null
                    ? `Promedio de RPE en sesiones completadas con registro (${weekRpeCount} sesiones)`
                    : "Ningún workout completado con RPE esta semana",
                icon: "📊",
                color: "#a855f7",
              },
            ].map((s, i) => (
              <div key={i} style={S.card}>
                <div style={{ fontSize: "1.8em", marginBottom: 8 }}>{s.icon}</div>
                <div style={{ fontSize: "2em", fontWeight: 700, color: s.color, fontFamily: "monospace", lineHeight: 1.1 }}>{s.value}</div>
                <div style={{ fontSize: ".75em", color: "#64748b", marginTop: 6 }}>{s.label}</div>
                <div style={{ fontSize: ".68em", color: "#475569", marginTop: 8, lineHeight: 1.35 }}>{s.sub}</div>
              </div>
            ))}
          </div>

          <div style={{ fontSize: ".72em", letterSpacing: ".15em", color: "#475569", textTransform: "uppercase", marginBottom: 14 }}>Detalle por atleta</div>
          <div style={{ ...S.card, padding: 0, overflow: "hidden", marginBottom: 24 }}>
            <div style={{ overflowX: "auto" }}>
              <table style={{ width: "100%", borderCollapse: "collapse", fontSize: ".82em" }}>
                <thead>
                  <tr style={{ background: "#f1f5f9", textAlign: "left", color: "#94a3b8" }}>
                    <th style={{ padding: "12px 14px", fontWeight: 700 }}>Atleta</th>
                    <th style={{ padding: "12px 14px", fontWeight: 700 }}>Km sem · plan / real</th>
                    <th style={{ padding: "12px 14px", fontWeight: 700, minWidth: 160 }}>Adherencia (semana)</th>
                    <th style={{ padding: "12px 14px", fontWeight: 700 }}>Próxima carrera</th>
                    <th style={{ padding: "12px 14px", fontWeight: 700 }}>Días restantes</th>
                  </tr>
                </thead>
                <tbody>
                  {athleteRows.length === 0 ? (
                    <tr>
                      <td colSpan={5} style={{ padding: "20px 14px", color: "#64748b" }}>
                        Aún no hay atletas. Usa «Nuevo Atleta» para comenzar.
                      </td>
                    </tr>
                  ) : (
                    athleteRows.map(({ athlete: a, weekTotal, weekDone, adherencePct, raceName, daysLeft, km }) => (
                      <tr
                        key={a.id}
                        onClick={() => onSelect(a)}
                        style={{ borderTop: "1px solid #e2e8f0", cursor: "pointer" }}
                      >
                        <td style={{ padding: "12px 14px", color: "#0f172a", fontWeight: 600 }}>{a.name}</td>
                        <td style={{ padding: "12px 14px", color: "#64748b", fontFamily: "monospace" }}>
                          {km.planned > 0 ? (
                            <>
                              {km.planned} /{" "}
                              <span style={{ color: km.actual >= km.planned ? "#16a34a" : "#d97706", fontWeight: 700 }}>{km.actual}</span> km
                            </>
                          ) : (
                            "—"
                          )}
                        </td>
                        <td style={{ padding: "12px 14px" }}>
                          <div style={{ fontSize: ".72em", color: "#64748b", marginBottom: 4 }}>
                            {weekTotal ? `${weekDone}/${weekTotal} · ${adherencePct}%` : "Sin workouts esta semana"}
                          </div>
                          <ProgressBar value={weekDone} total={weekTotal || 1} color={adherencePct >= 70 ? "#22c55e" : adherencePct >= 40 ? "#ff8a3d" : "#ef4444"} />
                        </td>
                        <td style={{ padding: "12px 14px", color: "#94a3b8", maxWidth: 200 }}>{raceName}</td>
                        <td style={{ padding: "12px 14px", color: "#cbd5e1", fontFamily: "monospace" }}>
                          {daysLeft == null ? "—" : `${daysLeft} ${daysLeft === 1 ? "día" : "días"}`}
                        </td>
                      </tr>
                    ))
                  )}
                </tbody>
              </table>
            </div>
          </div>

          <div style={{ fontSize: ".72em", letterSpacing: ".15em", color: "#475569", textTransform: "uppercase", marginBottom: 14 }}>Km programados esta semana, por atleta</div>
          <div style={{ ...S.card, padding: "18px 16px 22px" }}>
            {dashAthletes.length === 0 ? (
              <div style={{ color: "#64748b", fontSize: ".85em" }}>Sin datos para graficar.</div>
            ) : (
              <div
                style={{
                  display: "flex",
                  alignItems: "flex-end",
                  justifyContent: "flex-start",
                  gap: 10,
                  minHeight: 140,
                  paddingTop: 8,
                }}
              >
                {athleteRows.map(({ athlete: a, km: weekKmForAthlete }) => {
                  const km = weekKmForAthlete.planned;
                  const hPct = Math.max(6, (km / maxWeeklyKm) * 100);
                  return (
                    <div
                      key={a.id}
                      style={{
                        flex: "1 1 0",
                        minWidth: 36,
                        maxWidth: 72,
                        display: "flex",
                        flexDirection: "column",
                        alignItems: "center",
                        gap: 8,
                      }}
                      title={`${a.name}: ${km} km programados · ${weekKmForAthlete.actual} km corridos`}
                    >
                      <div
                        style={{
                          width: "100%",
                          height: 110,
                          display: "flex",
                          alignItems: "flex-end",
                          justifyContent: "center",
                          background: "#f8fafc",
                          borderRadius: 8,
                          padding: "0 6px",
                          boxSizing: "border-box",
                        }}
                      >
                        <div
                          style={{
                            width: "72%",
                            height: `${hPct}%`,
                            maxHeight: "100%",
                            background: "linear-gradient(180deg,#fbbf24,#b45309)",
                            borderRadius: "6px 6px 2px 2px",
                            boxShadow: "0 0 12px rgba(255,138,61,.25)",
                          }}
                        />
                      </div>
                      <div style={{ fontSize: ".62em", color: "#94a3b8", textAlign: "center", lineHeight: 1.2, wordBreak: "break-word" }}>
                        {(a.name || "").split(/\s+/)[0]}
                      </div>
                      <div style={{ fontSize: ".65em", color: "#64748b", fontFamily: "monospace" }}>{km}</div>
                    </div>
                  );
                })}
              </div>
            )}
          </div>
        </>
      )}
    </div>
  );
}


function AdminCoachesProfilesPanel({ notify, adminUserId }) {
  const S = styles;
  const monthKey = useMemo(() => getCurrentMonthKey(), []);
  const [rows, setRows] = useState([]);
  const [emailByUserId, setEmailByUserId] = useState({});
  const [generationsByCoachId, setGenerationsByCoachId] = useState({});
  const [loadingGenerations, setLoadingGenerations] = useState(false);
  const [loading, setLoading] = useState(true);
  const [busyKey, setBusyKey] = useState("");
  const [activateMonthsChoice, setActivateMonthsChoice] = useState({});

  const load = useCallback(async () => {
    setLoading(true);
    const { data: profs, error } = await supabase
      .from("profiles")
      .select(
        "user_id,name,email,plan_status,trial_started_at,plan_validated_at,plan_validated_by,role,subscription_plan,subscription_period,subscription_amount,subscription_expires_at",
      )
      .eq("role", "coach")
      .order("name", { ascending: true });
    if (error) {
      console.error(error);
      notify("No se pudieron cargar los coaches.");
      setRows([]);
      setLoading(false);
      return;
    }
    const list = profs || [];
    setRows(list);
    const uids = list.map((r) => r.user_id).filter(Boolean);
    if (uids.length === 0) {
      setEmailByUserId({});
      setGenerationsByCoachId({});
      setLoading(false);
      return;
    }
    const em = {};
    for (const r of list) {
      if (r.email && String(r.email).trim()) em[r.user_id] = String(r.email).toLowerCase();
    }
    const needCp = uids.filter((id) => !em[id]);
    if (needCp.length > 0) {
      const { data: cps, error: cpErr } = await supabase.from("coach_profiles").select("user_id,email").in("user_id", needCp);
      if (cpErr) console.warn("coach_profiles emails:", cpErr);
      for (const r of cps || []) {
        if (r.email) em[r.user_id] = String(r.email).toLowerCase();
      }
    }
    setLoadingGenerations(true);
    const { data: generationRows, error: generationsErr } = await supabase
      .from("ai_generations")
      .select("coach_id,count")
      .eq("month", monthKey)
      .in("coach_id", uids);
    if (generationsErr) console.error("ai_generations admin list:", generationsErr);
    const generationMap = {};
    for (const row of generationRows || []) {
      generationMap[row.coach_id] = Number(row.count) || 0;
    }
    setGenerationsByCoachId(generationMap);
    setLoadingGenerations(false);
    setEmailByUserId(em);
    setLoading(false);
  }, [notify, monthKey]);

  useEffect(() => {
    load();
  }, [load]);

  const planBadge = (st) => {
    const s = st || "—";
    const colors =
      s === "trial"
        ? { bg: "#fef9c3", fg: "#854d0e", bd: "#fde047" }
        : s === "active"
          ? { bg: "#dcfce7", fg: "#166534", bd: "#86efac" }
          : s === "blocked"
            ? { bg: "#fee2e2", fg: "#991b1b", bd: "#fecaca" }
            : { bg: "#f1f5f9", fg: "#475569", bd: "#e2e8f0" };
    return (
      <span
        style={{
          fontSize: ".72em",
          fontWeight: 800,
          padding: "3px 8px",
          borderRadius: 6,
          background: colors.bg,
          color: colors.fg,
          border: `1px solid ${colors.bd}`,
        }}
      >
        {s}
      </span>
    );
  };

  /** Días hasta subscription_expires_at; si no hay fecha, muestra días de trial cuando aplica. */
  const subscriptionDaysRemainingCol = (p) => {
    const raw = p.subscription_expires_at;
    if (raw) {
      const end = new Date(raw);
      if (Number.isNaN(end.getTime())) return "—";
      const days = Math.ceil((end.getTime() - Date.now()) / (1000 * 60 * 60 * 24));
      if (days < 0) return "Vencido";
      return `Vence en ${days} día${days === 1 ? "" : "s"}`;
    }
    if (p.plan_status === "trial" && p.trial_started_at) {
      const d = coachTrialDaysRemainingFromStart(p);
      return d == null ? "—" : `${d} día${d === 1 ? "" : "s"} (trial)`;
    }
    return "—";
  };

  const validatedCol = (p) =>
    p.plan_validated_at ? new Date(p.plan_validated_at).toLocaleString("es", { dateStyle: "short", timeStyle: "short" }) : "—";

  const chosenPlanBadge = (planRaw) => {
    const p = String(planRaw || "").trim();
    if (!p) return <span style={{ color: "#94a3b8" }}>—</span>;
    const low = p.toLowerCase();
    const isPro = low === "pro";
    const label = low === "basico" || low === "básico" ? "Básico" : isPro ? "Pro" : p;
    const colors = isPro
      ? { bg: "#fffbeb", fg: "#b45309", bd: "#fcd34d" }
      : { bg: "#eff6ff", fg: "#1d4ed8", bd: "#93c5fd" };
    return (
      <span
        style={{
          fontSize: ".72em",
          fontWeight: 800,
          padding: "3px 8px",
          borderRadius: 6,
          background: colors.bg,
          color: colors.fg,
          border: `1px solid ${colors.bd}`,
        }}
      >
        {label}
      </span>
    );
  };

  const subscriptionPeriodLabel = (per) => {
    const k = String(per || "").trim().toLowerCase();
    const map = { mensual: "Mensual", monthly: "Mensual", semestral: "Semestral", anual: "Anual", yearly: "Anual" };
    return map[k] || (per ? String(per) : "—");
  };

  const formatSubscriptionAmountCop = (amt) => {
    if (amt == null || amt === "") return "—";
    const n = Number(amt);
    if (!Number.isFinite(n)) return "—";
    return `$${n.toLocaleString("es-CO", { maximumFractionDigits: 0 })} COP`;
  };

  const addCalendarMonths = (fromDate, months) => {
    const d = new Date(fromDate.getTime());
    const day = d.getDate();
    d.setMonth(d.getMonth() + months);
    if (d.getDate() < day) d.setDate(0);
    return d;
  };

  const runAction = async (key, uid, payload) => {
    setBusyKey(`${key}-${uid}`);
    const { error } = await supabase.from("profiles").update(payload).eq("user_id", uid);
    setBusyKey("");
    if (error) {
      notify(error.message || "Error al actualizar");
      return;
    }
    notify("Actualizado ✓");
    load();
  };

  /** Activa / renueva suscripción admin: siempre sobrescribe vencimiento y período desde HOY (no acumula ni compara con el período anterior). */
  const activateCoachWithMonths = (uid, months) => {
    const m = Number(months);
    if (![1, 6, 12].includes(m)) return;
    const now = new Date();
    const subscription_expires_at = addCalendarMonths(now, m).toISOString();
    const subscription_period = m === 1 ? "mensual" : m === 6 ? "semestral" : "anual";
    runAction("act", uid, {
      subscription_expires_at,
      subscription_period,
      plan_status: "active",
      plan_validated_at: now.toISOString(),
      plan_validated_by: adminUserId,
    });
  };

  const blockCoachProf = (uid) => {
    if (typeof window !== "undefined" && !window.confirm("¿Bloquear este coach?")) return;
    runAction("blk", uid, { plan_status: "blocked" });
  };

  const resetTrial = (uid) =>
    runAction("rst", uid, { plan_status: "trial", trial_started_at: new Date().toISOString() });

  const resetCoachGenerations = async (uid, coachName) => {
    const displayName = (coachName && String(coachName).trim()) || "coach";
    if (typeof window !== "undefined" && !window.confirm(`¿Resetear generaciones de ${displayName}?`)) return;
    setBusyKey(`gen-${uid}`);
    const { error } = await supabase
      .from("ai_generations")
      .delete()
      .eq("coach_id", uid)
      .eq("month", monthKey);
    setBusyKey("");
    if (error) {
      notify(error.message || "Error al resetear generaciones");
      return;
    }
    setGenerationsByCoachId((prev) => ({ ...prev, [uid]: 0 }));
    notify("Generaciones reseteadas ✓");
  };

  const cell = { padding: "10px 12px", fontSize: ".78em", color: "#334155", borderBottom: "1px solid #e2e8f0" };
  const th = { ...cell, fontWeight: 800, color: "#64748b", background: "#f8fafc" };

  return (
    <div style={S.page}>
      <h1 style={S.pageTitle}>Coaches</h1>
      <p style={{ color: "#475569", fontSize: ".85em", marginTop: 4, marginBottom: 18 }}>
        Perfiles con rol coach: plan, trial y validación.
      </p>
      {loading ? (
        <div style={{ color: "#64748b" }}>Cargando…</div>
      ) : rows.length === 0 ? (
        <div style={{ color: "#94a3b8" }}>No hay coaches.</div>
      ) : (
        <div style={{ overflowX: "auto", border: "1px solid #e2e8f0", borderRadius: 12, background: "#fff" }}>
          <table style={{ width: "100%", borderCollapse: "collapse", minWidth: 1180 }}>
            <thead>
              <tr>
                <th style={th}>Nombre</th>
                <th style={th}>Correo</th>
                <th style={th}>Estado</th>
                <th style={th}>Plan elegido</th>
                <th style={th}>Período</th>
                <th style={th}>Monto</th>
                <th style={th}>Días restantes</th>
                <th style={th}>Fecha validación</th>
                <th style={th}>Generaciones</th>
                <th style={th}>Acciones</th>
              </tr>
            </thead>
            <tbody>
              {rows.map((p) => {
                const uid = p.user_id;
                const busy = busyKey === `act-${uid}` || busyKey === `blk-${uid}` || busyKey === `rst-${uid}` || busyKey === `gen-${uid}`;
                const generationsThisMonth = Number(generationsByCoachId[uid]) || 0;
                return (
                  <tr key={uid}>
                    <td style={cell}>{(p.name && String(p.name).trim()) || "—"}</td>
                    <td style={cell}>{emailByUserId[uid] || "—"}</td>
                    <td style={cell}>{planBadge(p.plan_status || "—")}</td>
                    <td style={cell}>{chosenPlanBadge(p.subscription_plan)}</td>
                    <td style={cell}>{subscriptionPeriodLabel(p.subscription_period)}</td>
                    <td style={cell}>{formatSubscriptionAmountCop(p.subscription_amount)}</td>
                    <td style={cell}>{subscriptionDaysRemainingCol(p)}</td>
                    <td style={cell}>{validatedCol(p)}</td>
                    <td style={cell}>
                      <div style={{ fontWeight: 700, color: "#0f172a", marginBottom: 8 }}>
                        {loadingGenerations ? "…" : `${generationsThisMonth} este mes`}
                      </div>
                      <button
                        type="button"
                        disabled={busy}
                        onClick={() => resetCoachGenerations(uid, p.name)}
                        style={{
                          padding: "6px 10px",
                          borderRadius: 8,
                          border: "1px solid #bfdbfe",
                          background: busy ? "#e2e8f0" : "#eff6ff",
                          color: "#1d4ed8",
                          fontWeight: 700,
                          fontSize: ".72em",
                          cursor: busy ? "not-allowed" : "pointer",
                          fontFamily: "inherit",
                        }}
                      >
                        🔄 Resetear
                      </button>
                    </td>
                    <td style={{ ...cell, verticalAlign: "top" }}>
                      <div
                        style={{
                          display: "flex",
                          flexDirection: "column",
                          alignItems: "flex-start",
                          gap: 6,
                          marginBottom: 8,
                          padding: "8px 0",
                          borderBottom: "1px dashed #e2e8f0",
                        }}
                      >
                        <span style={{ fontSize: ".68em", fontWeight: 800, color: "#64748b" }}>Activar por:</span>
                        <div style={{ display: "flex", flexWrap: "wrap", alignItems: "center", gap: 6 }}>
                          <select
                            value={activateMonthsChoice[uid] ?? "1"}
                            onChange={(e) =>
                              setActivateMonthsChoice((prev) => ({ ...prev, [uid]: e.target.value }))
                            }
                            disabled={busy}
                            style={{
                              padding: "6px 8px",
                              borderRadius: 8,
                              border: "1px solid #e2e8f0",
                              fontSize: ".72em",
                              fontFamily: "inherit",
                              color: "#0f172a",
                              background: "#fff",
                              minWidth: 110,
                            }}
                          >
                            <option value="1">1 mes</option>
                            <option value="6">6 meses</option>
                            <option value="12">1 año</option>
                          </select>
                          <button
                            type="button"
                            disabled={busy}
                            onClick={() => {
                              const raw = activateMonthsChoice[uid] ?? "1";
                              const months =
                                raw === "12" || raw === 12 ? 12 : raw === "6" || raw === 6 ? 6 : 1;
                              activateCoachWithMonths(uid, months);
                            }}
                            style={{
                              padding: "6px 10px",
                              borderRadius: 8,
                              border: "1px solid #bbf7d0",
                              background: busy ? "#e2e8f0" : "#f0fdf4",
                              color: "#15803d",
                              fontWeight: 700,
                              fontSize: ".72em",
                              cursor: busy ? "not-allowed" : "pointer",
                              fontFamily: "inherit",
                            }}
                          >
                            Activar
                          </button>
                        </div>
                      </div>
                      <button
                        type="button"
                        disabled={busy}
                        onClick={() => blockCoachProf(uid)}
                        style={{
                          marginRight: 6,
                          padding: "6px 10px",
                          borderRadius: 8,
                          border: "1px solid #fecaca",
                          background: busy ? "#e2e8f0" : "#fef2f2",
                          color: "#b91c1c",
                          fontWeight: 700,
                          fontSize: ".72em",
                          cursor: busy ? "not-allowed" : "pointer",
                          fontFamily: "inherit",
                        }}
                      >
                        🔒 Bloquear
                      </button>
                      <button
                        type="button"
                        disabled={busy}
                        onClick={() => resetTrial(uid)}
                        style={{
                          padding: "6px 10px",
                          borderRadius: 8,
                          border: "1px solid #e2e8f0",
                          background: busy ? "#e2e8f0" : "#fff",
                          color: "#475569",
                          fontWeight: 700,
                          fontSize: ".72em",
                          cursor: busy ? "not-allowed" : "pointer",
                          fontFamily: "inherit",
                        }}
                      >
                        🔄 Resetear trial
                      </button>
                    </td>
                  </tr>
                );
              })}
            </tbody>
          </table>
        </div>
      )}
    </div>
  );
}


function AdminPanel({ notify, adminUserId }) {
  const [adminTab, setAdminTab] = useState(() => {
    if (typeof localStorage === "undefined") return "promo";
    const saved = localStorage.getItem("raf_admin_tab");
    return saved || "promo";
  });
  useEffect(() => {
    if (typeof localStorage === "undefined") return;
    localStorage.setItem("raf_admin_tab", adminTab);
  }, [adminTab]);
  return (
    <div>
      <div style={{ display: "flex", gap: 8, flexWrap: "wrap", margin: "0 0 10px 0", padding: "0 16px" }}>
        <button type="button" onClick={() => setAdminTab("promo")} style={{ border: "1px solid #e2e8f0", borderRadius: 8, padding: "8px 10px", background: adminTab === "promo" ? "rgba(124,58,237,.12)" : "#fff", color: adminTab === "promo" ? "#6d28d9" : "#334155", fontWeight: 800, cursor: "pointer", fontFamily: "inherit" }}>🎟️ Promo</button>
        <button type="button" onClick={() => setAdminTab("marketplace")} style={{ border: "1px solid #e2e8f0", borderRadius: 8, padding: "8px 10px", background: adminTab === "marketplace" ? "rgba(14,165,233,.12)" : "#fff", color: adminTab === "marketplace" ? "#0369a1" : "#334155", fontWeight: 800, cursor: "pointer", fontFamily: "inherit" }}>🛒 Marketplace</button>
        <button type="button" onClick={() => setAdminTab("coaches")} style={{ border: "1px solid #e2e8f0", borderRadius: 8, padding: "8px 10px", background: adminTab === "coaches" ? "rgba(99,102,241,.12)" : "#fff", color: adminTab === "coaches" ? "#4338ca" : "#334155", fontWeight: 800, cursor: "pointer", fontFamily: "inherit" }}>👥 Coaches</button>
      </div>
      {adminTab === "promo" ? (
        <AdminPromoCodes notify={notify} />
      ) : adminTab === "marketplace" ? (
        <AdminMarketplacePanel notify={notify} styles={styles} />
      ) : (
        <AdminCoachesProfilesPanel notify={notify} adminUserId={adminUserId} />
      )}
    </div>
  );
}

function AdminPromoCodes({ notify }) {
  const S = styles;
  const [rows, setRows] = useState([]);
  const [loading, setLoading] = useState(true);
  const [form, setForm] = useState({ name: "", discount: "10", maxUses: "100", expires: "" });
  const [saving, setSaving] = useState(false);

  const loadRows = useCallback(async () => {
    setLoading(true);
    const { data, error } = await supabase.from("promo_codes").select("*").order("created_at", { ascending: false });
    if (error) {
      console.error(error);
      notify("No se pudieron cargar los códigos. Verifica la tabla promo_codes en Supabase.");
      setRows([]);
    } else {
      setRows(data || []);
    }
    setLoading(false);
  }, [notify]);

  useEffect(() => {
    loadRows();
  }, [loadRows]);

  const submitCreate = async (e) => {
    e.preventDefault();
    const rawName = form.name.trim();
    if (!rawName) {
      notify("Indica el nombre del código");
      return;
    }
    const code = rawName.toUpperCase().replace(/\s+/g, "");
    const discount = Number(form.discount);
    const maxUses = Math.max(0, Math.floor(Number(form.maxUses)));
    if (!Number.isFinite(discount) || discount < 0 || discount > 100) {
      notify("El descuento debe estar entre 0 y 100%");
      return;
    }
    if (!Number.isFinite(maxUses)) {
      notify("Usos máximos inválidos");
      return;
    }
    setSaving(true);
    const expires_at =
      form.expires && String(form.expires).trim()
        ? new Date(`${form.expires}T23:59:59`).toISOString()
        : null;
    const { error } = await supabase.from("promo_codes").insert({
      code,
      discount_percent: discount,
      max_uses: maxUses,
      expires_at,
      active: true,
      uses_count: 0,
    });
    setSaving(false);
    if (error) {
      console.error(error);
      notify(error.message || "Error al crear código");
      return;
    }
    notify("Código creado");
    setForm((f) => ({ ...f, name: "" }));
    loadRows();
  };

  const toggleActive = async (row) => {
    const { error } = await supabase.from("promo_codes").update({ active: !row.active }).eq("id", row.id);
    if (error) {
      notify(error.message || "Error al actualizar");
      return;
    }
    notify(!row.active ? "Código activado" : "Código desactivado");
    loadRows();
  };

  const inputStyle = {
    width: "100%",
    padding: "10px 12px",
    borderRadius: 8,
    border: "1px solid #e2e8f0",
    background: "#fff",
    color: "#0f172a",
    fontFamily: "inherit",
    fontSize: ".88em",
    boxSizing: "border-box",
  };

  return (
    <div style={S.page}>
      <h1 style={S.pageTitle}>Admin · Códigos promocionales</h1>
      <p style={{ color: "#475569", fontSize: ".85em", marginTop: 4, marginBottom: 22 }}>
        Crea y gestiona códigos de descuento para la vista Planes.
      </p>

      <div style={{ ...S.card, marginBottom: 22 }}>
        <div style={{ fontSize: ".72em", letterSpacing: ".12em", color: "#64748b", fontWeight: 700, marginBottom: 14 }}>
          NUEVO CÓDIGO
        </div>
        <form onSubmit={submitCreate} style={{ display: "grid", gridTemplateColumns: "repeat(auto-fill, minmax(160px, 1fr))", gap: 14, alignItems: "end" }}>
          <div>
            <label style={{ display: "block", fontSize: ".75em", color: "#64748b", marginBottom: 6, fontWeight: 600 }}>Nombre del código</label>
            <input
              value={form.name}
              onChange={(e) => setForm((f) => ({ ...f, name: e.target.value }))}
              placeholder="Ej. VERANO2026"
              style={inputStyle}
            />
          </div>
          <div>
            <label style={{ display: "block", fontSize: ".75em", color: "#64748b", marginBottom: 6, fontWeight: 600 }}>% descuento</label>
            <input
              type="number"
              min={0}
              max={100}
              value={form.discount}
              onChange={(e) => setForm((f) => ({ ...f, discount: e.target.value }))}
              style={inputStyle}
            />
          </div>
          <div>
            <label style={{ display: "block", fontSize: ".75em", color: "#64748b", marginBottom: 6, fontWeight: 600 }}>Usos máximos</label>
            <input
              type="number"
              min={0}
              value={form.maxUses}
              onChange={(e) => setForm((f) => ({ ...f, maxUses: e.target.value }))}
              style={inputStyle}
            />
          </div>
          <div>
            <label style={{ display: "block", fontSize: ".75em", color: "#64748b", marginBottom: 6, fontWeight: 600 }}>Expira</label>
            <input type="date" value={form.expires} onChange={(e) => setForm((f) => ({ ...f, expires: e.target.value }))} style={inputStyle} />
          </div>
          <div>
            <button
              type="submit"
              disabled={saving}
              style={{
                width: "100%",
                padding: "11px 16px",
                borderRadius: 10,
                border: "none",
                background: saving ? "#e2e8f0" : "linear-gradient(135deg,#7c3aed,#a78bfa)",
                color: saving ? "#64748b" : "#fff",
                fontWeight: 800,
                cursor: saving ? "not-allowed" : "pointer",
                fontFamily: "inherit",
              }}
            >
              {saving ? "Guardando…" : "Crear código"}
            </button>
          </div>
        </form>
      </div>

      <div style={S.card}>
        <div style={{ fontSize: ".72em", letterSpacing: ".12em", color: "#64748b", fontWeight: 700, marginBottom: 14 }}>
          CÓDIGOS CREADOS
        </div>
        {loading ? (
          <div style={{ color: "#64748b" }}>Cargando…</div>
        ) : rows.length === 0 ? (
          <div style={{ color: "#94a3b8", fontSize: ".9em" }}>Aún no hay códigos.</div>
        ) : (
          <div style={{ display: "flex", flexDirection: "column", gap: 10 }}>
            {rows.map((row) => {
              const remaining = Math.max(0, (row.max_uses ?? 0) - (row.uses_count ?? 0));
              const expired = row.expires_at && new Date(row.expires_at) < new Date();
              const statusLabel = !row.active ? "Inactivo" : expired ? "Expirado" : "Activo";
              const statusColor = !row.active ? "#94a3b8" : expired ? "#ef4444" : "#16a34a";
              return (
                <div
                  key={row.id}
                  style={{
                    display: "grid",
                    gridTemplateColumns: "1fr auto auto",
                    gap: 12,
                    alignItems: "center",
                    padding: "14px 16px",
                    background: "#f8fafc",
                    borderRadius: 10,
                    border: "1px solid #e2e8f0",
                  }}
                >
                  <div>
                    <div style={{ fontWeight: 800, color: "#0f172a", letterSpacing: ".04em" }}>{row.code}</div>
                    <div style={{ fontSize: ".8em", color: "#64748b", marginTop: 4 }}>
                      {row.discount_percent}% desc. · {remaining} usos restantes
                      {row.expires_at ? ` · exp. ${new Date(row.expires_at).toLocaleDateString("es")}` : ""}
                    </div>
                    <div style={{ fontSize: ".75em", color: statusColor, fontWeight: 700, marginTop: 6 }}>{statusLabel}</div>
                  </div>
                  <div style={{ fontSize: ".85em", fontWeight: 700, color: "#ff8a3d" }}>{row.discount_percent}%</div>
                  <button
                    type="button"
                    onClick={() => toggleActive(row)}
                    style={{
                      padding: "8px 14px",
                      borderRadius: 8,
                      border: "1px solid #e2e8f0",
                      background: row.active ? "#fef2f2" : "#f0fdf4",
                      color: row.active ? "#b91c1c" : "#15803d",
                      fontWeight: 700,
                      fontSize: ".78em",
                      cursor: "pointer",
                      fontFamily: "inherit",
                      whiteSpace: "nowrap",
                    }}
                  >
                    {row.active ? "Desactivar" : "Activar"}
                  </button>
                </div>
              );
            })}
          </div>
        )}
      </div>
    </div>
  );
}

function Plans({ athletes, notify }) {
  const S = styles;

  const WOMPI_PUBLIC_KEY = "pub_test_9yDINqJhS2WxJYpYtgzXkP5TKND5WQyf";
  const WompiCheckoutBase = "https://checkout.wompi.co/p/";
  const redirectUrl = "https://www.runningapexflow.com";

  const [promoInput, setPromoInput] = useState("");
  const [appliedPromo, setAppliedPromo] = useState(null);
  const [promoError, setPromoError] = useState("");
  const [promoLoading, setPromoLoading] = useState(false);

  const PLAN_CATALOG = useMemo(
    () => [
      {
        plan: "Basico",
        label: "Básico",
        priceCop: 100000,
        priceUsd: 24,
        maxAthletes: 15,
        description: "Para coaches independientes que quieren profesionalizar su trabajo.",
        benefits: [
          "✓ Hasta 15 atletas",
          "Generador de workouts con IA",
          "Plan 2 semanas renovable",
          "Biblioteca personal de entrenamientos",
          "Chat con atletas",
          "Evaluación VDOT y zonas FC",
          "Exportar PDF",
          "App móvil",
        ],
      },
      {
        plan: "Pro",
        label: "Pro",
        priceCop: 160000,
        priceUsd: 39,
        maxAthletes: null,
        description: "Para coaches y academias que quieren escalar sin límites.",
        benefits: [
          "✓ Atletas ilimitados",
          "Todo lo del Básico",
          "Integración Garmin y COROS",
          "Notificaciones push",
          "Sistema de logros y medallas",
          "Códigos promocionales",
          "Validación de pagos",
          "Soporte prioritario",
          "Panel de administración",
        ],
      },
    ],
    [],
  );

  const coachPlan = athletes?.[0]?.plan || "";

  const amountInCentsByPlan = (planName) => {
    if (planName === "Basico") return 10000000;
    if (planName === "Pro") return 16000000;
    return 0;
  };

  const applyPromo = async () => {
    const code = promoInput.trim();
    setPromoError("");
    if (!code) {
      setPromoError("Escribe un código");
      return;
    }
    setPromoLoading(true);
    const { data, error } = await supabase.rpc("validate_promo_code", { code_input: code });
    setPromoLoading(false);
    if (error) {
      console.error(error);
      setPromoError(error.message || "No se pudo validar el código");
      setAppliedPromo(null);
      return;
    }
    const row = Array.isArray(data) ? data[0] : data;
    if (!row || row.discount_percent == null) {
      setPromoError("Código no válido o sin usos disponibles");
      setAppliedPromo(null);
      return;
    }
    setAppliedPromo({ code: code.toUpperCase().replace(/\s+/g, ""), discount_percent: Number(row.discount_percent) });
    notify(`Código aplicado: ${row.discount_percent}% de descuento`);
  };

  const clearPromo = () => {
    setAppliedPromo(null);
    setPromoInput("");
    setPromoError("");
  };

  const openDirectWompiCheckout = async (planObj) => {
    const amountInCentsBase = amountInCentsByPlan(planObj.plan);
    if (!amountInCentsBase) return;

    let amountInCents = amountInCentsBase;
    if (appliedPromo?.discount_percent != null) {
      amountInCents = Math.max(0, Math.round((amountInCentsBase * (100 - appliedPromo.discount_percent)) / 100));
    }

    if (appliedPromo?.code) {
      const { data: ok, error: redeemErr } = await supabase.rpc("redeem_promo_code", { code_input: appliedPromo.code });
      if (redeemErr) {
        console.error(redeemErr);
        notify(redeemErr.message || "No se pudo registrar el uso del código");
        return;
      }
      if (!ok) {
        notify("El código ya no es válido o no tiene usos");
        setAppliedPromo(null);
        return;
      }
    }

    const reference = `runningapexflow-${planObj.plan}-${Date.now()}`;

    const params = new URLSearchParams({
      "public-key": WOMPI_PUBLIC_KEY,
      currency: "COP",
      "amount-in-cents": String(amountInCents),
      reference,
      "redirect-url": redirectUrl,
    });

    const checkoutUrl = `${WompiCheckoutBase}?${params.toString()}`;
    window.open(checkoutUrl, "_blank", "noopener,noreferrer");
  };

  return (
    <div style={S.page}>
      <div style={{ marginBottom: 22 }}>
        <h1 style={S.pageTitle}>Planes</h1>
        <p style={{ color: "#475569", fontSize: ".82em", marginTop: 4 }}>Elige un plan para tu coach</p>
      </div>

      <div style={{ ...S.card, marginBottom: 20 }}>
        <div style={{ fontSize: ".72em", letterSpacing: ".12em", color: "#64748b", fontWeight: 700, marginBottom: 10 }}>CÓDIGO PROMOCIONAL</div>
        <div style={{ display: "flex", flexWrap: "wrap", gap: 10, alignItems: "center" }}>
          <input
            value={promoInput}
            onChange={(e) => setPromoInput(e.target.value)}
            placeholder="Ingresa tu código"
            disabled={!!appliedPromo}
            style={{
              flex: "1 1 200px",
              minWidth: 160,
              padding: "10px 12px",
              borderRadius: 8,
              border: "1px solid #e2e8f0",
              background: appliedPromo ? "#f1f5f9" : "#fff",
              color: "#0f172a",
              fontFamily: "inherit",
              fontSize: ".88em",
            }}
          />
          {appliedPromo ? (
            <button
              type="button"
              onClick={clearPromo}
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
              onClick={applyPromo}
              disabled={promoLoading}
              style={{
                padding: "10px 18px",
                borderRadius: 8,
                border: "none",
                background: promoLoading ? "#e2e8f0" : "linear-gradient(135deg,#2563eb,#3b82f6)",
                color: promoLoading ? "#64748b" : "#fff",
                fontWeight: 800,
                cursor: promoLoading ? "not-allowed" : "pointer",
                fontFamily: "inherit",
              }}
            >
              {promoLoading ? "…" : "Aplicar"}
            </button>
          )}
        </div>
        {promoError ? <div style={{ color: "#dc2626", fontSize: ".8em", marginTop: 8 }}>{promoError}</div> : null}
        {appliedPromo ? (
          <div style={{ color: "#15803d", fontSize: ".82em", marginTop: 8, fontWeight: 600 }}>
            Descuento del {appliedPromo.discount_percent}% aplicado a los precios mostrados.
          </div>
        ) : null}
      </div>

      <div className="pf-plans-grid" style={{ display: "grid", gridTemplateColumns: "repeat(2, 1fr)", gap: 18 }}>
        {PLAN_CATALOG.map((p) => {
          const isCurrent = coachPlan === p.plan;
          const copPretty = Number(p.priceCop).toLocaleString("es-CO");
          const discountPct = appliedPromo?.discount_percent ?? 0;
          const priceAfter = Math.max(0, Math.round((p.priceCop * (100 - discountPct)) / 100));
          const copAfterPretty = Number(priceAfter).toLocaleString("es-CO");

          return (
            <div
              key={p.plan}
              style={{
                ...S.card,
                border: isCurrent ? "2px solid #ff8a3d" : "1px solid #e2e8f0",
                background: isCurrent ? "rgba(255,138,61,.06)" : "#ffffff",
                padding: 18,
                display: "flex",
                flexDirection: "column",
                gap: 10,
              }}
            >
              <div style={{ fontSize: "1.2em", fontWeight: 800, color: isCurrent ? "#ff8a3d" : "#0f172a" }}>
                {p.label}
                <span style={{ fontSize: ".65em", color: "#64748b", fontWeight: 600, marginLeft: 8 }}>(${p.priceUsd} USD)</span>
              </div>
              <div style={{ fontSize: "2em", fontWeight: 900, color: "#ff8a3d", fontFamily: "monospace" }}>
                {discountPct > 0 ? (
                  <>
                    <span style={{ textDecoration: "line-through", color: "#94a3b8", fontSize: ".55em", marginRight: 8 }}>${copPretty}</span>
                    <span>{`$${copAfterPretty}`}</span>
                  </>
                ) : (
                  `$${copPretty}`
                )}
                <span style={{ fontSize: ".55em", color: "#64748b", fontFamily: "inherit", marginLeft: 6 }}>COP</span>
              </div>
              <div style={{ fontSize: ".8em", color: "#64748b" }}>{p.description}</div>
              <div style={{ display: "flex", flexDirection: "column", gap: 5, marginTop: 2 }}>
                {(p.benefits || []).map((benefit) => (
                  <div
                    key={benefit}
                    style={{ fontSize: ".78em", color: "#334155", display: "flex", alignItems: "flex-start", gap: 6, lineHeight: 1.35 }}
                  >
                    <span style={{ color: "#22c55e", fontWeight: 900 }}>✓</span>
                    <span>{benefit}</span>
                  </div>
                ))}
              </div>

              <div style={{ marginTop: "auto" }}>
                <button
                  type="button"
                  onClick={() => openDirectWompiCheckout(p)}
                  style={{
                    width: "100%",
                    background: "linear-gradient(135deg,#e86f28,#ff8a3d)",
                    border: "none",
                    borderRadius: 10,
                    padding: "10px 14px",
                    color: "white",
                    cursor: "pointer",
                    fontFamily: "inherit",
                    fontWeight: 900,
                    fontSize: ".85em",
                  }}
                >
                  Suscribirse
                </button>
              </div>
            </div>
          );
        })}
      </div>
    </div>
  );
}

const styles = {
  root: {
    display: "flex",
    minHeight: "100vh",
    background: "#f8fafc",
    color: "#0f172a",
    fontFamily: "'Plus Jakarta Sans', system-ui, -apple-system, sans-serif",
  },
  sidebar: {
    width: 228,
    background: "#ffffff",
    borderRight: "1px solid #e2e8f0",
    display: "flex",
    flexDirection: "column",
    padding: "0 0 20px",
    flexShrink: 0,
    boxShadow: "1px 0 0 rgba(15,23,42,0.04)",
  },
  logo: { display: "flex", gap: 10, alignItems: "center", padding: "20px 16px 22px", borderBottom: "1px solid #e2e8f0" },
  logoTitle: { fontSize: "1em", fontWeight: 800, letterSpacing: ".06em", color: "#0f172a" },
  logoSub: { fontSize: ".65em", color: "#64748b", letterSpacing: ".1em", textTransform: "uppercase", fontWeight: 600 },
  navBtn: {
    display: "flex",
    gap: 12,
    alignItems: "center",
    width: "100%",
    background: "transparent",
    border: "none",
    color: "#475569",
    padding: "11px 16px",
    cursor: "pointer",
    fontSize: ".86em",
    textAlign: "left",
    fontFamily: "inherit",
    fontWeight: 600,
    borderRadius: 0,
    borderRight: "3px solid transparent",
  },
  navBtnActive: {
    color: "#c2410c",
    background: "rgba(255,138,61, 0.14)",
    borderRight: "3px solid #ff8a3d",
  },
  sidebarFooter: { padding: "16px", borderTop: "1px solid #e2e8f0", marginTop: "auto", background: "#fafafa" },
  page: { padding: "28px 32px", maxWidth: 1120, width: "100%" },
  pageTitle: { fontSize: "1.65em", fontWeight: 800, color: "#0f172a", margin: 0, letterSpacing: "-0.02em" },
  card: {
    background: "#ffffff",
    border: "1px solid #f1f5f9",
    borderRadius: 12,
    padding: 22,
    boxShadow: "0 1px 3px rgba(0,0,0,0.1)",
  },
  avatar: {
    width: 36,
    height: 36,
    borderRadius: "50%",
    background: "rgba(255,138,61, 0.12)",
    border: "1px solid rgba(255,138,61, 0.35)",
    display: "flex",
    alignItems: "center",
    justifyContent: "center",
    fontSize: "1.2em",
    flexShrink: 0,
  },
  notification: {
    position: "fixed",
    top: 20,
    right: 20,
    background: "#ffffff",
    border: "1px solid #86efac",
    borderRadius: 10,
    padding: "12px 18px",
    fontSize: ".82em",
    fontWeight: 700,
    color: "#15803d",
    zIndex: 200,
    boxShadow: "0 4px 20px rgba(15,23,42,0.12)",
  },
};


