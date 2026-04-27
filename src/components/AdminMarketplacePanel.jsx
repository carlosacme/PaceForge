import { useState, useEffect, useMemo, useCallback } from "react";
import { supabase } from "../lib/supabase";
import {
  PLATFORM_ADMIN_USER_ID,
  PLAN_PREVIEW_FULL_DAYS,
  PLAN_SESSION_TYPE_OPTIONS,
  emptyWorkoutStructureRow,
  extractJsonFromAnthropicText,
  workoutStructureToEditableRows,
  editableRowsToWorkoutStructure,
  buildMarketplaceAiPacePromptSection,
  applyMarketplaceAiPaceDefaultsToPreviewRows,
  normalizeWorkoutStructure,
  WORKOUT_BLOCK_TYPES,
  formatCopInt,
} from "./shared/appShared";

function AdminMarketplacePanel({ notify, styles }) {
  const S = styles;
  const ADMIN_PLAN_DRAFT_KEY = "raf_admin_plan_draft";
  const EMPTY_ADMIN_PLAN_FORM = {
    title: "",
    description: "",
    level: "intermedio",
    duration_weeks: "12",
    sessions_per_week: "4",
    price_cop: "120000",
    preview_workouts_text: "",
    editing_plan_id: null,
  };
  const [plans, setPlans] = useState([]);
  const [purchases, setPurchases] = useState([]);
  const [loading, setLoading] = useState(true);
  const [creatingPlan, setCreatingPlan] = useState(false);
  const [createForm, setCreateForm] = useState(EMPTY_ADMIN_PLAN_FORM);
  const [aiModalOpen, setAiModalOpen] = useState(false);
  const [aiGenerating, setAiGenerating] = useState(false);
  const [aiContext, setAiContext] = useState("");
  const [aiLevel, setAiLevel] = useState("principiante");
  const [aiGoal, setAiGoal] = useState("42K");
  const [aiDurationWeeks, setAiDurationWeeks] = useState("16");
  const [aiSessionsPerWeek, setAiSessionsPerWeek] = useState("4");
  const [planSessionModalOpen, setPlanSessionModalOpen] = useState(false);
  const [planSessionModalIndex, setPlanSessionModalIndex] = useState(null);
  const [planSessionForm, setPlanSessionForm] = useState(() => ({
    week: "1",
    day: PLAN_PREVIEW_FULL_DAYS[0],
    title: "",
    type: "easy",
    description: "",
    duration_min: "",
    distance_km: "",
    structureRows: [emptyWorkoutStructureRow()],
  }));

  const loadAll = useCallback(async () => {
    setLoading(true);
    const [plansRes, purchasesRes] = await Promise.all([
      supabase.from("plan_marketplace").select("*").order("created_at", { ascending: false }),
      supabase.from("plan_purchases").select("*").order("created_at", { ascending: false }),
    ]);
    setLoading(false);
    if (plansRes.error) {
      console.error("admin marketplace plans:", plansRes.error);
      notify?.(plansRes.error.message || "No se pudieron cargar planes");
      setPlans([]);
    } else setPlans(plansRes.data || []);
    if (purchasesRes.error) {
      console.error("admin marketplace purchases:", purchasesRes.error);
      setPurchases([]);
    } else setPurchases(purchasesRes.data || []);
  }, [notify]);

  useEffect(() => {
    loadAll();
  }, [loadAll]);

  useEffect(() => {
    if (typeof localStorage === "undefined") return;
    const saved = localStorage.getItem(ADMIN_PLAN_DRAFT_KEY);
    if (!saved) return;
    try {
      const parsed = JSON.parse(saved);
      if (parsed && typeof parsed === "object") {
        setCreateForm((prev) => ({ ...prev, ...parsed }));
      }
    } catch {
      /* ignore malformed draft */
    }
  }, []);

  useEffect(() => {
    if (typeof localStorage === "undefined") return;
    const hasData = Boolean(
      createForm.editing_plan_id ||
        String(createForm.title || "").trim() ||
        String(createForm.description || "").trim() ||
        String(createForm.preview_workouts_text || "").trim() ||
        String(createForm.level || "").trim() !== "intermedio" ||
        String(createForm.duration_weeks || "").trim() !== "12" ||
        String(createForm.sessions_per_week || "").trim() !== "4" ||
        String(createForm.price_cop || "").trim() !== "120000",
    );
    if (!hasData) {
      localStorage.removeItem(ADMIN_PLAN_DRAFT_KEY);
      return;
    }
    localStorage.setItem(ADMIN_PLAN_DRAFT_KEY, JSON.stringify(createForm));
  }, [createForm]);

  const confirmedCountByPlan = useMemo(() => {
    const m = {};
    for (const p of purchases || []) {
      if (String(p.payment_status || "").toLowerCase() !== "confirmed") continue;
      const pid = String(p.plan_id || "");
      if (!pid) continue;
      m[pid] = (m[pid] || 0) + 1;
    }
    return m;
  }, [purchases]);

  const approvePlan = async (planId) => {
    const { error } = await supabase.from("plan_marketplace").update({ is_approved: true, is_active: true }).eq("id", planId);
    if (error) {
      notify?.(error.message || "No se pudo aprobar");
      return;
    }
    notify?.("Plan aprobado");
    loadAll();
  };
  const rejectPlan = async (planId) => {
    const { error } = await supabase.from("plan_marketplace").update({ is_approved: false, is_active: false }).eq("id", planId);
    if (error) {
      notify?.(error.message || "No se pudo rechazar");
      return;
    }
    notify?.("Plan rechazado");
    loadAll();
  };
  const deletePlan = async (planId) => {
    const { error } = await supabase.from("plan_marketplace").delete().eq("id", planId);
    if (error) {
      notify?.(error.message || "No se pudo eliminar");
      return;
    }
    notify?.("Plan eliminado");
    loadAll();
  };
  const confirmPayment = async (purchaseId) => {
    const { error } = await supabase.from("plan_purchases").update({ payment_status: "confirmed" }).eq("id", purchaseId);
    if (error) {
      notify?.(error.message || "No se pudo confirmar pago");
      return;
    }
    notify?.("Pago confirmado");
    loadAll();
  };

  const pendingPurchases = (purchases || []).filter((p) => String(p.payment_status || "").toLowerCase() === "pending");
  const hasUnsavedDraft = useMemo(() => {
    return Boolean(
      createForm.editing_plan_id ||
        String(createForm.title || "").trim() ||
        String(createForm.description || "").trim() ||
        String(createForm.preview_workouts_text || "").trim() ||
        String(createForm.level || "").trim() !== "intermedio" ||
        String(createForm.duration_weeks || "").trim() !== "12" ||
        String(createForm.sessions_per_week || "").trim() !== "4" ||
        String(createForm.price_cop || "").trim() !== "120000",
    );
  }, [createForm]);

  const isPreviewWorkoutRowShape = (o) =>
    o && typeof o === "object" && !Array.isArray(o) && ("week" in o || "day" in o || "title" in o);

  const parsePreviewWorkoutsText = (txt) => {
    const raw = String(txt || "").trim();
    if (!raw) return [];
    try {
      const direct = JSON.parse(raw);
      if (Array.isArray(direct)) return direct;
      if (direct && typeof direct === "object") {
        if (Array.isArray(direct.preview_workouts)) return direct.preview_workouts;
        if (isPreviewWorkoutRowShape(direct)) return [direct];
      }
    } catch {
      /* fall through */
    }
    const parsed = extractJsonFromAnthropicText(raw);
    if (Array.isArray(parsed)) return parsed;
    if (parsed && typeof parsed === "object") {
      if (Array.isArray(parsed.preview_workouts)) return parsed.preview_workouts;
      if (isPreviewWorkoutRowShape(parsed)) return [parsed];
    }
    return [];
  };
  const previewRows = useMemo(() => parsePreviewWorkoutsText(createForm.preview_workouts_text), [createForm.preview_workouts_text]);

  const emptyPlanPreviewRow = () => ({
    week: 1,
    day: "",
    title: "",
    type: "easy",
    description: "",
    pace_range: "",
    duration_min: null,
    distance_km: null,
  });

  const resetPlanSessionFormFields = () => ({
    week: "1",
    day: PLAN_PREVIEW_FULL_DAYS[0],
    title: "",
    type: "easy",
    description: "",
    duration_min: "",
    distance_km: "",
    structureRows: [emptyWorkoutStructureRow()],
  });

  const normalizeDayToFull = (dayRaw) => {
    const s = String(dayRaw || "").trim();
    if (PLAN_PREVIEW_FULL_DAYS.includes(s)) return s;
    const low = s.toLowerCase();
    const exact = PLAN_PREVIEW_FULL_DAYS.find((d) => d.toLowerCase() === low);
    if (exact) return exact;
    const fuzzy = PLAN_PREVIEW_FULL_DAYS.find(
      (d) => d.toLowerCase().startsWith(low) || (low.length >= 2 && low.startsWith(d.slice(0, 3).toLowerCase())),
    );
    return fuzzy || PLAN_PREVIEW_FULL_DAYS[0];
  };

  const resolvePlanSessionTypeId = (w) => {
    const id = w?.type;
    if (id && PLAN_SESSION_TYPE_OPTIONS.some((t) => t.id === id)) return id;
    return "easy";
  };

  const rowToPlanSessionForm = (row) => {
    const r = row && typeof row === "object" && !Array.isArray(row) ? row : {};
    const struct = r.workout_structure ?? r.structure;
    const baseRows = workoutStructureToEditableRows(struct);
    return {
      week: String(r.week != null && r.week !== "" ? r.week : 1),
      day: normalizeDayToFull(r.day),
      title: String(r.title || ""),
      type: resolvePlanSessionTypeId(r),
      description: String(r.description || ""),
      duration_min: r.duration_min != null && r.duration_min !== "" ? String(r.duration_min) : "",
      distance_km: r.distance_km != null && r.distance_km !== "" ? String(r.distance_km) : "",
      structureRows: baseRows.length ? baseRows.map((x) => ({ ...x })) : [emptyWorkoutStructureRow()],
    };
  };

  const closePlanSessionModal = () => {
    setPlanSessionModalOpen(false);
    setPlanSessionModalIndex(null);
  };

  const openPlanSessionModalAdd = () => {
    setPlanSessionModalIndex(null);
    setPlanSessionForm(resetPlanSessionFormFields());
    setPlanSessionModalOpen(true);
  };

  const openPlanSessionModalEdit = (idx) => {
    setPlanSessionModalIndex(idx);
    setPlanSessionForm(rowToPlanSessionForm(previewRows[idx]));
    setPlanSessionModalOpen(true);
  };

  const movePlanSessionStructureRow = (idx, delta) => {
    setPlanSessionForm((f) => {
      const arr = [...f.structureRows];
      const j = idx + delta;
      if (j < 0 || j >= arr.length) return f;
      const tmp = arr[idx];
      arr[idx] = arr[j];
      arr[j] = tmp;
      return { ...f, structureRows: arr };
    });
  };

  const savePlanSessionModal = () => {
    const title = String(planSessionForm.title || "").trim();
    if (!title) {
      notify?.("Indica el título del workout");
      return;
    }
    const weekNum = Math.max(1, Math.round(Number(planSessionForm.week) || 1));
    const dm = String(planSessionForm.duration_min).trim();
    const duration_min = dm === "" ? null : Math.max(0, Math.round(Number(dm)) || 0);
    const dk = String(planSessionForm.distance_km).trim();
    const distance_km = dk === "" ? null : Number.isFinite(Number(dk)) ? Number(dk) : null;
    const st = editableRowsToWorkoutStructure(planSessionForm.structureRows);
    const row = {
      week: weekNum,
      day: planSessionForm.day,
      title,
      type: planSessionForm.type,
      description: String(planSessionForm.description || ""),
      duration_min,
      distance_km,
    };
    if (st.length) row.workout_structure = st;
    const next = [...previewRows];
    if (planSessionModalIndex == null) next.push(row);
    else next[planSessionModalIndex] = row;
    setCreateForm((f) => ({ ...f, preview_workouts_text: JSON.stringify(next, null, 2) }));
    closePlanSessionModal();
  };

  const duplicatePlanRow = (idx) => {
    if (planSessionModalOpen && planSessionModalIndex === idx) closePlanSessionModal();
    const row = previewRows[idx];
    const clone = row && typeof row === "object" && !Array.isArray(row) ? { ...row } : emptyPlanPreviewRow();
    const next = [...previewRows.slice(0, idx + 1), clone, ...previewRows.slice(idx + 1)];
    setCreateForm((f) => ({ ...f, preview_workouts_text: JSON.stringify(next, null, 2) }));
  };

  const deletePlanRow = (idx) => {
    if (planSessionModalOpen) closePlanSessionModal();
    const next = previewRows.filter((_, i) => i !== idx);
    setCreateForm((f) => ({ ...f, preview_workouts_text: JSON.stringify(next, null, 2) }));
  };

  const createAdminPlan = async () => {
    const title = String(createForm.title || "").trim();
    if (!title) {
      notify?.("Indica un título para el plan");
      return;
    }
    const description = String(createForm.description || "").trim();
    const level = String(createForm.level || "intermedio");
    const duration_weeks = Math.max(1, Math.round(Number(createForm.duration_weeks) || 0));
    const sessions_per_week = Math.max(1, Math.round(Number(createForm.sessions_per_week) || 0));
    const price_cop = Math.max(50000, Math.min(300000, Math.round(Number(String(createForm.price_cop || "0").replace(/[^\d]/g, "")) || 0)));
    const preview_workouts = parsePreviewWorkoutsText(createForm.preview_workouts_text);
    const editingId = createForm.editing_plan_id || null;

    setCreatingPlan(true);
    let error = null;
    if (editingId) {
      const res = await supabase
        .from("plan_marketplace")
        .update({
          title,
          description,
          level,
          duration_weeks,
          sessions_per_week,
          price_cop,
          preview_workouts,
          plan_sessions: preview_workouts,
          is_active: true,
          is_approved: true,
        })
        .eq("id", editingId)
        .eq("coach_user_id", PLATFORM_ADMIN_USER_ID);
      error = res.error;
    } else {
      const res = await supabase.from("plan_marketplace").insert({
        coach_user_id: PLATFORM_ADMIN_USER_ID,
        coach_id: PLATFORM_ADMIN_USER_ID,
        coach_name: "RunningApexFlow",
        title,
        description,
        level,
        duration_weeks,
        sessions_per_week,
        price_cop,
        preview_workouts,
        plan_sessions: preview_workouts,
        is_active: true,
        is_approved: true,
      });
      error = res.error;
    }
    setCreatingPlan(false);
    if (error) {
      notify?.(error.message || "No se pudo guardar el plan");
      return;
    }
    notify?.(editingId ? "Plan actualizado y aprobado." : "Plan creado y aprobado automáticamente.");
    setCreateForm(EMPTY_ADMIN_PLAN_FORM);
    closePlanSessionModal();
    if (typeof localStorage !== "undefined") localStorage.removeItem(ADMIN_PLAN_DRAFT_KEY);
    loadAll();
  };

  const generatePlanWithAi = async () => {
    const sessionsFixed = [3, 4, 5].includes(Number(aiSessionsPerWeek)) ? Number(aiSessionsPerWeek) : 4;
    const duracionSemanas = Math.max(1, Math.round(Number(aiDurationWeeks) || 12));
    const totalPreviewEntries = duracionSemanas * sessionsFixed;
    const pacePromptBlock = buildMarketplaceAiPacePromptSection();
    const systemPrompt = `Eres un experto en coaching de running. Genera un plan de entrenamiento completo para vender en un marketplace. Responde SOLO con JSON sin texto adicional ni markdown:
{
  "title": "título comercial atractivo",
  "description": "descripción de venta de 2-3 oraciones que convenza al atleta",
  "level": "principiante|intermedio|avanzado",
  "duration_weeks": ${duracionSemanas},
  "sessions_per_week": ${sessionsFixed},
  "price_cop": precio sugerido entre 50000 y 300000,
  "preview_workouts": [
    {"week": 1, "day": "Martes", "type": "easy", "title": "título sesión", "description": "Rodaje suave a 6:00–6:45 min/km (texto con rango numérico obligatorio)", "pace_range": "6:00-6:45", "duration_min": número, "distance_km": número}
  ]
}
${pacePromptBlock}
Reglas obligatorias:
- El campo "duration_weeks" en tu respuesta JSON debe ser exactamente ${duracionSemanas}.
- El campo "sessions_per_week" en tu respuesta JSON debe ser exactamente el número ${sessionsFixed} (valor fijo; no uses otro número).
- En preview_workouts incluye TODAS las sesiones de TODAS las semanas: ${duracionSemanas} semanas × ${sessionsFixed} sesiones = ${totalPreviewEntries} entradas en total. Cada semana debe tener exactamente ${sessionsFixed} sesiones en días no consecutivos.
- Cada elemento de preview_workouts debe incluir: week (del 1 al ${duracionSemanas}), day, type, title, description (con min/km numéricos según nivel y type), pace_range (formato H:MM-H:MM con guión ASCII, coherente con type y level), duration_min, distance_km.
- preview_workouts debe tener exactamente ${totalPreviewEntries} objetos: ordena por semana creciente (1…${duracionSemanas}); dentro de cada semana, ${sessionsFixed} filas con el mismo "week" y días no consecutivos.`;
    const userPrompt = [
      `Describe el plan: ${aiContext || "Plan de running para marketplace"}`,
      `Nivel del plan (aplica la tabla de ritmos de este nivel en cada sesión): ${aiLevel}`,
      `Objetivo: ${aiGoal}`,
      `Duración: ${duracionSemanas} semanas`,
      `El plan debe tener exactamente ${sessionsFixed} sesiones por semana, distribuidas en días no consecutivos.`,
      "Cada sesión: incluye type, pace_range (H:MM-H:MM) y description con el mismo rango en min/km explícito; sin lenguaje vago de ritmo.",
    ].join("\n");
    setAiGenerating(true);
    try {
      const res = await fetch("/api/generate-workout", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({
          model: "claude-sonnet-4-20250514",
          max_tokens: 16384,
          system: systemPrompt,
          messages: [{ role: "user", content: userPrompt }],
        }),
      });
      const data = await res.json();
      if (!res.ok) {
        notify?.("Error al generar plan con IA");
        return;
      }
      const text = data.content?.find((b) => b.type === "text")?.text || "";
      const parsed = extractJsonFromAnthropicText(text);
      if (!parsed || typeof parsed !== "object") {
        notify?.("La IA no devolvió un JSON válido.");
        return;
      }
      const resolvedLevel = String(parsed.level || aiLevel || "intermedio");
      const rawPreview = Array.isArray(parsed.preview_workouts)
        ? parsed.preview_workouts
        : isPreviewWorkoutRowShape(parsed.preview_workouts)
          ? [parsed.preview_workouts]
          : [];
      const normalizedPreview = applyMarketplaceAiPaceDefaultsToPreviewRows(rawPreview, resolvedLevel);
      setCreateForm((prev) => ({
        ...prev,
        editing_plan_id: null,
        title: String(parsed.title || prev.title || ""),
        description: String(parsed.description || prev.description || ""),
        level: resolvedLevel,
        duration_weeks: String(parsed.duration_weeks || aiDurationWeeks || "12"),
        sessions_per_week: String(sessionsFixed),
        price_cop: String(parsed.price_cop || prev.price_cop || "120000"),
        preview_workouts_text: JSON.stringify(normalizedPreview, null, 2),
      }));
      notify?.("Plan generado con IA y formulario prellenado.");
      closePlanSessionModal();
      setAiModalOpen(false);
    } catch (e) {
      console.error("generatePlanWithAi:", e);
      notify?.("No se pudo generar con IA");
    } finally {
      setAiGenerating(false);
    }
  };

  return (
    <div style={S.page}>
      <h1 style={S.pageTitle}>🛒 Admin · Marketplace</h1>
      <div style={{ ...S.card, marginBottom: 12 }}>
        <div style={{ display: "flex", justifyContent: "space-between", gap: 10, flexWrap: "wrap", alignItems: "center", marginBottom: 10 }}>
          <div style={{ fontSize: ".78em", letterSpacing: ".1em", textTransform: "uppercase", color: "#64748b", fontWeight: 800 }}>
            Crear plan (admin)
          </div>
          <div style={{ display: "flex", alignItems: "center", gap: 8, flexWrap: "wrap" }}>
            {hasUnsavedDraft ? (
              <span style={{ border: "1px solid #fde68a", background: "#fffbeb", color: "#92400e", borderRadius: 999, padding: "5px 9px", fontSize: ".72em", fontWeight: 800 }}>
                📝 Borrador guardado
              </span>
            ) : null}
            <button
              type="button"
              onClick={() => {
                setCreateForm(EMPTY_ADMIN_PLAN_FORM);
                closePlanSessionModal();
                if (typeof localStorage !== "undefined") localStorage.removeItem(ADMIN_PLAN_DRAFT_KEY);
              }}
              style={{ border: "1px solid #fecaca", borderRadius: 8, padding: "8px 10px", background: "#fff1f2", color: "#b91c1c", fontWeight: 800, cursor: "pointer", fontFamily: "inherit", fontSize: ".76em" }}
            >
              🗑️ Limpiar borrador
            </button>
            <button
              type="button"
              onClick={() => {
                const s = String(createForm.sessions_per_week || "4");
                if (s === "3" || s === "4" || s === "5") setAiSessionsPerWeek(s);
                setAiModalOpen(true);
              }}
              style={{ border: "none", borderRadius: 8, padding: "8px 12px", background: "linear-gradient(135deg,#8b5cf6,#6366f1)", color: "#fff", fontWeight: 800, cursor: "pointer", fontFamily: "inherit", fontSize: ".78em" }}
            >
              ✨ Generar plan con IA
            </button>
          </div>
        </div>
        <div style={{ display: "grid", gridTemplateColumns: "repeat(2,minmax(0,1fr))", gap: 10 }}>
          <div style={{ gridColumn: "1 / -1" }}>
            <label style={{ display: "block", fontSize: ".72em", color: "#64748b", marginBottom: 5, fontWeight: 700 }}>Título del plan</label>
            <input value={createForm.title} onChange={(e) => setCreateForm((f) => ({ ...f, title: e.target.value }))} placeholder="Título comercial del plan" style={{ width: "100%", border: "1px solid #e2e8f0", borderRadius: 8, padding: "9px 10px", fontFamily: "inherit", boxSizing: "border-box" }} />
          </div>
          <div style={{ gridColumn: "1 / -1" }}>
            <label style={{ display: "block", fontSize: ".72em", color: "#64748b", marginBottom: 5, fontWeight: 700 }}>Descripción comercial</label>
            <textarea value={createForm.description} onChange={(e) => setCreateForm((f) => ({ ...f, description: e.target.value }))} rows={3} placeholder="Descripción de venta (2-3 oraciones)" style={{ width: "100%", border: "1px solid #e2e8f0", borderRadius: 8, padding: "9px 10px", fontFamily: "inherit", boxSizing: "border-box" }} />
          </div>
          <div>
            <label style={{ display: "block", fontSize: ".72em", color: "#64748b", marginBottom: 5, fontWeight: 700 }}>Nivel</label>
            <select value={createForm.level} onChange={(e) => setCreateForm((f) => ({ ...f, level: e.target.value }))} style={{ width: "100%", border: "1px solid #e2e8f0", borderRadius: 8, padding: "9px 10px", fontFamily: "inherit" }}>
              <option value="principiante">Principiante</option>
              <option value="intermedio">Intermedio</option>
              <option value="avanzado">Avanzado</option>
            </select>
          </div>
          <div>
            <label style={{ display: "block", fontSize: ".72em", color: "#64748b", marginBottom: 5, fontWeight: 700 }}>Duración (semanas)</label>
            <input type="number" value={createForm.duration_weeks} onChange={(e) => setCreateForm((f) => ({ ...f, duration_weeks: e.target.value }))} placeholder="ej: 12" style={{ width: "100%", border: "1px solid #e2e8f0", borderRadius: 8, padding: "9px 10px", fontFamily: "inherit", boxSizing: "border-box" }} />
          </div>
          <div>
            <label style={{ display: "block", fontSize: ".72em", color: "#64748b", marginBottom: 5, fontWeight: 700 }}>Sesiones por semana</label>
            <input type="number" value={createForm.sessions_per_week} onChange={(e) => setCreateForm((f) => ({ ...f, sessions_per_week: e.target.value }))} placeholder="ej: 4" style={{ width: "100%", border: "1px solid #e2e8f0", borderRadius: 8, padding: "9px 10px", fontFamily: "inherit", boxSizing: "border-box" }} />
          </div>
          <div>
            <label style={{ display: "block", fontSize: ".72em", color: "#64748b", marginBottom: 5, fontWeight: 700 }}>Precio (COP)</label>
            <input type="text" value={createForm.price_cop} onChange={(e) => setCreateForm((f) => ({ ...f, price_cop: e.target.value }))} placeholder="ej: 120,000" style={{ width: "100%", border: "1px solid #e2e8f0", borderRadius: 8, padding: "9px 10px", fontFamily: "inherit", boxSizing: "border-box" }} />
          </div>
          <div style={{ gridColumn: "1 / -1" }}>
            <label style={{ display: "block", fontSize: ".72em", color: "#64748b", marginBottom: 5, fontWeight: 700 }}>Workouts de muestra (JSON)</label>
            <div style={{ fontSize: ".7em", color: "#64748b", marginBottom: 6 }}>
              {'Formato: [{"week":1,"day":"Martes","title":"Rodaje suave","description":"...","duration_min":45,"distance_km":8}]'}
            </div>
            <textarea value={createForm.preview_workouts_text} onChange={(e) => setCreateForm((f) => ({ ...f, preview_workouts_text: e.target.value }))} rows={8} placeholder='[{"week":1,"day":"Martes","type":"easy","title":"Rodaje suave","description":"Rodaje a 6:00–6:45 min/km","pace_range":"6:00-6:45","duration_min":45,"distance_km":8}]' style={{ width: "100%", border: "1px solid #e2e8f0", borderRadius: 8, padding: "9px 10px", fontFamily: "monospace", fontSize: ".78em", boxSizing: "border-box" }} />
          </div>
          <div style={{ gridColumn: "1 / -1" }}>
            <div style={{ fontSize: ".72em", color: "#64748b", marginBottom: 8, fontWeight: 800 }}>Plan completo</div>
            <div style={{ border: "1px solid #e2e8f0", borderRadius: 10, overflow: "hidden" }}>
              <div style={{ overflowX: "auto" }}>
                <table style={{ width: "100%", minWidth: 1020, borderCollapse: "collapse" }}>
                  <thead>
                    <tr style={{ background: "#f8fafc", borderBottom: "1px solid #e2e8f0", fontSize: ".7em", color: "#475569", textTransform: "uppercase", letterSpacing: ".05em" }}>
                      <th style={{ textAlign: "left", padding: "8px 10px" }}>Semana</th>
                      <th style={{ textAlign: "left", padding: "8px 10px" }}>Día</th>
                      <th style={{ textAlign: "left", padding: "8px 10px" }}>Título</th>
                      <th style={{ textAlign: "left", padding: "8px 10px" }}>Tipo</th>
                      <th style={{ textAlign: "left", padding: "8px 10px" }}>Descripción</th>
                      <th style={{ textAlign: "left", padding: "8px 10px" }}>Duración</th>
                      <th style={{ textAlign: "left", padding: "8px 10px" }}>Distancia</th>
                      <th style={{ textAlign: "left", padding: "8px 10px" }}>Acciones</th>
                    </tr>
                  </thead>
                  <tbody>
                    {previewRows.length === 0 ? (
                      <tr>
                        <td colSpan={8} style={{ padding: "12px 14px", fontSize: ".82em", color: "#64748b", background: "#fafafa" }}>
                          Aún no hay sesiones. Usa el JSON arriba, genera con IA o pulsa «Agregar sesión».
                        </td>
                      </tr>
                    ) : (
                      previewRows.map((w, idx) => {
                        const cellPad = { padding: "8px 10px", verticalAlign: "top" };
                        const tid = resolvePlanSessionTypeId(w);
                        const tmeta = PLAN_SESSION_TYPE_OPTIONS.find((t) => t.id === tid);
                        const structPreview = w?.workout_structure ?? w?.structure;
                        const nStruct = Array.isArray(structPreview) ? normalizeWorkoutStructure(structPreview).length : 0;
                        return (
                          <tr key={`plan-row-${idx}`} style={{ borderBottom: "1px solid #f1f5f9", fontSize: ".78em", color: "#334155" }}>
                            <td style={cellPad}>{w?.week != null && w.week !== "" ? w.week : "—"}</td>
                            <td style={{ ...cellPad, minWidth: 88 }}>{w?.day ? String(w.day) : "—"}</td>
                            <td style={{ ...cellPad, minWidth: 120, fontWeight: 700 }}>{w?.title ? String(w.title) : "—"}</td>
                            <td style={cellPad}>
                              <span style={{ padding: "3px 8px", borderRadius: 999, background: `${tmeta?.color || "#64748b"}18`, color: tmeta?.color || "#64748b", fontWeight: 800, fontSize: ".92em" }}>
                                {tmeta?.label || tid || "—"}
                              </span>
                            </td>
                            <td style={{ ...cellPad, maxWidth: 260, minWidth: 140, lineHeight: 1.35 }}>{w?.description != null && String(w.description) !== "" ? String(w.description) : "—"}</td>
                            <td style={{ ...cellPad, whiteSpace: "nowrap" }}>{w?.duration_min != null && w.duration_min !== "" ? `${w.duration_min} min` : "—"}</td>
                            <td style={{ ...cellPad, whiteSpace: "nowrap" }}>{w?.distance_km != null && w.distance_km !== "" && Number.isFinite(Number(w.distance_km)) ? `${w.distance_km} km` : "—"}</td>
                            <td style={{ ...cellPad, whiteSpace: "nowrap" }}>
                              {nStruct > 0 ? (
                                <div style={{ fontSize: ".72em", color: "#64748b", marginBottom: 6 }}>{nStruct} bloque{nStruct !== 1 ? "s" : ""}</div>
                              ) : null}
                              <button type="button" onClick={() => openPlanSessionModalEdit(idx)} style={{ border: "1px solid #bae6fd", borderRadius: 6, padding: "5px 8px", background: "#f0f9ff", color: "#0369a1", cursor: "pointer", fontFamily: "inherit", fontSize: ".85em", marginRight: 6 }}>
                                ✏️ Editar
                              </button>
                              <button type="button" onClick={() => duplicatePlanRow(idx)} style={{ border: "1px solid #e2e8f0", borderRadius: 6, padding: "5px 8px", background: "#fff", cursor: "pointer", fontFamily: "inherit", fontSize: ".85em", marginRight: 6 }}>
                                ➕ Duplicar
                              </button>
                              <button type="button" onClick={() => deletePlanRow(idx)} style={{ border: "1px solid #fecaca", borderRadius: 6, padding: "5px 8px", background: "#fef2f2", color: "#b91c1c", cursor: "pointer", fontFamily: "inherit", fontSize: ".85em" }}>
                                🗑️ Eliminar
                              </button>
                            </td>
                          </tr>
                        );
                      })
                    )}
                  </tbody>
                </table>
              </div>
              <div style={{ padding: "10px 12px", borderTop: "1px solid #e2e8f0", background: "#fafafa" }}>
                <button type="button" onClick={openPlanSessionModalAdd} style={{ border: "1px solid #bae6fd", borderRadius: 8, padding: "8px 12px", background: "#f0f9ff", color: "#0369a1", fontWeight: 800, cursor: "pointer", fontFamily: "inherit", fontSize: ".8em" }}>
                  ➕ Agregar sesión
                </button>
              </div>
            </div>
          </div>
          <div style={{ gridColumn: "1 / -1", display: "flex", justifyContent: "flex-end" }}>
            <button type="button" onClick={createAdminPlan} disabled={creatingPlan} style={{ border: "none", borderRadius: 8, padding: "9px 14px", background: creatingPlan ? "#cbd5e1" : "linear-gradient(135deg,#0ea5e9,#0284c7)", color: "#fff", fontWeight: 800, cursor: creatingPlan ? "not-allowed" : "pointer", fontFamily: "inherit" }}>
              {creatingPlan ? "Guardando…" : createForm.editing_plan_id ? "Guardar y aprobar copia" : "Guardar plan (auto-aprobado)"}
            </button>
          </div>
        </div>
      </div>
      {loading ? (
        <div style={{ color: "#64748b" }}>Cargando marketplace…</div>
      ) : (
        <>
          <div style={{ ...S.card, marginBottom: 16, overflowX: "auto" }}>
            <table style={{ width: "100%", borderCollapse: "collapse", minWidth: 900 }}>
              <thead>
                <tr style={{ borderBottom: "1px solid #e2e8f0", color: "#64748b", fontSize: ".74em", textTransform: "uppercase", letterSpacing: ".08em" }}>
                  <th style={{ textAlign: "left", padding: "8px 6px" }}>Coach</th>
                  <th style={{ textAlign: "left", padding: "8px 6px" }}>Título</th>
                  <th style={{ textAlign: "left", padding: "8px 6px" }}>Nivel</th>
                  <th style={{ textAlign: "left", padding: "8px 6px" }}>Precio</th>
                  <th style={{ textAlign: "left", padding: "8px 6px" }}>Estado</th>
                  <th style={{ textAlign: "left", padding: "8px 6px" }}>Ventas</th>
                  <th style={{ textAlign: "left", padding: "8px 6px" }}>Comisión</th>
                  <th style={{ textAlign: "left", padding: "8px 6px" }}>Acciones</th>
                </tr>
              </thead>
              <tbody>
                {(plans || []).map((p) => {
                  const sales = Number(confirmedCountByPlan[String(p.id)] || 0);
                  const commission = Math.round(Number(p.price_cop || 0) * sales * 0.2);
                  return (
                    <tr key={p.id} style={{ borderBottom: "1px solid #f1f5f9" }}>
                      <td style={{ padding: "8px 6px", fontSize: ".82em" }}>{p.coach_name || p.coach_user_id || "Coach"}</td>
                      <td style={{ padding: "8px 6px", fontSize: ".82em", fontWeight: 700 }}>{p.title}</td>
                      <td style={{ padding: "8px 6px", fontSize: ".82em" }}>{p.level}</td>
                      <td style={{ padding: "8px 6px", fontSize: ".82em" }}>${formatCopInt(p.price_cop)}</td>
                      <td style={{ padding: "8px 6px", fontSize: ".82em", fontWeight: 700, color: p.is_active ? (p.is_approved ? "#16a34a" : "#b45309") : "#ef4444" }}>
                        {!p.is_active ? "Inactivo" : p.is_approved ? "Aprobado" : "Pendiente"}
                      </td>
                      <td style={{ padding: "8px 6px", fontSize: ".82em" }}>{sales}</td>
                      <td style={{ padding: "8px 6px", fontSize: ".82em" }}>
                        Comisión plataforma: ${formatCopInt(commission)} COP (20%)
                      </td>
                      <td style={{ padding: "8px 6px", fontSize: ".82em", display: "flex", gap: 6, flexWrap: "wrap" }}>
                        <button type="button" onClick={() => approvePlan(p.id)} style={{ border: "1px solid #bbf7d0", background: "#f0fdf4", color: "#166534", borderRadius: 7, padding: "5px 8px", fontWeight: 700, cursor: "pointer", fontFamily: "inherit", fontSize: ".74em" }}>✅ Aprobar</button>
                        <button type="button" onClick={() => rejectPlan(p.id)} style={{ border: "1px solid #fecaca", background: "#fef2f2", color: "#b91c1c", borderRadius: 7, padding: "5px 8px", fontWeight: 700, cursor: "pointer", fontFamily: "inherit", fontSize: ".74em" }}>🚫 Rechazar</button>
                        <button type="button" onClick={() => deletePlan(p.id)} style={{ border: "1px solid #e2e8f0", background: "#fff", color: "#334155", borderRadius: 7, padding: "5px 8px", fontWeight: 700, cursor: "pointer", fontFamily: "inherit", fontSize: ".74em" }}>🗑️ Eliminar</button>
                      </td>
                    </tr>
                  );
                })}
              </tbody>
            </table>
          </div>

          <div style={S.card}>
            <div style={{ fontSize: ".72em", letterSpacing: ".1em", textTransform: "uppercase", color: "#64748b", marginBottom: 10 }}>
              Compras pendientes de confirmar
            </div>
            {pendingPurchases.length === 0 ? (
              <div style={{ color: "#94a3b8", fontSize: ".84em" }}>No hay compras pendientes.</div>
            ) : (
              <div style={{ display: "grid", gap: 8 }}>
                {pendingPurchases.map((p) => (
                  <div key={p.id} style={{ border: "1px solid #e2e8f0", borderRadius: 10, padding: "10px 12px", background: "#f8fafc", display: "flex", justifyContent: "space-between", gap: 10, flexWrap: "wrap", alignItems: "center" }}>
                    <div style={{ fontSize: ".82em", color: "#334155" }}>
                      Plan: <strong>{p.plan_title || p.plan_id}</strong> · ${formatCopInt(p.amount_cop || 0)} COP · {p.buyer_name || p.buyer_user_id || "Comprador"}
                    </div>
                    <button type="button" onClick={() => confirmPayment(p.id)} style={{ border: "1px solid #bbf7d0", background: "#f0fdf4", color: "#166534", borderRadius: 8, padding: "7px 10px", fontWeight: 800, cursor: "pointer", fontFamily: "inherit", fontSize: ".76em" }}>
                      ✅ Confirmar pago
                    </button>
                  </div>
                ))}
              </div>
            )}
          </div>
        </>
      )}
      {aiModalOpen ? (
        <div style={{ position: "fixed", inset: 0, zIndex: 10040, background: "rgba(15,23,42,.45)", display: "flex", alignItems: "center", justifyContent: "center", padding: 16 }}>
          <div style={{ ...S.card, width: "100%", maxWidth: 620, margin: 0 }}>
            <div style={{ display: "flex", justifyContent: "space-between", alignItems: "center", marginBottom: 10 }}>
              <div style={{ fontSize: "1em", fontWeight: 900 }}>✨ Generar plan con IA</div>
              <button type="button" onClick={() => setAiModalOpen(false)} style={{ border: "1px solid #e2e8f0", background: "#fff", borderRadius: 8, padding: "6px 10px", cursor: "pointer", fontFamily: "inherit" }}>✕</button>
            </div>
            <div style={{ display: "grid", gridTemplateColumns: "repeat(2,minmax(0,1fr))", gap: 10 }}>
              <textarea value={aiContext} onChange={(e) => setAiContext(e.target.value)} rows={3} placeholder='Describe el plan (ej: "Plan maratón 16 semanas para principiante con 4 sesiones semanales")' style={{ gridColumn: "1 / -1", border: "1px solid #e2e8f0", borderRadius: 8, padding: "9px 10px", fontFamily: "inherit", boxSizing: "border-box" }} />
              <select value={aiLevel} onChange={(e) => setAiLevel(e.target.value)} style={{ border: "1px solid #e2e8f0", borderRadius: 8, padding: "9px 10px", fontFamily: "inherit" }}>
                <option value="principiante">Principiante</option>
                <option value="intermedio">Intermedio</option>
                <option value="avanzado">Avanzado</option>
              </select>
              <select value={aiGoal} onChange={(e) => setAiGoal(e.target.value)} style={{ border: "1px solid #e2e8f0", borderRadius: 8, padding: "9px 10px", fontFamily: "inherit" }}>
                <option value="5K">5K</option>
                <option value="10K">10K</option>
                <option value="21K">21K</option>
                <option value="42K">42K</option>
                <option value="Trail">Trail</option>
              </select>
              <select value={aiDurationWeeks} onChange={(e) => setAiDurationWeeks(e.target.value)} style={{ border: "1px solid #e2e8f0", borderRadius: 8, padding: "9px 10px", fontFamily: "inherit" }}>
                {["8", "12", "16", "20", "24"].map((w) => <option key={w} value={w}>{w} semanas</option>)}
              </select>
              <div style={{ gridColumn: "1 / -1" }}>
                <label style={{ display: "block", fontSize: ".72em", color: "#64748b", marginBottom: 6, fontWeight: 700 }}>Sesiones por semana</label>
                <select value={aiSessionsPerWeek} onChange={(e) => setAiSessionsPerWeek(e.target.value)} style={{ width: "100%", border: "1px solid #e2e8f0", borderRadius: 8, padding: "9px 10px", fontFamily: "inherit", boxSizing: "border-box" }}>
                  <option value="3">3</option>
                  <option value="4">4</option>
                  <option value="5">5</option>
                </select>
              </div>
            </div>
            <div style={{ display: "flex", justifyContent: "flex-end", marginTop: 12 }}>
              <button type="button" onClick={generatePlanWithAi} disabled={aiGenerating} style={{ border: "none", borderRadius: 8, padding: "9px 14px", background: aiGenerating ? "#cbd5e1" : "linear-gradient(135deg,#8b5cf6,#6366f1)", color: "#fff", fontWeight: 800, cursor: aiGenerating ? "not-allowed" : "pointer", fontFamily: "inherit" }}>
                {aiGenerating ? "Generando…" : "Generar con IA"}
              </button>
            </div>
          </div>
        </div>
      ) : null}
      {planSessionModalOpen ? (
        <div
          role="dialog"
          aria-modal="true"
          style={{ position: "fixed", inset: 0, zIndex: 10045, background: "rgba(15,23,42,.45)", display: "flex", alignItems: "stretch", justifyContent: "flex-end", padding: 0 }}
        >
          <div
            style={{
              width: "100%",
              maxWidth: 520,
              height: "100%",
              overflowY: "auto",
              background: "#fff",
              boxShadow: "-8px 0 32px rgba(15,23,42,.12)",
              borderLeft: "1px solid #e2e8f0",
              boxSizing: "border-box",
              padding: "18px 18px 24px",
            }}
          >
            <div style={{ display: "flex", justifyContent: "space-between", alignItems: "center", marginBottom: 14, gap: 10 }}>
              <div style={{ fontSize: "1.02em", fontWeight: 900, color: "#0f172a" }}>{planSessionModalIndex == null ? "➕ Nueva sesión del plan" : "✏️ Editar sesión"}</div>
              <button type="button" onClick={closePlanSessionModal} style={{ border: "1px solid #e2e8f0", background: "#fff", borderRadius: 8, padding: "6px 10px", cursor: "pointer", fontFamily: "inherit" }}>
                ✕
              </button>
            </div>
            <div style={{ display: "grid", gridTemplateColumns: "repeat(2,minmax(0,1fr))", gap: 10, marginBottom: 10 }}>
              <div>
                <div style={{ fontSize: ".72em", color: "#64748b", marginBottom: 6, fontWeight: 700 }}>Semana</div>
                <input
                  type="number"
                  min={1}
                  value={planSessionForm.week}
                  onChange={(e) => setPlanSessionForm((f) => ({ ...f, week: e.target.value }))}
                  style={{ width: "100%", background: "#ffffff", border: "1px solid #e2e8f0", borderRadius: 8, padding: "10px 12px", color: "#0f172a", fontFamily: "inherit", fontSize: ".85em", boxSizing: "border-box" }}
                />
              </div>
              <div>
                <div style={{ fontSize: ".72em", color: "#64748b", marginBottom: 6, fontWeight: 700 }}>Día</div>
                <select
                  value={planSessionForm.day}
                  onChange={(e) => setPlanSessionForm((f) => ({ ...f, day: e.target.value }))}
                  style={{ width: "100%", background: "#ffffff", border: "1px solid #e2e8f0", borderRadius: 8, padding: "10px 12px", color: "#0f172a", fontFamily: "inherit", fontSize: ".85em", boxSizing: "border-box" }}
                >
                  {PLAN_PREVIEW_FULL_DAYS.map((d) => (
                    <option key={d} value={d}>
                      {d}
                    </option>
                  ))}
                </select>
              </div>
              <div style={{ gridColumn: "1 / -1" }}>
                <div style={{ fontSize: ".72em", color: "#64748b", marginBottom: 6, fontWeight: 700 }}>Título del workout</div>
                <input
                  value={planSessionForm.title}
                  onChange={(e) => setPlanSessionForm((f) => ({ ...f, title: e.target.value }))}
                  placeholder="Ej: Rodaje suave 45 min"
                  style={{ width: "100%", background: "#ffffff", border: "1px solid #e2e8f0", borderRadius: 8, padding: "10px 12px", color: "#0f172a", fontFamily: "inherit", fontSize: ".85em", boxSizing: "border-box" }}
                />
              </div>
              <div style={{ gridColumn: "1 / -1" }}>
                <div style={{ fontSize: ".72em", color: "#64748b", marginBottom: 6, fontWeight: 700 }}>Tipo</div>
                <select
                  value={planSessionForm.type}
                  onChange={(e) => setPlanSessionForm((f) => ({ ...f, type: e.target.value }))}
                  style={{ width: "100%", background: "#ffffff", border: "1px solid #e2e8f0", borderRadius: 8, padding: "10px 12px", color: "#0f172a", fontFamily: "inherit", fontSize: ".85em", boxSizing: "border-box" }}
                >
                  {PLAN_SESSION_TYPE_OPTIONS.map((t) => (
                    <option key={t.id} value={t.id}>
                      {t.label}
                    </option>
                  ))}
                </select>
              </div>
              <div style={{ gridColumn: "1 / -1" }}>
                <div style={{ fontSize: ".72em", color: "#64748b", marginBottom: 6, fontWeight: 700 }}>Descripción</div>
                <textarea
                  value={planSessionForm.description}
                  onChange={(e) => setPlanSessionForm((f) => ({ ...f, description: e.target.value }))}
                  rows={3}
                  placeholder="Notas para el atleta, objetivo de la sesión…"
                  style={{ width: "100%", background: "#ffffff", border: "1px solid #e2e8f0", borderRadius: 8, padding: "10px 12px", color: "#0f172a", fontFamily: "inherit", fontSize: ".85em", resize: "vertical", boxSizing: "border-box" }}
                />
              </div>
              <div>
                <div style={{ fontSize: ".72em", color: "#64748b", marginBottom: 6, fontWeight: 700 }}>Duración (minutos)</div>
                <input
                  type="number"
                  min={0}
                  value={planSessionForm.duration_min}
                  onChange={(e) => setPlanSessionForm((f) => ({ ...f, duration_min: e.target.value }))}
                  style={{ width: "100%", background: "#ffffff", border: "1px solid #e2e8f0", borderRadius: 8, padding: "10px 12px", color: "#0f172a", fontFamily: "inherit", fontSize: ".85em", boxSizing: "border-box" }}
                />
              </div>
              <div>
                <div style={{ fontSize: ".72em", color: "#64748b", marginBottom: 6, fontWeight: 700 }}>Distancia (km)</div>
                <input
                  type="number"
                  min={0}
                  step="0.1"
                  value={planSessionForm.distance_km}
                  onChange={(e) => setPlanSessionForm((f) => ({ ...f, distance_km: e.target.value }))}
                  style={{ width: "100%", background: "#ffffff", border: "1px solid #e2e8f0", borderRadius: 8, padding: "10px 12px", color: "#0f172a", fontFamily: "inherit", fontSize: ".85em", boxSizing: "border-box" }}
                />
              </div>
            </div>
            <div style={{ fontSize: ".65em", letterSpacing: ".13em", color: "#475569", textTransform: "uppercase", marginBottom: 10 }}>Estructura de intervalos</div>
            <div style={{ display: "flex", flexDirection: "column", gap: 10 }}>
              {planSessionForm.structureRows.map((row, idx) => (
                <div
                  key={idx}
                  style={{
                    border: "1px solid #e2e8f0",
                    borderRadius: 10,
                    padding: "12px 12px",
                    background: "#f8fafc",
                  }}
                >
                  <div style={{ display: "flex", justifyContent: "space-between", alignItems: "center", marginBottom: 8, flexWrap: "wrap", gap: 8 }}>
                    <span style={{ fontSize: ".75em", fontWeight: 800, color: "#334155" }}>Paso {idx + 1}</span>
                    <div style={{ display: "flex", gap: 6, flexWrap: "wrap" }}>
                      <button
                        type="button"
                        disabled={idx === 0}
                        onClick={() => movePlanSessionStructureRow(idx, -1)}
                        style={{
                          background: idx === 0 ? "#f1f5f9" : "#fff",
                          border: "1px solid #e2e8f0",
                          borderRadius: 6,
                          padding: "4px 10px",
                          fontSize: ".72em",
                          cursor: idx === 0 ? "not-allowed" : "pointer",
                          fontFamily: "inherit",
                          fontWeight: 700,
                        }}
                      >
                        ↑
                      </button>
                      <button
                        type="button"
                        disabled={idx >= planSessionForm.structureRows.length - 1}
                        onClick={() => movePlanSessionStructureRow(idx, 1)}
                        style={{
                          background: idx >= planSessionForm.structureRows.length - 1 ? "#f1f5f9" : "#fff",
                          border: "1px solid #e2e8f0",
                          borderRadius: 6,
                          padding: "4px 10px",
                          fontSize: ".72em",
                          cursor: idx >= planSessionForm.structureRows.length - 1 ? "not-allowed" : "pointer",
                          fontFamily: "inherit",
                          fontWeight: 700,
                        }}
                      >
                        ↓
                      </button>
                      <button
                        type="button"
                        disabled={planSessionForm.structureRows.length <= 1}
                        onClick={() =>
                          setPlanSessionForm((f) => ({
                            ...f,
                            structureRows: f.structureRows.length <= 1 ? f.structureRows : f.structureRows.filter((_, j) => j !== idx),
                          }))
                        }
                        style={{
                          background: "transparent",
                          border: "1px solid #fecaca",
                          borderRadius: 6,
                          padding: "4px 10px",
                          fontSize: ".72em",
                          color: planSessionForm.structureRows.length <= 1 ? "#cbd5e1" : "#b91c1c",
                          cursor: planSessionForm.structureRows.length <= 1 ? "not-allowed" : "pointer",
                          fontFamily: "inherit",
                          fontWeight: 700,
                        }}
                      >
                        🗑️
                      </button>
                    </div>
                  </div>
                  <div style={{ display: "grid", gridTemplateColumns: "repeat(2,minmax(0,1fr))", gap: 8 }}>
                    <div>
                      <div style={{ fontSize: ".65em", color: "#94a3b8", marginBottom: 4 }}>Tipo de bloque</div>
                      <select
                        value={row.block_type}
                        onChange={(e) =>
                          setPlanSessionForm((f) => {
                            const next = [...f.structureRows];
                            next[idx] = { ...next[idx], block_type: e.target.value };
                            return { ...f, structureRows: next };
                          })
                        }
                        style={{ width: "100%", background: "#fff", border: "1px solid #e2e8f0", borderRadius: 8, padding: "8px 10px", fontSize: ".82em", fontFamily: "inherit", boxSizing: "border-box" }}
                      >
                        {WORKOUT_BLOCK_TYPES.map((bt) => (
                          <option key={bt} value={bt}>
                            {bt}
                          </option>
                        ))}
                      </select>
                    </div>
                    <div>
                      <div style={{ fontSize: ".65em", color: "#94a3b8", marginBottom: 4 }}>Duración (minutos)</div>
                      <input
                        value={row.duration_min}
                        onChange={(e) =>
                          setPlanSessionForm((f) => {
                            const next = [...f.structureRows];
                            next[idx] = { ...next[idx], duration_min: e.target.value };
                            return { ...f, structureRows: next };
                          })
                        }
                        placeholder="Ej: 12"
                        style={{ width: "100%", background: "#fff", border: "1px solid #e2e8f0", borderRadius: 8, padding: "8px 10px", fontSize: ".82em", fontFamily: "inherit", boxSizing: "border-box" }}
                      />
                    </div>
                    <div>
                      <div style={{ fontSize: ".65em", color: "#94a3b8", marginBottom: 4 }}>Distancia (km)</div>
                      <input
                        value={row.distance_km}
                        onChange={(e) =>
                          setPlanSessionForm((f) => {
                            const next = [...f.structureRows];
                            next[idx] = { ...next[idx], distance_km: e.target.value };
                            return { ...f, structureRows: next };
                          })
                        }
                        placeholder="Opcional"
                        style={{ width: "100%", background: "#fff", border: "1px solid #e2e8f0", borderRadius: 8, padding: "8px 10px", fontSize: ".82em", fontFamily: "inherit", boxSizing: "border-box" }}
                      />
                    </div>
                    <div>
                      <div style={{ fontSize: ".65em", color: "#94a3b8", marginBottom: 4 }}>Ritmo objetivo (MM:SS /km)</div>
                      <input
                        value={row.target_pace}
                        onChange={(e) =>
                          setPlanSessionForm((f) => {
                            const next = [...f.structureRows];
                            next[idx] = { ...next[idx], target_pace: e.target.value };
                            return { ...f, structureRows: next };
                          })
                        }
                        placeholder="Ej: 4:30"
                        style={{ width: "100%", background: "#fff", border: "1px solid #e2e8f0", borderRadius: 8, padding: "8px 10px", fontSize: ".82em", fontFamily: "inherit", boxSizing: "border-box" }}
                      />
                    </div>
                    <div>
                      <div style={{ fontSize: ".65em", color: "#94a3b8", marginBottom: 4 }}>FC objetivo (lpm)</div>
                      <input
                        value={row.target_hr}
                        onChange={(e) =>
                          setPlanSessionForm((f) => {
                            const next = [...f.structureRows];
                            next[idx] = { ...next[idx], target_hr: e.target.value };
                            return { ...f, structureRows: next };
                          })
                        }
                        placeholder="Ej: 140-160"
                        style={{ width: "100%", background: "#fff", border: "1px solid #e2e8f0", borderRadius: 8, padding: "8px 10px", fontSize: ".82em", fontFamily: "inherit", boxSizing: "border-box" }}
                      />
                    </div>
                    <div style={{ gridColumn: "1 / -1" }}>
                      <div style={{ fontSize: ".65em", color: "#94a3b8", marginBottom: 4 }}>Descripción</div>
                      <input
                        value={row.description}
                        onChange={(e) =>
                          setPlanSessionForm((f) => {
                            const next = [...f.structureRows];
                            next[idx] = { ...next[idx], description: e.target.value };
                            return { ...f, structureRows: next };
                          })
                        }
                        placeholder="Texto libre"
                        style={{ width: "100%", background: "#fff", border: "1px solid #e2e8f0", borderRadius: 8, padding: "8px 10px", fontSize: ".82em", fontFamily: "inherit", boxSizing: "border-box" }}
                      />
                    </div>
                  </div>
                </div>
              ))}
            </div>
            <button
              type="button"
              onClick={() => setPlanSessionForm((f) => ({ ...f, structureRows: [...f.structureRows, emptyWorkoutStructureRow()] }))}
              style={{
                marginTop: 12,
                width: "100%",
                background: "#eff6ff",
                border: "1px solid #bfdbfe",
                borderRadius: 8,
                padding: "10px 14px",
                color: "#1d4ed8",
                fontWeight: 800,
                cursor: "pointer",
                fontFamily: "inherit",
                fontSize: ".82em",
              }}
            >
              ➕ Agregar bloque
            </button>
            <div style={{ display: "flex", justifyContent: "flex-end", gap: 10, marginTop: 18, flexWrap: "wrap" }}>
              <button type="button" onClick={closePlanSessionModal} style={{ border: "1px solid #e2e8f0", borderRadius: 8, background: "#fff", padding: "10px 16px", cursor: "pointer", fontFamily: "inherit", fontWeight: 700, color: "#475569" }}>
                Cancelar
              </button>
              <button type="button" onClick={savePlanSessionModal} style={{ border: "none", borderRadius: 8, padding: "10px 16px", background: "linear-gradient(135deg,#0ea5e9,#0284c7)", color: "#fff", fontWeight: 800, cursor: "pointer", fontFamily: "inherit" }}>
                Guardar sesión
              </button>
            </div>
          </div>
        </div>
      ) : null}
    </div>
  );
}

export default AdminMarketplacePanel;
