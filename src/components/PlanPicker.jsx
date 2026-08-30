import React, { useState, useCallback } from "react";
import { createPortal } from "react-dom";
import { supabase } from "../lib/supabase";
import { formatCopInt } from "./shared/appShared";
import { COACH_LIST_COP, applyPromoPercent } from "../lib/planPrices";

/**
 * UI del picker. Los COP salen de src/lib/planPrices.js (misma fuente que
 * /api/wompi-create-checkout). No volver a hardcodear montos aquí.
 */
const COACH_PLAN_PICKER_DEFS = {
  basico: {
    key: "basico",
    dbPlan: "Basico",
    title: "Básico",
    bullets: ["Hasta 15 atletas", "100 generaciones IA/mes"],
    prices: {
      monthly: COACH_LIST_COP.basico.mensual,
      semestral: COACH_LIST_COP.basico.semestral,
      anual: COACH_LIST_COP.basico.anual,
    },
  },
  pro: {
    key: "pro",
    dbPlan: "Pro",
    title: "Pro",
    bullets: ["Atletas ilimitados", "Generaciones IA ilimitadas", "Acceso prioritario"],
    prices: {
      monthly: COACH_LIST_COP.pro.mensual,
      semestral: COACH_LIST_COP.pro.semestral,
      anual: COACH_LIST_COP.pro.anual,
    },
  },
};

const COACH_PLAN_PICKER_PERIODS = [
  { id: "monthly", label: "Mensual", discountPct: 0, badge: null },
  { id: "semestral", label: "Semestral", discountPct: 12, badge: "Ahorra 12%" },
  { id: "anual", label: "Anual", discountPct: 20, badge: "Ahorra 20%" },
];

/**
 * Picker canónico de suscripción coach (promo + Wompi checkout).
 * App controla apertura (voluntary / blocked); este módulo posee el estado de form/pago.
 *
 * @param {{
 *   open: boolean,
 *   locked: boolean,
 *   onClose: () => void,
 *   notify: (msg: string) => void,
 * }} props
 */
export default function PlanPicker({ open, locked = false, onClose, notify }) {
  const [coachPickerPlan, setCoachPickerPlan] = useState(null);
  const [coachPickerPeriod, setCoachPickerPeriod] = useState(null);
  const [coachSubscriptionSaving, setCoachSubscriptionSaving] = useState(false);
  /** Promo del picker canónico (antes vivía en la vista Plans legacy). */
  const [coachPromoInput, setCoachPromoInput] = useState("");
  const [coachAppliedPromo, setCoachAppliedPromo] = useState(null);
  const [coachPromoError, setCoachPromoError] = useState("");
  const [coachPromoLoading, setCoachPromoLoading] = useState(false);

  const clearCoachPromo = useCallback(() => {
    setCoachAppliedPromo(null);
    setCoachPromoInput("");
    setCoachPromoError("");
  }, []);

  const closeCoachPlanPicker = useCallback(() => {
    clearCoachPromo();
    onClose?.();
  }, [clearCoachPromo, onClose]);

  const applyCoachPromo = useCallback(async () => {
    const code = coachPromoInput.trim();
    setCoachPromoError("");
    if (!code) {
      setCoachPromoError("Escribe un código");
      return;
    }
    setCoachPromoLoading(true);
    const { data, error } = await supabase.rpc("validate_promo_code", { code_input: code });
    setCoachPromoLoading(false);
    if (error) {
      console.error(error);
      setCoachPromoError(error.message || "No se pudo validar el código");
      setCoachAppliedPromo(null);
      return;
    }
    const row = Array.isArray(data) ? data[0] : data;
    if (!row || row.discount_percent == null) {
      setCoachPromoError("Código no válido o sin usos disponibles");
      setCoachAppliedPromo(null);
      return;
    }
    setCoachAppliedPromo({
      code: code.toUpperCase().replace(/\s+/g, ""),
      discount_percent: Number(row.discount_percent),
    });
    notify(`Código aplicado: ${row.discount_percent}% de descuento`);
  }, [coachPromoInput, notify]);

  const handleCoachPlanPagarAhora = useCallback(async () => {
    if (!coachPickerPlan || !coachPickerPeriod) {
      notify("Elige un plan y un período de pago.");
      return;
    }
    const def = COACH_PLAN_PICKER_DEFS[coachPickerPlan];
    const amountCopBase = def?.prices?.[coachPickerPeriod];
    if (!def || amountCopBase == null) {
      notify("Plan o período no válido.");
      return;
    }
    const amountCop = coachAppliedPromo?.discount_percent != null
      ? applyPromoPercent(amountCopBase, coachAppliedPromo.discount_percent)
      : amountCopBase;
    if (amountCop == null) {
      notify("No se pudo calcular el monto.");
      return;
    }
    setCoachSubscriptionSaving(true);
    try {
      const periodDb = coachPickerPeriod === "monthly" ? "mensual" : coachPickerPeriod;
      const { data: sessData } = await supabase.auth.getSession();
      const accessToken = sessData?.session?.access_token;
      if (!accessToken) {
        notify("Tu sesión expiró. Vuelve a iniciar sesión.");
        return;
      }
      const response = await fetch("/api/wompi-create-checkout", {
        method: "POST",
        headers: {
          "Content-Type": "application/json",
          Authorization: `Bearer ${accessToken}`,
        },
        body: JSON.stringify({
          payer_type: "coach_subscription",
          plan_key: coachPickerPlan,
          plan_period: periodDb,
          amount_cop: amountCop,
          ...(coachAppliedPromo?.code ? { promo_code: coachAppliedPromo.code } : {}),
        }),
      });
      const data = await response.json();
      if (!response.ok) {
        console.error("create-checkout error:", data);
        notify(data?.error || "No se pudo iniciar el pago.");
        return;
      }
      const params = new URLSearchParams({
        "public-key": data.public_key,
        currency: data.currency,
        "amount-in-cents": String(data.amount_in_cents),
        reference: data.reference,
        "signature:integrity": data.signature,
        "redirect-url": data.redirect_url,
      });
      if (data.customer_email) params.set("customer-data:email", data.customer_email);
      const checkoutUrl = `https://checkout.wompi.co/p/?${params.toString()}`;
      window.location.href = checkoutUrl;
    } catch (e) {
      console.error("handleCoachPlanPagarAhora exception:", e);
      notify("Error al iniciar el pago.");
    } finally {
      setCoachSubscriptionSaving(false);
    }
  }, [coachPickerPlan, coachPickerPeriod, coachAppliedPromo, notify]);

  if (!open) return null;
  if (typeof document === "undefined") return null;

  // Portal a body: same z-index 4000 as before; ensures Cerrar is clickable above chrome.
  return createPortal(
    <div
      style={{
        position: "fixed",
        inset: 0,
        zIndex: 4000,
        background: "linear-gradient(165deg, #f8fafc 0%, #e2e8f0 45%, #f1f5f9 100%)",
        overflowY: "auto",
        WebkitOverflowScrolling: "touch",
        boxSizing: "border-box",
      }}
    >
      <div style={{ maxWidth: 1040, margin: "0 auto", padding: "28px 18px 48px", position: "relative" }}>
        {!locked ? (
          <button
            type="button"
            onClick={closeCoachPlanPicker}
            style={{
              position: "absolute",
              top: 18,
              right: 12,
              padding: "8px 12px",
              borderRadius: 8,
              border: "1px solid #e2e8f0",
              background: "#fff",
              color: "#64748b",
              fontWeight: 700,
              fontSize: ".78em",
              cursor: "pointer",
              fontFamily: "inherit",
            }}
          >
            Cerrar
          </button>
        ) : null}
        <h1
          style={{
            fontSize: "clamp(1.35rem, 3.5vw, 1.85rem)",
            fontWeight: 900,
            color: "#0f172a",
            textAlign: "center",
            margin: "8px 0 10px",
            lineHeight: 1.2,
          }}
        >
          Elige tu plan RunningApexFlow
        </h1>
        <p style={{ textAlign: "center", color: "#64748b", fontSize: ".95em", maxWidth: 560, margin: "0 auto 20px", lineHeight: 1.45 }}>
          Comienza a transformar el rendimiento de tus atletas
        </p>

        <div
          style={{
            background: "#fff",
            borderRadius: 14,
            border: "1px solid #e2e8f0",
            padding: "16px 18px",
            marginBottom: 22,
            boxShadow: "0 4px 16px rgba(15,23,42,.04)",
          }}
        >
          <div style={{ fontSize: ".72em", letterSpacing: ".12em", color: "#64748b", fontWeight: 700, marginBottom: 10 }}>
            CÓDIGO PROMOCIONAL
          </div>
          <div style={{ display: "flex", flexWrap: "wrap", gap: 10, alignItems: "center" }}>
            <input
              value={coachPromoInput}
              onChange={(e) => setCoachPromoInput(e.target.value)}
              placeholder="Ingresa tu código"
              disabled={!!coachAppliedPromo}
              style={{
                flex: "1 1 200px",
                minWidth: 160,
                padding: "10px 12px",
                borderRadius: 8,
                border: "1px solid #e2e8f0",
                background: coachAppliedPromo ? "#f1f5f9" : "#fff",
                color: "#0f172a",
                fontFamily: "inherit",
                fontSize: ".88em",
              }}
            />
            {coachAppliedPromo ? (
              <button
                type="button"
                onClick={clearCoachPromo}
                style={{
                  padding: "10px 16px",
                  borderRadius: 8,
                  border: "1px solid #e2e8f0",
                  background: "#fff",
                  color: "#64748b",
                  fontWeight: 700,
                  cursor: "pointer",
                  fontFamily: "inherit",
                }}
              >
                Quitar
              </button>
            ) : (
              <button
                type="button"
                onClick={applyCoachPromo}
                disabled={coachPromoLoading}
                style={{
                  padding: "10px 18px",
                  borderRadius: 8,
                  border: "none",
                  background: coachPromoLoading ? "#e2e8f0" : "linear-gradient(135deg,#2563eb,#3b82f6)",
                  color: coachPromoLoading ? "#64748b" : "#fff",
                  fontWeight: 800,
                  cursor: coachPromoLoading ? "not-allowed" : "pointer",
                  fontFamily: "inherit",
                }}
              >
                {coachPromoLoading ? "…" : "Aplicar"}
              </button>
            )}
          </div>
          {coachPromoError ? <div style={{ color: "#dc2626", fontSize: ".8em", marginTop: 8 }}>{coachPromoError}</div> : null}
          {coachAppliedPromo ? (
            <div style={{ color: "#15803d", fontSize: ".82em", marginTop: 8, fontWeight: 600 }}>
              Descuento del {coachAppliedPromo.discount_percent}% aplicado a los precios mostrados.
            </div>
          ) : null}
        </div>

        <div
          style={{
            display: "grid",
            gridTemplateColumns: "repeat(auto-fit, minmax(280px, 1fr))",
            gap: 20,
            alignItems: "stretch",
          }}
        >
          {["basico", "pro"].map((planKey) => {
            const def = COACH_PLAN_PICKER_DEFS[planKey];
            const selectedPlan = coachPickerPlan === planKey;
            const discountPct = coachAppliedPromo?.discount_percent ?? 0;
            return (
              <div
                key={planKey}
                style={{
                  background: "#fff",
                  borderRadius: 16,
                  padding: "22px 18px 20px",
                  border: selectedPlan ? "2px solid #ff8a3d" : "1px solid #e2e8f0",
                  boxShadow: selectedPlan ? "0 12px 40px rgba(255,138,61,.12)" : "0 4px 20px rgba(15,23,42,.06)",
                  display: "flex",
                  flexDirection: "column",
                  gap: 14,
                }}
              >
                <div style={{ fontSize: "1.25em", fontWeight: 900, color: "#0f172a" }}>{def.title}</div>
                <ul style={{ margin: 0, paddingLeft: 18, color: "#475569", fontSize: ".86em", lineHeight: 1.55 }}>
                  {def.bullets.map((b) => (
                    <li key={b}>{b}</li>
                  ))}
                </ul>
                <div style={{ display: "flex", flexDirection: "column", gap: 10, marginTop: 4 }}>
                  {COACH_PLAN_PICKER_PERIODS.map((per) => {
                    const amount = def.prices[per.id];
                    const amountAfter = applyPromoPercent(amount, discountPct) ?? amount;
                    const selected = selectedPlan && coachPickerPeriod === per.id;
                    const priceLine =
                      per.id === "monthly"
                        ? `$${formatCopInt(amountAfter)} COP/mes`
                        : `$${formatCopInt(amountAfter)} COP`;
                    return (
                      <button
                        key={per.id}
                        type="button"
                        onClick={() => {
                          setCoachPickerPlan(planKey);
                          setCoachPickerPeriod(per.id);
                        }}
                        style={{
                          textAlign: "left",
                          padding: "12px 14px",
                          borderRadius: 12,
                          border: selected ? "2px solid #ea580c" : "1px solid #e2e8f0",
                          background: selected ? "rgba(251,146,60,.08)" : "#f8fafc",
                          cursor: "pointer",
                          fontFamily: "inherit",
                          display: "flex",
                          flexWrap: "wrap",
                          alignItems: "center",
                          justifyContent: "space-between",
                          gap: 8,
                        }}
                      >
                        <div>
                          <div style={{ fontWeight: 800, color: "#0f172a", fontSize: ".88em" }}>{per.label}</div>
                          <div style={{ fontSize: ".82em", color: "#64748b", marginTop: 4 }}>
                            {discountPct > 0 ? (
                              <>
                                <span style={{ textDecoration: "line-through", color: "#94a3b8", marginRight: 6 }}>
                                  ${formatCopInt(amount)}
                                </span>
                                <span style={{ color: "#15803d", fontWeight: 800 }}>{priceLine}</span>
                              </>
                            ) : (
                              priceLine
                            )}
                          </div>
                        </div>
                        {per.badge ? (
                          <span
                            style={{
                              fontSize: ".68em",
                              fontWeight: 800,
                              color: "#15803d",
                              background: "rgba(34,197,94,.14)",
                              border: "1px solid rgba(34,197,94,.35)",
                              borderRadius: 999,
                              padding: "4px 10px",
                              whiteSpace: "nowrap",
                            }}
                          >
                            {per.badge}
                          </span>
                        ) : null}
                      </button>
                    );
                  })}
                </div>
              </div>
            );
          })}
        </div>

        <div style={{ marginTop: 28, display: "flex", flexDirection: "column", alignItems: "center", gap: 12 }}>
          <button
            type="button"
            disabled={!coachPickerPlan || !coachPickerPeriod || coachSubscriptionSaving}
            onClick={handleCoachPlanPagarAhora}
            style={{
              padding: "14px 28px",
              borderRadius: 12,
              border: "none",
              background:
                !coachPickerPlan || !coachPickerPeriod || coachSubscriptionSaving ? "#e2e8f0" : "linear-gradient(135deg,#e86f28,#ff8a3d)",
              color: !coachPickerPlan || !coachPickerPeriod || coachSubscriptionSaving ? "#94a3b8" : "#fff",
              fontWeight: 900,
              fontSize: ".95em",
              cursor: !coachPickerPlan || !coachPickerPeriod || coachSubscriptionSaving ? "not-allowed" : "pointer",
              fontFamily: "inherit",
              boxShadow: "0 6px 20px rgba(255,138,61,.25)",
            }}
          >
            {coachSubscriptionSaving ? "Guardando…" : "Pagar ahora"}
          </button>
          {locked ? (
            <p style={{ fontSize: ".78em", color: "#64748b", textAlign: "center", maxWidth: 420 }}>
              Tu cuenta está bloqueada hasta que se verifique el pago. Si necesitas ayuda, contacta al administrador.
            </p>
          ) : null}
        </div>
      </div>
    </div>,
    document.body,
  );
}
