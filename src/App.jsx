import { useState, useEffect, useMemo, useCallback, useRef } from "react";
import { supabase } from "./lib/supabase";

const WORKOUT_TYPES = [
  { id: "easy", label: "Rodaje Suave", color: "#22c55e" },
  { id: "tempo", label: "Tempo", color: "#f59e0b" },
  { id: "interval", label: "Intervalos", color: "#ef4444" },
  { id: "long", label: "Largo", color: "#3b82f6" },
  { id: "recovery", label: "Recuperación", color: "#8b5cf6" },
];

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

const normalizeAthlete = (athlete) => ({
  id: athlete?.id,
  name: athlete?.name || "Atleta sin nombre",
  age: Number.isFinite(Number(athlete?.age)) ? Number(athlete.age) : 0,
  goal: athlete?.goal || "Objetivo pendiente",
  pace: athlete?.pace || "N/A",
  weekly_km: Number.isFinite(Number(athlete?.weekly_km)) ? Number(athlete.weekly_km) : 0,
  email: typeof athlete?.email === "string" ? athlete.email : "",
  avatar: athlete?.avatar || "🏃",
  status: athlete?.status || "on-track",
  next_race: athlete?.next_race || "Próxima carrera - Dec 31",
  workouts_done: Number.isFinite(Number(athlete?.workouts_done)) ? Number(athlete.workouts_done) : 0,
  workouts_total: Number.isFinite(Number(athlete?.workouts_total)) ? Number(athlete.workouts_total) : 18,
  device: typeof athlete?.device === "string" ? athlete.device : "",
  plan: typeof athlete?.plan === "string" ? athlete.plan : "",
  coach_id: athlete?.coach_id ?? "",
  fc_max: Number.isFinite(Number(athlete?.fc_max)) && Number(athlete.fc_max) > 0 ? Math.round(Number(athlete.fc_max)) : null,
  fc_reposo: Number.isFinite(Number(athlete?.fc_reposo)) && Number(athlete.fc_reposo) > 0 ? Math.round(Number(athlete.fc_reposo)) : null,
});

/** Zonas % de FC máx (bpm). */
const HR_ZONE_DEFS = [
  { z: 1, lowPct: 0.5, highPct: 0.6, label: "Recuperación activa", color: "#22c55e" },
  { z: 2, lowPct: 0.6, highPct: 0.7, label: "Aeróbico base", color: "#3b82f6" },
  { z: 3, lowPct: 0.7, highPct: 0.8, label: "Aeróbico tempo", color: "#eab308" },
  { z: 4, lowPct: 0.8, highPct: 0.9, label: "Umbral anaeróbico", color: "#f97316" },
  { z: 5, lowPct: 0.9, highPct: 1.0, label: "VO2 max", color: "#ef4444" },
];

const computeAthleteHrZones = (fcMax) => {
  const max = Number(fcMax);
  if (!Number.isFinite(max) || max <= 0) return null;
  return HR_ZONE_DEFS.map((d) => ({
    zone: d.z,
    low: Math.round(max * d.lowPct),
    high: Math.round(max * d.highPct),
    label: d.label,
    color: d.color,
    pctLabel: `${d.lowPct * 100}-${d.highPct * 100}% FC máx`,
  }));
};

const buildAthleteHrZonesPromptText = (athlete) => {
  if (!athlete || !athlete.fc_max || athlete.fc_max <= 0) return "";
  const zones = computeAthleteHrZones(athlete.fc_max);
  if (!zones) return "";
  const lines = zones.map(
    (z) => `Z${z.zone} (${z.pctLabel}): ${z.low}-${z.high} bpm — ${z.label}`,
  );
  let t = `Athlete heart rate zones (based on max HR ${athlete.fc_max} bpm):\n${lines.join("\n")}`;
  if (athlete.fc_reposo && athlete.fc_reposo > 0) {
    t += `\nResting HR (reference): ${athlete.fc_reposo} bpm.`;
  }
  return t;
};

const formatMessageTimestamp = (iso) => {
  if (!iso) return "";
  const d = new Date(iso);
  if (Number.isNaN(d.getTime())) return "";
  return d.toLocaleString("es", { dateStyle: "short", timeStyle: "short" });
};

const formatLocalYMD = (d) => {
  const y = d.getFullYear();
  const m = String(d.getMonth() + 1).padStart(2, "0");
  const day = String(d.getDate()).padStart(2, "0");
  return `${y}-${m}-${day}`;
};

const startOfWeekMonday = (ref = new Date()) => {
  const d = new Date(ref.getFullYear(), ref.getMonth(), ref.getDate());
  const dow = d.getDay();
  const offset = dow === 0 ? -6 : 1 - dow;
  d.setDate(d.getDate() + offset);
  return d;
};

const addDays = (d, n) => {
  const x = new Date(d.getFullYear(), d.getMonth(), d.getDate());
  x.setDate(x.getDate() + n);
  return x;
};

const extractJsonFromAnthropicText = (text) => {
  const raw = (text || "").trim();
  if (!raw) return null;
  try {
    return JSON.parse(raw);
  } catch {
    /* continue */
  }
  const fence = raw.match(/```(?:json)?\s*([\s\S]*?)```/);
  if (fence) {
    try {
      return JSON.parse(fence[1].trim());
    } catch {
      /* continue */
    }
  }
  const start = raw.indexOf("{");
  const end = raw.lastIndexOf("}");
  if (start >= 0 && end > start) {
    try {
      return JSON.parse(raw.slice(start, end + 1));
    } catch {
      return null;
    }
  }
  return null;
};

const PLAN_12_GOALS = [
  { id: "maraton_sub4", label: "Maratón sub 4h" },
  { id: "maraton_sub330", label: "Maratón sub 3:30" },
  { id: "maraton_sub3", label: "Maratón sub 3h" },
  { id: "media", label: "Media maratón" },
  { id: "10k", label: "10K" },
  { id: "5k", label: "5K" },
];

const PLAN_12_LEVELS = [
  { id: "principiante", label: "Principiante" },
  { id: "intermedio", label: "Intermedio" },
  { id: "avanzado", label: "Avanzado" },
];

/** Plantilla fija plan 2 semanas: omitir domingo, luego jueves, luego miércoles si N<5 */
const PLAN2_FIXED_SLOTS = [
  { weekday: 2, type: "long" },
  { weekday: 3, type: "tempo" },
  { weekday: 4, type: "recovery" },
  { weekday: 6, type: "interval" },
  { weekday: 7, type: "long" },
];
const PLAN2_OMIT_ORDER = [7, 4, 3];

const getPlan2ExpectedSlots = (sessionsPerWeek) => {
  let slots = [...PLAN2_FIXED_SLOTS];
  for (const wd of PLAN2_OMIT_ORDER) {
    if (slots.length <= sessionsPerWeek) break;
    slots = slots.filter((s) => s.weekday !== wd);
  }
  return slots;
};

const validatePlan2Distribution = (weeks, sessionsPerWeek) => {
  const expected = getPlan2ExpectedSlots(sessionsPerWeek);
  if (expected.length !== sessionsPerWeek) return "template";
  for (const week of weeks) {
    const list = Array.isArray(week.workouts) ? week.workouts : [];
    if (list.length !== sessionsPerWeek) return "count";
    const byWd = new Map(list.map((w) => [Number(w.weekday), w]));
    for (const slot of expected) {
      const wo = byWd.get(slot.weekday);
      if (!wo) return "missing";
      if (wo.type !== slot.type) return "type";
    }
    if (byWd.size !== expected.length) return "extra";
  }
  return null;
};

const normalizeWorkoutRow = (row) => {
  let structure = row.structure;
  if (typeof structure === "string") {
    try { structure = JSON.parse(structure); } catch { structure = []; }
  }
  const dateRaw = row.scheduled_date;
  const scheduled = typeof dateRaw === "string" ? dateRaw.slice(0, 10) : formatLocalYMD(new Date(dateRaw));
  const type = row.type && WORKOUT_TYPES.some(t => t.id === row.type) ? row.type : "easy";
  return {
    id: row.id,
    athlete_id: row.athlete_id,
    coach_id: row.coach_id,
    scheduled_date: scheduled,
    type,
    title: row.title || WORKOUT_TYPES.find(t => t.id === type)?.label || "Entrenamiento",
    total_km: Number.isFinite(Number(row.total_km)) ? Number(row.total_km) : 0,
    duration_min: Number.isFinite(Number(row.duration_min)) ? Number(row.duration_min) : 0,
    description: row.description || "",
    structure: Array.isArray(structure) ? structure : [],
    done: Boolean(row.done),
  };
};

const StatusBadge = ({ status }) => {
  const map = { "on-track": ["#22c55e", "EN RUTA"], "behind": ["#ef4444", "REZAGADO"], "ahead": ["#f59e0b", "ADELANTADO"] };
  const [color, label] = map[status] || ["#64748b", "N/A"];
  return <span style={{ fontSize: ".65em", fontWeight: 700, letterSpacing: ".1em", color, border: `1px solid ${color}40`, borderRadius: 4, padding: "2px 7px" }}>{label}</span>;
};

const ProgressBar = ({ value, total, color = "#f59e0b" }) => (
  <div style={{ background: "rgba(255,255,255,.06)", borderRadius: 4, height: 5, overflow: "hidden", marginTop: 6 }}>
    <div style={{ width: `${(value / total) * 100}%`, height: "100%", background: color, borderRadius: 4 }} />
  </div>
);

export default function App() {
  const [view, setView] = useState("dashboard");
  const [selectedAthlete, setSelectedAthlete] = useState(null);
  const [workoutsRefresh, setWorkoutsRefresh] = useState(0);
  const [aiPrompt, setAiPrompt] = useState("");
  const [aiWorkout, setAiWorkout] = useState(null);
  const [aiLoading, setAiLoading] = useState(false);
  const [notification, setNotification] = useState(null);
  const [athletes, setAthletes] = useState([]);
  const [loadingAthletes, setLoadingAthletes] = useState(true);
  const [showAddAthleteForm, setShowAddAthleteForm] = useState(false);
  const [newAthlete, setNewAthlete] = useState({ name: "", email: "", goal: "", pace: "", weekly_km: "" });
  const [session, setSession] = useState(null);
  const [authLoading, setAuthLoading] = useState(true);
  const [authMode, setAuthMode] = useState("login");
  const [authEmail, setAuthEmail] = useState("");
  const [authPassword, setAuthPassword] = useState("");
  const [authSubmitting, setAuthSubmitting] = useState(false);
  const [landingAuthOpen, setLandingAuthOpen] = useState(false);
  const [demoModalOpen, setDemoModalOpen] = useState(false);
  const [authRole, setAuthRole] = useState("");
  const [authName, setAuthName] = useState("");
  const [profile, setProfile] = useState(null);
  const [profileLoading, setProfileLoading] = useState(false);

  const notify = (msg) => { setNotification(msg); setTimeout(() => setNotification(null), 3000); };

  const S = styles;

  const updateNewAthleteField = (field, value) => {
    setNewAthlete(prev => ({ ...prev, [field]: value }));
  };

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

    const { data } = supabase.auth.onAuthStateChange((_event, nextSession) => {
      if (!mounted) return;
      setSession(nextSession ?? null);
    });

    return () => {
      mounted = false;
      data.subscription.unsubscribe();
    };
  }, []);

  useEffect(() => {
    const loadProfile = async () => {
      if (!session?.user) {
        setProfile(null);
        return;
      }
      setProfileLoading(true);
      const { data, error } = await supabase
        .from("profiles")
        .select("*")
        .eq("user_id", session.user.id)
        .maybeSingle();
      if (error) {
        console.error("Error cargando perfil:", error);
        setProfile(null);
      } else {
        console.log("Perfil cargado, role:", data?.role);
        setProfile(data || null);
      }
      setProfileLoading(false);
    };

    loadProfile();
  }, [session]);

  useEffect(() => {
    const loadAthletes = async () => {
      if (!session) {
        setAthletes([]);
        setLoadingAthletes(false);
        return;
      }
      setLoadingAthletes(true);
      const { data: userData, error: userError } = await supabase.auth.getUser();
      if (userError || !userData?.user) {
        console.error("Error obteniendo usuario para filtrar atletas:", userError);
        notify("Error cargando atletas");
        setAthletes([]);
        setLoadingAthletes(false);
        return;
      }
      const coachId = userData.user.id;
      const { data, error } = await supabase
        .from("athletes")
        .select("*")
        .eq("coach_id", coachId)
        .order("id", { ascending: true });
      if (error) {
        notify("Error cargando atletas");
        setAthletes([]);
      } else {
        setAthletes((data || []).map(normalizeAthlete));
      }
      setLoadingAthletes(false);
    };

    loadAthletes();
  }, [session]);

  const handleAuthSubmit = async (e) => {
    e.preventDefault();
    if (!authEmail.trim() || !authPassword.trim()) {
      alert("Completa email y contraseña.");
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
    }

    setAuthSubmitting(true);
    try {
      if (authMode === "login") {
        const { error } = await supabase.auth.signInWithPassword({
          email: authEmail.trim(),
          password: authPassword,
        });
        if (error) {
          console.error("Error en login:", error);
          alert(`Error en login: ${error.message}`);
          return;
        }
      } else {
        const { data, error } = await supabase.auth.signUp({
          email: authEmail.trim(),
          password: authPassword,
        });
        if (error) {
          console.error("Error en registro:", error);
          alert(`Error en registro: ${error.message}`);
          return;
        }

        const newUserId = data?.user?.id;
        if (!newUserId) {
          console.log("signUp completado pero no devolvió user. data:", data);
          alert("Registro exitoso. Revisa tu correo si la verificación está habilitada.");
          setAuthMode("login");
          return;
        }

        const profilePayload = {
          user_id: newUserId,
          role: authRole,
          coach_id: authRole === "coach" ? newUserId : null,
          name: authName.trim(),
        };

        const { error: profileError } = await supabase.from("profiles").insert(profilePayload);
        if (profileError) {
          console.log("Error insertando en profiles:", profileError, { profilePayload });
        } else {
          console.log("Perfil creado en profiles:", { user_id: newUserId, role: authRole });
        }

        alert("Registro exitoso. Revisa tu correo si la verificación está habilitada.");
        setAuthMode("login");
        setAuthRole("");
        setAuthName("");
      }
    } finally {
      setAuthSubmitting(false);
    }
  };

  const handleSignOut = async () => {
    const { error } = await supabase.auth.signOut();
    if (error) {
      console.error("Error al cerrar sesión:", error);
      alert(`Error al cerrar sesión: ${error.message}`);
    }
    setLandingAuthOpen(false);
    setDemoModalOpen(false);
    setAuthMode("login");
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
    notify("Atleta agregado ✓");
  };

  const cancelAddAthleteForm = () => {
    setShowAddAthleteForm(false);
    setNewAthlete({ name: "", email: "", goal: "", pace: "", weekly_km: "" });
  };

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
      return (
        <div style={S.root}>
          <main style={{ ...S.page, display: "flex", alignItems: "center", justifyContent: "center", width: "100%" }}>
            <div style={{ ...S.card, width: 360 }}>
              <h1 style={{ ...S.pageTitle, fontSize: "1.3em", marginBottom: 16 }}>
                {authMode === "login" ? "Login" : "Registro"}
              </h1>
              <form onSubmit={handleAuthSubmit}>
                {authMode === "register" && (
                  <>
                    <div style={{ marginBottom: 10 }}>
                      <div style={{ fontSize: ".72em", color: "#64748b", marginBottom: 6 }}>¿Qué eres?</div>
                      <div style={{ display: "flex", gap: 8 }}>
                        <button
                          type="button"
                          onClick={() => setAuthRole("coach")}
                          style={{
                            flex: 1,
                            padding: "10px 12px",
                            borderRadius: 10,
                            border: authRole === "coach" ? "2px solid #f59e0b" : "1px solid rgba(148,163,184,.4)",
                            background: authRole === "coach" ? "rgba(245,158,11,.15)" : "rgba(15,23,42,.8)",
                            color: "#e2e8f0",
                            cursor: "pointer",
                            fontFamily: "inherit",
                            fontWeight: 800,
                            fontSize: ".8em",
                          }}
                        >
                          Soy coach
                        </button>
                        <button
                          type="button"
                          onClick={() => setAuthRole("athlete")}
                          style={{
                            flex: 1,
                            padding: "10px 12px",
                            borderRadius: 10,
                            border: authRole === "athlete" ? "2px solid #3b82f6" : "1px solid rgba(148,163,184,.4)",
                            background: authRole === "athlete" ? "rgba(59,130,246,.15)" : "rgba(15,23,42,.8)",
                            color: "#e2e8f0",
                            cursor: "pointer",
                            fontFamily: "inherit",
                            fontWeight: 800,
                            fontSize: ".8em",
                          }}
                        >
                          Soy atleta
                        </button>
                      </div>
                    </div>
                    <div style={{ marginBottom: 10 }}>
                      <div style={{ fontSize: ".72em", color: "#64748b", marginBottom: 6 }}>Nombre</div>
                      <input
                        type="text"
                        value={authName}
                        onChange={e => setAuthName(e.target.value)}
                        placeholder="Tu nombre completo"
                        style={{ width: "100%", background: "rgba(255,255,255,.04)", border: "1px solid rgba(255,255,255,.1)", borderRadius: 8, padding: "10px 12px", color: "#e2e8f0", fontFamily: "inherit", fontSize: ".85em", outline: "none", boxSizing: "border-box" }}
                      />
                    </div>
                  </>
                )}
                <div style={{ marginBottom: 10 }}>
                  <div style={{ fontSize: ".72em", color: "#64748b", marginBottom: 6 }}>Email</div>
                  <input
                    type="email"
                    value={authEmail}
                    onChange={e => setAuthEmail(e.target.value)}
                    placeholder="correo@ejemplo.com"
                    style={{ width: "100%", background: "rgba(255,255,255,.04)", border: "1px solid rgba(255,255,255,.1)", borderRadius: 8, padding: "10px 12px", color: "#e2e8f0", fontFamily: "inherit", fontSize: ".85em", outline: "none", boxSizing: "border-box" }}
                  />
                </div>
                <div style={{ marginBottom: 14 }}>
                  <div style={{ fontSize: ".72em", color: "#64748b", marginBottom: 6 }}>Contraseña</div>
                  <input
                    type="password"
                    value={authPassword}
                    onChange={e => setAuthPassword(e.target.value)}
                    placeholder="********"
                    style={{ width: "100%", background: "rgba(255,255,255,.04)", border: "1px solid rgba(255,255,255,.1)", borderRadius: 8, padding: "10px 12px", color: "#e2e8f0", fontFamily: "inherit", fontSize: ".85em", outline: "none", boxSizing: "border-box" }}
                  />
                </div>
                <button
                  type="submit"
                  disabled={authSubmitting}
                  style={{ width: "100%", background: authSubmitting ? "rgba(255,255,255,.06)" : "linear-gradient(135deg,#b45309,#f59e0b)", border: "none", borderRadius: 8, padding: "10px 14px", color: authSubmitting ? "#334155" : "white", cursor: authSubmitting ? "not-allowed" : "pointer", fontFamily: "inherit", fontWeight: 800, fontSize: ".85em", marginBottom: 10 }}
                >
                  {authSubmitting ? "Procesando..." : (authMode === "login" ? "Iniciar sesión" : "Crear cuenta")}
                </button>
              </form>
              <button
                onClick={() => setAuthMode(authMode === "login" ? "register" : "login")}
                style={{ background: "transparent", border: "none", color: "#94a3b8", cursor: "pointer", fontFamily: "inherit", fontSize: ".8em", padding: 0 }}
              >
                {authMode === "login" ? "¿No tienes cuenta? Ir a Registro" : "¿Ya tienes cuenta? Ir a Login"}
              </button>
            </div>
          </main>
        </div>
      );
    }

    const PLAN_CATALOG = [
      { plan: "Starter", label: "Starter", priceCop: 49000, priceUsd: 13, description: "Ideal para empezar" },
      { plan: "Pro", label: "Pro", priceCop: 129000, priceUsd: 34, description: "Para entrenamientos avanzados" },
      { plan: "Equipo", label: "Equipo", priceCop: 299000, priceUsd: 79, description: "Para equipos y seguimiento completo" },
    ];

    return (
      <div style={S.root}>
        <main style={{ ...S.page, width: "100%" }}>
          <div style={{ marginTop: 10, marginBottom: 28 }}>
            <div style={{ display: "flex", justifyContent: "space-between", gap: 16, flexWrap: "wrap" }}>
              <div style={{ maxWidth: 720 }}>
                <div style={{ fontSize: "0.9em", color: "#f59e0b", letterSpacing: ".14em", textTransform: "uppercase", fontWeight: 800, marginBottom: 8 }}>
                  Coach Platform
                </div>
                <h1 style={{ fontSize: "2.2em", fontWeight: 900, color: "#e2e8f0", margin: "0 0 8px" }}>
                  La plataforma de coaching para todo tipo de runners
                </h1>
                <p style={{ color: "#94a3b8", fontSize: ".95em", marginTop: 0 }}>
                  Crea, asigna y sincroniza entrenamientos con IA. Conecta con Garmin y COROS. Lleva a tus atletas al siguiente nivel.
                </p>
                <div style={{ display: "flex", gap: 12, marginTop: 18, flexWrap: "wrap" }}>
                  <button
                    type="button"
                    onClick={() => { setAuthMode("register"); setLandingAuthOpen(true); }}
                    style={{ background: "linear-gradient(135deg,#b45309,#f59e0b)", border: "none", borderRadius: 10, padding: "12px 16px", color: "white", cursor: "pointer", fontFamily: "inherit", fontWeight: 900, fontSize: ".9em" }}
                  >
                    Empezar gratis
                  </button>
                  <button
                    type="button"
                    onClick={() => setDemoModalOpen(true)}
                    style={{ background: "rgba(255,255,255,.03)", border: "1px solid rgba(255,255,255,.1)", borderRadius: 10, padding: "12px 16px", color: "#e2e8f0", cursor: "pointer", fontFamily: "inherit", fontWeight: 900, fontSize: ".9em" }}
                  >
                    Ver demo
                  </button>
                </div>
              </div>
              <div style={{ minWidth: 320, flex: 1, background: "rgba(255,255,255,.02)", border: "1px solid rgba(255,255,255,.07)", borderRadius: 14, padding: 16 }}>
                <div style={{ fontSize: ".75em", color: "#94a3b8", letterSpacing: ".12em", textTransform: "uppercase", fontWeight: 800, marginBottom: 10 }}>
                  Vista previa
                </div>
                <div style={{ fontSize: "1.2em", fontWeight: 800, color: "#f59e0b", marginBottom: 8 }}>
                  Dashboard + Planes + IA
                </div>
                <div style={{ color: "#64748b", fontSize: ".9em" }}>
                  Asignación de workouts con IA, calendario y sincronización con dispositivos.
                </div>
                <div style={{ marginTop: 14, display: "grid", gridTemplateColumns: "repeat(3,1fr)", gap: 10 }}>
                  {[
                    { t: "IA", c: "#f59e0b", s: "Workouts inteligentes" },
                    { t: "Garmin", c: "#3b82f6", s: "Sync & seguimiento" },
                    { t: "COROS", c: "#22c55e", s: "Conexión flexible" },
                  ].map((x) => (
                    <div key={x.t} style={{ background: "rgba(255,255,255,.03)", border: "1px solid rgba(255,255,255,.07)", borderRadius: 12, padding: 12 }}>
                      <div style={{ fontSize: "1.2em", fontWeight: 900, color: x.c, fontFamily: "monospace" }}>{x.t}</div>
                      <div style={{ color: "#94a3b8", fontSize: ".8em", marginTop: 6 }}>{x.s}</div>
                    </div>
                  ))}
                </div>
              </div>
            </div>
          </div>

          <div style={{ marginBottom: 24 }}>
            <div style={{ fontSize: ".85em", letterSpacing: ".15em", color: "#334155", textTransform: "uppercase", fontWeight: 900, marginBottom: 12 }}>
              Features
            </div>
            <div style={{ display: "grid", gridTemplateColumns: "repeat(3, 1fr)", gap: 18 }}>
              {[
                { title: "Generador IA", body: "Crea entrenamientos en segundos y ajusta estructura, ritmos y fases." },
                { title: "Sync con relojes", body: "Exporta y sincroniza para que tu atleta entrene con precisión." },
                { title: "Seguimiento real", body: "Marca “done”, mide progreso y mantén el control del plan." },
              ].map((f) => (
                <div key={f.title} style={{ ...S.card, padding: 18 }}>
                  <div style={{ fontSize: "1.1em", fontWeight: 900, color: "#e2e8f0", marginBottom: 8 }}>{f.title}</div>
                  <div style={{ color: "#94a3b8", fontSize: ".9em", lineHeight: 1.35 }}>{f.body}</div>
                </div>
              ))}
            </div>
          </div>

          <div style={{ marginBottom: 26 }}>
            <div style={{ fontSize: ".85em", letterSpacing: ".15em", color: "#334155", textTransform: "uppercase", fontWeight: 900, marginBottom: 12 }}>
              Precios
            </div>
            <div style={{ display: "grid", gridTemplateColumns: "repeat(3, 1fr)", gap: 18 }}>
              {PLAN_CATALOG.map((p) => (
                <div key={p.plan} style={{ ...S.card, padding: 18 }}>
                  <div style={{ fontSize: "1.25em", fontWeight: 900, color: "#f59e0b" }}>
                    {p.label} (${p.priceUsd} USD)
                  </div>
                  <div style={{ fontSize: "2em", fontWeight: 900, color: "#f59e0b", fontFamily: "monospace", marginTop: 6 }}>
                    {`$${Number(p.priceCop).toLocaleString("es-CO")}`}
                    <span style={{ fontSize: ".55em", color: "#64748b", fontFamily: "inherit", marginLeft: 6 }}>COP</span>
                  </div>
                  <div style={{ color: "#94a3b8", fontSize: ".9em", marginTop: 8 }}>{p.description}</div>
                  <div style={{ marginTop: 14 }}>
                    <button
                      type="button"
                      onClick={() => { setAuthMode("register"); setLandingAuthOpen(true); }}
                      style={{ width: "100%", background: "linear-gradient(135deg,#b45309,#f59e0b)", border: "none", borderRadius: 10, padding: "10px 14px", color: "white", cursor: "pointer", fontFamily: "inherit", fontWeight: 900, fontSize: ".85em" }}
                    >
                      Empezar gratis
                    </button>
                  </div>
                </div>
              ))}
            </div>
          </div>

          <div style={{ marginBottom: 26 }}>
            <div style={{ fontSize: ".85em", letterSpacing: ".15em", color: "#334155", textTransform: "uppercase", fontWeight: 900, marginBottom: 12 }}>
              Testimonios
            </div>
            <div style={{ display: "grid", gridTemplateColumns: "repeat(3, 1fr)", gap: 18 }}>
              {[
                { name: "Sofía Ríos", role: "Coach en Colombia", body: "La IA me ayuda a construir semanas completas. Ver el estado “done” en el calendario hace que mis atletas sigan el plan con claridad." },
                { name: "Luis Martínez", role: "Coach en México", body: "Ahora asigno workouts en minutos y sincronizo con relojes. La vista semanal hace que todo sea más transparente." },
                { name: "María Torres", role: "Coach en España", body: "El seguimiento real y la exportación a dispositivos me permiten ajustar ritmos con confianza. Se nota el progreso semana a semana." },
              ].map((t) => (
                <div key={t.name} style={{ ...S.card, padding: 18 }}>
                  <div style={{ display: "flex", alignItems: "center", justifyContent: "space-between", gap: 10 }}>
                    <div>
                      <div style={{ fontSize: "1.05em", fontWeight: 900, color: "#e2e8f0" }}>{t.name}</div>
                      <div style={{ color: "#64748b", fontSize: ".85em" }}>{t.role}</div>
                    </div>
                    <div style={{ color: "#f59e0b", fontWeight: 900, fontFamily: "monospace" }}>★★★★★</div>
                  </div>
                  <div style={{ color: "#94a3b8", fontSize: ".92em", marginTop: 12, lineHeight: 1.35 }}>{t.body}</div>
                </div>
              ))}
            </div>
          </div>

          <footer style={{ marginTop: 20, paddingTop: 18, borderTop: "1px solid rgba(255,255,255,.06)", color: "#64748b", fontSize: ".85em" }}>
            <div style={{ display: "flex", alignItems: "center", justifyContent: "space-between", gap: 12, flexWrap: "wrap" }}>
              <div style={{ color: "#e2e8f0", fontWeight: 900 }}>PaceForge</div>
              <div>© 2026</div>
            </div>
          </footer>
        </main>

        {demoModalOpen && (
          <div style={{ position: "fixed", inset: 0, background: "rgba(0,0,0,.55)", display: "flex", alignItems: "center", justifyContent: "center", zIndex: 300, padding: 16 }}>
            <div style={{ ...S.card, width: "100%", maxWidth: 520, margin: 0 }}>
              <div style={{ fontSize: "1.05em", fontWeight: 900, marginBottom: 6 }}>Demo simulada</div>
              <div style={{ color: "#94a3b8", fontSize: ".9em", marginBottom: 14 }}>
                En esta demo podrás ver cómo un coach crea entrenamientos con IA, los asigna al atleta y marca progreso en el calendario.
              </div>
              <div style={{ display: "flex", gap: 10, justifyContent: "flex-end" }}>
                <button
                  type="button"
                  onClick={() => setDemoModalOpen(false)}
                  style={{ background: "rgba(255,255,255,.03)", border: "1px solid rgba(255,255,255,.1)", borderRadius: 8, padding: "8px 14px", color: "#94a3b8", cursor: "pointer", fontFamily: "inherit", fontWeight: 900, fontSize: ".82em" }}
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
    console.log("Renderizando vista AthleteHome para role=athlete");
    return <AthleteHome profile={profile} />;
  }

  return (
    <div style={S.root}>
      {notification && <div style={S.notification}>✓ {notification}</div>}

      <aside style={S.sidebar}>
        <div style={S.logo}>
          <span style={{ fontSize: "1.6em" }}>⚡</span>
          <div>
            <div style={S.logoTitle}>PACE<span style={{ color: "#f59e0b" }}>FORGE</span></div>
            <div style={S.logoSub}>Coach Platform</div>
          </div>
        </div>
        <nav style={{ flex: 1 }}>
          {[
            { id: "dashboard", icon: "◈", label: "Dashboard" },
            { id: "athletes", icon: "◉", label: "Atletas" },
            { id: "plan12", icon: "◉", label: "Plan 2 Semanas" },
            { id: "plans", icon: "◇", label: "Planes" },
            { id: "builder", icon: "◎", label: "Crear Workout" },
          ].map(item => (
            <button key={item.id} onClick={() => { setView(item.id); setSelectedAthlete(null); setShowAddAthleteForm(false); }}
              style={{ ...S.navBtn, ...(view === item.id ? S.navBtnActive : {}) }}>
              <span>{item.icon}</span><span>{item.label}</span>
            </button>
          ))}
        </nav>
        <div style={S.sidebarFooter}>
          <div style={{ fontSize: ".82em", color: "#94a3b8" }}>👤 Coach Carlos Acosta</div>
          <div style={{ fontSize: ".7em", color: "#475569" }}>
            {athletes.length} atletas · {athletes.reduce((a, b) => a + b.weekly_km, 0)} km
          </div>
          <button
            onClick={handleSignOut}
            style={{ marginTop: 10, width: "100%", background: "rgba(239,68,68,.08)", border: "1px solid rgba(239,68,68,.25)", borderRadius: 8, padding: "8px 10px", color: "#ef4444", cursor: "pointer", fontFamily: "inherit", fontSize: ".78em", fontWeight: 700 }}
          >
            Cerrar sesión
          </button>
        </div>
      </aside>

      <main style={{ flex: 1, overflowY: "auto" }}>
        {loadingAthletes ? (
          <div style={S.page}>
            <h1 style={S.pageTitle}>Cargando atletas...</h1>
          </div>
        ) : (
          <>
        {view === "dashboard" && (
          <Dashboard
            coachUserId={session?.user?.id ?? null}
            onSelect={a => { setSelectedAthlete(a); setView("athletes"); setShowAddAthleteForm(false); }}
            onRequestAddAthlete={() => setShowAddAthleteForm(true)}
            showAddAthleteForm={showAddAthleteForm}
            newAthlete={newAthlete}
            onChangeNewAthleteField={updateNewAthleteField}
            onSaveNewAthlete={saveNewAthlete}
            onCancelAddAthlete={cancelAddAthleteForm}
          />
        )}
        {view === "athletes" && (
          <Athletes
            athletes={athletes}
            selected={selectedAthlete}
            onSelect={setSelectedAthlete}
            workoutsRefresh={workoutsRefresh}
            onAthleteWorkoutsDoneSync={(athleteId, workoutsDone) => {
              setAthletes(prev => prev.map(a => (String(a.id) === String(athleteId) ? { ...a, workouts_done: workoutsDone } : a)));
              setSelectedAthlete(prev => (prev && String(prev.id) === String(athleteId) ? { ...prev, workouts_done: workoutsDone } : prev));
            }}
            onAthleteDeviceSync={(athleteId, device) => {
              setAthletes(prev => prev.map(a => (String(a.id) === String(athleteId) ? { ...a, device } : a)));
              setSelectedAthlete(prev => (prev && String(prev.id) === String(athleteId) ? { ...prev, device } : prev));
            }}
            onAthleteFcSync={(athleteId, fc_max, fc_reposo) => {
              setAthletes((prev) =>
                prev.map((a) => (String(a.id) === String(athleteId) ? normalizeAthlete({ ...a, fc_max, fc_reposo }) : a)),
              );
              setSelectedAthlete((prev) =>
                prev && String(prev.id) === String(athleteId) ? normalizeAthlete({ ...prev, fc_max, fc_reposo }) : prev,
              );
            }}
          />
        )}
        {view === "plans" && <Plans athletes={athletes} />}
        {view === "plan12" && (
          <Plan2Weeks athletes={athletes} notify={notify} onPlanAssigned={() => setWorkoutsRefresh((r) => r + 1)} />
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
            onWorkoutAssigned={() => setWorkoutsRefresh(r => r + 1)}
          />
        )}
          </>
        )}
      </main>
    </div>
  );
}

function Dashboard({
  coachUserId,
  onSelect,
  onRequestAddAthlete,
  showAddAthleteForm,
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
    const [aRes, wRes] = await Promise.all([
      supabase.from("athletes").select("*").eq("coach_id", coachUserId).order("id", { ascending: true }),
      supabase.from("workouts").select("*").eq("coach_id", coachUserId).gte("scheduled_date", ws).lte("scheduled_date", we),
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

  useEffect(() => {
    if (!coachUserId) return undefined;
    const channel = supabase
      .channel(`dashboard-coach-${coachUserId}`)
      .on(
        "postgres_changes",
        { event: "*", schema: "public", table: "athletes", filter: `coach_id=eq.${coachUserId}` },
        () => loadDashboardData(true),
      )
      .on(
        "postgres_changes",
        { event: "*", schema: "public", table: "workouts", filter: `coach_id=eq.${coachUserId}` },
        () => loadDashboardData(true),
      )
      .subscribe();
    return () => {
      supabase.removeChannel(channel);
    };
  }, [coachUserId, loadDashboardData]);

  const totalWeeklyKmTarget = useMemo(
    () => dashAthletes.reduce((sum, a) => sum + (Number(a.weekly_km) || 0), 0),
    [dashAthletes],
  );

  const { weekWorkoutsTotal, weekWorkoutsDone } = useMemo(() => ({
    weekWorkoutsTotal: weekWorkouts.length,
    weekWorkoutsDone: weekWorkouts.filter((w) => w.done).length,
  }), [weekWorkouts]);

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
      return { athlete: a, weekTotal, weekDone, adherencePct, raceName, daysLeft };
    });
  }, [dashAthletes, weekWorkouts]);

  const maxWeeklyKm = useMemo(() => {
    const m = Math.max(1, ...dashAthletes.map((a) => Number(a.weekly_km) || 0));
    return m;
  }, [dashAthletes]);

  return (
    <div style={S.page}>
      <div style={{ marginBottom: 28 }}>
        <div style={{ display: "flex", alignItems: "flex-start", justifyContent: "space-between", gap: 16 }}>
          <div>
            <h1 style={S.pageTitle}>Dashboard</h1>
            <p style={{ color: "#475569", fontSize: ".82em", marginTop: 4 }}>{weekRangeLabel} · datos en vivo</p>
          </div>
          <button
            onClick={onRequestAddAthlete}
            style={{
              background: "rgba(255,255,255,.03)",
              border: "1px solid rgba(255,255,255,.08)",
              borderRadius: 10,
              padding: "10px 14px",
              color: "#e2e8f0",
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

      {showAddAthleteForm && (
        <div style={{ marginBottom: 22, background: "rgba(255,255,255,.025)", border: "1px solid rgba(255,255,255,.07)", borderRadius: 12, padding: 18 }}>
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
                style={{ width: "100%", background: "rgba(255,255,255,.04)", border: "1px solid rgba(255,255,255,.1)", borderRadius: 8, padding: "10px 12px", color: "#e2e8f0", fontFamily: "inherit", fontSize: ".85em", outline: "none", boxSizing: "border-box" }}
              />
            </div>
            <div>
              <div style={{ fontSize: ".72em", color: "#64748b", marginBottom: 6 }}>Email</div>
              <input
                type="email"
                value={newAthlete.email}
                onChange={e => onChangeNewAthleteField("email", e.target.value)}
                placeholder="atleta@correo.com"
                style={{ width: "100%", background: "rgba(255,255,255,.04)", border: "1px solid rgba(255,255,255,.1)", borderRadius: 8, padding: "10px 12px", color: "#e2e8f0", fontFamily: "inherit", fontSize: ".85em", outline: "none", boxSizing: "border-box" }}
              />
            </div>
            <div>
              <div style={{ fontSize: ".72em", color: "#64748b", marginBottom: 6 }}>Ritmo por km</div>
              <input
                value={newAthlete.pace}
                onChange={e => onChangeNewAthleteField("pace", e.target.value)}
                placeholder="Ej: 5:10/km"
                style={{ width: "100%", background: "rgba(255,255,255,.04)", border: "1px solid rgba(255,255,255,.1)", borderRadius: 8, padding: "10px 12px", color: "#e2e8f0", fontFamily: "inherit", fontSize: ".85em", outline: "none", boxSizing: "border-box" }}
              />
            </div>
            <div style={{ gridColumn: "1 / -1" }}>
              <div style={{ fontSize: ".72em", color: "#64748b", marginBottom: 6 }}>Objetivo</div>
              <input
                value={newAthlete.goal}
                onChange={e => onChangeNewAthleteField("goal", e.target.value)}
                placeholder="Ej: Sub 3:45 Maratón"
                style={{ width: "100%", background: "rgba(255,255,255,.04)", border: "1px solid rgba(255,255,255,.1)", borderRadius: 8, padding: "10px 12px", color: "#e2e8f0", fontFamily: "inherit", fontSize: ".85em", outline: "none", boxSizing: "border-box" }}
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
                style={{ width: "100%", background: "rgba(255,255,255,.04)", border: "1px solid rgba(255,255,255,.1)", borderRadius: 8, padding: "10px 12px", color: "#e2e8f0", fontFamily: "inherit", fontSize: ".85em", outline: "none", boxSizing: "border-box" }}
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
                background: "rgba(255,255,255,.03)",
                border: "1px solid rgba(255,255,255,.1)",
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
                background: "linear-gradient(135deg,#b45309,#f59e0b)",
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
          <div style={{ display: "grid", gridTemplateColumns: "repeat(3, 1fr)", gap: 14, marginBottom: 28 }}>
            {[
              { label: "Atletas activos", value: dashAthletes.length, sub: "Registrados bajo tu cuenta", icon: "🏃", color: "#f59e0b" },
              { label: "Km objetivo / semana", value: `${totalWeeklyKmTarget} km`, sub: "Suma de weekly_km de tus atletas", icon: "📍", color: "#3b82f6" },
              {
                label: "Adherencia global",
                value: weekWorkoutsTotal ? `${globalAdherencePct}%` : "—",
                sub: weekWorkoutsTotal ? `${weekWorkoutsDone} de ${weekWorkoutsTotal} workouts esta semana` : "Sin entrenamientos programados esta semana",
                icon: "✅",
                color: "#22c55e",
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
                  <tr style={{ background: "rgba(255,255,255,.04)", textAlign: "left", color: "#94a3b8" }}>
                    <th style={{ padding: "12px 14px", fontWeight: 700 }}>Atleta</th>
                    <th style={{ padding: "12px 14px", fontWeight: 700 }}>Km / sem</th>
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
                    athleteRows.map(({ athlete: a, weekTotal, weekDone, adherencePct, raceName, daysLeft }) => (
                      <tr
                        key={a.id}
                        onClick={() => onSelect(a)}
                        style={{ borderTop: "1px solid rgba(255,255,255,.06)", cursor: "pointer" }}
                      >
                        <td style={{ padding: "12px 14px", color: "#e2e8f0", fontWeight: 600 }}>{a.name}</td>
                        <td style={{ padding: "12px 14px", color: "#cbd5e1", fontFamily: "monospace" }}>{a.weekly_km} km</td>
                        <td style={{ padding: "12px 14px" }}>
                          <div style={{ fontSize: ".72em", color: "#64748b", marginBottom: 4 }}>
                            {weekTotal ? `${weekDone}/${weekTotal} · ${adherencePct}%` : "Sin workouts esta semana"}
                          </div>
                          <ProgressBar value={weekDone} total={weekTotal || 1} color={adherencePct >= 70 ? "#22c55e" : adherencePct >= 40 ? "#f59e0b" : "#ef4444"} />
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

          <div style={{ fontSize: ".72em", letterSpacing: ".15em", color: "#475569", textTransform: "uppercase", marginBottom: 14 }}>Km semanales por atleta</div>
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
                {dashAthletes.map((a) => {
                  const km = Number(a.weekly_km) || 0;
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
                      title={`${a.name}: ${km} km/semana`}
                    >
                      <div
                        style={{
                          width: "100%",
                          height: 110,
                          display: "flex",
                          alignItems: "flex-end",
                          justifyContent: "center",
                          background: "rgba(255,255,255,.03)",
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
                            boxShadow: "0 0 12px rgba(245,158,11,.25)",
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

function Athletes({ athletes, selected, onSelect, workoutsRefresh, onAthleteWorkoutsDoneSync, onAthleteDeviceSync, onAthleteFcSync }) {
  const S = styles;
  const athlete = (selected ? athletes.find(a => String(a.id) === String(selected.id)) : athletes[0]) || null;
  const [searchQuery, setSearchQuery] = useState("");
  const [workouts, setWorkouts] = useState([]);
  const [loadingWorkouts, setLoadingWorkouts] = useState(false);
  const [deviceModal, setDeviceModal] = useState({ open: false, provider: null });
  const [deviceMessage, setDeviceMessage] = useState("");
  const [fcMaxInput, setFcMaxInput] = useState("");
  const [fcReposoInput, setFcReposoInput] = useState("");
  const [fcSaving, setFcSaving] = useState(false);
  const [coachId, setCoachId] = useState(null);
  const [chatMessages, setChatMessages] = useState([]);
  const [chatDraft, setChatDraft] = useState("");
  const [chatSending, setChatSending] = useState(false);
  const chatScrollRef = useRef(null);
  const normalized = searchQuery.trim().toLowerCase();
  const filteredAthletes = normalized
    ? athletes.filter(a => (a.name || "").toLowerCase().includes(normalized) || (a.goal || "").toLowerCase().includes(normalized))
    : athletes;

  useEffect(() => {
    if (!athlete?.id) {
      setWorkouts([]);
      return;
    }
    let cancelled = false;
    const load = async () => {
      setLoadingWorkouts(true);
      const { data, error } = await supabase
        .from("workouts")
        .select("*")
        .eq("athlete_id", athlete.id)
        .order("scheduled_date", { ascending: true });
      if (cancelled) return;
      if (error) {
        console.error("Error cargando workouts:", error);
        setWorkouts([]);
      } else {
        setWorkouts((data || []).map(normalizeWorkoutRow));
      }
      setLoadingWorkouts(false);
    };
    load();
    return () => { cancelled = true; };
  }, [athlete?.id, workoutsRefresh]);

  const workoutsByDate = useMemo(() => {
    const m = {};
    for (const w of workouts) {
      const k = w.scheduled_date;
      if (!m[k]) m[k] = [];
      m[k].push(w);
    }
    return m;
  }, [workouts]);

  const CALENDAR_DAYS = 42;
  const weekStart = useMemo(() => {
    const thisMonday = startOfWeekMonday(new Date());
    if (!workouts.length) return thisMonday;
    let minMs = Infinity;
    for (const w of workouts) {
      const t = new Date(`${w.scheduled_date}T12:00:00`).getTime();
      if (t < minMs) minMs = t;
    }
    const firstMonday = startOfWeekMonday(new Date(minMs));
    return firstMonday.getTime() < thisMonday.getTime() ? firstMonday : thisMonday;
  }, [workouts]);
  const calendarCells = useMemo(
    () => Array.from({ length: CALENDAR_DAYS }, (_, i) => addDays(weekStart, i)),
    [weekStart],
  );

  const toggleWorkoutDone = async (w) => {
    const next = !w.done;
    const { error } = await supabase.from("workouts").update({ done: next }).eq("id", w.id);
    if (error) {
      console.error(error);
      alert(`Error al actualizar: ${error.message}`);
      return;
    }
    const nextWorkouts = workouts.map(x => (x.id === w.id ? { ...x, done: next } : x));
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
  };

  const isCorosConnected = athlete?.device === "coros";
  const latestWorkout = workouts.length
    ? [...workouts].sort((a, b) => {
      if (a.scheduled_date === b.scheduled_date) return String(b.id).localeCompare(String(a.id));
      return b.scheduled_date.localeCompare(a.scheduled_date);
    })[0]
    : null;

  const openDeviceModal = (provider) => {
    setDeviceMessage("");
    setDeviceModal({ open: true, provider });
  };

  const confirmCorosConnect = async () => {
    if (!athlete?.id) return;
    const { error } = await supabase.from("athletes").update({ device: "coros" }).eq("id", athlete.id);
    if (error) {
      console.error("Error guardando device en athletes:", error);
      alert(`Error al conectar COROS: ${error.message}`);
      return;
    }
    onAthleteDeviceSync?.(athlete.id, "coros");
    setDeviceMessage("COROS conectado correctamente.");
    setDeviceModal({ open: false, provider: null });
  };

  const syncLatestWorkoutToCoros = () => {
    if (!latestWorkout) {
      setDeviceMessage("No hay workouts para sincronizar.");
      return;
    }
    setDeviceMessage(`Workout "${latestWorkout.title}" sincronizado a COROS ✓`);
  };

  const loadCoachChat = useCallback(async () => {
    if (!athlete?.id || !coachId) {
      setChatMessages([]);
      return;
    }
    const { data, error } = await supabase
      .from("messages")
      .select("*")
      .eq("athlete_id", athlete.id)
      .eq("coach_id", coachId)
      .order("created_at", { ascending: true });
    if (error) {
      console.error("Error cargando mensajes:", error);
      return;
    }
    setChatMessages(data || []);
  }, [athlete?.id, coachId]);

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

  useEffect(() => {
    loadCoachChat();
  }, [loadCoachChat]);

  useEffect(() => {
    const t = setInterval(() => loadCoachChat(), 10000);
    return () => clearInterval(t);
  }, [loadCoachChat]);

  useEffect(() => {
    if (!chatScrollRef.current) return;
    chatScrollRef.current.scrollTop = chatScrollRef.current.scrollHeight;
  }, [chatMessages]);

  const saveAthleteFc = async () => {
    if (!athlete?.id) return;
    const fcmax = fcMaxInput.trim() === "" ? null : Math.round(Number(fcMaxInput));
    const fcr = fcReposoInput.trim() === "" ? null : Math.round(Number(fcReposoInput));
    if (fcmax != null && (!Number.isFinite(fcmax) || fcmax < 30 || fcmax > 250)) {
      alert("FC máxima: indica un valor entre 30 y 250 lpm, o déjalo vacío.");
      return;
    }
    if (fcr != null && (!Number.isFinite(fcr) || fcr < 30 || fcr > 120)) {
      alert("FC reposo: indica un valor entre 30 y 120 lpm, o déjalo vacío.");
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

  const sendCoachChat = async () => {
    const body = chatDraft.trim();
    if (!body || !athlete?.id || !coachId || chatSending) return;
    setChatSending(true);
    try {
      const { error } = await supabase.from("messages").insert({
        athlete_id: athlete.id,
        coach_id: coachId,
        sender_role: "coach",
        body,
      });
      if (error) {
        console.error(error);
        alert(`No se pudo enviar: ${error.message}`);
        return;
      }
      setChatDraft("");
      await loadCoachChat();
    } finally {
      setChatSending(false);
    }
  };

  if (!athlete) {
    return (
      <div style={S.page}>
        <h1 style={{ ...S.pageTitle, marginBottom: 20 }}>Atletas</h1>
        <div style={{ color: "#64748b", fontSize: ".9em" }}>No se encontraron atletas</div>
      </div>
    );
  }
  return (
    <div style={S.page}>
      <h1 style={{ ...S.pageTitle, marginBottom: 20 }}>Atletas</h1>
      <div style={{ display: "grid", gridTemplateColumns: "220px 1fr", gap: 20 }}>
        <div>
          <div style={{ marginBottom: 10 }}>
            <div style={{ fontSize: ".72em", color: "#475569", marginBottom: 6 }}>Buscar</div>
            <input
              value={searchQuery}
              onChange={e => setSearchQuery(e.target.value)}
              placeholder="Nombre o objetivo"
              style={{ width: "100%", background: "rgba(255,255,255,.04)", border: "1px solid rgba(255,255,255,.1)", borderRadius: 8, padding: "10px 12px", color: "#e2e8f0", fontFamily: "inherit", fontSize: ".85em", outline: "none", boxSizing: "border-box" }}
            />
          </div>

          {filteredAthletes.length === 0 ? (
            <div style={{ padding: "14px 8px", color: "#64748b", fontSize: ".85em" }}>No se encontraron atletas</div>
          ) : (
            filteredAthletes.map(a => (
              <div key={a.id} onClick={() => onSelect(a)} style={{ display: "flex", gap: 10, alignItems: "center", padding: "10px 12px", borderRadius: 8, cursor: "pointer", border: `1px solid ${athlete.id === a.id ? "rgba(245,158,11,.2)" : "transparent"}`, background: athlete.id === a.id ? "rgba(245,158,11,.08)" : "transparent", marginBottom: 6 }}>
                <span style={{ fontSize: "1.3em" }}>{a.avatar}</span>
                <div>
                  <div style={{ fontSize: ".85em", fontWeight: 600, color: "#e2e8f0" }}>{a.name}</div>
                  <div style={{ fontSize: ".7em", color: "#64748b" }}>{a.pace} · {a.weekly_km}km</div>
                </div>
              </div>
            ))
          )}
        </div>
        <div style={{ ...S.card }}>
          <div style={{ display: "flex", gap: 16, alignItems: "center", marginBottom: 20 }}>
            <div style={{ ...S.avatar, width: 52, height: 52, fontSize: "1.8em" }}>{athlete.avatar}</div>
            <div>
              <div style={{ fontSize: "1.3em", fontWeight: 700, color: "#e2e8f0" }}>{athlete.name}</div>
              <div style={{ color: "#64748b", fontSize: ".85em" }}>{athlete.goal}</div>
            </div>
            <StatusBadge status={athlete.status} />
          </div>
          <div style={{ display: "grid", gridTemplateColumns: "repeat(3,1fr)", gap: 12, marginBottom: 24 }}>
            {[{ label: "Ritmo", value: athlete.pace, icon: "⚡" }, { label: "Km/Semana", value: `${athlete.weekly_km}km`, icon: "📍" }, { label: "Adherencia", value: `${Math.round(athlete.workouts_done/athlete.workouts_total*100)}%`, icon: "✅" }].map((m,i) => (
              <div key={i} style={{ background: "rgba(255,255,255,.03)", borderRadius: 10, padding: "14px 12px", textAlign: "center", border: "1px solid rgba(255,255,255,.06)" }}>
                <div style={{ fontSize: "1.3em" }}>{m.icon}</div>
                <div style={{ fontSize: "1.2em", fontWeight: 700, color: "#f59e0b", fontFamily: "monospace" }}>{m.value}</div>
                <div style={{ fontSize: ".7em", color: "#64748b" }}>{m.label}</div>
              </div>
            ))}
          </div>

          <div style={{ marginBottom: 24, paddingBottom: 20, borderBottom: "1px solid rgba(255,255,255,.06)" }}>
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
                  style={{ width: "100%", background: "rgba(255,255,255,.04)", border: "1px solid rgba(255,255,255,.1)", borderRadius: 8, padding: "8px 10px", color: "#e2e8f0", fontFamily: "inherit", fontSize: ".85em", outline: "none", boxSizing: "border-box" }}
                />
              </div>
              <div style={{ flex: "1 1 120px", minWidth: 100 }}>
                <div style={{ fontSize: ".72em", color: "#64748b", marginBottom: 6 }}>FC reposo (lpm)</div>
                <input
                  type="number"
                  min={30}
                  max={120}
                  placeholder="Ej: 48"
                  value={fcReposoInput}
                  onChange={(e) => setFcReposoInput(e.target.value)}
                  style={{ width: "100%", background: "rgba(255,255,255,.04)", border: "1px solid rgba(255,255,255,.1)", borderRadius: 8, padding: "8px 10px", color: "#e2e8f0", fontFamily: "inherit", fontSize: ".85em", outline: "none", boxSizing: "border-box" }}
                />
              </div>
              <button
                type="button"
                onClick={saveAthleteFc}
                disabled={fcSaving}
                style={{
                  background: fcSaving ? "rgba(255,255,255,.06)" : "linear-gradient(135deg,#b45309,#f59e0b)",
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
              const zones = computeAthleteHrZones(athlete.fc_max);
              return zones ? (
              <div style={{ display: "flex", flexDirection: "column", gap: 8 }}>
                {zones.map((z) => (
                  <div key={z.zone}>
                    <div style={{ display: "flex", justifyContent: "space-between", alignItems: "baseline", marginBottom: 4, fontSize: ".78em" }}>
                      <span style={{ color: "#e2e8f0", fontWeight: 600 }}>
                        Zona {z.zone}: {z.low}–{z.high} lpm
                      </span>
                      <span style={{ color: "#64748b", fontSize: ".72em" }}>{z.pctLabel}</span>
                    </div>
                    <div style={{ fontSize: ".72em", color: "#94a3b8", marginBottom: 4 }}>{z.label}</div>
                    <div style={{ height: 10, borderRadius: 5, background: "rgba(255,255,255,.06)", overflow: "hidden" }}>
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

          <div style={{ fontSize: ".65em", letterSpacing: ".15em", color: "#334155", textTransform: "uppercase", marginBottom: 10 }}>
            CALENDARIO — {formatLocalYMD(calendarCells[0])} → {formatLocalYMD(calendarCells[calendarCells.length - 1])}
          </div>
          {loadingWorkouts ? (
            <div style={{ color: "#64748b", fontSize: ".85em", padding: "20px 0" }}>Cargando...</div>
          ) : (
            <div style={{ display: "grid", gridTemplateColumns: "repeat(7,1fr)", gap: 4 }}>
              {DAYS.map(d => <div key={d} style={{ fontSize: ".65em", textAlign: "center", color: "#334155", padding: "4px 0" }}>{d}</div>)}
              {calendarCells.map((cellDate, i) => {
                const ymd = formatLocalYMD(cellDate);
                const dayWorkouts = workoutsByDate[ymd] || [];
                const hasWorkout = dayWorkouts.length > 0;
                const hasDoneWorkout = dayWorkouts.some(w => w.done);
                const borderColor = hasWorkout
                  ? `${WORKOUT_TYPES.find(t => t.id === dayWorkouts[0].type)?.color || "#64748b"}40`
                  : "rgba(255,255,255,.05)";
                return (
                  <div
                    key={i}
                    style={{
                      minHeight: 72,
                      border: `1px solid ${borderColor}`,
                      borderRadius: 6,
                      padding: "4px 3px",
                      display: "flex",
                      flexDirection: "column",
                      alignItems: "stretch",
                      gap: 3,
                      background: hasDoneWorkout ? "rgba(34,197,94,.08)" : (hasWorkout ? "rgba(255,255,255,.02)" : "transparent"),
                    }}
                  >
                    <div style={{ fontSize: ".58em", color: "#475569", textAlign: "center", fontWeight: 600 }}>{cellDate.getDate()}</div>
                    {dayWorkouts.map(w => {
                      const wt = WORKOUT_TYPES.find(t => t.id === w.type) || WORKOUT_TYPES[0];
                      return (
                        <button
                          key={w.id}
                          type="button"
                          onClick={() => toggleWorkoutDone(w)}
                          title={w.done ? "Marcar como pendiente" : "Marcar como hecho"}
                          style={{
                            border: `1px solid ${w.done ? "rgba(34,197,94,.55)" : `${wt.color}55`}`,
                            borderRadius: 5,
                            padding: "4px 3px",
                            background: w.done ? "rgba(34,197,94,.16)" : `${wt.color}12`,
                            cursor: "pointer",
                            fontFamily: "inherit",
                            textAlign: "center",
                            width: "100%",
                            boxSizing: "border-box",
                          }}
                        >
                          <div style={{ width: 5, height: 5, borderRadius: "50%", background: wt.color, margin: "0 auto 2px" }} />
                          <div style={{ fontSize: ".52em", color: wt.color, fontWeight: 600, lineHeight: 1.15 }}>{w.title}</div>
                          <div style={{ fontSize: ".5em", color: "#475569" }}>{w.total_km} km</div>
                          {w.done && <div style={{ fontSize: ".52em", color: "#22c55e", marginTop: 1 }}>✓ Hecho</div>}
                        </button>
                      );
                    })}
                  </div>
                );
              })}
            </div>
          )}

          <div style={{ marginTop: 22 }}>
            <div style={{ fontSize: ".65em", letterSpacing: ".15em", color: "#334155", textTransform: "uppercase", marginBottom: 10 }}>
              DISPOSITIVOS
            </div>
            <div style={{ display: "flex", gap: 10, flexWrap: "wrap", marginBottom: 10 }}>
              <button
                type="button"
                onClick={() => openDeviceModal("coros")}
                style={{ background: "rgba(255,255,255,.03)", border: "1px solid rgba(255,255,255,.1)", borderRadius: 8, padding: "8px 12px", color: "#e2e8f0", cursor: "pointer", fontFamily: "inherit", fontSize: ".8em", fontWeight: 700 }}
              >
                Conectar COROS
              </button>
              <button
                type="button"
                onClick={() => openDeviceModal("garmin")}
                style={{ background: "rgba(255,255,255,.03)", border: "1px solid rgba(255,255,255,.1)", borderRadius: 8, padding: "8px 12px", color: "#e2e8f0", cursor: "pointer", fontFamily: "inherit", fontSize: ".8em", fontWeight: 700 }}
              >
                Conectar Garmin
              </button>
              <span style={{ background: "rgba(245,158,11,.15)", border: "1px solid rgba(245,158,11,.35)", borderRadius: 999, padding: "6px 10px", color: "#f59e0b", fontSize: ".75em", fontWeight: 700 }}>
                Garmin · Próximamente
              </span>
              {isCorosConnected && (
                <span style={{ background: "rgba(34,197,94,.14)", border: "1px solid rgba(34,197,94,.35)", borderRadius: 999, padding: "6px 10px", color: "#22c55e", fontSize: ".75em", fontWeight: 700 }}>
                  COROS conectado ⌚
                </span>
              )}
            </div>
            {isCorosConnected && (
              <button
                type="button"
                onClick={syncLatestWorkoutToCoros}
                style={{ background: "rgba(59,130,246,.12)", border: "1px solid rgba(59,130,246,.35)", borderRadius: 8, padding: "8px 12px", color: "#3b82f6", cursor: "pointer", fontFamily: "inherit", fontSize: ".8em", fontWeight: 700 }}
              >
                Sync workout a COROS
              </button>
            )}
            {!!deviceMessage && <div style={{ marginTop: 10, color: "#22c55e", fontSize: ".78em" }}>{deviceMessage}</div>}
          </div>

          <div style={{ marginTop: 22 }}>
            <div style={{ fontSize: ".65em", letterSpacing: ".15em", color: "#334155", textTransform: "uppercase", marginBottom: 10 }}>
              CHAT CON ATLETA
            </div>
            <div
              ref={chatScrollRef}
              style={{
                maxHeight: 280,
                overflowY: "auto",
                padding: "10px 8px",
                borderRadius: 10,
                background: "rgba(0,0,0,.2)",
                border: "1px solid rgba(255,255,255,.06)",
                marginBottom: 10,
                display: "flex",
                flexDirection: "column",
                gap: 8,
              }}
            >
              {chatMessages.length === 0 ? (
                <div style={{ color: "#64748b", fontSize: ".8em", textAlign: "center", padding: "12px 0" }}>Sin mensajes aún</div>
              ) : (
                chatMessages.map((m) => {
                  const isCoach = m.sender_role === "coach";
                  return (
                    <div
                      key={m.id}
                      style={{
                        alignSelf: isCoach ? "flex-end" : "flex-start",
                        maxWidth: "88%",
                        padding: "8px 12px",
                        borderRadius: 10,
                        background: isCoach
                          ? "linear-gradient(135deg, rgba(180,83,9,.85), rgba(245,158,11,.75))"
                          : "rgba(59,130,246,.35)",
                        border: `1px solid ${isCoach ? "rgba(245,158,11,.5)" : "rgba(59,130,246,.45)"}`,
                        color: "#f8fafc",
                        fontSize: ".82em",
                        lineHeight: 1.45,
                      }}
                    >
                      <div>{m.body}</div>
                      <div style={{ fontSize: ".65em", color: isCoach ? "rgba(255,255,255,.75)" : "rgba(191,219,254,.85)", marginTop: 6 }}>
                        {formatMessageTimestamp(m.created_at)}
                      </div>
                    </div>
                  );
                })
              )}
            </div>
            <div style={{ display: "flex", gap: 8, alignItems: "stretch" }}>
              <input
                type="text"
                value={chatDraft}
                onChange={(e) => setChatDraft(e.target.value)}
                onKeyDown={(e) => e.key === "Enter" && sendCoachChat()}
                placeholder="Escribe un mensaje…"
                style={{
                  flex: 1,
                  background: "rgba(255,255,255,.04)",
                  border: "1px solid rgba(255,255,255,.1)",
                  borderRadius: 8,
                  padding: "10px 12px",
                  color: "#e2e8f0",
                  fontFamily: "inherit",
                  fontSize: ".85em",
                  outline: "none",
                  boxSizing: "border-box",
                }}
              />
              <button
                type="button"
                onClick={sendCoachChat}
                disabled={chatSending || !chatDraft.trim() || !coachId}
                style={{
                  background: chatSending || !chatDraft.trim() ? "rgba(255,255,255,.06)" : "linear-gradient(135deg,#b45309,#f59e0b)",
                  border: "none",
                  borderRadius: 8,
                  padding: "10px 16px",
                  color: chatSending || !chatDraft.trim() ? "#64748b" : "white",
                  fontWeight: 800,
                  cursor: chatSending || !chatDraft.trim() ? "not-allowed" : "pointer",
                  fontFamily: "inherit",
                  fontSize: ".82em",
                  whiteSpace: "nowrap",
                }}
              >
                Enviar
              </button>
            </div>
          </div>
        </div>
      </div>

      {deviceModal.open && (
        <div style={{ position: "fixed", inset: 0, background: "rgba(0,0,0,.55)", display: "flex", alignItems: "center", justifyContent: "center", zIndex: 200, padding: 16 }}>
          <div style={{ ...S.card, width: "100%", maxWidth: 420, margin: 0 }}>
            <div style={{ fontSize: ".95em", fontWeight: 700, color: "#e2e8f0", marginBottom: 8 }}>
              Conectar {deviceModal.provider === "garmin" ? "Garmin" : "COROS"}
            </div>
            <div style={{ fontSize: ".8em", color: "#94a3b8", marginBottom: 14 }}>
              {deviceModal.provider === "garmin"
                ? "Garmin estará disponible próximamente. La conexión OAuth se habilitará en una próxima versión."
                : "Serás redirigido a COROS para autorizar la conexión OAuth del atleta."}
            </div>
            <div style={{ display: "flex", gap: 10, justifyContent: "flex-end" }}>
              <button
                type="button"
                onClick={() => setDeviceModal({ open: false, provider: null })}
                style={{ background: "rgba(255,255,255,.03)", border: "1px solid rgba(255,255,255,.1)", borderRadius: 8, padding: "8px 14px", color: "#94a3b8", cursor: "pointer", fontFamily: "inherit", fontWeight: 700, fontSize: ".82em" }}
              >
                Cancelar
              </button>
              <button
                type="button"
                onClick={deviceModal.provider === "garmin" ? () => setDeviceModal({ open: false, provider: null }) : confirmCorosConnect}
                style={{ background: "linear-gradient(135deg,#b45309,#f59e0b)", border: "none", borderRadius: 8, padding: "8px 14px", color: "white", cursor: "pointer", fontFamily: "inherit", fontWeight: 800, fontSize: ".82em" }}
              >
                {deviceModal.provider === "garmin" ? "Entendido" : "Autorizar"}
              </button>
            </div>
          </div>
        </div>
      )}
    </div>
  );
}

function AthleteHome({ profile }) {
  const S = styles;
  const [athleteInfo, setAthleteInfo] = useState(null);
  const [workouts, setWorkouts] = useState([]);
  const [loading, setLoading] = useState(true);
  const [message, setMessage] = useState("");
  const [athleteChatMessages, setAthleteChatMessages] = useState([]);
  const [athleteChatDraft, setAthleteChatDraft] = useState("");
  const [athleteChatSending, setAthleteChatSending] = useState(false);
  const athleteChatScrollRef = useRef(null);

  useEffect(() => {
    let cancelled = false;
    const load = async () => {
      if (!profile?.user_id) return;
      setLoading(true);
      setMessage("");

      const [{ data: athleteRow, error: athleteErr }, { data: workoutsRows, error: workoutsErr }] = await Promise.all([
        supabase.from("athletes").select("*").eq("id", profile.user_id).maybeSingle(),
        supabase.from("workouts").select("*").eq("athlete_id", profile.user_id).order("scheduled_date", { ascending: true }),
      ]);

      if (cancelled) return;

      if (athleteErr) {
        console.error("Error cargando atleta:", athleteErr);
        setAthleteInfo(null);
      } else {
        setAthleteInfo(athleteRow || null);
      }

      if (workoutsErr) {
        console.error("Error cargando workouts atleta:", workoutsErr);
        setWorkouts([]);
      } else {
        setWorkouts((workoutsRows || []).map(normalizeWorkoutRow));
      }

      setLoading(false);
    };

    load();
    return () => { cancelled = true; };
  }, [profile?.user_id]);

  const workoutsByDate = useMemo(() => {
    const m = {};
    for (const w of workouts) {
      const k = w.scheduled_date;
      if (!m[k]) m[k] = [];
      m[k].push(w);
    }
    return m;
  }, [workouts]);

  const CALENDAR_DAYS = 42;
  const weekStart = useMemo(() => {
    const thisMonday = startOfWeekMonday(new Date());
    if (!workouts.length) return thisMonday;
    let minMs = Infinity;
    for (const w of workouts) {
      const t = new Date(`${w.scheduled_date}T12:00:00`).getTime();
      if (t < minMs) minMs = t;
    }
    const firstMonday = startOfWeekMonday(new Date(minMs));
    return firstMonday.getTime() < thisMonday.getTime() ? firstMonday : thisMonday;
  }, [workouts]);

  const calendarCells = useMemo(
    () => Array.from({ length: CALENDAR_DAYS }, (_, i) => addDays(weekStart, i)),
    [weekStart],
  );

  const thisWeekStart = useMemo(() => startOfWeekMonday(new Date()), []);
  const thisWeekEnd = useMemo(() => addDays(thisWeekStart, 6), [thisWeekStart]);
  const thisWeekStartYmd = useMemo(() => formatLocalYMD(thisWeekStart), [thisWeekStart]);
  const thisWeekEndYmd = useMemo(() => formatLocalYMD(thisWeekEnd), [thisWeekEnd]);

  const weeklyWorkouts = useMemo(
    () => workouts.filter(w => w.scheduled_date >= thisWeekStartYmd && w.scheduled_date <= thisWeekEndYmd),
    [workouts, thisWeekStartYmd, thisWeekEndYmd],
  );

  const weeklyTotalKm = useMemo(() => weeklyWorkouts.reduce((s, w) => s + (Number(w.total_km) || 0), 0), [weeklyWorkouts]);
  const weeklyDoneKm = useMemo(() => weeklyWorkouts.filter(w => w.done).reduce((s, w) => s + (Number(w.total_km) || 0), 0), [weeklyWorkouts]);

  const toggleDone = async (w) => {
    const next = !w.done;
    setWorkouts(prev => prev.map(x => (x.id === w.id ? { ...x, done: next } : x)));
    const { error } = await supabase.from("workouts").update({ done: next }).eq("id", w.id);
    if (error) {
      console.error("Error actualizando workout:", error);
      setWorkouts(prev => prev.map(x => (x.id === w.id ? { ...x, done: !next } : x)));
      setMessage(`Error actualizando workout: ${error.message}`);
    }
  };

  const athleteName = profile?.name || athleteInfo?.name || "Atleta";
  const nextRaceText = athleteInfo?.next_race ? `🏁 ${getRaceCountdownText(athleteInfo.next_race)}` : "🏁 Próxima carrera · fecha pendiente";

  const coachIdForChat = athleteInfo?.coach_id || null;

  const loadAthleteChat = useCallback(async () => {
    if (!profile?.user_id || !coachIdForChat) {
      setAthleteChatMessages([]);
      return;
    }
    const { data, error } = await supabase
      .from("messages")
      .select("*")
      .eq("athlete_id", profile.user_id)
      .eq("coach_id", coachIdForChat)
      .order("created_at", { ascending: true });
    if (error) {
      console.error("Error cargando chat atleta:", error);
      return;
    }
    setAthleteChatMessages(data || []);
  }, [profile?.user_id, coachIdForChat]);

  useEffect(() => {
    loadAthleteChat();
  }, [loadAthleteChat]);

  useEffect(() => {
    const t = setInterval(() => loadAthleteChat(), 10000);
    return () => clearInterval(t);
  }, [loadAthleteChat]);

  useEffect(() => {
    if (!athleteChatScrollRef.current) return;
    athleteChatScrollRef.current.scrollTop = athleteChatScrollRef.current.scrollHeight;
  }, [athleteChatMessages]);

  const sendAthleteChat = async () => {
    const body = athleteChatDraft.trim();
    if (!body || !profile?.user_id || !coachIdForChat || athleteChatSending) return;
    setAthleteChatSending(true);
    try {
      const { error } = await supabase.from("messages").insert({
        athlete_id: profile.user_id,
        coach_id: coachIdForChat,
        sender_role: "athlete",
        body,
      });
      if (error) {
        console.error(error);
        setMessage(`Error al enviar mensaje: ${error.message}`);
        return;
      }
      setAthleteChatDraft("");
      await loadAthleteChat();
    } finally {
      setAthleteChatSending(false);
    }
  };

  return (
    <div style={S.page}>
      <div style={{ display: "flex", alignItems: "flex-start", justifyContent: "space-between", gap: 16, flexWrap: "wrap", marginBottom: 18 }}>
        <div>
          <h1 style={{ ...S.pageTitle, marginBottom: 6 }}>Hola, {athleteName}</h1>
          <div style={{ color: "#94a3b8", fontSize: ".9em" }}>{nextRaceText}</div>
        </div>
        <div style={{ display: "flex", flexDirection: "column", alignItems: "flex-end", gap: 10 }}>
          <button
            type="button"
            onClick={async () => {
              const { error } = await supabase.auth.signOut();
              if (error) {
                console.error("Error al cerrar sesión:", error);
                alert(`Error al cerrar sesión: ${error.message}`);
              }
            }}
            style={{
              background: "rgba(239,68,68,.08)",
              border: "1px solid rgba(239,68,68,.25)",
              borderRadius: 8,
              padding: "8px 14px",
              color: "#ef4444",
              cursor: "pointer",
              fontFamily: "inherit",
              fontSize: ".8em",
              fontWeight: 700,
              whiteSpace: "nowrap",
            }}
          >
            Cerrar sesión
          </button>
          <div style={{ ...S.card, padding: 14, minWidth: 260 }}>
            <div style={{ fontSize: ".72em", letterSpacing: ".13em", color: "#475569", textTransform: "uppercase", marginBottom: 8 }}>PROGRESO SEMANAL</div>
            <div style={{ fontSize: "1.6em", fontWeight: 900, color: "#22c55e", fontFamily: "monospace" }}>
              {weeklyDoneKm} / {weeklyTotalKm} km
            </div>
            <div style={{ color: "#64748b", fontSize: ".8em", marginTop: 6 }}>
              Semana {thisWeekStartYmd} → {thisWeekEndYmd}
            </div>
          </div>
        </div>
      </div>

      {message && <div style={{ ...S.card, border: "1px solid rgba(239,68,68,.35)", background: "rgba(239,68,68,.08)", color: "#fecaca", marginBottom: 14 }}>{message}</div>}

      <div style={{ ...S.card }}>
        <div style={{ fontSize: ".65em", letterSpacing: ".15em", color: "#334155", textTransform: "uppercase", marginBottom: 10 }}>
          CALENDARIO — {formatLocalYMD(calendarCells[0])} → {formatLocalYMD(calendarCells[calendarCells.length - 1])}
        </div>

        {loading ? (
          <div style={{ color: "#64748b", fontSize: ".85em", padding: "20px 0" }}>Cargando...</div>
        ) : (
          <div style={{ display: "grid", gridTemplateColumns: "repeat(7,1fr)", gap: 4 }}>
            {DAYS.map(d => <div key={d} style={{ fontSize: ".65em", textAlign: "center", color: "#334155", padding: "4px 0" }}>{d}</div>)}
            {calendarCells.map((cellDate, i) => {
              const ymd = formatLocalYMD(cellDate);
              const dayWorkouts = workoutsByDate[ymd] || [];
              const hasWorkout = dayWorkouts.length > 0;
              const hasDoneWorkout = dayWorkouts.some(w => w.done);
              const borderColor = hasWorkout
                ? `${WORKOUT_TYPES.find(t => t.id === dayWorkouts[0].type)?.color || "#64748b"}40`
                : "rgba(255,255,255,.05)";

              return (
                <div
                  key={i}
                  style={{
                    minHeight: 72,
                    border: `1px solid ${borderColor}`,
                    borderRadius: 6,
                    padding: "4px 3px",
                    display: "flex",
                    flexDirection: "column",
                    alignItems: "stretch",
                    gap: 3,
                    background: hasDoneWorkout ? "rgba(34,197,94,.08)" : (hasWorkout ? "rgba(255,255,255,.02)" : "transparent"),
                  }}
                >
                  <div style={{ fontSize: ".58em", color: "#475569", textAlign: "center", fontWeight: 600 }}>{cellDate.getDate()}</div>
                  {dayWorkouts.map(w => {
                    const wt = WORKOUT_TYPES.find(t => t.id === w.type) || WORKOUT_TYPES[0];
                    return (
                      <button
                        key={w.id}
                        type="button"
                        onClick={() => toggleDone(w)}
                        title={w.done ? "Marcar como pendiente" : "Marcar como hecho"}
                        style={{
                          border: `1px solid ${w.done ? "rgba(34,197,94,.55)" : `${wt.color}55`}`,
                          borderRadius: 5,
                          padding: "4px 3px",
                          background: w.done ? "rgba(34,197,94,.16)" : `${wt.color}12`,
                          cursor: "pointer",
                          fontFamily: "inherit",
                          textAlign: "center",
                          width: "100%",
                          boxSizing: "border-box",
                        }}
                      >
                        <div style={{ width: 5, height: 5, borderRadius: "50%", background: wt.color, margin: "0 auto 2px" }} />
                        <div style={{ fontSize: ".52em", color: wt.color, fontWeight: 600, lineHeight: 1.15 }}>{w.title}</div>
                        <div style={{ fontSize: ".5em", color: "#475569" }}>{w.total_km} km</div>
                        {w.done && <div style={{ fontSize: ".52em", color: "#22c55e", marginTop: 1 }}>✓ Hecho</div>}
                      </button>
                    );
                  })}
                </div>
              );
            })}
          </div>
        )}
      </div>

      <div style={{ ...S.card, marginTop: 20 }}>
        <div style={{ fontSize: ".65em", letterSpacing: ".15em", color: "#334155", textTransform: "uppercase", marginBottom: 10 }}>
          CHAT CON TU COACH
        </div>
        {!coachIdForChat ? (
          <div style={{ color: "#64748b", fontSize: ".85em" }}>Sin datos de coach. Contacta a soporte si esto continúa.</div>
        ) : (
          <>
            <div
              ref={athleteChatScrollRef}
              style={{
                maxHeight: 300,
                overflowY: "auto",
                padding: "10px 8px",
                borderRadius: 10,
                background: "rgba(0,0,0,.2)",
                border: "1px solid rgba(255,255,255,.06)",
                marginBottom: 10,
                display: "flex",
                flexDirection: "column",
                gap: 8,
              }}
            >
              {athleteChatMessages.length === 0 ? (
                <div style={{ color: "#64748b", fontSize: ".8em", textAlign: "center", padding: "12px 0" }}>Sin mensajes aún</div>
              ) : (
                athleteChatMessages.map((m) => {
                  const isCoach = m.sender_role === "coach";
                  return (
                    <div
                      key={m.id}
                      style={{
                        alignSelf: isCoach ? "flex-end" : "flex-start",
                        maxWidth: "88%",
                        padding: "8px 12px",
                        borderRadius: 10,
                        background: isCoach
                          ? "linear-gradient(135deg, rgba(180,83,9,.85), rgba(245,158,11,.75))"
                          : "rgba(59,130,246,.35)",
                        border: `1px solid ${isCoach ? "rgba(245,158,11,.5)" : "rgba(59,130,246,.45)"}`,
                        color: "#f8fafc",
                        fontSize: ".82em",
                        lineHeight: 1.45,
                      }}
                    >
                      <div>{m.body}</div>
                      <div style={{ fontSize: ".65em", color: isCoach ? "rgba(255,255,255,.75)" : "rgba(191,219,254,.85)", marginTop: 6 }}>
                        {formatMessageTimestamp(m.created_at)}
                      </div>
                    </div>
                  );
                })
              )}
            </div>
            <div style={{ display: "flex", gap: 8, alignItems: "stretch" }}>
              <input
                type="text"
                value={athleteChatDraft}
                onChange={(e) => setAthleteChatDraft(e.target.value)}
                onKeyDown={(e) => e.key === "Enter" && sendAthleteChat()}
                placeholder="Escribe un mensaje a tu coach…"
                style={{
                  flex: 1,
                  background: "rgba(255,255,255,.04)",
                  border: "1px solid rgba(255,255,255,.1)",
                  borderRadius: 8,
                  padding: "10px 12px",
                  color: "#e2e8f0",
                  fontFamily: "inherit",
                  fontSize: ".85em",
                  outline: "none",
                  boxSizing: "border-box",
                }}
              />
              <button
                type="button"
                onClick={sendAthleteChat}
                disabled={athleteChatSending || !athleteChatDraft.trim()}
                style={{
                  background: athleteChatSending || !athleteChatDraft.trim() ? "rgba(255,255,255,.06)" : "linear-gradient(135deg,#b45309,#f59e0b)",
                  border: "none",
                  borderRadius: 8,
                  padding: "10px 16px",
                  color: athleteChatSending || !athleteChatDraft.trim() ? "#64748b" : "white",
                  fontWeight: 800,
                  cursor: athleteChatSending || !athleteChatDraft.trim() ? "not-allowed" : "pointer",
                  fontFamily: "inherit",
                  fontSize: ".82em",
                  whiteSpace: "nowrap",
                }}
              >
                Enviar
              </button>
            </div>
          </>
        )}
      </div>
    </div>
  );
}

function Plan2Weeks({ athletes, notify, onPlanAssigned }) {
  const S = styles;
  const [athleteId, setAthleteId] = useState("");
  const [goalId, setGoalId] = useState(PLAN_12_GOALS[0]?.id || "maraton_sub4");
  const [levelId, setLevelId] = useState("intermedio");
  const [daysPerWeek, setDaysPerWeek] = useState(3);
  const [raceDate, setRaceDate] = useState(() => formatLocalYMD(addDays(new Date(), 14)));
  const [generatedPlan, setGeneratedPlan] = useState(null);
  const [planLoading, setPlanLoading] = useState(false);
  const [assignLoading, setAssignLoading] = useState(false);
  const [openWeeks, setOpenWeeks] = useState(() => new Set());
  const [planAssignedSuccess, setPlanAssignedSuccess] = useState(false);
  const [planEditModal, setPlanEditModal] = useState(null);
  const [editDraft, setEditDraft] = useState({
    title: "",
    type: "easy",
    total_km: 0,
    duration_min: 0,
    weekday: 2,
  });

  useEffect(() => {
    if (athletes?.length && !athleteId) {
      setAthleteId(String(athletes[0].id));
    }
  }, [athletes, athleteId]);

  useEffect(() => {
    setPlanAssignedSuccess(false);
  }, [athleteId]);

  useEffect(() => {
    if (!planEditModal || !generatedPlan) return;
    const week = generatedPlan.weeks.find((w) => Number(w.week_number) === planEditModal.weekNumber);
    if (!week) return;
    if (planEditModal.workoutIdx === "new") {
      setEditDraft({ title: "", type: "easy", total_km: 0, duration_min: 0, weekday: 2 });
      return;
    }
    const wo = week.workouts?.[planEditModal.workoutIdx];
    if (!wo) {
      setPlanEditModal(null);
      return;
    }
    setEditDraft({
      title: String(wo.title || ""),
      type: WORKOUT_TYPES.some((t) => t.id === wo.type) ? wo.type : "easy",
      total_km: Number(wo.total_km ?? wo.km) || 0,
      duration_min: Number(wo.duration_min) || 0,
      weekday: Math.min(7, Math.max(1, Number(wo.weekday) || 2)),
    });
  }, [planEditModal, generatedPlan]);

  const toggleWeek = (weekNum) => {
    setOpenWeeks((prev) => {
      const next = new Set(prev);
      if (next.has(weekNum)) next.delete(weekNum);
      else next.add(weekNum);
      return next;
    });
  };

  const plan2SystemPrompt = `You are an elite running coach for PaceForge. Output ONLY compact valid JSON. No markdown, no code fences, no extra text.
weekday: always 1=Monday .. 7=Sunday.

Fixed weekly template (same both weeks). Session types MUST match exactly:
- weekday 2 (Tuesday): type "long" — Rodaje largo
- weekday 3 (Wednesday): type "tempo" — Tempo
- weekday 4 (Thursday): type "recovery" — Recuperación
- weekday 6 (Saturday): type "interval" — Intervalos
- weekday 7 (Sunday): type "long" — Largo

If the user requests fewer than 5 sessions per week, OMIT sessions in this strict order until the count matches: (1) omit Sunday (weekday 7), (2) then omit Thursday (weekday 4), (3) then omit Wednesday (weekday 3). The remaining sessions keep the same weekdays and types as above.
Examples: N=5 → weekdays 2,3,4,6,7; N=4 → 2,3,4,6; N=3 → 2,3,6.

Schema (description ≤120 chars):
{
  "plan_title": "short string",
  "weeks": [
    {
      "week_number": 1,
      "focus": "optional ≤4 words",
      "workouts": [
        { "weekday": 2, "title": "string", "type": "long|tempo|recovery|interval", "total_km": 0, "duration_min": 0, "description": "string" }
      ]
    }
  ]
}
Rules:
- Exactly 2 weeks (week_number 1 then 2). Each week: EXACTLY N workouts (N is 3, 4, or 5 from user). Same N and same weekday/type pattern both weeks.
- Every workout must use one of the allowed weekday+type pairs from the template after applying the omission rule for that N.
- Titles should reflect the session (e.g. rodaje largo, tempo, recuperación, intervalos, largo) in the plan language but types must be exact enum values.
- Week 2 is race week: adjust volume/quality vs week 1 but never change weekdays or session types for that N.
- No extra JSON keys. All numeric fields must be numbers.`;

  const plan2UserPrompt = useMemo(() => {
    const goalLabel = PLAN_12_GOALS.find((g) => g.id === goalId)?.label || goalId;
    const levelLabel = PLAN_12_LEVELS.find((l) => l.id === levelId)?.label || levelId;
    return `2-week running plan JSON only.

Goal: ${goalLabel}. Level: ${levelLabel}.
Sessions per week (N): ${daysPerWeek} — same N in week 1 and week 2.
Race date (week 2 contains this date): ${raceDate}

Follow the FIXED calendar exactly:
- Martes weekday=2: rodaje largo → type "long"
- Miércoles weekday=3: tempo → type "tempo"
- Jueves weekday=4: recuperación → type "recovery"
- Sábado weekday=6: intervalos → type "interval"
- Domingo weekday=7: largo → type "long"

If N<5, drop sessions in order: first domingo (7), then jueves (4), then miércoles (3). N=4 → keep 2,3,4,6. N=3 → keep 2,3,6.

Output 2 week objects with the correct ${daysPerWeek} workouts each; each workout: weekday, title, type, total_km, duration_min, short description.`;
  }, [goalId, levelId, daysPerWeek, raceDate]);

  const generatePlan2 = async () => {
    setPlanAssignedSuccess(false);
    setPlanEditModal(null);
    setPlanLoading(true);
    setGeneratedPlan(null);
    try {
      const res = await fetch("/api/generate-workout", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({
          model: "claude-sonnet-4-20250514",
          max_tokens: 3000,
          system: plan2SystemPrompt,
          messages: [{ role: "user", content: plan2UserPrompt }],
        }),
      });
      const data = await res.json();
      if (!res.ok) {
        console.error("Plan 2 semanas API error:", data);
        notify("Error al generar el plan (API).");
        return;
      }
      const text = data.content?.find((b) => b.type === "text")?.text || "";
      const parsed = extractJsonFromAnthropicText(text);
      const byWeek = new Map((parsed?.weeks || []).map((w) => [Number(w.week_number) || 0, w]));
      const orderedWeeks = [1, 2].map((n) => byWeek.get(n)).filter(Boolean);
      if (!parsed || orderedWeeks.length < 2) {
        console.error("Plan JSON inválido:", text?.slice?.(0, 500));
        notify("La IA no devolvió un plan válido (semanas 1–2). Intenta de nuevo.");
        return;
      }
      const countMismatch = orderedWeeks.some((w) => (Array.isArray(w.workouts) ? w.workouts.length : 0) !== daysPerWeek);
      if (countMismatch) {
        notify(`Cada semana debe tener exactamente ${daysPerWeek} sesiones. Reintenta la generación.`);
        return;
      }
      const distErr = validatePlan2Distribution(orderedWeeks, daysPerWeek);
      if (distErr) {
        notify("El plan no respeta la distribución fija (martes largo, miércoles tempo, etc.). Reintenta la generación.");
        return;
      }
      setGeneratedPlan({ ...parsed, weeks: orderedWeeks });
      setOpenWeeks(new Set([1, 2]));
      notify("Plan de 2 semanas generado ✓");
    } catch (e) {
      console.error(e);
      notify("Error al procesar el plan.");
    } finally {
      setPlanLoading(false);
    }
  };

  const assignPlanToAthlete = async () => {
    if (!generatedPlan?.weeks?.length) {
      alert("Genera un plan antes de asignar.");
      return;
    }
    if (!athleteId) {
      alert("Selecciona un atleta.");
      return;
    }
    if (!raceDate) {
      alert("Indica la fecha de la carrera.");
      return;
    }
    const selectedAthlete = (athletes || []).find((a) => String(a.id) === String(athleteId));
    if (!selectedAthlete?.id) {
      alert("No se encontró el atleta.");
      return;
    }

    const race = new Date(`${raceDate}T12:00:00`);
    const raceMonday = startOfWeekMonday(race);
    const planStartMonday = addDays(raceMonday, -1 * 7);

    const rows = [];
    for (const week of generatedPlan.weeks) {
      const wn = Number(week.week_number) || 0;
      if (wn < 1 || wn > 2) continue;
      const list = Array.isArray(week.workouts) ? week.workouts : [];
      for (const wo of list) {
        let wd = Number(wo.weekday);
        if (!Number.isFinite(wd) || wd < 1) wd = 1;
        if (wd > 7) wd = 7;
        const offsetDays = (wn - 1) * 7 + (wd - 1);
        const sessionDate = addDays(planStartMonday, offsetDays);
        const scheduled_date = formatLocalYMD(sessionDate);
        const typeRaw = wo.type || "easy";
        const type = WORKOUT_TYPES.some((t) => t.id === typeRaw) ? typeRaw : "easy";
        const kmVal = wo.total_km ?? wo.km;
        let structure = wo.structure;
        if (!Array.isArray(structure)) structure = [];
        rows.push({
          athlete_id: selectedAthlete.id,
          title: String(wo.title || "Entrenamiento"),
          type,
          total_km: Number.isFinite(Number(kmVal)) ? Number(kmVal) : 0,
          duration_min: Number.isFinite(Number(wo.duration_min)) ? Number(wo.duration_min) : 0,
          description: String(wo.description || ""),
          structure,
          scheduled_date,
          done: false,
        });
      }
    }

    if (!rows.length) {
      alert("No hay entrenamientos en el plan para guardar.");
      return;
    }

    const { data: userData, error: userError } = await supabase.auth.getUser();
    if (userError || !userData?.user) {
      alert(userError?.message || "No hay usuario autenticado.");
      return;
    }
    const coachId = userData.user.id;
    const payload = rows.map((r) => ({ ...r, coach_id: coachId }));

    setAssignLoading(true);
    try {
      const { error } = await supabase.from("workouts").insert(payload);
      if (error) {
        console.error("Error insertando plan:", error);
        alert(`Error: ${error.message}`);
        return;
      }

      setPlanAssignedSuccess(true);
      onPlanAssigned?.();

      if (selectedAthlete.email) {
        try {
          const weekSummary = (generatedPlan.weeks || [])
            .map((w) => {
              const n = Number(w.week_number) || 0;
              const c = Array.isArray(w.workouts) ? w.workouts.length : 0;
              return `<li>Semana ${n}: ${c} sesiones</li>`;
            })
            .join("");
          await fetch("/api/send-email", {
            method: "POST",
            headers: { "Content-Type": "application/json" },
            body: JSON.stringify({
              to: selectedAthlete.email,
              subject: `Tu plan de 2 semanas: ${generatedPlan.plan_title || "PaceForge"}`,
              html: `
                <h2>Hola ${selectedAthlete.name} 👋</h2>
                <p>Tu coach te ha asignado un <strong>plan de 2 semanas</strong> en PaceForge.</p>
                <p><strong>Objetivo:</strong> ${PLAN_12_GOALS.find((g) => g.id === goalId)?.label || goalId}<br/>
                <strong>Carrera:</strong> ${raceDate}</p>
                <p><strong>${generatedPlan.plan_title || "Plan personalizado"}</strong></p>
                <ul>${weekSummary}</ul>
                <p>Total: <strong>${rows.length}</strong> entrenamientos cargados en tu calendario.</p>
                <p>¡Mucho éxito! 💪</p>
                <p>— PaceForge</p>
              `,
            }),
          });
        } catch (e) {
          console.error("send-email plan12:", e);
        }
      }
      notify(`Plan asignado: ${rows.length} workouts guardados.`);
    } finally {
      setAssignLoading(false);
    }
  };

  const deletePlanWorkout = (weekNumber, workoutIndex, e) => {
    e?.stopPropagation?.();
    setGeneratedPlan((prev) => {
      if (!prev?.weeks) return prev;
      return {
        ...prev,
        weeks: prev.weeks.map((w) => {
          if (Number(w.week_number) !== weekNumber) return w;
          return { ...w, workouts: (w.workouts || []).filter((_, i) => i !== workoutIndex) };
        }),
      };
    });
  };

  const savePlanEditModal = () => {
    if (!planEditModal || !generatedPlan) return;
    const { weekNumber, workoutIdx } = planEditModal;
    setGeneratedPlan((prev) => {
      if (!prev?.weeks) return prev;
      return {
        ...prev,
        weeks: prev.weeks.map((w) => {
          if (Number(w.week_number) !== weekNumber) return w;
          const list = [...(w.workouts || [])];
          const prevWo = workoutIdx !== "new" ? { ...(list[workoutIdx] || {}) } : {};
          const merged = {
            ...prevWo,
            title: editDraft.title.trim() || "Entrenamiento",
            type: editDraft.type,
            total_km: Number(editDraft.total_km) || 0,
            duration_min: Number(editDraft.duration_min) || 0,
            weekday: Math.min(7, Math.max(1, Number(editDraft.weekday) || 1)),
            description: typeof prevWo.description === "string" ? prevWo.description : "",
          };
          if (workoutIdx === "new") list.push(merged);
          else list[workoutIdx] = merged;
          return { ...w, workouts: list };
        }),
      };
    });
    setPlanEditModal(null);
  };

  const inputStyle = {
    width: "100%",
    background: "rgba(255,255,255,.04)",
    border: "1px solid rgba(255,255,255,.1)",
    borderRadius: 8,
    padding: "10px 12px",
    color: "#e2e8f0",
    fontFamily: "inherit",
    fontSize: ".85em",
    outline: "none",
    boxSizing: "border-box",
  };
  const labelStyle = { fontSize: ".72em", color: "#64748b", marginBottom: 6 };

  return (
    <div style={S.page}>
      <div style={{ marginBottom: 24 }}>
        <h1 style={S.pageTitle}>Plan 2 Semanas</h1>
        <p style={{ color: "#475569", fontSize: ".82em", marginTop: 4 }}>
          Distribución fija: mar largo · mié tempo · jue recuperación · sáb intervalos · dom largo. Con menos de 5 sesiones se quitan primero domingo, luego jueves y miércoles. Semana 2 = semana de carrera.
        </p>
      </div>

      <div style={{ display: "grid", gridTemplateColumns: "minmax(280px, 360px) 1fr", gap: 22, alignItems: "start" }}>
        <div style={S.card}>
          <div style={{ fontSize: ".65em", letterSpacing: ".13em", color: "#475569", textTransform: "uppercase", marginBottom: 16 }}>Parámetros del plan</div>
          <div style={{ display: "flex", flexDirection: "column", gap: 14 }}>
            <div>
              <div style={labelStyle}>Atleta</div>
              <select value={athleteId} onChange={(e) => setAthleteId(e.target.value)} style={inputStyle}>
                <option value="" disabled>{athletes?.length ? "Selecciona…" : "Sin atletas"}</option>
                {(athletes || []).map((a) => (
                  <option key={a.id} value={String(a.id)}>{a.name}</option>
                ))}
              </select>
            </div>
            <div>
              <div style={labelStyle}>Objetivo</div>
              <select value={goalId} onChange={(e) => setGoalId(e.target.value)} style={inputStyle}>
                {PLAN_12_GOALS.map((g) => (
                  <option key={g.id} value={g.id}>{g.label}</option>
                ))}
              </select>
            </div>
            <div>
              <div style={labelStyle}>Nivel</div>
              <select value={levelId} onChange={(e) => setLevelId(e.target.value)} style={inputStyle}>
                {PLAN_12_LEVELS.map((l) => (
                  <option key={l.id} value={l.id}>{l.label}</option>
                ))}
              </select>
            </div>
            <div>
              <div style={labelStyle}>Sesiones por semana (3, 4 o 5)</div>
              <select value={String(daysPerWeek)} onChange={(e) => setDaysPerWeek(Number(e.target.value))} style={inputStyle}>
                {[3, 4, 5].map((d) => (
                  <option key={d} value={String(d)}>{d} sesiones</option>
                ))}
              </select>
            </div>
            <div>
              <div style={labelStyle}>Fecha de la carrera objetivo</div>
              <input type="date" value={raceDate} onChange={(e) => setRaceDate(e.target.value)} style={inputStyle} />
            </div>
            <button
              type="button"
              onClick={generatePlan2}
              disabled={planLoading || !athletes?.length}
              style={{
                marginTop: 6,
                width: "100%",
                background: planLoading || !athletes?.length ? "rgba(255,255,255,.06)" : "linear-gradient(135deg,#b45309,#f59e0b)",
                border: "none",
                borderRadius: 8,
                padding: "12px 16px",
                color: planLoading || !athletes?.length ? "#334155" : "white",
                fontWeight: 800,
                cursor: planLoading || !athletes?.length ? "not-allowed" : "pointer",
                fontSize: ".85em",
                fontFamily: "inherit",
              }}
            >
              {planLoading ? "⏳ Generando plan…" : "⚡ Generar Plan con IA"}
            </button>
            {generatedPlan && (
              <button
                type="button"
                onClick={assignPlanToAthlete}
                disabled={assignLoading || !athleteId}
                style={{
                  width: "100%",
                  background: assignLoading || !athleteId ? "rgba(255,255,255,.06)" : "rgba(59,130,246,.18)",
                  border: `1px solid ${assignLoading || !athleteId ? "rgba(255,255,255,.08)" : "rgba(59,130,246,.45)"}`,
                  borderRadius: 8,
                  padding: "12px 16px",
                  color: assignLoading || !athleteId ? "#475569" : "#93c5fd",
                  fontWeight: 800,
                  cursor: assignLoading || !athleteId ? "not-allowed" : "pointer",
                  fontSize: ".85em",
                  fontFamily: "inherit",
                }}
              >
                {assignLoading ? "Guardando…" : "Asignar Plan al Atleta"}
              </button>
            )}
            {planAssignedSuccess && (
              <button
                type="button"
                onClick={() => {
                  setPlanAssignedSuccess(false);
                  setPlanEditModal(null);
                  setGeneratedPlan(null);
                  setOpenWeeks(new Set());
                  const next = addDays(new Date(`${raceDate}T12:00:00`), 14);
                  setRaceDate(formatLocalYMD(next));
                  notify("Siguiente bloque: fecha de carrera avanzada 2 semanas. Genera el plan con IA cuando quieras.");
                }}
                style={{
                  width: "100%",
                  marginTop: 4,
                  background: "rgba(34,197,94,.12)",
                  border: "1px solid rgba(34,197,94,.4)",
                  borderRadius: 8,
                  padding: "12px 16px",
                  color: "#4ade80",
                  fontWeight: 800,
                  cursor: "pointer",
                  fontSize: ".85em",
                  fontFamily: "inherit",
                }}
              >
                ⚡ Generar Siguiente Bloque
              </button>
            )}
          </div>
        </div>

        <div style={S.card}>
          <div style={{ fontSize: ".65em", letterSpacing: ".13em", color: "#475569", textTransform: "uppercase", marginBottom: 14 }}>Vista previa</div>
          {generatedPlan && (
            <p style={{ fontSize: ".78em", color: "#64748b", marginBottom: 12, marginTop: -6 }}>
              Usá ✏️ para editar una sesión. El estado completado solo se marca en el calendario del atleta, no aquí.
            </p>
          )}
          {!generatedPlan ? (
            <div style={{ color: "#64748b", fontSize: ".88em", lineHeight: 1.5 }}>
              Completa el formulario y pulsa <strong>Generar Plan con IA</strong>. Aquí verás las 2 semanas en acordeón con todas las sesiones.
            </div>
          ) : (
            <>
              <div style={{ fontSize: "1.05em", fontWeight: 700, color: "#e2e8f0", marginBottom: 16 }}>{generatedPlan.plan_title || "Plan 2 semanas"}</div>
              <div style={{ display: "flex", flexDirection: "column", gap: 8 }}>
                {[...generatedPlan.weeks].sort((a, b) => (Number(a.week_number) || 0) - (Number(b.week_number) || 0)).map((week) => {
                  const n = Number(week.week_number) || 0;
                  const open = openWeeks.has(n);
                  const wos = Array.isArray(week.workouts) ? week.workouts : [];
                  return (
                    <div key={n} style={{ border: "1px solid rgba(255,255,255,.08)", borderRadius: 10, overflow: "hidden" }}>
                      <button
                        type="button"
                        onClick={() => toggleWeek(n)}
                        style={{
                          width: "100%",
                          display: "flex",
                          alignItems: "center",
                          justifyContent: "space-between",
                          padding: "12px 14px",
                          background: open ? "rgba(245,158,11,.1)" : "rgba(255,255,255,.03)",
                          border: "none",
                          color: "#e2e8f0",
                          fontFamily: "inherit",
                          fontWeight: 700,
                          fontSize: ".88em",
                          cursor: "pointer",
                          textAlign: "left",
                        }}
                      >
                        <span>
                          Semana {n}
                          {week.focus ? <span style={{ color: "#64748b", fontWeight: 500 }}> · {week.focus}</span> : null}
                        </span>
                        <span style={{ color: "#94a3b8" }}>{open ? "▼" : "▶"}</span>
                      </button>
                      {open && (
                        <div style={{ padding: "10px 14px 14px", background: "rgba(0,0,0,.12)" }}>
                          <button
                            type="button"
                            onClick={() => setPlanEditModal({ weekNumber: n, workoutIdx: "new" })}
                            style={{
                              width: "100%",
                              marginBottom: 12,
                              background: "rgba(245,158,11,.1)",
                              border: "1px dashed rgba(245,158,11,.35)",
                              borderRadius: 8,
                              padding: "8px 12px",
                              color: "#fbbf24",
                              fontWeight: 700,
                              fontSize: ".8em",
                              cursor: "pointer",
                              fontFamily: "inherit",
                            }}
                          >
                            ＋ Agregar Sesión
                          </button>
                          {wos.length === 0 ? (
                            <div style={{ color: "#64748b", fontSize: ".82em" }}>Sin sesiones en esta semana.</div>
                          ) : (
                            wos.map((wo, idx) => {
                              const wd = Number(wo.weekday) || 1;
                              const dayName = DAYS[wd - 1] || `Día ${wd}`;
                              const wt = WORKOUT_TYPES.find((t) => t.id === wo.type) || WORKOUT_TYPES[0];
                              return (
                                <div
                                  key={`${n}-${idx}-${wo.title}-${wo.weekday}`}
                                  style={{
                                    marginBottom: idx === wos.length - 1 ? 0 : 10,
                                    padding: 10,
                                    borderRadius: 8,
                                    background: "rgba(255,255,255,.03)",
                                    borderLeft: `3px solid ${wt.color}`,
                                    display: "flex",
                                    gap: 10,
                                    alignItems: "flex-start",
                                  }}
                                >
                                  <div style={{ flex: 1, minWidth: 0, cursor: "default" }}>
                                    <div style={{ fontSize: ".78em", color: "#64748b", marginBottom: 4 }}>{dayName}</div>
                                    <div style={{ fontWeight: 700, color: "#e2e8f0", fontSize: ".88em" }}>{wo.title || "Sin título"}</div>
                                    <div style={{ fontSize: ".76em", color: "#94a3b8", marginTop: 4 }}>
                                      {Number(wo.total_km ?? wo.km) || 0} km · {wo.duration_min} min · <span style={{ color: wt.color }}>{wt.label}</span>
                                    </div>
                                    {wo.description && <div style={{ fontSize: ".78em", color: "#cbd5e1", marginTop: 8, lineHeight: 1.45 }}>{wo.description}</div>}
                                  </div>
                                  <div style={{ display: "flex", flexDirection: "column", gap: 6, flexShrink: 0 }}>
                                    <button
                                      type="button"
                                      title="Editar sesión"
                                      onClick={() => {
                                        console.log("Abriendo editor");
                                        setPlanEditModal({ weekNumber: n, workoutIdx: idx });
                                      }}
                                      style={{
                                        background: "rgba(245,158,11,.14)",
                                        border: "1px solid rgba(245,158,11,.35)",
                                        borderRadius: 6,
                                        padding: "6px 10px",
                                        cursor: "pointer",
                                        fontSize: ".85em",
                                        lineHeight: 1,
                                      }}
                                    >
                                      ✏️
                                    </button>
                                    <button
                                      type="button"
                                      title="Eliminar sesión"
                                      onClick={(e) => deletePlanWorkout(n, idx, e)}
                                      style={{
                                        background: "rgba(239,68,68,.12)",
                                        border: "1px solid rgba(239,68,68,.3)",
                                        borderRadius: 6,
                                        padding: "6px 10px",
                                        cursor: "pointer",
                                        fontSize: ".85em",
                                        lineHeight: 1,
                                      }}
                                    >
                                      🗑
                                    </button>
                                  </div>
                                </div>
                              );
                            })
                          )}
                        </div>
                      )}
                    </div>
                  );
                })}
              </div>
            </>
          )}
        </div>
      </div>

      {planEditModal && (
        <>
          {(() => {
            console.log("planEditModal vale:", planEditModal);
            return null;
          })()}
          <div style={{ position: "fixed", inset: 0, background: "rgba(0,0,0,.55)", display: "flex", alignItems: "center", justifyContent: "center", zIndex: 220, padding: 16 }}>
          <div style={{ ...S.card, width: "100%", maxWidth: 420, margin: 0 }}>
            <div style={{ fontSize: ".95em", fontWeight: 700, color: "#e2e8f0", marginBottom: 6 }}>
              {planEditModal.workoutIdx === "new" ? "Nueva sesión" : "Editar sesión"}
            </div>
            <div style={{ fontSize: ".75em", color: "#64748b", marginBottom: 14 }}>
              Semana {planEditModal.weekNumber}. El día de la semana define la fecha al asignar.
            </div>
            <div style={{ display: "flex", flexDirection: "column", gap: 12 }}>
              <div>
                <div style={labelStyle}>Título</div>
                <input
                  value={editDraft.title}
                  onChange={(e) => setEditDraft((d) => ({ ...d, title: e.target.value }))}
                  placeholder="Ej: Rodaje suave 45'"
                  style={inputStyle}
                />
              </div>
              <div>
                <div style={labelStyle}>Tipo</div>
                <select
                  value={editDraft.type}
                  onChange={(e) => setEditDraft((d) => ({ ...d, type: e.target.value }))}
                  style={inputStyle}
                >
                  {WORKOUT_TYPES.map((t) => (
                    <option key={t.id} value={t.id}>{t.label}</option>
                  ))}
                </select>
              </div>
              <div style={{ display: "grid", gridTemplateColumns: "1fr 1fr", gap: 10 }}>
                <div>
                  <div style={labelStyle}>Km</div>
                  <input
                    type="number"
                    min={0}
                    step={0.1}
                    value={editDraft.total_km}
                    onChange={(e) => setEditDraft((d) => ({ ...d, total_km: Number(e.target.value) }))}
                    style={inputStyle}
                  />
                </div>
                <div>
                  <div style={labelStyle}>Duración (min)</div>
                  <input
                    type="number"
                    min={0}
                    step={1}
                    value={editDraft.duration_min}
                    onChange={(e) => setEditDraft((d) => ({ ...d, duration_min: Number(e.target.value) }))}
                    style={inputStyle}
                  />
                </div>
              </div>
              <div>
                <div style={labelStyle}>Día de la semana</div>
                <select
                  value={String(editDraft.weekday)}
                  onChange={(e) => setEditDraft((d) => ({ ...d, weekday: Number(e.target.value) }))}
                  style={inputStyle}
                >
                  {DAYS.map((label, i) => (
                    <option key={label} value={String(i + 1)}>{label} ({i + 1})</option>
                  ))}
                </select>
              </div>
            </div>
            <div style={{ display: "flex", gap: 10, justifyContent: "flex-end", marginTop: 18 }}>
              <button
                type="button"
                onClick={() => setPlanEditModal(null)}
                style={{
                  background: "rgba(255,255,255,.03)",
                  border: "1px solid rgba(255,255,255,.1)",
                  borderRadius: 8,
                  padding: "8px 14px",
                  color: "#94a3b8",
                  cursor: "pointer",
                  fontFamily: "inherit",
                  fontWeight: 700,
                  fontSize: ".82em",
                }}
              >
                Cancelar
              </button>
              <button
                type="button"
                onClick={savePlanEditModal}
                style={{
                  background: "linear-gradient(135deg,#b45309,#f59e0b)",
                  border: "none",
                  borderRadius: 8,
                  padding: "8px 14px",
                  color: "white",
                  cursor: "pointer",
                  fontFamily: "inherit",
                  fontWeight: 800,
                  fontSize: ".82em",
                }}
              >
                Guardar
              </button>
            </div>
          </div>
        </div>
        </>
      )}
    </div>
  );
}

function Builder({ athletes, aiPrompt, setAiPrompt, aiWorkout, setAiWorkout, aiLoading, setAiLoading, notify, onWorkoutAssigned }) {
  const S = styles;
  const [showAssignModal, setShowAssignModal] = useState(false);
  const [assignAthleteId, setAssignAthleteId] = useState("");
  const [assignDate, setAssignDate] = useState(() => formatLocalYMD(new Date()));
  const [assignSaving, setAssignSaving] = useState(false);
  const [builderHrAthleteId, setBuilderHrAthleteId] = useState("");

  const openAssignModal = () => {
    if (!aiWorkout) return;
    setAssignDate(formatLocalYMD(new Date()));
    if (athletes?.length) setAssignAthleteId(String(athletes[0].id));
    else setAssignAthleteId("");
    setShowAssignModal(true);
  };

  const saveAssignedWorkout = async () => {
    if (!aiWorkout) return;
    if (!assignAthleteId) {
      alert("Selecciona un atleta.");
      return;
    }
    const selectedAthlete = (athletes || []).find(a => String(a.id) === String(assignAthleteId));
    if (!selectedAthlete?.id) {
      alert("No se encontró el atleta seleccionado.");
      return;
    }
    if (!assignDate) {
      alert("Selecciona una fecha.");
      return;
    }
    const { data: userData, error: userError } = await supabase.auth.getUser();
    if (userError || !userData?.user) {
      alert(userError?.message || "No hay usuario autenticado.");
      return;
    }
    setAssignSaving(true);
    try {
      const payload = {
        ...aiWorkout,
        athlete_id: selectedAthlete.id,
        coach_id: userData.user.id,
        scheduled_date: assignDate,
        done: false,
      };
      const { error } = await supabase.from("workouts").insert(payload).select().single();
      if (error) {
        console.error("Error guardando workout asignado:", error);
        alert(`Error: ${error.message}\n${error.details || ""}\n${error.hint || ""}`);
        return;
      }

      if (selectedAthlete.email) {
        try {
          const structureRows = Array.isArray(aiWorkout?.structure)
            ? aiWorkout.structure.map((s) => `<p>• <strong>${s.phase}</strong>: ${s.duration} a ${s.pace}</p>`).join("")
            : "";
          await fetch("/api/send-email", {
            method: "POST",
            headers: { "Content-Type": "application/json" },
            body: JSON.stringify({
              to: selectedAthlete.email,
              subject: `Nuevo entrenamiento: ${aiWorkout.title}`,
              html: `
      <h2>Hola ${selectedAthlete.name} 👋</h2>
      <p>Tu coach te ha asignado un nuevo entrenamiento:</p>
      <h3>${aiWorkout.title}</h3>
      <p><strong>Fecha:</strong> ${assignDate}</p>
      <p><strong>Descripción:</strong> ${aiWorkout.description}</p>
      <p><strong>Distancia:</strong> ${aiWorkout.total_km} km</p>
      <p><strong>Duración:</strong> ${aiWorkout.duration_min} minutos</p>
      <h4>Estructura:</h4>
      ${structureRows}
      <br/><p>¡Mucho éxito! 💪</p>
      <p>— Tu coach en PaceForge</p>
    `,
            }),
          });
        } catch (e) {
          console.error("Error llamando /api/send-email:", e);
        }
      }

      setShowAssignModal(false);
      onWorkoutAssigned?.();
      notify("Entrenamiento guardado correctamente en Supabase.");
    } finally {
      setAssignSaving(false);
    }
  };

  const generateWorkout = async () => {
    if (!aiPrompt.trim()) return;
    setAiLoading(true);
    setAiWorkout(null);
    try {
      const hrAthlete = builderHrAthleteId ? athletes.find((a) => String(a.id) === String(builderHrAthleteId)) : null;
      const zonesBlock = hrAthlete ? buildAthleteHrZonesPromptText(hrAthlete) : "";
      const baseSystem =
        'You are an elite running coach. Generate a structured workout in JSON only. No markdown, no backticks. Format: {"title":"...","type":"easy|tempo|interval|long|recovery","total_km":number,"duration_min":number,"description":"...","structure":[{"phase":"...","duration":"...","intensity":"...","pace":"..."}]}';
      const system = zonesBlock
        ? `${baseSystem}\n\n${zonesBlock}\nWhen setting structure, align intensity with these HR zones where it fits (reference bpm or zone Z1-Z5 in the intensity field when useful).`
        : baseSystem;
      const res = await fetch("/api/generate-workout", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({
          model: "claude-sonnet-4-20250514",
          max_tokens: 2000,
          system,
          messages: [{ role: "user", content: aiPrompt }],
        }),
      });
      const data = await res.json();
      if (!res.ok) {
        console.error("Anthropic proxy error:", data);
        notify("Error al generar workout (API)");
        setAiWorkout(null);
        return;
      }
      const text = data.content?.find(b => b.type === "text")?.text || "";
      setAiWorkout(JSON.parse(text));
    } catch { setAiWorkout(null); }
    finally { setAiLoading(false); }
  };

  const exportGarmin = () => {
    if (!aiWorkout) return;
    const blob = new Blob([JSON.stringify(aiWorkout, null, 2)], { type: "application/json" });
    const url = URL.createObjectURL(blob);
    const a = document.createElement("a");
    a.href = url; a.download = `${aiWorkout.title?.replace(/\s+/g,"_")}_garmin.json`; a.click();
    URL.revokeObjectURL(url);
    notify("Exportado para Garmin ✓");
  };

  return (
    <div style={S.page}>
      <div style={{ marginBottom: 28 }}>
        <h1 style={S.pageTitle}>Generador de Workouts IA</h1>
        <p style={{ color: "#475569", fontSize: ".82em", marginTop: 4 }}>Describe el entrenamiento y la IA lo estructura automáticamente</p>
      </div>
      <div style={{ display: "grid", gridTemplateColumns: "1fr 1fr", gap: 24 }}>
        <div style={S.card}>
          <div style={{ fontSize: ".65em", letterSpacing: ".13em", color: "#475569", textTransform: "uppercase", marginBottom: 14 }}>⚡ DESCRIBE EL ENTRENAMIENTO</div>
          <div style={{ marginBottom: 12 }}>
            <div style={{ fontSize: ".72em", color: "#64748b", marginBottom: 6 }}>Zonas FC en el prompt (atleta con FC máx guardada)</div>
            <select
              value={builderHrAthleteId}
              onChange={(e) => setBuilderHrAthleteId(e.target.value)}
              style={{ width: "100%", background: "rgba(255,255,255,.04)", border: "1px solid rgba(255,255,255,.1)", borderRadius: 8, padding: "10px 12px", color: "#e2e8f0", fontFamily: "inherit", fontSize: ".85em", outline: "none", boxSizing: "border-box" }}
            >
              <option value="">Sin zonas FC en el prompt</option>
              {(athletes || []).map((a) => (
                <option key={a.id} value={String(a.id)}>
                  {a.name}{a.fc_max ? ` (${a.fc_max} lpm)` : " — sin FC máx"}
                </option>
              ))}
            </select>
          </div>
          <textarea value={aiPrompt} onChange={e=>setAiPrompt(e.target.value)} placeholder="Ej: Intervalos 6x800m para atleta sub 4h maratón..." style={{ width: "100%", background: "rgba(255,255,255,.04)", border: "1px solid rgba(255,255,255,.1)", borderRadius: 8, padding: "12px 14px", color: "#e2e8f0", fontFamily: "inherit", fontSize: ".85em", resize: "vertical", outline: "none", marginBottom: 12, boxSizing: "border-box" }} rows={5} />
          <div style={{ marginBottom: 12 }}>
            <div style={{ fontSize: ".72em", color: "#475569", marginBottom: 8 }}>SUGERENCIAS:</div>
            {["Intervalos 6x800m para atleta sub 4h maratón", "Rodaje largo 28km semana 18 de plan", "Tempo 8km para media maratón zona 3-4"].map((s,i) => (
              <div key={i} onClick={()=>setAiPrompt(s)} style={{ background: "rgba(255,255,255,.03)", border: "1px solid rgba(255,255,255,.07)", borderRadius: 6, padding: "8px 12px", fontSize: ".75em", color: "#64748b", cursor: "pointer", marginBottom: 6 }}>{s}</div>
            ))}
          </div>
          <button
            onClick={() => {
              console.log("Botón clickeado, prompt:", aiPrompt);
              generateWorkout();
            }}
            disabled={aiLoading || !aiPrompt.trim()}
            style={{ width: "100%", background: !aiPrompt.trim() ? "rgba(255,255,255,.06)" : "linear-gradient(135deg,#b45309,#f59e0b)", border: "none", borderRadius: 8, padding: "11px 20px", color: !aiPrompt.trim() ? "#334155" : "white", fontWeight: 700, cursor: !aiPrompt.trim() ? "not-allowed" : "pointer", fontSize: ".85em", fontFamily: "inherit" }}>
            {aiLoading ? "⏳ Generando..." : "⚡ GENERAR WORKOUT"}
          </button>
        </div>
        <div style={S.card}>
          {aiWorkout ? <>
            <div style={{ marginBottom: 16 }}>
              <div style={{ fontSize: "1.1em", fontWeight: 700, color: "#e2e8f0" }}>{aiWorkout.title}</div>
              <div style={{ fontSize: ".75em", color: "#64748b", marginTop: 2 }}>{aiWorkout.description}</div>
            </div>
            <div style={{ display: "flex", gap: 16, marginBottom: 16, fontSize: ".78em", color: "#94a3b8" }}>
              <span>📍 {aiWorkout.total_km} km</span><span>⏱ {aiWorkout.duration_min} min</span>
            </div>
            <div style={{ fontSize: ".65em", letterSpacing: ".13em", color: "#475569", textTransform: "uppercase", marginBottom: 10 }}>ESTRUCTURA</div>
            {(aiWorkout.structure||[]).map((step,i) => (
              <div key={i} style={{ display: "flex", gap: 10, alignItems: "center", background: "rgba(255,255,255,.02)", borderRadius: 7, padding: "8px 10px", marginBottom: 6 }}>
                <div style={{ width: 22, height: 22, borderRadius: "50%", background: "rgba(245,158,11,.15)", color: "#f59e0b", display: "flex", alignItems: "center", justifyContent: "center", fontSize: ".7em", fontWeight: 700, flexShrink: 0 }}>{i+1}</div>
                <div style={{ flex: 1, fontSize: ".85em" }}>
                  <span style={{ color: "#e2e8f0", fontWeight: 600 }}>{step.phase}</span>
                  <span style={{ color: "#64748b" }}> · {step.duration} · {step.intensity}</span>
                </div>
                <div style={{ fontSize: ".78em", color: "#f59e0b", fontFamily: "monospace" }}>{step.pace}</div>
              </div>
            ))}
            <div style={{ display: "flex", gap: 10, marginTop: 16 }}>
              <button onClick={exportGarmin} style={{ background: "rgba(22,163,74,.12)", border: "1px solid rgba(22,163,74,.3)", borderRadius: 8, padding: "8px 14px", color: "#22c55e", cursor: "pointer", fontSize: ".78em", fontFamily: "inherit", fontWeight: 600 }}>⌚ Exportar a Garmin</button>
              <button
                onClick={openAssignModal}
                disabled={!athletes?.length}
                style={{
                  background: athletes?.length ? "rgba(59,130,246,.1)" : "rgba(255,255,255,.04)",
                  border: `1px solid ${athletes?.length ? "rgba(59,130,246,.3)" : "rgba(255,255,255,.08)"}`,
                  borderRadius: 8,
                  padding: "8px 14px",
                  color: athletes?.length ? "#3b82f6" : "#475569",
                  cursor: athletes?.length ? "pointer" : "not-allowed",
                  fontSize: ".78em",
                  fontFamily: "inherit",
                  fontWeight: 600,
                }}
              >
                📤 Asignar a Atleta
              </button>
            </div>
            {showAssignModal && (
              <div style={{ position: "fixed", inset: 0, background: "rgba(0,0,0,.55)", display: "flex", alignItems: "center", justifyContent: "center", zIndex: 200, padding: 16 }}>
                <div style={{ ...S.card, width: "100%", maxWidth: 400, margin: 0 }}>
                  <div style={{ fontSize: ".85em", fontWeight: 700, color: "#e2e8f0", marginBottom: 8 }}>Asignar workout a un atleta</div>
                  <div style={{ fontSize: ".72em", color: "#64748b", marginBottom: 14 }}>
                    Se guardará en Supabase con todos los datos generados por la IA, más atleta, coach y fecha.
                  </div>
                  <div style={{ marginBottom: 12 }}>
                    <div style={{ fontSize: ".72em", color: "#64748b", marginBottom: 6 }}>Atleta del coach</div>
                    <select
                      value={assignAthleteId}
                      onChange={e => setAssignAthleteId(e.target.value)}
                      style={{ width: "100%", background: "rgba(255,255,255,.04)", border: "1px solid rgba(255,255,255,.1)", borderRadius: 8, padding: "10px 12px", color: "#e2e8f0", fontFamily: "inherit", fontSize: ".85em", outline: "none", boxSizing: "border-box" }}
                    >
                      <option value="" disabled>Selecciona un atleta</option>
                      {(athletes || []).map(a => (
                        <option key={a.id} value={String(a.id)}>{a.name}</option>
                      ))}
                    </select>
                  </div>
                  <div style={{ marginBottom: 16 }}>
                    <div style={{ fontSize: ".72em", color: "#64748b", marginBottom: 6 }}>Fecha del workout</div>
                    <input
                      type="date"
                      value={assignDate}
                      onChange={e => setAssignDate(e.target.value)}
                      style={{ width: "100%", background: "rgba(255,255,255,.04)", border: "1px solid rgba(255,255,255,.1)", borderRadius: 8, padding: "10px 12px", color: "#e2e8f0", fontFamily: "inherit", fontSize: ".85em", outline: "none", boxSizing: "border-box" }}
                    />
                  </div>
                  <div style={{ display: "flex", gap: 10, justifyContent: "flex-end" }}>
                    <button
                      type="button"
                      onClick={() => setShowAssignModal(false)}
                      disabled={assignSaving}
                      style={{ background: "rgba(255,255,255,.03)", border: "1px solid rgba(255,255,255,.1)", borderRadius: 8, padding: "8px 14px", color: "#94a3b8", cursor: assignSaving ? "not-allowed" : "pointer", fontFamily: "inherit", fontWeight: 700, fontSize: ".82em" }}
                    >
                      Cancelar
                    </button>
                    <button
                      type="button"
                      onClick={saveAssignedWorkout}
                      disabled={assignSaving}
                      style={{ background: assignSaving ? "rgba(255,255,255,.06)" : "linear-gradient(135deg,#b45309,#f59e0b)", border: "none", borderRadius: 8, padding: "8px 14px", color: assignSaving ? "#334155" : "white", cursor: assignSaving ? "not-allowed" : "pointer", fontFamily: "inherit", fontWeight: 800, fontSize: ".82em" }}
                    >
                      {assignSaving ? "Guardando..." : "Confirmar"}
                    </button>
                  </div>
                </div>
              </div>
            )}
          </> : (
            <div style={{ display: "flex", flexDirection: "column", alignItems: "center", justifyContent: "center", minHeight: 300, opacity: .4 }}>
              <div style={{ fontSize: "3em", marginBottom: 12 }}>⚡</div>
              <div style={{ color: "#475569", fontSize: ".85em" }}>El workout generado aparecerá aquí</div>
            </div>
          )}
        </div>
      </div>
    </div>
  );
}

function Plans({ athletes }) {
  const S = styles;

  const WOMPI_PUBLIC_KEY = "pub_test_9yDINqJhS2WxJYpYtgzXkP5TKND5WQyf";
  const WompiCheckoutBase = "https://checkout.wompi.co/p/";
  const redirectUrl = "https://pace-forge-eta.vercel.app";

  const PLAN_CATALOG = useMemo(
    () => [
      { plan: "Starter", label: "Starter", priceCop: 49000, description: "Ideal para empezar" },
      { plan: "Pro", label: "Pro", priceCop: 129000, description: "Para entrenamientos avanzados" },
      { plan: "Equipo", label: "Equipo", priceCop: 299000, description: "Para equipos y seguimiento completo" },
    ],
    [],
  );

  const coachPlan = athletes?.[0]?.plan || "";

  const amountInCentsByPlan = (planName) => {
    if (planName === "Starter") return 4900000;
    if (planName === "Pro") return 12900000;
    if (planName === "Equipo") return 29900000;
    return 0;
  };

  const openDirectWompiCheckout = (planObj) => {
    const amountInCents = amountInCentsByPlan(planObj.plan);
    if (!amountInCents) return;

    const reference = `paceforge-${planObj.plan}-${Date.now()}`;

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

      <div style={{ display: "grid", gridTemplateColumns: "repeat(3, 1fr)", gap: 18 }}>
        {PLAN_CATALOG.map((p) => {
          const isCurrent = coachPlan === p.plan;
          const copPretty = Number(p.priceCop).toLocaleString("es-CO");

          return (
            <div
              key={p.plan}
              style={{
                ...S.card,
                border: isCurrent ? "2px solid #f59e0b" : "1px solid rgba(255,255,255,.07)",
                background: isCurrent ? "rgba(245,158,11,.06)" : "rgba(255,255,255,.025)",
                padding: 18,
                display: "flex",
                flexDirection: "column",
                gap: 10,
              }}
            >
              <div style={{ fontSize: "1.2em", fontWeight: 800, color: isCurrent ? "#f59e0b" : "#e2e8f0" }}>
                {p.label} ($${copPretty} COP)
              </div>
              <div style={{ fontSize: "2em", fontWeight: 900, color: "#f59e0b", fontFamily: "monospace" }}>
                {`$${copPretty}`}
                <span style={{ fontSize: ".55em", color: "#64748b", fontFamily: "inherit", marginLeft: 6 }}>COP</span>
              </div>
              <div style={{ fontSize: ".8em", color: "#64748b" }}>{p.description}</div>

              <div style={{ marginTop: "auto" }}>
                <button
                  type="button"
                  onClick={() => openDirectWompiCheckout(p)}
                  style={{
                    width: "100%",
                    background: "linear-gradient(135deg,#b45309,#f59e0b)",
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
  root: { display: "flex", minHeight: "100vh", background: "#080f18", color: "#e2e8f0", fontFamily: "Georgia, 'Times New Roman', serif" },
  sidebar: { width: 220, background: "#050c15", borderRight: "1px solid rgba(255,255,255,.06)", display: "flex", flexDirection: "column", padding: "0 0 20px", flexShrink: 0 },
  logo: { display: "flex", gap: 10, alignItems: "center", padding: "20px 16px 24px", borderBottom: "1px solid rgba(255,255,255,.06)" },
  logoTitle: { fontSize: "1em", fontWeight: 700, letterSpacing: ".08em", color: "#e2e8f0" },
  logoSub: { fontSize: ".65em", color: "#334155", letterSpacing: ".1em", textTransform: "uppercase" },
  navBtn: { display: "flex", gap: 10, alignItems: "center", width: "100%", background: "transparent", border: "none", color: "#475569", padding: "10px 16px", cursor: "pointer", fontSize: ".85em", textAlign: "left", fontFamily: "inherit" },
  navBtnActive: { color: "#f59e0b", background: "rgba(245,158,11,.08)", borderRight: "2px solid #f59e0b" },
  sidebarFooter: { padding: "16px", borderTop: "1px solid rgba(255,255,255,.06)", marginTop: "auto" },
  page: { padding: "28px 32px", maxWidth: 1100 },
  pageTitle: { fontSize: "1.6em", fontWeight: 700, color: "#e2e8f0", margin: 0, letterSpacing: ".02em" },
  card: { background: "rgba(255,255,255,.025)", border: "1px solid rgba(255,255,255,.07)", borderRadius: 12, padding: 18 },
  avatar: { width: 36, height: 36, borderRadius: "50%", background: "rgba(245,158,11,.1)", border: "1px solid rgba(245,158,11,.2)", display: "flex", alignItems: "center", justifyContent: "center", fontSize: "1.2em", flexShrink: 0 },
  notification: { position: "fixed", top: 20, right: 20, background: "#080f18", border: "1px solid #22c55e", borderRadius: 8, padding: "10px 18px", fontSize: ".82em", fontWeight: 600, color: "#22c55e", zIndex: 100 },
};
