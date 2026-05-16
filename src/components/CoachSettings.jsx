import { useState, useEffect, useMemo, useCallback, useRef } from "react";
import { supabase } from "../lib/supabase";
import { BRAND_NAME, STRAVA_CALLBACK_URL, formatDurationClock, normalizeStravaActivity } from "./shared/appShared";

function CoachSettings({ coachUserId, sessionEmail, profileName, athletes, setAthletes, stravaRefreshTick, notify, onSignOut, styles }) {
  const S = styles;
  const athletesRef = useRef(athletes);
  const isDirtyRef = useRef(false);
  const skipDirtyMarkRef = useRef(true);
  athletesRef.current = athletes;
  const [loading, setLoading] = useState(true);
  const [saving, setSaving] = useState(false);
  const [uploading, setUploading] = useState(false);
  const [form, setForm] = useState({
    avatar_url: "",
    full_name: "",
    email: "",
    phone: "",
    country: "",
    city: "",
    timezone: "America/Bogota",
    language: "es",
    currency: "COP",
    notify_new_workouts: true,
    notify_reminders: true,
    is_public: false,
    subscription_plan: "",
    subscription_renews_at: "",
  });
  const [stravaByUserId, setStravaByUserId] = useState({});
  const [loadingStravaByAthlete, setLoadingStravaByAthlete] = useState(false);
  const [deviceOverrides, setDeviceOverrides] = useState({});
  const [stravaActivitiesByAthlete, setStravaActivitiesByAthlete] = useState({});
  const [loadingActivitiesByAthlete, setLoadingActivitiesByAthlete] = useState({});
  const [coachRequests, setCoachRequests] = useState([]);
  const [requestsBusyId, setRequestsBusyId] = useState("");
  const [COROS_MODAL_OPEN, setCorosModalOpen] = useState(false);
  const [GARMIN_MODAL_OPEN, setGarminModalOpen] = useState(false);
  const [staffList, setStaffList] = useState([]);
  const [staffEmail, setStaffEmail] = useState("");
  const [staffInviteSending, setStaffInviteSending] = useState(false);
  const [assignModal, setAssignModal] = useState(null);
  const [assignedAthleteIds, setAssignedAthleteIds] = useState(new Set());

  const setFormFromProfile = useCallback((nextForm) => {
    skipDirtyMarkRef.current = true;
    setForm(nextForm);
    isDirtyRef.current = false;
  }, []);

  useEffect(() => {
    if (skipDirtyMarkRef.current) {
      skipDirtyMarkRef.current = false;
      return;
    }
    isDirtyRef.current = true;
  }, [form]);

 const loadProfile = useCallback(async () => {
    if (!coachUserId) {
      console.log("coachUserId is null/undefined - returning early");
      setLoading(false);
      return;
    }
    setLoading(true);
    try {
      // Leemos en paralelo coach_profiles (datos de perfil/preferencias) y profiles (estado de suscripción Wompi)
      const [coachRes, profRes] = await Promise.all([
        supabase.from("coach_profiles").select("*").eq("user_id", coachUserId).maybeSingle(),
        supabase
          .from("profiles")
          .select("subscription_plan, subscription_period, subscription_expires_at, plan_status")
          .eq("user_id", coachUserId)
          .maybeSingle(),
      ]);

      const data = coachRes.data;
      const profData = profRes.data;
      const coachErr = coachRes.error;

      if (coachErr) {
        console.error(coachErr);
        notify("No se pudo cargar la configuración. ¿Existe la tabla coach_profiles?");
        return;
      }
      if (profRes.error) {
        console.warn("[CoachSettings] No se pudo leer profiles:", profRes.error);
      }

      // Convertir el plan canónico ("basico"/"Basico"/"Pro") a un label visible.
      const planLabelFromProfiles = (() => {
        const raw = String(profData?.subscription_plan || "").trim().toLowerCase();
        if (raw === "basico") return "Básico";
        if (raw === "pro") return "Pro";
        return "";
      })();

      // Fecha de renovación: el webhook guarda subscription_expires_at en profiles (formato ISO);
      // el input HTML <input type="date"> espera "YYYY-MM-DD".
      const renewsFromProfiles = profData?.subscription_expires_at
        ? String(profData.subscription_expires_at).slice(0, 10)
        : "";

      if (data) {
        skipDirtyMarkRef.current = true;
        setFormFromProfile({
          avatar_url: data.avatar_url || "",
          full_name: data.full_name || profileName || "",
          email: data.email || sessionEmail || "",
          phone: data.phone || "",
          country: data.country || "",
          city: data.city || "",
          timezone: data.timezone || "America/Bogota",
          language: data.language === "en" ? "en" : "es",
          currency: data.currency === "USD" ? "USD" : "COP",
          notify_new_workouts: data.notify_new_workouts !== false,
          notify_reminders: data.notify_reminders !== false,
          is_public: data.is_public === true,
          // profiles (Wompi) gana sobre coach_profiles si tiene plan activo
          subscription_plan: planLabelFromProfiles || data.subscription_plan || "",
          subscription_renews_at: renewsFromProfiles || data.subscription_renews_at || "",
        });
      } else {
        skipDirtyMarkRef.current = true;
        setFormFromProfile({
          avatar_url: "",
          full_name: profileName || "",
          email: sessionEmail || "",
          phone: "",
          country: "",
          city: "",
          timezone: "America/Bogota",
          language: "es",
          currency: "COP",
          notify_new_workouts: true,
          notify_reminders: true,
          is_public: false,
          subscription_plan: planLabelFromProfiles || athletesRef.current?.find((a) => a.plan)?.plan || "",
          subscription_renews_at: renewsFromProfiles || "",
        });
      }
    } catch (err) {
      console.error(err);
      notify("No se pudo cargar la configuración. ¿Existe la tabla coach_profiles?");
    } finally {
      setLoading(false);
    }
  }, [coachUserId, sessionEmail, profileName, notify, setFormFromProfile]);

  useEffect(() => {
    if (isDirtyRef.current) return;
    loadProfile();
  }, [loadProfile]);

  useEffect(() => {
    setDeviceOverrides({});
  }, [athletes]);

  const coachCode = useMemo(() => String(coachUserId || "").replace(/-/g, "").slice(0, 8).toUpperCase(), [coachUserId]);

  const loadCoachRequests = useCallback(async () => {
    if (!coachUserId) return;
    const { data, error } = await supabase
      .from("coach_requests")
      .select("id, athlete_id, coach_id, status, created_at")
      .eq("coach_id", coachUserId)
      .order("created_at", { ascending: false });
    if (error) {
      console.error("Error cargando coach_requests:", error);
      setCoachRequests([]);
      return;
    }
    setCoachRequests(data || []);
  }, [coachUserId]);

  useEffect(() => {
    loadCoachRequests();
  }, [loadCoachRequests]);

  const updateCoachRequestStatus = async (row, status) => {
    if (!row?.id || !coachUserId) return;
    setRequestsBusyId(row.id);
    const { error } = await supabase
      .from("coach_requests")
      .update({ status })
      .eq("id", row.id)
      .eq("coach_id", coachUserId);
    if (error) {
      console.error("Error actualizando solicitud:", error);
      notify(error.message || "No se pudo actualizar la solicitud");
      setRequestsBusyId("");
      return;
    }
    if (status === "accepted") {
      const { data: athleteRow } = await supabase.from("athletes").select("id, user_id").eq("id", row.athlete_id).maybeSingle();
      await supabase.from("athletes").update({ coach_id: coachUserId }).eq("id", row.athlete_id);
      if (athleteRow?.user_id) {
        await supabase.from("profiles").update({ coach_id: coachUserId }).eq("user_id", athleteRow.user_id);
      }
      if (typeof setAthletes === "function") {
        setAthletes((prev) => prev.map((a) => (String(a.id) === String(row.athlete_id) ? { ...a, coach_id: coachUserId } : a)));
      }
    }
    await loadCoachRequests();
    setRequestsBusyId("");
  };

  const setAthleteDeviceConnection = async (athleteId, deviceValue) => {
    const { error } = await supabase.from("athletes").update({ device: deviceValue }).eq("id", athleteId);
    if (error) {
      console.error("Error actualizando dispositivo:", error);
      notify(error.message || "No se pudo actualizar el dispositivo");
      return;
    }
    setDeviceOverrides((prev) => ({ ...prev, [athleteId]: deviceValue || "" }));
    notify("Dispositivo actualizado");
  };

  const disconnectStravaForAthlete = async (athleteId) => {
    const { error } = await supabase.from("strava_connections").delete().eq("athlete_id", athleteId);
    if (error) {
      console.error("Error desconectando Strava:", error);
      notify(error.message || "No se pudo desconectar Strava");
      return;
    }
    setStravaByUserId((prev) => {
      const next = { ...prev };
      delete next[athleteId];
      return next;
    });
    notify("Strava desconectado");
  };

  const loadStravaActivitiesForAthlete = async (athleteId, accessToken) => {
    if (!athleteId || !accessToken) return;
    setLoadingActivitiesByAthlete((prev) => ({ ...prev, [athleteId]: true }));
    try {
      const r = await fetch("/api/strava?action=activities", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ access_token: accessToken }),
      });
      const data = await r.json();
      if (!r.ok || !Array.isArray(data)) {
        notify("No se pudieron cargar actividades de Strava");
        setStravaActivitiesByAthlete((prev) => ({ ...prev, [athleteId]: [] }));
        return;
      }
      setStravaActivitiesByAthlete((prev) => ({
        ...prev,
        [athleteId]: data.slice(0, 10).map(normalizeStravaActivity).filter(Boolean),
      }));
    } catch (e) {
      console.error("Error cargando actividades Strava en settings:", e);
      notify("No se pudieron cargar actividades de Strava");
      setStravaActivitiesByAthlete((prev) => ({ ...prev, [athleteId]: [] }));
    } finally {
      setLoadingActivitiesByAthlete((prev) => ({ ...prev, [athleteId]: false }));
    }
  };

  useEffect(() => {
    const athleteIds = (athletes || []).map((a) => a?.id).filter(Boolean);
    if (!athleteIds.length) {
      setStravaByUserId({});
      return;
    }
    let cancelled = false;
    (async () => {
      setLoadingStravaByAthlete(true);
      const { data, error } = await supabase.from("strava_connections").select("*").in("athlete_id", athleteIds);
      if (cancelled) return;
      if (error) {
        console.error("Error cargando conexiones Strava en settings:", error);
        setStravaByUserId({});
        setLoadingStravaByAthlete(false);
        return;
      }
      const map = {};
      for (const row of data || []) map[row.athlete_id] = row;
      setStravaByUserId(map);
      setLoadingStravaByAthlete(false);
    })();
    return () => { cancelled = true; };
  }, [athletes]);

  // ── STAFF FUNCTIONS ─────────────────────────────────────────
  const loadStaff = useCallback(async () => {
    if (!coachUserId) return;
    const { data: staffRows } = await supabase.from("coach_staff").select("*, staff_profile:profiles!staff_id(full_name, email)").eq("coach_id", coachUserId);
    if (!staffRows) return;
    // Count assigned athletes for each staff
    const staffWithCounts = await Promise.all((staffRows || []).map(async (s) => {
      const { count } = await supabase.from("staff_athletes").select("*", { count: "exact", head: true }).eq("staff_id", s.staff_id).eq("coach_id", coachUserId);
      return { ...s, assignedCount: count || 0 };
    }));
    setStaffList(staffWithCounts);
  }, [coachUserId]);

  useEffect(() => { loadStaff(); }, [loadStaff]);

  const sendStaffInvitation = async () => {
    const email = staffEmail.trim().toLowerCase();
    if (!email || !coachUserId) { notify("Completa el email del sub-coach."); return; }
    if (staffList.length >= 5) { notify("Limite de 5 sub-coaches alcanzado."); return; }
    setStaffInviteSending(true);
    try {
      const code = (typeof crypto !== "undefined" && crypto.randomUUID && crypto.randomUUID()) || Date.now().toString();
      const inviteLink = `https://www.runningapexflow.com?invite=${encodeURIComponent(code)}&type=staff&coach=${coachUserId}`;
      await supabase.from("invitations").insert({ coach_id: coachUserId, email, code, status: "pending", type: "staff" });
      await fetch("/api/send-email", {
        method: "POST", headers: { "Content-Type": "application/json" },
        body: JSON.stringify({
          to: email,
          subject: "Invitacion para unirte como sub-coach en RunningApexFlow",
          html: `<div style="font-family:Arial,sans-serif"><h2>Te invitaron como sub-coach en RunningApexFlow</h2><p>Haz clic para registrarte y unirte al equipo:</p><p><a href="${inviteLink}">${inviteLink}</a></p><p style="font-size:14px;color:#64748b">Una vez registrado, el coach principal podra asignarte atletas para gestionar.</p></div>`,
        }),
      });
      notify("Invitacion enviada al sub-coach");
      setStaffEmail("");
      loadStaff();
    } catch (e) {
      notify("No se pudo enviar la invitacion.");
    } finally {
      setStaffInviteSending(false);
    }
  };

  const removeStaff = async (staffId) => {
    if (!window.confirm("Revocar acceso de este sub-coach? Se eliminaran sus asignaciones de atletas.")) return;
    await supabase.from("staff_athletes").delete().eq("staff_id", staffId).eq("coach_id", coachUserId);
    await supabase.from("coach_staff").delete().eq("staff_id", staffId).eq("coach_id", coachUserId);
    notify("Sub-coach removido");
    loadStaff();
  };

  const openAssignAthletesModal = async (staffRow) => {
    setAssignModal(staffRow);
    const { data } = await supabase.from("staff_athletes").select("athlete_id").eq("staff_id", staffRow.staff_id).eq("coach_id", coachUserId);
    setAssignedAthleteIds(new Set((data || []).map((r) => String(r.athlete_id))));
  };

  const toggleAthleteAssignment = async (athleteId, isAssigned) => {
    if (!assignModal) return;
    if (isAssigned) {
      await supabase.from("staff_athletes").delete().eq("staff_id", assignModal.staff_id).eq("athlete_id", athleteId).eq("coach_id", coachUserId);
      setAssignedAthleteIds((prev) => { const next = new Set(prev); next.delete(String(athleteId)); return next; });
    } else {
      await supabase.from("staff_athletes").insert({ staff_id: assignModal.staff_id, athlete_id: athleteId, coach_id: coachUserId });
      setAssignedAthleteIds((prev) => new Set([...prev, String(athleteId)]));
    }
    loadStaff();
  };

  return () => {
      cancelled = true;
    };
  }, [athletes, stravaRefreshTick]);

  const onAvatarChange = async (e) => {
    const file = e.target.files?.[0];
    if (!file || !coachUserId) return;
    setUploading(true);
    const ext = (file.name.split(".").pop() || "jpg").replace(/[^a-z0-9]/gi, "").slice(0, 5) || "jpg";
    const path = `${coachUserId}/${Date.now()}.${ext}`;
    const { error } = await supabase.storage.from("coach-avatars").upload(path, file, { upsert: true, cacheControl: "3600" });
    if (error) {
      console.error(error);
      notify(error.message || "Error subiendo la foto (bucket coach-avatars)");
      setUploading(false);
      return;
    }
    const { data: pub } = supabase.storage.from("coach-avatars").getPublicUrl(path);
    setForm((f) => ({ ...f, avatar_url: pub.publicUrl }));
    setUploading(false);
    notify("Foto actualizada (guarda para persistir el perfil)");
  };

  const saveProfile = async (e) => {
    e.preventDefault();
    if (!coachUserId) return;
    setSaving(true);
    const language = form.language === "en" ? "en" : "es";
    const currency = form.currency === "USD" ? "USD" : "COP";
    const payload = {
      user_id: coachUserId,
      avatar_url: form.avatar_url || null,
      full_name: form.full_name.trim() || null,
      email: form.email.trim() || null,
      phone: form.phone.trim() || null,
      country: form.country.trim() || null,
      city: form.city.trim() || null,
      timezone: form.timezone || null,
      language,
      currency,
      notify_new_workouts: form.notify_new_workouts,
      notify_reminders: form.notify_reminders,
      is_public: form.is_public === true,
      subscription_plan: form.subscription_plan.trim() || null,
      subscription_renews_at: form.subscription_renews_at ? form.subscription_renews_at : null,
      updated_at: new Date().toISOString(),
    };
    const { data: existingRow, error: loadErr } = await supabase.from("coach_profiles").select("user_id").eq("user_id", coachUserId).maybeSingle();
    if (loadErr) {
      console.error(loadErr);
      setSaving(false);
      notify(loadErr.message || "Error al comprobar el perfil");
      return;
    }
    const upsertPayload = existingRow?.user_id
      ? payload
      : {
          ...payload,
          trial_start: new Date().toISOString(),
          trial_days: 10,
          subscription_status: "trial",
          approved_by_admin: false,
          registered_at: new Date().toISOString(),
        };
    const { error } = await supabase.from("coach_profiles").upsert(upsertPayload, { onConflict: "user_id" });
    setSaving(false);
    if (error) {
      console.error(error);
      notify(error.message || "Error al guardar");
      return;
    }
    notify("Cambios guardados");
    isDirtyRef.current = false;
    await loadProfile();
  };

  const field = (label, child) => (
    <div style={{ marginBottom: 16 }}>
      <label style={{ display: "block", fontSize: ".75em", color: "#64748b", marginBottom: 6, fontWeight: 600 }}>{label}</label>
      {child}
    </div>
  );

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

  const athletePlanHint = athletes?.find((a) => a.plan)?.plan;

  if (!coachUserId) {
    return (
      <div style={S.page}>
        <p style={{ color: "#64748b" }}>Inicia sesión para ver la configuración.</p>
      </div>
    );
  }

  return (
    <div style={S.page}>
      <h1 style={S.pageTitle}>Configuración</h1>
      <p style={{ color: "#475569", fontSize: ".85em", marginTop: 4, marginBottom: 22 }}>Perfil del coach y preferencias de {BRAND_NAME}.</p>

      {loading ? (
        <div style={{ color: "#64748b" }}>Cargando…</div>
      ) : (
        <form onSubmit={saveProfile}>
          <div style={{ ...S.card, marginBottom: 18 }}>
            <div style={{ fontSize: ".72em", letterSpacing: ".12em", color: "#64748b", fontWeight: 700, marginBottom: 16 }}>
              PERFIL
            </div>
            <div style={{ display: "flex", flexWrap: "wrap", gap: 20, alignItems: "flex-start" }}>
              <div style={{ textAlign: "center" }}>
                <div
                  style={{
                    width: 96,
                    height: 96,
                    borderRadius: "50%",
                    overflow: "hidden",
                    border: "2px solid #e2e8f0",
                    background: "#f1f5f9",
                    margin: "0 auto 10px",
                    display: "flex",
                    alignItems: "center",
                    justifyContent: "center",
                    fontSize: "2em",
                  }}
                >
                  {form.avatar_url ? (
                    <img src={form.avatar_url} alt="" style={{ width: "100%", height: "100%", objectFit: "cover" }} />
                  ) : (
                    "👤"
                  )}
                </div>
                <label style={{ cursor: uploading ? "wait" : "pointer" }}>
                  <span
                    style={{
                      display: "inline-block",
                      padding: "8px 14px",
                      borderRadius: 8,
                      background: "#eff6ff",
                      color: "#2563eb",
                      fontWeight: 700,
                      fontSize: ".78em",
                    }}
                  >
                    {uploading ? "Subiendo…" : "Subir foto"}
                  </span>
                  <input type="file" accept="image/*" style={{ display: "none" }} disabled={uploading} onChange={onAvatarChange} />
                </label>
              </div>
              <div style={{ flex: "1 1 240px" }}>
                {field(
                  "Nombre completo",
                  <input value={form.full_name} onChange={(e) => setForm((f) => ({ ...f, full_name: e.target.value }))} style={inputStyle} />,
                )}
                {field(
                  "Email",
                  <input type="email" value={form.email} onChange={(e) => setForm((f) => ({ ...f, email: e.target.value }))} style={inputStyle} />,
                )}
                {field(
                  "Teléfono",
                  <input value={form.phone} onChange={(e) => setForm((f) => ({ ...f, phone: e.target.value }))} style={inputStyle} />,
                )}
                <div style={{ display: "grid", gridTemplateColumns: "1fr 1fr", gap: 12 }}>
                  {field(
                    "País",
                    <input value={form.country} onChange={(e) => setForm((f) => ({ ...f, country: e.target.value }))} style={inputStyle} />,
                  )}
                  {field(
                    "Ciudad",
                    <input value={form.city} onChange={(e) => setForm((f) => ({ ...f, city: e.target.value }))} style={inputStyle} />,
                  )}
                </div>
              </div>
            </div>
          </div>

          <div style={{ ...S.card, marginBottom: 18 }}>
            <div style={{ fontSize: ".72em", letterSpacing: ".12em", color: "#64748b", fontWeight: 700, marginBottom: 12 }}>
              CÓDIGO DE COACH
            </div>
            <div style={{ display: "flex", flexWrap: "wrap", alignItems: "center", justifyContent: "space-between", gap: 10, marginBottom: 10 }}>
              <div style={{ color: "#0f172a", fontWeight: 800, fontFamily: "monospace", fontSize: "1.1em" }}>{coachCode || "--------"}</div>
              <button
                type="button"
                onClick={async () => {
                  try {
                    await navigator.clipboard.writeText(coachCode || "");
                    notify("Código copiado");
                  } catch {
                    notify("No se pudo copiar el código");
                  }
                }}
                style={{ background: "#eff6ff", border: "1px solid #bfdbfe", borderRadius: 8, padding: "6px 10px", color: "#1d4ed8", fontWeight: 700, fontSize: ".75em", cursor: "pointer", fontFamily: "inherit" }}
              >
                Copiar
              </button>
            </div>
            <label style={{ display: "flex", alignItems: "center", gap: 10, cursor: "pointer", fontSize: ".85em", color: "#0f172a" }}>
              <input type="checkbox" checked={form.is_public} onChange={(e) => setForm((f) => ({ ...f, is_public: e.target.checked }))} />
              Mostrar mi perfil en "Encuentra tu coach"
            </label>
          </div>

          <div style={{ ...S.card, marginBottom: 18 }}>
            <div style={{ fontSize: ".72em", letterSpacing: ".12em", color: "#64748b", fontWeight: 700, marginBottom: 16 }}>
              PREFERENCIAS
            </div>
            {field(
              "Zona horaria",
              <select value={form.timezone} onChange={(e) => setForm((f) => ({ ...f, timezone: e.target.value }))} style={inputStyle}>
                <option value="America/Bogota">America/Bogota</option>
                <option value="America/Mexico_City">America/Mexico_City</option>
                <option value="America/New_York">America/New_York</option>
                <option value="America/Santiago">America/Santiago</option>
                <option value="Europe/Madrid">Europe/Madrid</option>
                <option value="UTC">UTC</option>
              </select>,
            )}
            <div style={{ display: "grid", gridTemplateColumns: "1fr 1fr", gap: 12 }}>
              {field(
                "Idioma",
                <select value={form.language} onChange={(e) => setForm((f) => ({ ...f, language: e.target.value }))} style={inputStyle}>
                  <option value="es">Español</option>
                  <option value="en">English</option>
                </select>,
              )}
              {field(
                "Moneda",
                <select value={form.currency} onChange={(e) => setForm((f) => ({ ...f, currency: e.target.value }))} style={inputStyle}>
                  <option value="COP">COP</option>
                  <option value="USD">USD</option>
                </select>,
              )}
            </div>
          </div>

          <div style={{ ...S.card, marginBottom: 18 }}>
            <div style={{ fontSize: ".72em", letterSpacing: ".12em", color: "#64748b", fontWeight: 700, marginBottom: 16 }}>
              NOTIFICACIONES
            </div>
            <label style={{ display: "flex", alignItems: "center", gap: 10, marginBottom: 12, cursor: "pointer", fontSize: ".9em", color: "#0f172a" }}>
              <input
                type="checkbox"
                checked={form.notify_new_workouts}
                onChange={(e) => setForm((f) => ({ ...f, notify_new_workouts: e.target.checked }))}
              />
              Emails de nuevos workouts
            </label>
            <label style={{ display: "flex", alignItems: "center", gap: 10, cursor: "pointer", fontSize: ".9em", color: "#0f172a" }}>
              <input type="checkbox" checked={form.notify_reminders} onChange={(e) => setForm((f) => ({ ...f, notify_reminders: e.target.checked }))} />
              Recordatorios por email
            </label>
          </div>

          <div style={{ ...S.card, marginBottom: 18 }}>
            <div style={{ fontSize: ".72em", letterSpacing: ".12em", color: "#64748b", fontWeight: 700, marginBottom: 16 }}>
              SOLICITUDES DE ATLETAS
            </div>
            {coachRequests.filter((r) => r.status === "pending").length === 0 ? (
              <div style={{ color: "#64748b", fontSize: ".84em" }}>No tienes solicitudes pendientes.</div>
            ) : (
              <div style={{ display: "flex", flexDirection: "column", gap: 8 }}>
                {coachRequests
                  .filter((r) => r.status === "pending")
                  .map((r) => {
                    const athlete = (athletes || []).find((a) => String(a.id) === String(r.athlete_id));
                    return (
                      <div key={r.id} style={{ border: "1px solid #e2e8f0", borderRadius: 10, padding: "10px 12px", background: "#f8fafc", display: "flex", justifyContent: "space-between", gap: 10, alignItems: "center", flexWrap: "wrap" }}>
                        <div>
                          <div style={{ color: "#0f172a", fontWeight: 700, fontSize: ".82em" }}>{athlete?.name || "Atleta"}</div>
                          <div style={{ color: "#64748b", fontSize: ".72em" }}>{athlete?.email || r.athlete_id}</div>
                        </div>
                        <div style={{ display: "flex", gap: 8 }}>
                          <button type="button" disabled={requestsBusyId === r.id} onClick={() => updateCoachRequestStatus(r, "accepted")} style={{ background: "rgba(34,197,94,.14)", border: "1px solid rgba(34,197,94,.35)", borderRadius: 8, padding: "6px 10px", color: "#15803d", fontSize: ".72em", fontWeight: 700, cursor: requestsBusyId === r.id ? "not-allowed" : "pointer", fontFamily: "inherit" }}>Aceptar</button>
                          <button type="button" disabled={requestsBusyId === r.id} onClick={() => updateCoachRequestStatus(r, "rejected")} style={{ background: "#fef2f2", border: "1px solid #fecaca", borderRadius: 8, padding: "6px 10px", color: "#b91c1c", fontSize: ".72em", fontWeight: 700, cursor: requestsBusyId === r.id ? "not-allowed" : "pointer", fontFamily: "inherit" }}>Rechazar</button>
                        </div>
                      </div>
                    );
                  })}
              </div>
            )}
          </div>

          <div style={{ ...S.card, marginBottom: 18 }}>
            <div style={{ fontSize: ".72em", letterSpacing: ".12em", color: "#64748b", fontWeight: 700, marginBottom: 16 }}>
              INTEGRACIONES
            </div>
            {!athletes || athletes.length === 0 ? (
              <div style={{ color: "#94a3b8", fontSize: ".86em" }}>Aún no tienes atletas registrados.</div>
            ) : loadingStravaByAthlete ? (
              <div style={{ color: "#64748b", fontSize: ".86em" }}>Cargando conexiones de Strava…</div>
            ) : (
              <div style={{ display: "flex", flexDirection: "column", gap: 8 }}>
                {athletes.map((a) => {
                  const currentDeviceRaw = deviceOverrides[a.id] ?? a?.device ?? "";
                  const device = String(currentDeviceRaw).trim();
                  const stravaConn = a?.id ? stravaByUserId[a.id] : null;
                  const corosConnected = device.toLowerCase() === "coros";
                  const garminConnected = device.toLowerCase() === "garmin";
                  return (
                    <div key={a.id} style={{ border: "1px solid #e2e8f0", borderRadius: 10, padding: "10px 12px", background: "#f8fafc" }}>
                      <div style={{ color: "#0f172a", fontSize: ".84em", fontWeight: 700, marginBottom: 8 }}>{a.name || "Atleta"}</div>
                      <div style={{ display: "flex", flexDirection: "column", gap: 8, marginBottom: 8 }}>
                        <div style={{ display: "flex", alignItems: "center", justifyContent: "space-between", gap: 8, flexWrap: "wrap" }}>
                          <div style={{ fontSize: ".74em", color: "#0f172a", fontWeight: 700 }}>COROS</div>
                          {corosConnected ? (
                            <div style={{ display: "flex", alignItems: "center", gap: 8 }}>
                              <span style={{ background: "rgba(34,197,94,.14)", border: "1px solid rgba(34,197,94,.35)", borderRadius: 999, padding: "4px 9px", color: "#15803d", fontSize: ".72em", fontWeight: 700 }}>
                                ✅ Conectado
                              </span>
                              <button type="button" onClick={() => setAthleteDeviceConnection(a.id, null)} style={{ background: "#fef2f2", border: "1px solid #fecaca", borderRadius: 8, padding: "6px 9px", color: "#b91c1c", fontSize: ".72em", fontWeight: 700, cursor: "pointer", fontFamily: "inherit" }}>Desconectar</button>
                            </div>
                          ) : (
                            <button type="button" onClick={() => setCorosModalOpen(true)} style={{ background: "linear-gradient(135deg,#2563eb,#3b82f6)", border: "none", borderRadius: 8, padding: "6px 10px", color: "#fff", fontSize: ".72em", fontWeight: 700, cursor: "pointer", fontFamily: "inherit" }}>Conectar COROS</button>
                          )}
                        </div>
                        <div style={{ display: "flex", alignItems: "center", justifyContent: "space-between", gap: 8, flexWrap: "wrap" }}>
                          <div style={{ fontSize: ".74em", color: "#0f172a", fontWeight: 700 }}>Garmin</div>
                          {garminConnected ? (
                            <div style={{ display: "flex", alignItems: "center", gap: 8 }}>
                              <span style={{ background: "rgba(34,197,94,.14)", border: "1px solid rgba(34,197,94,.35)", borderRadius: 999, padding: "4px 9px", color: "#15803d", fontSize: ".72em", fontWeight: 700 }}>
                                ✅ Conectado
                              </span>
                              <button type="button" onClick={() => setAthleteDeviceConnection(a.id, null)} style={{ background: "#fef2f2", border: "1px solid #fecaca", borderRadius: 8, padding: "6px 9px", color: "#b91c1c", fontSize: ".72em", fontWeight: 700, cursor: "pointer", fontFamily: "inherit" }}>Desconectar</button>
                            </div>
                          ) : (
                            <button type="button" onClick={() => setGarminModalOpen(true)} style={{ background: "linear-gradient(135deg,#1d4ed8,#3b82f6)", border: "none", borderRadius: 8, padding: "6px 10px", color: "#fff", fontSize: ".72em", fontWeight: 700, cursor: "pointer", fontFamily: "inherit" }}>Conectar Garmin</button>
                          )}
                        </div>
                        <div style={{ display: "flex", alignItems: "center", justifyContent: "space-between", gap: 8, flexWrap: "wrap" }}>
                          <div style={{ fontSize: ".74em", color: "#0f172a", fontWeight: 700 }}>Strava</div>
                          {stravaConn ? (
                            <div style={{ display: "flex", alignItems: "center", gap: 8 }}>
                              <span style={{ background: "rgba(34,197,94,.14)", border: "1px solid rgba(34,197,94,.35)", borderRadius: 999, padding: "4px 9px", color: "#15803d", fontSize: ".72em", fontWeight: 700 }}>
                                ✅ Conectado
                              </span>
                              <button
                                type="button"
                                onClick={() => loadStravaActivitiesForAthlete(a.id, stravaConn.access_token)}
                                style={{ background: "#eff6ff", border: "1px solid #bfdbfe", borderRadius: 8, padding: "6px 9px", color: "#1d4ed8", fontSize: ".72em", fontWeight: 700, cursor: "pointer", fontFamily: "inherit" }}
                              >
                                {loadingActivitiesByAthlete[a.id] ? "Cargando..." : "Ver actividades"}
                              </button>
                              <button type="button" onClick={() => disconnectStravaForAthlete(a.id)} style={{ background: "#fef2f2", border: "1px solid #fecaca", borderRadius: 8, padding: "6px 9px", color: "#b91c1c", fontSize: ".72em", fontWeight: 700, cursor: "pointer", fontFamily: "inherit" }}>Desconectar</button>
                            </div>
                          ) : (
                            <button
                              type="button"
                              onClick={() => {
                                const authUrl = `https://www.strava.com/oauth/authorize?client_id=218467&redirect_uri=${encodeURIComponent(STRAVA_CALLBACK_URL)}&response_type=code&scope=activity:read_all&state=${encodeURIComponent(String(a.id))}`;
                                window.location.href = authUrl;
                              }}
                              style={{ background: "linear-gradient(135deg,#ea580c,#f97316)", border: "none", borderRadius: 8, padding: "6px 10px", color: "#fff", fontWeight: 800, cursor: "pointer", fontFamily: "inherit", fontSize: ".74em" }}
                            >
                              🟠 Conectar Strava
                            </button>
                          )}
                        </div>
                      </div>
                      <div style={{ display: "flex", justifyContent: "space-between", gap: 8, alignItems: "center", flexWrap: "wrap" }}>
                        <div style={{ color: "#64748b", fontSize: ".75em" }}>
                          {stravaConn?.strava_athlete_name ? `Cuenta: ${stravaConn.strava_athlete_name}` : "Sin cuenta Strava enlazada"}
                        </div>
                        <div style={{ color: "#94a3b8", fontSize: ".72em" }}>Atleta ID: {a.id}</div>
                      </div>
                      {Array.isArray(stravaActivitiesByAthlete[a.id]) && stravaActivitiesByAthlete[a.id].length > 0 ? (
                        <div style={{ marginTop: 10, display: "flex", flexDirection: "column", gap: 6 }}>
                          {stravaActivitiesByAthlete[a.id].map((act) => (
                            <div key={act.id} style={{ border: "1px solid #fed7aa", borderRadius: 8, padding: "8px 10px", background: "#fff7ed" }}>
                              <div style={{ color: "#9a3412", fontWeight: 700, fontSize: ".76em" }}>{act.name}</div>
                              <div style={{ color: "#7c2d12", fontSize: ".72em", marginTop: 2 }}>
                                {act.distanceKm.toFixed(2)} km · {formatDurationClock(act.movingTime)} · {act.pace}
                              </div>
                              <div style={{ color: "#9a3412", fontSize: ".7em", marginTop: 2 }}>
                                {act.dateIso ? new Date(act.dateIso).toLocaleDateString("es-CO", { day: "numeric", month: "short", year: "numeric" }) : "Fecha no disponible"}
                              </div>
                            </div>
                          ))}
                        </div>
                      ) : null}
                    </div>
                  );
                })}
              </div>
            )}
          </div>

          <div style={{ ...S.card, marginBottom: 18 }}>
            <div style={{ fontSize: ".72em", letterSpacing: ".12em", color: "#64748b", fontWeight: 700, marginBottom: 16 }}>
              SUSCRIPCIÓN
            </div>
            {athletePlanHint ? (
              <div style={{ fontSize: ".8em", color: "#64748b", marginBottom: 12 }}>
                Plan detectado en un atleta: <strong style={{ color: "#0f172a" }}>{athletePlanHint}</strong>
              </div>
            ) : null}
            {field(
              "Plan actual",
              <input
                value={form.subscription_plan}
                onChange={(e) => setForm((f) => ({ ...f, subscription_plan: e.target.value }))}
                placeholder="Starter, Pro, Equipo…"
                style={inputStyle}
              />,
            )}
            {field(
              "Fecha de renovación",
              <input type="date" value={form.subscription_renews_at} onChange={(e) => setForm((f) => ({ ...f, subscription_renews_at: e.target.value }))} style={inputStyle} />,
            )}
          </div>

          <button
            type="submit"
            disabled={saving}
            style={{
              padding: "12px 24px",
              borderRadius: 10,
              border: "none",
              background: saving ? "#e2e8f0" : "linear-gradient(135deg,#b45309,#f59e0b)",
              color: saving ? "#64748b" : "#fff",
              fontWeight: 800,
              cursor: saving ? "not-allowed" : "pointer",
              fontFamily: "inherit",
              marginBottom: 16,
            }}
          >
            {saving ? "Guardando…" : "Guardar cambios"}
          </button>
        </form>
      )}


      {/* ── PANEL STAFF ─────────────────────────────────────────── */}
      <div style={{ ...S.card, marginTop: 8 }}>
        <div style={{ fontSize: ".72em", letterSpacing: ".13em", color: "#475569", textTransform: "uppercase", marginBottom: 14 }}>
          Equipo de coaches (Staff)
        </div>
        <div style={{ fontSize: ".82em", color: "#64748b", marginBottom: 14, lineHeight: 1.5 }}>
          Agrega hasta 5 sub-coaches. Podran ver y gestionar solo los atletas que les asignes.
        </div>

        {/* Lista staff actual */}
        {staffList.length > 0 && (
          <div style={{ display: "flex", flexDirection: "column", gap: 8, marginBottom: 14 }}>
            {staffList.map((s) => (
              <div key={s.id} style={{ border: "1px solid #e2e8f0", borderRadius: 10, padding: "10px 12px", background: "#f8fafc" }}>
                <div style={{ display: "flex", alignItems: "center", justifyContent: "space-between", gap: 10, flexWrap: "wrap" }}>
                  <div>
                    <div style={{ fontWeight: 800, fontSize: ".88em", color: "#0f172a" }}>{s.staff_profile?.full_name || s.staff_profile?.name || "Sub-coach"}</div>
                    <div style={{ fontSize: ".72em", color: "#64748b", marginTop: 2 }}>{s.staff_profile?.email || "—"}</div>
                  </div>
                  <div style={{ display: "flex", gap: 8, alignItems: "center" }}>
                    <button type="button" onClick={() => openAssignAthletesModal(s)}
                      style={{ padding: "6px 12px", borderRadius: 8, border: "1px solid rgba(245,158,11,.4)", background: "rgba(245,158,11,.1)", color: "#b45309", fontWeight: 700, cursor: "pointer", fontFamily: "inherit", fontSize: ".72em" }}>
                      Atletas asignados ({s.assignedCount || 0})
                    </button>
                    <button type="button" onClick={() => removeStaff(s.staff_id)}
                      style={{ padding: "6px 10px", borderRadius: 8, border: "1px solid #fecaca", background: "#fef2f2", color: "#dc2626", fontWeight: 700, cursor: "pointer", fontFamily: "inherit", fontSize: ".72em" }}>
                      Revocar
                    </button>
                  </div>
                </div>
              </div>
            ))}
          </div>
        )}

        {staffList.length === 0 && (
          <div style={{ color: "#94a3b8", fontSize: ".84em", marginBottom: 14 }}>No tienes sub-coaches todavia.</div>
        )}

        {/* Invitar nuevo staff */}
        {staffList.length < 5 && (
          <div style={{ display: "flex", gap: 8, flexWrap: "wrap" }}>
            <input type="email" value={staffEmail} onChange={(e) => setStaffEmail(e.target.value)}
              placeholder="Email del sub-coach"
              style={{ flex: "1 1 200px", padding: "9px 12px", borderRadius: 8, border: "1px solid #e2e8f0", background: "#fff", color: "#0f172a", fontFamily: "inherit", fontSize: ".84em", boxSizing: "border-box" }} />
            <button type="button" onClick={sendStaffInvitation} disabled={staffInviteSending || !staffEmail.trim()}
              style={{ padding: "9px 16px", borderRadius: 8, border: "none", background: staffInviteSending || !staffEmail.trim() ? "#e2e8f0" : "linear-gradient(135deg,#0d9488,#14b8a6)", color: staffInviteSending || !staffEmail.trim() ? "#94a3b8" : "#fff", fontWeight: 800, cursor: staffInviteSending || !staffEmail.trim() ? "not-allowed" : "pointer", fontFamily: "inherit", fontSize: ".82em", whiteSpace: "nowrap" }}>
              {staffInviteSending ? "Enviando..." : "Invitar Staff"}
            </button>
          </div>
        )}
        {staffList.length >= 5 && (
          <div style={{ fontSize: ".78em", color: "#f59e0b", fontWeight: 700 }}>Limite de 5 sub-coaches alcanzado.</div>
        )}
      </div>

      {/* Modal asignar atletas a staff */}
      {assignModal && (
        <div style={{ position: "fixed", inset: 0, background: "rgba(15,23,42,.5)", zIndex: 10002, display: "flex", alignItems: "center", justifyContent: "center", padding: 16 }}>
          <div style={{ ...S.card, width: "100%", maxWidth: 480, margin: 0, maxHeight: "80vh", overflowY: "auto" }}>
            <div style={{ fontWeight: 900, fontSize: ".95em", color: "#0f172a", marginBottom: 6 }}>
              Atletas de {assignModal.staff_profile?.full_name || "sub-coach"}
            </div>
            <div style={{ fontSize: ".78em", color: "#64748b", marginBottom: 14 }}>
              Selecciona los atletas que puede gestionar este sub-coach.
            </div>
            <div style={{ display: "flex", flexDirection: "column", gap: 8, marginBottom: 14 }}>
              {(athletes || []).map((a) => {
                const assigned = assignedAthleteIds.has(String(a.id));
                return (
                  <div key={a.id} style={{ display: "flex", alignItems: "center", justifyContent: "space-between", padding: "10px 12px", borderRadius: 10, border: assigned ? "2px solid rgba(13,148,136,.4)" : "1px solid #e2e8f0", background: assigned ? "rgba(13,148,136,.05)" : "#fafafa" }}>
                    <div>
                      <div style={{ fontWeight: 700, fontSize: ".88em" }}>{a.name}</div>
                      <div style={{ fontSize: ".7em", color: "#64748b" }}>{a.goal}</div>
                    </div>
                    <button type="button" onClick={() => toggleAthleteAssignment(a.id, assigned)}
                      style={{ padding: "6px 12px", borderRadius: 8, border: "none", background: assigned ? "#fef2f2" : "linear-gradient(135deg,#0d9488,#14b8a6)", color: assigned ? "#dc2626" : "#fff", fontWeight: 700, cursor: "pointer", fontFamily: "inherit", fontSize: ".72em" }}>
                      {assigned ? "Quitar" : "Asignar"}
                    </button>
                  </div>
                );
              })}
            </div>
            <div style={{ display: "flex", justifyContent: "flex-end" }}>
              <button type="button" onClick={() => setAssignModal(null)}
                style={{ padding: "8px 16px", borderRadius: 8, border: "1px solid #e2e8f0", background: "#fff", color: "#475569", fontWeight: 700, cursor: "pointer", fontFamily: "inherit", fontSize: ".82em" }}>
                Cerrar
              </button>
            </div>
          </div>
        </div>
      )}


      <div style={{ ...S.card, marginTop: 8 }}>
        <button
          type="button"
          onClick={onSignOut}
          style={{
            width: "100%",
            padding: "12px 16px",
            borderRadius: 10,
            border: "1px solid #fecaca",
            background: "#fef2f2",
            color: "#dc2626",
            fontWeight: 800,
            cursor: "pointer",
            fontFamily: "inherit",
            fontSize: ".9em",
          }}
        >
          Cerrar sesión
        </button>
      </div>
    </div>
  );
}

export default CoachSettings;
