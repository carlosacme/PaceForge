import React, { useMemo } from "react";
import { ATHLETE_SOLO_COP } from "../../lib/planPrices";
import { useAthleteSoloPayments } from "./useAthleteSoloPayments";

const SOLO_PLAN_MONTHLY_COP = ATHLETE_SOLO_COP.monthly;
const SOLO_PLAN_ANNUAL_COP = ATHLETE_SOLO_COP.annual;

function normalizeSoloAthletePlanKey(athletePlan, subscriptionPeriod) {
  const planRaw = String(athletePlan ?? "").trim().toLowerCase();
  if (planRaw !== "premium") return "free";
  const periodRaw = String(subscriptionPeriod ?? "").trim().toLowerCase();
  if (periodRaw === "annual" || periodRaw === "anual" || periodRaw === "yearly") return "annual";
  return "monthly";
}

/**
 * Perfil -> Pagos del atleta: plan/Wompi (si no hay coach) + lista read-only
 * de pagos que registró el coach. Independiente de Athletes/useAthletePayments.
 */
export default function AthletePaymentsView({
  cardStyle,
  athleteId,
  athletePlan,
  subscriptionPeriod,
  subscriptionExpiresAt,
  profileUserId,
  profileCoachId,
  notify,
}) {
  const { payments, loading, startCheckout } = useAthleteSoloPayments({ athleteId, notify });

  const hasCoachPremiumIncluded = useMemo(() => {
    const uid = profileUserId;
    const cid = profileCoachId;
    if (cid == null) return false;
    const c = String(cid).trim();
    if (c === "") return false;
    if (uid != null && c === String(uid).trim()) return false;
    return true;
  }, [profileCoachId, profileUserId]);

  const soloAthletePlanKey = useMemo(
    () => normalizeSoloAthletePlanKey(athletePlan, subscriptionPeriod),
    [athletePlan, subscriptionPeriod],
  );

  const subscriptionExpiresFormatted = useMemo(() => {
    const raw = subscriptionExpiresAt;
    if (!raw) return null;
    const d = new Date(raw);
    if (Number.isNaN(d.getTime())) return null;
    return d.toLocaleDateString("es-CO", { day: "numeric", month: "long", year: "numeric" });
  }, [subscriptionExpiresAt]);

  return (
    <>
      {hasCoachPremiumIncluded ? (
        <div style={{ ...cardStyle, marginBottom: 14 }}>
          <div style={{ fontSize: ".72em", marginBottom: 12, color: "#475569", textTransform: "uppercase", letterSpacing: ".13em" }}>Tu acceso</div>
          <div style={{ display: "inline-flex", alignItems: "center", gap: 8, background: "rgba(34,197,94,.14)", border: "1px solid rgba(34,197,94,.45)", color: "#166534", borderRadius: 10, padding: "12px 16px", fontWeight: 800, fontSize: ".9em", lineHeight: 1.35 }}>✅ Plan Premium — Incluido con tu coach</div>
          <p style={{ margin: "14px 0 0", color: "#64748b", fontSize: ".84em", lineHeight: 1.5 }}>No necesitas contratar un plan por separado: tu suscripción va ligada al coach que te entrena.</p>
        </div>
      ) : (
        <div style={{ ...cardStyle, marginBottom: 14 }}>
          <div style={{ fontSize: ".72em", marginBottom: 10, color: "#475569", textTransform: "uppercase", letterSpacing: ".13em" }}>Tu plan</div>
          <div style={{ fontWeight: 800, fontSize: ".95em", color: "#0f172a", marginBottom: 4 }}>Plan actual: {soloAthletePlanKey === "monthly" ? "Mensual" : soloAthletePlanKey === "annual" ? "Anual" : "Gratis (free)"}</div>
          <div style={{ color: "#64748b", fontSize: ".82em", marginBottom: 16, lineHeight: 1.45 }}>Atleta independiente — gestiona tu suscripción aquí.</div>
          {soloAthletePlanKey === "free" ? (
            <div style={{ display: "flex", flexDirection: "column", gap: 12 }}>
              <div style={{ border: "1px solid #e2e8f0", borderRadius: 12, padding: "14px 16px", display: "flex", flexWrap: "wrap", alignItems: "center", justifyContent: "space-between", gap: 12, background: "#fafafa" }}>
                <div><div style={{ fontWeight: 800, color: "#0f172a" }}>Mensual</div><div style={{ fontSize: ".92em", color: "#b45309", fontWeight: 800, marginTop: 6 }}>${Number(SOLO_PLAN_MONTHLY_COP).toLocaleString("es-CO")} COP/mes</div></div>
                <button type="button" onClick={() => startCheckout("monthly")} style={{ padding: "10px 18px", borderRadius: 10, border: "none", background: "linear-gradient(135deg,#0d9488,#14b8a6)", color: "#fff", fontWeight: 800, fontSize: ".84em", cursor: "pointer", fontFamily: "inherit" }}>Suscribirse</button>
              </div>
              <div style={{ border: "1px solid #e2e8f0", borderRadius: 12, padding: "14px 16px", display: "flex", flexWrap: "wrap", alignItems: "center", justifyContent: "space-between", gap: 12, background: "#fafafa" }}>
                <div><div style={{ fontWeight: 800, color: "#0f172a" }}>Anual <span style={{ fontSize: ".72em", fontWeight: 800, color: "#15803d", background: "rgba(34,197,94,.18)", border: "1px solid rgba(34,197,94,.4)", borderRadius: 8, padding: "4px 10px" }}>Ahorra $50.000</span></div><div style={{ fontSize: ".92em", color: "#b45309", fontWeight: 800, marginTop: 6 }}>${Number(SOLO_PLAN_ANNUAL_COP).toLocaleString("es-CO")} COP/año</div></div>
                <button type="button" onClick={() => startCheckout("annual")} style={{ padding: "10px 18px", borderRadius: 10, border: "none", background: "linear-gradient(135deg,#0d9488,#14b8a6)", color: "#fff", fontWeight: 800, fontSize: ".84em", cursor: "pointer", fontFamily: "inherit" }}>Suscribirse</button>
              </div>
            </div>
          ) : (
            <div style={{ border: "1px solid #e2e8f0", borderRadius: 12, padding: "14px 16px", background: "#f8fafc" }}>
              <div style={{ fontWeight: 800, color: "#0f172a", marginBottom: 8 }}>Plan activo: {soloAthletePlanKey === "monthly" ? "Mensual" : "Anual"}</div>
              <div style={{ color: "#64748b", fontSize: ".86em", marginBottom: 14 }}>Fecha de vencimiento: <strong style={{ color: "#0f172a" }}>{subscriptionExpiresFormatted || "Sin fecha registrada"}</strong></div>
              <button type="button" onClick={() => startCheckout(soloAthletePlanKey)} style={{ padding: "10px 18px", borderRadius: 10, border: "none", background: "linear-gradient(135deg,#e86f28,#ff8a3d)", color: "#fff", fontWeight: 800, fontSize: ".84em", cursor: "pointer", fontFamily: "inherit" }}>Renovar</button>
            </div>
          )}
        </div>
      )}
      <div style={{ ...cardStyle }}>
        <div style={{ fontSize: ".72em", marginBottom: 10, color: "#475569", textTransform: "uppercase", letterSpacing: ".13em" }}>Mis Pagos</div>
        {loading ? <div style={{ color: "#64748b", fontSize: ".84em" }}>Cargando pagos…</div> : payments.length === 0 ? <div style={{ color: "#64748b", fontSize: ".84em" }}>Tu coach aún no ha registrado pagos.</div> : (
          <div style={{ display: "flex", flexDirection: "column", gap: 8 }}>
            {payments.map((p) => (
              <div key={p.id} style={{ border: "1px solid #e2e8f0", borderRadius: 10, padding: "10px 12px", background: "#f8fafc" }}>
                <div style={{ fontWeight: 700, fontSize: ".84em" }}>${Number(p.amount || 0).toLocaleString("es-CO")} {p.currency || "COP"} · {p.plan}</div>
                <div style={{ marginTop: 4, color: "#64748b", fontSize: ".74em" }}>{new Date(p.payment_date).toLocaleDateString("es-CO")} · {p.payment_method}</div>
              </div>
            ))}
          </div>
        )}
      </div>
    </>
  );
}
