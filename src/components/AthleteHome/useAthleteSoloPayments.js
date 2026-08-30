import { useState, useEffect, useCallback } from "react";
import { supabase } from "../../lib/supabase";
import { ATHLETE_SOLO_COP } from "../../lib/planPrices";

const SOLO_PLAN_MONTHLY_COP = ATHLETE_SOLO_COP.monthly;
const SOLO_PLAN_ANNUAL_COP = ATHLETE_SOLO_COP.annual;

/**
 * Pagos del atleta: lista read-only de `athlete_payments` + checkout Wompi
 * (premium independiente). NO es el CRUD del coach (`Athletes/useAthletePayments`).
 * No toca PAYMENT_PLAN_AMOUNT_COP.
 */
export function useAthleteSoloPayments({ athleteId, notify }) {
  const [payments, setPayments] = useState([]);
  const [loading, setLoading] = useState(false);

  const loadPayments = useCallback(async () => {
    if (!athleteId) {
      setPayments([]);
      return;
    }
    setLoading(true);
    const { data, error } = await supabase
      .from("athlete_payments")
      .select("*")
      .eq("athlete_id", athleteId)
      .order("payment_date", { ascending: false })
      .order("created_at", { ascending: false });
    setLoading(false);
    if (error) {
      console.error("Error cargando pagos del atleta:", error);
      setPayments([]);
      return;
    }
    setPayments(data || []);
  }, [athleteId]);

  useEffect(() => {
    loadPayments();
  }, [loadPayments]);

  const startCheckout = async (period) => {
    const amountCop = period === "annual" ? SOLO_PLAN_ANNUAL_COP : SOLO_PLAN_MONTHLY_COP;
    try {
      const { data: sessData } = await supabase.auth.getSession();
      const accessToken = sessData?.session?.access_token;
      if (!accessToken) {
        notify?.("Tu sesión expiró. Vuelve a iniciar sesión.");
        return;
      }
      const response = await fetch("/api/wompi-create-checkout", {
        method: "POST",
        headers: { "Content-Type": "application/json", Authorization: `Bearer ${accessToken}` },
        body: JSON.stringify({
          payer_type: "athlete_solo_subscription",
          plan_key: "premium",
          plan_period: period === "annual" ? "annual" : "monthly",
          amount_cop: amountCop,
        }),
      });
      const data = await response.json();
      if (!response.ok) {
        console.error("create-checkout error:", data);
        notify?.(data?.error || "No se pudo iniciar el pago.");
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
      window.location.href = `https://checkout.wompi.co/p/?${params.toString()}`;
    } catch (e) {
      console.error("trySoloIndependentCheckout exception:", e);
      notify?.("Error al iniciar el pago.");
    }
  };

  return { payments, loading, startCheckout };
}
