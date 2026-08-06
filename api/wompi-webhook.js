import crypto from "crypto";
import { createClient } from "@supabase/supabase-js";

/**
 * Webhook de Wompi: recibe eventos de transacción y actualiza el plan del usuario.
 * 
 * Wompi envía un POST con firma HMAC-SHA256 en el campo signature.checksum.
 * Validamos la firma con WOMPI_EVENTS_SECRET para asegurar que el evento es legítimo.
 * 
 * Solo procesamos eventos de tipo 'transaction.updated' con estado APPROVED, DECLINED, VOIDED o ERROR.
 */

export const config = {
  api: {
    bodyParser: false,
  },
};

async function readRawBody(req) {
  return new Promise((resolve, reject) => {
    const chunks = [];
    req.on("data", (c) => chunks.push(c));
    req.on("end", () => resolve(Buffer.concat(chunks).toString("utf8")));
    req.on("error", reject);
  });
}

function verifyWompiSignature(rawBody, payload, secret) {
  const sig = payload?.signature;
  if (!sig?.checksum || !Array.isArray(sig.properties)) return false;

  const concatenated = sig.properties
    .map((prop) => {
      const path = String(prop).split(".");
      let v = payload?.data;
      for (const key of path) {
        if (v == null) return "";
        v = v[key];
      }
      return v == null ? "" : String(v);
    })
    .join("") + String(payload.timestamp) + secret;

  const expected = crypto
    .createHash("sha256")
    .update(concatenated)
    .digest("hex");

  return expected === String(sig.checksum).toLowerCase();
}

function addCalendarMonths(fromDate, months) {
  const d = new Date(fromDate.getTime());
  const day = d.getDate();
  d.setMonth(d.getMonth() + months);
  if (d.getDate() < day) d.setDate(0);
  return d;
}

function monthsForPeriod(period) {
  const p = String(period || "").toLowerCase();
  if (p === "mensual" || p === "monthly") return 1;
  if (p === "semestral") return 6;
  if (p === "anual" || p === "annual" || p === "yearly") return 12;
  return 1;
}

export default async function handler(req, res) {
  if (req.method !== "POST") {
    return res.status(405).json({ error: "Method not allowed" });
  }

  const supabaseUrl = process.env.VITE_SUPABASE_URL || process.env.SUPABASE_URL;
  const serviceKey = process.env.SUPABASE_SERVICE_ROLE_KEY;
  const eventsSecret = process.env.WOMPI_EVENTS_SECRET;

  if (!supabaseUrl || !serviceKey || !eventsSecret) {
    console.error("[wompi-webhook] Missing env vars");
    return res.status(500).json({ error: "Missing server configuration" });
  }

  const supabase = createClient(supabaseUrl, serviceKey);

  let rawBody;
  let payload;
  try {
    rawBody = await readRawBody(req);
    payload = JSON.parse(rawBody);
  } catch (e) {
    console.error("[wompi-webhook] Invalid body:", e);
    return res.status(400).json({ error: "Invalid JSON" });
  }

  if (!verifyWompiSignature(rawBody, payload, eventsSecret)) {
    console.warn("[wompi-webhook] Invalid signature");
    return res.status(401).json({ error: "Invalid signature" });
  }

  if (payload.event !== "transaction.updated") {
    return res.status(200).json({ ok: true, ignored: payload.event });
  }

  const tx = payload.data?.transaction;
  if (!tx?.reference) {
    return res.status(400).json({ error: "Missing transaction reference" });
  }

  const reference = String(tx.reference);
  const wompiStatus = String(tx.status || "PENDING").toUpperCase();
  const wompiTxId = tx.id ? String(tx.id) : null;
  const paymentMethod = tx.payment_method_type ? String(tx.payment_method_type) : null;
  const statusMessage = tx.status_message ? String(tx.status_message) : null;

  const { data: paymentRow, error: lookupErr } = await supabase
    .from("subscription_payments")
    .select("*")
    .eq("wompi_reference", reference)
    .maybeSingle();

  if (lookupErr) {
    console.error("[wompi-webhook] Lookup error:", lookupErr);
    return res.status(500).json({ error: "DB lookup failed" });
  }

  if (!paymentRow) {
    console.warn("[wompi-webhook] No matching payment row for reference:", reference);
    return res.status(200).json({ ok: true, message: "Reference not found, ignoring" });
  }

  const updatePayload = {
    wompi_status: wompiStatus,
    wompi_transaction_id: wompiTxId,
    wompi_payment_method: paymentMethod,
    wompi_status_message: statusMessage,
    raw_event: payload,
    updated_at: new Date().toISOString(),
  };
  if (wompiStatus === "APPROVED") {
    updatePayload.confirmed_at = new Date().toISOString();
  }

  const { error: updErr } = await supabase
    .from("subscription_payments")
    .update(updatePayload)
    .eq("id", paymentRow.id);

  if (updErr) {
    console.error("[wompi-webhook] Update payment error:", updErr);
    return res.status(500).json({ error: "DB update failed" });
  }

  if (wompiStatus !== "APPROVED") {
    // Cerrar la compra del marketplace: si no la marcamos, la fila se queda
    // en 'initiated' para siempre y el admin la ve como pendiente de cobrar.
    if (paymentRow.payer_type === "marketplace_purchase" && paymentRow.marketplace_purchase_id) {
      const { error: declineErr } = await supabase
        .from("plan_purchases")
        .update({ payment_status: "declined" })
        .eq("id", paymentRow.marketplace_purchase_id)
        .neq("payment_status", "confirmed");

      if (declineErr) {
        console.error("[wompi-webhook] Marketplace decline update error:", declineErr);
      }
    }
    return res.status(200).json({ ok: true, status: wompiStatus });
  }

  if (paymentRow.wompi_status === "APPROVED") {
    return res.status(200).json({ ok: true, message: "Already processed" });
  }

  try {
    if (paymentRow.payer_type === "coach_subscription") {
      const months = monthsForPeriod(paymentRow.plan_period);
      const expiresAt = addCalendarMonths(new Date(), months);
      const planDb = paymentRow.plan_key === "pro" ? "Pro" : "Basico";
      
      const { error: profErr } = await supabase
        .from("profiles")
        .update({
          subscription_plan: planDb,
          subscription_period: paymentRow.plan_period,
          subscription_amount: paymentRow.amount_cop,
          subscription_expires_at: expiresAt.toISOString(),
          plan_status: "active",
          plan_validated_at: new Date().toISOString(),
        })
        .eq("user_id", paymentRow.payer_user_id);

      if (profErr) {
        console.error("[wompi-webhook] Coach profile update error:", profErr);
        return res.status(500).json({ error: "Coach activation failed" });
      }
   } else if (paymentRow.payer_type === "athlete_solo_subscription") {
      const months = monthsForPeriod(paymentRow.plan_period);
      const expiresAt = addCalendarMonths(new Date(), months);

      const { error: profErr } = await supabase
        .from("profiles")
        .update({
          athlete_plan: "premium",
          athlete_plan_expires_at: expiresAt.toISOString(),
          subscription_expires_at: expiresAt.toISOString(),
          subscription_period: paymentRow.plan_period,
          subscription_amount: paymentRow.amount_cop,
        })
        .eq("user_id", paymentRow.payer_user_id);

      if (profErr) {
        console.error("[wompi-webhook] Athlete profile update error:", profErr);
        return res.status(500).json({ error: "Athlete activation failed" });
      }
    } else if (paymentRow.payer_type === "marketplace_purchase") {
      if (paymentRow.marketplace_purchase_id) {
        const { error: mpErr } = await supabase
          .from("plan_purchases")
          .update({
            payment_status: "confirmed",
            confirmed_at: new Date().toISOString(),
            confirmed_source: "wompi_webhook",
          })
          .eq("id", paymentRow.marketplace_purchase_id);

        if (mpErr) {
          console.error("[wompi-webhook] Marketplace purchase update error:", mpErr);
          return res.status(500).json({ error: "Marketplace activation failed" });
        }
      }
    }

    return res.status(200).json({ ok: true, activated: paymentRow.payer_type });
  } catch (e) {
    console.error("[wompi-webhook] Activation exception:", e);
    return res.status(500).json({ error: "Activation exception" });
  }
}
