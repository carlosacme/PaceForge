import React, { useState, useEffect, useCallback } from "react";
import { createPortal } from "react-dom";
import { supabase } from "../lib/supabase";
import { sendAppEmail, styles } from "./shared/appShared";

/**
 * Modal coach → invitar atleta (crear fila invitations + link / correo).
 * El receptor del link `?invite=` vive en AuthLanding — este módulo solo emite.
 *
 * @param {{
 *   open: boolean,
 *   onClose: () => void,
 *   coachUserId: string | null | undefined,
 *   coachPublicCode: string,
 *   notify: (msg: string) => void,
 * }} props
 */
export default function InviteModal({
  open,
  onClose,
  coachUserId,
  coachPublicCode,
  notify,
}) {
  const S = styles;
  const [inviteEmail, setInviteEmail] = useState("");
  const [inviteSending, setInviteSending] = useState(false);
  const [lastInviteLink, setLastInviteLink] = useState("");

  const resetForm = useCallback(() => {
    setInviteEmail("");
    setInviteSending(false);
    setLastInviteLink("");
  }, []);

  const handleClose = useCallback(() => {
    resetForm();
    onClose?.();
  }, [onClose, resetForm]);

  // Al abrir: formulario limpio (no arrastrar invitación anterior).
  useEffect(() => {
    if (!open) return;
    resetForm();
  }, [open, resetForm]);

  // Escape cierra el modal (el original no lo tenía; se añade con el X/backdrop).
  useEffect(() => {
    if (!open) return undefined;
    const onKey = (e) => {
      if (e.key === "Escape") {
        e.preventDefault();
        handleClose();
      }
    };
    window.addEventListener("keydown", onKey);
    return () => window.removeEventListener("keydown", onKey);
  }, [open, handleClose]);

  // Crea la invitacion (fila en invitations) y expone su link, SIN depender del
  // email. El email es opcional: si el coach lo escribio, se guarda; si no, la
  // fila queda con email null y el coach comparte el link directo.
  const createInviteLink = useCallback(async () => {
    if (!coachUserId) {
      notify("No hay sesión activa.");
      return null;
    }
    const code =
      (typeof crypto !== "undefined" && crypto.randomUUID && crypto.randomUUID()) ||
      `${Date.now()}-${Math.random().toString(16).slice(2)}`;
    const inviteLink = `https://www.runningapexflow.com?invite=${encodeURIComponent(code)}`;
    const { error: insError } = await supabase.from("invitations").insert({
      coach_id: coachUserId,
      email: inviteEmail?.trim() || null,
      code,
      status: "pending",
    });
    if (insError) {
      console.error("Error guardando invitación:", insError);
      notify(insError.message || "No se pudo guardar la invitación.");
      return null;
    }
    setLastInviteLink(inviteLink);
    return inviteLink;
  }, [inviteEmail, notify, coachUserId]);

  const generateInviteLink = useCallback(async () => {
    setInviteSending(true);
    try {
      await createInviteLink();
    } finally {
      setInviteSending(false);
    }
  }, [createInviteLink]);

  const sendAthleteInvitation = useCallback(async () => {
    const email = inviteEmail.trim().toLowerCase();
    if (!email || !coachUserId) {
      notify("Escribe un email o usa el link directo.");
      return;
    }
    setInviteSending(true);
    try {
      const inviteLink = await createInviteLink();
      if (!inviteLink) return;
      const mail = await sendAppEmail({
        template: "athlete_invite",
        to: email,
        vars: {
          inviteLink,
          coachCode: coachPublicCode || undefined,
        },
      });
      notify(mail.ok ? "Invitación enviada ✓" : `No se pudo enviar el correo (${mail.reason}). Comparte el enlace a mano.`);
    } catch (e) {
      console.error("sendAthleteInvitation:", e);
      notify("No se pudo enviar la invitación.");
    } finally {
      setInviteSending(false);
    }
  }, [inviteEmail, coachPublicCode, notify, coachUserId, createInviteLink]);

  if (!open) return null;
  if (typeof document === "undefined") return null;

  // Portal a body + z-index alto: el chrome (bottom nav z=100, plan picker 4000)
  // no debe quedar por encima ni robar clics al botón Cerrar.
  return createPortal(
    <div
      role="presentation"
      onClick={handleClose}
      style={{
        position: "fixed",
        inset: 0,
        background: "rgba(15,23,42,.45)",
        display: "flex",
        alignItems: "center",
        justifyContent: "center",
        zIndex: 10050,
        padding: 16,
        overflowY: "auto",
        boxSizing: "border-box",
      }}
    >
      <div
        role="dialog"
        aria-modal="true"
        aria-labelledby="invite-athlete-modal-title"
        onClick={(e) => e.stopPropagation()}
        style={{ ...S.card, width: "100%", maxWidth: 460, margin: "auto", position: "relative" }}
      >
        <button
          type="button"
          aria-label="Cerrar"
          onClick={handleClose}
          style={{
            position: "absolute",
            top: 12,
            right: 12,
            width: 36,
            height: 36,
            borderRadius: 8,
            border: "1px solid #e2e8f0",
            background: "#fff",
            color: "#64748b",
            cursor: "pointer",
            fontFamily: "inherit",
            fontWeight: 800,
            fontSize: "1.1em",
            lineHeight: 1,
            display: "flex",
            alignItems: "center",
            justifyContent: "center",
          }}
        >
          ×
        </button>
        <div id="invite-athlete-modal-title" style={{ fontSize: ".95em", fontWeight: 800, color: "#0f172a", marginBottom: 10, paddingRight: 40 }}>
          📧 Invitar Atleta
        </div>
        <div style={{ fontSize: ".8em", color: "#64748b", marginBottom: 8 }}>Email del atleta (opcional)</div>
        <input
          type="email"
          value={inviteEmail}
          onChange={(e) => setInviteEmail(e.target.value)}
          placeholder="atleta@email.com"
          style={{ width: "100%", background: "#fff", border: "1px solid #e2e8f0", borderRadius: 8, padding: "10px 12px", color: "#0f172a", fontFamily: "inherit", fontSize: ".85em", boxSizing: "border-box" }}
        />
        <div style={{ fontSize: ".8em", color: "#64748b", marginTop: 14, marginBottom: 4 }}>Código coach</div>
        <input
          type="text"
          readOnly
          value={coachPublicCode}
          aria-readonly="true"
          style={{ width: "100%", background: "#f8fafc", border: "1px solid #e2e8f0", borderRadius: 8, padding: "10px 12px", color: "#0f172a", fontFamily: "ui-monospace,monospace", fontSize: ".9em", fontWeight: 700, boxSizing: "border-box" }}
        />
        <div style={{ fontSize: ".72em", color: "#94a3b8", marginTop: 6, lineHeight: 1.45 }}>El atleta usará este código al registrarse.</div>
        <div style={{ marginTop: 12, display: "flex", justifyContent: "flex-end", gap: 8, flexWrap: "wrap" }}>
          <button
            type="button"
            onClick={handleClose}
            style={{ background: "#fff", border: "1px solid #e2e8f0", borderRadius: 8, padding: "8px 12px", color: "#64748b", cursor: "pointer", fontFamily: "inherit", fontWeight: 700, fontSize: ".8em" }}
          >
            Cerrar
          </button>
          <button
            type="button"
            onClick={sendAthleteInvitation}
            disabled={inviteSending}
            style={{ background: inviteSending ? "#e2e8f0" : "linear-gradient(135deg,#0d9488,#14b8a6)", border: "none", borderRadius: 8, padding: "8px 12px", color: inviteSending ? "#64748b" : "#fff", cursor: inviteSending ? "not-allowed" : "pointer", fontFamily: "inherit", fontWeight: 800, fontSize: ".8em" }}
          >
            {inviteSending ? "Enviando..." : "📧 Enviar por correo"}
          </button>
          <button
            type="button"
            onClick={generateInviteLink}
            disabled={inviteSending}
            style={{ background: inviteSending ? "#e2e8f0" : "#0f172a", border: "none", borderRadius: 8, padding: "8px 12px", color: inviteSending ? "#64748b" : "#fff", cursor: inviteSending ? "not-allowed" : "pointer", fontFamily: "inherit", fontWeight: 800, fontSize: ".8em" }}
          >
            🔗 Generar link
          </button>
        </div>
        {lastInviteLink && (
          <div style={{ marginTop: 14, paddingTop: 14, borderTop: "1px solid #e2e8f0" }}>
            <div style={{ fontSize: ".82em", color: "#166534", fontWeight: 700, marginBottom: 8 }}>
              ✅ Invitación enviada por correo. También puedes compartir el link:
            </div>
            <div style={{ display: "flex", gap: 8, flexWrap: "wrap" }}>
              <button
                type="button"
                onClick={() => {
                  const msg = `¡Te invito a entrenar conmigo en RunningApexFlow! 🏃 Regístrate aquí y recibe tus entrenamientos directo en tu reloj: ${lastInviteLink}`;
                  window.open(`https://wa.me/?text=${encodeURIComponent(msg)}`, "_blank");
                }}
                style={{ background: "#25D366", color: "#fff", border: "none", borderRadius: 8, padding: "10px 16px", fontWeight: 800, fontFamily: "inherit", cursor: "pointer", fontSize: ".85em" }}
              >
                💬 Compartir por WhatsApp
              </button>
              <button
                type="button"
                onClick={async () => {
                  try {
                    await navigator.clipboard.writeText(lastInviteLink);
                    alert("Link copiado");
                  } catch {
                    alert("No se pudo copiar");
                  }
                }}
                style={{ background: "#f1f5f9", color: "#334155", border: "1px solid #cbd5e1", borderRadius: 8, padding: "10px 16px", fontWeight: 700, fontFamily: "inherit", cursor: "pointer", fontSize: ".85em" }}
              >
                📋 Copiar link
              </button>
            </div>
          </div>
        )}
      </div>
    </div>,
    document.body,
  );
}
