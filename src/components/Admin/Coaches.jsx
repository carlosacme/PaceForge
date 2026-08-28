import React, { useState, useEffect, useMemo, useCallback } from "react";
import { supabase } from "../../lib/supabase";
import {
  styles,
  getCurrentMonthKey,
  coachTrialDaysRemainingFromStart,
} from "../shared/appShared";

export default function AdminCoachesProfilesPanel({ notify, adminUserId }) {
  const S = styles;
  const monthKey = useMemo(() => getCurrentMonthKey(), []);
  const [rows, setRows] = useState([]);
  const [emailByUserId, setEmailByUserId] = useState({});
  const [generationsByCoachId, setGenerationsByCoachId] = useState({});
  const [loadingGenerations, setLoadingGenerations] = useState(false);
  const [loading, setLoading] = useState(true);
  const [busyKey, setBusyKey] = useState("");
  const [activateMonthsChoice, setActivateMonthsChoice] = useState({});

  const load = useCallback(async () => {
    setLoading(true);
    const { data: profs, error } = await supabase
      .from("profiles")
      .select(
        "user_id,name,email,plan_status,trial_started_at,plan_validated_at,plan_validated_by,role,subscription_plan,subscription_period,subscription_amount,subscription_expires_at",
      )
      .eq("role", "coach")
      .order("name", { ascending: true });
    if (error) {
      console.error(error);
      notify("No se pudieron cargar los coaches.");
      setRows([]);
      setLoading(false);
      return;
    }
    const list = profs || [];
    setRows(list);
    const uids = list.map((r) => r.user_id).filter(Boolean);
    if (uids.length === 0) {
      setEmailByUserId({});
      setGenerationsByCoachId({});
      setLoading(false);
      return;
    }
    const em = {};
    for (const r of list) {
      if (r.email && String(r.email).trim()) em[r.user_id] = String(r.email).toLowerCase();
    }
    const needCp = uids.filter((id) => !em[id]);
    if (needCp.length > 0) {
      const { data: cps, error: cpErr } = await supabase.from("coach_profiles").select("user_id,email").in("user_id", needCp);
      if (cpErr) console.warn("coach_profiles emails:", cpErr);
      for (const r of cps || []) {
        if (r.email) em[r.user_id] = String(r.email).toLowerCase();
      }
    }
    setLoadingGenerations(true);
    const { data: generationRows, error: generationsErr } = await supabase
      .from("ai_generations")
      .select("coach_id,count")
      .eq("month", monthKey)
      .in("coach_id", uids);
    if (generationsErr) console.error("ai_generations admin list:", generationsErr);
    const generationMap = {};
    for (const row of generationRows || []) {
      generationMap[row.coach_id] = Number(row.count) || 0;
    }
    setGenerationsByCoachId(generationMap);
    setLoadingGenerations(false);
    setEmailByUserId(em);
    setLoading(false);
  }, [notify, monthKey]);

  useEffect(() => {
    load();
  }, [load]);

  const planBadge = (st) => {
    const s = st || "—";
    const colors =
      s === "trial"
        ? { bg: "#fef9c3", fg: "#854d0e", bd: "#fde047" }
        : s === "active"
          ? { bg: "#dcfce7", fg: "#166534", bd: "#86efac" }
          : s === "blocked"
            ? { bg: "#fee2e2", fg: "#991b1b", bd: "#fecaca" }
            : { bg: "#f1f5f9", fg: "#475569", bd: "#e2e8f0" };
    return (
      <span
        style={{
          fontSize: ".72em",
          fontWeight: 800,
          padding: "3px 8px",
          borderRadius: 6,
          background: colors.bg,
          color: colors.fg,
          border: `1px solid ${colors.bd}`,
        }}
      >
        {s}
      </span>
    );
  };

  /** Días hasta subscription_expires_at; si no hay fecha, muestra días de trial cuando aplica. */
  const subscriptionDaysRemainingCol = (p) => {
    const raw = p.subscription_expires_at;
    if (raw) {
      const end = new Date(raw);
      if (Number.isNaN(end.getTime())) return "—";
      const days = Math.ceil((end.getTime() - Date.now()) / (1000 * 60 * 60 * 24));
      if (days < 0) return "Vencido";
      return `Vence en ${days} día${days === 1 ? "" : "s"}`;
    }
    if (p.plan_status === "trial" && p.trial_started_at) {
      const d = coachTrialDaysRemainingFromStart(p);
      return d == null ? "—" : `${d} día${d === 1 ? "" : "s"} (trial)`;
    }
    return "—";
  };

  const validatedCol = (p) =>
    p.plan_validated_at ? new Date(p.plan_validated_at).toLocaleString("es", { dateStyle: "short", timeStyle: "short" }) : "—";

  const chosenPlanBadge = (planRaw) => {
    const p = String(planRaw || "").trim();
    if (!p) return <span style={{ color: "#94a3b8" }}>—</span>;
    const low = p.toLowerCase();
    const isPro = low === "pro";
    const label = low === "basico" || low === "básico" ? "Básico" : isPro ? "Pro" : p;
    const colors = isPro
      ? { bg: "#fffbeb", fg: "#b45309", bd: "#fcd34d" }
      : { bg: "#eff6ff", fg: "#1d4ed8", bd: "#93c5fd" };
    return (
      <span
        style={{
          fontSize: ".72em",
          fontWeight: 800,
          padding: "3px 8px",
          borderRadius: 6,
          background: colors.bg,
          color: colors.fg,
          border: `1px solid ${colors.bd}`,
        }}
      >
        {label}
      </span>
    );
  };

  const subscriptionPeriodLabel = (per) => {
    const k = String(per || "").trim().toLowerCase();
    const map = { mensual: "Mensual", monthly: "Mensual", semestral: "Semestral", anual: "Anual", yearly: "Anual" };
    return map[k] || (per ? String(per) : "—");
  };

  const formatSubscriptionAmountCop = (amt) => {
    if (amt == null || amt === "") return "—";
    const n = Number(amt);
    if (!Number.isFinite(n)) return "—";
    return `$${n.toLocaleString("es-CO", { maximumFractionDigits: 0 })} COP`;
  };

  const addCalendarMonths = (fromDate, months) => {
    const d = new Date(fromDate.getTime());
    const day = d.getDate();
    d.setMonth(d.getMonth() + months);
    if (d.getDate() < day) d.setDate(0);
    return d;
  };

  const runAction = async (key, uid, payload) => {
    setBusyKey(`${key}-${uid}`);
    const { error } = await supabase.from("profiles").update(payload).eq("user_id", uid);
    setBusyKey("");
    if (error) {
      notify(error.message || "Error al actualizar");
      return;
    }
    notify("Actualizado ✓");
    load();
  };

  /** Activa / renueva suscripción admin: siempre sobrescribe vencimiento y período desde HOY (no acumula ni compara con el período anterior). */
  const activateCoachWithMonths = (uid, months) => {
    const m = Number(months);
    if (![1, 6, 12].includes(m)) return;
    const now = new Date();
    const subscription_expires_at = addCalendarMonths(now, m).toISOString();
    const subscription_period = m === 1 ? "mensual" : m === 6 ? "semestral" : "anual";
    runAction("act", uid, {
      subscription_expires_at,
      subscription_period,
      plan_status: "active",
      plan_validated_at: now.toISOString(),
      plan_validated_by: adminUserId,
    });
  };

  const blockCoachProf = (uid) => {
    if (typeof window !== "undefined" && !window.confirm("¿Bloquear este coach?")) return;
    runAction("blk", uid, { plan_status: "blocked" });
  };

  const resetTrial = (uid) =>
    runAction("rst", uid, { plan_status: "trial", trial_started_at: new Date().toISOString() });

  const resetCoachGenerations = async (uid, coachName) => {
    const displayName = (coachName && String(coachName).trim()) || "coach";
    if (typeof window !== "undefined" && !window.confirm(`¿Resetear generaciones de ${displayName}?`)) return;
    setBusyKey(`gen-${uid}`);
    const { error } = await supabase
      .from("ai_generations")
      .delete()
      .eq("coach_id", uid)
      .eq("month", monthKey);
    setBusyKey("");
    if (error) {
      notify(error.message || "Error al resetear generaciones");
      return;
    }
    setGenerationsByCoachId((prev) => ({ ...prev, [uid]: 0 }));
    notify("Generaciones reseteadas ✓");
  };

  const cell = { padding: "10px 12px", fontSize: ".78em", color: "#334155", borderBottom: "1px solid #e2e8f0" };
  const th = { ...cell, fontWeight: 800, color: "#64748b", background: "#f8fafc" };

  return (
    <div style={S.page}>
      <h1 style={S.pageTitle}>Coaches</h1>
      <p style={{ color: "#475569", fontSize: ".85em", marginTop: 4, marginBottom: 18 }}>
        Perfiles con rol coach: plan, trial y validación.
      </p>
      {loading ? (
        <div style={{ color: "#64748b" }}>Cargando…</div>
      ) : rows.length === 0 ? (
        <div style={{ color: "#94a3b8" }}>No hay coaches.</div>
      ) : (
        <div style={{ overflowX: "auto", border: "1px solid #e2e8f0", borderRadius: 12, background: "#fff" }}>
          <table style={{ width: "100%", borderCollapse: "collapse", minWidth: 1180 }}>
            <thead>
              <tr>
                <th style={th}>Nombre</th>
                <th style={th}>Correo</th>
                <th style={th}>Estado</th>
                <th style={th}>Plan elegido</th>
                <th style={th}>Período</th>
                <th style={th}>Monto</th>
                <th style={th}>Días restantes</th>
                <th style={th}>Fecha validación</th>
                <th style={th}>Generaciones</th>
                <th style={th}>Acciones</th>
              </tr>
            </thead>
            <tbody>
              {rows.map((p) => {
                const uid = p.user_id;
                const busy = busyKey === `act-${uid}` || busyKey === `blk-${uid}` || busyKey === `rst-${uid}` || busyKey === `gen-${uid}`;
                const generationsThisMonth = Number(generationsByCoachId[uid]) || 0;
                return (
                  <tr key={uid}>
                    <td style={cell}>{(p.name && String(p.name).trim()) || "—"}</td>
                    <td style={cell}>{emailByUserId[uid] || "—"}</td>
                    <td style={cell}>{planBadge(p.plan_status || "—")}</td>
                    <td style={cell}>{chosenPlanBadge(p.subscription_plan)}</td>
                    <td style={cell}>{subscriptionPeriodLabel(p.subscription_period)}</td>
                    <td style={cell}>{formatSubscriptionAmountCop(p.subscription_amount)}</td>
                    <td style={cell}>{subscriptionDaysRemainingCol(p)}</td>
                    <td style={cell}>{validatedCol(p)}</td>
                    <td style={cell}>
                      <div style={{ fontWeight: 700, color: "#0f172a", marginBottom: 8 }}>
                        {loadingGenerations ? "…" : `${generationsThisMonth} este mes`}
                      </div>
                      <button
                        type="button"
                        disabled={busy}
                        onClick={() => resetCoachGenerations(uid, p.name)}
                        style={{
                          padding: "6px 10px",
                          borderRadius: 8,
                          border: "1px solid #bfdbfe",
                          background: busy ? "#e2e8f0" : "#eff6ff",
                          color: "#1d4ed8",
                          fontWeight: 700,
                          fontSize: ".72em",
                          cursor: busy ? "not-allowed" : "pointer",
                          fontFamily: "inherit",
                        }}
                      >
                        🔄 Resetear
                      </button>
                    </td>
                    <td style={{ ...cell, verticalAlign: "top" }}>
                      <div
                        style={{
                          display: "flex",
                          flexDirection: "column",
                          alignItems: "flex-start",
                          gap: 6,
                          marginBottom: 8,
                          padding: "8px 0",
                          borderBottom: "1px dashed #e2e8f0",
                        }}
                      >
                        <span style={{ fontSize: ".68em", fontWeight: 800, color: "#64748b" }}>Activar por:</span>
                        <div style={{ display: "flex", flexWrap: "wrap", alignItems: "center", gap: 6 }}>
                          <select
                            value={activateMonthsChoice[uid] ?? "1"}
                            onChange={(e) =>
                              setActivateMonthsChoice((prev) => ({ ...prev, [uid]: e.target.value }))
                            }
                            disabled={busy}
                            style={{
                              padding: "6px 8px",
                              borderRadius: 8,
                              border: "1px solid #e2e8f0",
                              fontSize: ".72em",
                              fontFamily: "inherit",
                              color: "#0f172a",
                              background: "#fff",
                              minWidth: 110,
                            }}
                          >
                            <option value="1">1 mes</option>
                            <option value="6">6 meses</option>
                            <option value="12">1 año</option>
                          </select>
                          <button
                            type="button"
                            disabled={busy}
                            onClick={() => {
                              const raw = activateMonthsChoice[uid] ?? "1";
                              const months =
                                raw === "12" || raw === 12 ? 12 : raw === "6" || raw === 6 ? 6 : 1;
                              activateCoachWithMonths(uid, months);
                            }}
                            style={{
                              padding: "6px 10px",
                              borderRadius: 8,
                              border: "1px solid #bbf7d0",
                              background: busy ? "#e2e8f0" : "#f0fdf4",
                              color: "#15803d",
                              fontWeight: 700,
                              fontSize: ".72em",
                              cursor: busy ? "not-allowed" : "pointer",
                              fontFamily: "inherit",
                            }}
                          >
                            Activar
                          </button>
                        </div>
                      </div>
                      <button
                        type="button"
                        disabled={busy}
                        onClick={() => blockCoachProf(uid)}
                        style={{
                          marginRight: 6,
                          padding: "6px 10px",
                          borderRadius: 8,
                          border: "1px solid #fecaca",
                          background: busy ? "#e2e8f0" : "#fef2f2",
                          color: "#b91c1c",
                          fontWeight: 700,
                          fontSize: ".72em",
                          cursor: busy ? "not-allowed" : "pointer",
                          fontFamily: "inherit",
                        }}
                      >
                        🔒 Bloquear
                      </button>
                      <button
                        type="button"
                        disabled={busy}
                        onClick={() => resetTrial(uid)}
                        style={{
                          padding: "6px 10px",
                          borderRadius: 8,
                          border: "1px solid #e2e8f0",
                          background: busy ? "#e2e8f0" : "#fff",
                          color: "#475569",
                          fontWeight: 700,
                          fontSize: ".72em",
                          cursor: busy ? "not-allowed" : "pointer",
                          fontFamily: "inherit",
                        }}
                      >
                        🔄 Resetear trial
                      </button>
                    </td>
                  </tr>
                );
              })}
            </tbody>
          </table>
        </div>
      )}
    </div>
  );
}
