import { useState, useRef, useEffect } from "react";
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

const normalizeAthlete = (athlete) => ({
  id: athlete?.id,
  name: athlete?.name || "Atleta sin nombre",
  age: Number.isFinite(Number(athlete?.age)) ? Number(athlete.age) : 0,
  goal: athlete?.goal || "Objetivo pendiente",
  pace: athlete?.pace || "N/A",
  weekly_km: Number.isFinite(Number(athlete?.weekly_km)) ? Number(athlete.weekly_km) : 0,
  avatar: athlete?.avatar || "🏃",
  status: athlete?.status || "on-track",
  next_race: athlete?.next_race || "Próxima carrera - Dec 31",
  workouts_done: Number.isFinite(Number(athlete?.workouts_done)) ? Number(athlete.workouts_done) : 0,
  workouts_total: Number.isFinite(Number(athlete?.workouts_total)) ? Number(athlete.workouts_total) : 18,
});

const generateCalendar = () => {
  const workouts = {};
  const types = ["easy", "tempo", "interval", "long", "recovery"];
  for (let week = 0; week < 4; week++) {
    [0, 2, 3, 5, 6].forEach(day => {
      const type = types[Math.floor(Math.random() * types.length)];
      workouts[`${week}-${day}`] = {
        type, title: WORKOUT_TYPES.find(w => w.id === type).label,
        km: Math.floor(Math.random() * 15 + 5), done: week < 2,
      };
    });
  }
  return workouts;
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
  const [calendar] = useState(generateCalendar());
  const [aiPrompt, setAiPrompt] = useState("");
  const [aiWorkout, setAiWorkout] = useState(null);
  const [aiLoading, setAiLoading] = useState(false);
  const [notification, setNotification] = useState(null);
  const [athletes, setAthletes] = useState([]);
  const [loadingAthletes, setLoadingAthletes] = useState(true);
  const [showAddAthleteForm, setShowAddAthleteForm] = useState(false);
  const [newAthlete, setNewAthlete] = useState({ name: "", goal: "", pace: "", weekly_km: "" });
  const [session, setSession] = useState(null);
  const [authLoading, setAuthLoading] = useState(true);
  const [authMode, setAuthMode] = useState("login");
  const [authEmail, setAuthEmail] = useState("");
  const [authPassword, setAuthPassword] = useState("");
  const [authSubmitting, setAuthSubmitting] = useState(false);

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
    const loadAthletes = async () => {
      if (!session) {
        setAthletes([]);
        setLoadingAthletes(false);
        return;
      }
      setLoadingAthletes(true);
      const { data, error } = await supabase.from("athletes").select("*").order("id", { ascending: true });
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
        const { error } = await supabase.auth.signUp({
          email: authEmail.trim(),
          password: authPassword,
        });
        if (error) {
          console.error("Error en registro:", error);
          alert(`Error en registro: ${error.message}`);
          return;
        }
        alert("Registro exitoso. Revisa tu correo si la verificación está habilitada.");
        setAuthMode("login");
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
  };

  const saveNewAthlete = async () => {
    const name = newAthlete.name.trim();
    const goal = newAthlete.goal.trim();
    const pace = newAthlete.pace.trim();
    const weeklyKm = Number(newAthlete.weekly_km);

    if (!name || !goal || !pace || !Number.isFinite(weeklyKm) || weeklyKm <= 0) {
      notify("Completa todos los campos ✓");
      return;
    }

    const payload = { name, goal, pace, weekly_km: weeklyKm };
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
    setNewAthlete({ name: "", goal: "", pace: "", weekly_km: "" });
    notify("Atleta agregado ✓");
  };

  const cancelAddAthleteForm = () => {
    setShowAddAthleteForm(false);
    setNewAthlete({ name: "", goal: "", pace: "", weekly_km: "" });
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
    return (
      <div style={S.root}>
        <main style={{ ...S.page, display: "flex", alignItems: "center", justifyContent: "center", width: "100%" }}>
          <div style={{ ...S.card, width: 360 }}>
            <h1 style={{ ...S.pageTitle, fontSize: "1.3em", marginBottom: 16 }}>
              {authMode === "login" ? "Login" : "Registro"}
            </h1>
            <form onSubmit={handleAuthSubmit}>
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
            athletes={athletes}
            onSelect={a => { setSelectedAthlete(a); setView("athletes"); setShowAddAthleteForm(false); }}
            onRequestAddAthlete={() => setShowAddAthleteForm(true)}
            showAddAthleteForm={showAddAthleteForm}
            newAthlete={newAthlete}
            onChangeNewAthleteField={updateNewAthleteField}
            onSaveNewAthlete={saveNewAthlete}
            onCancelAddAthlete={cancelAddAthleteForm}
          />
        )}
        {view === "athletes" && <Athletes athletes={athletes} selected={selectedAthlete} onSelect={setSelectedAthlete} calendar={calendar} />}
        {view === "builder" && <Builder aiPrompt={aiPrompt} setAiPrompt={setAiPrompt} aiWorkout={aiWorkout} setAiWorkout={setAiWorkout} aiLoading={aiLoading} setAiLoading={setAiLoading} notify={notify} />}
          </>
        )}
      </main>
    </div>
  );
}

function Dashboard({
  athletes,
  onSelect,
  onRequestAddAthlete,
  showAddAthleteForm,
  newAthlete,
  onChangeNewAthleteField,
  onSaveNewAthlete,
  onCancelAddAthlete,
}) {
  const S = styles;
  return (
    <div style={S.page}>
      <div style={{ marginBottom: 28 }}>
        <div style={{ display: "flex", alignItems: "flex-start", justifyContent: "space-between", gap: 16 }}>
          <div>
            <h1 style={S.pageTitle}>Dashboard</h1>
            <p style={{ color: "#475569", fontSize: ".82em", marginTop: 4 }}>Semana del 17 al 23 de Marzo, 2026</p>
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
      <div style={{ display: "grid", gridTemplateColumns: "repeat(4,1fr)", gap: 14, marginBottom: 28 }}>
        {[
          { label: "Atletas Activos", value: athletes.length, icon: "🏃", color: "#f59e0b" },
          { label: "Km Totales / Semana", value: `${athletes.reduce((a,b)=>a+b.weekly_km,0)} km`, icon: "📍", color: "#3b82f6" },
          { label: "Entrenamientos Completados", value: athletes.reduce((a,b)=>a+b.workouts_done,0), icon: "✅", color: "#22c55e" },
          { label: "Carreras Este Mes", value: 3, icon: "🏁", color: "#ef4444" },
        ].map((s, i) => (
          <div key={i} style={S.card}>
            <div style={{ fontSize: "1.8em", marginBottom: 8 }}>{s.icon}</div>
            <div style={{ fontSize: "2em", fontWeight: 700, color: s.color, fontFamily: "monospace" }}>{s.value}</div>
            <div style={{ fontSize: ".75em", color: "#64748b" }}>{s.label}</div>
          </div>
        ))}
      </div>
      <div style={{ fontSize: ".72em", letterSpacing: ".15em", color: "#475569", textTransform: "uppercase", marginBottom: 14 }}>ESTADO DE ATLETAS</div>
      <div style={{ display: "grid", gridTemplateColumns: "repeat(auto-fill,minmax(240px,1fr))", gap: 14 }}>
        {athletes.map(a => (
          <div key={a.id} onClick={() => onSelect(a)} style={{ ...S.card, cursor: "pointer" }}>
            <div style={{ display: "flex", justifyContent: "space-between", marginBottom: 12 }}>
              <div style={{ display: "flex", gap: 10, alignItems: "center" }}>
                <div style={S.avatar}>{a.avatar}</div>
                <div>
                  <div style={{ fontWeight: 600, color: "#e2e8f0", fontSize: ".95em" }}>{a.name}</div>
                  <div style={{ color: "#64748b", fontSize: ".75em" }}>{a.goal}</div>
                </div>
              </div>
              <StatusBadge status={a.status} />
            </div>
            <div style={{ display: "flex", gap: 16, marginBottom: 8, fontSize: ".78em", color: "#94a3b8" }}>
              <span>⚡ {a.pace}</span><span>📍 {a.weekly_km} km/sem</span>
            </div>
            <div style={{ fontSize: ".72em", color: "#64748b" }}>{a.workouts_done}/{a.workouts_total} entrenamientos</div>
            <ProgressBar value={a.workouts_done} total={a.workouts_total} color={a.status === "behind" ? "#ef4444" : "#f59e0b"} />
            <div style={{ marginTop: 10, fontSize: ".72em", color: "#475569" }}>{getRaceCountdownText(a.next_race)}</div>
          </div>
        ))}
      </div>
    </div>
  );
}

function Athletes({ athletes, selected, onSelect, calendar }) {
  const S = styles;
  const athlete = selected || athletes[0] || null;
  const [searchQuery, setSearchQuery] = useState("");
  const normalized = searchQuery.trim().toLowerCase();
  const filteredAthletes = normalized
    ? athletes.filter(a => (a.name || "").toLowerCase().includes(normalized) || (a.goal || "").toLowerCase().includes(normalized))
    : athletes;

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
          <div style={{ fontSize: ".65em", letterSpacing: ".15em", color: "#334155", textTransform: "uppercase", marginBottom: 10 }}>CALENDARIO — MARZO 2026</div>
          <div style={{ display: "grid", gridTemplateColumns: "repeat(7,1fr)", gap: 4 }}>
            {DAYS.map(d => <div key={d} style={{ fontSize: ".65em", textAlign: "center", color: "#334155", padding: "4px 0" }}>{d}</div>)}
            {Array.from({length:4}).map((_,week) => Array.from({length:7}).map((_,day) => {
              const w = calendar[`${week}-${day}`];
              const wt = w ? WORKOUT_TYPES.find(t=>t.id===w.type) : null;
              return (
                <div key={`${week}-${day}`} style={{ minHeight: 54, border: `1px solid ${wt ? `${wt.color}40` : "rgba(255,255,255,.05)"}`, borderRadius: 6, padding: "5px 4px", display: "flex", flexDirection: "column", alignItems: "center", background: wt ? `${wt.color}08` : "transparent" }}>
                  {wt && <>
                    <div style={{ width: 6, height: 6, borderRadius: "50%", background: wt.color, marginBottom: 3 }} />
                    <div style={{ fontSize: ".58em", color: wt.color, fontWeight: 600, lineHeight: 1.2, textAlign: "center" }}>{w.title}</div>
                    <div style={{ fontSize: ".56em", color: "#475569" }}>{w.km}km</div>
                    {w.done && <div style={{ fontSize: ".55em", color: "#22c55e" }}>✓</div>}
                  </>}
                </div>
              );
            }))}
          </div>
        </div>
      </div>
    </div>
  );
}

function Builder({ aiPrompt, setAiPrompt, aiWorkout, setAiWorkout, aiLoading, setAiLoading, notify }) {
  const S = styles;

  const generateWorkout = async () => {
    if (!aiPrompt.trim()) return;
    setAiLoading(true);
    setAiWorkout(null);
    try {
      const res = await fetch("https://api.anthropic.com/v1/messages", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({
          model: "claude-sonnet-4-20250514",
          max_tokens: 1000,
          system: `You are an elite running coach. Generate a structured workout in JSON only. No markdown, no backticks. Format: {"title":"...","type":"easy|tempo|interval|long|recovery","total_km":number,"duration_min":number,"description":"...","structure":[{"phase":"...","duration":"...","intensity":"...","pace":"..."}]}`,
          messages: [{ role: "user", content: aiPrompt }],
        }),
      });
      const data = await res.json();
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
          <textarea value={aiPrompt} onChange={e=>setAiPrompt(e.target.value)} placeholder="Ej: Intervalos 6x800m para atleta sub 4h maratón..." style={{ width: "100%", background: "rgba(255,255,255,.04)", border: "1px solid rgba(255,255,255,.1)", borderRadius: 8, padding: "12px 14px", color: "#e2e8f0", fontFamily: "inherit", fontSize: ".85em", resize: "vertical", outline: "none", marginBottom: 12, boxSizing: "border-box" }} rows={5} />
          <div style={{ marginBottom: 12 }}>
            <div style={{ fontSize: ".72em", color: "#475569", marginBottom: 8 }}>SUGERENCIAS:</div>
            {["Intervalos 6x800m para atleta sub 4h maratón", "Rodaje largo 28km semana 18 de plan", "Tempo 8km para media maratón zona 3-4"].map((s,i) => (
              <div key={i} onClick={()=>setAiPrompt(s)} style={{ background: "rgba(255,255,255,.03)", border: "1px solid rgba(255,255,255,.07)", borderRadius: 6, padding: "8px 12px", fontSize: ".75em", color: "#64748b", cursor: "pointer", marginBottom: 6 }}>{s}</div>
            ))}
          </div>
          <button onClick={generateWorkout} disabled={aiLoading || !aiPrompt.trim()} style={{ width: "100%", background: aiLoading || !aiPrompt.trim() ? "rgba(255,255,255,.06)" : "linear-gradient(135deg,#b45309,#f59e0b)", border: "none", borderRadius: 8, padding: "11px 20px", color: aiLoading || !aiPrompt.trim() ? "#334155" : "white", fontWeight: 700, cursor: aiLoading || !aiPrompt.trim() ? "not-allowed" : "pointer", fontSize: ".85em", fontFamily: "inherit" }}>
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
              <button onClick={()=>notify("Asignado al atleta ✓")} style={{ background: "rgba(59,130,246,.1)", border: "1px solid rgba(59,130,246,.3)", borderRadius: 8, padding: "8px 14px", color: "#3b82f6", cursor: "pointer", fontSize: ".78em", fontFamily: "inherit", fontWeight: 600 }}>📤 Asignar a Atleta</button>
            </div>
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
