import crypto from "crypto";
import { createClient } from "@supabase/supabase-js";

/**
 * Crea una transacción Wompi pendiente y devuelve los datos firmados al frontend.
 * 
 * Flujo:
 * 1. Frontend llama: POST /api/wompi-create-checkout con { payer_type, plan_key, plan_period, amount_cop, marketplace_plan_id? }
 * 2. Validamos sesión del usuario y monto
 * 3. Generamos reference único e insertamos fila PENDING en subscription_payments
 * 4. Calculamos signature de integridad (Wompi exige SHA-256 de reference+amount+currency+integrity_secret)
 * 5. Devolvemos { reference, amount_in_cents, signature, public_key, redirect_url } al frontend
 * 6. Frontend abre checkout.wompi.co con esos datos como query params
 */

export default async function handler(req, res) {
  if (req.method !== "POST") {
    return res.status(405).json({ error: "Method not allowed" });
  }

  const supabaseUrl = process.env.VITE_SUPABASE_URL || process.env.SUPABASE_URL;
  const serviceKey = process.env.SUPABASE_SERVICE_ROLE_KEY;
  const publicKey = process.env.WOMPI_PUBLIC_KEY;
  const integritySecret = process.env.WOMPI_INTEGRITY_SECRET;
  const appUrl = process.env.APP_URL || "https://pace-forge-eta.vercel.app";

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
    marketplace_purchase_id 
  } = req.body || {};

  const VALID_TYPES = ["coach_subscription", "athlete_solo_subscription", "marketplace_purchase"];
  if (!VALID_TYPES.includes(payer_type)) {
    return res.status(400).json({ error: "Invalid payer_type" });
  }

  const amountNum = Math.round(Number(amount_cop));
  if (!Number.isFinite(amountNum) || amountNum < 5000) {
    return res.status(400).json({ error: "Invalid amount (min 5000 COP)" });
  }
  const amountInCents = amountNum * 100;

  const VALID_COACH_PLANS = { basico: ["mensual", "semestral", "anual"], pro: ["mensual", "semestral", "anual"] };
  const VALID_ATHLETE_PLANS = { premium: ["monthly", "annual"] };

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

  const ts = Date.now();
  const reference = `runningapexflow-${payer_type}-${plan_key || "mp"}-${plan_period || "x"}-${userId.slice(0, 8)}-${ts}`;

  const insertPayload = {
    payer_type,
    payer_user_id: userId,
    plan_key: plan_key || null,
    plan_period: plan_period || null,
    marketplace_plan_id: marketplace_plan_id || null,
    marketplace_purchase_id: marketplace_purchase_id || null,
    amount_cop: amountNum,
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
