import crypto from "crypto";
import { createClient } from "@supabase/supabase-js";
import {
  MIN_CHECKOUT_COP,
  resolveListAmountCop,
  applyPromoPercent,
} from "../src/lib/planPrices.js";

/**
 * Crea una transacción Wompi pendiente y devuelve los datos firmados al frontend.
 *
 * El monto que se firma NUNCA sale del amount_cop del cliente. Se deriva del
 * catálogo (coach/atleta) o de plan_marketplace.price_cop (marketplace),
 * más un promo revalidado en servidor si aplica.
 */

const VALID_TYPES = ["coach_subscription", "athlete_solo_subscription", "marketplace_purchase"];
const VALID_COACH_PLANS = { basico: ["mensual", "semestral", "anual"], pro: ["mensual", "semestral", "anual"] };
const VALID_ATHLETE_PLANS = { premium: ["monthly", "annual"] };

function promoRow(data) {
  const row = Array.isArray(data) ? data[0] : data;
  if (!row || row.discount_percent == null) return null;
  const pct = Number(row.discount_percent);
  if (!Number.isFinite(pct) || pct < 0 || pct > 100) return null;
  return { discount_percent: pct };
}

export default async function handler(req, res) {
  if (req.method !== "POST") {
    return res.status(405).json({ error: "Method not allowed" });
  }

  const supabaseUrl = process.env.VITE_SUPABASE_URL || process.env.SUPABASE_URL;
  const serviceKey = process.env.SUPABASE_SERVICE_ROLE_KEY;
  const publicKey = process.env.WOMPI_PUBLIC_KEY;
  const integritySecret = process.env.WOMPI_INTEGRITY_SECRET;
  const appUrl = process.env.APP_URL || "https://www.runningapexflow.com";

  if (!supabaseUrl || !serviceKey || !publicKey || !integritySecret) {
    console.error("[wompi-create-checkout] Missing env vars");
    return res.status(500).json({ error: "Missing server configuration" });
  }

  const supabase = createClient(supabaseUrl, serviceKey);

  const authHeader = req.headers.authorization || "";
  const token = authHeader.startsWith("Bearer ") ? authHeader.slice(7) : null;
  if (!token) {
    return res.status(401).json({ error: "Missing Authorization header" });
  }

  const { data: userData, error: userErr } = await supabase.auth.getUser(token);
  if (userErr || !userData?.user?.id) {
    console.error("[wompi-create-checkout] Auth error:", userErr);
    return res.status(401).json({ error: "Invalid session" });
  }

  const userId = userData.user.id;
  const userEmail = userData.user.email || "";

  const {
    payer_type,
    plan_key,
    plan_period,
    amount_cop,
    marketplace_plan_id,
    marketplace_purchase_id,
    promo_code,
  } = req.body || {};

  if (!VALID_TYPES.includes(payer_type)) {
    return res.status(400).json({ error: "Invalid payer_type" });
  }

  if (payer_type === "coach_subscription") {
    if (!VALID_COACH_PLANS[plan_key]?.includes(plan_period)) {
      return res.status(400).json({ error: "Invalid coach plan_key/plan_period combo" });
    }
  } else if (payer_type === "athlete_solo_subscription") {
    if (!VALID_ATHLETE_PLANS[plan_key]?.includes(plan_period)) {
      return res.status(400).json({ error: "Invalid athlete plan_key/plan_period combo" });
    }
  } else if (payer_type === "marketplace_purchase") {
    if (!marketplace_plan_id) {
      return res.status(400).json({ error: "Missing marketplace_plan_id" });
    }
  }

  let listCop = null;

  if (payer_type === "marketplace_purchase") {
    const { data: planRow, error: planErr } = await supabase
      .from("plan_marketplace")
      .select("id, price_cop")
      .eq("id", marketplace_plan_id)
      .maybeSingle();
    if (planErr) {
      console.error("[wompi-create-checkout] marketplace lookup:", planErr);
      return res.status(500).json({ error: "No se pudo leer el precio del plan" });
    }
    if (!planRow) {
      return res.status(400).json({ error: "Plan de marketplace no encontrado" });
    }
    const n = Math.round(Number(planRow.price_cop));
    if (!Number.isFinite(n)) {
      return res.status(400).json({ error: "El plan no tiene un precio válido" });
    }
    listCop = n;
  } else {
    listCop = resolveListAmountCop(payer_type, plan_key, plan_period);
    if (listCop == null) {
      return res.status(400).json({ error: "No hay un precio de catálogo para ese plan y período" });
    }
  }

  let expectedCop = listCop;
  const rawPromo = typeof promo_code === "string" ? promo_code.trim() : "";
  const wantsPromo = rawPromo.length > 0;

  if (wantsPromo && payer_type !== "coach_subscription") {
    return res.status(400).json({ error: "Los códigos promo solo aplican a la suscripción de coach" });
  }

  if (wantsPromo) {
    const { data: promoData, error: promoErr } = await supabase.rpc("validate_promo_code", {
      code_input: rawPromo,
    });
    if (promoErr) {
      console.error("[wompi-create-checkout] validate_promo_code:", promoErr);
      return res.status(400).json({ error: "No se pudo validar el código promo" });
    }
    const promo = promoRow(promoData);
    if (!promo) {
      return res.status(400).json({ error: "Código promo no válido o sin usos disponibles" });
    }
    expectedCop = applyPromoPercent(listCop, promo.discount_percent);
    if (expectedCop == null) {
      return res.status(400).json({ error: "No se pudo aplicar el descuento del código" });
    }
  }

  if (!Number.isFinite(expectedCop) || expectedCop < MIN_CHECKOUT_COP) {
    return res.status(400).json({
      error: `El monto resultante (${expectedCop} COP) es menor al mínimo de ${MIN_CHECKOUT_COP} COP. Un descuento tan alto no se puede cobrar por Wompi.`,
    });
  }

  if (amount_cop != null && String(amount_cop).trim() !== "") {
    const clientAmt = Math.round(Number(amount_cop));
    if (!Number.isFinite(clientAmt) || clientAmt !== expectedCop) {
      return res.status(400).json({
        error: "El monto no coincide con el precio del plan",
        expected_cop: expectedCop,
      });
    }
  }

  const amountInCents = expectedCop * 100;
  const ts = Date.now();
  const reference = `runningapexflow-${payer_type}-${plan_key || "mp"}-${plan_period || "x"}-${userId.slice(0, 8)}-${ts}`;

  const insertPayload = {
    payer_type,
    payer_user_id: userId,
    plan_key: plan_key || null,
    plan_period: plan_period || null,
    marketplace_plan_id: marketplace_plan_id || null,
    marketplace_purchase_id: marketplace_purchase_id || null,
    amount_cop: expectedCop,
    currency: "COP",
    wompi_reference: reference,
    wompi_status: "PENDING",
  };

  const { error: insErr } = await supabase
    .from("subscription_payments")
    .insert(insertPayload);

  if (insErr) {
    console.error("[wompi-create-checkout] Insert error:", insErr);
    return res.status(500).json({ error: insErr.message });
  }

  // Redeem solo cuando el monto ya es válido y la fila PENDING existe.
  // Así no se quema un uso si el combo/monto era inválido.
  if (wantsPromo) {
    const { data: redeemed, error: redeemErr } = await supabase.rpc("redeem_promo_code", {
      code_input: rawPromo,
    });
    if (redeemErr || !redeemed) {
      console.error("[wompi-create-checkout] redeem_promo_code:", redeemErr);
      return res.status(400).json({ error: "El código ya no es válido o no tiene usos" });
    }
  }

  const concatenated = `${reference}${amountInCents}COP${integritySecret}`;
  const signature = crypto.createHash("sha256").update(concatenated).digest("hex");

  return res.status(200).json({
    reference,
    amount_in_cents: amountInCents,
    currency: "COP",
    signature,
    public_key: publicKey,
    redirect_url: appUrl,
    customer_email: userEmail,
  });
}
