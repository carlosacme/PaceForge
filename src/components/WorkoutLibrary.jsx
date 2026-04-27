import { useState, useEffect, useMemo, useCallback, useRef } from "react";
import { supabase } from "../lib/supabase";
import {
  TAB_KEY_LIBRARY,
  formatLocalYMD,
  normalizeLibraryRow,
  getMarketplacePlanWorkoutRows,
  WORKOUT_TYPES,
  parseFitFileToLibraryDraft,
  parseJsonFileToLibraryDrafts,
  INVALID_JSON_WORKOUT_FORMAT_MSG,
  normalizeStructureForFitImportModal,
  emptyFitImportStructureRow,
  structureRowsForFitImportInsert,
  FIT_IMPORT_STEP_TYPES,
  formatCopInt,
} from "./shared/appShared";

function WorkoutLibrary({
  coachUserId,
  libraryRefresh,
  onUseWorkout,
  athletes,
  notify,
  profileRole,
  adminLibraryOwnerId,
  onCopiedGlobalToLibrary,
  onOpenAdminMarketplaceDraft,
  onAfterLibraryImportSuccess,
  styles,
  MarketplacePlanWorkoutsAccordion,
  sendWorkoutAssignmentPushToAthlete,
}) {
  const S = styles;
  const [libraryTab, setLibraryTab] = useState(() => {
    if (typeof window === "undefined") return "mine";
    const saved = localStorage.getItem(TAB_KEY_LIBRARY);
    if (saved === "mine" || saved === "global" || saved === "marketplace_plans") return saved;
    return "mine";
  });
  const [items, setItems] = useState([]);
  const [globalRows, setGlobalRows] = useState([]);
  const [globalNameByCoach, setGlobalNameByCoach] = useState({});
  const [loading, setLoading] = useState(true);
  const [globalLoading, setGlobalLoading] = useState(false);
  const [search, setSearch] = useState("");
  const [deletingId, setDeletingId] = useState(null);
  const [assigningWorkoutRow, setAssigningWorkoutRow] = useState(null);
  const [assignSelectedAthleteIds, setAssignSelectedAthleteIds] = useState([]);
  const [assignDate, setAssignDate] = useState(() => formatLocalYMD(new Date()));
  const [assignSaving, setAssignSaving] = useState(false);
  const [globalCopyingId, setGlobalCopyingId] = useState(null);
  const [marketplacePlansForAdmin, setMarketplacePlansForAdmin] = useState([]);
  const [marketplacePlansAdminLoading, setMarketplacePlansAdminLoading] = useState(false);
  const [marketplaceCoachLabelById, setMarketplaceCoachLabelById] = useState({});
  const [libraryMarketplacePlanDetail, setLibraryMarketplacePlanDetail] = useState(null);
  const [adminMarketplaceCopyingId, setAdminMarketplaceCopyingId] = useState(null);
  const [fitImporting, setFitImporting] = useState(false);
  const [fitDrafts, setFitDrafts] = useState([]);
  const [fitImportSaving, setFitImportSaving] = useState(false);
  const fitInputRef = useRef(null);

  const load = useCallback(async () => {
    if (!coachUserId) {
      setItems([]);
      setLoading(false);
      return;
    }
    setLoading(true);
    const { data, error } = await supabase
      .from("workout_library")
      .select("*")
      .eq("coach_id", coachUserId)
      .order("created_at", { ascending: false });
    if (error) {
      console.error("workout_library:", error);
      setItems([]);
      notify("Error al cargar la biblioteca");
    } else {
      setItems((data || []).map(normalizeLibraryRow));
    }
    setLoading(false);
  }, [coachUserId, notify]);

  const isLibraryAdmin = profileRole === "admin";

  useEffect(() => {
    if (typeof window === "undefined") return;
    localStorage.setItem(TAB_KEY_LIBRARY, libraryTab);
  }, [libraryTab]);

  useEffect(() => {
    if (isLibraryAdmin) return;
    if (libraryTab !== "mine") setLibraryTab("mine");
  }, [isLibraryAdmin, libraryTab]);

  const loadGlobalAll = useCallback(async () => {
    if (!isLibraryAdmin || !coachUserId) {
      setGlobalRows([]);
      setGlobalNameByCoach({});
      return;
    }
    setGlobalLoading(true);
    const { data, error } = await supabase.from("workout_library").select("*").order("created_at", { ascending: false });
    if (error) {
      console.error("workout_library global:", error);
      setGlobalRows([]);
      setGlobalNameByCoach({});
      notify("No se pudo cargar la biblioteca global.");
      setGlobalLoading(false);
      return;
    }
    const rows = (data || []).map(normalizeLibraryRow);
    setGlobalRows(rows);
    const ids = [...new Set(rows.map((r) => r.coach_id).filter(Boolean))];
    if (ids.length === 0) {
      setGlobalNameByCoach({});
      setGlobalLoading(false);
      return;
    }
    const { data: profs, error: pErr } = await supabase.from("profiles").select("user_id,name,email").in("user_id", ids);
    if (pErr) console.warn("profiles names global library:", pErr);
    const nm = {};
    for (const p of profs || []) {
      nm[p.user_id] = (p.name && String(p.name).trim()) || p.user_id;
    }
    setGlobalNameByCoach(nm);
    setGlobalLoading(false);
  }, [isLibraryAdmin, coachUserId, notify]);

  useEffect(() => {
    load();
  }, [load, libraryRefresh]);

  useEffect(() => {
    if (libraryTab === "global" && isLibraryAdmin) loadGlobalAll();
  }, [libraryTab, isLibraryAdmin, loadGlobalAll, libraryRefresh]);

  const loadMarketplacePlansAdmin = useCallback(async () => {
    if (!isLibraryAdmin) {
      setMarketplacePlansForAdmin([]);
      setMarketplaceCoachLabelById({});
      return;
    }
    setMarketplacePlansAdminLoading(true);
    const { data, error } = await supabase.from("plan_marketplace").select("*").order("created_at", { ascending: false });
    if (error) {
      console.error("plan_marketplace admin library:", error);
      notify("No se pudieron cargar los planes del marketplace.");
      setMarketplacePlansForAdmin([]);
      setMarketplaceCoachLabelById({});
      setMarketplacePlansAdminLoading(false);
      return;
    }
    const rows = data || [];
    setMarketplacePlansForAdmin(rows);
    const ids = [...new Set(rows.map((p) => p.coach_user_id).filter(Boolean))];
    if (ids.length === 0) {
      setMarketplaceCoachLabelById({});
      setMarketplacePlansAdminLoading(false);
      return;
    }
    const { data: profs, error: pErr } = await supabase.from("profiles").select("user_id,name,email").in("user_id", ids);
    if (pErr) console.warn("profiles for marketplace plans:", pErr);
    const nm = {};
    for (const p of profs || []) {
      nm[String(p.user_id)] = (p.name && String(p.name).trim()) || p.email || String(p.user_id);
    }
    setMarketplaceCoachLabelById(nm);
    setMarketplacePlansAdminLoading(false);
  }, [isLibraryAdmin, notify]);

  useEffect(() => {
    if (libraryTab === "marketplace_plans" && isLibraryAdmin) loadMarketplacePlansAdmin();
  }, [libraryTab, isLibraryAdmin, loadMarketplacePlansAdmin, libraryRefresh]);

  const copyMarketplacePlanForAdminEdit = async (plan) => {
    if (!adminLibraryOwnerId || !onOpenAdminMarketplaceDraft) return;
    setAdminMarketplaceCopyingId(plan.id);
    const preview = Array.isArray(plan.preview_workouts) ? plan.preview_workouts : [];
    const sessionRows = getMarketplacePlanWorkoutRows(plan);
    const { data: created, error } = await supabase
      .from("plan_marketplace")
      .insert({
        coach_user_id: adminLibraryOwnerId,
        coach_id: adminLibraryOwnerId,
        coach_name: "RunningApexFlow",
        is_admin_copy: true,
        source_plan_id: plan.id,
        is_approved: false,
        is_active: true,
        title: plan.title,
        description: plan.description ?? "",
        level: plan.level ?? "intermedio",
        duration_weeks: plan.duration_weeks ?? 8,
        sessions_per_week: plan.sessions_per_week ?? 4,
        price_cop: plan.price_cop ?? 0,
        preview_workouts: preview,
        plan_sessions: sessionRows.length ? sessionRows : preview,
      })
      .select("id")
      .single();
    setAdminMarketplaceCopyingId(null);
    if (error) {
      notify(error.message || "No se pudo crear la copia.");
      return;
    }
    const newId = created?.id;
    if (!newId) {
      notify("No se obtuvo el id de la copia.");
      return;
    }
    const draft = {
      title: String(plan.title || ""),
      description: String(plan.description || ""),
      level: String(plan.level || "intermedio"),
      duration_weeks: String(plan.duration_weeks ?? 12),
      sessions_per_week: String(plan.sessions_per_week ?? 4),
      price_cop: String(plan.price_cop ?? 120000),
      preview_workouts_text: JSON.stringify(preview, null, 2),
      editing_plan_id: newId,
    };
    try {
      localStorage.setItem("raf_admin_plan_draft", JSON.stringify(draft));
      localStorage.setItem("raf_admin_tab", "marketplace");
    } catch {
      /* ignore */
    }
    onOpenAdminMarketplaceDraft();
    notify("Copia creada. Edítala y publica en Admin · Marketplace.");
    loadMarketplacePlansAdmin();
  };

  const filtered = useMemo(() => {
    const q = search.trim().toLowerCase();
    if (!q) return items;
    return items.filter((row) => {
      const typeLabel = (WORKOUT_TYPES.find((t) => t.id === row.type)?.label || row.type || "").toLowerCase();
      return (
        (row.title || "").toLowerCase().includes(q) ||
        (row.type || "").toLowerCase().includes(q) ||
        typeLabel.includes(q)
      );
    });
  }, [items, search]);

  const deleteRow = async (id) => {
    if (!coachUserId) return;
    setDeletingId(id);
    const { error } = await supabase.from("workout_library").delete().eq("id", id).eq("coach_id", coachUserId);
    setDeletingId(null);
    if (error) {
      console.error(error);
      notify(`Error al eliminar: ${error.message}`);
      return;
    }
    setItems((prev) => prev.filter((x) => x.id !== id));
    notify("Eliminado de la biblioteca");
  };

  const openFitFilePicker = () => {
    if (!coachUserId || fitImporting || fitImportSaving) return;
    if (fitInputRef.current) {
      fitInputRef.current.value = "";
      fitInputRef.current.click();
    }
  };

  const onFitFilesSelected = async (ev) => {
    const files = Array.from(ev?.target?.files || []).filter((f) => /\.(fit|json)$/i.test(String(f?.name || "")));
    if (!files.length) return;
    setFitImporting(true);
    try {
      const parsedDrafts = [];
      for (const file of files) {
        const fileName = String(file?.name || "");
        const isFitFile = /\.fit$/i.test(fileName);
        const isJsonFile = /\.json$/i.test(fileName);
        try {
          if (isFitFile) {
            const draft = await parseFitFileToLibraryDraft(file);
            parsedDrafts.push(draft);
          } else if (isJsonFile) {
            const draftsFromJson = await parseJsonFileToLibraryDrafts(file);
            parsedDrafts.push(...draftsFromJson);
          }
        } catch (err) {
          console.error("Workout import parse error:", err);
          if (err?.message === INVALID_JSON_WORKOUT_FORMAT_MSG) {
            notify(INVALID_JSON_WORKOUT_FORMAT_MSG);
          }
        }
      }
      if (!parsedDrafts.length) {
        notify("No se pudieron parsear archivos .fit/.json válidos.");
        return;
      }
      setFitDrafts(
        parsedDrafts.map((d) => ({
          ...d,
          structure: normalizeStructureForFitImportModal(d.structure),
        })),
      );
    } finally {
      setFitImporting(false);
    }
  };

  const updateFitDraft = (id, patch) => {
    setFitDrafts((prev) => prev.map((row) => (row.id === id ? { ...row, ...patch } : row)));
  };

  const updateFitDraftStep = (draftId, stepIdx, patch) => {
    setFitDrafts((prev) =>
      prev.map((w) => {
        if (w.id !== draftId) return w;
        const structure = [...(Array.isArray(w.structure) ? w.structure : [])];
        if (!structure[stepIdx]) return w;
        structure[stepIdx] = { ...structure[stepIdx], ...patch };
        return { ...w, structure };
      }),
    );
  };

  const removeFitDraftStep = (draftId, stepIdx) => {
    setFitDrafts((prev) =>
      prev.map((w) => {
        if (w.id !== draftId) return w;
        const structure = (Array.isArray(w.structure) ? w.structure : []).filter((_, i) => i !== stepIdx);
        return { ...w, structure };
      }),
    );
  };

  const addFitDraftStep = (draftId) => {
    setFitDrafts((prev) =>
      prev.map((w) => {
        if (w.id !== draftId) return w;
        const structure = [...(Array.isArray(w.structure) ? w.structure : []), emptyFitImportStructureRow()];
        return { ...w, structure };
      }),
    );
  };

  const importAllFitDrafts = async () => {
    if (!coachUserId || !fitDrafts.length) return;
    const payload = fitDrafts.map((w) => {
      const type = WORKOUT_TYPES.some((t) => t.id === w.type) ? w.type : "easy";
      const avgHrLabel = Number.isFinite(Number(w.avg_hr)) ? ` · FC prom ${Math.round(Number(w.avg_hr))} lpm` : "";
      const baseDescription = String(w.description || "").trim();
      const importSourceDescription = `Importado desde ${w.sourceFileName || ".fit/.json"}${avgHrLabel}`;
      return {
        coach_id: coachUserId,
        title: String(w.title || "Workout FIT").trim() || "Workout FIT",
        type,
        workout_type: type,
        total_km: Number.isFinite(Number(w.total_km)) ? Number(w.total_km) : 0,
        distance_km: Number.isFinite(Number(w.distance_km)) ? Number(w.distance_km) : 0,
        duration_min: Number.isFinite(Number(w.duration_min)) ? Math.max(0, Math.round(Number(w.duration_min))) : 0,
        description: baseDescription || importSourceDescription,
        structure: structureRowsForFitImportInsert(w.structure),
        workout_structure: structureRowsForFitImportInsert(w.structure),
      };
    });
    setFitImportSaving(true);
    try {
      const { error } = await supabase.from("workout_library").insert(payload).select();
      if (error) {
        console.error("fit/json import workout_library:", error);
        notify(`Error al importar .fit/.json: ${error.message}`);
        return;
      }
      setFitDrafts([]);
      await load();
      if (typeof onAfterLibraryImportSuccess === "function") onAfterLibraryImportSuccess();
      notify(`${payload.length} workouts importados exitosamente`);
    } finally {
      setFitImportSaving(false);
    }
  };

  const assignDirectly = async (row) => {
    if (!coachUserId) return;
    if (!Array.isArray(assignSelectedAthleteIds) || assignSelectedAthleteIds.length === 0) {
      notify("Selecciona al menos un atleta");
      return;
    }
    if (!assignDate) {
      notify("Selecciona la fecha");
      return;
    }
    const athleteRows = (athletes || []).filter((a) => assignSelectedAthleteIds.includes(String(a.id)));
    if (athleteRows.length === 0) {
      notify("No se encontraron atletas seleccionados.");
      return;
    }
    setAssignSaving(true);
    const payload = athleteRows.map((a) => ({
      athlete_id: a.id,
      coach_id: coachUserId,
      title: row.title,
      type: row.type,
      total_km: Number(row.total_km) || 0,
      duration_min: Number(row.duration_min) || 0,
      description: row.description || "",
      structure: Array.isArray(row.structure) ? row.structure : [],
      workout_structure: Array.isArray(row.structure) ? row.structure : [],
      done: false,
      scheduled_date: assignDate,
    }));
    const { error } = await supabase.from("workouts").insert(payload);
    setAssignSaving(false);
    if (error) {
      console.error(error);
      notify(`Error al asignar: ${error.message}`);
      return;
    }
    await Promise.all(
      athleteRows.map((a) =>
        sendWorkoutAssignmentPushToAthlete({
          athleteUserId: a?.user_id,
          workoutTitle: row.title,
          scheduledDate: assignDate,
        }),
      ),
    );
    notify(`Workout asignado a ${athleteRows.length} atletas`);
    setAssigningWorkoutRow(null);
    setAssignSelectedAthleteIds([]);
  };

  const globalGrouped = useMemo(() => {
    const q = search.trim().toLowerCase();
    let list = globalRows;
    if (q) {
      list = globalRows.filter((row) => {
        const typeLabel = (WORKOUT_TYPES.find((t) => t.id === row.type)?.label || row.type || "").toLowerCase();
        const coachLabel = (globalNameByCoach[row.coach_id] || "").toLowerCase();
        return (
          (row.title || "").toLowerCase().includes(q) ||
          (row.type || "").toLowerCase().includes(q) ||
          typeLabel.includes(q) ||
          coachLabel.includes(q)
        );
      });
    }
    const byCoach = {};
    for (const row of list) {
      const cid = row.coach_id;
      if (!byCoach[cid]) byCoach[cid] = [];
      byCoach[cid].push(row);
    }
    const coachIds = Object.keys(byCoach).sort((a, b) =>
      String(globalNameByCoach[a] || a).localeCompare(String(globalNameByCoach[b] || b)),
    );
    return { byCoach, coachIds };
  }, [globalRows, globalNameByCoach, search]);

  const copyGlobalWorkoutToMine = async (row) => {
    if (!adminLibraryOwnerId) return;
    setGlobalCopyingId(row.id);
    const structure = Array.isArray(row.structure) ? row.structure : [];
    const wtype = row.workout_type || row.type;
    const typeId = WORKOUT_TYPES.some((t) => t.id === wtype) ? wtype : WORKOUT_TYPES.some((t) => t.id === row.type) ? row.type : "easy";
    const dist = Number.isFinite(Number(row.distance_km))
      ? Number(row.distance_km)
      : Number.isFinite(Number(row.total_km))
        ? Number(row.total_km)
        : 0;
    const ins = {
      coach_id: adminLibraryOwnerId,
      title: (row.title && String(row.title).trim()) || "Workout",
      type: typeId,
      workout_type: String(wtype || typeId),
      total_km: dist,
      distance_km: dist,
      duration_min: Number.isFinite(Number(row.duration_min)) ? Math.round(Number(row.duration_min)) : 0,
      description: row.description != null ? String(row.description) : "",
      structure,
      workout_structure: structure,
    };
    if (row.intensity) ins.intensity = String(row.intensity);
    if (row.notes) ins.notes = String(row.notes);
    const { error } = await supabase.from("workout_library").insert(ins);
    setGlobalCopyingId(null);
    if (error) {
      notify(error.message || "No se pudo copiar.");
      return;
    }
    notify("Copiado a tu biblioteca ✓");
    if (typeof onCopiedGlobalToLibrary === "function") onCopiedGlobalToLibrary();
    load();
  };

  const libTabBtn = (active) => ({
    padding: "10px 16px",
    borderRadius: 10,
    border: active ? "none" : "1px solid #e2e8f0",
    background: active ? "linear-gradient(135deg,#6366f1,#818cf8)" : "#fff",
    color: active ? "#fff" : "#475569",
    fontWeight: 800,
    fontSize: ".82em",
    cursor: "pointer",
    fontFamily: "inherit",
  });

  const showGlobalTab = Boolean(isLibraryAdmin);
  const activeTab = showGlobalTab ? libraryTab : "mine";

  return (
    <div style={S.page}>
      <div style={{ marginBottom: 22 }}>
        <h1 style={S.pageTitle}>Biblioteca</h1>
        <p style={{ color: "#475569", fontSize: ".82em", marginTop: 4 }}>
          Workouts guardados para reutilizar en el generador y asignar a atletas
        </p>
        {showGlobalTab ? (
          <div style={{ display: "flex", gap: 8, marginTop: 14, flexWrap: "wrap" }}>
            <button type="button" style={libTabBtn(activeTab === "mine")} onClick={() => setLibraryTab("mine")}>
              Mi biblioteca
            </button>
            <button type="button" style={libTabBtn(activeTab === "global")} onClick={() => setLibraryTab("global")}>
              📚 Todos los coaches
            </button>
            <button type="button" style={libTabBtn(activeTab === "marketplace_plans")} onClick={() => setLibraryTab("marketplace_plans")}>
              📋 Planes Marketplace
            </button>
          </div>
        ) : null}
      </div>
      <div style={{ ...S.card, marginBottom: 18 }}>
        <input ref={fitInputRef} type="file" accept=".fit,.json" multiple onChange={onFitFilesSelected} style={{ display: "none" }} />
        <div style={{ display: "flex", justifyContent: "space-between", gap: 10, alignItems: "center", flexWrap: "wrap", marginBottom: 10 }}>
          <div style={{ fontSize: ".72em", color: "#64748b" }}>Buscar por nombre o tipo</div>
          <button
            type="button"
            onClick={openFitFilePicker}
            disabled={!coachUserId || fitImporting || fitImportSaving}
            style={{
              border: "1px solid #bfdbfe",
              background: fitImporting || fitImportSaving ? "#e2e8f0" : "#eff6ff",
              color: fitImporting || fitImportSaving ? "#64748b" : "#1d4ed8",
              borderRadius: 8,
              padding: "8px 12px",
              fontWeight: 800,
              cursor: !coachUserId || fitImporting || fitImportSaving ? "not-allowed" : "pointer",
              fontFamily: "inherit",
              fontSize: ".78em",
            }}
          >
            {fitImporting ? "Leyendo…" : "📂 Importar .fit/.json"}
          </button>
        </div>
        <input
          value={search}
          onChange={(e) => setSearch(e.target.value)}
          placeholder="Ej: tempo, intervalos, rodaje…"
          style={{
            width: "100%",
            maxWidth: 400,
            background: "#f1f5f9",
            border: "1px solid #e2e8f0",
            borderRadius: 8,
            padding: "10px 12px",
            color: "#0f172a",
            fontFamily: "inherit",
            fontSize: ".85em",
            outline: "none",
            boxSizing: "border-box",
          }}
        />
      </div>
      {!coachUserId ? (
        <div style={{ color: "#64748b", fontSize: ".9em" }}>Inicia sesión para ver tu biblioteca.</div>
      ) : activeTab === "marketplace_plans" && showGlobalTab ? (
        marketplacePlansAdminLoading ? (
          <div style={{ color: "#64748b", fontSize: ".9em" }}>Cargando planes del marketplace…</div>
        ) : marketplacePlansForAdmin.length === 0 ? (
          <div style={{ ...S.card, color: "#64748b", fontSize: ".9em" }}>No hay planes en marketplace.</div>
        ) : (
          <div style={{ display: "flex", flexDirection: "column", gap: 12 }}>
            {marketplacePlansForAdmin.map((p) => {
              const coachOrigin =
                marketplaceCoachLabelById[String(p.coach_user_id)] || p.coach_name || p.coach_user_id || "Coach";
              const estado = !p.is_active ? "Inactivo" : p.is_approved ? "Aprobado" : "Pendiente";
              const estadoColor = !p.is_active ? "#ef4444" : p.is_approved ? "#16a34a" : "#b45309";
              return (
                <div
                  key={p.id}
                  style={{
                    ...S.card,
                    margin: 0,
                    padding: 14,
                    border: "1px solid #e2e8f0",
                    display: "flex",
                    flexWrap: "wrap",
                    justifyContent: "space-between",
                    gap: 12,
                    alignItems: "flex-start",
                  }}
                >
                  <div style={{ flex: "1 1 260px", minWidth: 0 }}>
                    <div style={{ fontWeight: 800, color: "#0f172a", fontSize: ".95em" }}>{p.title}</div>
                    <div style={{ fontSize: ".78em", color: "#64748b", marginTop: 6, lineHeight: 1.5 }}>
                      <div>
                        <strong>Coach origen:</strong> {coachOrigin}
                      </div>
                      <div>
                        Nivel: {p.level || "—"} · {p.duration_weeks ?? "—"} sem · {p.sessions_per_week ?? "—"} sesiones/sem · ${formatCopInt(p.price_cop || 0)} COP
                      </div>
                      <div style={{ fontWeight: 800, color: estadoColor, marginTop: 4 }}>Estado: {estado}</div>
                    </div>
                  </div>
                  <div style={{ display: "flex", flexWrap: "wrap", gap: 8, alignItems: "center" }}>
                    <button
                      type="button"
                      onClick={() => setLibraryMarketplacePlanDetail(p)}
                      style={{
                        padding: "8px 12px",
                        borderRadius: 8,
                        border: "1px solid #bae6fd",
                        background: "#f0f9ff",
                        color: "#0369a1",
                        fontWeight: 800,
                        fontSize: ".78em",
                        cursor: "pointer",
                        fontFamily: "inherit",
                      }}
                    >
                      👁️ Ver completo
                    </button>
                    <button
                      type="button"
                      disabled={adminMarketplaceCopyingId === p.id}
                      onClick={() => copyMarketplacePlanForAdminEdit(p)}
                      style={{
                        padding: "8px 12px",
                        borderRadius: 8,
                        border: "none",
                        background: adminMarketplaceCopyingId === p.id ? "#e2e8f0" : "linear-gradient(135deg,#6366f1,#818cf8)",
                        color: adminMarketplaceCopyingId === p.id ? "#64748b" : "#fff",
                        fontWeight: 800,
                        fontSize: ".78em",
                        cursor: adminMarketplaceCopyingId === p.id ? "not-allowed" : "pointer",
                        fontFamily: "inherit",
                      }}
                    >
                      {adminMarketplaceCopyingId === p.id ? "Copiando…" : "✏️ Copiar y editar"}
                    </button>
                  </div>
                </div>
              );
            })}
          </div>
        )
      ) : activeTab === "global" && showGlobalTab ? (
        globalLoading ? (
          <div style={{ color: "#64748b", fontSize: ".9em" }}>Cargando todos los coaches…</div>
        ) : globalRows.length === 0 ? (
          <div style={{ ...S.card, color: "#64748b", fontSize: ".9em" }}>No hay workouts en bibliotecas.</div>
        ) : (
          <div style={{ display: "flex", flexDirection: "column", gap: 20 }}>
            {globalGrouped.coachIds.map((cid) => (
              <div key={cid}>
                <div style={{ fontSize: ".78em", fontWeight: 800, color: "#475569", marginBottom: 10, letterSpacing: ".04em" }}>
                  Coach: {globalNameByCoach[cid] || cid}
                </div>
                <div style={{ display: "flex", flexDirection: "column", gap: 10 }}>
                  {globalGrouped.byCoach[cid].map((row) => {
                    const typeKey = row.workout_type || row.type;
                    const wt = WORKOUT_TYPES.find((t) => t.id === typeKey) || WORKOUT_TYPES.find((t) => t.id === row.type) || WORKOUT_TYPES[0];
                    const dist = row.distance_km ?? row.total_km;
                    const isOwn = String(row.coach_id) === String(adminLibraryOwnerId);
                    return (
                      <div
                        key={row.id}
                        style={{
                          ...S.card,
                          margin: 0,
                          padding: 14,
                          display: "flex",
                          flexWrap: "wrap",
                          justifyContent: "space-between",
                          gap: 12,
                          alignItems: "center",
                          border: "1px solid #e2e8f0",
                        }}
                      >
                        <div style={{ flex: "1 1 220px", minWidth: 0 }}>
                          <div style={{ fontWeight: 700, color: "#0f172a" }}>{row.title}</div>
                          <div style={{ fontSize: ".75em", color: "#64748b", lineHeight: 1.45 }}>
                            Tipo: {wt.label}
                            {" · "}
                            Duración: {row.duration_min} min
                            {" · "}
                            Distancia: {dist} km
                            {row.intensity ? (
                              <>
                                {" · "}
                                Intensidad: {row.intensity}
                              </>
                            ) : null}
                          </div>
                        </div>
                        {!isOwn ? (
                          <button
                            type="button"
                            disabled={globalCopyingId === row.id}
                            onClick={() => copyGlobalWorkoutToMine(row)}
                            style={{
                              padding: "8px 12px",
                              borderRadius: 8,
                              border: "none",
                              background: globalCopyingId === row.id ? "#e2e8f0" : "linear-gradient(135deg,#6366f1,#818cf8)",
                              color: globalCopyingId === row.id ? "#64748b" : "#fff",
                              fontWeight: 700,
                              fontSize: ".78em",
                              cursor: globalCopyingId === row.id ? "not-allowed" : "pointer",
                              fontFamily: "inherit",
                            }}
                          >
                            {globalCopyingId === row.id ? "Copiando…" : "➕ Copiar a mi biblioteca"}
                          </button>
                        ) : (
                          <span style={{ fontSize: ".72em", color: "#94a3b8" }}>Ya es tuyo</span>
                        )}
                      </div>
                    );
                  })}
                </div>
              </div>
            ))}
          </div>
        )
      ) : loading ? (
        <div style={{ color: "#64748b", fontSize: ".9em" }}>Cargando biblioteca…</div>
      ) : filtered.length === 0 ? (
        <div style={{ ...S.card, color: "#64748b", fontSize: ".9em" }}>
          {items.length === 0
            ? "Aún no hay workouts guardados. Genera uno en «Crear Workout» y pulsa «Guardar en Biblioteca»."
            : "Ningún resultado para tu búsqueda."}
        </div>
      ) : (
        <div style={{ display: "flex", flexDirection: "column", gap: 12 }}>
          {filtered.map((row) => {
            const wt = WORKOUT_TYPES.find((t) => t.id === row.type) || WORKOUT_TYPES[0];
            return (
              <div
                key={row.id}
                style={{
                  ...S.card,
                  margin: 0,
                  display: "flex",
                  flexWrap: "wrap",
                  alignItems: "flex-start",
                  justifyContent: "space-between",
                  gap: 14,
                  border: "1px solid #e2e8f0",
                }}
              >
                <div style={{ flex: "1 1 220px", minWidth: 0 }}>
                  <div style={{ display: "flex", alignItems: "center", gap: 10, marginBottom: 8, flexWrap: "wrap" }}>
                    <span style={{ fontSize: "1.05em", fontWeight: 700, color: "#0f172a" }}>{row.title}</span>
                    <span
                      style={{
                        fontSize: ".65em",
                        fontWeight: 700,
                        letterSpacing: ".08em",
                        color: wt.color,
                        border: `1px solid ${wt.color}55`,
                        borderRadius: 6,
                        padding: "3px 8px",
                      }}
                    >
                      {wt.label}
                    </span>
                  </div>
                  <div style={{ fontSize: ".78em", color: "#64748b", marginBottom: 6 }}>{row.description}</div>
                  <div style={{ fontSize: ".75em", color: "#94a3b8" }}>
                    📍 {row.total_km} km · ⏱ {row.duration_min} min
                    {row.created_at && (
                      <span style={{ marginLeft: 10, color: "#475569" }}>
                        · {new Date(row.created_at).toLocaleDateString("es", { dateStyle: "medium" })}
                      </span>
                    )}
                  </div>
                </div>
                <div style={{ display: "flex", gap: 8, flexShrink: 0 }}>
                  <button
                    type="button"
                    onClick={() => onUseWorkout(row)}
                    style={{
                      background: "linear-gradient(135deg,#b45309,#f59e0b)",
                      border: "none",
                      borderRadius: 8,
                      padding: "8px 14px",
                      color: "white",
                      fontWeight: 800,
                      cursor: "pointer",
                      fontFamily: "inherit",
                      fontSize: ".8em",
                    }}
                  >
                    Usar
                  </button>
                  <button
                    type="button"
                    onClick={() => {
                      setAssigningWorkoutRow(row);
                      setAssignDate(formatLocalYMD(new Date()));
                      setAssignSelectedAthleteIds([]);
                    }}
                    style={{
                      background: "rgba(59,130,246,.12)",
                      border: "1px solid rgba(59,130,246,.35)",
                      borderRadius: 8,
                      padding: "8px 12px",
                      color: "#1d4ed8",
                      fontWeight: 700,
                      cursor: "pointer",
                      fontFamily: "inherit",
                      fontSize: ".78em",
                    }}
                  >
                    📋 Asignar
                  </button>
                  <button
                    type="button"
                    onClick={() => deleteRow(row.id)}
                    disabled={deletingId === row.id}
                    style={{
                      background: "rgba(239,68,68,.1)",
                      border: "1px solid rgba(239,68,68,.35)",
                      borderRadius: 8,
                      padding: "8px 14px",
                      color: "#f87171",
                      fontWeight: 700,
                      cursor: deletingId === row.id ? "not-allowed" : "pointer",
                      fontFamily: "inherit",
                      fontSize: ".8em",
                    }}
                  >
                    {deletingId === row.id ? "…" : "Eliminar"}
                  </button>
                </div>
              </div>
            );
          })}
        </div>
      )}
      {libraryMarketplacePlanDetail ? (
        <div style={{ position: "fixed", inset: 0, zIndex: 10032, background: "rgba(15,23,42,.45)", display: "flex", alignItems: "center", justifyContent: "center", padding: 16 }}>
          <div style={{ ...S.card, width: "100%", maxWidth: 720, margin: 0, maxHeight: "90vh", overflowY: "auto" }}>
            <div style={{ display: "flex", justifyContent: "space-between", gap: 10, alignItems: "center", marginBottom: 8 }}>
              <div style={{ fontSize: "1.05em", fontWeight: 900 }}>{libraryMarketplacePlanDetail.title}</div>
              <button type="button" onClick={() => setLibraryMarketplacePlanDetail(null)} style={{ border: "1px solid #e2e8f0", background: "#fff", borderRadius: 8, padding: "6px 10px", cursor: "pointer", fontFamily: "inherit" }}>
                ✕
              </button>
            </div>
            <div style={{ color: "#475569", fontSize: ".86em", marginBottom: 10 }}>{libraryMarketplacePlanDetail.description || "Sin descripción."}</div>
            <div style={{ fontSize: ".78em", fontWeight: 800, color: "#334155", marginBottom: 8 }}>Workouts de muestra</div>
            <MarketplacePlanWorkoutsAccordion previewWorkouts={getMarketplacePlanWorkoutRows(libraryMarketplacePlanDetail)} resetKey={libraryMarketplacePlanDetail.id} />
            <div style={{ display: "flex", justifyContent: "flex-end", marginTop: 12 }}>
              <button type="button" onClick={() => setLibraryMarketplacePlanDetail(null)} style={{ border: "1px solid #e2e8f0", background: "#fff", borderRadius: 8, padding: "8px 12px", fontWeight: 700, cursor: "pointer", fontFamily: "inherit" }}>
                Cerrar
              </button>
            </div>
          </div>
        </div>
      ) : null}
      {assigningWorkoutRow ? (
        <div style={{ position: "fixed", inset: 0, zIndex: 300, background: "rgba(15,23,42,.45)", display: "flex", alignItems: "center", justifyContent: "center", padding: 16 }}>
          <div style={{ ...S.card, width: "100%", maxWidth: 540, margin: 0 }}>
            <div style={{ display: "flex", justifyContent: "space-between", alignItems: "center", marginBottom: 8 }}>
              <div style={{ fontSize: ".95em", fontWeight: 900, color: "#0f172a" }}>📋 Asignar workout</div>
              <button type="button" onClick={() => setAssigningWorkoutRow(null)} disabled={assignSaving} style={{ border: "1px solid #e2e8f0", background: "#fff", borderRadius: 8, padding: "6px 10px", cursor: assignSaving ? "not-allowed" : "pointer", fontFamily: "inherit" }}>✕</button>
            </div>
            <div style={{ fontSize: ".78em", color: "#64748b", marginBottom: 10 }}>
              {assigningWorkoutRow.title}
            </div>
            <div style={{ marginBottom: 10, display: "flex", gap: 8, flexWrap: "wrap" }}>
              <button type="button" onClick={() => setAssignSelectedAthleteIds((athletes || []).map((a) => String(a.id)))} style={{ border: "1px solid #bfdbfe", background: "#eff6ff", color: "#1d4ed8", borderRadius: 8, padding: "6px 10px", fontWeight: 700, cursor: "pointer", fontFamily: "inherit", fontSize: ".76em" }}>
                Seleccionar todos
              </button>
              <button type="button" onClick={() => setAssignSelectedAthleteIds([])} style={{ border: "1px solid #e2e8f0", background: "#fff", color: "#475569", borderRadius: 8, padding: "6px 10px", fontWeight: 700, cursor: "pointer", fontFamily: "inherit", fontSize: ".76em" }}>
                Deseleccionar todos
              </button>
            </div>
            <div style={{ border: "1px solid #e2e8f0", borderRadius: 10, padding: 10, maxHeight: 220, overflowY: "auto", marginBottom: 12 }}>
              {(athletes || []).map((a) => {
                const checked = assignSelectedAthleteIds.includes(String(a.id));
                return (
                  <label key={a.id} style={{ display: "flex", alignItems: "center", gap: 8, padding: "6px 2px", cursor: "pointer", fontSize: ".82em", color: "#0f172a" }}>
                    <input
                      type="checkbox"
                      checked={checked}
                      onChange={() =>
                        setAssignSelectedAthleteIds((prev) =>
                          prev.includes(String(a.id)) ? prev.filter((x) => x !== String(a.id)) : [...prev, String(a.id)],
                        )
                      }
                    />
                    <span>{a.name}</span>
                  </label>
                );
              })}
            </div>
            <div style={{ marginBottom: 14 }}>
              <div style={{ fontSize: ".72em", color: "#64748b", marginBottom: 6 }}>Fecha del workout</div>
              <input type="date" value={assignDate} onChange={(e) => setAssignDate(e.target.value)} style={{ width: "100%", border: "1px solid #e2e8f0", borderRadius: 8, padding: "9px 10px", fontFamily: "inherit", boxSizing: "border-box" }} />
            </div>
            <div style={{ display: "flex", justifyContent: "flex-end", gap: 8 }}>
              <button type="button" onClick={() => setAssigningWorkoutRow(null)} disabled={assignSaving} style={{ border: "1px solid #e2e8f0", background: "#fff", borderRadius: 8, padding: "8px 12px", color: "#475569", cursor: assignSaving ? "not-allowed" : "pointer", fontFamily: "inherit", fontWeight: 700 }}>
                Cancelar
              </button>
              <button type="button" onClick={() => assignDirectly(assigningWorkoutRow)} disabled={assignSaving} style={{ border: "none", background: assignSaving ? "#cbd5e1" : "linear-gradient(135deg,#b45309,#f59e0b)", borderRadius: 8, padding: "8px 12px", color: "#fff", cursor: assignSaving ? "not-allowed" : "pointer", fontFamily: "inherit", fontWeight: 800 }}>
                {assignSaving ? "Asignando…" : "Asignar a seleccionados"}
              </button>
            </div>
          </div>
        </div>
      ) : null}
      {fitDrafts.length ? (
        <div style={{ position: "fixed", inset: 0, zIndex: 301, background: "rgba(15,23,42,.45)", display: "flex", alignItems: "center", justifyContent: "center", padding: 16 }}>
          <div style={{ ...S.card, width: "100%", maxWidth: 760, margin: 0, maxHeight: "90vh", overflowY: "auto" }}>
            <div style={{ display: "flex", justifyContent: "space-between", alignItems: "center", gap: 8, marginBottom: 10 }}>
              <div style={{ fontWeight: 900, fontSize: ".96em", color: "#0f172a" }}>Vista previa de workouts (.fit / .json)</div>
              <button
                type="button"
                onClick={() => setFitDrafts([])}
                disabled={fitImportSaving}
                style={{ border: "1px solid #e2e8f0", background: "#fff", borderRadius: 8, padding: "6px 10px", cursor: fitImportSaving ? "not-allowed" : "pointer", fontFamily: "inherit" }}
              >
                ✕
              </button>
            </div>
            <div style={{ display: "flex", flexDirection: "column", gap: 12 }}>
              {fitDrafts.map((w, idx) => (
                <div key={w.id} style={{ border: "1px solid #e2e8f0", borderRadius: 10, padding: 12, background: "#fff" }}>
                  <div style={{ fontSize: ".72em", color: "#64748b", marginBottom: 8 }}>
                    Archivo: {w.sourceFileName || "—"} · Deporte: {w.sport || "running"} · FC prom: {w.avg_hr ?? "—"} lpm
                  </div>
                  <div style={{ display: "grid", gap: 8, gridTemplateColumns: "minmax(0,1.4fr) 130px 110px 110px" }}>
                    <input
                      value={w.title}
                      onChange={(e) => updateFitDraft(w.id, { title: e.target.value })}
                      placeholder={`Workout ${idx + 1}`}
                      style={{ border: "1px solid #e2e8f0", borderRadius: 8, padding: "9px 10px", fontFamily: "inherit", fontSize: ".82em" }}
                    />
                    <select
                      value={w.type}
                      onChange={(e) => updateFitDraft(w.id, { type: e.target.value })}
                      style={{ border: "1px solid #e2e8f0", borderRadius: 8, padding: "9px 10px", fontFamily: "inherit", fontSize: ".82em" }}
                    >
                      {WORKOUT_TYPES.filter((t) => ["easy", "tempo", "interval", "long", "recovery"].includes(t.id)).map((t) => (
                        <option key={t.id} value={t.id}>
                          {t.id}
                        </option>
                      ))}
                    </select>
                    <input
                      type="number"
                      min="0"
                      value={w.duration_min}
                      onChange={(e) => updateFitDraft(w.id, { duration_min: e.target.value })}
                      placeholder="min"
                      style={{ border: "1px solid #e2e8f0", borderRadius: 8, padding: "9px 10px", fontFamily: "inherit", fontSize: ".82em" }}
                    />
                    <input
                      type="number"
                      min="0"
                      step="0.1"
                      value={w.distance_km}
                      onChange={(e) => updateFitDraft(w.id, { distance_km: e.target.value, total_km: e.target.value })}
                      placeholder="km"
                      style={{ border: "1px solid #e2e8f0", borderRadius: 8, padding: "9px 10px", fontFamily: "inherit", fontSize: ".82em" }}
                    />
                  </div>
                  <div style={{ marginTop: 10 }}>
                    <div style={{ fontSize: ".72em", fontWeight: 800, color: "#475569", marginBottom: 6 }}>Descripción</div>
                    <textarea
                      value={w.description || ""}
                      onChange={(e) => updateFitDraft(w.id, { description: e.target.value })}
                      rows={4}
                      style={{ width: "100%", boxSizing: "border-box", border: "1px solid #e2e8f0", borderRadius: 8, padding: "9px 10px", fontFamily: "inherit", fontSize: ".8em", resize: "vertical" }}
                    />
                  </div>
                  <div style={{ marginTop: 10 }}>
                    <div style={{ fontSize: ".72em", fontWeight: 800, color: "#475569", marginBottom: 6 }}>ESTRUCTURA</div>
                    <div style={{ overflowX: "auto", border: "1px solid #e2e8f0", borderRadius: 8 }}>
                      <table style={{ width: "100%", minWidth: 720, borderCollapse: "collapse", fontSize: ".74em" }}>
                        <thead>
                          <tr style={{ background: "#f8fafc" }}>
                            <th style={{ padding: "8px 6px", textAlign: "left", borderBottom: "1px solid #e2e8f0", width: 36 }}>#</th>
                            <th style={{ padding: "8px 6px", textAlign: "left", borderBottom: "1px solid #e2e8f0", minWidth: 120 }}>Tipo</th>
                            <th style={{ padding: "8px 6px", textAlign: "left", borderBottom: "1px solid #e2e8f0", minWidth: 88 }}>Duración (min)</th>
                            <th style={{ padding: "8px 6px", textAlign: "left", borderBottom: "1px solid #e2e8f0", minWidth: 88 }}>Distancia (km)</th>
                            <th style={{ padding: "8px 6px", textAlign: "left", borderBottom: "1px solid #e2e8f0", minWidth: 100 }}>Ritmo</th>
                            <th style={{ padding: "8px 6px", textAlign: "left", borderBottom: "1px solid #e2e8f0", minWidth: 100 }}>FC objetivo</th>
                            <th style={{ padding: "8px 6px", textAlign: "left", borderBottom: "1px solid #e2e8f0", minWidth: 120 }}>Descripción</th>
                            <th style={{ padding: "8px 6px", textAlign: "center", borderBottom: "1px solid #e2e8f0", width: 52 }} />
                          </tr>
                        </thead>
                        <tbody>
                          {(Array.isArray(w.structure) ? w.structure : []).map((st, si) => (
                            <tr key={st.__key || `${w.id}-st-${si}`}>
                              <td style={{ padding: "6px", borderBottom: "1px solid #f1f5f9", color: "#64748b", fontWeight: 700 }}>{si + 1}</td>
                              <td style={{ padding: "6px", borderBottom: "1px solid #f1f5f9" }}>
                                <select
                                  value={FIT_IMPORT_STEP_TYPES.includes(String(st.block_type)) ? st.block_type : "Rodaje"}
                                  onChange={(e) => updateFitDraftStep(w.id, si, { block_type: e.target.value })}
                                  disabled={fitImportSaving}
                                  style={{ width: "100%", maxWidth: 130, border: "1px solid #e2e8f0", borderRadius: 6, padding: "6px 4px", fontFamily: "inherit", fontSize: ".9em" }}
                                >
                                  {FIT_IMPORT_STEP_TYPES.map((bt) => (
                                    <option key={bt} value={bt}>
                                      {bt}
                                    </option>
                                  ))}
                                </select>
                              </td>
                              <td style={{ padding: "6px", borderBottom: "1px solid #f1f5f9" }}>
                                <input
                                  type="number"
                                  min="0"
                                  step="1"
                                  value={st.duration_min}
                                  onChange={(e) => updateFitDraftStep(w.id, si, { duration_min: e.target.value })}
                                  disabled={fitImportSaving}
                                  style={{ width: "100%", maxWidth: 88, border: "1px solid #e2e8f0", borderRadius: 6, padding: "6px 4px", fontFamily: "inherit" }}
                                />
                              </td>
                              <td style={{ padding: "6px", borderBottom: "1px solid #f1f5f9" }}>
                                <input
                                  type="number"
                                  min="0"
                                  step="0.1"
                                  value={st.distance_km}
                                  onChange={(e) => updateFitDraftStep(w.id, si, { distance_km: e.target.value })}
                                  disabled={fitImportSaving}
                                  style={{ width: "100%", maxWidth: 88, border: "1px solid #e2e8f0", borderRadius: 6, padding: "6px 4px", fontFamily: "inherit" }}
                                />
                              </td>
                              <td style={{ padding: "6px", borderBottom: "1px solid #f1f5f9" }}>
                                <input
                                  type="text"
                                  value={st.target_pace}
                                  onChange={(e) => updateFitDraftStep(w.id, si, { target_pace: e.target.value })}
                                  placeholder="4:30/km"
                                  disabled={fitImportSaving}
                                  style={{ width: "100%", minWidth: 90, border: "1px solid #e2e8f0", borderRadius: 6, padding: "6px 4px", fontFamily: "inherit" }}
                                />
                              </td>
                              <td style={{ padding: "6px", borderBottom: "1px solid #f1f5f9" }}>
                                <input
                                  type="text"
                                  value={st.target_hr}
                                  onChange={(e) => updateFitDraftStep(w.id, si, { target_hr: e.target.value })}
                                  placeholder="140-160"
                                  disabled={fitImportSaving}
                                  style={{ width: "100%", minWidth: 90, border: "1px solid #e2e8f0", borderRadius: 6, padding: "6px 4px", fontFamily: "inherit" }}
                                />
                              </td>
                              <td style={{ padding: "6px", borderBottom: "1px solid #f1f5f9" }}>
                                <input
                                  type="text"
                                  value={st.description}
                                  onChange={(e) => updateFitDraftStep(w.id, si, { description: e.target.value })}
                                  disabled={fitImportSaving}
                                  style={{ width: "100%", minWidth: 100, border: "1px solid #e2e8f0", borderRadius: 6, padding: "6px 4px", fontFamily: "inherit" }}
                                />
                              </td>
                              <td style={{ padding: "6px", borderBottom: "1px solid #f1f5f9", textAlign: "center" }}>
                                <button
                                  type="button"
                                  onClick={() => removeFitDraftStep(w.id, si)}
                                  disabled={fitImportSaving}
                                  title="Eliminar paso"
                                  style={{
                                    border: "1px solid #fecaca",
                                    background: "#fff",
                                    borderRadius: 6,
                                    padding: "4px 8px",
                                    cursor: fitImportSaving ? "not-allowed" : "pointer",
                                    fontFamily: "inherit",
                                    fontSize: ".9em",
                                  }}
                                >
                                  🗑️
                                </button>
                              </td>
                            </tr>
                          ))}
                        </tbody>
                      </table>
                    </div>
                    <button
                      type="button"
                      onClick={() => addFitDraftStep(w.id)}
                      disabled={fitImportSaving}
                      style={{
                        marginTop: 8,
                        border: "1px solid #bae6fd",
                        background: "#f0f9ff",
                        color: "#0369a1",
                        borderRadius: 8,
                        padding: "6px 12px",
                        fontWeight: 800,
                        fontSize: ".78em",
                        cursor: fitImportSaving ? "not-allowed" : "pointer",
                        fontFamily: "inherit",
                      }}
                    >
                      + Agregar paso
                    </button>
                    {!(Array.isArray(w.structure) && w.structure.length) ? (
                      <div style={{ fontSize: ".76em", color: "#94a3b8", marginTop: 6 }}>Sin pasos aún; puedes agregar filas manualmente.</div>
                    ) : null}
                  </div>
                </div>
              ))}
            </div>
            <div style={{ display: "flex", justifyContent: "space-between", alignItems: "center", marginTop: 14, gap: 10, flexWrap: "wrap" }}>
              <div style={{ fontSize: ".75em", color: "#64748b" }}>Revisa y pulsa importar; te quedas en Biblioteca.</div>
              <button
                type="button"
                onClick={importAllFitDrafts}
                disabled={fitImportSaving}
                style={{
                  border: "none",
                  borderRadius: 8,
                  padding: "9px 14px",
                  background: fitImportSaving ? "#cbd5e1" : "linear-gradient(135deg,#16a34a,#22c55e)",
                  color: "#fff",
                  fontWeight: 900,
                  cursor: fitImportSaving ? "not-allowed" : "pointer",
                  fontFamily: "inherit",
                  fontSize: ".8em",
                }}
              >
                {fitImportSaving ? "Importando…" : "✅ Importar todos"}
              </button>
            </div>
          </div>
        </div>
      ) : null}
    </div>
  );
}

export default WorkoutLibrary;
