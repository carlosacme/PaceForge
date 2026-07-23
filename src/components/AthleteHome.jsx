import React, { lazy, Suspense, useState, useEffect, useMemo, useCallback, useRef } from "react";
import { supabase } from "../lib/supabase";
import WeatherWidget, { useWeather } from "./WeatherWidget";
import IntervalsConnect from "./IntervalsConnect";
import {
  formatLocalYMD,
  calendarCellToIsoYmd,
  startOfWeekMonday,
  addDays,
  getMonthGrid,
  cellIsInViewMonth,
  normalizeAthlete,
  PLATFORM_ADMIN_USER_ID,
  DAYS,
  getRaceCountdownText,
  achievementJoinMeta,
  computeAchievementProgress,
  ATHLETE_ACHIEVEMENT_DISPLAY_LIST,
  computeAthleteAchievementVisualProgress,
  loadAthleteAchievementSnapshot,
  evaluateAndAwardAthleteAchievements,
  formatMessageTimestamp,
  clampWorkoutRpe,
  normalizeWorkoutRow,
  computeFormaFatigaWeeklyPoints,
  formaFatigaStatusFromPoint,
  resolveCoachUserIdFromPublicCode,
  sendChatPushNotification,
  normalizeScheduledDateYmd,
  formatDurationMinutesTotal,
  normalizeWorkoutStructure,
  emptyWorkoutStructureRow,
  workoutStructureToEditableRows,
  editableRowsToWorkoutStructure,
  normalizeLibraryRow,
  libraryRowToBuilderWorkout,
  challengeHasOpenTarget,
  challengeValueLabel,
  challengeProgressLabel,
  challengeProgressOpenText,
  formatChallengeMetricValue,
  challengeUnitByType,
  computeWorkoutDayStreak,
  computeChallengeProgressForAthlete,
  getNextRaceCountdown,
  normalizeRaceRow,
  extractJsonFromAnthropicText,
  RACE_DISTANCE_PRESETS,
  raceDistanceToFormFields,
  TAB_KEY_LIBRARY,
  CHALLENGE_TYPE_OPTIONS,
  normalizeChallengeType,
  computeGarminLoadMetricsFromWorkouts,
} from "./shared/appShared";

function normalizeSoloAthletePlanKey(athletePlan, subscriptionPeriod) {
  const planRaw = String(athletePlan ?? "").trim().toLowerCase();
  if (planRaw !== "premium") return "free";
  const periodRaw = String(subscriptionPeriod ?? "").trim().toLowerCase();
  if (periodRaw === "annual" || periodRaw === "anual" || periodRaw === "yearly") return "annual";
  return "monthly";
}

const SOLO_PLAN_MONTHLY_COP = 25000;
const SOLO_PLAN_ANNUAL_COP = 250000;
import { refreshFcmTokenIfGranted } from "../firebase.js";

function MarketplacePlanWorkoutsAccordion({ previewWorkouts, resetKey, lockAfterWeek1 = false }) {
  const list = Array.isArray(previewWorkouts) ? previewWorkouts : [];
  const [openWeeks, setOpenWeeks] = useState(() => new Set([1]));

  useEffect(() => {
    setOpenWeeks(new Set([lockAfterWeek1 ? 1 : (list[0]?.week ?? 1)]));
  }, [resetKey, lockAfterWeek1]);

  const weekGroups = useMemo(() => {
    const groups = new Map();
    list.forEach((w, i) => {
      const wn = w?.week != null && w.week !== "" ? Number(w.week) : NaN;
      const key = Number.isFinite(wn) && wn > 0 ? wn : 0;
      if (!groups.has(key)) groups.set(key, []);
      groups.get(key).push({ w, i });
    });
    return [...groups.entries()].sort((a, b) => {
      if (a[0] === 0) return 1;
      if (b[0] === 0) return -1;
      return a[0] - b[0];
    });
  }, [previewWorkouts]);

  if (list.length === 0) {
    return <div style={{ color: "#94a3b8", fontSize: ".82em", marginBottom: 12 }}>No hay workouts en este plan.</div>;
  }

  return (
    <div style={{ display: "flex", flexDirection: "column", gap: 6, marginBottom: 12 }}>
      {weekGroups.map(([weekKey, items]) => {
        const open = openWeeks.has(weekKey);
        const label = weekKey === 0 ? "Sin número de semana" : `Semana ${weekKey}`;
        const isLocked = lockAfterWeek1 && weekKey !== 1 && weekKey !== 0;
        return (
          <div key={weekKey} style={{ border: "1px solid #e2e8f0", borderRadius: 10, overflow: "hidden" }}>
            <button
              type="button"
              onClick={() => {
                if (isLocked) return;
                setOpenWeeks((prev) => {
                  if (prev.has(weekKey) && prev.size === 1) return new Set();
                  return new Set([weekKey]);
                });
              }}
              style={{
                width: "100%",
                textAlign: "left",
                padding: "10px 12px",
                border: "none",
                background: open ? "#f1f5f9" : "#fff",
                fontWeight: 800,
                fontSize: ".82em",
                color: isLocked ? "#94a3b8" : "#0f172a",
                cursor: isLocked ? "default" : "pointer",
                fontFamily: "inherit",
                display: "flex",
                justifyContent: "space-between",
                alignItems: "center",
              }}
            >
              <span>
                {label}
                {isLocked ? " 🔒" : ""}
                <span style={{ fontWeight: 600, color: "#64748b", marginLeft: 6 }}>
                  ({items.length} {items.length === 1 ? "sesión" : "sesiones"})
                </span>
              </span>
              {!isLocked && <span style={{ fontSize: ".75em", color: "#64748b" }}>{open ? "▾" : "▸"}</span>}
            </button>
            {open && !isLocked ? (
              <div style={{ padding: "8px 10px 10px", background: "#fafafa", display: "grid", gap: 8 }}>
                {items.map(({ w, i }) => (
                  <div key={i} style={{ border: "1px solid #e2e8f0", borderRadius: 8, padding: "8px 10px", background: "#fff" }}>
                    <div style={{ fontWeight: 800, fontSize: ".85em" }}>
                      {w.day ? `${w.day} · ` : ""}{w.title || `Sesión ${i + 1}`}
                    </div>
                    {w.description ? (
                      <div style={{ fontSize: ".78em", color: "#475569", marginTop: 4, lineHeight: 1.4 }}>{w.description}</div>
                    ) : null}
                    {(w.distance_km || w.duration_min || w.pace_range) ? (
                      <div style={{ fontSize: ".75em", color: "#64748b", marginTop: 4 }}>
                        {[
                          w.pace_range ? `${w.pace_range} min/km` : null,
                          w.distance_km ? `${w.distance_km} km` : null,
                          w.duration_min ? `${w.duration_min} min` : null,
                        ].filter(Boolean).join(" · ")}
                      </div>
                    ) : null}
                  </div>
                ))}
              </div>
            ) : null}
          </div>
        );
      })}
    </div>
  );
}
const ChallengesHub = lazy(() => import("./ChallengesHub"));
const MarketplaceHub = lazy(() => import("./MarketplaceHub"));
const EvaluationView = lazy(() => import("./EvaluationView"));

const RAF_ATHLETE_NAV_TAB_KEY = "raf_athlete_tab";
const RAF_ATHLETE_EVAL_OPEN_KEY = "raf_athlete_eval_open";
const ATHLETE_NAV_TAB_IDS = ["home", "marketplace", "challenges", "eval", "profile"];

function readStoredAthleteNavTab() {
  if (typeof localStorage === "undefined") return "home";
  const raw = localStorage.getItem(RAF_ATHLETE_NAV_TAB_KEY);
  if (raw && ATHLETE_NAV_TAB_IDS.includes(raw)) return raw;
  return "home";
}

const RAF_ATHLETE_PROFILE_TAB_KEY = "raf_athlete_profile_tab";
const ATHLETE_PROFILE_TAB_IDS = ["logros", "forma", "mes", "config", "pagos"];
function readStoredAthleteProfileTab() {
  if (typeof localStorage === "undefined") return "logros";
  const raw = localStorage.getItem(RAF_ATHLETE_PROFILE_TAB_KEY);
  if (raw && ATHLETE_PROFILE_TAB_IDS.includes(raw)) return raw;
  return "logros";
}

const RAF_ATHLETE_PROGRESS_TAB_KEY = "raf_athlete_progress_tab";
const ATHLETE_PROGRESS_TAB_IDS = ["week", "month", "year"];
function readStoredAthleteProgressTab() {
  if (typeof localStorage === "undefined") return "week";
  const raw = localStorage.getItem(RAF_ATHLETE_PROGRESS_TAB_KEY);
  if (raw && ATHLETE_PROGRESS_TAB_IDS.includes(raw)) return raw;
  return "week";
}

function FormaFatigaLineChart({ chronological }) {
  const n = chronological.length;
  const W = 360;
  const H = 160;
  const padL = 36;
  const padR = 12;
  const padT = 14;
  const padB = 28;
  const innerW = W - padL - padR;
  const innerH = H - padT - padB;
  const xs = n <= 1 ? [padL + innerW / 2] : chronological.map((_, idx) => padL + (innerW * idx) / (n - 1));
  const vals = [];
  chronological.forEach((p) => {
    vals.push(p.acute ?? 0, p.chronic ?? 0, p.forma ?? 0);
  });
  const minV = Math.min(0, ...vals);
  const maxV = Math.max(1e-6, ...vals);
  const span = maxV - minV || 1;
  const toY = (v) => padT + innerH - ((v - minV) / span) * innerH;
  const linePoints = (key) =>
    chronological
      .map((p, idx) => {
        const v = p[key] ?? 0;
        return `${xs[idx]},${toY(v)}`;
      })
      .join(" ");
  return (
    <svg viewBox={`0 0 ${W} ${H}`} role="img" aria-label="Carga aguda, crónica y forma en las últimas 8 semanas" style={{ width: "100%", maxWidth: 520, height: "auto", display: "block" }}>
      <rect x={0} y={0} width={W} height={H} fill="#f8fafc" rx={8} />
      {[0, 0.25, 0.5, 0.75, 1].map((t) => {
        const y = padT + innerH * (1 - t);
        const gv = minV + span * t;
        return (
          <g key={t}>
            <line x1={padL} y1={y} x2={W - padR} y2={y} stroke="rgba(148,163,184,.15)" strokeWidth={1} />
            <text x={4} y={y + 4} fill="#64748b" fontSize={9} fontFamily="system-ui,sans-serif">
              {gv.toFixed(0)}
            </text>
          </g>
        );
      })}
      <polyline fill="none" stroke="#ef4444" strokeWidth={2} strokeLinejoin="round" strokeLinecap="round" points={linePoints("acute")} />
      <polyline fill="none" stroke="#3b82f6" strokeWidth={2} strokeLinejoin="round" strokeLinecap="round" points={linePoints("chronic")} />
      <polyline fill="none" stroke="#22c55e" strokeWidth={2} strokeLinejoin="round" strokeLinecap="round" points={linePoints("forma")} />
      {chronological.map((p, idx) => (
        <text key={p.i} x={xs[idx]} y={H - 6} fill="#64748b" fontSize={8} fontFamily="system-ui,sans-serif" textAnchor="middle">
          {p.label}
        </text>
      ))}
    </svg>
  );
}

const styles = {
  page: { padding: "28px 32px", maxWidth: 1120, width: "100%" },
  pageTitle: { fontSize: "1.65em", fontWeight: 800, color: "#0f172a", margin: 0, letterSpacing: "-0.02em" },
  card: {
    background: "#ffffff",
    border: "1px solid #f1f5f9",
    borderRadius: 12,
    padding: 22,
    boxShadow: "0 1px 3px rgba(0,0,0,0.1)",
  },
};

export default function AthleteHome({ profile }) {
  const S = styles;
  const EMPTY_ARRAY = useMemo(() => [], []);
  const notifyCallback = useCallback((msg) => setMessage(msg), []);
  const normalizeWorkoutRowStable = useCallback(normalizeWorkoutRow, []);
  const [athleteInfo, setAthleteInfo] = useState(null);
  const [coachName, setCoachName] = useState(null);
  const [coachCodeInput, setCoachCodeInput] = useState("");
  const [coachCodeSaving, setCoachCodeSaving] = useState(false);
  const [coachCodeMsg, setCoachCodeMsg] = useState("");
  const [coachDirectory, setCoachDirectory] = useState([]);
  const [coachDirLoading, setCoachDirLoading] = useState(false);
  const [workouts, setWorkouts] = useState([]);
  const [loading, setLoading] = useState(true);
  const [message, setMessage] = useState("");
  const [athleteChatMessages, setAthleteChatMessages] = useState([]);
  const [athleteChatDraft, setAthleteChatDraft] = useState("");
  const [athleteChatSending, setAthleteChatSending] = useState(false);
  const [corosModalOpen, setCorosModalOpen] = useState(false);
  const [garminModalOpen, setGarminModalOpen] = useState(false);
  const [showPlanModal, setShowPlanModal] = useState(false);
  const [soloPayInstructions, setSoloPayInstructions] = useState(null);
  const [athleteNotRegistered, setAthleteNotRegistered] = useState(false);
  const [showEvaluation, setShowEvaluation] = useState(false);
  const [athleteActiveTab, setAthleteActiveTab] = useState(() => readStoredAthleteNavTab());
  const [athleteProfileTab, setAthleteProfileTab] = useState(() => readStoredAthleteProfileTab());
  const [athleteChatOpen, setAthleteChatOpen] = useState(false);
  const [athleteTabRestored, setAthleteTabRestored] = useState(false);
  const [achievementsCatalog, setAchievementsCatalog] = useState([]);
  const [earnedAchievements, setEarnedAchievements] = useState([]);
  const [achProgress, setAchProgress] = useState(null);
  const [athleteEvaluations, setAthleteEvaluations] = useState([]);
  const [medalToast, setMedalToast] = useState("");
  const [athletePayments, setAthletePayments] = useState([]);
  const [loadingAthletePayments, setLoadingAthletePayments] = useState(false);
  const [pushInviteDismissed, setPushInviteDismissed] = useState(() =>
    typeof localStorage !== "undefined" && localStorage.getItem("raf_push_invite_dismissed") === "1",
  );
  const athleteChatScrollRef = useRef(null);
  const [athleteCalendarCtxMenu, setAthleteCalendarCtxMenu] = useState(null);
  const athleteCalendarCtxMenuRef = useRef(null);
  const [not100Modal, setNot100Modal] = useState(null);
  const [avatarUploading, setAvatarUploading] = useState(false);
  const [not100Form, setNot100Form] = useState({ reason: "", level: "medio" });
  const [not100Sending, setNot100Sending] = useState(false);
  const [briefingModal, setBriefingModal] = useState(null);
  const [briefingText, setBriefingText] = useState("");
  const [briefingLoading, setBriefingLoading] = useState(false);
  const { weather, getWorkoutWeatherNote } = useWeather();
  const [athleteChatClearing, setAthleteChatClearing] = useState(false);
  const [intervalsConnected, setIntervalsConnected] = useState(false);
  const [forceManualFields, setForceManualFields] = useState(false);
  const [findCoachCodeInput, setFindCoachCodeInput] = useState("");
  const [findCoachCodeBusy, setFindCoachCodeBusy] = useState(false);
  const [publicCoachesAthlete, setPublicCoachesAthlete] = useState([]);
  const [loadingPublicCoachesAthlete, setLoadingPublicCoachesAthlete] = useState(false);
  const [selectCoachBusyId, setSelectCoachBusyId] = useState("");
  const [coachAssignSuccess, setCoachAssignSuccess] = useState("");
  const [workoutSummaryModal, setWorkoutSummaryModal] = useState(null);
  const [manualSummaryForm, setManualSummaryForm] = useState({
    distanceKm: "",
    durationMin: "",
    rpe: "",
    avgHr: "",
    maxHr: "",
    calories: "",
    feeling: "😐 Normal",
    notes: "",
  });
  const [manualSummarySaving, setManualSummarySaving] = useState(false);
  const [athleteProgressTab, setAthleteProgressTab] = useState(() => readStoredAthleteProgressTab());

  const profileUserId = profile?.user_id ?? null;

  useEffect(() => {
    if (typeof localStorage === "undefined") {
      setAthleteTabRestored(true);
      return;
    }
    let evalOpen = localStorage.getItem(RAF_ATHLETE_EVAL_OPEN_KEY);
    if (evalOpen == null) {
      const legacy = localStorage.getItem(RAF_ATHLETE_NAV_TAB_KEY);
      if (legacy === "evaluation" || legacy === "home") {
        localStorage.setItem(RAF_ATHLETE_EVAL_OPEN_KEY, legacy);
        evalOpen = legacy;
        if (legacy === "evaluation") {
          localStorage.setItem(RAF_ATHLETE_NAV_TAB_KEY, "home");
        }
      }
    }
    if (evalOpen === "evaluation") setShowEvaluation(true);
    if (evalOpen === "home") setShowEvaluation(false);
    setAthleteTabRestored(true);
  }, []);

  useEffect(() => {
    if (!athleteTabRestored || typeof localStorage === "undefined") return;
    localStorage.setItem(RAF_ATHLETE_EVAL_OPEN_KEY, showEvaluation ? "evaluation" : "home");
  }, [showEvaluation, athleteTabRestored]);

  useEffect(() => {
    if (!athleteTabRestored) return undefined;
    if (typeof document === "undefined" || typeof localStorage === "undefined") return undefined;
    const onVisibilityChange = () => {
      if (document.visibilityState !== "hidden") return;
      localStorage.setItem(RAF_ATHLETE_EVAL_OPEN_KEY, showEvaluation ? "evaluation" : "home");
    };
    document.addEventListener("visibilitychange", onVisibilityChange);
    return () => { document.removeEventListener("visibilitychange", onVisibilityChange); };
  }, [showEvaluation, athleteTabRestored]);

  useEffect(() => {
    if (typeof localStorage === "undefined") return;
    localStorage.setItem(RAF_ATHLETE_PROFILE_TAB_KEY, athleteProfileTab);
  }, [athleteProfileTab]);

  useEffect(() => {
    if (typeof localStorage === "undefined") return;
    localStorage.setItem(RAF_ATHLETE_PROGRESS_TAB_KEY, athleteProgressTab);
  }, [athleteProgressTab]);

  const prevProfileUserIdRef = useRef(null);

  useEffect(() => {
    if (profileUserId == null) {
      prevProfileUserIdRef.current = null;
      setAthleteInfo(null);
      setWorkouts([]);
      setAthleteEvaluations([]);
      setLoading(false);
      return;
    }
    if (prevProfileUserIdRef.current === profileUserId) return;
    let cancelled = false;
    const markInitialLoadFinished = () => { if (!cancelled) prevProfileUserIdRef.current = profileUserId; };
    const load = async () => {
      setLoading(true);
      setMessage("");
      setCoachAssignSuccess("");
      setAthleteNotRegistered(false);
      const { data: authData, error: authErr } = await supabase.auth.getUser();
      if (cancelled) return;
      const userEmail = authData?.user?.email?.trim();
      if (authErr || !userEmail) {
        console.error("Error obteniendo sesión:", authErr);
        setAthleteInfo(null); setWorkouts([]); setAthleteEvaluations([]); setLoading(false);
        if (!userEmail) setMessage("No se pudo obtener el email de tu cuenta.");
        return;
      }
      const { data: athleteRows, error: athleteErr } = await supabase.from("athletes").select("*").ilike("email", userEmail).limit(1);
      if (cancelled) return;
      if (athleteErr) {
        console.error("Error cargando atleta:", athleteErr);
        setAthleteInfo(null); setWorkouts([]); setAthleteEvaluations([]); setLoading(false);
        return;
      }
      const athleteRow = athleteRows?.[0];
      if (!athleteRow) {
        setAthleteInfo(null); setWorkouts([]); setAthleteEvaluations([]);
        setAthleteNotRegistered(true); setLoading(false);
        markInitialLoadFinished();
        return;
      }
      setAthleteInfo(athleteRow);
      if (authData?.user?.id) {
        const { error: linkErr } = await supabase.from("athletes").update({ user_id: authData.user.id }).eq("id", athleteRow.id);
        if (linkErr) console.warn("[AthleteHome] link user_id:", linkErr);
        const tok = await refreshFcmTokenIfGranted();
        if (tok) await supabase.from("profiles").update({ fcm_token: tok }).eq("user_id", authData.user.id).limit(1);
      }
      const [wRes, eRes] = await Promise.all([
        supabase.from("workouts").select("*").eq("athlete_id", athleteRow.id).order("scheduled_date", { ascending: true }),
        supabase.from("athlete_evaluations").select("vdot, created_at").eq("athlete_id", athleteRow.id).order("created_at", { ascending: true }),
      ]);
      if (cancelled) return;
      const workoutsRows = wRes.data;
      const workoutsErr = wRes.error;
      const evalRows = eRes.data;
      if (eRes.error) console.warn("[AthleteHome] athlete_evaluations:", eRes.error);
      if (workoutsErr) {
        console.error("Error cargando workouts atleta:", workoutsErr);
        setWorkouts([]); setAthleteEvaluations(evalRows || []);
      } else {
        const normalizedWorkouts = (workoutsRows || []).map(normalizeWorkoutRow);
        setWorkouts(normalizedWorkouts);
        setAthleteEvaluations(evalRows || []);
        if ((normalizedWorkouts || []).some((w) => w.done)) {
          setTimeout(() => {
            if (cancelled) return;
            (async () => {
              try {
                const { snapshot, progress } = await evaluateAndAwardAthleteAchievements(athleteRow.id);
                if (cancelled) return;
                setAchievementsCatalog(snapshot.achievements || []);
                setEarnedAchievements(snapshot.earned || []);
                setAchProgress(progress || computeAchievementProgress(normalizedWorkouts.filter((w) => w.done)));
              } catch (e) { console.warn("[AthleteHome] evaluateAndAwardAthleteAchievements (fondo):", e); }
            })();
          }, 0);
        }
      }
      setLoading(false);
      markInitialLoadFinished();
    };
    load();
    return () => { cancelled = true; };
  }, [profileUserId]);

  const athleteCoachIdPrimitive = athleteInfo?.coach_id ?? null;
  const achievementDisplayProgress = useMemo(() => computeAthleteAchievementVisualProgress(workouts, athleteEvaluations), [workouts, athleteEvaluations]);
  const earnedAchievementDateByCode = useMemo(() => {
    const m = {};
    for (const row of earnedAchievements || []) {
      const code = String(row?.achievement_code || "");
      if (!code) continue;
      if (!m[code]) m[code] = row?.awarded_at || null;
    }
    return m;
  }, [earnedAchievements]);

  useEffect(() => {
    if (!athleteInfo?.id || athleteNotRegistered || athleteCoachIdPrimitive) { setPublicCoachesAthlete([]); return; }
    let cancelled = false;
    (async () => {
      setLoadingPublicCoachesAthlete(true);
      const { data, error } = await supabase.from("coach_profiles").select("user_id, full_name, avatar_url, city, country, subscription_plan").eq("is_public", true).order("updated_at", { ascending: false });
      if (cancelled) return;
      if (error) { console.error("[AthleteHome] coaches públicos:", error); setPublicCoachesAthlete([]); }
      else {
        const list = data || [];
        const sorted = [...list].sort((a, b) => {
          const ap = String(a.user_id) === PLATFORM_ADMIN_USER_ID ? 0 : 1;
          const bp = String(b.user_id) === PLATFORM_ADMIN_USER_ID ? 0 : 1;
          return ap - bp;
        });
        setPublicCoachesAthlete(sorted);
      }
      setLoadingPublicCoachesAthlete(false);
    })();
    return () => { cancelled = true; };
  }, [athleteInfo?.id, athleteNotRegistered, athleteCoachIdPrimitive]);

  const workoutsByDate = useMemo(() => {
    const m = {};
    for (const w of workouts) {
      const k = normalizeScheduledDateYmd(w.scheduled_date);
      if (!k) continue;
      if (!m[k]) m[k] = [];
      m[k].push(w);
    }
    return m;
  }, [workouts]);

  const [calendarViewMonth, setCalendarViewMonth] = useState(() => {
    const n = new Date();
    return { y: n.getFullYear(), m: n.getMonth() };
  });
  const calendarCells = useMemo(() => getMonthGrid(calendarViewMonth.y, calendarViewMonth.m), [calendarViewMonth.y, calendarViewMonth.m]);
  const calendarMonthLabel = useMemo(() => new Date(calendarViewMonth.y, calendarViewMonth.m, 1).toLocaleDateString("es-CO", { month: "long", year: "numeric" }), [calendarViewMonth.y, calendarViewMonth.m]);

  const [races, setRaces] = useState([]);
  useEffect(() => {
    if (!athleteInfo?.id) { setRaces([]); return; }
    let cancelled = false;
    (async () => {
      const { data, error } = await supabase.from("races").select("*").eq("athlete_id", athleteInfo.id).order("date", { ascending: true });
      if (cancelled) return;
      if (error) { console.error("Error cargando carreras (atleta):", error); setRaces([]); return; }
      setRaces((data || []).map(normalizeRaceRow));
    })();
    return () => { cancelled = true; };
  }, [athleteInfo?.id]);

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

  const athleteTodayYmd = calendarCellToIsoYmd(new Date());
  const nextRaceCountdownAthlete = useMemo(() => getNextRaceCountdown(races, athleteTodayYmd), [races, athleteTodayYmd]);
  const closeAthleteCalendarCtxMenu = () => setAthleteCalendarCtxMenu(null);
  const ctxMenuWorkoutId = athleteCalendarCtxMenu?.workoutId ?? null;
  const ctxMenuAthleteWorkout = useMemo(() => ctxMenuWorkoutId ? workouts.find((x) => String(x.id) === String(ctxMenuWorkoutId)) || null : null, [workouts, ctxMenuWorkoutId]);

  const openAthleteWorkoutMenu = (e, w) => {
    e.preventDefault();
    e.stopPropagation();
    const pad = 8; const mw = 260; const mh = 52;
    const vw = typeof window !== "undefined" ? window.innerWidth : 800;
    const vh = typeof window !== "undefined" ? window.innerHeight : 600;
    const x = Math.min(e.clientX, vw - mw - pad);
    const y = Math.min(e.clientY, vh - mh - pad);
    setAthleteCalendarCtxMenu({ x, y, workoutId: w.id });
  };

  const ctxMenuListenerKey = athleteCalendarCtxMenu ? `${athleteCalendarCtxMenu.workoutId}:${athleteCalendarCtxMenu.x}:${athleteCalendarCtxMenu.y}` : "";
  useEffect(() => {
    if (!ctxMenuListenerKey) return;
    const onDown = (ev) => { if (athleteCalendarCtxMenuRef.current?.contains(ev.target)) return; closeAthleteCalendarCtxMenu(); };
    const t = setTimeout(() => document.addEventListener("mousedown", onDown), 0);
    return () => { clearTimeout(t); document.removeEventListener("mousedown", onDown); };
  }, [ctxMenuListenerKey]);

  const athleteProgressRangeYmd = useMemo(() => {
    const now = new Date();
    if (athleteProgressTab === "week") {
      const start = startOfWeekMonday(now);
      return { startYmd: formatLocalYMD(start), endYmd: formatLocalYMD(addDays(start, 6)) };
    }
    if (athleteProgressTab === "month") {
      const start = new Date(now.getFullYear(), now.getMonth(), 1);
      const end = new Date(now.getFullYear(), now.getMonth() + 1, 0);
      return { startYmd: formatLocalYMD(start), endYmd: formatLocalYMD(end) };
    }
    return { startYmd: formatLocalYMD(new Date(now.getFullYear(), 0, 1)), endYmd: formatLocalYMD(new Date(now.getFullYear(), 11, 31)) };
  }, [athleteProgressTab, athleteTodayYmd]);

  const athleteProgressStats = useMemo(() => {
    const { startYmd, endYmd } = athleteProgressRangeYmd;
    const doneInRange = workouts.filter((w) => {
      const ymd = normalizeScheduledDateYmd(w.scheduled_date);
      return ymd && ymd >= startYmd && ymd <= endYmd && w.done;
    });
    const totalKm = doneInRange.reduce((s, w) => s + (Number(w.distance_km) || 0), 0);
    const totalMin = doneInRange.reduce((s, w) => s + (Number(w.duration_min) || 0), 0);
    return { sessions: doneInRange.length, totalKm, totalMin, rangeLabel: `${startYmd} → ${endYmd}` };
  }, [workouts, athleteProgressRangeYmd]);

  const last4WeeksSummary = useMemo(() => {
    const rows = [];
    const currentStart = startOfWeekMonday(new Date());
    for (let i = 0; i < 4; i += 1) {
      const start = addDays(currentStart, -(i * 7));
      const end = addDays(start, 6);
      const startYmd = formatLocalYMD(start);
      const endYmd = formatLocalYMD(end);
      const weekRows = workouts.filter((w) => {
        const ymd = normalizeScheduledDateYmd(w.scheduled_date);
        return ymd && ymd >= startYmd && ymd <= endYmd;
      });
      const kmTotal = weekRows.reduce((sum, w) => sum + (Number(w.total_km) || 0), 0);
      const completed = weekRows.filter((w) => w.done).length;
      const adherence = weekRows.length > 0 ? Math.round((completed / weekRows.length) * 100) : 0;
      rows.push({ key: `${startYmd}-${endYmd}`, label: i === 0 ? "Semana actual" : `Hace ${i} semana${i === 1 ? "" : "s"}`, range: `${startYmd} → ${endYmd}`, kmTotal, completed, total: weekRows.length, adherence });
    }
    return rows;
  }, [workouts]);

  const workoutsAchSyncKey = useMemo(() => (workouts || []).map((w) => `${w.id}:${w.done ? 1 : 0}:${w.rpe ?? ""}`).join("|"), [workouts]);

  const openWorkoutSummaryModal = (workoutRow) => {
    if (!workoutRow?.scheduled_date) return;
    void loadIntervalsConnected();
    const baseManual = {
      distanceKm: (!intervalsConnected && workoutRow.total_km) ? String(workoutRow.total_km) : "",
      durationMin: (!intervalsConnected && workoutRow.duration_min) ? String(workoutRow.duration_min) : "",
      rpe: workoutRow.rpe != null ? String(workoutRow.rpe) : "",
      avgHr: workoutRow.manual_avg_hr != null ? String(workoutRow.manual_avg_hr) : "",
      maxHr: workoutRow.manual_max_hr != null ? String(workoutRow.manual_max_hr) : "",
      calories: workoutRow.manual_calories != null ? String(workoutRow.manual_calories) : "",
      feeling: "😐 Normal",
      notes: workoutRow.athlete_notes || "",
    };
    setManualSummaryForm(baseManual);
    setWorkoutSummaryModal({ workout: workoutRow });
  };

  const saveManualWorkoutSummary = async () => {
    const workoutRow = workoutSummaryModal?.workout;
    if (!workoutRow?.id) return;
    const parsedDistance = Number(manualSummaryForm.distanceKm);
    const durationMin = Math.round(Number(manualSummaryForm.durationMin) || 0);
    const parsedRpe = clampWorkoutRpe(manualSummaryForm.rpe);
    const avgHr = Math.round(Number(manualSummaryForm.avgHr) || 0);
    const maxHr = Math.round(Number(manualSummaryForm.maxHr) || 0);
    const calories = Math.round(Number(manualSummaryForm.calories) || 0);
    const feelings = ["😴 Muy cansado", "😕 Cansado", "😐 Normal", "🙂 Bien", "💪 Excelente"];
    const feelingText = feelings.includes(manualSummaryForm.feeling) ? manualSummaryForm.feeling : "😐 Normal";
    const notesBody = manualSummaryForm.notes.trim();
    const athleteNotes = [`Cómo me sentí: ${feelingText}`, notesBody].filter(Boolean).join("\n");
    const payload = {
      manual_distance_km: Number.isFinite(parsedDistance) && parsedDistance > 0 ? parsedDistance : null,
      manual_duration_min: Number.isFinite(durationMin) && durationMin > 0 ? durationMin : null,
      manual_avg_hr: Number.isFinite(avgHr) && avgHr > 0 ? avgHr : null,
      manual_max_hr: Number.isFinite(maxHr) && maxHr > 0 ? maxHr : null,
      manual_calories: Number.isFinite(calories) && calories > 0 ? calories : null,
      athlete_notes: athleteNotes,
      total_km: Number.isFinite(parsedDistance) && parsedDistance > 0 ? parsedDistance : workoutRow.total_km,
      duration_min: Number.isFinite(durationMin) && durationMin > 0 ? durationMin : workoutRow.duration_min,
      rpe: parsedRpe ?? workoutRow.rpe ?? null,
      completed_at: new Date().toISOString(),
      done: true,
    };
    setManualSummarySaving(true);
    const { error } = await supabase.from("workouts").update(payload).eq("id", workoutRow.id);
    setManualSummarySaving(false);
    if (error) {
      setMessage(error.message || "No se pudo guardar el resumen.");
      return;
    }
    setWorkouts((prev) => prev.map((w) => (String(w.id) === String(workoutRow.id) ? normalizeWorkoutRow({ ...w, ...payload }) : w)));
    closeWorkoutModal();
  };

  const toggleDone = async (w) => {
    const next = !w.done;
    const payload = next ? { done: true } : { done: false, rpe: null };
    const nextWorkouts = workouts.map((x) => (x.id === w.id ? { ...x, done: next, rpe: next ? x.rpe : null } : x));
    setWorkouts(nextWorkouts);
    const { error } = await supabase.from("workouts").update(payload).eq("id", w.id);
    if (error) {
      console.error("Error actualizando workout:", error);
      setWorkouts(prev => prev.map(x => (x.id === w.id ? { ...x, done: !next, rpe: w.rpe } : x)));
      setMessage(`Error actualizando workout: ${error.message}`);
      return;
    }
    if (next && athleteInfo?.id) {
      try {
        if (athleteInfo?.coach_id) {
          await sendChatPushNotification({ toUserId: athleteInfo.coach_id, title: "✅ Workout completado", body: `${athleteInfo.name || "Atleta"} completó: ${w.title || "Workout"}`, data: { type: "coach_athlete", athlete_id: athleteInfo.id }, logLabel: "workout done athlete→coach" });
        }
      } catch (_) {}
      // Fire and forget: intenta traer lo ejecutado del reloj (intervals.icu).
      // Si el atleta no lo tiene conectado o aun no sincronizo, falla en
      // silencio y NO debe romper el marcado ni el modal de resumen.
      try {
        const { data: { session } } = await supabase.auth.getSession();
        if (session?.access_token) {
          fetch("/api/integrations", {
            method: "POST",
            headers: {
              "Content-Type": "application/json",
              Authorization: `Bearer ${session.access_token}`,
            },
            body: JSON.stringify({
              action: "pull-activity",
              athlete_id: athleteInfo.id,
              workout_id: w.id,
            }),
          }).catch(() => {});
        }
      } catch {}
      const { newAwards, snapshot, progress } = await evaluateAndAwardAthleteAchievements(athleteInfo.id);
      if (progress) void progress;
      setAchievementsCatalog(snapshot.achievements || []);
      setEarnedAchievements(snapshot.earned || []);
      setAchProgress(progress || computeAchievementProgress(nextWorkouts.filter((x) => x.done)));
      if (newAwards.length > 0) {
        const first = achievementJoinMeta(newAwards[0]);
        setMedalToast(`¡Nueva medalla desbloqueada! 🎉 ${first?.icon || ""} ${first?.name || ""}`.trim());
        setTimeout(() => setMedalToast(""), 4200);
      }
      openWorkoutSummaryModal({ ...w, done: true, rpe: next ? w.rpe : null });
    }
    // Notificar coach cuando el atleta desmarca un workout (sesion perdida)
    if (!next && athleteInfo?.coach_id) {
      try {
        await sendChatPushNotification({
          toUserId: athleteInfo.coach_id,
          title: "⚠️ Sesion no completada",
          body: `${athleteInfo.name || "Atleta"} no completo: ${w.title || "Workout"} (${w.total_km || 0} km). Puede requerir ajuste de plan.`,
          data: { type: "coach_athlete", athlete_id: athleteInfo.id },
          logLabel: "workout missed athlete→coach",
        });
      } catch (_) {}
    }
  };

  const saveWorkoutRpe = async (w, rawVal) => {
    if (!w.done) return;
    const rpe = clampWorkoutRpe(rawVal);
    if (rpe == null) return;
    setWorkouts((prev) => prev.map((x) => (x.id === w.id ? { ...x, rpe } : x)));
    const { error } = await supabase.from("workouts").update({ rpe }).eq("id", w.id);
    if (error) {
      console.error("Error guardando RPE:", error);
      setWorkouts((prev) => prev.map((x) => (x.id === w.id ? { ...x, rpe: w.rpe } : x)));
      setMessage(`Error guardando RPE: ${error.message}`);
      return;
    }
    if (athleteInfo?.id) {
      const { newAwards, snapshot, progress } = await evaluateAndAwardAthleteAchievements(athleteInfo.id);
      setAchievementsCatalog(snapshot.achievements || []);
      setEarnedAchievements(snapshot.earned || []);
      setAchProgress(progress);
      if (newAwards.length > 0) {
        const first = achievementJoinMeta(newAwards[0]);
        setMedalToast(`¡Nueva medalla desbloqueada! 🎉 ${first?.icon || ""} ${first?.name || ""}`.trim());
        setTimeout(() => setMedalToast(""), 4200);
      }
    }
  };

  const hasPremiumAccess = useMemo(() => {
    const isAthleteOfAdminCoach = athleteInfo?.coach_id === "b5c9e44a-6695-4800-99bd-f19b05d2f66f";
    return isAthleteOfAdminCoach || String(athleteInfo?.athlete_plan).toLowerCase() === "premium";
  }, [athleteInfo?.coach_id, athleteInfo?.athlete_plan]);

  useEffect(() => {
    if (!athleteTabRestored || !athleteInfo?.id) return;
    // Opcion C: 1 evaluacion gratis, despues requiere premium
    if (!hasPremiumAccess && athleteEvaluations.length >= 1) setShowEvaluation(false);
  }, [athleteInfo?.id, athleteInfo?.athlete_plan, athleteInfo?.coach_id, athleteTabRestored, hasPremiumAccess]);

  const athleteFormaFatigaPoints = useMemo(() => computeFormaFatigaWeeklyPoints(workouts), [workouts]);
  const athleteFormaFatigaChronological = useMemo(() => [...athleteFormaFatigaPoints].reverse(), [athleteFormaFatigaPoints]);
  const athleteFormaFatigaStatus = useMemo(() => formaFatigaStatusFromPoint(athleteFormaFatigaPoints[0]), [athleteFormaFatigaPoints]);
  const athleteFormaFatigaTableRows = useMemo(() => athleteFormaFatigaPoints.slice(0, 4), [athleteFormaFatigaPoints]);
  const athleteLoadGarminMetrics = useMemo(() => computeGarminLoadMetricsFromWorkouts(workouts), [workouts]);

  const hasCoachPremiumIncluded = useMemo(() => {
    const uid = profile?.user_id;
    const cid = profile?.coach_id;
    if (cid == null) return false;
    const c = String(cid).trim();
    if (c === "") return false;
    if (uid != null && c === String(uid).trim()) return false;
    return true;
  }, [profile?.coach_id, profile?.user_id]);

  // Cargar nombre del coach si el atleta tiene uno asignado
  useEffect(() => {
    if (!profile?.coach_id) {
      setCoachName(null);
      return;
    }
    let cancelled = false;
    (async () => {
      const { data } = await supabase
        .from("coach_public")
        .select("name")
        .eq("user_id", profile.coach_id)
        .maybeSingle();
      if (!cancelled && data?.name) setCoachName(data.name);
    })();
    return () => { cancelled = true; };
  }, [profile?.coach_id]);

  const soloAthletePlanKey = useMemo(() => normalizeSoloAthletePlanKey(profile?.athlete_plan ?? athleteInfo?.athlete_plan, profile?.subscription_period ?? athleteInfo?.subscription_period), [profile?.athlete_plan, athleteInfo?.athlete_plan, profile?.subscription_period, athleteInfo?.subscription_period]);

  const subscriptionExpiresFormatted = useMemo(() => {
    const raw = profile?.subscription_expires_at;
    if (!raw) return null;
    const d = new Date(raw);
    if (Number.isNaN(d.getTime())) return null;
    return d.toLocaleDateString("es-CO", { day: "numeric", month: "long", year: "numeric" });
  }, [profile?.subscription_expires_at]);

  const openAthletePremiumWa = (periodLabel, amountCopText) => {
    const text = `Hola, quiero activar el plan Premium Atleta ${periodLabel} por ${amountCopText} COP`;
    window.open(`https://wa.me/573233675434?text=${encodeURIComponent(text)}`, "_blank", "noopener,noreferrer");
  };

  const trySoloIndependentCheckout = async (period) => {
    const amountCop = period === "annual" ? SOLO_PLAN_ANNUAL_COP : SOLO_PLAN_MONTHLY_COP;
    try {
      const { data: sessData } = await supabase.auth.getSession();
      const accessToken = sessData?.session?.access_token;
      if (!accessToken) { setMessage("Tu sesión expiró. Vuelve a iniciar sesión."); return; }
      const response = await fetch("/api/wompi-create-checkout", {
        method: "POST",
        headers: { "Content-Type": "application/json", Authorization: `Bearer ${accessToken}` },
        body: JSON.stringify({ payer_type: "athlete_solo_subscription", plan_key: "premium", plan_period: period === "annual" ? "annual" : "monthly", amount_cop: amountCop }),
      });
      const data = await response.json();
      if (!response.ok) { console.error("create-checkout error:", data); setMessage(data?.error || "No se pudo iniciar el pago."); return; }
      const params = new URLSearchParams({ "public-key": data.public_key, currency: data.currency, "amount-in-cents": String(data.amount_in_cents), reference: data.reference, "signature:integrity": data.signature, "redirect-url": data.redirect_url });
      if (data.customer_email) params.set("customer-data:email", data.customer_email);
      window.location.href = `https://checkout.wompi.co/p/?${params.toString()}`;
    } catch (e) { console.error("trySoloIndependentCheckout exception:", e); setMessage("Error al iniciar el pago."); }
  };

  const athleteName = profile?.name || athleteInfo?.name || "Atleta";
  const handleAthleteNavTabChange = (tabId) => {
    setAthleteChatOpen(false);
    setAthleteActiveTab(tabId);
    if (typeof localStorage !== "undefined") localStorage.setItem(RAF_ATHLETE_NAV_TAB_KEY, tabId);
  };

  // Deep link desde notificaciones push (tipos athlete_*). Usa
  // handleAthleteNavTabChange para que persista el tab igual que un cambio
  // manual. Consume el parametro para no reprocesarlo en recargas.
  useEffect(() => {
    if (typeof window === "undefined") return;
    const params = new URLSearchParams(window.location.search);
    const open = params.get("open");
    if (!open || !open.startsWith("athlete_")) return;

    if (open === "athlete_calendar") {
      handleAthleteNavTabChange("home");
    } else if (open === "athlete_chat") {
      handleAthleteNavTabChange("home");
      setAthleteChatOpen(true);
    }

    params.delete("open"); params.delete("athlete_id"); params.delete("workout_id");
    const qs = params.toString();
    window.history.replaceState({}, "", window.location.pathname + (qs ? `?${qs}` : ""));
  }, []);
  const nextRaceText = athleteInfo?.next_race ? `🏁 ${getRaceCountdownText(athleteInfo.next_race)}` : "🏁 Próxima carrera · fecha pendiente";
  const coachIdForChat = athleteInfo?.coach_id || null;

  const loadAthleteChat = useCallback(async () => {
    if (!athleteInfo?.id || !coachIdForChat) { setAthleteChatMessages([]); return; }
    const { data, error } = await supabase.from("messages").select("*").eq("athlete_id", athleteInfo.id).eq("coach_id", coachIdForChat).order("created_at", { ascending: true });
    if (error) { console.error("Error cargando chat atleta:", error); return; }
    const rows = data || [];
    // Fusiona: conserva los optimistas que aun NO tienen su fila real en la BD
    // (evita el parpadeo de duplicado entre el optimista y el reload).
    setAthleteChatMessages((prev) => {
      const pendientes = prev.filter((m) => {
        if (!m._pending) return false;
        return !rows.some((r) => r.body === m.body && r.sender_role === m.sender_role);
      });
      return [...rows, ...pendientes];
    });
  }, [athleteInfo?.id, coachIdForChat]);

  const loadMyPayments = useCallback(async () => {
    if (!athleteInfo?.id) { setAthletePayments([]); return; }
    setLoadingAthletePayments(true);
    const { data, error } = await supabase.from("athlete_payments").select("*").eq("athlete_id", athleteInfo.id).order("payment_date", { ascending: false }).order("created_at", { ascending: false });
    setLoadingAthletePayments(false);
    if (error) { console.error("Error cargando pagos del atleta:", error); setAthletePayments([]); return; }
    setAthletePayments(data || []);
  }, [athleteInfo?.id]);

  const loadIntervalsConnected = useCallback(async () => {
    if (!athleteInfo?.id) { setIntervalsConnected(false); return; }
    try {
      const { data: { session } } = await supabase.auth.getSession();
      if (!session?.access_token) { setIntervalsConnected(false); return; }
      const res = await fetch("/api/integrations", {
        method: "POST",
        headers: { "Content-Type": "application/json", Authorization: `Bearer ${session.access_token}` },
        body: JSON.stringify({ action: "status", athlete_id: athleteInfo.id }),
      });
      const d = await res.json().catch(() => ({}));
      setIntervalsConnected(Boolean(res.ok && d?.connected));
    } catch { setIntervalsConnected(false); }
  }, [athleteInfo?.id]);

  useEffect(() => { loadAthleteChat(); }, [loadAthleteChat]);
  useEffect(() => { loadMyPayments(); }, [loadMyPayments]);
  useEffect(() => { loadIntervalsConnected(); }, [loadIntervalsConnected]);

  useEffect(() => {
    let cancelled = false;
    const load = async () => {
      if (!athleteInfo?.id) { setAchievementsCatalog([]); setEarnedAchievements([]); setAchProgress(null); return; }
      const snapshot = await loadAthleteAchievementSnapshot(athleteInfo.id);
      if (cancelled) return;
      setAchievementsCatalog(snapshot.achievements || []);
      setEarnedAchievements(snapshot.earned || []);
      setAchProgress(computeAchievementProgress((workouts || []).filter((w) => w.done)));
    };
    load();
    return () => { cancelled = true; };
  }, [athleteInfo?.id, workoutsAchSyncKey]);

  useEffect(() => { const t = setInterval(() => loadAthleteChat(), 10000); return () => clearInterval(t); }, [loadAthleteChat]);
  useEffect(() => { if (!athleteChatScrollRef.current) return; athleteChatScrollRef.current.scrollTop = athleteChatScrollRef.current.scrollHeight; }, [athleteChatMessages]);

  const sendAthleteChat = async () => {
    const body = athleteChatDraft.trim();
    if (!body || !athleteInfo?.id || !coachIdForChat || athleteChatSending) return;
    setAthleteChatSending(true);
    // Optimistic: limpiar el input y mostrar el mensaje al instante.
    setAthleteChatDraft("");
    const optimistic = {
      id: `tmp-${Date.now()}`,
      athlete_id: athleteInfo.id,
      coach_id: coachIdForChat,
      sender_role: "athlete",
      body,
      created_at: new Date().toISOString(),
      _pending: true,
    };
    setAthleteChatMessages((prev) => [...prev, optimistic]);
    try {
      const { error } = await supabase.from("messages").insert({ athlete_id: athleteInfo.id, coach_id: coachIdForChat, sender_role: "athlete", body });
      if (error) {
        console.error(error);
        // Revertir el optimista y restaurar el texto en el input.
        setAthleteChatMessages((prev) => prev.filter((m) => m.id !== optimistic.id));
        setAthleteChatDraft(body);
        setMessage(`Error al enviar mensaje: ${error.message}`);
        return;
      }
      // Notificar sin bloquear la UI (fire and forget).
      sendChatPushNotification({ toUserId: coachIdForChat, title: `Tu atleta ${athleteName} respondió`, body, data: { type: "coach_chat", athlete_id: athleteInfo.id }, logLabel: "chat atleta→coach" }).catch(() => {});
      // Reconciliar el id real del mensaje optimista, sin await bloqueante.
      loadAthleteChat();
    } finally { setAthleteChatSending(false); }
  };

  const clearAthleteChat = async () => {
    if (!athleteInfo?.id || !coachIdForChat) return;
    if (!window.confirm("¿Estás seguro? Esto eliminará todos los mensajes de esta conversación.")) return;
    setAthleteChatClearing(true);
    try {
      const { error } = await supabase.from("messages").delete().eq("athlete_id", athleteInfo.id).eq("coach_id", coachIdForChat);
      if (error) { console.error(error); setMessage(error.message || "No se pudo limpiar el chat"); return; }
      setAthleteChatMessages([]);
    } finally { setAthleteChatClearing(false); }
  };

  const setAthleteDeviceConnection = async (deviceValue) => {
    if (!athleteInfo?.id) return;
    const { error } = await supabase.from("athletes").update({ device: deviceValue }).eq("id", athleteInfo.id);
    if (error) { console.error("Error actualizando dispositivo atleta:", error); setMessage(error.message || "No se pudo actualizar el dispositivo"); return; }
    setAthleteInfo((prev) => (prev ? { ...prev, device: deviceValue } : prev));
  };

  const athleteNeedsCoachLink = Boolean(athleteInfo) && !athleteNotRegistered && (athleteInfo.coach_id == null || athleteInfo.coach_id === "");

  const linkAthleteToCoach = async (coachUserId) => {
    if (!athleteInfo?.id || !profile?.user_id || !coachUserId) return false;
    setMessage("");
    const { error: eAth } = await supabase.from("athletes").update({ coach_id: coachUserId }).eq("id", athleteInfo.id);
    if (eAth) { setMessage(eAth.message || "No se pudo vincular el coach."); return false; }
    const { error: eProf } = await supabase.from("profiles").update({ coach_id: coachUserId }).eq("user_id", profile.user_id);
    if (eProf) { setMessage(eProf.message || "No se pudo actualizar tu perfil. Revisa permisos o contacta soporte."); return false; }
    setAthleteInfo((prev) => (prev ? { ...prev, coach_id: coachUserId } : prev));
    setCoachAssignSuccess("¡Coach asignado exitosamente! Ya puedes ver tus entrenamientos.");
    setTimeout(() => setCoachAssignSuccess(""), 8000);
    const { data: wRows, error: wErr } = await supabase.from("workouts").select("*").eq("athlete_id", athleteInfo.id).order("scheduled_date", { ascending: true });
    if (!wErr && wRows) setWorkouts((wRows || []).map(normalizeWorkoutRow));
    return true;
  };

  const connectCoachByCode = async () => {
    const code = findCoachCodeInput.trim().toUpperCase();
    if (!code) { setCoachCodeMsg("Ingresa el codigo de tu coach."); return; }
    setFindCoachCodeBusy(true);
    setCoachCodeMsg("");
    try {
      const coachId = await resolveCoachUserIdFromPublicCode(code);
      if (!coachId) { setCoachCodeMsg("No encontramos un coach con ese codigo. Verifica e intenta de nuevo."); return; }
      await linkAthleteToCoach(coachId);
      const { data: coachProf } = await supabase
        .from("coach_public")
        .select("name")
        .eq("user_id", coachId)
        .maybeSingle();
      if (coachProf?.name) setCoachName(coachProf.name);
      setCoachCodeMsg("Conectado con " + (coachProf?.name || "tu coach") + "!");
      setFindCoachCodeInput("");
    } catch (e) {
      setCoachCodeMsg("Error inesperado. Intenta de nuevo.");
    } finally { setFindCoachCodeBusy(false); }
  };

  const loadCoachDirectory = async () => {
    setCoachDirLoading(true);
    const { data, error } = await supabase
      .from("coach_public")
      .select("user_id, name, coach_id")
      .order("name", { ascending: true })
      .limit(20);
    setCoachDirLoading(false);
    if (!error && data) setCoachDirectory(data);
  };

  const selectPublicCoach = async (coachUserId) => {
    setSelectCoachBusyId(String(coachUserId));
    setMessage("");
    try { await linkAthleteToCoach(coachUserId); }
    finally { setSelectCoachBusyId(""); }
  };

  const renderAthleteProgressCard = (marginBottom) => (
    <div style={{ ...S.card, marginBottom, overflow: "visible" }}>
      <div style={{ display: "flex", gap: 6, marginBottom: 10, flexWrap: "wrap", alignItems: "center" }}>
        {[{ id: "week", label: "Semana" }, { id: "month", label: "Mes" }, { id: "year", label: "Año" }].map((t) => (
          <button key={t.id} type="button" onClick={() => setAthleteProgressTab(t.id)} style={{ border: "1px solid #e2e8f0", borderRadius: 8, padding: "8px 12px", background: athleteProgressTab === t.id ? "rgba(245,158,11,.14)" : "#fff", fontWeight: athleteProgressTab === t.id ? 800 : 600, cursor: "pointer", fontFamily: "inherit", fontSize: ".78em", color: athleteProgressTab === t.id ? "#c2410c" : "#64748b" }}>{t.label}</button>
        ))}
      </div>
      <div style={{ color: "#64748b", fontSize: ".8em", marginBottom: 12 }}>{athleteProgressStats.rangeLabel}</div>
      <div style={{ display: "flex", flexDirection: "column", gap: 12 }}>
        <div style={{ display: "flex", justifyContent: "space-between", alignItems: "baseline", gap: 12, flexWrap: "wrap" }}>
          <span style={{ color: "#64748b", fontSize: ".85em" }}>🏃 Kilometraje total</span>
          <span style={{ fontSize: "1.35em", fontWeight: 900, color: "#22c55e", fontFamily: "monospace" }}>{athleteProgressStats.totalKm.toFixed(1)} km</span>
        </div>
        <div style={{ display: "flex", justifyContent: "space-between", alignItems: "baseline", gap: 12, flexWrap: "wrap" }}>
          <span style={{ color: "#64748b", fontSize: ".85em" }}>⏱️ Tiempo total</span>
          <span style={{ fontSize: "1.35em", fontWeight: 900, color: "#22c55e", fontFamily: "monospace" }}>{formatDurationMinutesTotal(athleteProgressStats.totalMin)}</span>
        </div>
        <div style={{ display: "flex", justifyContent: "space-between", alignItems: "baseline", gap: 12, flexWrap: "wrap" }}>
          <span style={{ color: "#64748b", fontSize: ".85em" }}>🗓️ Sesiones completadas</span>
          <span style={{ fontSize: "1.35em", fontWeight: 900, color: "#22c55e", fontFamily: "monospace" }}>{athleteProgressStats.sessions}</span>
        </div>
      </div>
    </div>
  );

  const closeWorkoutModal = () => {
    setWorkoutSummaryModal(null);
    setForceManualFields(false);
  };

  const uploadAthleteAvatar = async (file) => {
    if (!file || !athleteInfo?.id) return;
    setAvatarUploading(true);
    try {
      const ext = (file.name.split(".").pop() || "jpg").replace(/[^a-z0-9]/gi, "").slice(0, 5) || "jpg";
      const filePath = `${athleteInfo.id}/${Date.now()}.${ext}`;
      const { error: upErr } = await supabase.storage.from("athlete-avatars").upload(filePath, file, { upsert: true, cacheControl: "3600" });
      if (upErr) { setMessage("Error subiendo foto: " + upErr.message); return; }
      const { data: { publicUrl } } = supabase.storage.from("athlete-avatars").getPublicUrl(filePath);
      await supabase.from("athletes").update({ avatar_url: publicUrl }).eq("id", athleteInfo.id);
      setAthleteInfo((prev) => prev ? { ...prev, avatar_url: publicUrl } : prev);
      setMessage("✅ Foto actualizada");
    } catch (e) {
      setMessage("Error subiendo foto");
    } finally {
      setAvatarUploading(false);
    }
  };

  const generateBriefing = async (workout) => {
    setBriefingLoading(true);
    setBriefingText("");
    try {
      const hrZonesText = athleteInfo?.fc_max ? `FC max: ${athleteInfo.fc_max} lpm` : "FC no configurada";
      const prompt = `Eres un coach de running experto. El atleta ${athleteInfo?.name || "el atleta"} tiene programado hoy: "${workout.title || workout.type}" (${workout.total_km || 0} km, ${workout.duration_min || 0} min, tipo: ${workout.type || "general"}). Objetivo: ${athleteInfo?.goal || "mejorar rendimiento"}. ${hrZonesText}. Escribe un briefing motivacional de 3-4 oraciones en español. Incluye: 1) que va a trabajar hoy y por que es importante, 2) en que enfocarse durante la sesion, 3) una frase motivacional final. Sin bullets, solo texto corrido.`;
      const { data: { session } } = await supabase.auth.getSession();
      const res = await fetch("/api/analyze-workout", {
        method: "POST",
        headers: {
          "Content-Type": "application/json",
          Authorization: `Bearer ${session?.access_token}`,
        },
        body: JSON.stringify({ prompt, mode: "briefing" }),
      });
      const data = await res.json();
      setBriefingText(data?.analysis || "No se pudo generar el briefing.");
    } catch (e) {
      setBriefingText("Error generando el briefing. Intenta de nuevo.");
    } finally {
      setBriefingLoading(false);
    }
  };

  const sendNot100Report = async () => {
    if (!not100Modal || !athleteInfo?.coach_id) return;
    setNot100Sending(true);
    try {
      const note = `[No estoy al 100% · Nivel: ${not100Form.level}] ${not100Form.reason || "Sin detalle adicional"}`;
      await supabase.from("workouts").update({ athlete_notes: note }).eq("id", not100Modal.id);
      await sendChatPushNotification({
        toUserId: athleteInfo.coach_id,
        title: `😣 ${athleteInfo.name || "Tu atleta"} no esta al 100%`,
        body: `${not100Modal.title || "Entreno"}: ${not100Form.reason || "Nivel " + not100Form.level}`,
        data: { type: "coach_athlete", athlete_id: athleteInfo.id },
        logLabel: "not100",
      });
      setNot100Modal(null);
      setMessage("✅ Tu coach fue notificado");
    } catch (e) {
      console.error("not100:", e);
    } finally {
      setNot100Sending(false);
    }
  };

  return (
    <div style={{ ...S.page, paddingBottom: 96, overflow: "visible", position: "relative" }}>
      {message ? (
        <div style={{ ...S.card, border: `1px solid ${message.startsWith("✅") ? "rgba(34,197,94,.45)" : "rgba(239,68,68,.35)"}`, background: message.startsWith("✅") ? "rgba(34,197,94,.1)" : "rgba(239,68,68,.08)", color: message.startsWith("✅") ? "#166534" : "#fecaca", marginBottom: 14 }}>
          {message}
        </div>
      ) : null}
      <div style={{ display: "flex", alignItems: "center", justifyContent: "space-between", marginBottom: 14 }}>
        <h1 style={{ ...S.pageTitle, marginBottom: 0 }}>Hola, {athleteName}</h1>
        <img src="/pwa-192.png" alt="RAF" style={{ width: 38, height: 38, borderRadius: 10, objectFit: "cover", flexShrink: 0 }} />
      </div>
{coachName ? (
        <div
          id="banner-coach-name"
          style={{
            display: "flex",
            alignItems: "center",
            gap: 10,
            padding: "10px 14px",
            borderRadius: 12,
            background: "linear-gradient(135deg, rgba(245,158,11,.1), rgba(251,191,36,.08))",
            border: "1px solid rgba(245,158,11,.3)",
            marginBottom: 12,
          }}
        >
          <span style={{ fontSize: "1.2em" }}>🏃</span>
          <div>
            <div style={{ fontSize: ".68em", color: "#b45309", fontWeight: 700, textTransform: "uppercase", letterSpacing: ".08em" }}>Tu coach</div>
            <div style={{ fontSize: ".9em", fontWeight: 800, color: "#0f172a" }}>{coachName}</div>
          </div>
        </div>
      ) : null}
      <WeatherWidget defaultCity="Bogota,CO" />
{(() => {
        const weatherNote = getWorkoutWeatherNote();
        const todayYmd2 = formatLocalYMD(new Date());
        const hasTodayWorkout = workouts.some((w) => w.scheduled_date === todayYmd2 && !w.done);
        if (!weatherNote || !hasTodayWorkout) return null;
        const isWarning = weather?.intensity === "warning";
        return (
          <div style={{ marginBottom: 14, padding: "12px 14px", borderRadius: 12, background: isWarning ? "rgba(239,68,68,.08)" : "rgba(245,158,11,.08)", border: isWarning ? "1px solid rgba(239,68,68,.3)" : "1px solid rgba(245,158,11,.3)" }}>
            <div style={{ fontWeight: 800, fontSize: ".82em", color: isWarning ? "#991b1b" : "#92400e", marginBottom: 4 }}>
              {isWarning ? "⚠️ Alerta clima" : "🌡️ Precaucion clima"}
            </div>
            <div style={{ fontSize: ".78em", color: isWarning ? "#b91c1c" : "#b45309", lineHeight: 1.5 }}>{weatherNote}</div>
          </div>
        );
      })()}

      {renderAthleteProgressCard(14)}

      <div style={{ ...S.card, marginBottom: 14 }}>
        <div style={{ display: "flex", flexWrap: "wrap", alignItems: "center", justifyContent: "space-between", gap: 10, marginBottom: 10 }}>
          <div style={{ fontSize: ".65em", letterSpacing: ".15em", color: "#334155", textTransform: "uppercase" }}>CALENDARIO · {calendarMonthLabel}</div>
          <div style={{ display: "flex", gap: 8, alignItems: "center" }}>
            <button type="button" onClick={() => setCalendarViewMonth(({ y, m }) => (m === 0 ? { y: y - 1, m: 11 } : { y, m: m - 1 }))} style={{ background: "#fff", border: "1px solid #e2e8f0", borderRadius: 8, padding: "6px 10px", color: "#0f172a", fontWeight: 700, cursor: "pointer", fontFamily: "inherit", fontSize: ".78em" }}>←</button>
            <button type="button" onClick={() => setCalendarViewMonth(({ y, m }) => (m === 11 ? { y: y + 1, m: 0 } : { y, m: m + 1 }))} style={{ background: "#fff", border: "1px solid #e2e8f0", borderRadius: 8, padding: "6px 10px", color: "#0f172a", fontWeight: 700, cursor: "pointer", fontFamily: "inherit", fontSize: ".78em" }}>→</button>
          </div>
        </div>
        {loading ? (
          <div style={{ color: "#64748b", fontSize: ".85em", padding: "20px 0" }}>Cargando...</div>
        ) : (
          <div style={{ display: "grid", gridTemplateColumns: "repeat(7,1fr)", gap: 4, overflow: "visible" }}>
            {DAYS.map((d) => <div key={d} style={{ fontSize: ".65em", textAlign: "center", color: "#334155", padding: "4px 0" }}>{d}</div>)}
            {calendarCells.map((cellDate, i) => {
              const ymd = calendarCellToIsoYmd(cellDate);
              const dayWorkouts = workoutsByDate[ymd] || [];
              const inViewMonth = cellIsInViewMonth(cellDate, calendarViewMonth.y, calendarViewMonth.m);
              const hasDoneWorkout = dayWorkouts.some((w) => w.done);
              return (
                <div key={i} style={{ minHeight: 68, border: "1px solid #e2e8f0", borderRadius: 6, padding: "4px 3px", opacity: inViewMonth ? 1 : 0.42, background: hasDoneWorkout ? "rgba(34,197,94,.08)" : "#fff" }}>
                  <div style={{ fontSize: ".58em", color: inViewMonth ? "#475569" : "#94a3b8", textAlign: "center", fontWeight: 600 }}>{cellDate.getDate()}</div>
                  {dayWorkouts.slice(0, 2).map((w) => (
                    <button key={w.id} type="button" onClick={(e) => openAthleteWorkoutMenu(e, w)} style={{ width: "100%", border: "1px solid #e2e8f0", borderRadius: 4, padding: "2px 3px", marginTop: 3, background: w.done ? "rgba(34,197,94,.15)" : "#f8fafc", fontSize: ".5em", color: "#334155", cursor: "pointer", fontFamily: "inherit", textAlign: "center", position: "relative", zIndex: 1 }}>
                      {w.title}
                    </button>
                  ))}
                </div>
              );
            })}
          </div>
        )}
      </div>

      {athleteCalendarCtxMenu && ctxMenuAthleteWorkout ? (
        <div ref={athleteCalendarCtxMenuRef} style={{ position: "fixed", left: athleteCalendarCtxMenu.x, top: athleteCalendarCtxMenu.y, zIndex: 10002, minWidth: 240, maxWidth: "min(92vw, 300px)", background: "#ffffff", borderRadius: 10, boxShadow: "0 10px 40px rgba(15,23,42,.2)", border: "1px solid #e2e8f0", padding: 6 }}>
          <button type="button" onMouseDown={(e) => e.preventDefault()} onClick={async (e) => { e.stopPropagation(); await toggleDone(ctxMenuAthleteWorkout); closeAthleteCalendarCtxMenu(); }} style={{ display: "block", width: "100%", textAlign: "left", background: "transparent", border: "none", borderRadius: 8, padding: "10px 12px", color: "#0f172a", fontWeight: 600, cursor: "pointer", fontFamily: "inherit", fontSize: ".82em" }}>
            {ctxMenuAthleteWorkout.done ? "✓ Marcar pendiente" : "✓ Marcar hecho"}
          </button>
          {!ctxMenuAthleteWorkout.done && (
            <button type="button" onMouseDown={(e) => e.preventDefault()} onClick={(e) => { e.stopPropagation(); setNot100Modal(ctxMenuAthleteWorkout); setNot100Form({ reason: "", level: "medio" }); closeAthleteCalendarCtxMenu(); }}
              style={{ display: "block", width: "100%", textAlign: "left", background: "transparent", border: "none", borderRadius: 8, padding: "10px 12px", color: "#f59e0b", fontWeight: 600, cursor: "pointer", fontFamily: "inherit", fontSize: ".82em" }}>
              😓 No estoy al 100%
            </button>
          )}
          <button type="button" onMouseDown={(e) => e.preventDefault()} onClick={(e) => { e.stopPropagation(); setBriefingModal(ctxMenuAthleteWorkout); setBriefingText(""); closeAthleteCalendarCtxMenu(); generateBriefing(ctxMenuAthleteWorkout); }}
            style={{ display: "block", width: "100%", textAlign: "left", background: "transparent", border: "none", borderRadius: 8, padding: "10px 12px", color: "#6366f1", fontWeight: 600, cursor: "pointer", fontFamily: "inherit", fontSize: ".82em" }}>
            ⚡ Briefing IA
          </button>
        </div>
      ) : null}

      <div style={{ ...S.card, marginBottom: 14 }}>
        <div style={{ fontSize: ".72em", letterSpacing: ".13em", color: "#475569", textTransform: "uppercase", marginBottom: 12 }}>Progreso semanal</div>
        <div style={{ display: "flex", gap: 8, overflowX: "auto", paddingBottom: 4 }}>
          {last4WeeksSummary.map((week, idx) => {
            const isCurrentWeek = idx === 0;
            const adherencePct = week.adherence;
            const adherenceColor = adherencePct >= 80 ? "#22c55e" : adherencePct >= 50 ? "#f59e0b" : "#ef4444";
            const maxKm = Math.max(...last4WeeksSummary.map(w => w.kmTotal), 1);
            const kmPct = Math.round((week.kmTotal / maxKm) * 100);
            return (
              <div key={week.key} style={{ flex: "0 0 auto", width: 140, border: isCurrentWeek ? "2px solid rgba(245,158,11,.5)" : "1px solid #e2e8f0", borderRadius: 12, padding: "12px 10px", background: isCurrentWeek ? "rgba(245,158,11,.04)" : "#fafafa" }}>
                <div style={{ fontWeight: 800, fontSize: ".78em", color: isCurrentWeek ? "#b45309" : "#475569" }}>{week.label}</div>
                <div style={{ fontSize: ".6em", color: "#94a3b8", marginBottom: 10 }}>{week.range}</div>
                <div style={{ marginBottom: 8 }}>
                  <div style={{ display: "flex", justifyContent: "space-between", fontSize: ".65em", color: "#64748b", marginBottom: 3 }}>
                    <span>Km</span><span style={{ fontWeight: 800, color: "#0f172a" }}>{week.kmTotal.toFixed(1)}</span>
                  </div>
                  <div style={{ height: 5, background: "#e2e8f0", borderRadius: 999 }}>
                    <div style={{ height: "100%", width: kmPct + "%", background: "linear-gradient(90deg,#f59e0b,#f97316)", borderRadius: 999, transition: "width .3s" }} />
                  </div>
                </div>
                <div style={{ marginBottom: 8 }}>
                  <div style={{ display: "flex", justifyContent: "space-between", fontSize: ".65em", color: "#64748b", marginBottom: 3 }}>
                    <span>Adherencia</span><span style={{ fontWeight: 800, color: adherenceColor }}>{adherencePct}%</span>
                  </div>
                  <div style={{ height: 5, background: "#e2e8f0", borderRadius: 999 }}>
                    <div style={{ height: "100%", width: adherencePct + "%", background: adherenceColor, borderRadius: 999, transition: "width .3s" }} />
                  </div>
                </div>
                <div style={{ fontSize: ".62em", color: "#94a3b8" }}>{week.completed}/{week.total} sesiones</div>
              </div>
            );
          })}
        </div>
      </div>

      {briefingModal && (
        <div style={{ position: "fixed", inset: 0, background: "rgba(15,23,42,.55)", zIndex: 10003, display: "flex", alignItems: "center", justifyContent: "center", padding: 16 }}>
          <div style={{ background: "#fff", borderRadius: 14, padding: 20, width: "100%", maxWidth: 420, boxShadow: "0 20px 60px rgba(0,0,0,.3)" }}>
            <div style={{ display: "flex", alignItems: "center", gap: 8, marginBottom: 4 }}>
              <span style={{ fontSize: "1.2em" }}>⚡</span>
              <div style={{ fontWeight: 900, fontSize: ".95em", color: "#4338ca" }}>Briefing del entreno</div>
            </div>
            <div style={{ fontSize: ".78em", color: "#64748b", marginBottom: 14 }}>{briefingModal.title} · {briefingModal.total_km || 0} km · {briefingModal.duration_min || 0} min</div>
            {briefingLoading ? (
              <div style={{ padding: "20px 0", textAlign: "center", color: "#6366f1", fontSize: ".85em" }}>Generando briefing con IA...</div>
            ) : (
              <div style={{ fontSize: ".88em", color: "#0f172a", lineHeight: 1.65, background: "rgba(99,102,241,.05)", border: "1px solid rgba(99,102,241,.2)", borderRadius: 10, padding: "14px 16px", marginBottom: 16 }}>
                {briefingText}
              </div>
            )}
            <div style={{ display: "flex", gap: 8, justifyContent: "flex-end" }}>
              {!briefingLoading && (
                <button type="button" onClick={() => generateBriefing(briefingModal)}
                  style={{ padding: "8px 14px", borderRadius: 8, border: "1px solid rgba(99,102,241,.3)", background: "rgba(99,102,241,.08)", color: "#4338ca", fontWeight: 700, cursor: "pointer", fontFamily: "inherit", fontSize: ".78em" }}>
                  Regenerar
                </button>
              )}
              <button type="button" onClick={() => setBriefingModal(null)}
                style={{ padding: "8px 14px", borderRadius: 8, border: "1px solid #e2e8f0", background: "#fff", color: "#475569", fontWeight: 700, cursor: "pointer", fontFamily: "inherit", fontSize: ".82em" }}>
                Cerrar
              </button>
            </div>
          </div>
        </div>
      )}

      {not100Modal && (
        <div style={{ position: "fixed", inset: 0, background: "rgba(15,23,42,.55)", zIndex: 10003, display: "flex", alignItems: "center", justifyContent: "center", padding: 16 }}>
          <div style={{ background: "#fff", borderRadius: 14, padding: 20, width: "100%", maxWidth: 400, boxShadow: "0 20px 60px rgba(0,0,0,.3)" }}>
            <div style={{ fontWeight: 900, fontSize: "1em", color: "#0f172a", marginBottom: 4 }}>😓 No estoy al 100%</div>
            <div style={{ fontSize: ".8em", color: "#64748b", marginBottom: 14 }}>{not100Modal.title} · Cuéntale a tu coach cómo estás</div>
            <div style={{ marginBottom: 12 }}>
              <div style={{ fontSize: ".72em", fontWeight: 700, color: "#475569", marginBottom: 6 }}>Nivel</div>
              <div style={{ display: "flex", gap: 8 }}>
                {[["leve","😕 Leve"],["medio","😓 Regular"],["grave","🤒 Mal"]].map(([val, label]) => (
                  <button key={val} type="button" onClick={() => setNot100Form(f => ({ ...f, level: val }))}
                    style={{ flex: 1, padding: "8px 6px", borderRadius: 8, border: not100Form.level === val ? "2px solid #f59e0b" : "1px solid #e2e8f0", background: not100Form.level === val ? "rgba(245,158,11,.1)" : "#f8fafc", color: not100Form.level === val ? "#b45309" : "#475569", fontWeight: 700, cursor: "pointer", fontFamily: "inherit", fontSize: ".75em" }}>
                    {label}
                  </button>
                ))}
              </div>
            </div>
            <div style={{ marginBottom: 16 }}>
              <div style={{ fontSize: ".72em", fontWeight: 700, color: "#475569", marginBottom: 6 }}>¿Qué pasa? (opcional)</div>
              <textarea rows={3} value={not100Form.reason} onChange={(e) => setNot100Form(f => ({ ...f, reason: e.target.value }))}
                placeholder="Dolor muscular, cansancio, enfermedad..."
                style={{ width: "100%", border: "1px solid #e2e8f0", borderRadius: 8, padding: "9px 10px", fontFamily: "inherit", fontSize: ".84em", boxSizing: "border-box", resize: "none" }} />
            </div>
            <div style={{ display: "flex", gap: 8, justifyContent: "flex-end" }}>
              <button type="button" onClick={() => setNot100Modal(null)}
                style={{ padding: "8px 14px", borderRadius: 8, border: "1px solid #e2e8f0", background: "#fff", color: "#475569", fontWeight: 700, cursor: "pointer", fontFamily: "inherit", fontSize: ".82em" }}>
                Cancelar
              </button>
              <button type="button" onClick={sendNot100Report} disabled={not100Sending}
                style={{ padding: "8px 14px", borderRadius: 8, border: "none", background: not100Sending ? "#e2e8f0" : "linear-gradient(135deg,#f59e0b,#d97706)", color: not100Sending ? "#94a3b8" : "#fff", fontWeight: 800, cursor: not100Sending ? "not-allowed" : "pointer", fontFamily: "inherit", fontSize: ".82em" }}>
                {not100Sending ? "Enviando..." : "Notificar coach"}
              </button>
            </div>
          </div>
        </div>
      )}

      <button type="button" onClick={() => setAthleteChatOpen(true)} style={{ position: "fixed", right: 18, bottom: 104, width: 52, height: 52, borderRadius: "50%", border: "none", background: "linear-gradient(135deg,#f59e0b,#ea580c)", color: "#fff", fontSize: "1.3em", boxShadow: "0 8px 20px rgba(234,88,12,.35)", cursor: "pointer", zIndex: 9000 }}>💬</button>

      <nav aria-label="Navegación atleta" style={{ position: "fixed", left: 0, right: 0, bottom: 0, zIndex: 9999, display: "flex", flexDirection: "row", justifyContent: "space-around", alignItems: "center", background: "white", borderTop: "1px solid #e2e8f0", padding: "8px 0 12px 0", height: "60px" }}>
        <button type="button" style={{ minWidth: 60, color: athleteActiveTab === "home" ? "#c2410c" : "#64748b", background: athleteActiveTab === "home" ? "rgba(245,158,11,.14)" : "transparent", fontWeight: athleteActiveTab === "home" ? 800 : 600 }} onClick={() => handleAthleteNavTabChange("home")}><span className="pf-bnav-icon">🏠</span><span style={{ fontSize: "10px" }}>Inicio</span></button>
        <button type="button" style={{ minWidth: 60, color: athleteActiveTab === "marketplace" ? "#c2410c" : "#64748b", background: athleteActiveTab === "marketplace" ? "rgba(245,158,11,.14)" : "transparent", fontWeight: athleteActiveTab === "marketplace" ? 800 : 600 }} onClick={() => handleAthleteNavTabChange("marketplace")}><span className="pf-bnav-icon">🛒</span><span style={{ fontSize: "10px" }}>Market</span></button>
        <button type="button" style={{ minWidth: 60, color: athleteActiveTab === "challenges" ? "#c2410c" : "#64748b", background: athleteActiveTab === "challenges" ? "rgba(245,158,11,.14)" : "transparent", fontWeight: athleteActiveTab === "challenges" ? 800 : 600 }} onClick={() => handleAthleteNavTabChange("challenges")}><span className="pf-bnav-icon">🏆</span><span style={{ fontSize: "10px" }}>Retos</span></button>
        <button type="button" style={{ minWidth: 60, color: athleteActiveTab === "eval" ? "#c2410c" : "#64748b", background: athleteActiveTab === "eval" ? "rgba(245,158,11,.14)" : "transparent", fontWeight: athleteActiveTab === "eval" ? 800 : 600 }} onClick={() => handleAthleteNavTabChange("eval")}><span className="pf-bnav-icon">⚡</span><span style={{ fontSize: "10px" }}>Eval</span></button>
        <button type="button" style={{ minWidth: 60, color: athleteActiveTab === "profile" ? "#c2410c" : "#64748b", background: athleteActiveTab === "profile" ? "rgba(245,158,11,.14)" : "transparent", fontWeight: athleteActiveTab === "profile" ? 800 : 600 }} onClick={() => handleAthleteNavTabChange("profile")}><span className="pf-bnav-icon">👤</span><span style={{ fontSize: "10px" }}>Perfil</span></button>
      </nav>

      {athleteActiveTab !== "home" ? (
        <div style={{ position: "fixed", inset: 0, zIndex: 9988, background: "rgba(15,23,42,.4)", display: "flex", alignItems: "flex-end" }}>
          <div style={{ width: "100%", height: "100%", background: "#fff", borderTopLeftRadius: 18, borderTopRightRadius: 18, overflowY: "auto", padding: 16, paddingBottom: 94 }}>
            <div style={{ display: "flex", justifyContent: "space-between", alignItems: "center", marginBottom: 12 }}>
              <div style={{ fontSize: "1.05em", fontWeight: 900, color: "#0f172a" }}>
                {athleteActiveTab === "marketplace" ? "🛒 Marketplace" : athleteActiveTab === "challenges" ? "🏆 Retos" : athleteActiveTab === "eval" ? "⚡ Evaluación VDOT" : "👤 Perfil"}
              </div>
              <button type="button" onClick={() => handleAthleteNavTabChange("home")} style={{ border: "1px solid #e2e8f0", background: "#fff", borderRadius: 8, padding: "6px 10px", color: "#475569", fontWeight: 700, cursor: "pointer", fontFamily: "inherit" }}>✕</button>
            </div>

            {athleteActiveTab === "marketplace" ? (
              <Suspense fallback={<div>Cargando...</div>}>
                <MarketplaceHub profileRole="athlete" currentUserId={profile?.user_id ?? null} coachUserId={null} notify={notifyCallback} styles={styles} MarketplacePlanWorkoutsAccordion={MarketplacePlanWorkoutsAccordion} />
              </Suspense>
            ) : null}

            {athleteActiveTab === "challenges" ? (
              <Suspense fallback={<div style={{ padding: 20 }}>Cargando retos...</div>}>
                <ChallengesHub profileRole="athlete" currentUserId={profile?.user_id ?? null} athleteId={athleteInfo?.id ?? null} isAthlete coachAthletes={EMPTY_ARRAY} workouts={workouts} notify={notifyCallback} styles={styles} normalizeWorkoutRow={normalizeWorkoutRowStable} />
              </Suspense>
            ) : null}

            {athleteActiveTab === "eval" ? (
              hasPremiumAccess ? (
                <Suspense fallback={<div style={{ padding: 20, color: "#64748b" }}>Cargando evaluación…</div>}>
                  {!hasPremiumAccess && athleteEvaluations.length === 0 ? (
                <div style={{ padding: "10px 14px", borderRadius: 10, background: "rgba(245,158,11,.1)", border: "1px solid rgba(245,158,11,.3)", marginBottom: 14, fontSize: ".82em", color: "#b45309", fontWeight: 600 }}>
                  Tienes 1 evaluacion VDOT gratuita. Para evaluaciones ilimitadas, conecta un coach o activa Premium.
                </div>
              ) : null}
              <EvaluationView athletes={[normalizeAthlete(athleteInfo)]} currentUserId={profile?.user_id ?? null} notify={(msg) => setMessage(msg)} athleteOnlyId={athleteInfo?.id} />
                </Suspense>
              ) : (
                <div style={{ ...S.card, textAlign: "center" }}>
                  <p style={{ color: "#64748b" }}>La evaluación VDOT requiere Plan Premium Atleta.</p>
                  <button type="button" onClick={() => { setAthleteProfileTab("pagos"); handleAthleteNavTabChange("profile"); }} style={{ background: "linear-gradient(135deg,#b45309,#f59e0b)", border: "none", borderRadius: 10, padding: "10px 20px", color: "#fff", fontWeight: 800, cursor: "pointer", fontFamily: "inherit" }}>Ir a Pagos para suscribirme</button>
                </div>
              )
            ) : null}

            {athleteActiveTab === "profile" ? (
              <div>
                <div style={{ display: "flex", gap: 8, marginBottom: 12, flexWrap: "wrap" }}>
                  <button type="button" onClick={() => setAthleteProfileTab("logros")} style={{ border: "1px solid #e2e8f0", borderRadius: 8, padding: "8px 10px", background: athleteProfileTab === "logros" ? "rgba(245,158,11,.14)" : "#fff", fontWeight: 700, cursor: "pointer", fontFamily: "inherit" }}>🏅 Logros</button>
                  <button type="button" onClick={() => setAthleteProfileTab("forma")} style={{ border: "1px solid #e2e8f0", borderRadius: 8, padding: "8px 10px", background: athleteProfileTab === "forma" ? "rgba(245,158,11,.14)" : "#fff", fontWeight: 700, cursor: "pointer", fontFamily: "inherit" }}>📊 Forma</button>
                  <button type="button" onClick={() => setAthleteProfileTab("mes")} style={{ border: "1px solid #e2e8f0", borderRadius: 8, padding: "8px 10px", background: athleteProfileTab === "mes" ? "rgba(245,158,11,.14)" : "#fff", fontWeight: 700, cursor: "pointer", fontFamily: "inherit" }}>📅 Mes</button>
                  <button type="button" onClick={() => setAthleteProfileTab("config")} style={{ border: "1px solid #e2e8f0", borderRadius: 8, padding: "8px 10px", background: athleteProfileTab === "config" ? "rgba(245,158,11,.14)" : "#fff", fontWeight: 700, cursor: "pointer", fontFamily: "inherit" }}>⚙️ Config</button>
                  <button type="button" onClick={() => setAthleteProfileTab("pagos")} style={{ border: "1px solid #e2e8f0", borderRadius: 8, padding: "8px 10px", background: athleteProfileTab === "pagos" ? "rgba(245,158,11,.14)" : "#fff", fontWeight: 700, cursor: "pointer", fontFamily: "inherit" }}>💳 Pagos</button>
                </div>

                {athleteProfileTab === "logros" ? (
                  <div style={{ ...S.card }}>
                    <div style={{ fontSize: ".72em", marginBottom: 10, color: "#475569", textTransform: "uppercase", letterSpacing: ".13em" }}>MIS LOGROS</div>
                    <div style={{ display: "grid", gridTemplateColumns: "repeat(auto-fill,minmax(230px,1fr))", gap: 12 }}>
                      {ATHLETE_ACHIEVEMENT_DISPLAY_LIST.map((a) => {
                        const currentValue = Number(achievementDisplayProgress?.[a.metric] || 0);
                        const progressRatio = a.target > 0 ? Math.min(1, currentValue / a.target) : 0;
                        const progressPct = Math.round(progressRatio * 100);
                        const awardedAt = (a.codes || []).map((code) => earnedAchievementDateByCode[code]).find(Boolean) || null;
                        const earnedByProgress = currentValue >= a.target;
                        const earned = Boolean(awardedAt || earnedByProgress);
                        const formattedDate = awardedAt ? new Date(awardedAt).toLocaleDateString("es-CO") : "Sin fecha registrada";
                        const currentLabel = a.metric === "totalKm" ? `${currentValue.toFixed(1)} / ${a.target} km` : `${Math.round(currentValue)} / ${a.target}`;
                        return (
                          <div key={a.id} style={{ border: "1px solid #e2e8f0", borderRadius: 12, padding: "14px 12px", background: earned ? "linear-gradient(145deg,#fffbeb,#fff7ed)" : "#f8fafc" }}>
                            <div style={{ display: "flex", alignItems: "flex-start", justifyContent: "space-between", gap: 8 }}>
                              <div style={{ fontSize: "1.9rem", lineHeight: 1 }}>{a.icon}</div>
                              {earned ? <span style={{ fontSize: ".66em", fontWeight: 800, color: "#166534", background: "#dcfce7", border: "1px solid #86efac", borderRadius: 999, padding: "4px 8px", whiteSpace: "nowrap" }}>✅ Ganado</span> : <span style={{ fontSize: ".66em", fontWeight: 700, color: "#64748b", background: "#e2e8f0", border: "1px solid #cbd5e1", borderRadius: 999, padding: "4px 8px", whiteSpace: "nowrap" }}>🔒 Bloqueado</span>}
                            </div>
                            <div style={{ fontSize: ".87em", fontWeight: 900, marginTop: 8, color: "#0f172a" }}>{a.name}</div>
                            <div style={{ fontSize: ".77em", color: "#475569", marginTop: 6, lineHeight: 1.45 }}>{a.requirement}</div>
                            {earned ? (
                              <div style={{ marginTop: 10, fontSize: ".72em", color: "#166534", fontWeight: 700 }}>Fecha de logro: {formattedDate}</div>
                            ) : (
                              <div style={{ marginTop: 10 }}>
                                <div style={{ fontSize: ".72em", color: "#64748b", marginBottom: 5 }}>{a.requirement}</div>
                                <div style={{ height: 8, borderRadius: 999, background: "#e2e8f0", overflow: "hidden" }}>
                                  <div style={{ width: `${progressPct}%`, height: "100%", background: "linear-gradient(90deg,#f59e0b,#f97316)" }} />
                                </div>
                                <div style={{ marginTop: 5, fontSize: ".7em", color: "#64748b", display: "flex", justifyContent: "space-between" }}>
                                  <span>{currentLabel}</span><span>{progressPct}%</span>
                                </div>
                              </div>
                            )}
                          </div>
                        );
                      })}
                    </div>
                  </div>
                ) : null}

                {athleteProfileTab === "forma" ? (
                  hasPremiumAccess ? (
                    <div style={{ display: "flex", flexDirection: "column", gap: 14 }}>
                      <div style={{ ...S.card }}>
                        <div style={{ fontSize: ".72em", marginBottom: 12, color: "#475569", textTransform: "uppercase", letterSpacing: ".13em" }}>Carga por volumen (completados · 4 semanas)</div>
                        <div style={{ display: "grid", gridTemplateColumns: "repeat(auto-fill, minmax(168px, 1fr))", gap: 12 }}>
                          <div style={{ border: "1px solid #e2e8f0", borderRadius: 12, padding: "14px 12px", background: "#fafafa" }}>
                            <div style={{ fontSize: ".72em", color: "#64748b", fontWeight: 700, marginBottom: 6 }}>Estado de entrenamiento</div>
                            <div style={{ fontSize: "1.2em", fontWeight: 900, color: athleteLoadGarminMetrics.statusColor }}>{athleteLoadGarminMetrics.statusLabel}</div>
                          </div>
                          <div style={{ border: "1px solid #e2e8f0", borderRadius: 12, padding: "14px 12px", background: "#fafafa" }}>
                            <div style={{ fontSize: ".72em", color: "#64748b", fontWeight: 700, marginBottom: 6 }}>Carga aguda (7 días)</div>
                            <div style={{ fontSize: "1.35em", fontWeight: 900, color: athleteLoadGarminMetrics.COLOR_ORANGE, fontFamily: "monospace" }}>{athleteLoadGarminMetrics.acuteKm.toFixed(1)} km</div>
                          </div>
                          <div style={{ border: "1px solid #e2e8f0", borderRadius: 12, padding: "14px 12px", background: "#fafafa" }}>
                            <div style={{ fontSize: ".72em", color: "#64748b", fontWeight: 700, marginBottom: 6 }}>Carga crónica (prom. semanal)</div>
                            <div style={{ fontSize: "1.35em", fontWeight: 900, color: athleteLoadGarminMetrics.COLOR_ORANGE, fontFamily: "monospace" }}>{athleteLoadGarminMetrics.chronicWeeklyAvgKm.toFixed(1)} km/sem</div>
                          </div>
                        </div>
                      </div>
                      <div style={{ ...S.card }}>
                        <div style={{ fontSize: ".72em", marginBottom: 8, color: "#475569", textTransform: "uppercase", letterSpacing: ".13em" }}>RPE × km (tendencia)</div>
                        <div style={{ marginBottom: 12, fontWeight: 800, color: athleteFormaFatigaStatus.kind === "forma" ? "#22c55e" : athleteFormaFatigaStatus.kind === "fatiga" ? "#f87171" : "#94a3b8" }}>Estado (RPE): {athleteFormaFatigaStatus.label}</div>
                        <FormaFatigaLineChart chronological={athleteFormaFatigaChronological} />
                      </div>
                    </div>
                  ) : (
                    <div style={{ ...S.card, textAlign: "center" }}>
                      <p style={{ color: "#64748b" }}>Esta sección requiere Plan Premium Atleta.</p>
                      <button type="button" onClick={() => { setAthleteProfileTab("pagos"); handleAthleteNavTabChange("profile"); }} style={{ background: "linear-gradient(135deg,#b45309,#f59e0b)", border: "none", borderRadius: 10, padding: "10px 20px", color: "#fff", fontWeight: 800, cursor: "pointer", fontFamily: "inherit" }}>Ir a Pagos para suscribirme</button>
                    </div>
                  )
                ) : null}

                {athleteProfileTab === "config" ? (
                  <div style={{ ...S.card }}>
                    <div style={{ fontSize: ".72em", marginBottom: 10, color: "#475569", textTransform: "uppercase", letterSpacing: ".13em" }}>MI CONFIGURACIÓN</div>
                    <div style={{ color: "#64748b", fontSize: ".84em", marginBottom: 8 }}>Gestiona conexiones y preferencias.</div>
                    {/* FOTO DE PERFIL */}
                    <div style={{ marginBottom: 20, paddingBottom: 20, borderBottom: "1px solid #e2e8f0" }}>
                      <div style={{ fontSize: ".72em", fontWeight: 800, color: "#475569", textTransform: "uppercase", letterSpacing: ".1em", marginBottom: 12 }}>FOTO DE PERFIL</div>
                      <div style={{ display: "flex", alignItems: "center", gap: 14, flexWrap: "wrap" }}>
                        <div style={{ width: 72, height: 72, borderRadius: "50%", overflow: "hidden", background: "#f1f5f9", border: "2px solid #e2e8f0", flexShrink: 0, display: "flex", alignItems: "center", justifyContent: "center", fontSize: "2em" }}>
                          {athleteInfo?.avatar_url ? (
                            <img src={athleteInfo.avatar_url} alt="foto" style={{ width: "100%", height: "100%", objectFit: "cover" }} />
                          ) : (
                            <span>🏃</span>
                          )}
                        </div>
                        <div>
                          <label style={{ display: "inline-block", padding: "8px 14px", borderRadius: 8, background: avatarUploading ? "#e2e8f0" : "linear-gradient(135deg,#b45309,#f59e0b)", color: avatarUploading ? "#94a3b8" : "#fff", fontWeight: 800, cursor: avatarUploading ? "not-allowed" : "pointer", fontFamily: "inherit", fontSize: ".82em" }}>
                            {avatarUploading ? "Subiendo..." : "📷 Subir foto"}
                            <input type="file" accept="image/*" style={{ display: "none" }} disabled={avatarUploading} onChange={(e) => { const f = e.target.files?.[0]; if (f) uploadAthleteAvatar(f); }} />
                          </label>
                          <div style={{ fontSize: ".72em", color: "#94a3b8", marginTop: 6 }}>JPG, PNG o GIF · máx 2MB</div>
                        </div>
                      </div>
                    </div>
                    {/* MI COACH */}
                    <div style={{ marginBottom: 20, paddingBottom: 20, borderBottom: "1px solid #e2e8f0" }}>
                      <div style={{ fontSize: ".72em", fontWeight: 800, color: "#475569", textTransform: "uppercase", letterSpacing: ".1em", marginBottom: 12 }}>MI COACH</div>
                      {coachName ? (
                        <div style={{ display: "flex", alignItems: "center", gap: 10, padding: "10px 14px", borderRadius: 10, background: "rgba(245,158,11,.08)", border: "1px solid rgba(245,158,11,.3)", marginBottom: 10 }}>
                          <span style={{ fontSize: "1.3em" }}>&#127939;</span>
                          <div>
                            <div style={{ fontSize: ".72em", color: "#b45309", fontWeight: 700 }}>Coach actual</div>
                            <div style={{ fontSize: ".9em", fontWeight: 800, color: "#0f172a" }}>{coachName}</div>
                          </div>
                        </div>
                      ) : (
                        <div style={{ fontSize: ".82em", color: "#64748b", marginBottom: 10 }}>No tienes coach asignado. Ingresa un codigo para conectarte.</div>
                      )}
                      <div style={{ display: "flex", gap: 8, alignItems: "center", flexWrap: "wrap", marginBottom: 8 }}>
                        <input
                          type="text"
                          value={findCoachCodeInput}
                          onChange={(e) => { setFindCoachCodeInput(e.target.value.toUpperCase()); setCoachCodeMsg(""); }}
                          placeholder="Codigo del coach (ej: B5C9E44A)"
                          style={{ flex: "1 1 180px", padding: "9px 12px", borderRadius: 8, border: "1px solid #e2e8f0", background: "#fff", color: "#0f172a", fontFamily: "inherit", fontSize: ".84em", boxSizing: "border-box" }}
                        />
                        <button
                          type="button"
                          onClick={connectCoachByCode}
                          disabled={findCoachCodeBusy || !findCoachCodeInput.trim()}
                          style={{ padding: "9px 16px", borderRadius: 8, border: "none", background: (findCoachCodeBusy || !findCoachCodeInput.trim()) ? "#e2e8f0" : "linear-gradient(135deg,#b45309,#f59e0b)", color: (findCoachCodeBusy || !findCoachCodeInput.trim()) ? "#94a3b8" : "#fff", fontWeight: 800, cursor: (findCoachCodeBusy || !findCoachCodeInput.trim()) ? "not-allowed" : "pointer", fontFamily: "inherit", fontSize: ".82em", whiteSpace: "nowrap" }}
                        >
                          {findCoachCodeBusy ? "Conectando..." : "Conectar"}
                        </button>
                      </div>
                      {coachCodeMsg ? <div style={{ fontSize: ".78em", color: coachCodeMsg.startsWith("Conectado") ? "#166534" : "#dc2626", fontWeight: 600 }}>{coachCodeMsg}</div> : null}
                    </div>
                    <div style={{ marginBottom: 20 }}>
                      <div style={{ display: "flex", justifyContent: "space-between", alignItems: "center", marginBottom: 10 }}>
                        <div style={{ fontSize: ".72em", fontWeight: 800, color: "#475569", textTransform: "uppercase", letterSpacing: ".1em" }}>DIRECTORIO DE COACHES</div>
                        <button type="button" onClick={loadCoachDirectory} disabled={coachDirLoading} style={{ padding: "6px 12px", borderRadius: 8, border: "1px solid #e2e8f0", background: "#fff", color: "#334155", fontWeight: 700, cursor: "pointer", fontFamily: "inherit", fontSize: ".75em" }}>
                          {coachDirLoading ? "Cargando..." : coachDirectory.length ? "Actualizar" : "Ver coaches"}
                        </button>
                      </div>
                      {coachDirectory.length > 0 ? (
                        <div style={{ display: "flex", flexDirection: "column", gap: 8 }}>
                          {coachDirectory.map((c) => (
                            <div key={c.user_id} style={{ display: "flex", alignItems: "center", justifyContent: "space-between", gap: 10, padding: "10px 12px", borderRadius: 10, border: "1px solid #e2e8f0", background: "#fafafa", flexWrap: "wrap" }}>
                              <div>
                                <div style={{ fontWeight: 800, color: "#0f172a", fontSize: ".88em" }}>{c.name}</div>
                                <div style={{ fontSize: ".72em", color: "#64748b", marginTop: 2 }}>
                                  {"Codigo: " + (c.coach_id || "N/A") + (c.city ? " · " + c.city : "")}
                                </div>
                              </div>
                              <button type="button" onClick={() => { setFindCoachCodeInput(c.coach_id || ""); setCoachCodeMsg(""); }} style={{ padding: "6px 12px", borderRadius: 8, border: "1px solid rgba(245,158,11,.4)", background: "rgba(245,158,11,.1)", color: "#b45309", fontWeight: 700, cursor: "pointer", fontFamily: "inherit", fontSize: ".75em", whiteSpace: "nowrap" }}>
                                Seleccionar
                              </button>
                            </div>
                          ))}
                        </div>
                      ) : !coachDirLoading ? (
                        <div style={{ fontSize: ".82em", color: "#94a3b8" }}>Haz clic en "Ver coaches" para explorar el directorio.</div>
                      ) : null}
                    </div>
                    <div style={{ marginTop: 20, paddingTop: 20, borderTop: "1px solid #e2e8f0" }}>
                      <IntervalsConnect athleteId={athleteInfo?.id} onNotify={setMessage} />
                    </div>
                  </div>
                ) : null}

                {athleteProfileTab === "mes" ? (() => {
                  const now = new Date();
                  const y = now.getFullYear();
                  const m = now.getMonth();
                  const p2 = (n) => String(n).padStart(2, "0");
                  const startThisMonth = `${y}-${p2(m + 1)}-01`;
                  const endThisMonth = `${y}-${p2(m + 1)}-${p2(new Date(y, m + 1, 0).getDate())}`;
                  const startLastMonth = `${y}-${p2(m === 0 ? 12 : m)}-01`;
                  const endLastMonth = `${y}-${p2(m === 0 ? 12 : m)}-${p2(new Date(y, m, 0).getDate())}`;
                  const monthLabel = now.toLocaleDateString("es", { month: "long", year: "numeric" });
                  const thisMonthWorkouts = workouts.filter((w) => w.scheduled_date >= startThisMonth && w.scheduled_date <= endThisMonth);
                  const lastMonthWorkouts = workouts.filter((w) => w.scheduled_date >= startLastMonth && w.scheduled_date <= endLastMonth);
                  const doneThis = thisMonthWorkouts.filter((w) => w.done);
                  const doneLast = lastMonthWorkouts.filter((w) => w.done);
                  const kmThis = doneThis.reduce((s, w) => s + (Number(w.total_km) || 0), 0);
                  const kmLast = doneLast.reduce((s, w) => s + (Number(w.total_km) || 0), 0);
                  const adherenceThis = thisMonthWorkouts.length ? Math.round((doneThis.length / thisMonthWorkouts.length) * 100) : 0;
                  const bestSession = doneThis.sort((a, b) => (Number(b.total_km) || 0) - (Number(a.total_km) || 0))[0];
                  const kmDelta = kmThis - kmLast;
                  const kmDeltaColor = kmDelta >= 0 ? "#16a34a" : "#dc2626";
                  return (
                    <div style={{ display: "flex", flexDirection: "column", gap: 12 }}>
                      <div style={{ ...S.card }}>
                        <div style={{ fontSize: ".68em", color: "#64748b", textTransform: "uppercase", letterSpacing: ".13em", marginBottom: 10 }}>Resumen · {monthLabel}</div>
                        <div style={{ display: "grid", gridTemplateColumns: "1fr 1fr", gap: 10, marginBottom: 12 }}>
                          <div style={{ background: "#f8fafc", borderRadius: 10, padding: "12px 14px" }}>
                            <div style={{ fontSize: ".68em", color: "#64748b", marginBottom: 4 }}>Km totales</div>
                            <div style={{ fontSize: "1.6em", fontWeight: 900, color: "#0f172a", fontFamily: "monospace" }}>{kmThis.toFixed(1)}</div>
                            <div style={{ fontSize: ".7em", color: kmDeltaColor, fontWeight: 700, marginTop: 2 }}>
                              {kmDelta >= 0 ? "+" : ""}{kmDelta.toFixed(1)} vs mes anterior
                            </div>
                          </div>
                          <div style={{ background: "#f8fafc", borderRadius: 10, padding: "12px 14px" }}>
                            <div style={{ fontSize: ".68em", color: "#64748b", marginBottom: 4 }}>Sesiones</div>
                            <div style={{ fontSize: "1.6em", fontWeight: 900, color: "#0f172a", fontFamily: "monospace" }}>{doneThis.length}/{thisMonthWorkouts.length}</div>
                            <div style={{ fontSize: ".7em", color: adherenceThis >= 80 ? "#16a34a" : "#f59e0b", fontWeight: 700, marginTop: 2 }}>
                              {adherenceThis}% adherencia
                            </div>
                          </div>
                        </div>
                        {bestSession && (
                          <div style={{ background: "rgba(245,158,11,.06)", border: "1px solid rgba(245,158,11,.25)", borderRadius: 10, padding: "10px 14px" }}>
                            <div style={{ fontSize: ".68em", color: "#b45309", fontWeight: 700, marginBottom: 4 }}>🏆 Mejor sesión</div>
                            <div style={{ fontWeight: 800, fontSize: ".88em", color: "#0f172a" }}>{bestSession.title}</div>
                            <div style={{ fontSize: ".75em", color: "#64748b", marginTop: 2 }}>{Number(bestSession.total_km || 0).toFixed(1)} km · {bestSession.duration_min || 0} min{bestSession.rpe ? " · RPE " + bestSession.rpe : ""}</div>
                          </div>
                        )}
                      </div>
                      <div style={{ ...S.card }}>
                        <div style={{ fontSize: ".68em", color: "#64748b", textTransform: "uppercase", letterSpacing: ".13em", marginBottom: 10 }}>Comparativa vs mes anterior</div>
                        <div style={{ display: "flex", flexDirection: "column", gap: 8 }}>
                          {[
                            { label: "Km totales", val: kmThis.toFixed(1), prev: kmLast.toFixed(1), unit: "km" },
                            { label: "Sesiones completadas", val: doneThis.length, prev: doneLast.length, unit: "" },
                            { label: "Adherencia", val: adherenceThis + "%", prev: (lastMonthWorkouts.length ? Math.round((doneLast.length / lastMonthWorkouts.length) * 100) : 0) + "%", unit: "" },
                          ].map((row) => (
                            <div key={row.label} style={{ display: "flex", justifyContent: "space-between", alignItems: "center", padding: "8px 0", borderBottom: "1px solid #f1f5f9" }}>
                              <span style={{ fontSize: ".8em", color: "#475569" }}>{row.label}</span>
                              <div style={{ display: "flex", gap: 12, alignItems: "center" }}>
                                <span style={{ fontSize: ".72em", color: "#94a3b8" }}>{row.prev}</span>
                                <span style={{ fontSize: ".72em", color: "#94a3b8" }}>→</span>
                                <span style={{ fontWeight: 800, fontSize: ".88em", color: "#0f172a" }}>{row.val}</span>
                              </div>
                            </div>
                          ))}
                        </div>
                      </div>
                    </div>
                  );
                })() : null}

                {athleteProfileTab === "pagos" ? (
                  <>
                    {hasCoachPremiumIncluded ? (
                      <div style={{ ...S.card, marginBottom: 14 }}>
                        <div style={{ fontSize: ".72em", marginBottom: 12, color: "#475569", textTransform: "uppercase", letterSpacing: ".13em" }}>Tu acceso</div>
                        <div style={{ display: "inline-flex", alignItems: "center", gap: 8, background: "rgba(34,197,94,.14)", border: "1px solid rgba(34,197,94,.45)", color: "#166534", borderRadius: 10, padding: "12px 16px", fontWeight: 800, fontSize: ".9em", lineHeight: 1.35 }}>✅ Plan Premium — Incluido con tu coach</div>
                        <p style={{ margin: "14px 0 0", color: "#64748b", fontSize: ".84em", lineHeight: 1.5 }}>No necesitas contratar un plan por separado: tu suscripción va ligada al coach que te entrena.</p>
                      </div>
                    ) : (
                      <div style={{ ...S.card, marginBottom: 14 }}>
                        <div style={{ fontSize: ".72em", marginBottom: 10, color: "#475569", textTransform: "uppercase", letterSpacing: ".13em" }}>Tu plan</div>
                        <div style={{ fontWeight: 800, fontSize: ".95em", color: "#0f172a", marginBottom: 4 }}>Plan actual: {soloAthletePlanKey === "monthly" ? "Mensual" : soloAthletePlanKey === "annual" ? "Anual" : "Gratis (free)"}</div>
                        <div style={{ color: "#64748b", fontSize: ".82em", marginBottom: 16, lineHeight: 1.45 }}>Atleta independiente — gestiona tu suscripción aquí.</div>
                        {soloAthletePlanKey === "free" ? (
                          <div style={{ display: "flex", flexDirection: "column", gap: 12 }}>
                            <div style={{ border: "1px solid #e2e8f0", borderRadius: 12, padding: "14px 16px", display: "flex", flexWrap: "wrap", alignItems: "center", justifyContent: "space-between", gap: 12, background: "#fafafa" }}>
                              <div><div style={{ fontWeight: 800, color: "#0f172a" }}>Mensual</div><div style={{ fontSize: ".92em", color: "#b45309", fontWeight: 800, marginTop: 6 }}>${Number(SOLO_PLAN_MONTHLY_COP).toLocaleString("es-CO")} COP/mes</div></div>
                              <button type="button" onClick={() => trySoloIndependentCheckout("monthly")} style={{ padding: "10px 18px", borderRadius: 10, border: "none", background: "linear-gradient(135deg,#0d9488,#14b8a6)", color: "#fff", fontWeight: 800, fontSize: ".84em", cursor: "pointer", fontFamily: "inherit" }}>Suscribirse</button>
                            </div>
                            <div style={{ border: "1px solid #e2e8f0", borderRadius: 12, padding: "14px 16px", display: "flex", flexWrap: "wrap", alignItems: "center", justifyContent: "space-between", gap: 12, background: "#fafafa" }}>
                              <div><div style={{ fontWeight: 800, color: "#0f172a" }}>Anual <span style={{ fontSize: ".72em", fontWeight: 800, color: "#15803d", background: "rgba(34,197,94,.18)", border: "1px solid rgba(34,197,94,.4)", borderRadius: 8, padding: "4px 10px" }}>Ahorra $50.000</span></div><div style={{ fontSize: ".92em", color: "#b45309", fontWeight: 800, marginTop: 6 }}>${Number(SOLO_PLAN_ANNUAL_COP).toLocaleString("es-CO")} COP/año</div></div>
                              <button type="button" onClick={() => trySoloIndependentCheckout("annual")} style={{ padding: "10px 18px", borderRadius: 10, border: "none", background: "linear-gradient(135deg,#0d9488,#14b8a6)", color: "#fff", fontWeight: 800, fontSize: ".84em", cursor: "pointer", fontFamily: "inherit" }}>Suscribirse</button>
                            </div>
                          </div>
                        ) : (
                          <div style={{ border: "1px solid #e2e8f0", borderRadius: 12, padding: "14px 16px", background: "#f8fafc" }}>
                            <div style={{ fontWeight: 800, color: "#0f172a", marginBottom: 8 }}>Plan activo: {soloAthletePlanKey === "monthly" ? "Mensual" : "Anual"}</div>
                            <div style={{ color: "#64748b", fontSize: ".86em", marginBottom: 14 }}>Fecha de vencimiento: <strong style={{ color: "#0f172a" }}>{subscriptionExpiresFormatted || "Sin fecha registrada"}</strong></div>
                            <button type="button" onClick={() => trySoloIndependentCheckout(soloAthletePlanKey)} style={{ padding: "10px 18px", borderRadius: 10, border: "none", background: "linear-gradient(135deg,#b45309,#f59e0b)", color: "#fff", fontWeight: 800, fontSize: ".84em", cursor: "pointer", fontFamily: "inherit" }}>Renovar</button>
                          </div>
                        )}
                      </div>
                    )}
                    <div style={{ ...S.card }}>
                      <div style={{ fontSize: ".72em", marginBottom: 10, color: "#475569", textTransform: "uppercase", letterSpacing: ".13em" }}>Mis Pagos</div>
                      {loadingAthletePayments ? <div style={{ color: "#64748b", fontSize: ".84em" }}>Cargando pagos…</div> : athletePayments.length === 0 ? <div style={{ color: "#64748b", fontSize: ".84em" }}>Tu coach aún no ha registrado pagos.</div> : (
                        <div style={{ display: "flex", flexDirection: "column", gap: 8 }}>
                          {athletePayments.map((p) => (
                            <div key={p.id} style={{ border: "1px solid #e2e8f0", borderRadius: 10, padding: "10px 12px", background: "#f8fafc" }}>
                              <div style={{ fontWeight: 700, fontSize: ".84em" }}>${Number(p.amount || 0).toLocaleString("es-CO")} {p.currency || "COP"} · {p.plan}</div>
                              <div style={{ marginTop: 4, color: "#64748b", fontSize: ".74em" }}>{new Date(p.payment_date).toLocaleDateString("es-CO")} · {p.payment_method}</div>
                            </div>
                          ))}
                        </div>
                      )}
                    </div>
                  </>
                ) : null}

                <button type="button" onClick={async () => {
                  if (typeof localStorage !== "undefined") {
                    localStorage.removeItem("raf_athlete_tab");
                    localStorage.removeItem("raf_athlete_eval_open");
                    localStorage.removeItem("raf_athlete_profile_tab");
                    localStorage.removeItem("raf_athlete_progress_tab");
                    localStorage.removeItem("raf_lastView");
                  }
                  const { error } = await supabase.auth.signOut();
                  if (error) { console.error("Error al cerrar sesión:", error); alert(`Error al cerrar sesión: ${error.message}`); }
                }} style={{ width: "100%", marginTop: 12, background: "rgba(239,68,68,.08)", border: "1px solid rgba(239,68,68,.25)", borderRadius: 8, padding: "10px 14px", color: "#ef4444", cursor: "pointer", fontFamily: "inherit", fontSize: ".82em", fontWeight: 700, whiteSpace: "nowrap" }}>
                  Cerrar sesión
                </button>
              </div>
            ) : null}
          </div>
        </div>
      ) : null}

      {athleteChatOpen ? (
        <div style={{ position: "fixed", inset: 0, zIndex: 9989, background: "rgba(15,23,42,.4)", display: "flex", alignItems: "flex-end" }}>
          <div style={{ width: "100%", height: "100%", background: "#fff", borderTopLeftRadius: 18, borderTopRightRadius: 18, overflowY: "auto", padding: 16, paddingBottom: 94 }}>
            <div style={{ display: "flex", justifyContent: "space-between", alignItems: "center", marginBottom: 10 }}>
              <div style={{ fontSize: "1.05em", fontWeight: 900 }}>💬 Chat con tu coach</div>
              <button type="button" onClick={() => setAthleteChatOpen(false)} style={{ border: "1px solid #e2e8f0", background: "#fff", borderRadius: 8, padding: "6px 10px", color: "#475569", fontWeight: 700, cursor: "pointer", fontFamily: "inherit" }}>✕</button>
            </div>
            {!coachIdForChat ? (
              <div style={{ color: "#64748b", fontSize: ".85em" }}>Sin datos de coach. Contacta a soporte si esto continúa.</div>
            ) : (
              <>
                <div ref={athleteChatScrollRef} style={{ maxHeight: 420, overflowY: "auto", padding: "10px 8px", borderRadius: 10, background: "#f1f5f9", border: "1px solid #e2e8f0", marginBottom: 10, display: "flex", flexDirection: "column", gap: 8 }}>
                  {athleteChatMessages.length === 0 ? <div style={{ color: "#64748b", fontSize: ".8em", textAlign: "center", padding: "12px 0" }}>Sin mensajes aún</div> : athleteChatMessages.map((m) => {
                    const isCoach = m.sender_role === "coach";
                    return <div key={m.id} style={{ alignSelf: isCoach ? "flex-end" : "flex-start", maxWidth: "88%", padding: "8px 12px", borderRadius: 10, background: isCoach ? "linear-gradient(135deg, rgba(180,83,9,.85), rgba(245,158,11,.75))" : "#eff6ff", border: `1px solid ${isCoach ? "rgba(245,158,11,.5)" : "rgba(59,130,246,.35)"}`, color: isCoach ? "#f8fafc" : "#0f172a", fontSize: ".82em", lineHeight: 1.45 }}><div>{m.body}</div><div style={{ fontSize: ".65em", color: isCoach ? "rgba(255,255,255,.85)" : "#64748b", marginTop: 6 }}>{formatMessageTimestamp(m.created_at)}</div></div>;
                  })}
                </div>
                <div style={{ display: "flex", gap: 8 }}>
                  <input type="text" value={athleteChatDraft} onChange={(e) => setAthleteChatDraft(e.target.value)} onKeyDown={(e) => e.key === "Enter" && sendAthleteChat()} placeholder="Escribe un mensaje a tu coach…" style={{ flex: 1, background: "#f1f5f9", border: "1px solid #e2e8f0", borderRadius: 8, padding: "10px 12px", color: "#0f172a", fontFamily: "inherit", fontSize: ".85em" }} />
                  <button type="button" onClick={sendAthleteChat} disabled={athleteChatSending || !athleteChatDraft.trim()} style={{ background: athleteChatSending || !athleteChatDraft.trim() ? "#e2e8f0" : "linear-gradient(135deg,#b45309,#f59e0b)", border: "none", borderRadius: 8, padding: "10px 16px", color: athleteChatSending || !athleteChatDraft.trim() ? "#64748b" : "#fff", fontWeight: 800, cursor: athleteChatSending || !athleteChatDraft.trim() ? "not-allowed" : "pointer", fontFamily: "inherit", fontSize: ".82em" }}>Enviar</button>
                </div>
              </>
            )}
          </div>
        </div>
      ) : null}

      {/* ── Modal resumen workout + análisis Claude */}
      {workoutSummaryModal && (
        <div style={{ position: "fixed", inset: 0, background: "rgba(15,23,42,.55)", zIndex: 10001, display: "flex", alignItems: "center", justifyContent: "center", padding: 16 }}>
          <div style={{ ...S.card, width: "100%", maxWidth: 520, margin: 0, maxHeight: "90vh", overflowY: "auto" }}>
            <div style={{ fontSize: "1.1em", fontWeight: 900, color: "#0f172a", marginBottom: 6 }}>Resumen del entrenamiento</div>
            <div style={{ color: "#64748b", fontSize: ".84em", marginBottom: 12 }}>
              {(workoutSummaryModal.workout?.title || "Workout")} · {workoutSummaryModal.workout?.scheduled_date || "—"}
            </div>

            <div style={{ display: "grid", gridTemplateColumns: "1fr 1fr", gap: 10, marginBottom: 14, padding: 12, background: "#f8fafc", borderRadius: 10 }}>
              <div>
                <div style={{ fontSize: ".7em", fontWeight: 700, color: "#64748b", marginBottom: 6 }}>PROGRAMADO</div>
                <div style={{ fontSize: ".82em", color: "#0f172a" }}>📏 {workoutSummaryModal?.workout?.total_km || "—"} km</div>
                <div style={{ fontSize: ".82em", color: "#0f172a" }}>⏱ {workoutSummaryModal?.workout?.duration_min || "—"} min</div>
                <div style={{ fontSize: ".82em", color: "#0f172a" }}>🏃 {workoutSummaryModal?.workout?.type || "—"}</div>
              </div>
              <div>
                <div style={{ fontSize: ".7em", fontWeight: 700, color: "#0d9488", marginBottom: 6 }}>LO QUE HICISTE</div>
                <div style={{ fontSize: ".82em", color: "#0f172a" }}>📏 {manualSummaryForm.distanceKm || "—"} km</div>
                <div style={{ fontSize: ".82em", color: "#0f172a" }}>⏱ {manualSummaryForm.durationMin || "—"} min</div>
                <div style={{ fontSize: ".82em", color: "#0f172a" }}>RPE {manualSummaryForm.rpe || "—"} / 10</div>
              </div>
            </div>

            <div style={{ display: "flex", flexDirection: "column", gap: 14, marginBottom: 14 }}>
          {intervalsConnected ? (
            <div style={{ fontSize: ".8em", color: "#0d9488", background: "rgba(13,148,136,.08)", border: "1px solid rgba(13,148,136,.25)", borderRadius: 8, padding: "9px 11px" }}>
              ⌚ Los datos de tu carrera (distancia, tiempo, FC) llegan automáticamente desde tu reloj. Solo cuéntanos cómo te sentiste.
              {!forceManualFields ? (
                <div style={{ marginTop: 6 }}>
                  <button
                    type="button"
                    onClick={() => setForceManualFields(true)}
                    style={{ background: "none", border: "none", color: "#64748b", fontSize: ".74em", textDecoration: "underline", cursor: "pointer", fontFamily: "inherit", padding: 0 }}
                  >
                    ¿No llegaron los datos? Escríbelos a mano
                  </button>
                </div>
              ) : null}
            </div>
          ) : null}
          {(!intervalsConnected || forceManualFields) ? (
            <div style={{ display: "grid", gridTemplateColumns: "1fr 1fr", gap: 10 }}>
              <div>
                <div style={{ fontSize: ".72em", fontWeight: 700, color: "#475569", marginBottom: 4 }}>Distancia (km)</div>
                <input type="number" min="0" step="0.1" value={manualSummaryForm.distanceKm} onChange={(e) => setManualSummaryForm((f) => ({ ...f, distanceKm: e.target.value }))} placeholder="0.0" style={{ width: "100%", border: "1px solid #e2e8f0", borderRadius: 8, padding: "9px 10px", fontFamily: "inherit", boxSizing: "border-box" }} />
              </div>
              <div>
                <div style={{ fontSize: ".72em", fontWeight: 700, color: "#475569", marginBottom: 4 }}>Duracion (min)</div>
                <input type="number" min="0" step="1" value={manualSummaryForm.durationMin} onChange={(e) => setManualSummaryForm((f) => ({ ...f, durationMin: e.target.value }))} placeholder="0" style={{ width: "100%", border: "1px solid #e2e8f0", borderRadius: 8, padding: "9px 10px", fontFamily: "inherit", boxSizing: "border-box" }} />
              </div>
            </div>
          ) : null}

          <div>
            <div style={{ fontSize: ".72em", fontWeight: 700, color: "#475569", marginBottom: 6 }}>Esfuerzo percibido (RPE)</div>
            <div style={{ display: "flex", gap: 6, flexWrap: "wrap" }}>
              {[1,2,3,4,5,6,7,8,9,10].map((n) => {
                const selected = Number(manualSummaryForm.rpe) === n;
                const color = n <= 3 ? "#16a34a" : n <= 6 ? "#d97706" : n <= 8 ? "#ea580c" : "#dc2626";
                const label = n <= 3 ? "Suave" : n <= 6 ? "Mod." : n <= 8 ? "Duro" : "Max";
                return (
                  <button key={n} type="button" onClick={() => setManualSummaryForm((f) => ({ ...f, rpe: String(n) }))}
                    style={{ display: "flex", flexDirection: "column", alignItems: "center", gap: 1, width: 40, padding: "5px 0", borderRadius: 8, border: selected ? ("2px solid " + color) : "1px solid #e2e8f0", background: selected ? color : "#f8fafc", color: selected ? "#fff" : "#334155", fontWeight: 800, cursor: "pointer", fontFamily: "inherit" }}>
                    <span style={{ fontSize: ".9em" }}>{n}</span>
                    <span style={{ fontSize: ".5em", fontWeight: 600 }}>{label}</span>
                  </button>
                );
              })}
            </div>
          </div>

          <div>
            <div style={{ fontSize: ".72em", fontWeight: 700, color: "#475569", marginBottom: 6 }}>Como te sentiste?</div>
            <div style={{ display: "flex", gap: 8, flexWrap: "wrap" }}>
              {[["Muy cansado","Muy cansado"],["Cansado","Cansado"],["Normal","Normal"],["Bien","Bien"],["Excelente","Excelente"]].map(([label, val]) => {
                const emoji = label === "Muy cansado" ? "Muy cansado" : label === "Cansado" ? "Cansado" : label === "Normal" ? "Normal" : label === "Bien" ? "Bien" : "Excelente";
                const fullVal = label === "Muy cansado" ? "\uD83D\uDE34 Muy cansado" : label === "Cansado" ? "\uD83D\uDE15 Cansado" : label === "Normal" ? "\uD83D\uDE10 Normal" : label === "Bien" ? "\uD83D\uDE42 Bien" : "\uD83D\uDCAA Excelente";
                const selected = manualSummaryForm.feeling === fullVal;
                return (
                  <button key={val} type="button" onClick={() => setManualSummaryForm((f) => ({ ...f, feeling: fullVal }))}
                    style={{ padding: "6px 12px", borderRadius: 20, border: selected ? "2px solid #0d9488" : "1px solid #e2e8f0", background: selected ? "rgba(13,148,136,.1)" : "#f8fafc", color: selected ? "#0d9488" : "#475569", fontWeight: selected ? 800 : 600, cursor: "pointer", fontFamily: "inherit", fontSize: ".78em" }}>
                    {fullVal}
                  </button>
                );
              })}
            </div>
          </div>

          {(!intervalsConnected || forceManualFields) ? (
            <div style={{ display: "grid", gridTemplateColumns: "1fr 1fr 1fr", gap: 8 }}>
              <div>
                <div style={{ fontSize: ".68em", fontWeight: 700, color: "#94a3b8", marginBottom: 4 }}>FC prom (lpm)</div>
                <input type="number" min="0" step="1" value={manualSummaryForm.avgHr} onChange={(e) => setManualSummaryForm((f) => ({ ...f, avgHr: e.target.value }))} placeholder="0" style={{ width: "100%", border: "1px solid #e2e8f0", borderRadius: 8, padding: "8px 8px", fontFamily: "inherit", boxSizing: "border-box", fontSize: ".88em" }} />
              </div>
              <div>
                <div style={{ fontSize: ".68em", fontWeight: 700, color: "#94a3b8", marginBottom: 4 }}>FC max (lpm)</div>
                <input type="number" min="0" step="1" value={manualSummaryForm.maxHr} onChange={(e) => setManualSummaryForm((f) => ({ ...f, maxHr: e.target.value }))} placeholder="0" style={{ width: "100%", border: "1px solid #e2e8f0", borderRadius: 8, padding: "8px 8px", fontFamily: "inherit", boxSizing: "border-box", fontSize: ".88em" }} />
              </div>
              <div>
                <div style={{ fontSize: ".68em", fontWeight: 700, color: "#94a3b8", marginBottom: 4 }}>Calorias</div>
                <input type="number" min="0" step="1" value={manualSummaryForm.calories} onChange={(e) => setManualSummaryForm((f) => ({ ...f, calories: e.target.value }))} placeholder="0" style={{ width: "100%", border: "1px solid #e2e8f0", borderRadius: 8, padding: "8px 8px", fontFamily: "inherit", boxSizing: "border-box", fontSize: ".88em" }} />
              </div>
            </div>
          ) : null}

          <div>
            <div style={{ fontSize: ".72em", fontWeight: 700, color: "#475569", marginBottom: 4 }}>Notas del entreno</div>
            <textarea rows={3} value={manualSummaryForm.notes} onChange={(e) => setManualSummaryForm((f) => ({ ...f, notes: e.target.value }))} placeholder="Como fue? Algo importante para tu coach?" style={{ width: "100%", border: "1px solid #e2e8f0", borderRadius: 8, padding: "9px 10px", fontFamily: "inherit", boxSizing: "border-box", resize: "none" }} />
          </div>
              <div style={{ display: "flex", justifyContent: "flex-end" }}>
                <button type="button" disabled={manualSummarySaving} onClick={saveManualWorkoutSummary} style={{ background: manualSummarySaving ? "#cbd5e1" : "linear-gradient(135deg,#0d9488,#14b8a6)", border: "none", borderRadius: 8, padding: "8px 12px", color: "#fff", fontWeight: 800, fontFamily: "inherit", cursor: manualSummarySaving ? "not-allowed" : "pointer", fontSize: ".78em" }}>
                  {manualSummarySaving ? "Guardando…" : intervalsConnected ? "Guardar notas" : "Guardar registro"}
                </button>
              </div>
            </div>

            <div style={{ display: "flex", justifyContent: "flex-end", marginTop: 14 }}>
              <button type="button" onClick={closeWorkoutModal} style={{ padding: "8px 12px", borderRadius: 8, border: "1px solid #e2e8f0", background: "#fff", color: "#475569", fontWeight: 700, cursor: "pointer", fontFamily: "inherit", fontSize: ".8em" }}>
                Cerrar
              </button>
            </div>
          </div>
        </div>
      )}
    </div>
  );
}
