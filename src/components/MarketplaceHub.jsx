import { useState, useEffect, useMemo, useCallback } from "react";
import { supabase } from "../lib/supabase";
import { formatCopInt, getMarketplacePlanWorkoutRows } from "./shared/appShared";

function MarketplaceHub({ profileRole, currentUserId, coachUserId = null, notify, styles, MarketplacePlanWorkoutsAccordion }) {
  const S = styles;
  const isCoach = profileRole === "coach";
  const isAthlete = profileRole === "athlete";
  const isAdmin = profileRole === "admin";
  const [plans, setPlans] = useState([]);
  const [loadingPlans, setLoadingPlans] = useState(true);
  const [selectedPlan, setSelectedPlan] = useState(null);
  const [showPublishModal, setShowPublishModal] = useState(false);
  const [savingPlan, setSavingPlan] = useState(false);
  const [coachLibraryRows, setCoachLibraryRows] = useState([]);
  const [loadingLibrary, setLoadingLibrary] = useState(false);
  const [pendingPurchasesList, setPendingPurchasesList] = useState([]);
  const [loadingPendingPurchases, setLoadingPendingPurchases] = useState(false);
  const [editingMarketplacePlanId, setEditingMarketplacePlanId] = useState(null);
  const [editingPlanSnapshot, setEditingPlanSnapshot] = useState(null);
  const [planForm, setPlanForm] = useState({
    title: "",
    description: "",
    level: "intermedio",
    duration_weeks: "8",
    sessions_per_week: "4",
    price_cop: "120000",
    preview_workouts: [],
  });
  const [salesByPlanId, setSalesByPlanId] = useState({});
  const [ratingsByPlanId, setRatingsByPlanId] = useState({});

  const loadMarketplace = useCallback(async () => {
    setLoadingPlans(true);
    const { data, error } = await supabase
      .from("plan_marketplace")
      .select("*")
      .order("created_at", { ascending: false });
    setLoadingPlans(false);
    if (error) {
      console.error("plan_marketplace load:", error);
      setPlans([]);
      return;
    }
    setPlans(data || []);
  }, []);

  const loadSales = useCallback(async () => {
    const { data, error } = await supabase
      .from("plan_purchases")
      .select("plan_id, payment_status, rating")
      .order("created_at", { ascending: false });
    if (error) {
      console.error("plan_purchases load:", error);
      setSalesByPlanId({});
      setRatingsByPlanId({});
      return;
    }
    const salesMap = {};
    const ratingAcc = {};
    for (const row of data || []) {
      const pid = String(row.plan_id || "");
      if (!pid) continue;
      if (String(row.payment_status || "").toLowerCase() === "confirmed") {
        salesMap[pid] = (salesMap[pid] || 0) + 1;
      }
      if (row.rating != null && Number.isFinite(Number(row.rating))) {
        if (!ratingAcc[pid]) ratingAcc[pid] = { sum: 0, count: 0 };
        ratingAcc[pid].sum += Number(row.rating);
        ratingAcc[pid].count += 1;
      }
    }
    const ratingsMap = {};
    for (const [pid, acc] of Object.entries(ratingAcc)) {
      ratingsMap[pid] = acc.count > 0 ? acc.sum / acc.count : 0;
    }
    setSalesByPlanId(salesMap);
    setRatingsByPlanId(ratingsMap);
  }, []);

  const loadCoachLibrary = useCallback(async () => {
    if (!coachUserId) return;
    setLoadingLibrary(true);
    const { data, error } = await supabase
      .from("workout_library")
      .select("id,title,type,total_km,duration_min,description,structure,workout_structure")
      .eq("coach_id", coachUserId)
      .order("created_at", { ascending: false });
    setLoadingLibrary(false);
    if (error) {
      console.error("workout_library for marketplace:", error);
      setCoachLibraryRows([]);
      return;
    }
    setCoachLibraryRows(data || []);
  }, [coachUserId]);

  useEffect(() => {
    loadMarketplace();
    loadSales();
  }, [loadMarketplace, loadSales]);

  const loadPendingPurchases = useCallback(async () => {
    const canSeePending = isCoach || isAdmin;
    if (!canSeePending) {
      setPendingPurchasesList([]);
      setLoadingPendingPurchases(false);
      return;
    }
    setLoadingPendingPurchases(true);
    const { data, error } = await supabase.from("plan_purchases").select("*").order("created_at", { ascending: false });
    setLoadingPendingPurchases(false);
    if (error) {
      console.error("plan_purchases pending (marketplace hub):", error);
      setPendingPurchasesList([]);
      return;
    }
    const pendingRows = (data || []).filter((row) => String(row.payment_status || "").toLowerCase() === "pending");
    if (isAdmin) {
      setPendingPurchasesList(pendingRows);
    } else {
      const uid = coachUserId || currentUserId;
      if (!uid) {
        setPendingPurchasesList([]);
        return;
      }
      const myPlanIds = new Set(
        (plans || []).filter((p) => String(p.coach_user_id || "") === String(uid)).map((p) => String(p.id)),
      );
      setPendingPurchasesList(pendingRows.filter((row) => myPlanIds.has(String(row.plan_id || ""))));
    }
  }, [isCoach, isAdmin, coachUserId, currentUserId, plans]);

  useEffect(() => {
    loadPendingPurchases();
  }, [loadPendingPurchases]);

  useEffect(() => {
    if (!showPublishModal || !isCoach) return;
    loadCoachLibrary();
  }, [showPublishModal, isCoach, loadCoachLibrary]);

  const plansVisible = useMemo(() => {
    const all = plans || [];
    return all.filter((p) => {
      const active = Boolean(p.is_active);
      const own = String(p.coach_user_id || "") === String((coachUserId || currentUserId) || "");
      if (isAdmin) return true;
      if (own) return true;
      return active && Boolean(p.is_approved);
    });
  }, [plans, coachUserId, currentUserId, isAdmin]);

  const coachOwnPlans = useMemo(
    () => (plans || []).filter((p) => String(p.coach_user_id || "") === String(coachUserId || "")),
    [plans, coachUserId],
  );

  const openPurchaseInstructions = (plan) => {
    setSelectedPlan(plan);
  };

  const purchaseWhatsappHref = useMemo(() => {
    if (!selectedPlan) return "https://wa.me/573233675434";
    const txt = encodeURIComponent(
      `Hola, pagué el plan ${selectedPlan.title || "Plan"} por $${formatCopInt(selectedPlan.price_cop)} COP`,
    );
    return `https://wa.me/573233675434?text=${txt}`;
  }, [selectedPlan]);

  const selectedPlanIsOwner = useMemo(
    () => Boolean(selectedPlan && String(selectedPlan.coach_user_id || "") === String(currentUserId || "")),
    [selectedPlan, currentUserId],
  );

  const lockAfterWeek1 = Boolean(selectedPlan && !isAdmin && !selectedPlanIsOwner);

  /** Vista restringida: hay semanas distintas de la 1 (o sin numerar) → CTA de desbloqueo bajo el acordeón. */
  const planPreviewHasLockedWeeks = useMemo(() => {
    if (!selectedPlan || !lockAfterWeek1) return false;
    const arr = getMarketplacePlanWorkoutRows(selectedPlan);
    for (let j = 0; j < arr.length; j++) {
      const w = arr[j];
      const wn = w?.week != null && w.week !== "" ? Number(w.week) : NaN;
      const key = Number.isFinite(wn) && wn > 0 ? wn : 0;
      if (key !== 1) return true;
    }
    return false;
  }, [selectedPlan, lockAfterWeek1]);

  const hidePurchaseCta = useMemo(
    () => Boolean(isAdmin || selectedPlanIsOwner),
    [isAdmin, selectedPlanIsOwner],
  );

  const approveMarketplaceRow = async (planId) => {
    const { error } = await supabase.from("plan_marketplace").update({ is_approved: true, is_active: true }).eq("id", planId);
    if (error) {
      notify?.(error.message || "No se pudo aprobar");
      return;
    }
    notify?.("Plan aprobado");
    loadMarketplace();
  };

  const rejectMarketplaceRow = async (planId) => {
    if (typeof window !== "undefined" && !window.confirm("¿Rechazar este plan?")) return;
    const { error } = await supabase.from("plan_marketplace").update({ is_approved: false, is_active: false }).eq("id", planId);
    if (error) {
      notify?.(error.message || "No se pudo rechazar");
      return;
    }
    notify?.("Plan rechazado");
    loadMarketplace();
  };

  const deleteMarketplacePlanCoach = async (plan) => {
    if (!plan?.id) return;
    const uid = coachUserId || currentUserId;
    const own = String(plan.coach_user_id || "") === String(uid || "");
    if (!own && !isAdmin) return;
    if (typeof window !== "undefined" && !window.confirm("¿Eliminar este plan del marketplace?")) return;
    const { error } = await supabase.from("plan_marketplace").delete().eq("id", plan.id);
    if (error) {
      notify?.(error.message || "No se pudo eliminar");
      return;
    }
    if (String(selectedPlan?.id) === String(plan.id)) setSelectedPlan(null);
    notify?.("Plan eliminado");
    loadMarketplace();
    loadSales();
    loadPendingPurchases();
  };

  const openEditMarketplacePlan = (plan) => {
    if (!plan) return;
    const uid = coachUserId || currentUserId;
    if (!uid && !isAdmin) return;
    const own = String(plan.coach_user_id || "") === String(uid || "");
    if (!own && !isAdmin) return;
    const libIds = (Array.isArray(plan.preview_workouts) ? plan.preview_workouts : [])
      .map((w) => (w?.id != null ? String(w.id) : ""))
      .filter(Boolean);
    setEditingMarketplacePlanId(plan.id);
    setEditingPlanSnapshot(plan);
    setPlanForm({
      title: String(plan.title || ""),
      description: String(plan.description || ""),
      level: String(plan.level || "intermedio"),
      duration_weeks: String(plan.duration_weeks ?? 8),
      sessions_per_week: String(plan.sessions_per_week ?? 4),
      price_cop: String(plan.price_cop ?? 0),
      preview_workouts: libIds,
    });
    setShowPublishModal(true);
  };

  const confirmCoachPendingPurchase = async (purchaseId) => {
    const { error } = await supabase.from("plan_purchases").update({ payment_status: "confirmed" }).eq("id", purchaseId);
    if (error) {
      notify?.(error.message || "No se pudo confirmar");
      return;
    }
    notify?.("Pago confirmado");
    loadPendingPurchases();
    loadSales();
  };

  const submitCoachPlan = async () => {
    const uid = coachUserId || currentUserId;
    if (!uid) return;
    const title = String(planForm.title || "").trim();
    if (!title) {
      notify?.("Ingresa un título");
      return;
    }
    const description = String(planForm.description || "").trim();
    const durationWeeks = Math.max(1, Math.round(Number(planForm.duration_weeks) || 0));
    const sessionsPerWeek = Math.max(1, Math.round(Number(planForm.sessions_per_week) || 0));
    const priceCop = Math.max(0, Math.round(Number(String(planForm.price_cop).replace(/[^\d]/g, "")) || 0));
    const selectedPreview = (coachLibraryRows || []).filter((w) => planForm.preview_workouts.includes(String(w.id)));
    const previewWorkouts = selectedPreview.map((w) => ({
      id: w.id,
      title: w.title,
      type: w.type,
      total_km: Number(w.total_km || 0),
      duration_min: Number(w.duration_min || 0),
      description: w.description || "",
      workout_structure: Array.isArray(w.workout_structure) ? w.workout_structure : Array.isArray(w.structure) ? w.structure : [],
    }));
    const fallbackPreview =
      editingPlanSnapshot && Array.isArray(editingPlanSnapshot.preview_workouts) ? editingPlanSnapshot.preview_workouts : [];
    const fallbackSessions = editingPlanSnapshot ? getMarketplacePlanWorkoutRows(editingPlanSnapshot) : [];
    const outPreview = previewWorkouts.length > 0 ? previewWorkouts : fallbackPreview;
    const outSessions = previewWorkouts.length > 0 ? previewWorkouts : fallbackSessions.length > 0 ? fallbackSessions : outPreview;
    setSavingPlan(true);
    let error = null;
    if (editingMarketplacePlanId) {
      let upd = supabase
        .from("plan_marketplace")
        .update({
          title,
          description,
          level: String(planForm.level || "intermedio"),
          duration_weeks: durationWeeks,
          sessions_per_week: sessionsPerWeek,
          price_cop: priceCop,
          preview_workouts: outPreview,
          plan_sessions: outSessions,
        })
        .eq("id", editingMarketplacePlanId);
      if (!isAdmin) upd = upd.eq("coach_user_id", uid);
      const res = await upd;
      error = res.error;
    } else {
      const res = await supabase.from("plan_marketplace").insert({
        coach_user_id: uid,
        coach_id: uid,
        coach_name: "",
        title,
        description,
        level: String(planForm.level || "intermedio"),
        duration_weeks: durationWeeks,
        sessions_per_week: sessionsPerWeek,
        price_cop: priceCop,
        preview_workouts: outPreview,
        plan_sessions: outSessions,
        is_active: true,
        is_approved: false,
      });
      error = res.error;
    }
    setSavingPlan(false);
    if (error) {
      console.error("plan_marketplace coach save:", error);
      notify?.(error.message || "No se pudo guardar el plan");
      return;
    }
    notify?.(editingMarketplacePlanId ? "Plan actualizado." : "Plan enviado. Quedó pendiente de aprobación.");
    setShowPublishModal(false);
    setEditingMarketplacePlanId(null);
    setEditingPlanSnapshot(null);
    setPlanForm({
      title: "",
      description: "",
      level: "intermedio",
      duration_weeks: "8",
      sessions_per_week: "4",
      price_cop: "120000",
      preview_workouts: [],
    });
    loadMarketplace();
    loadSales();
    loadPendingPurchases();
  };

  const cardStyle = {
    border: "1px solid #e2e8f0",
    borderRadius: 12,
    padding: "12px 14px",
    background: "#fff",
    boxShadow: "0 1px 2px rgba(15,23,42,.04)",
  };

  return (
    <div style={S.page}>
      <div style={{ display: "flex", justifyContent: "space-between", alignItems: "center", gap: 10, flexWrap: "wrap", marginBottom: 14 }}>
        <h1 style={{ ...S.pageTitle, marginBottom: 0 }}>🛒 Marketplace</h1>
        {isCoach ? (
          <button
            type="button"
            onClick={() => {
              setEditingMarketplacePlanId(null);
              setEditingPlanSnapshot(null);
              setPlanForm({
                title: "",
                description: "",
                level: "intermedio",
                duration_weeks: "8",
                sessions_per_week: "4",
                price_cop: "120000",
                preview_workouts: [],
              });
              setShowPublishModal(true);
            }}
            style={{ background: "linear-gradient(135deg,#0ea5e9,#0284c7)", border: "none", borderRadius: 9, padding: "8px 12px", color: "#fff", fontWeight: 800, cursor: "pointer", fontFamily: "inherit", fontSize: ".8em" }}
          >
            ➕ Publicar plan
          </button>
        ) : null}
      </div>

      {isCoach ? (
        <div style={{ ...S.card, marginBottom: 14 }}>
          <div style={{ fontSize: ".72em", letterSpacing: ".12em", textTransform: "uppercase", color: "#64748b", marginBottom: 8 }}>
            Mis planes publicados
          </div>
          {coachOwnPlans.length === 0 ? (
            <div style={{ color: "#94a3b8", fontSize: ".85em" }}>Aún no has publicado planes.</div>
          ) : (
            <div style={{ display: "grid", gap: 10 }}>
              {coachOwnPlans.map((p) => {
                const sales = Number(salesByPlanId[String(p.id)] || 0);
                const price = Number(p.price_cop || 0);
                const coachEarnings = Math.round(price * sales * 0.8);
                const approved = p.is_approved === true || p.is_approved === "true";
                return (
                  <div key={p.id} style={{ ...cardStyle, background: "#f8fafc" }}>
                    <div style={{ display: "flex", justifyContent: "space-between", gap: 10, flexWrap: "wrap", alignItems: "flex-start" }}>
                      <div style={{ flex: 1, minWidth: 0 }}>
                        <div style={{ display: "flex", alignItems: "center", gap: 8, flexWrap: "wrap" }}>
                          <div style={{ fontWeight: 800 }}>{p.title}</div>
                          <span
                            style={{
                              fontSize: ".62em",
                              fontWeight: 900,
                              letterSpacing: ".04em",
                              textTransform: "uppercase",
                              borderRadius: 999,
                              padding: "4px 10px",
                              border: approved ? "1px solid #86efac" : "1px solid #fdba74",
                              background: approved ? "#dcfce7" : "#ffedd5",
                              color: approved ? "#166534" : "#9a3412",
                            }}
                          >
                            {approved ? "Aprobado" : "Pendiente"}
                          </span>
                        </div>
                        <div style={{ fontSize: ".8em", color: "#64748b", marginTop: 4 }}>
                          {p.duration_weeks} semanas · {p.sessions_per_week} sesiones/sem
                        </div>
                      </div>
                      <div style={{ textAlign: "right" }}>
                        <div style={{ fontWeight: 800, color: approved ? "#16a34a" : "#b45309" }}>
                          {approved ? "Visible en tienda" : "En revisión"}
                        </div>
                        <div style={{ fontSize: ".78em", color: "#64748b", marginTop: 4 }}>Ventas: {sales}</div>
                      </div>
                    </div>
                    <div style={{ marginTop: 8, fontSize: ".82em", color: "#0f172a", fontWeight: 700 }}>
                      Ganancia estimada: ${formatCopInt(coachEarnings)} COP
                    </div>
                    <div style={{ marginTop: 4, fontSize: ".75em", color: "#64748b" }}>
                      Tu ganancia: ${formatCopInt(Math.round(price * 0.8))} COP (80% del precio)
                    </div>
                    <div style={{ marginTop: 10, display: "flex", gap: 8, flexWrap: "wrap" }}>
                      <button
                        type="button"
                        onClick={() => openEditMarketplacePlan(p)}
                        style={{
                          border: "1px solid #bae6fd",
                          background: "#f0f9ff",
                          color: "#0369a1",
                          borderRadius: 8,
                          padding: "6px 10px",
                          fontWeight: 800,
                          cursor: "pointer",
                          fontFamily: "inherit",
                          fontSize: ".74em",
                        }}
                      >
                        ✏️ Editar
                      </button>
                      <button
                        type="button"
                        onClick={() => deleteMarketplacePlanCoach(p)}
                        style={{
                          border: "1px solid #fecaca",
                          background: "#fef2f2",
                          color: "#b91c1c",
                          borderRadius: 8,
                          padding: "6px 10px",
                          fontWeight: 800,
                          cursor: "pointer",
                          fontFamily: "inherit",
                          fontSize: ".74em",
                        }}
                      >
                        🗑️ Eliminar
                      </button>
                    </div>
                  </div>
                );
              })}
            </div>
          )}
        </div>
      ) : null}

      {isCoach || isAdmin ? (
        <div style={{ ...S.card, marginBottom: 14 }}>
          <div style={{ fontSize: ".72em", letterSpacing: ".12em", textTransform: "uppercase", color: "#64748b", marginBottom: 8 }}>
            Compras pendientes de confirmar
          </div>
          {loadingPendingPurchases ? (
            <div style={{ color: "#64748b", fontSize: ".84em" }}>Cargando compras…</div>
          ) : pendingPurchasesList.length === 0 ? (
            <div style={{ color: "#94a3b8", fontSize: ".84em" }}>No hay compras pendientes.</div>
          ) : (
            <div style={{ display: "grid", gap: 8 }}>
              {pendingPurchasesList.map((row) => (
                <div
                  key={row.id}
                  style={{
                    border: "1px solid #e2e8f0",
                    borderRadius: 10,
                    padding: "10px 12px",
                    background: "#f8fafc",
                    display: "flex",
                    justifyContent: "space-between",
                    gap: 10,
                    flexWrap: "wrap",
                    alignItems: "center",
                  }}
                >
                  <div style={{ fontSize: ".82em", color: "#334155" }}>
                    Plan: <strong>{row.plan_title || row.plan_id}</strong> · ${formatCopInt(row.amount_cop || 0)} COP · {row.buyer_name || row.buyer_user_id || "Comprador"}
                  </div>
                  <button
                    type="button"
                    onClick={() => confirmCoachPendingPurchase(row.id)}
                    style={{
                      border: "1px solid #bbf7d0",
                      background: "#f0fdf4",
                      color: "#166534",
                      borderRadius: 8,
                      padding: "7px 10px",
                      fontWeight: 800,
                      cursor: "pointer",
                      fontFamily: "inherit",
                      fontSize: ".76em",
                    }}
                  >
                    ✅ Confirmar pago
                  </button>
                </div>
              ))}
            </div>
          )}
        </div>
      ) : null}

      {loadingPlans ? (
        <div style={{ color: "#64748b" }}>Cargando planes…</div>
      ) : plansVisible.length === 0 ? (
        <div style={{ color: "#94a3b8" }}>No hay planes disponibles por ahora.</div>
      ) : (
        <div style={{ display: "grid", gridTemplateColumns: "repeat(auto-fill,minmax(240px,1fr))", gap: 12 }}>
          {plansVisible.map((p) => {
            const rating = Number(ratingsByPlanId[String(p.id)] || 0);
            const ratingStars = "★".repeat(Math.round(Math.min(5, Math.max(0, rating)))) + "☆".repeat(5 - Math.round(Math.min(5, Math.max(0, rating))));
            const coachUid = coachUserId || currentUserId;
            const approved = p.is_approved === true || p.is_approved === "true";
            const canManage = isAdmin || String(p.coach_user_id || "") === String(coachUid || "");
            return (
              <div key={p.id} style={cardStyle}>
                <div style={{ display: "flex", justifyContent: "space-between", gap: 8, alignItems: "flex-start" }}>
                  <div style={{ fontWeight: 800, color: "#0f172a", flex: 1, minWidth: 0 }}>{p.title}</div>
                  <div style={{ display: "flex", flexDirection: "column", alignItems: "flex-end", gap: 4 }}>
                    <span style={{ fontSize: ".7em", borderRadius: 999, padding: "3px 8px", background: "rgba(14,165,233,.12)", color: "#0369a1", fontWeight: 800 }}>
                      {String(p.level || "intermedio")}
                    </span>
                    <span
                      style={{
                        fontSize: ".58em",
                        fontWeight: 900,
                        letterSpacing: ".06em",
                        textTransform: "uppercase",
                        borderRadius: 999,
                        padding: "3px 7px",
                        border: approved ? "1px solid #86efac" : "1px solid #fdba74",
                        background: approved ? "#dcfce7" : "#ffedd5",
                        color: approved ? "#166534" : "#9a3412",
                      }}
                    >
                      {approved ? "Aprobado" : "Pendiente"}
                    </span>
                  </div>
                </div>
                <div style={{ fontSize: ".78em", color: "#64748b", marginTop: 4 }}>Coach: {p.coach_name || "Coach"}</div>
                <div style={{ fontSize: ".78em", color: "#64748b", marginTop: 2 }}>{p.duration_weeks} semanas · {p.sessions_per_week} sesiones/semana</div>
                <div style={{ marginTop: 8, fontSize: ".95em", fontWeight: 800, color: "#0f172a" }}>${formatCopInt(p.price_cop)} COP</div>
                <div style={{ marginTop: 6, fontSize: ".78em", color: "#f59e0b", fontWeight: 700 }}>{ratingStars} {rating > 0 ? rating.toFixed(1) : "0.0"}</div>
                <button type="button" onClick={() => setSelectedPlan(p)} style={{ marginTop: 10, width: "100%", background: "linear-gradient(135deg,#0d9488,#14b8a6)", border: "none", borderRadius: 8, padding: "8px 10px", color: "#fff", fontWeight: 800, cursor: "pointer", fontFamily: "inherit", fontSize: ".78em" }}>
                  Ver plan
                </button>
                {isAdmin ? (
                  <div style={{ display: "flex", gap: 6, marginTop: 8, flexWrap: "wrap" }}>
                    <button
                      type="button"
                      onClick={() => approveMarketplaceRow(p.id)}
                      style={{
                        flex: 1,
                        minWidth: 100,
                        border: "1px solid #bbf7d0",
                        background: "#f0fdf4",
                        color: "#166534",
                        borderRadius: 8,
                        padding: "6px 8px",
                        fontWeight: 800,
                        cursor: "pointer",
                        fontFamily: "inherit",
                        fontSize: ".72em",
                      }}
                    >
                      ✅ Aprobar
                    </button>
                    <button
                      type="button"
                      onClick={() => rejectMarketplaceRow(p.id)}
                      style={{
                        flex: 1,
                        minWidth: 100,
                        border: "1px solid #fecaca",
                        background: "#fef2f2",
                        color: "#b91c1c",
                        borderRadius: 8,
                        padding: "6px 8px",
                        fontWeight: 800,
                        cursor: "pointer",
                        fontFamily: "inherit",
                        fontSize: ".72em",
                      }}
                    >
                      ❌ Rechazar
                    </button>
                  </div>
                ) : null}
                {canManage && (isCoach || isAdmin) ? (
                  <div style={{ display: "flex", gap: 6, marginTop: 8, flexWrap: "wrap" }}>
                    <button
                      type="button"
                      onClick={() => openEditMarketplacePlan(p)}
                      style={{
                        flex: 1,
                        minWidth: 100,
                        border: "1px solid #bae6fd",
                        background: "#f0f9ff",
                        color: "#0369a1",
                        borderRadius: 8,
                        padding: "6px 8px",
                        fontWeight: 800,
                        cursor: "pointer",
                        fontFamily: "inherit",
                        fontSize: ".72em",
                      }}
                    >
                      ✏️ Editar
                    </button>
                    <button
                      type="button"
                      onClick={() => deleteMarketplacePlanCoach(p)}
                      style={{
                        flex: 1,
                        minWidth: 100,
                        border: "1px solid #fecaca",
                        background: "#fef2f2",
                        color: "#b91c1c",
                        borderRadius: 8,
                        padding: "6px 8px",
                        fontWeight: 800,
                        cursor: "pointer",
                        fontFamily: "inherit",
                        fontSize: ".72em",
                      }}
                    >
                      🗑️ Eliminar
                    </button>
                  </div>
                ) : null}
              </div>
            );
          })}
        </div>
      )}

      {selectedPlan ? (
        <div style={{ position: "fixed", inset: 0, zIndex: 10030, background: "rgba(15,23,42,.45)", display: "flex", alignItems: "center", justifyContent: "center", padding: 16 }}>
          <div style={{ ...S.card, width: "100%", maxWidth: 720, margin: 0, maxHeight: "90vh", overflowY: "auto" }}>
            <div style={{ display: "flex", justifyContent: "space-between", gap: 10, alignItems: "center", marginBottom: 8 }}>
              <div style={{ fontSize: "1.05em", fontWeight: 900 }}>{selectedPlan.title}</div>
              <button type="button" onClick={() => setSelectedPlan(null)} style={{ border: "1px solid #e2e8f0", background: "#fff", borderRadius: 8, padding: "6px 10px", cursor: "pointer", fontFamily: "inherit" }}>✕</button>
            </div>
            <div style={{ color: "#475569", fontSize: ".86em", marginBottom: 10 }}>{selectedPlan.description || "Sin descripción."}</div>
            <div style={{ fontSize: ".78em", fontWeight: 800, color: "#334155", marginBottom: 8 }}>Contenido del plan</div>
            <MarketplacePlanWorkoutsAccordion previewWorkouts={getMarketplacePlanWorkoutRows(selectedPlan)} resetKey={selectedPlan.id} lockAfterWeek1={lockAfterWeek1} />
            {!hidePurchaseCta && planPreviewHasLockedWeeks ? (
              <div style={{ marginTop: 14, marginBottom: 12, padding: "14px 16px", borderRadius: 12, background: "linear-gradient(180deg,#f1f5f9,#fff)", border: "1px solid #e2e8f0", textAlign: "center" }}>
                <div style={{ fontSize: ".9em", fontWeight: 800, color: "#0f172a", marginBottom: 12, lineHeight: 1.45 }}>
                  Adquiere este plan para desbloquear todas las semanas
                </div>
                <button type="button" onClick={() => openPurchaseInstructions(selectedPlan)} style={{ width: "100%", background: "linear-gradient(135deg,#ea580c,#f97316)", border: "none", borderRadius: 10, padding: "10px 14px", color: "#fff", fontWeight: 900, cursor: "pointer", fontFamily: "inherit", fontSize: ".85em" }}>
                  Comprar - ${formatCopInt(selectedPlan.price_cop)} COP
                </button>
              </div>
            ) : !hidePurchaseCta ? (
              <button type="button" onClick={() => openPurchaseInstructions(selectedPlan)} style={{ width: "100%", background: "linear-gradient(135deg,#ea580c,#f97316)", border: "none", borderRadius: 10, padding: "10px 14px", color: "#fff", fontWeight: 900, cursor: "pointer", fontFamily: "inherit", fontSize: ".85em", marginTop: 10 }}>
                Comprar - ${formatCopInt(selectedPlan.price_cop)} COP
              </button>
            ) : null}
            <div style={{ marginTop: 12, border: "1px solid #e2e8f0", borderRadius: 10, padding: 12, background: "#fff7ed" }}>
              <div style={{ fontWeight: 800, marginBottom: 6 }}>Realiza tu pago a:</div>
              <div style={{ fontSize: ".84em", lineHeight: 1.5 }}>
                📱 Nequi: 3233675434
                <br />
                📸 Envía comprobante por WhatsApp indicando el plan: {selectedPlan.title}
                <br />
                ✅ Recibirás el plan en menos de 24 horas
              </div>
              <a href={purchaseWhatsappHref} target="_blank" rel="noreferrer" style={{ display: "inline-block", marginTop: 10, background: "#16a34a", color: "#fff", textDecoration: "none", borderRadius: 8, padding: "8px 12px", fontWeight: 800, fontSize: ".8em" }}>
                Enviar comprobante
              </a>
            </div>
          </div>
        </div>
      ) : null}

      {showPublishModal ? (
        <div style={{ position: "fixed", inset: 0, zIndex: 10031, background: "rgba(15,23,42,.45)", display: "flex", alignItems: "center", justifyContent: "center", padding: 16 }}>
          <div style={{ ...S.card, width: "100%", maxWidth: 760, margin: 0, maxHeight: "90vh", overflowY: "auto" }}>
            <div style={{ fontSize: "1.02em", fontWeight: 900, marginBottom: 10 }}>{editingMarketplacePlanId ? "✏️ Editar plan" : "➕ Publicar plan"}</div>
            <div style={{ display: "grid", gridTemplateColumns: "repeat(2,minmax(0,1fr))", gap: 10 }}>
              <input value={planForm.title} onChange={(e) => setPlanForm((f) => ({ ...f, title: e.target.value }))} placeholder="Título" style={{ gridColumn: "1 / -1", border: "1px solid #e2e8f0", borderRadius: 8, padding: "9px 10px", fontFamily: "inherit" }} />
              <textarea value={planForm.description} onChange={(e) => setPlanForm((f) => ({ ...f, description: e.target.value }))} rows={3} placeholder="Descripción" style={{ gridColumn: "1 / -1", border: "1px solid #e2e8f0", borderRadius: 8, padding: "9px 10px", fontFamily: "inherit", boxSizing: "border-box" }} />
              <select value={planForm.level} onChange={(e) => setPlanForm((f) => ({ ...f, level: e.target.value }))} style={{ border: "1px solid #e2e8f0", borderRadius: 8, padding: "9px 10px", fontFamily: "inherit" }}>
                <option value="principiante">principiante</option>
                <option value="intermedio">intermedio</option>
                <option value="avanzado">avanzado</option>
              </select>
              <input type="number" value={planForm.duration_weeks} onChange={(e) => setPlanForm((f) => ({ ...f, duration_weeks: e.target.value }))} placeholder="Duración semanas" style={{ border: "1px solid #e2e8f0", borderRadius: 8, padding: "9px 10px", fontFamily: "inherit" }} />
              <input type="number" value={planForm.sessions_per_week} onChange={(e) => setPlanForm((f) => ({ ...f, sessions_per_week: e.target.value }))} placeholder="Sesiones/semana" style={{ border: "1px solid #e2e8f0", borderRadius: 8, padding: "9px 10px", fontFamily: "inherit" }} />
              <input type="number" value={planForm.price_cop} onChange={(e) => setPlanForm((f) => ({ ...f, price_cop: e.target.value }))} placeholder="Precio COP" style={{ border: "1px solid #e2e8f0", borderRadius: 8, padding: "9px 10px", fontFamily: "inherit" }} />
              <div style={{ gridColumn: "1 / -1", border: "1px solid #e2e8f0", borderRadius: 10, padding: 10 }}>
                <div style={{ fontSize: ".78em", fontWeight: 800, marginBottom: 8 }}>Workouts de muestra (biblioteca)</div>
                {loadingLibrary ? (
                  <div style={{ color: "#64748b", fontSize: ".82em" }}>Cargando biblioteca…</div>
                ) : coachLibraryRows.length === 0 ? (
                  <div style={{ color: "#94a3b8", fontSize: ".82em" }}>No tienes workouts en tu biblioteca.</div>
                ) : (
                  <div style={{ display: "grid", gap: 6, maxHeight: 220, overflowY: "auto" }}>
                    {coachLibraryRows.map((w) => {
                      const checked = planForm.preview_workouts.includes(String(w.id));
                      return (
                        <label key={w.id} style={{ display: "flex", gap: 8, alignItems: "center", fontSize: ".82em", color: "#334155" }}>
                          <input
                            type="checkbox"
                            checked={checked}
                            onChange={() =>
                              setPlanForm((f) => ({
                                ...f,
                                preview_workouts: checked
                                  ? f.preview_workouts.filter((id) => id !== String(w.id))
                                  : [...f.preview_workouts, String(w.id)],
                              }))
                            }
                          />
                          <span>{w.title} · {w.total_km || 0} km · {w.duration_min || 0} min</span>
                        </label>
                      );
                    })}
                  </div>
                )}
              </div>
            </div>
            <div style={{ marginTop: 8, fontSize: ".8em", color: "#334155", fontWeight: 700 }}>
              Tu ganancia: ${formatCopInt(Math.round((Number(planForm.price_cop || 0) || 0) * 0.8))} COP (80% del precio)
            </div>
            <div style={{ display: "flex", justifyContent: "flex-end", gap: 8, marginTop: 12 }}>
              <button
                type="button"
                onClick={() => {
                  setShowPublishModal(false);
                  setEditingMarketplacePlanId(null);
                  setEditingPlanSnapshot(null);
                }}
                style={{ border: "1px solid #e2e8f0", borderRadius: 8, background: "#fff", padding: "8px 12px", cursor: "pointer", fontFamily: "inherit" }}
              >
                Cancelar
              </button>
              <button type="button" onClick={submitCoachPlan} disabled={savingPlan} style={{ border: "none", borderRadius: 8, background: savingPlan ? "#cbd5e1" : "linear-gradient(135deg,#0ea5e9,#0284c7)", padding: "8px 12px", color: "#fff", fontWeight: 800, cursor: savingPlan ? "not-allowed" : "pointer", fontFamily: "inherit" }}>
                {savingPlan ? "Guardando…" : editingMarketplacePlanId ? "Guardar cambios" : "Publicar plan"}
              </button>
            </div>
          </div>
        </div>
      ) : null}
    </div>
  );
}

export default MarketplaceHub;
