import React from "react";

/**
 * Las dos formas que tiene el atleta de conseguir coach: el codigo que le
 * pasa su entrenador, o pedir que le asignen uno. Se pinta igual en el aviso
 * del inicio y en Perfil -> Config, con el mismo estado detras.
 *
 * Presentacional: no llama a Supabase. El padre posee codigo, mensajes y
 * connectCoachByCode / requestCoach. El directorio de coaches no vive aqui.
 */
export default function CoachLinkActions({
  code,
  onCodeChange,
  onConnect,
  connecting,
  codeMsg,
  onRequest,
  requesting,
  requestPending,
  requestMsg,
  showRequest = true,
}) {
  const connectDisabled = connecting || !code.trim();
  return (
    <div>
      <div style={{ display: "flex", gap: 8, alignItems: "center", flexWrap: "wrap", marginBottom: 8 }}>
        <input
          type="text"
          value={code}
          onChange={(e) => onCodeChange(e.target.value.toUpperCase())}
          placeholder="Codigo del coach (ej: B5C9E44A)"
          style={{ flex: "1 1 180px", minWidth: 0, padding: "9px 12px", borderRadius: 8, border: "1px solid #e2e8f0", background: "#fff", color: "#0f172a", fontFamily: "inherit", fontSize: ".84em", boxSizing: "border-box" }}
        />
        <button
          type="button"
          onClick={onConnect}
          disabled={connectDisabled}
          style={{ padding: "9px 16px", borderRadius: 8, border: "none", background: connectDisabled ? "#e2e8f0" : "linear-gradient(135deg,#e86f28,#ff8a3d)", color: connectDisabled ? "#94a3b8" : "#fff", fontWeight: 800, cursor: connectDisabled ? "not-allowed" : "pointer", fontFamily: "inherit", fontSize: ".82em", whiteSpace: "nowrap" }}
        >
          {connecting ? "Conectando..." : "Conectar"}
        </button>
      </div>
      {codeMsg ? (
        <div style={{ fontSize: ".78em", color: codeMsg.startsWith("Conectado") ? "#166534" : "#dc2626", fontWeight: 600, marginBottom: 8 }}>{codeMsg}</div>
      ) : null}
      {!showRequest ? null : (
      <>
      <button
        type="button"
        onClick={onRequest}
        disabled={requesting || requestPending}
        style={{ padding: "9px 16px", borderRadius: 8, border: "1px solid rgba(255,138,61,.45)", background: requesting || requestPending ? "#f1f5f9" : "rgba(255,138,61,.12)", color: requesting || requestPending ? "#94a3b8" : "#b45309", fontWeight: 800, cursor: requesting || requestPending ? "not-allowed" : "pointer", fontFamily: "inherit", fontSize: ".82em" }}
      >
        {requesting ? "Enviando..." : requestPending ? "Solicitud enviada" : "Solicitar entrenador"}
      </button>
      <div style={{ fontSize: ".72em", color: "#64748b", marginTop: 6, lineHeight: 1.4 }}>
        {requestPending
          ? "Si tu coach te pasa un código, puedes conectarte aquí sin esperar."
          : "¿No tienes código? Pide que te asignen un entrenador y él te contactará."}
      </div>
      {requestMsg ? (
        <div style={{ fontSize: ".78em", color: requestMsg.startsWith("Solicitud enviada") ? "#166534" : "#b45309", fontWeight: 600, marginTop: 6 }}>{requestMsg}</div>
      ) : null}
      </>
      )}
    </div>
  );
}
