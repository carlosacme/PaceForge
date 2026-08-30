import { useState, useEffect, useCallback } from "react";
import { supabase } from "../../lib/supabase";
import {
  defaultPaymentAmountStringForPlan,
  formatLocalYMD,
  sendAppEmail,
} from "../shared/appShared";

/**
 * Pagos manuales atleta→coach (`athlete_payments`).
 * Independiente de Wompi / PlanPicker; el monto por defecto sale de
 * PAYMENT_PLAN_AMOUNT_COP (catálogo de registro manual, no checkout).
 */
export function useAthletePayments({ athleteId, athleteEmail, athleteName, coachId, notify }) {
  const [athletePayments, setAthletePayments] = useState([]);
  const [loadingPayments, setLoadingPayments] = useState(false);
  const [paymentSaving, setPaymentSaving] = useState(false);
  const [paymentActionBusyId, setPaymentActionBusyId] = useState(null);
  const [paymentModalOpen, setPaymentModalOpen] = useState(false);
  const [paymentForm, setPaymentForm] = useState({
    amount: "",
    payment_method: "Nequi",
    plan: "Basico",
    payment_date: formatLocalYMD(new Date()),
    notes: "",
  });

  const loadAthletePayments = useCallback(async () => {
    if (!athleteId) {
      setAthletePayments([]);
      return;
    }
    setLoadingPayments(true);
    const { data, error } = await supabase
      .from("athlete_payments")
      .select("*")
      .eq("athlete_id", athleteId)
      .order("payment_date", { ascending: false })
      .order("created_at", { ascending: false });
    setLoadingPayments(false);
    if (error) {
      console.error("Error cargando pagos:", error);
      setAthletePayments([]);
      return;
    }
    setAthletePayments(data || []);
  }, [athleteId]);

  useEffect(() => {
    loadAthletePayments();
  }, [loadAthletePayments]);

  const openPaymentModal = () => {
    const plan = "Basico";
    setPaymentForm({
      amount: defaultPaymentAmountStringForPlan(plan),
      payment_method: "Nequi",
      plan,
      payment_date: formatLocalYMD(new Date()),
      notes: "",
    });
    setPaymentModalOpen(true);
  };

  const closePaymentModal = () => setPaymentModalOpen(false);

  const registerPayment = async () => {
    if (!athleteId || !coachId) return;
    const amount = Number(String(paymentForm.amount).replace(/[^\d]/g, ""));
    if (!Number.isFinite(amount) || amount <= 0) {
      notify?.("Monto inválido");
      return;
    }
    if (!paymentForm.payment_date) {
      notify?.("Selecciona la fecha de pago");
      return;
    }
    setPaymentSaving(true);
    const payload = {
      athlete_id: athleteId,
      coach_id: coachId,
      amount,
      currency: "COP",
      payment_method: paymentForm.payment_method,
      plan: paymentForm.plan,
      status: "pending",
      notes: paymentForm.notes?.trim() || null,
      payment_date: paymentForm.payment_date,
    };
    const { error } = await supabase.from("athlete_payments").insert(payload);
    setPaymentSaving(false);
    if (error) {
      console.error("Error registrando pago:", error);
      notify?.(error.message || "No se pudo registrar el pago");
      return;
    }
    notify?.("Pago registrado");
    setPaymentModalOpen(false);
    loadAthletePayments();
  };

  const updatePaymentStatus = async (row, status) => {
    if (!row?.id || !athleteId) return;
    setPaymentActionBusyId(row.id);
    const { error } = await supabase
      .from("athlete_payments")
      .update({ status })
      .eq("id", row.id)
      .eq("athlete_id", athleteId);
    setPaymentActionBusyId(null);
    if (error) {
      console.error("Error actualizando pago:", error);
      notify?.(error.message || "No se pudo actualizar el estado del pago");
      return;
    }
    if (status === "confirmed" && athleteEmail) {
      await sendAppEmail({
        template: "payment_confirmed",
        to: athleteEmail,
        vars: {
          athleteName: athleteName || "atleta",
          plan: row.plan,
          amount: row.amount || 0,
          currency: row.currency || "COP",
        },
      });
    }
    notify?.(status === "confirmed" ? "Pago confirmado" : "Pago rechazado");
    loadAthletePayments();
  };

  return {
    athletePayments,
    loadingPayments,
    paymentSaving,
    paymentActionBusyId,
    paymentModalOpen,
    paymentForm,
    setPaymentForm,
    openPaymentModal,
    closePaymentModal,
    registerPayment,
    updatePaymentStatus,
  };
}
