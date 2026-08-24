import { useState, useEffect, useMemo, useCallback, useRef } from "react";
import { supabase } from "../lib/supabase";
import { BRAND_NAME, sendAppEmail } from "./shared/appShared";
import DeleteAccountSection from "./DeleteAccountSection";
import ChangePasswordSection from "./ChangePasswordSection";

function CoachSettings({ coachUserId, sessionEmail, profileName, athletes, setAthletes, notify, onSignOut, styles, isStaff = false }) {
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
  const [coachRequests, setCoachRequests] = useState([]);
  const [requestsBusyId, setRequestsBusyId] = useState("");
  const [staffList, setStaffList] = useState([]);
  const [staffEmail, setStaffEmail] = useState("");
  const [staffInviteSending, setStaffInviteSending] = useState(false);
  const [assignModal, setAssignModal] = useState(null);
  const [assignedAthleteIds, setAssignedAthleteIds] = useState(new Set());
  const [allTeamAthletes, setAllTeamAthletes] = useState([]);
  const [athleteAssignmentMap, setAthleteAssignmentMap] = useState({});

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
    const rows = data || [];
    // El solicitante aun no esta en el roster (coach_id null): hay que leer
    // athletes por id, no buscar en la lista `athletes` del coach.
    const ids = [...new Set(rows.map((r) => r.athlete_id).filter(Boolean))];
    let byId = {};
    if (ids.length > 0) {
      const { data: athRows, error: athErr } = await supabase
        .from("athletes")
        .select("id, name, email")
        .in("id", ids);
      if (athErr) {
        console.error("Error cargando atletas de solicitudes:", athErr);
      } else {
        byId = Object.fromEntries((athRows || []).map((a) => [String(a.id), a]));
      }
    }
    setCoachRequests(
      rows.map((r) => {
        const a = byId[String(r.athlete_id)];
        return {
          ...r,
          athlete_name: a?.name || "",
          athlete_email: a?.email || "",
        };
      }),
    );
  }, [coachUserId]);

  useEffect(() => {
    loadCoachRequests();
  }, [loadCoachRequests]);

  const updateCoachRequestStatus = async (row, status) => {
    if (!row?.id || !coachUserId) return;
    setRequestsBusyId(row.id);
    const { data: reqRows, error } = await supabase
      .from("coach_requests")
      .update({ status })
      .eq("id", row.id)
      .eq("coach_id", coachUserId)
      .select("id");
    if (error) {
      console.error("Error actualizando solicitud:", error);
      notify(error.message || "No se pudo actualizar la solicitud");
      setRequestsBusyId("");
      return;
    }
    if (!(reqRows || []).length) {
      notify("No se actualizó la solicitud (sin permiso o ya no existe)");
      setRequestsBusyId("");
      return;
    }
    if (status === "accepted") {
      const { data: athleteRow } = await supabase.from("athletes").select("id, user_id").eq("id", row.athlete_id).maybeSingle();
      const { data: athleteUpdated, error: athleteErr } = await supabase
        .from("athletes")
        .update({ coach_id: coachUserId })
        .eq("id", row.athlete_id)
        .select("id");
      if (athleteErr) {
        console.error("Error vinculando atleta:", athleteErr);
        notify(athleteErr.message || "Solicitud aceptada, pero no se pudo vincular el atleta");
        setRequestsBusyId("");
        await loadCoachRequests();
        return;
      }
      if (!(athleteUpdated || []).length) {
        notify("Solicitud aceptada, pero no se vinculó el atleta (sin permiso sobre esa fila)");
        setRequestsBusyId("");
        await loadCoachRequests();
        return;
      }
      if (athleteRow?.user_id) {
        const { data: profileUpdated, error: profileErr } = await supabase
          .from("profiles")
          .update({ coach_id: coachUserId })
          .eq("user_id", athleteRow.user_id)
          .select("user_id");
        if (profileErr) {
          console.error("Error sincronizando profiles.coach_id:", profileErr);
          notify(`Atleta vinculado, pero el perfil no se sincronizó: ${profileErr.message}`);
        } else if (!(profileUpdated || []).length) {
          notify("Atleta vinculado, pero el perfil no se actualizó (sin permiso o sin fila)");
        }
      }
      if (typeof setAthletes === "function") {
        setAthletes((prev) => prev.map((a) => (String(a.id) === String(row.athlete_id) ? { ...a, coach_id: coachUserId } : a)));
      }
      notify("Solicitud aceptada");
    } else {
      notify(status === "rejected" ? "Solicitud rechazada" : "Solicitud actualizada");
    }
    await loadCoachRequests();
    setRequestsBusyId("");
  };

  // ── STAFF FUNCTIONS ─────────────────────────────────────────
  const loadStaff = useCallback(async () => {
    if (!coachUserId) return;
    const { data: staffRows } = await supabase.from("coach_staff").select("*, staff_profile:profiles!staff_id(name, email)").eq("coach_id", coachUserId);
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
      const { data: invRows, error: invErr } = await supabase
        .from("invitations")
        .insert({ coach_id: coachUserId, email, code, status: "pending", type: "staff" })
        .select("code");
      if (invErr) {
        console.error("Error creando invitacion staff:", invErr);
        notify(invErr.message || "No se pudo registrar la invitacion");
        return;
      }
      if (!(invRows || []).length) {
        notify("No se registró la invitacion (sin permiso)");
        return;
      }
      const mail = await sendAppEmail({
        template: "staff_invite",
        to: email,
        vars: { inviteLink },
      });
      if (!mail.ok) {
        notify("Invitacion registrada, pero el email no se pudo enviar. " + (mail.reason || ""));
        setStaffEmail("");
        loadStaff();
        return;
      }
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
    const { error: saErr } = await supabase
      .from("staff_athletes")
      .delete()
      .eq("staff_id", staffId)
      .eq("coach_id", coachUserId)
      .select("athlete_id");
    // Las asignaciones pueden ser 0; lo critico es borrar la membresia.
    if (saErr) {
      console.error("Error quitando asignaciones de staff:", saErr);
      notify(saErr.message || "No se pudieron quitar las asignaciones");
      return;
    }
    const { data: removed, error: csErr } = await supabase
      .from("coach_staff")
      .delete()
      .eq("staff_id", staffId)
      .eq("coach_id", coachUserId)
      .select("id");
    if (csErr) {
      console.error("Error removiendo sub-coach:", csErr);
      notify(csErr.message || "No se pudo remover al sub-coach");
      return;
    }
    if (!(removed || []).length) {
      notify("No se removió al sub-coach (sin permiso o ya no estaba en el equipo)");
      return;
    }
    notify("Sub-coach removido");
    loadStaff();
  };

  const openAssignAthletesModal = async (staffRow) => {
    setAssignModal(staffRow);
    const { data } = await supabase.from("staff_athletes").select("athlete_id").eq("staff_id", staffRow.staff_id).eq("coach_id", coachUserId);
    setAssignedAthleteIds(new Set((data || []).map((r) => String(r.athlete_id))));
    // Cargar solo los atletas del coach principal (todos le pertenecen)
    const { data: teamAthletes } = await supabase.from("athletes").select("id, name, goal").eq("coach_id", coachUserId).order("id", { ascending: true });
    setAllTeamAthletes(teamAthletes || []);
    // Cargar TODAS las asignaciones del equipo para saber que atleta esta con que staff
    const { data: allAssignments } = await supabase
      .from("staff_athletes")
      .select("athlete_id, staff_id")
      .eq("coach_id", coachUserId);
    const map = {};
    (allAssignments || []).forEach((r) => { map[String(r.athlete_id)] = r.staff_id; });
    setAthleteAssignmentMap(map);
  };

  const toggleAthleteAssignment = async (athleteId, isAssigned) => {
    if (!assignModal) return;
    if (isAssigned) {
      const { data: deleted, error } = await supabase
        .from("staff_athletes")
        .delete()
        .eq("staff_id", assignModal.staff_id)
        .eq("athlete_id", athleteId)
        .eq("coach_id", coachUserId)
        .select("athlete_id");
      if (error) {
        console.error("Error desasignando atleta:", error);
        notify(error.message || "No se pudo desasignar el atleta");
        return;
      }
      if (!(deleted || []).length) {
        notify("No se desasignó el atleta (sin permiso o ya no estaba asignado)");
        return;
      }
      setAssignedAthleteIds((prev) => { const next = new Set(prev); next.delete(String(athleteId)); return next; });
      setAthleteAssignmentMap((prev) => { const next = { ...prev }; delete next[String(athleteId)]; return next; });
    } else {
      const { data: inserted, error } = await supabase
        .from("staff_athletes")
        .insert({ staff_id: assignModal.staff_id, athlete_id: athleteId, coach_id: coachUserId })
        .select("athlete_id");
      if (error) {
        console.error("Error asignando atleta:", error);
        notify(error.message || "No se pudo asignar el atleta");
        return;
      }
      if (!(inserted || []).length) {
        notify("No se asignó el atleta (sin permiso)");
        return;
      }
      setAssignedAthleteIds((prev) => new Set([...prev, String(athleteId)]));
      setAthleteAssignmentMap((prev) => ({ ...prev, [String(athleteId)]: assignModal.staff_id }));
    }
    loadStaff();
  };

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
    // El nombre vive en dos sitios: coach_profiles.full_name (esta pantalla) y
    // profiles.name (lo que ve el atleta y lo que sale en el PDF del plan). Se
    // escriben los dos aqui o quedan desincronizados para siempre.
    const fullName = form.full_name.trim() || null;
    const payload = {
      user_id: coachUserId,
      avatar_url: form.avatar_url || null,
      full_name: fullName,
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
    // El .select() no es decorativo: un upsert bloqueado por RLS responde 200
    // con CERO filas, sin error. Sin comprobar las filas escritas dariamos
    // "Cambios guardados" sobre algo que no se guardo.
    const { data: savedCoachRows, error } = await supabase
      .from("coach_profiles")
      .upsert(payload, { onConflict: "user_id" })
      .select("user_id");
    if (error) {
      console.error(error);
      setSaving(false);
      notify(error.message || "Error al guardar");
      return;
    }
    if (!savedCoachRows?.length) {
      setSaving(false);
      notify("No se guardó el perfil: la base rechazó la escritura en coach_profiles (permisos)");
      return;
    }

    const { data: savedProfileRows, error: profileErr } = await supabase
      .from("profiles")
      .update({ name: fullName })
      .eq("user_id", coachUserId)
      .select("user_id");
    setSaving(false);
    if (profileErr) {
      console.error(profileErr);
      notify(`Perfil guardado, pero el nombre visible no se sincronizó: ${profileErr.message}`);
      return;
    }
    if (!savedProfileRows?.length) {
      notify("Perfil guardado, pero el nombre visible no se actualizó (sin permiso o sin fila en profiles)");
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
                  "Correo",
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
              Correos de nuevos entrenos
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
                    const displayName = (r.athlete_name || "").trim() || "Atleta";
                    const displayEmail = (r.athlete_email || "").trim();
                    return (
                      <div key={r.id} style={{ border: "1px solid #e2e8f0", borderRadius: 10, padding: "10px 12px", background: "#f8fafc", display: "flex", justifyContent: "space-between", gap: 10, alignItems: "center", flexWrap: "wrap" }}>
                        <div>
                          <div style={{ color: "#0f172a", fontWeight: 700, fontSize: ".82em" }}>{displayName}</div>
                          <div style={{ color: "#64748b", fontSize: ".72em" }}>{displayEmail || "Sin correo"}</div>
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
              background: saving ? "#e2e8f0" : "linear-gradient(135deg,#e86f28,#ff8a3d)",
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


      {/* ── PANEL STAFF (solo coach principal, no sub-coaches) ──── */}
      {!isStaff && (
      <div style={{ ...S.card, marginTop: 8 }}>
        <div style={{ fontSize: ".72em", letterSpacing: ".13em", color: "#475569", textTransform: "uppercase", marginBottom: 14 }}>
          Equipo de coaches
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
                    <div style={{ fontWeight: 800, fontSize: ".88em", color: "#0f172a" }}>{s.staff_profile?.name || "Sub-coach"}</div>
                    <div style={{ fontSize: ".72em", color: "#64748b", marginTop: 2 }}>{s.staff_profile?.email || "—"}</div>
                  </div>
                  <div style={{ display: "flex", gap: 8, alignItems: "center" }}>
                    <button type="button" onClick={() => openAssignAthletesModal(s)}
                      style={{ padding: "6px 12px", borderRadius: 8, border: "1px solid rgba(255,138,61,.4)", background: "rgba(255,138,61,.1)", color: "#b45309", fontWeight: 700, cursor: "pointer", fontFamily: "inherit", fontSize: ".72em" }}>
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
              placeholder="Correo del sub-coach"
              style={{ flex: "1 1 200px", padding: "9px 12px", borderRadius: 8, border: "1px solid #e2e8f0", background: "#fff", color: "#0f172a", fontFamily: "inherit", fontSize: ".84em", boxSizing: "border-box" }} />
            <button type="button" onClick={sendStaffInvitation} disabled={staffInviteSending || !staffEmail.trim()}
              style={{ padding: "9px 16px", borderRadius: 8, border: "none", background: staffInviteSending || !staffEmail.trim() ? "#e2e8f0" : "linear-gradient(135deg,#0d9488,#14b8a6)", color: staffInviteSending || !staffEmail.trim() ? "#94a3b8" : "#fff", fontWeight: 800, cursor: staffInviteSending || !staffEmail.trim() ? "not-allowed" : "pointer", fontFamily: "inherit", fontSize: ".82em", whiteSpace: "nowrap" }}>
{staffInviteSending ? "Enviando..." : "Invitar al equipo"}
            </button>
          </div>
        )}
        {staffList.length >= 5 && (
          <div style={{ fontSize: ".78em", color: "#ff8a3d", fontWeight: 700 }}>Limite de 5 sub-coaches alcanzado.</div>
        )}
      </div>
      )}

      {/* Modal asignar atletas a staff */}
      {assignModal && (
        <div style={{ position: "fixed", inset: 0, background: "rgba(15,23,42,.5)", zIndex: 10002, display: "flex", alignItems: "center", justifyContent: "center", padding: 16 }}>
          <div style={{ ...S.card, width: "100%", maxWidth: 480, margin: 0, maxHeight: "80vh", overflowY: "auto" }}>
            <div style={{ fontWeight: 900, fontSize: ".95em", color: "#0f172a", marginBottom: 6 }}>
              Atletas de {assignModal.staff_profile?.name || "sub-coach"}
            </div>
            <div style={{ fontSize: ".78em", color: "#64748b", marginBottom: 14 }}>
              Selecciona los atletas que puede gestionar este sub-coach.
            </div>
            <div style={{ display: "flex", flexDirection: "column", gap: 8, marginBottom: 14 }}>
              {(allTeamAthletes.length > 0 ? allTeamAthletes : (athletes || [])).map((a) => {
                const assigned = assignedAthleteIds.has(String(a.id));
                const assignedToOther = !assigned && athleteAssignmentMap[String(a.id)] && athleteAssignmentMap[String(a.id)] !== assignModal.staff_id;
                const otherStaffName = assignedToOther
                  ? (staffList.find((s) => s.staff_id === athleteAssignmentMap[String(a.id)])?.staff_profile?.name || "otro sub-coach")
                  : "";
                return (
                  <div key={a.id} style={{ display: "flex", alignItems: "center", justifyContent: "space-between", padding: "10px 12px", borderRadius: 10, border: assigned ? "2px solid rgba(13,148,136,.4)" : "1px solid #e2e8f0", background: assignedToOther ? "#f1f5f9" : (assigned ? "rgba(13,148,136,.05)" : "#fafafa"), opacity: assignedToOther ? 0.65 : 1 }}>
                    <div>
                      <div style={{ fontWeight: 700, fontSize: ".88em" }}>{a.name}</div>
                      <div style={{ fontSize: ".7em", color: "#64748b" }}>{assignedToOther ? "Asignado a " + otherStaffName : a.goal}</div>
                    </div>
                    {assignedToOther ? (
                      <span style={{ padding: "6px 12px", borderRadius: 8, background: "#e2e8f0", color: "#94a3b8", fontWeight: 700, fontFamily: "inherit", fontSize: ".72em", whiteSpace: "nowrap" }}>
                        No disponible
                      </span>
                    ) : (
                      <button type="button" onClick={() => toggleAthleteAssignment(a.id, assigned)}
                        style={{ padding: "6px 12px", borderRadius: 8, border: "none", background: assigned ? "#fef2f2" : "linear-gradient(135deg,#0d9488,#14b8a6)", color: assigned ? "#dc2626" : "#fff", fontWeight: 700, cursor: "pointer", fontFamily: "inherit", fontSize: ".72em" }}>
                        {assigned ? "Quitar" : "Asignar"}
                      </button>
                    )}
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



      {/* ── PANEL BILLING STAFF ──────────────────────────────────── */}
      {staffList.length > 0 && (
        <div style={{ ...S.card, marginTop: 8 }}>
          <div style={{ fontSize: ".72em", letterSpacing: ".13em", color: "#475569", textTransform: "uppercase", marginBottom: 14 }}>
            Facturación del equipo
          </div>
          <div style={{ fontSize: ".82em", color: "#64748b", marginBottom: 14, lineHeight: 1.5 }}>
            Tienes <strong style={{ color: "#0f172a" }}>{staffList.length} de 5</strong> sub-coaches activos. Su acceso va incluido en tu plan.
          </div>
          <div style={{ display: "flex", flexDirection: "column", gap: 8 }}>
            {staffList.map((s) => (
              <div key={s.id} style={{ display: "flex", alignItems: "center", justifyContent: "space-between", padding: "10px 14px", borderRadius: 10, border: "1px solid #e2e8f0", background: "#f8fafc", flexWrap: "wrap", gap: 8 }}>
                <div>
                  <div style={{ fontWeight: 800, fontSize: ".88em", color: "#0f172a" }}>{s.staff_profile?.name || "Sub-coach"}</div>
                  <div style={{ fontSize: ".72em", color: "#64748b", marginTop: 2 }}>{s.staff_profile?.email || "—"} · {s.assignedCount || 0} atletas asignados</div>
                </div>
                <div style={{ display: "flex", alignItems: "center", gap: 8 }}>
                  <span style={{ fontSize: ".68em", fontWeight: 800, color: "#166534", background: "#dcfce7", border: "1px solid #86efac", borderRadius: 999, padding: "4px 10px" }}>
                    Incluido en tu plan
                  </span>
                  <select
                    value={s.billingType || "included"}
                    onChange={async (e) => {
                      const nextBilling = e.target.value;
                      const { data: updated, error } = await supabase
                        .from("coach_staff")
                        .update({ billing_type: nextBilling })
                        .eq("id", s.id)
                        .eq("coach_id", coachUserId)
                        .select("id");
                      if (error) {
                        console.error("Error actualizando billing:", error);
                        notify(error.message || "No se pudo actualizar la facturación");
                        return;
                      }
                      if (!(updated || []).length) {
                        notify("No se actualizó la facturación (sin permiso sobre esa fila)");
                        return;
                      }
                      loadStaff();
                      notify("Facturación actualizada");
                    }}
                    style={{ padding: "5px 8px", borderRadius: 8, border: "1px solid #e2e8f0", background: "#fff", fontFamily: "inherit", fontSize: ".72em", color: "#334155", cursor: "pointer" }}
                  >
                    <option value="included">Incluido en mi plan</option>
                    <option value="separate">Pago separado</option>
                  </select>
                </div>
              </div>
            ))}
          </div>
          <div style={{ marginTop: 12, padding: "10px 14px", borderRadius: 10, background: "rgba(255,138,61,.06)", border: "1px solid rgba(255,138,61,.2)", fontSize: ".78em", color: "#92400e", lineHeight: 1.5 }}>
            💡 <strong>Pago separado:</strong> El sub-coach debe adquirir su propio plan. <strong>Incluido:</strong> Su acceso va cubierto por tu suscripcion actual sin costo adicional.
          </div>
        </div>
      )}

      <ChangePasswordSection notify={notify} cardStyle={S.card} />

      <DeleteAccountSection notify={notify} cardStyle={S.card} />

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
