import React from "react";
import {
  PAYMENT_METHOD_OPTIONS,
  PAYMENT_PLAN_OPTIONS,
  defaultPaymentAmountStringForPlan,
  paymentStatusLabel,
  styles,
} from "../shared/appShared";

export function AthletePaymentModal({
  paymentModalOpen,
  paymentForm,
  setPaymentForm,
  paymentSaving,
  closePaymentModal,
  registerPayment,
}) {
  if (!paymentModalOpen) return null;
  const S = styles;

  return (
    <div style={{ position: "fixed", inset: 0, background: "rgba(15,23,42,0.45)", display: "flex", alignItems: "center", justifyContent: "center", zIndex: 210, padding: 16 }}>
      <div style={{ ...S.card, width: "100%", maxWidth: 520, margin: 0 }}>
        <div style={{ fontSize: ".95em", fontWeight: 800, color: "#0f172a", marginBottom: 10 }}>Registrar Pago</div>
        <div style={{ display: "grid", gridTemplateColumns: "repeat(2,minmax(0,1fr))", gap: 10 }}>
          <div>
            <div style={{ fontSize: ".72em", color: "#64748b", marginBottom: 6 }}>Monto</div>
            <input
              type="number"
              min={1}
              value={paymentForm.amount}
              onChange={(e) => setPaymentForm((f) => ({ ...f, amount: e.target.value }))}
              style={{ width: "100%", background: "#fff", border: "1px solid #e2e8f0", borderRadius: 8, padding: "9px 10px", color: "#0f172a", fontFamily: "inherit", fontSize: ".84em", boxSizing: "border-box" }}
            />
          </div>
          <div>
            <div style={{ fontSize: ".72em", color: "#64748b", marginBottom: 6 }}>Fecha del pago</div>
            <input
              type="date"
              value={paymentForm.payment_date}
              onChange={(e) => setPaymentForm((f) => ({ ...f, payment_date: e.target.value }))}
              style={{ width: "100%", background: "#fff", border: "1px solid #e2e8f0", borderRadius: 8, padding: "9px 10px", color: "#0f172a", fontFamily: "inherit", fontSize: ".84em", boxSizing: "border-box" }}
            />
          </div>
          <div>
            <div style={{ fontSize: ".72em", color: "#64748b", marginBottom: 6 }}>Método de pago</div>
            <select
              value={paymentForm.payment_method}
              onChange={(e) => setPaymentForm((f) => ({ ...f, payment_method: e.target.value }))}
              style={{ width: "100%", background: "#fff", border: "1px solid #e2e8f0", borderRadius: 8, padding: "9px 10px", color: "#0f172a", fontFamily: "inherit", fontSize: ".84em", boxSizing: "border-box" }}
            >
              {PAYMENT_METHOD_OPTIONS.map((m) => <option key={m} value={m}>{m}</option>)}
            </select>
          </div>
          <div>
            <div style={{ fontSize: ".72em", color: "#64748b", marginBottom: 6 }}>Plan</div>
            <select
              value={paymentForm.plan}
              onChange={(e) => {
                const plan = e.target.value;
                setPaymentForm((f) => ({
                  ...f,
                  plan,
                  amount: defaultPaymentAmountStringForPlan(plan),
                }));
              }}
              style={{ width: "100%", background: "#fff", border: "1px solid #e2e8f0", borderRadius: 8, padding: "9px 10px", color: "#0f172a", fontFamily: "inherit", fontSize: ".84em", boxSizing: "border-box" }}
            >
              {PAYMENT_PLAN_OPTIONS.map((p) => <option key={p} value={p}>{p}</option>)}
            </select>
          </div>
          <div style={{ gridColumn: "1 / -1" }}>
            <div style={{ fontSize: ".72em", color: "#64748b", marginBottom: 6 }}>Notas</div>
            <textarea
              rows={3}
              value={paymentForm.notes}
              onChange={(e) => setPaymentForm((f) => ({ ...f, notes: e.target.value }))}
              style={{ width: "100%", background: "#fff", border: "1px solid #e2e8f0", borderRadius: 8, padding: "9px 10px", color: "#0f172a", fontFamily: "inherit", fontSize: ".84em", boxSizing: "border-box", resize: "vertical" }}
            />
          </div>
        </div>
        <div style={{ display: "flex", justifyContent: "flex-end", gap: 8, marginTop: 12 }}>
          <button
            type="button"
            onClick={closePaymentModal}
            style={{ background: "#fff", border: "1px solid #e2e8f0", borderRadius: 8, padding: "8px 12px", color: "#64748b", cursor: "pointer", fontFamily: "inherit", fontWeight: 700, fontSize: ".82em" }}
          >
            Cancelar
          </button>
          <button
            type="button"
            onClick={registerPayment}
            disabled={paymentSaving}
            style={{ background: paymentSaving ? "#e2e8f0" : "linear-gradient(135deg,#e86f28,#ff8a3d)", border: "none", borderRadius: 8, padding: "8px 12px", color: paymentSaving ? "#64748b" : "#fff", cursor: paymentSaving ? "not-allowed" : "pointer", fontFamily: "inherit", fontWeight: 800, fontSize: ".82em" }}
          >
            {paymentSaving ? "Guardando…" : "Guardar Pago"}
          </button>
        </div>
      </div>
    </div>
  );
}

export default function AthletePaymentsPanel({
  athletePayments,
  loadingPayments,
  paymentActionBusyId,
  openPaymentModal,
  updatePaymentStatus,
}) {
  return (
    <div style={{ order: 7, marginBottom: 24, paddingBottom: 20, borderBottom: "1px solid #e2e8f0" }}>
        <div style={{ display: "flex", justifyContent: "space-between", alignItems: "center", gap: 10, marginBottom: 10 }}>
          <div style={{ fontSize: ".65em", letterSpacing: ".15em", color: "#334155", textTransform: "uppercase" }}>
            PAGOS
          </div>
          <button
            type="button"
            onClick={openPaymentModal}
            style={{
              background: "linear-gradient(135deg,#e86f28,#ff8a3d)",
              border: "none",
              borderRadius: 8,
              padding: "8px 12px",
              color: "#fff",
              fontWeight: 800,
              fontSize: ".75em",
              cursor: "pointer",
              fontFamily: "inherit",
            }}
          >
            Registrar Pago
          </button>
        </div>
        {loadingPayments ? (
          <div style={{ color: "#64748b", fontSize: ".82em" }}>Cargando pagos…</div>
        ) : athletePayments.length === 0 ? (
          <div style={{ color: "#64748b", fontSize: ".82em" }}>No hay pagos registrados para este atleta.</div>
        ) : (
          <div style={{ display: "flex", flexDirection: "column", gap: 8 }}>
            {athletePayments.map((p) => {
              const pending = p.status === "pending";
              return (
                <div key={p.id} style={{ border: "1px solid #e2e8f0", borderRadius: 10, padding: "10px 12px", background: "#f8fafc" }}>
                  <div style={{ display: "flex", justifyContent: "space-between", alignItems: "center", gap: 8, flexWrap: "wrap" }}>
                    <div style={{ color: "#0f172a", fontSize: ".82em", fontWeight: 700 }}>
                      ${Number(p.amount || 0).toLocaleString("es-CO")} {p.currency || "COP"} · {p.plan}
                    </div>
                    <span
                      style={{
                        padding: "3px 8px",
                        borderRadius: 999,
                        fontSize: ".68em",
                        fontWeight: 700,
                        background: p.status === "confirmed" ? "rgba(34,197,94,.16)" : p.status === "rejected" ? "rgba(239,68,68,.14)" : "rgba(255,138,61,.16)",
                        color: p.status === "confirmed" ? "#15803d" : p.status === "rejected" ? "#b91c1c" : "#b45309",
                      }}
                    >
                      {paymentStatusLabel(p.status)}
                    </span>
                  </div>
                  <div style={{ marginTop: 4, color: "#64748b", fontSize: ".74em" }}>
                    {new Date(p.payment_date).toLocaleDateString("es-CO")} · {p.payment_method}
                  </div>
                  {p.notes ? <div style={{ marginTop: 4, color: "#475569", fontSize: ".74em" }}>Notas: {p.notes}</div> : null}
                  {pending ? (
                    <div style={{ marginTop: 8, display: "flex", gap: 8, flexWrap: "wrap" }}>
                      <button
                        type="button"
                        disabled={paymentActionBusyId === p.id}
                        onClick={() => updatePaymentStatus(p, "confirmed")}
                        style={{ background: "rgba(34,197,94,.16)", border: "1px solid rgba(34,197,94,.35)", borderRadius: 8, padding: "6px 10px", color: "#166534", cursor: "pointer", fontSize: ".72em", fontFamily: "inherit", fontWeight: 700 }}
                      >
                        Confirmar
                      </button>
                      <button
                        type="button"
                        disabled={paymentActionBusyId === p.id}
                        onClick={() => updatePaymentStatus(p, "rejected")}
                        style={{ background: "rgba(239,68,68,.12)", border: "1px solid rgba(239,68,68,.32)", borderRadius: 8, padding: "6px 10px", color: "#b91c1c", cursor: "pointer", fontSize: ".72em", fontFamily: "inherit", fontWeight: 700 }}
                      >
                        Rechazar
                      </button>
                    </div>
                  ) : null}
                </div>
              );
            })}
          </div>
        )}
    </div>
  );
}
