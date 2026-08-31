import { useState, useEffect, useCallback } from "react";
import { supabase } from "../lib/supabase";
import {
  PLATFORM_ADMIN_USER_ID,
  formatLocalYMD,
  addDays,
  nextWeekMondayToSundayYmd,
  firstDayOfNextMonthYmd,
  lastDayOfNextMonthYmd,
  CHALLENGE_TYPE_OPTIONS,
  normalizeChallengeType,
  computeChallengeProgressForAthlete,
  challengeHasOpenTarget,
  challengeValueLabel,
  challengeProgressOpenText,
  challengeProgressLabel,
  extractJsonFromAnthropicText,
  extractAnthropicTextContent,
  authApiFetch,
  userFacingError,
  normalizeWorkoutRow,
} from "./shared/appShared";

function ChallengesHub({
  profileRole,
  currentUserId,
  athleteId = null,
  athleteCoachId = null,
  workouts = [],
  coachAthletes = [],
  notify,
  styles,
  normalizeWorkoutRow: normalizeWorkoutRowProp,
  isAthlete: isAthleteProp,
}) {
  const normalizeRow = normalizeWorkoutRowProp || normalizeWorkoutRow;
  const S = styles;
  const isAdmin = profileRole === "admin" || String(currentUserId || "") === PLATFORM_ADMIN_USER_ID;
  const isAthlete = Boolean(isAthleteProp) || profileRole === "athlete";
  const canCreateChallenge = isAdmin || (profileRole === "coach" && !isAthlete);
  const canManageChallenge = (c) =>
    Boolean(c) && (isAdmin || (c.coach_id != null && String(c.coach_id) === String(currentUserId || "")));
  const rosterAthleteIds = new Set((coachAthletes || []).map((a) => String(a?.id ?? "")).filter(Boolean));
  // Reto de equipo: el ranking solo muestra atletas de ese coach.
  // coachAthletes es el roster del usuario actual — aplicamos el filtro cuando
  // es el dueño del reto (o admin con roster). Sin roster no recortamos a [].
  const visibleParticipants = (challenge, list) => {
    const rows = Array.isArray(list) ? list : [];
    if (!challenge?.coach_id || !rosterAthleteIds.size) return rows;
    // coachAthletes es el roster del usuario logueado: solo recorta si es el dueño.
    if (String(challenge.coach_id) !== String(currentUserId || "")) return rows;
    return rows.filter((p) => rosterAthleteIds.has(String(p.athlete_id)));
  };
  const isVisibleChallenge = (c) => {
    if (isAdmin) return true;
    if (c?.coach_id == null || c.coach_id === "") return true;
    if (String(c.coach_id) === String(currentUserId || "")) return true;
    if (isAthlete && athleteCoachId && String(c.coach_id) === String(athleteCoachId)) return true;
    return false;
  };
  const [rows, setRows] = useState([]);
  const [loading, setLoading] = useState(true);
  const [participantsByChallenge, setParticipantsByChallenge] = useState({});
  const [myChallengeIds, setMyChallengeIds] = useState(() => new Set());
  const [joiningChallengeId, setJoiningChallengeId] = useState("");
  const [showCreate, setShowCreate] = useState(false);
  const [showAiGenerateModal, setShowAiGenerateModal] = useState(false);
  const [aiContextPrompt, setAiContextPrompt] = useState("");
  const [aiGenerating, setAiGenerating] = useState(false);
  const [savingCreate, setSavingCreate] = useState(false);
  const [deletingId, setDeletingId] = useState("");
  const [renewingId, setRenewingId] = useState("");
  const [updatingRecurrenceId, setUpdatingRecurrenceId] = useState("");
  const [workoutsByAthlete, setWorkoutsByAthlete] = useState({});
  const [participantsModalChallenge, setParticipantsModalChallenge] = useState(null);
  const [form, setForm] = useState({
    title: "",
    description: "",
    challenge_type: "distancia",
    target_value: "",
    unit: "km",
    start_date: formatLocalYMD(new Date()),
    end_date: formatLocalYMD(addDays(new Date(), 30)),
    emoji: "🏁",
    color: "#a855f7",
    is_recurring: false,
    recurrence: "monthly",
  });

  const getWorkoutsForChallengeParticipant = useCallback(
    (participant) => {
      if (participant?.athlete_id != null && String(participant.athlete_id).trim() !== "") {
        return workoutsByAthlete[String(participant.athlete_id)] || [];
      }
      const uid = String(participant?.user_id || "").trim();
      if (uid) {
        const row = (coachAthletes || []).find((a) => String(a.user_id || "") === uid);
        if (row?.id != null) return workoutsByAthlete[String(row.id)] || [];
      }
      return [];
    },
    [workoutsByAthlete, coachAthletes],
  );

  const loadChallenges = useCallback(async () => {
    setLoading(true);
    const today = formatLocalYMD(new Date());
    const challengesQuery = supabase.from("challenges").select("*").eq("is_active", true);
    const challengesReq = isAdmin
      ? challengesQuery.order("end_date", { ascending: true })
      : challengesQuery.gte("end_date", today).order("end_date", { ascending: true });
    const [challengesRes, participantsRes] = await Promise.all([challengesReq, supabase.from("challenge_participants").select("*")]);
    const { data, error } = challengesRes;
    if (error) {
      console.error("load challenges:", error);
      notify?.(userFacingError(error, "No se pudieron cargar los retos"));
      setRows([]);
      setLoading(false);
      return;
    }
    const list = (Array.isArray(data) ? data : []).filter(isVisibleChallenge);
    setRows(list);
    const ids = list.map((c) => c.id).filter(Boolean);
    if (ids.length === 0) {
      setParticipantsByChallenge({});
      setMyChallengeIds(new Set());
      setWorkoutsByAthlete({});
      setLoading(false);
      return;
    }
    if (participantsRes.error) {
      console.error("load challenge_participants:", participantsRes.error);
    }
    const idSet = new Set(ids.map((id) => String(id)));
    const allParticipants = Array.isArray(participantsRes.data) ? participantsRes.data : [];
    const participants = allParticipants.filter((p) => idSet.has(String(p.challenge_id)));
    const userIds = [...new Set(participants.map((p) => p.user_id).filter(Boolean))];
    const coachAthleteRows = Array.isArray(coachAthletes) ? coachAthletes : [];
    const resolveParticipantAthleteIdForLoad = (p) => {
      if (p?.athlete_id != null && String(p.athlete_id).trim() !== "") return String(p.athlete_id);
      const uid = String(p?.user_id || "").trim();
      if (!uid) return null;
      const row = coachAthleteRows.find((a) => String(a.user_id || "") === uid);
      return row?.id != null ? String(row.id) : null;
    };
    const athleteIds = [...new Set(participants.map((p) => resolveParticipantAthleteIdForLoad(p)).filter(Boolean))];
    const profileNameByUserId = {};
    const athleteNameById = {};
    const dateRangeStart = list
      .map((c) => String(c.start_date || ""))
      .filter(Boolean)
      .sort()[0];
    const dateRangeEnd = [...list.map((c) => String(c.end_date || "")).filter(Boolean)].sort().slice(-1)[0];
    const workoutsQueryBase =
      athleteIds.length > 0
        ? supabase
            .from("workouts")
            .select("id,athlete_id,scheduled_date,total_km,duration_min,done")
            .eq("done", true)
            .in("athlete_id", athleteIds)
        : null;
    const workoutsPromise =
      workoutsQueryBase == null
        ? Promise.resolve({ data: [], error: null })
        : dateRangeStart && dateRangeEnd
          ? workoutsQueryBase.gte("scheduled_date", dateRangeStart).lte("scheduled_date", dateRangeEnd)
          : workoutsQueryBase;
    const profilesPromise =
      userIds.length > 0
        ? supabase.from("user_names").select("user_id,name").in("user_id", userIds)
        : Promise.resolve({ data: [], error: null });
    const athletesPromise =
      athleteIds.length > 0
        ? supabase.from("athletes").select("id,name").in("id", athleteIds)
        : Promise.resolve({ data: [], error: null });
    const [profilesRes, athletesRes, workoutsRes] = await Promise.all([profilesPromise, athletesPromise, workoutsPromise]);
    if (profilesRes.error) {
      console.error("load participant profiles:", profilesRes.error);
    } else {
      for (const row of profilesRes.data || []) {
        profileNameByUserId[String(row.user_id)] = String(row.name || "").trim();
      }
    }
    if (athletesRes.error) {
      console.error("load participant athletes:", athletesRes.error);
    } else {
      for (const row of athletesRes.data || []) {
        athleteNameById[String(row.id)] = String(row.name || "").trim();
      }
    }
    let workoutsMap = {};
    if (workoutsRes.error) {
      console.error("load challenge workouts:", workoutsRes.error);
    } else {
      for (const row of workoutsRes.data || []) {
        const aid = String(row.athlete_id);
        if (!workoutsMap[aid]) workoutsMap[aid] = [];
        workoutsMap[aid].push(normalizeRow(row));
      }
    }
    const grouped = {};
    const mine = new Set();
    for (const p of participants) {
      const cid = p.challenge_id;
      if (!grouped[cid]) grouped[cid] = [];
      const profileName = profileNameByUserId[String(p.user_id)] || "";
      const resolvedAid = resolveParticipantAthleteIdForLoad(p);
      const athleteName = resolvedAid ? athleteNameById[resolvedAid] || "" : "";
      const displayName = profileName || athleteName || "Participante";
      const initials =
        displayName
          .split(/\s+/)
          .filter(Boolean)
          .slice(0, 2)
          .map((chunk) => chunk[0])
          .join("")
          .toUpperCase() || "P";
      grouped[cid].push({ ...p, displayName, initials });
      if (
        String(p.user_id || "") === String(currentUserId || "") ||
        (athleteId != null && String(p.athlete_id || "") === String(athleteId))
      ) {
        mine.add(String(cid));
      }
    }
    setParticipantsByChallenge(grouped);
    setWorkoutsByAthlete(workoutsMap);
    setMyChallengeIds(mine);
    setLoading(false);
  }, [notify, currentUserId, athleteId, athleteCoachId, coachAthletes, isAdmin, isAthlete]);

  useEffect(() => {
    loadChallenges();
  }, [loadChallenges]);

  const joinChallenge = async (challengeId) => {
    if (!currentUserId || !athleteId) return;
    setJoiningChallengeId(String(challengeId));
    const { error } = await supabase.from("challenge_participants").insert({
      challenge_id: challengeId,
      user_id: currentUserId,
      athlete_id: athleteId,
    });
    setJoiningChallengeId("");
    if (error) {
      notify?.(userFacingError(error, "No se pudo unir al reto"));
      return;
    }
    notify?.("Te uniste al reto ✅");
    loadChallenges();
  };

  const createChallenge = async () => {
    if (!canCreateChallenge || !currentUserId) return;
    const title = form.title.trim();
    const isDist = form.challenge_type === "distancia";
    const targetRaw = String(form.target_value ?? "").trim();
    const targetParsed = targetRaw === "" ? NaN : Number(targetRaw);
    if (!title || !form.start_date || !form.end_date) {
      notify?.("Completa título y rango de fechas.");
      return;
    }
    let target = 0;
    if (isDist) {
      if (targetRaw === "") {
        target = 0;
      } else if (!Number.isFinite(targetParsed) || targetParsed < 0) {
        notify?.("Indica la meta en km (≥ 0) o déjala vacía para ranking sin meta fija.");
        return;
      } else {
        target = targetParsed;
      }
    } else {
      target = Number(form.target_value);
      if (!Number.isFinite(target) || target <= 0) {
        notify?.("Indica una meta numérica válida.");
        return;
      }
    }
    setSavingCreate(true);
    const unitOut = isDist ? "km" : String(form.unit || "").trim() || null;
    const { error } = await supabase.from("challenges").insert({
      title,
      description: form.description.trim() || null,
      challenge_type: form.challenge_type,
      target_value: target,
      unit: unitOut,
      start_date: form.start_date,
      end_date: form.end_date,
      emoji: form.emoji.trim() || "🏁",
      color: form.color || "#a855f7",
      created_by: isAdmin ? PLATFORM_ADMIN_USER_ID : currentUserId,
      coach_id: isAdmin ? null : currentUserId,
      is_active: true,
      is_recurring: Boolean(form.is_recurring),
      recurrence: form.is_recurring ? (form.recurrence === "weekly" ? "weekly" : "monthly") : null,
    });
    setSavingCreate(false);
    if (error) {
      notify?.(userFacingError(error, "No se pudo crear el reto"));
      return;
    }
    setShowCreate(false);
    setForm((prev) => ({
      ...prev,
      title: "",
      description: "",
      target_value: "",
      is_recurring: false,
      recurrence: "monthly",
    }));
    notify?.("Reto creado ✅");
    loadChallenges();
  };

  const renewChallengeForNextPeriod = async (c) => {
    if (!canManageChallenge(c)) return;
    const today = formatLocalYMD(new Date());
    const endYmd = String(c.end_date || "").slice(0, 10);
    if (!endYmd || endYmd >= today) return;
    setRenewingId(String(c.id));
    const recurrence = String(c.recurrence || "monthly").toLowerCase() === "weekly" ? "weekly" : "monthly";
    const nextIsRecurring = Boolean(c.is_recurring);
    let start_date;
    let end_date;
    let periodNotifySuffix;
    if (recurrence === "weekly") {
      const w = nextWeekMondayToSundayYmd();
      start_date = w.start;
      end_date = w.end;
      periodNotifySuffix = "la próxima semana";
    } else {
      start_date = firstDayOfNextMonthYmd();
      end_date = lastDayOfNextMonthYmd();
      const d0 = new Date(`${start_date}T12:00:00`);
      periodNotifySuffix = Number.isNaN(d0.getTime())
        ? "el próximo mes"
        : d0.toLocaleDateString("es-CO", { month: "long", year: "numeric" });
    }
    const { data: created, error: insErr } = await supabase
      .from("challenges")
      .insert({
        title: c.title,
        description: c.description ?? null,
        challenge_type: c.challenge_type,
        target_value: c.target_value,
        unit: c.unit ?? null,
        start_date,
        end_date,
        emoji: c.emoji ?? "🏁",
        color: c.color ?? "#a855f7",
        created_by: isAdmin ? PLATFORM_ADMIN_USER_ID : currentUserId,
        coach_id: c.coach_id ?? (isAdmin ? null : currentUserId),
        is_active: true,
        is_recurring: nextIsRecurring,
        recurrence: nextIsRecurring ? recurrence : null,
      })
      .select("id")
      .maybeSingle();
    if (insErr) {
      setRenewingId("");
      notify?.(insErr.message || "No se pudo renovar el reto.");
      return;
    }
    if (!created?.id) {
      setRenewingId("");
      notify?.("No se pudo crear el reto renovado.");
      return;
    }
    const { error: deactErr } = await supabase.from("challenges").update({ is_active: false }).eq("id", c.id);
    setRenewingId("");
    if (deactErr) {
      notify?.("Reto nuevo creado, pero no se pudo archivar el anterior: " + (deactErr.message || ""));
      loadChallenges();
      return;
    }
    notify?.(`Reto renovado para ${periodNotifySuffix} ✅`);
    loadChallenges();
  };

  const applyAiChallengeDraftToForm = (draft) => {
    const typeRaw = String(draft?.type || "").trim().toLowerCase();
    const mappedType =
      typeRaw === "distance"
        ? "distancia"
        : typeRaw === "time"
          ? "tiempo"
          : typeRaw === "workouts"
            ? "workouts"
            : typeRaw === "streak"
              ? "racha"
              : "distancia";
    const unitRaw = String(draft?.goal_unit || "").trim().toLowerCase();
    const mappedUnit =
      unitRaw === "sesiones" ? "sesiones" : unitRaw === "días" ? "días" : unitRaw || (mappedType === "distancia" ? "km" : mappedType === "tiempo" ? "min" : "");
    const durationDays = Math.max(7, Math.min(30, Math.round(Number(draft?.duration_days) || 14)));
    const start = new Date();
    const end = addDays(start, durationDays);
    const goalNum = Number(draft?.goal_value);
    const distOpen =
      mappedType === "distancia" && (!Number.isFinite(goalNum) || goalNum <= 0);
    const targetValueStr =
      mappedType === "distancia" ? (distOpen ? "0" : String(Math.max(0, goalNum))) : String(Number.isFinite(goalNum) && goalNum > 0 ? goalNum : "");
    setForm((prev) => ({
      ...prev,
      title: String(draft?.title || "").trim(),
      description: String(draft?.description || "").trim(),
      challenge_type: mappedType,
      target_value: targetValueStr,
      unit: mappedUnit,
      start_date: formatLocalYMD(start),
      end_date: formatLocalYMD(end),
      emoji: String(draft?.badge_emoji || "🏁").trim() || "🏁",
      color: String(draft?.badge_color || "#a855f7").trim() || "#a855f7",
      is_recurring: prev.is_recurring,
      recurrence: prev.recurrence,
    }));
    setShowCreate(true);
  };

  const generateChallengeWithAi = async () => {
    if (!isAdmin) return;
    if (!aiContextPrompt.trim()) {
      notify?.("Escribe un contexto para generar el reto.");
      return;
    }
    setAiGenerating(true);
    try {
      const system = `Eres un experto en coaching de running. Genera un reto de running motivador para una plataforma de coaching.
Responde SOLO con un JSON con esta estructura exacta, sin texto adicional:
{
  "title": "título corto y motivador del reto",
  "description": "descripción del reto en 1-2 oraciones que motive a participar",
  "type": "distance" | "time" | "workouts" | "streak",
  "goal_value": número,
  "goal_unit": "km" | "min" | "sesiones" | "días",
  "duration_days": número de días que dura el reto (entre 7 y 30),
  "badge_emoji": un emoji representativo,
  "badge_color": color hex motivador
}
Reglas adicionales:
- Si el reto es de distancia (type "distance") SIN meta fija (el usuario pide competir por km acumulados, ranking, "quien más corre", sin número objetivo), entonces usa goal_value: 0, goal_unit: "km", y en description aclara que gana quien acumule más kilómetros en el periodo del reto (ranking por km).`;
      const res = await authApiFetch("/api/generate-workout", {
        method: "POST",
        body: JSON.stringify({
          model: "claude-sonnet-5",
          max_tokens: 8000,
          thinking: { type: "disabled" },
          system,
          messages: [{ role: "user", content: aiContextPrompt.trim() }],
        }),
      });
      const data = await res.json();
      if (!res.ok) {
        notify?.(data?.error || "Error al generar reto con IA.");
        return;
      }
      const text = extractAnthropicTextContent(data.content, "[challenge-ia]");
      if (!text) {
        console.error("[challenge-ia] stop_reason:", data?.stop_reason);
        notify?.("La IA no devolvió texto usable.");
        return;
      }
      const parsed = extractJsonFromAnthropicText(text);
      if (!parsed || typeof parsed !== "object") {
        notify?.("La IA no devolvió un JSON válido.");
        return;
      }
      applyAiChallengeDraftToForm(parsed);
      setShowAiGenerateModal(false);
      notify?.("Reto generado con IA. Revisa y guarda cuando quieras.");
    } catch (e) {
      console.error("generate challenge ai:", e);
      notify?.("No se pudo generar el reto con IA.");
    } finally {
      setAiGenerating(false);
    }
  };

  const deleteChallenge = async (challengeId) => {
    const target = rows.find((r) => String(r.id) === String(challengeId));
    if (!canManageChallenge(target)) return;
    if (typeof window !== "undefined" && !window.confirm("¿Eliminar este reto?")) return;
    setDeletingId(String(challengeId));
    const { error } = await supabase.from("challenges").delete().eq("id", challengeId);
    setDeletingId("");
    if (error) {
      notify?.(userFacingError(error, "No se pudo eliminar el reto"));
      return;
    }
    notify?.("Reto eliminado");
    loadChallenges();
  };

  /** Admin: No recurrente | Semanal | Mensual → is_recurring + recurrence */
  const updateChallengeRecurrence = async (challengeId, mode) => {
    const target = rows.find((r) => String(r.id) === String(challengeId));
    if (!canManageChallenge(target)) return;
    const value = String(mode || "none");
    const patch =
      value === "weekly"
        ? { is_recurring: true, recurrence: "weekly" }
        : value === "monthly"
          ? { is_recurring: true, recurrence: "monthly" }
          : { is_recurring: false, recurrence: null };
    setUpdatingRecurrenceId(String(challengeId));
    const { error } = await supabase.from("challenges").update(patch).eq("id", challengeId);
    setUpdatingRecurrenceId("");
    if (error) {
      notify?.(userFacingError(error, "No se pudo actualizar la recurrencia"));
      return;
    }
    notify?.(
      value === "weekly"
        ? "Recurrencia: semanal ✅"
        : value === "monthly"
          ? "Recurrencia: mensual ✅"
          : "Reto marcado como no recurrente",
    );
    loadChallenges();
  };

  const recurrenceSelectValue = (c) => {
    if (!c?.is_recurring) return "none";
    return String(c.recurrence || "").toLowerCase() === "weekly" ? "weekly" : "monthly";
  };

  return (
    <div style={{ ...S.card, marginBottom: 18 }}>
      <div style={{ display: "flex", alignItems: "center", justifyContent: "space-between", gap: 12, flexWrap: "wrap", marginBottom: 12 }}>
        <div>
          <div style={{ fontSize: "1.1em", fontWeight: 900, color: "#0f172a" }}>🏆 Retos</div>
          <div style={{ color: "#64748b", fontSize: ".8em", marginTop: 3 }}>Retos activos de la comunidad</div>
        </div>
        {canCreateChallenge ? (
          <div style={{ display: "flex", gap: 8, flexWrap: "wrap" }}>
            {isAdmin ? (
              <button
                type="button"
                onClick={() => setShowAiGenerateModal(true)}
                style={{ background: "linear-gradient(135deg,#0ea5e9,#6366f1)", border: "none", borderRadius: 10, padding: "9px 14px", color: "#fff", fontWeight: 800, fontFamily: "inherit", cursor: "pointer", fontSize: ".78em" }}
              >
                ✨ Generar con IA
              </button>
            ) : null}
            <button
              type="button"
              onClick={() => setShowCreate((v) => !v)}
              style={{ background: "linear-gradient(135deg,#7c3aed,#a855f7)", border: "none", borderRadius: 10, padding: "9px 14px", color: "#fff", fontWeight: 800, fontFamily: "inherit", cursor: "pointer", fontSize: ".78em" }}
            >
              ➕ Crear reto
            </button>
          </div>
        ) : null}
      </div>

      {isAdmin && showAiGenerateModal ? (
        <div style={{ position: "fixed", inset: 0, zIndex: 10020, background: "rgba(15,23,42,.55)", display: "flex", alignItems: "center", justifyContent: "center", padding: 16 }}>
          <div style={{ ...S.card, width: "100%", maxWidth: 560, margin: 0 }}>
            <div style={{ fontSize: "1.02em", fontWeight: 900, color: "#0f172a", marginBottom: 8 }}>✨ Generar reto con IA</div>
            <div style={{ color: "#64748b", fontSize: ".82em", marginBottom: 10 }}>
              Describe el contexto del reto y la IA pre-rellenará el formulario de creación.
            </div>
            <textarea
              rows={4}
              value={aiContextPrompt}
              onChange={(e) => setAiContextPrompt(e.target.value)}
              placeholder='Ej: "Reto de abril para motivar corredores principiantes"'
              style={{ width: "100%", border: "1px solid #dbe2ea", borderRadius: 8, padding: "10px 12px", fontFamily: "inherit", boxSizing: "border-box" }}
            />
            <div style={{ display: "flex", justifyContent: "flex-end", gap: 8, marginTop: 12 }}>
              <button type="button" disabled={aiGenerating} onClick={() => setShowAiGenerateModal(false)} style={{ border: "1px solid #e2e8f0", background: "#fff", borderRadius: 8, padding: "8px 12px", color: "#475569", fontFamily: "inherit", fontWeight: 700, cursor: aiGenerating ? "not-allowed" : "pointer", fontSize: ".78em" }}>
                Cerrar
              </button>
              <button type="button" disabled={aiGenerating} onClick={generateChallengeWithAi} style={{ border: "none", background: aiGenerating ? "#cbd5e1" : "linear-gradient(135deg,#0ea5e9,#6366f1)", borderRadius: 8, padding: "8px 12px", color: "#fff", fontFamily: "inherit", fontWeight: 800, cursor: aiGenerating ? "not-allowed" : "pointer", fontSize: ".78em" }}>
                {aiGenerating ? "Generando…" : "Confirmar"}
              </button>
            </div>
          </div>
        </div>
      ) : null}

      {canCreateChallenge && showCreate ? (
        <div style={{ border: "1px solid #e2e8f0", borderRadius: 12, padding: 14, background: "#f8fafc", marginBottom: 14 }}>
          <div style={{ display: "grid", gridTemplateColumns: "repeat(auto-fit,minmax(160px,1fr))", gap: 10 }}>
            <input value={form.title} onChange={(e) => setForm((f) => ({ ...f, title: e.target.value }))} placeholder="Título" style={{ border: "1px solid #dbe2ea", borderRadius: 8, padding: "8px 10px", fontFamily: "inherit" }} />
            <select value={form.challenge_type} onChange={(e) => setForm((f) => ({ ...f, challenge_type: e.target.value }))} style={{ border: "1px solid #dbe2ea", borderRadius: 8, padding: "8px 10px", fontFamily: "inherit" }}>
              {CHALLENGE_TYPE_OPTIONS.map((o) => (
                <option key={o.id} value={o.id}>{o.label}</option>
              ))}
            </select>
            {form.challenge_type === "distancia" ? (
              <input
                type="number"
                min="0"
                step="0.1"
                value={form.target_value}
                onChange={(e) => setForm((f) => ({ ...f, target_value: e.target.value, unit: "km" }))}
                placeholder="Meta en km (opcional: vacío = ranking sin meta fija)"
                style={{ gridColumn: "1 / -1", border: "1px solid #dbe2ea", borderRadius: 8, padding: "8px 10px", fontFamily: "inherit" }}
              />
            ) : (
              <>
                <input type="number" min="1" value={form.target_value} onChange={(e) => setForm((f) => ({ ...f, target_value: e.target.value }))} placeholder="Meta" style={{ border: "1px solid #dbe2ea", borderRadius: 8, padding: "8px 10px", fontFamily: "inherit" }} />
                <input value={form.unit} onChange={(e) => setForm((f) => ({ ...f, unit: e.target.value }))} placeholder="Unidad" style={{ border: "1px solid #dbe2ea", borderRadius: 8, padding: "8px 10px", fontFamily: "inherit" }} />
              </>
            )}
            <div style={{ gridColumn: "1 / -1", display: "flex", flexDirection: "column", gap: 8 }}>
              <button
                type="button"
                onClick={() => setForm((f) => ({ ...f, is_recurring: !f.is_recurring }))}
                style={{
                  alignSelf: "flex-start",
                  padding: "10px 14px",
                  borderRadius: 10,
                  border: form.is_recurring ? "2px solid #ff8a3d" : "1px solid #e2e8f0",
                  background: form.is_recurring ? "rgba(255,138,61,.14)" : "#fff",
                  color: "#0f172a",
                  fontWeight: 800,
                  fontFamily: "inherit",
                  fontSize: ".82em",
                  cursor: "pointer",
                }}
              >
                🔄 Reto recurrente{form.is_recurring ? " (activo)" : ""}
              </button>
              {form.is_recurring ? (
                <div>
                  <div style={{ fontSize: ".72em", color: "#64748b", marginBottom: 6 }}>Cada cuánto se renueva</div>
                  <select
                    value={form.recurrence === "weekly" ? "weekly" : "monthly"}
                    onChange={(e) => setForm((f) => ({ ...f, recurrence: e.target.value }))}
                    style={{ width: "100%", maxWidth: 280, border: "1px solid #dbe2ea", borderRadius: 8, padding: "8px 10px", fontFamily: "inherit" }}
                  >
                    <option value="monthly">Mensual</option>
                    <option value="weekly">Semanal</option>
                  </select>
                </div>
              ) : null}
            </div>
            <input type="date" value={form.start_date} onChange={(e) => setForm((f) => ({ ...f, start_date: e.target.value }))} style={{ border: "1px solid #dbe2ea", borderRadius: 8, padding: "8px 10px", fontFamily: "inherit" }} />
            <input type="date" value={form.end_date} onChange={(e) => setForm((f) => ({ ...f, end_date: e.target.value }))} style={{ border: "1px solid #dbe2ea", borderRadius: 8, padding: "8px 10px", fontFamily: "inherit" }} />
            {form.challenge_type === "distancia" ? null : (
              <>
                <input value={form.emoji} onChange={(e) => setForm((f) => ({ ...f, emoji: e.target.value }))} placeholder="Emoji" style={{ border: "1px solid #dbe2ea", borderRadius: 8, padding: "8px 10px", fontFamily: "inherit" }} />
                <input type="color" value={form.color} onChange={(e) => setForm((f) => ({ ...f, color: e.target.value }))} style={{ border: "1px solid #dbe2ea", borderRadius: 8, padding: "4px", background: "#fff", height: 36 }} />
              </>
            )}
          </div>
          <textarea value={form.description} onChange={(e) => setForm((f) => ({ ...f, description: e.target.value }))} placeholder="Descripción" rows={3} style={{ marginTop: 10, width: "100%", border: "1px solid #dbe2ea", borderRadius: 8, padding: "8px 10px", fontFamily: "inherit", boxSizing: "border-box" }} />
          <div style={{ display: "flex", justifyContent: "flex-end", marginTop: 10 }}>
            <button
              type="button"
              disabled={savingCreate}
              onClick={createChallenge}
              style={{ background: savingCreate ? "#cbd5e1" : "linear-gradient(135deg,#7c3aed,#a855f7)", border: "none", borderRadius: 8, padding: "8px 12px", color: "#fff", fontWeight: 700, fontFamily: "inherit", cursor: savingCreate ? "not-allowed" : "pointer", fontSize: ".78em" }}
            >
              {savingCreate ? "Guardando…" : "Guardar reto"}
            </button>
          </div>
        </div>
      ) : null}

      {loading ? (
        <div style={{ color: "#64748b", fontSize: ".85em" }}>Cargando retos…</div>
      ) : rows.length === 0 ? (
        <div style={{ color: "#94a3b8", fontSize: ".84em" }}>No hay retos activos por ahora.</div>
      ) : (
        <div style={{ display: "grid", gap: 12 }}>
          {rows.map((challenge) => {
            const todayYmd = formatLocalYMD(new Date());
            const challengeEndYmd = String(challenge.end_date || "").slice(0, 10);
            const challengeExpired = Boolean(challengeEndYmd && challengeEndYmd < todayYmd);
            const participants = visibleParticipants(challenge, participantsByChallenge[challenge.id] || []);
            const isMine = myChallengeIds.has(String(challenge.id));
            const progress = computeChallengeProgressForAthlete(challenge, workouts);
            const openDistanceChallenge = challengeHasOpenTarget(challenge);
            const wouldMeetGoal =
              !isMine &&
              Number.isFinite(progress?.target) &&
              progress.target > 0 &&
              Number(progress?.value) >= Number(progress.target);
            return (
              <div key={challenge.id} style={{ border: "1px solid #e2e8f0", borderRadius: 12, padding: "12px 14px", background: "#fff" }}>
                <div style={{ display: "flex", justifyContent: "space-between", gap: 12, alignItems: "flex-start", flexWrap: "wrap" }}>
                  <div style={{ minWidth: 0 }}>
                    <div style={{ display: "flex", alignItems: "center", gap: 8, flexWrap: "wrap" }}>
                      <span style={{ fontSize: "1.25em" }}>{challenge.emoji || "🏁"}</span>
                      <span style={{ fontWeight: 900, color: challenge.color || "#0f172a", fontSize: ".95em" }}>{challenge.title || "Reto"}</span>
                      {challenge.is_recurring ? (
                        <span
                          style={{
                            fontSize: ".68em",
                            fontWeight: 800,
                            color: "#9a3412",
                            background: "rgba(255,138,61,.16)",
                            border: "1px solid rgba(255,138,61,.45)",
                            borderRadius: 999,
                            padding: "3px 9px",
                          }}
                        >
                          🔄 {String(challenge.recurrence || "").toLowerCase() === "weekly" ? "Semanal" : "Mensual"}
                        </span>
                      ) : null}
                    </div>
                    <div style={{ color: "#64748b", fontSize: ".82em", marginTop: 4, lineHeight: 1.4 }}>{challenge.description || "Sin descripción"}</div>
                  </div>
                  <div style={{ color: "#475569", fontSize: ".76em", fontWeight: 700 }}>Meta: {challengeValueLabel(challenge)}</div>
                </div>
                <div style={{ marginTop: 10, color: "#64748b", fontSize: ".76em" }}>
                  Fecha límite: {challenge.end_date ? new Date(`${challenge.end_date}T12:00:00`).toLocaleDateString("es-CO") : "—"} · Participantes: {participants.length}
                </div>
                {canManageChallenge(challenge) ? (
                  <div style={{ marginTop: 10, display: "flex", alignItems: "center", gap: 8, flexWrap: "wrap" }}>
                    <label style={{ fontSize: ".72em", fontWeight: 700, color: "#64748b" }} htmlFor={`recurrence-${challenge.id}`}>
                      Recurrencia
                    </label>
                    <select
                      id={`recurrence-${challenge.id}`}
                      disabled={updatingRecurrenceId === String(challenge.id)}
                      value={recurrenceSelectValue(challenge)}
                      onChange={(e) => updateChallengeRecurrence(challenge.id, e.target.value)}
                      style={{
                        border: "1px solid #dbe2ea",
                        borderRadius: 8,
                        padding: "6px 10px",
                        fontFamily: "inherit",
                        fontSize: ".74em",
                        fontWeight: 700,
                        color: "#334155",
                        background: updatingRecurrenceId === String(challenge.id) ? "#f1f5f9" : "#fff",
                        cursor: updatingRecurrenceId === String(challenge.id) ? "not-allowed" : "pointer",
                        maxWidth: 220,
                      }}
                    >
                      <option value="none">No recurrente</option>
                      <option value="weekly">Semanal</option>
                      <option value="monthly">Mensual</option>
                    </select>
                  </div>
                ) : null}
                <div style={{ marginTop: 10, borderTop: "1px dashed #e2e8f0", paddingTop: 10 }}>
                  <button
                    type="button"
                    onClick={() => setParticipantsModalChallenge(challenge)}
                    style={{
                      fontSize: ".74em",
                      color: "#475569",
                      fontWeight: 800,
                      marginBottom: 8,
                      background: "none",
                      border: "none",
                      padding: 0,
                      cursor: "pointer",
                      fontFamily: "inherit",
                      textAlign: "left",
                      display: "block",
                      width: "100%",
                    }}
                  >
                    👥 Participantes
                  </button>
                  {participants.length === 0 ? (
                    <div style={{ color: "#94a3b8", fontSize: ".78em" }}>Sé el primero en unirte</div>
                  ) : (
                    <div style={{ display: "flex", gap: 10, alignItems: "flex-start", flexWrap: "wrap" }}>
                      {participants.slice(0, 5).map((participant) => (
                        <div key={participant.id} style={{ width: 64, textAlign: "center" }}>
                          <div
                            style={{
                              width: 36,
                              height: 36,
                              margin: "0 auto 4px",
                              borderRadius: "50%",
                              background: "#e2e8f0",
                              color: "#334155",
                              display: "flex",
                              alignItems: "center",
                              justifyContent: "center",
                              fontWeight: 900,
                              fontSize: ".78em",
                            }}
                          >
                            {participant.initials}
                          </div>
                          <div style={{ fontSize: ".67em", color: "#475569", lineHeight: 1.25 }}>
                            {participant.displayName}
                          </div>
                        </div>
                      ))}
                      {participants.length > 5 ? (
                        <div style={{ alignSelf: "center", color: "#64748b", fontSize: ".74em", fontWeight: 700 }}>
                          +{participants.length - 5} más
                        </div>
                      ) : null}
                    </div>
                  )}
                  <div style={{ marginTop: 10 }}>
                    <button
                      type="button"
                      onClick={() => setParticipantsModalChallenge(challenge)}
                      style={{
                        border: "1px solid #cbd5e1",
                        background: "#f8fafc",
                        borderRadius: 8,
                        padding: "7px 14px",
                        color: "#334155",
                        fontWeight: 700,
                        fontFamily: "inherit",
                        fontSize: ".75em",
                        cursor: "pointer",
                      }}
                    >
                      Ver progreso
                    </button>
                  </div>
                </div>
                {isAthlete ? (
                  openDistanceChallenge ? (
                    <div style={{ marginTop: 10, fontSize: ".76em", color: isMine ? "#475569" : "#94a3b8", fontWeight: 700 }}>
                      {isMine
                        ? challengeProgressOpenText(challenge, progress)
                        : `Tu progreso actual (aún no participas): ${challengeProgressOpenText(challenge, progress)}`}
                    </div>
                  ) : (
                    <>
                      <div style={{ marginTop: 10, fontSize: ".76em", color: isMine ? "#475569" : "#94a3b8", fontWeight: 700 }}>
                        {isMine
                          ? `Progreso: ${challengeProgressLabel(challenge, progress)}`
                          : `Tu progreso actual (aún no participas): ${challengeProgressLabel(challenge, progress)}`}
                      </div>
                      <div style={{ height: 8, borderRadius: 999, background: "#e2e8f0", overflow: "hidden", marginTop: 6 }}>
                        <div
                          style={{
                            width: `${progress.pct}%`,
                            height: "100%",
                            background: isMine ? (challenge.color || "#a855f7") : "#94a3b8",
                            opacity: isMine ? 1 : 0.55,
                          }}
                        />
                      </div>
                    </>
                  )
                ) : null}
                <div style={{ marginTop: 10, display: "flex", justifyContent: "space-between", alignItems: "center", gap: 10, flexWrap: "wrap" }}>
                  {isAthlete ? (
                    isMine ? (
                      <span style={{ fontSize: ".72em", fontWeight: 800, color: "#15803d", border: "1px solid rgba(34,197,94,.35)", background: "rgba(34,197,94,.14)", borderRadius: 999, padding: "4px 10px" }}>
                        Participando
                      </span>
                    ) : (
                      <div style={{ display: "flex", flexDirection: "column", alignItems: "flex-start", gap: 8, minWidth: 0 }}>
                        {wouldMeetGoal ? (
                          <div
                            style={{
                              background: "linear-gradient(135deg, rgba(34,197,94,.16), rgba(255,138,61,.18))",
                              border: "1px solid rgba(180,83,9,.35)",
                              borderRadius: 8,
                              padding: "8px 12px",
                              color: "#9a3412",
                              fontWeight: 800,
                              fontSize: ".74em",
                              lineHeight: 1.35,
                              maxWidth: 320,
                            }}
                          >
                            ¡Ya cumplirías la meta! Únete para que cuente.
                          </div>
                        ) : null}
                        <button
                          type="button"
                          disabled={joiningChallengeId === String(challenge.id) || !athleteId || challengeExpired}
                          onClick={() => joinChallenge(challenge.id)}
                          style={{ background: joiningChallengeId === String(challenge.id) ? "#cbd5e1" : "linear-gradient(135deg,#2563eb,#3b82f6)", border: "none", borderRadius: 8, padding: "8px 12px", color: "#fff", fontWeight: 800, fontFamily: "inherit", cursor: joiningChallengeId === String(challenge.id) || challengeExpired ? "not-allowed" : "pointer", fontSize: ".75em" }}
                        >
                          {joiningChallengeId === String(challenge.id) ? "Uniendo…" : challengeExpired ? "Reto finalizado" : "Unirse"}
                        </button>
                      </div>
                    )
                  ) : <span />}
                  {canManageChallenge(challenge) ? (
                    <div style={{ display: "flex", gap: 8, flexWrap: "wrap", alignItems: "center", marginLeft: "auto" }}>
                      {challengeExpired ? (
                        <button
                          type="button"
                          disabled={renewingId === String(challenge.id)}
                          onClick={() => renewChallengeForNextPeriod(challenge)}
                          style={{
                            background: renewingId === String(challenge.id) ? "#e2e8f0" : "linear-gradient(135deg,#ea580c,#f97316)",
                            border: "none",
                            borderRadius: 8,
                            padding: "7px 12px",
                            color: renewingId === String(challenge.id) ? "#64748b" : "#fff",
                            fontWeight: 800,
                            cursor: renewingId === String(challenge.id) ? "not-allowed" : "pointer",
                            fontFamily: "inherit",
                            fontSize: ".72em",
                          }}
                        >
                          {renewingId === String(challenge.id) ? "Renovando…" : "🔄 Renovar"}
                        </button>
                      ) : null}
                      <button
                        type="button"
                        disabled={deletingId === String(challenge.id)}
                        onClick={() => deleteChallenge(challenge.id)}
                        style={{ background: deletingId === String(challenge.id) ? "#e2e8f0" : "#fef2f2", border: "1px solid #fecaca", borderRadius: 8, padding: "7px 10px", color: "#b91c1c", fontWeight: 700, cursor: deletingId === String(challenge.id) ? "not-allowed" : "pointer", fontFamily: "inherit", fontSize: ".72em" }}
                      >
                        🗑️ Eliminar
                      </button>
                    </div>
                  ) : null}
                </div>
              </div>
            );
          })}
        </div>
      )}
      {participantsModalChallenge ? (
        <div style={{ position: "fixed", inset: 0, zIndex: 10030, background: "rgba(15,23,42,.55)", display: "flex", alignItems: "center", justifyContent: "center", padding: 16 }}>
          <div style={{ ...S.card, width: "100%", maxWidth: 560, margin: 0, maxHeight: "80vh", overflowY: "auto" }}>
            <div style={{ display: "flex", alignItems: "center", justifyContent: "space-between", gap: 10, marginBottom: 10 }}>
              <div style={{ fontSize: "1.02em", fontWeight: 900, color: "#0f172a" }}>👥 Participantes · {participantsModalChallenge.title || "Reto"}</div>
              <button type="button" onClick={() => setParticipantsModalChallenge(null)} style={{ border: "1px solid #e2e8f0", background: "#fff", borderRadius: 8, padding: "6px 10px", color: "#475569", fontFamily: "inherit", fontWeight: 700, cursor: "pointer", fontSize: ".76em" }}>
                Cerrar
              </button>
            </div>
            {visibleParticipants(participantsModalChallenge, participantsByChallenge[participantsModalChallenge.id] || []).length === 0 ? (
              <div style={{ color: "#94a3b8", fontSize: ".82em" }}>Sin participantes</div>
            ) : (() => {
                const modalList = visibleParticipants(participantsModalChallenge, participantsByChallenge[participantsModalChallenge.id] || []);
                const isDistanceChallenge = normalizeChallengeType(participantsModalChallenge.challenge_type) === "distancia";
                const modalTargetRaw = Number(participantsModalChallenge?.target_value);
                const modalOpenRanking = !Number.isFinite(modalTargetRaw) || modalTargetRaw <= 0;
                if (modalOpenRanking) {
                  const ranked = [...modalList]
                    .map((participant) => {
                      const w = getWorkoutsForChallengeParticipant(participant);
                      const pr = computeChallengeProgressForAthlete(participantsModalChallenge, w);
                      return { participant, km: Number(pr.value) || 0 };
                    })
                    .sort((a, b) => b.km - a.km);
                  return (
                    <div style={{ display: "flex", flexDirection: "column", gap: 8 }}>
                      <div style={{ fontSize: ".78em", color: "#64748b", fontWeight: 700 }}>
                        Sin meta fija · Ranking por km
                      </div>
                      {ranked.map((row, idx) => (
                        <div
                          key={row.participant.id}
                          style={{
                            border: "1px solid #e2e8f0",
                            borderRadius: 10,
                            padding: "10px 12px",
                            background: "#fff",
                            fontSize: ".88em",
                            color: "#0f172a",
                            fontWeight: 700,
                          }}
                        >
                          {idx + 1}. {row.participant.displayName} — {row.km.toFixed(0)}km
                        </div>
                      ))}
                    </div>
                  );
                }
                return (
                  <div style={{ display: "flex", flexDirection: "column", gap: 8 }}>
                    {modalList.map((participant) => {
                      const participantWorkouts = getWorkoutsForChallengeParticipant(participant);
                      const participantProgress = computeChallengeProgressForAthlete(participantsModalChallenge, participantWorkouts);
                      const targetKm = Math.max(0, Number(participantsModalChallenge?.target_value) || 0);
                      const kmDone = isDistanceChallenge ? Number(participantProgress.value) || 0 : 0;
                      const pctRounded =
                        isDistanceChallenge && targetKm > 0 ? Math.min(100, Math.round((kmDone / targetKm) * 100)) : 0;
                      const barSlots = 8;
                      const filledSlots =
                        isDistanceChallenge && targetKm > 0 ? Math.round((pctRounded / 100) * barSlots) : 0;
                      const asciiBar = `[${"█".repeat(Math.min(barSlots, Math.max(0, filledSlots)))}${"░".repeat(Math.max(0, barSlots - Math.min(barSlots, Math.max(0, filledSlots))))}]`;
                      return (
                        <div key={participant.id} style={{ border: "1px solid #e2e8f0", borderRadius: 10, padding: "9px 10px", background: "#fff", display: "flex", justifyContent: "space-between", alignItems: "center", gap: 10, flexWrap: "wrap" }}>
                          <div style={{ display: "flex", alignItems: "center", gap: 8, minWidth: 0 }}>
                            <div style={{ width: 34, height: 34, borderRadius: "50%", background: "#e2e8f0", color: "#334155", display: "flex", alignItems: "center", justifyContent: "center", fontWeight: 900, fontSize: ".75em" }}>
                              {participant.initials}
                            </div>
                            <div style={{ fontSize: ".82em", color: "#0f172a", fontWeight: 700 }}>{participant.displayName}</div>
                          </div>
                          {isDistanceChallenge ? (
                            <div style={{ flex: 1, minWidth: 200, maxWidth: "100%", textAlign: "right" }}>
                              <div
                                style={{
                                  fontFamily: "ui-monospace, Consolas, monospace",
                                  fontSize: ".72em",
                                  color: "#334155",
                                  fontWeight: 700,
                                  lineHeight: 1.35,
                                  wordBreak: "break-all",
                                }}
                              >
                                {asciiBar}{" "}
                                {kmDone.toFixed(1)} km / {targetKm > 0 ? `${targetKm.toFixed(1)} km` : "—"}
                                {targetKm > 0 ? ` (${pctRounded}%)` : ""}
                              </div>
                              {targetKm > 0 ? (
                                <div style={{ height: 6, borderRadius: 999, background: "#e2e8f0", overflow: "hidden", marginTop: 6, maxWidth: 280, marginLeft: "auto" }}>
                                  <div
                                    style={{
                                      width: `${pctRounded}%`,
                                      height: "100%",
                                      background: participantsModalChallenge.color || "#a855f7",
                                    }}
                                  />
                                </div>
                              ) : null}
                            </div>
                          ) : (
                            <div style={{ fontSize: ".75em", color: "#64748b", fontWeight: 700 }}>
                              {challengeProgressLabel(participantsModalChallenge, participantProgress)}
                            </div>
                          )}
                        </div>
                      );
                    })}
                  </div>
                );
              })()}
          </div>
        </div>
      ) : null}
    </div>
  );
}

export default ChallengesHub;
