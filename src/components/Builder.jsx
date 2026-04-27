import React, { useState, useEffect, useMemo, useCallback, useRef } from "react";
import { supabase } from "../lib/supabase";
import {
  WORKOUT_TYPES,
  WORKOUT_BLOCK_TYPES,
  formatLocalYMD,
  addDays,
  normalizeWorkoutStructure,
  emptyWorkoutStructureRow,
  workoutStructureToEditableRows,
  editableRowsToWorkoutStructure,
  extractJsonFromAnthropicText,
  formatDurationClock,
  STRAVA_CALLBACK_URL,
  normalizeAthlete,
  libraryRowToBuilderWorkout,
  normalizeLibraryRow,
} from "./shared/appShared";

function Builder({ athletes, aiPrompt, setAiPrompt, aiWorkout, setAiWorkout, aiLoading, setAiLoading, notify, coachUserId, coachPlan, profileRole, onGoToPlans, onWorkoutAssigned, onSavedToLibrary }) {
  const S = styles;
  const [builderTab, setBuilderTab] = useState(() => {
    if (typeof window === "undefined") return "ai";
    const saved = localStorage.getItem(TAB_KEY_CREATE_WORKOUT);
    return saved === "manual" ? "manual" : "ai";
  });
  const [manualForm, setManualForm] = useState({
    title: "",
    type: "easy",
    total_km: "",
    duration_min: "",
    description: "",
    structureRows: [emptyWorkoutStructureRow()],
  });
  const [showAssignModal, setShowAssignModal] = useState(false);
  const [savingLibrary, setSavingLibrary] = useState(false);
  const [assignEnabledOnSave, setAssignEnabledOnSave] = useState(true);
  const [assignAthleteIds, setAssignAthleteIds] = useState([]);
  const [assignDate, setAssignDate] = useState(() => formatLocalYMD(new Date()));
  const [assignSaving, setAssignSaving] = useState(false);
  const [builderHrAthleteId, setBuilderHrAthleteId] = useState("");
  const [monthGenerations, setMonthGenerations] = useState(0);
  const [loadingGenerations, setLoadingGenerations] = useState(false);
  const [generationLimitMsg, setGenerationLimitMsg] = useState("");
  const monthKey = useMemo(() => getCurrentMonthKey(), []);
  const isBasicPlan = useMemo(() => {
    const p = String(coachPlan || "").toLowerCase();
    return p === "basico" || p === "básico" || p === "starter" || p === "";
  }, [coachPlan]);
  const isAdminRole = profileRole === "admin";

  const loadGenerationCounter = useCallback(async () => {
    if (!coachUserId) {
      setMonthGenerations(0);
      return;
    }
    setLoadingGenerations(true);
    const { data, error } = await supabase
      .from("ai_generations")
      .select("count")
      .eq("coach_id", coachUserId)
      .eq("month", monthKey)
      .maybeSingle();
    setLoadingGenerations(false);
    if (error) {
      console.error("ai_generations load (builder):", error);
      return;
    }
    setMonthGenerations(Number(data?.count) || 0);
  }, [coachUserId, monthKey]);

  const incrementGenerationCounter = useCallback(async () => {
    if (!coachUserId) return;
    const nextCount = (Number(monthGenerations) || 0) + 1;
    const { error: updErr } = await supabase
      .from("ai_generations")
      .update({ count: nextCount, updated_at: new Date().toISOString() })
      .eq("coach_id", coachUserId)
      .eq("month", monthKey);
    if (updErr) {
      const { error: insErr } = await supabase.from("ai_generations").insert({
        coach_id: coachUserId,
        month: monthKey,
        count: 1,
        updated_at: new Date().toISOString(),
      });
      if (insErr) {
        console.error("ai_generations increment (builder):", insErr);
        return;
      }
      setMonthGenerations(1);
      return;
    }
    setMonthGenerations(nextCount);
  }, [coachUserId, monthGenerations, monthKey]);

  useEffect(() => {
    loadGenerationCounter();
  }, [loadGenerationCounter]);

  useEffect(() => {
    if (typeof window === "undefined") return;
    localStorage.setItem(TAB_KEY_CREATE_WORKOUT, builderTab === "manual" ? "manual" : "ia");
  }, [builderTab]);

  const previewWorkout = useMemo(() => {
    if (builderTab === "manual") {
      if (!(manualForm.title || "").trim()) return null;
      const type = WORKOUT_TYPES.some((t) => t.id === manualForm.type) ? manualForm.type : "easy";
      return {
        title: manualForm.title.trim() || "Workout",
        type,
        total_km: Number(manualForm.total_km) || 0,
        duration_min: Math.round(Number(manualForm.duration_min)) || 0,
        description: (manualForm.description || "").trim(),
        structure: editableRowsToWorkoutStructure(manualForm.structureRows),
      };
    }
    return aiWorkout;
  }, [builderTab, manualForm, aiWorkout]);

  const openAssignModal = () => {
    if (!previewWorkout) return;
    setAssignDate(formatLocalYMD(new Date()));
    setAssignEnabledOnSave(true);
    setAssignAthleteIds((athletes || []).map((a) => String(a.id)));
    setShowAssignModal(true);
  };

  const saveAssignedWorkout = async () => {
    const w = previewWorkout;
    if (!w) return;
    if (!assignEnabledOnSave) {
      alert("Activa la opción de asignación para guardar este workout.");
      return;
    }
    const selectedAthletes = (athletes || []).filter((a) => assignAthleteIds.includes(String(a.id)));
    if (selectedAthletes.length === 0) {
      alert("Selecciona al menos un atleta.");
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
      const payload = selectedAthletes.map((selectedAthlete) => ({
        ...w,
        workout_structure: Array.isArray(w.structure) ? w.structure : [],
        athlete_id: selectedAthlete.id,
        coach_id: userData.user.id,
        scheduled_date: assignDate,
        done: false,
      }));
      const { error } = await supabase.from("workouts").insert(payload);
      if (error) {
        console.error("Error guardando workout asignado:", error);
        alert(`Error: ${error.message}\n${error.details || ""}\n${error.hint || ""}`);
        return;
      }

      await Promise.all(
        selectedAthletes.map(async (selectedAthlete) => {
          if (selectedAthlete.email) {
            try {
              const structureRows = Array.isArray(w?.structure)
                ? w.structure.map((s) => `<p>• <strong>${s.phase || ""}</strong>: ${s.duration || ""} · ${s.pace || ""}</p>`).join("")
                : "";
              await fetch("/api/send-email", {
                method: "POST",
                headers: { "Content-Type": "application/json" },
                body: JSON.stringify({
                  to: selectedAthlete.email,
                  subject: `Nuevo entrenamiento: ${w.title}`,
                  html: `
      <h2>Hola ${selectedAthlete.name} 👋</h2>
      <p>Tu coach te ha asignado un nuevo entrenamiento:</p>
      <h3>${w.title}</h3>
      <p><strong>Fecha:</strong> ${assignDate}</p>
      <p><strong>Descripción:</strong> ${w.description}</p>
      <p><strong>Distancia:</strong> ${w.total_km} km</p>
      <p><strong>Duración:</strong> ${w.duration_min} minutos</p>
      <h4>Estructura:</h4>
      ${structureRows}
      <br/><p>¡Mucho éxito! 💪</p>
      <p>— Tu coach en ${BRAND_NAME}</p>
    `,
                }),
              });
            } catch (e) {
              console.error("Error llamando /api/send-email:", e);
            }
          }
          await sendWorkoutAssignmentPushToAthlete({
            athleteUserId: selectedAthlete?.user_id,
            workoutTitle: w.title,
            scheduledDate: assignDate,
          });
        }),
      );

      setShowAssignModal(false);
      onWorkoutAssigned?.();
      notify(`Workout asignado a ${selectedAthletes.length} atletas`);
    } finally {
      setAssignSaving(false);
    }
  };

  const generateWorkout = async () => {
    if (!aiPrompt.trim()) return;
    if (profileRole === "admin") {
      // admin no tiene límite, saltar verificación
    } else {
      // verificar límite normal según plan
      if (isBasicPlan && monthGenerations >= 100) {
        setGenerationLimitMsg("Has alcanzado el límite de 100 generaciones del plan Básico. Actualiza al plan Pro para generaciones ilimitadas.");
        return;
      }
    }
    setGenerationLimitMsg("");
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
      await incrementGenerationCounter();
    } catch { setAiWorkout(null); }
    finally { setAiLoading(false); }
  };

  const exportGarmin = () => {
    const w = previewWorkout;
    if (!w) return;
    const blob = new Blob([JSON.stringify(w, null, 2)], { type: "application/json" });
    const url = URL.createObjectURL(blob);
    const a = document.createElement("a");
    a.href = url; a.download = `${String(w.title || "workout").replace(/\s+/g, "_")}_garmin.json`; a.click();
    URL.revokeObjectURL(url);
    notify("Exportado para Garmin ✓");
  };

  const saveToLibrary = async () => {
    const w = previewWorkout;
    if (!w) return;
    const { data: userData, error: userError } = await supabase.auth.getUser();
    if (userError || !userData?.user) {
      alert(userError?.message || "No hay usuario autenticado.");
      return;
    }
    const type = WORKOUT_TYPES.some((t) => t.id === w.type) ? w.type : "easy";
    const row = {
      coach_id: userData.user.id,
      title: (w.title && String(w.title).trim()) || "Workout",
      type,
      total_km: Number.isFinite(Number(w.total_km)) ? Number(w.total_km) : 0,
      duration_min: Number.isFinite(Number(w.duration_min)) ? Math.round(Number(w.duration_min)) : 0,
      description: w.description != null ? String(w.description) : "",
      structure: Array.isArray(w.structure) ? w.structure : [],
      workout_structure: Array.isArray(w.structure) ? w.structure : [],
    };
    setSavingLibrary(true);
    try {
      const { error } = await supabase.from("workout_library").insert(row);
      if (error) {
        console.error("workout_library insert:", error);
        notify(`Error al guardar en biblioteca: ${error.message}`);
        return;
      }
      onSavedToLibrary?.();
      notify("Guardado en biblioteca ✓");
    } finally {
      setSavingLibrary(false);
    }
  };

  const moveManualPhase = (idx, dir) => {
    setManualForm((f) => {
      const next = [...f.structureRows];
      const j = idx + dir;
      if (j < 0 || j >= next.length) return f;
      [next[idx], next[j]] = [next[j], next[idx]];
      return { ...f, structureRows: next };
    });
  };

  const wtPreview = previewWorkout ? WORKOUT_TYPES.find((t) => t.id === previewWorkout.type) || WORKOUT_TYPES[0] : null;

  return (
    <div style={S.page}>
      <div style={{ marginBottom: 20 }}>
        <h1 style={S.pageTitle}>Crear Workout</h1>
        <p style={{ color: "#475569", fontSize: ".82em", marginTop: 4 }}>
          {builderTab === "ai"
            ? "Genera con IA o construye tu sesión paso a paso en modo manual."
            : "Define título, tipo, volumen y fases; luego guarda, asigna o exporta."}
        </p>
        <div style={{ display: "flex", gap: 8, marginTop: 16, flexWrap: "wrap" }}>
          <button
            type="button"
            onClick={() => setBuilderTab("ai")}
            style={{
              padding: "10px 16px",
              borderRadius: 10,
              border: builderTab === "ai" ? "2px solid #f59e0b" : "1px solid #e2e8f0",
              background: builderTab === "ai" ? "rgba(245,158,11,.12)" : "#ffffff",
              color: "#0f172a",
              fontWeight: 800,
              cursor: "pointer",
              fontFamily: "inherit",
              fontSize: ".85em",
            }}
          >
            ⚡ Generar con IA
          </button>
          <button
            type="button"
            onClick={() => setBuilderTab("manual")}
            style={{
              padding: "10px 16px",
              borderRadius: 10,
              border: builderTab === "manual" ? "2px solid #3b82f6" : "1px solid #e2e8f0",
              background: builderTab === "manual" ? "rgba(59,130,246,.1)" : "#ffffff",
              color: "#0f172a",
              fontWeight: 800,
              cursor: "pointer",
              fontFamily: "inherit",
              fontSize: ".85em",
            }}
          >
            ✍️ Crear Manual
          </button>
        </div>
        {builderTab === "ai" ? (
          <div style={{ marginTop: 10, color: isAdminRole ? "#16a34a" : "#64748b", fontSize: ".8em", fontWeight: 600 }}>
            {isAdminRole ? "Generaciones ilimitadas ∞" : isBasicPlan ? `${loadingGenerations ? "…" : monthGenerations} / 100 generaciones usadas este mes` : "Ilimitado"}
          </div>
        ) : null}
      </div>
      {builderTab === "ai" && generationLimitMsg ? (
        <div style={{ ...S.card, marginBottom: 14, border: "1px solid rgba(245,158,11,.4)", background: "#fffbeb" }}>
          <div style={{ color: "#92400e", fontSize: ".84em", fontWeight: 700, marginBottom: 10 }}>{generationLimitMsg}</div>
          <div style={{ display: "flex", justifyContent: "flex-end" }}>
            <button
              type="button"
              onClick={onGoToPlans}
              style={{ background: "linear-gradient(135deg,#0d9488,#14b8a6)", border: "none", borderRadius: 8, padding: "8px 12px", color: "#fff", fontWeight: 800, cursor: "pointer", fontFamily: "inherit", fontSize: ".78em" }}
            >
              Ver Planes
            </button>
          </div>
        </div>
      ) : null}
      <div style={{ display: "grid", gridTemplateColumns: "minmax(0,1fr) minmax(0,1fr)", gap: 24 }}>
        <div style={S.card}>
          {builderTab === "ai" ? (
            <>
              <div style={{ fontSize: ".65em", letterSpacing: ".13em", color: "#475569", textTransform: "uppercase", marginBottom: 14 }}>⚡ DESCRIBE EL ENTRENAMIENTO</div>
              <div style={{ marginBottom: 12 }}>
                <div style={{ fontSize: ".72em", color: "#64748b", marginBottom: 6 }}>Zonas FC en el prompt (atleta con FC máx guardada)</div>
                <select
                  value={builderHrAthleteId}
                  onChange={(e) => setBuilderHrAthleteId(e.target.value)}
                  style={{ width: "100%", background: "#ffffff", border: "1px solid #e2e8f0", borderRadius: 8, padding: "10px 12px", color: "#0f172a", fontFamily: "inherit", fontSize: ".85em", outline: "none", boxSizing: "border-box" }}
                >
                  <option value="">Sin zonas FC en el prompt</option>
                  {(athletes || []).map((a) => (
                    <option key={a.id} value={String(a.id)}>
                      {a.name}{a.fc_max ? ` (${a.fc_max} lpm)` : " — sin FC máx"}
                    </option>
                  ))}
                </select>
              </div>
              <textarea value={aiPrompt} onChange={(e) => setAiPrompt(e.target.value)} placeholder="Ej: Intervalos 6x800m para atleta sub 4h maratón..." style={{ width: "100%", background: "#ffffff", border: "1px solid #e2e8f0", borderRadius: 8, padding: "12px 14px", color: "#0f172a", fontFamily: "inherit", fontSize: ".85em", resize: "vertical", outline: "none", marginBottom: 12, boxSizing: "border-box" }} rows={5} />
              <div style={{ marginBottom: 12 }}>
                <div style={{ fontSize: ".72em", color: "#475569", marginBottom: 8 }}>SUGERENCIAS:</div>
                {["Intervalos 6x800m para atleta sub 4h maratón", "Rodaje largo 28km semana 18 de plan", "Tempo 8km para media maratón zona 3-4"].map((s, i) => (
                  <div key={i} onClick={() => setAiPrompt(s)} style={{ background: "#f8fafc", border: "1px solid #e2e8f0", borderRadius: 6, padding: "8px 12px", fontSize: ".75em", color: "#64748b", cursor: "pointer", marginBottom: 6 }}>{s}</div>
                ))}
              </div>
              <button
                type="button"
                onClick={() => {
                  generateWorkout();
                }}
                disabled={aiLoading || !aiPrompt.trim()}
                style={{ width: "100%", background: !aiPrompt.trim() ? "#e2e8f0" : "linear-gradient(135deg,#b45309,#f59e0b)", border: "none", borderRadius: 8, padding: "11px 20px", color: !aiPrompt.trim() ? "#334155" : "white", fontWeight: 700, cursor: !aiPrompt.trim() ? "not-allowed" : "pointer", fontSize: ".85em", fontFamily: "inherit" }}
              >
                {aiLoading ? "⏳ Generando..." : "⚡ GENERAR WORKOUT"}
              </button>
            </>
          ) : (
            <>
              <div style={{ fontSize: ".65em", letterSpacing: ".13em", color: "#475569", textTransform: "uppercase", marginBottom: 14 }}>✍️ DATOS DEL ENTRENAMIENTO</div>
              <div style={{ marginBottom: 10 }}>
                <div style={{ fontSize: ".72em", color: "#64748b", marginBottom: 6 }}>Título del workout</div>
                <input
                  value={manualForm.title}
                  onChange={(e) => setManualForm((f) => ({ ...f, title: e.target.value }))}
                  placeholder="Ej: Tempo 8 km + strides"
                  style={{ width: "100%", background: "#ffffff", border: "1px solid #e2e8f0", borderRadius: 8, padding: "10px 12px", color: "#0f172a", fontFamily: "inherit", fontSize: ".85em", boxSizing: "border-box" }}
                />
              </div>
              <div style={{ display: "grid", gridTemplateColumns: "repeat(2,minmax(0,1fr))", gap: 10, marginBottom: 10 }}>
                <div style={{ gridColumn: "1 / -1" }}>
                  <div style={{ fontSize: ".72em", color: "#64748b", marginBottom: 6 }}>Tipo</div>
                  <select
                    value={manualForm.type}
                    onChange={(e) => setManualForm((f) => ({ ...f, type: e.target.value }))}
                    style={{ width: "100%", background: "#ffffff", border: "1px solid #e2e8f0", borderRadius: 8, padding: "10px 12px", color: "#0f172a", fontFamily: "inherit", fontSize: ".85em", boxSizing: "border-box" }}
                  >
                    {WORKOUT_TYPES.map((t) => (
                      <option key={t.id} value={t.id}>
                        {t.label}
                      </option>
                    ))}
                  </select>
                </div>
                <div>
                  <div style={{ fontSize: ".72em", color: "#64748b", marginBottom: 6 }}>Distancia total (km)</div>
                  <input
                    type="number"
                    min={0}
                    step="0.1"
                    value={manualForm.total_km}
                    onChange={(e) => setManualForm((f) => ({ ...f, total_km: e.target.value }))}
                    style={{ width: "100%", background: "#ffffff", border: "1px solid #e2e8f0", borderRadius: 8, padding: "10px 12px", color: "#0f172a", fontFamily: "inherit", fontSize: ".85em", boxSizing: "border-box" }}
                  />
                </div>
                <div>
                  <div style={{ fontSize: ".72em", color: "#64748b", marginBottom: 6 }}>Duración (min)</div>
                  <input
                    type="number"
                    min={0}
                    step="1"
                    value={manualForm.duration_min}
                    onChange={(e) => setManualForm((f) => ({ ...f, duration_min: e.target.value }))}
                    style={{ width: "100%", background: "#ffffff", border: "1px solid #e2e8f0", borderRadius: 8, padding: "10px 12px", color: "#0f172a", fontFamily: "inherit", fontSize: ".85em", boxSizing: "border-box" }}
                  />
                </div>
              </div>
              <div style={{ marginBottom: 14 }}>
                <div style={{ fontSize: ".72em", color: "#64748b", marginBottom: 6 }}>Descripción general</div>
                <textarea
                  value={manualForm.description}
                  onChange={(e) => setManualForm((f) => ({ ...f, description: e.target.value }))}
                  rows={3}
                  placeholder="Notas para el atleta, objetivo de la sesión…"
                  style={{ width: "100%", background: "#ffffff", border: "1px solid #e2e8f0", borderRadius: 8, padding: "10px 12px", color: "#0f172a", fontFamily: "inherit", fontSize: ".85em", resize: "vertical", boxSizing: "border-box" }}
                />
              </div>
              <div style={{ fontSize: ".65em", letterSpacing: ".13em", color: "#475569", textTransform: "uppercase", marginBottom: 10 }}>ESTRUCTURA DEL WORKOUT</div>
              <div style={{ display: "flex", flexDirection: "column", gap: 10 }}>
                {manualForm.structureRows.map((row, idx) => (
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
                          onClick={() => moveManualPhase(idx, -1)}
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
                          disabled={idx >= manualForm.structureRows.length - 1}
                          onClick={() => moveManualPhase(idx, 1)}
                          style={{
                            background: idx >= manualForm.structureRows.length - 1 ? "#f1f5f9" : "#fff",
                            border: "1px solid #e2e8f0",
                            borderRadius: 6,
                            padding: "4px 10px",
                            fontSize: ".72em",
                            cursor: idx >= manualForm.structureRows.length - 1 ? "not-allowed" : "pointer",
                            fontFamily: "inherit",
                            fontWeight: 700,
                          }}
                        >
                          ↓
                        </button>
                        <button
                          type="button"
                          disabled={manualForm.structureRows.length <= 1}
                          onClick={() =>
                            setManualForm((f) => ({
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
                            color: manualForm.structureRows.length <= 1 ? "#cbd5e1" : "#b91c1c",
                            cursor: manualForm.structureRows.length <= 1 ? "not-allowed" : "pointer",
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
                            setManualForm((f) => {
                              const next = [...f.structureRows];
                              next[idx] = { ...next[idx], block_type: e.target.value };
                              return { ...f, structureRows: next };
                            })
                          }
                          style={{ width: "100%", background: "#fff", border: "1px solid #e2e8f0", borderRadius: 8, padding: "8px 10px", fontSize: ".82em", fontFamily: "inherit", boxSizing: "border-box" }}
                        >
                          {WORKOUT_BLOCK_TYPES.map((bt) => <option key={bt} value={bt}>{bt}</option>)}
                        </select>
                      </div>
                      <div>
                        <div style={{ fontSize: ".65em", color: "#94a3b8", marginBottom: 4 }}>Duración (minutos)</div>
                        <input
                          value={row.duration_min}
                          onChange={(e) =>
                            setManualForm((f) => {
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
                            setManualForm((f) => {
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
                            setManualForm((f) => {
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
                            setManualForm((f) => {
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
                            setManualForm((f) => {
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
                onClick={() => setManualForm((f) => ({ ...f, structureRows: [...f.structureRows, emptyWorkoutStructureRow()] }))}
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
            </>
          )}
        </div>
        <div style={S.card}>
          {previewWorkout ? (
            <>
              <div style={{ marginBottom: 12, display: "flex", alignItems: "center", gap: 10, flexWrap: "wrap" }}>
                <span style={{ fontSize: ".72em", padding: "4px 10px", borderRadius: 999, background: `${wtPreview?.color || "#64748b"}22`, color: wtPreview?.color || "#64748b", fontWeight: 800 }}>
                  {wtPreview?.label || previewWorkout.type}
                </span>
              </div>
              <div style={{ marginBottom: 16 }}>
                <div style={{ fontSize: "1.1em", fontWeight: 700, color: "#0f172a" }}>{previewWorkout.title}</div>
                <div style={{ fontSize: ".75em", color: "#64748b", marginTop: 2 }}>{previewWorkout.description || "—"}</div>
              </div>
              <div style={{ display: "flex", gap: 16, marginBottom: 16, fontSize: ".78em", color: "#94a3b8" }}>
                <span>📍 {previewWorkout.total_km} km</span>
                <span>⏱ {previewWorkout.duration_min} min</span>
              </div>
              <div style={{ fontSize: ".65em", letterSpacing: ".13em", color: "#475569", textTransform: "uppercase", marginBottom: 10 }}>ESTRUCTURA</div>
              {(previewWorkout.structure || []).length === 0 ? (
                <div style={{ fontSize: ".8em", color: "#94a3b8", marginBottom: 12 }}>Sin fases en estructura (opcional).</div>
              ) : (
                <WorkoutStructureTable structure={previewWorkout.structure} />
              )}
              <div style={{ display: "flex", flexWrap: "wrap", gap: 10, marginTop: 16 }}>
                <button type="button" onClick={exportGarmin} style={{ background: "rgba(22,163,74,.12)", border: "1px solid rgba(22,163,74,.3)", borderRadius: 8, padding: "8px 14px", color: "#22c55e", cursor: "pointer", fontSize: ".78em", fontFamily: "inherit", fontWeight: 600 }}>⌚ Exportar a Garmin</button>
                <button
                  type="button"
                  onClick={saveToLibrary}
                  disabled={savingLibrary}
                  style={{
                    background: savingLibrary ? "#e2e8f0" : "rgba(168,85,247,.12)",
                    border: `1px solid ${savingLibrary ? "#e2e8f0" : "rgba(168,85,247,.35)"}`,
                    borderRadius: 8,
                    padding: "8px 14px",
                    color: savingLibrary ? "#64748b" : "#c084fc",
                    cursor: savingLibrary ? "not-allowed" : "pointer",
                    fontSize: ".78em",
                    fontFamily: "inherit",
                    fontWeight: 600,
                  }}
                >
                  {savingLibrary ? "Guardando…" : "💾 Guardar en Biblioteca"}
                </button>
                <button
                  type="button"
                  onClick={openAssignModal}
                  disabled={!athletes?.length}
                  style={{
                    background: athletes?.length ? "rgba(59,130,246,.1)" : "#f1f5f9",
                    border: `1px solid ${athletes?.length ? "rgba(59,130,246,.3)" : "#e2e8f0"}`,
                    borderRadius: 8,
                    padding: "8px 14px",
                    color: athletes?.length ? "#3b82f6" : "#475569",
                    cursor: athletes?.length ? "pointer" : "not-allowed",
                    fontSize: ".78em",
                    fontFamily: "inherit",
                    fontWeight: 600,
                  }}
                >
                  📤 Guardar y asignar
                </button>
              </div>
              {showAssignModal && (
                <div style={{ position: "fixed", inset: 0, background: "rgba(15,23,42,0.45)", display: "flex", alignItems: "center", justifyContent: "center", zIndex: 200, padding: 16 }}>
                  <div style={{ ...S.card, width: "100%", maxWidth: 520, margin: 0 }}>
                    <div style={{ fontSize: ".85em", fontWeight: 700, color: "#0f172a", marginBottom: 8 }}>📋 Asignar a atletas</div>
                    <div style={{ fontSize: ".72em", color: "#64748b", marginBottom: 14 }}>
                      Se guardará en Supabase con los datos del workout y se creará un registro por cada atleta seleccionado.
                    </div>
                    <div style={{ marginBottom: 12 }}>
                      <label style={{ display: "flex", alignItems: "center", gap: 8, fontSize: ".82em", color: "#0f172a", fontWeight: 700, cursor: "pointer" }}>
                        <input type="checkbox" checked={assignEnabledOnSave} onChange={(e) => setAssignEnabledOnSave(e.target.checked)} />
                        Asignar a atletas al guardar
                      </label>
                    </div>
                    {assignEnabledOnSave ? (
                      <>
                        <div style={{ marginBottom: 8, display: "flex", gap: 8, flexWrap: "wrap" }}>
                          <button type="button" onClick={() => setAssignAthleteIds((athletes || []).map((a) => String(a.id)))} style={{ border: "1px solid #bfdbfe", background: "#eff6ff", color: "#1d4ed8", borderRadius: 8, padding: "6px 10px", fontWeight: 700, cursor: "pointer", fontFamily: "inherit", fontSize: ".76em" }}>
                            Seleccionar todos
                          </button>
                          <button type="button" onClick={() => setAssignAthleteIds([])} style={{ border: "1px solid #e2e8f0", background: "#fff", color: "#475569", borderRadius: 8, padding: "6px 10px", fontWeight: 700, cursor: "pointer", fontFamily: "inherit", fontSize: ".76em" }}>
                            Deseleccionar todos
                          </button>
                        </div>
                        <div style={{ border: "1px solid #e2e8f0", borderRadius: 10, padding: 10, maxHeight: 190, overflowY: "auto", marginBottom: 14 }}>
                          {(athletes || []).map((a) => {
                            const checked = assignAthleteIds.includes(String(a.id));
                            return (
                              <label key={a.id} style={{ display: "flex", alignItems: "center", gap: 8, padding: "6px 2px", cursor: "pointer", fontSize: ".82em", color: "#0f172a" }}>
                                <input
                                  type="checkbox"
                                  checked={checked}
                                  onChange={() =>
                                    setAssignAthleteIds((prev) =>
                                      prev.includes(String(a.id)) ? prev.filter((x) => x !== String(a.id)) : [...prev, String(a.id)],
                                    )
                                  }
                                />
                                <span>{a.name}</span>
                              </label>
                            );
                          })}
                        </div>
                      </>
                    ) : null}
                    <div style={{ marginBottom: 16 }}>
                      <div style={{ fontSize: ".72em", color: "#64748b", marginBottom: 6 }}>Fecha del workout</div>
                      <input
                        type="date"
                        value={assignDate}
                        onChange={(e) => setAssignDate(e.target.value)}
                        style={{ width: "100%", background: "#ffffff", border: "1px solid #e2e8f0", borderRadius: 8, padding: "10px 12px", color: "#0f172a", fontFamily: "inherit", fontSize: ".85em", outline: "none", boxSizing: "border-box" }}
                      />
                    </div>
                    <div style={{ display: "flex", gap: 10, justifyContent: "flex-end" }}>
                      <button
                        type="button"
                        onClick={() => setShowAssignModal(false)}
                        disabled={assignSaving}
                        style={{ background: "#f8fafc", border: "1px solid #e2e8f0", borderRadius: 8, padding: "8px 14px", color: "#94a3b8", cursor: assignSaving ? "not-allowed" : "pointer", fontFamily: "inherit", fontWeight: 700, fontSize: ".82em" }}
                      >
                        Cancelar
                      </button>
                      <button
                        type="button"
                        onClick={saveAssignedWorkout}
                        disabled={assignSaving}
                        style={{ background: assignSaving ? "#e2e8f0" : "linear-gradient(135deg,#b45309,#f59e0b)", border: "none", borderRadius: 8, padding: "8px 14px", color: assignSaving ? "#334155" : "white", cursor: assignSaving ? "not-allowed" : "pointer", fontFamily: "inherit", fontWeight: 800, fontSize: ".82em" }}
                      >
                        {assignSaving ? "Guardando..." : "Asignar a seleccionados"}
                      </button>
                    </div>
                  </div>
                </div>
              )}
            </>
          ) : (
            <div style={{ display: "flex", flexDirection: "column", alignItems: "center", justifyContent: "center", minHeight: 300, opacity: 0.45 }}>
              <div style={{ fontSize: "3em", marginBottom: 12 }}>{builderTab === "manual" ? "✍️" : "⚡"}</div>
              <div style={{ color: "#475569", fontSize: ".85em", textAlign: "center", maxWidth: 280 }}>
                {builderTab === "manual" ? "Indica un título para ver la vista previa y usar guardar / asignar / exportar." : "El workout generado aparecerá aquí"}
              </div>
            </div>
          )}
        </div>
      </div>
    </div>
  );
}

const EVAL_DISTANCES = [
  { id: "5k", label: "5K", meters: 5000 },
  { id: "10k", label: "10K", meters: 10000 },
  { id: "21k", label: "21K", meters: 21097.5 },
  { id: "42k", label: "42K", meters: 42195 },
];

const parseHmsToSeconds = (raw) => {
  const parts = String(raw || "").trim().split(":").map((x) => Number(x));
  if (parts.some((n) => !Number.isFinite(n) || n < 0)) return null;
  if (parts.length === 3) return parts[0] * 3600 + parts[1] * 60 + parts[2];
  if (parts.length === 2) return parts[0] * 60 + parts[1];
  if (parts.length === 1) return parts[0];
  return null;
};

const formatSeconds = (totalSec) => {
  const sec = Math.max(0, Math.round(Number(totalSec) || 0));
  const h = Math.floor(sec / 3600);
  const m = Math.floor((sec % 3600) / 60);
  const s = sec % 60;
  return `${String(h).padStart(2, "0")}:${String(m).padStart(2, "0")}:${String(s).padStart(2, "0")}`;
};

const formatPaceMinKm = (paceMinPerKm) => {
  if (!Number.isFinite(paceMinPerKm) || paceMinPerKm <= 0) return "—";
  const totalSec = Math.round(paceMinPerKm * 60);
  const m = Math.floor(totalSec / 60);
  const s = totalSec % 60;
  return `${m}:${String(s).padStart(2, "0")} /km`;
};

const velocityToVo2 = (vMetersPerMin) => -4.6 + 0.182258 * vMetersPerMin + 0.000104 * vMetersPerMin * vMetersPerMin;

const timePercentVo2 = (tMin) => 0.8 + 0.1894393 * Math.exp(-0.012778 * tMin) + 0.2989558 * Math.exp(-0.1932605 * tMin);

const vdotFromRace = (distanceMeters, totalSeconds) => {
  const tMin = Number(totalSeconds) / 60;
  if (!Number.isFinite(distanceMeters) || !Number.isFinite(tMin) || distanceMeters <= 0 || tMin <= 0) return null;
  const v = distanceMeters / tMin;
  const vo2 = velocityToVo2(v);
  const pct = timePercentVo2(tMin);
  if (!Number.isFinite(vo2) || !Number.isFinite(pct) || pct <= 0) return null;
  return vo2 / pct;
};

const vdotFromCooper = (distanceMeters) => {
  const d = Number(distanceMeters);
  if (!Number.isFinite(d) || d <= 0) return null;
  return (d - 504.9) / 44.73;
};

const velocityFromVo2 = (targetVo2) => {
  const a = 0.000104;
  const b = 0.182258;
  const c = -(targetVo2 + 4.6);
  const disc = b * b - 4 * a * c;
  if (disc <= 0) return null;
  return (-b + Math.sqrt(disc)) / (2 * a);
};

const predictTimeFromVdot = (vdot, distanceMeters) => {
  if (!Number.isFinite(vdot) || vdot <= 0) return null;
  let lo = 5;
  let hi = 360;
  for (let i = 0; i < 60; i++) {
    const mid = (lo + hi) / 2;
    const v = distanceMeters / mid;
    const current = velocityToVo2(v) / timePercentVo2(mid);
    if (current > vdot) lo = mid;
    else hi = mid;
  }
  return hi * 60;
};

const computeHrZones = (fcMax, fcRest) => {
  const max = Number(fcMax);
  if (!Number.isFinite(max) || max <= 0) return [];
  const rest = Number(fcRest);
  const useKarvonen = Number.isFinite(rest) && rest > 0 && rest < max;
  const ranges = [
    { z: "Z1", low: 0.5, high: 0.6, color: "#22c55e" },
    { z: "Z2", low: 0.6, high: 0.7, color: "#3b82f6" },
    { z: "Z3", low: 0.7, high: 0.8, color: "#f59e0b" },
    { z: "Z4", low: 0.8, high: 0.9, color: "#f97316" },
    { z: "Z5", low: 0.9, high: 1.0, color: "#ef4444" },
  ];
  return ranges.map((r) => {
    if (useKarvonen) {
      const reserve = max - rest;
      return {
        ...r,
        lowBpm: Math.round(rest + reserve * r.low),
        highBpm: Math.round(rest + reserve * r.high),
      };
    }
    return {
      ...r,
      lowBpm: Math.round(max * r.low),
      highBpm: Math.round(max * r.high),
    };
  });
};


export default Builder;
