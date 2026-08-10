import { useCallback, useEffect, useState } from "react";
import {
  checkFcmTokenInProfile,
  formatPushDiagnostics,
  isNativePush,
  readPushDiagnostics,
  registerNativePush,
  subscribePushDiagnostics,
} from "../../lib/nativePush";
import { readMyLastPushDelivery } from "./appShared";

/**
 * Estado de las notificaciones dentro de la APK.
 *
 * En el navegador se diagnostica con la consola; dentro del WebView no hay
 * donde mirar, asi que cada paso de la cadena (permiso -> token -> guardado en
 * el perfil) se enseña aqui, con un boton para reintentar y otro para copiar el
 * detalle y mandarlo. Fuera de la APK el componente no pinta nada.
 */

const fmt = (iso) => {
  if (!iso) return null;
  const d = new Date(iso);
  return Number.isNaN(d.getTime()) ? null : d.toLocaleString("es-CO", { dateStyle: "short", timeStyle: "short" });
};

const Row = ({ label, value, ok }) => (
  <div style={{ display: "flex", gap: 8, justifyContent: "space-between", alignItems: "baseline", padding: "4px 0" }}>
    <span style={{ color: "#64748b", fontSize: ".74em" }}>{label}</span>
    <span
      style={{
        color: ok === true ? "#16a34a" : ok === false ? "#dc2626" : "#0f172a",
        fontSize: ".74em",
        fontWeight: 700,
        textAlign: "right",
        wordBreak: "break-word",
      }}
    >
      {value}
    </span>
  </div>
);

export default function PushDiagnosticsPanel({ notify, cardStyle }) {
  const [diag, setDiag] = useState(() => readPushDiagnostics());
  const [open, setOpen] = useState(false);
  const [busy, setBusy] = useState(false);
  const [profileToken, setProfileToken] = useState(null);
  const [lastDelivery, setLastDelivery] = useState(null);

  useEffect(() => subscribePushDiagnostics(setDiag), []);

  const refreshProfileToken = useCallback(async () => {
    const res = await checkFcmTokenInProfile();
    setProfileToken(res.ok ? { hasToken: res.hasToken, tail: res.tokenTail } : { error: res.reason });
    return res;
  }, []);

  useEffect(() => {
    if (!isNativePush()) return undefined;
    let cancelled = false;
    checkFcmTokenInProfile().then((res) => {
      if (cancelled) return;
      setProfileToken(res.ok ? { hasToken: res.hasToken, tail: res.tokenTail } : { error: res.reason });
    });
    return () => {
      cancelled = true;
    };
  }, []);

  useEffect(() => {
    let cancelled = false;
    readMyLastPushDelivery().then((row) => {
      if (!cancelled) setLastDelivery(row);
    });
    return () => {
      cancelled = true;
    };
  }, []);

  // En la APK el panel siempre esta disponible (es donde se diagnostica el
  // registro nativo). En navegador solo aparece si el ultimo aviso dirigido a
  // este usuario NO se pudo entregar: si todo va bien, no estorba.
  const deliveryFailed = Boolean(lastDelivery) && lastDelivery.status !== "sent";
  if (!isNativePush() && !deliveryFailed) return null;

  const native = isNativePush();
  const saved = Boolean(diag.savedAt) && profileToken?.hasToken !== false;
  const ok = native ? saved && !deliveryFailed : !deliveryFailed;
  const headline = !native
    ? "No pudimos entregarte el último aviso"
    : saved
      ? deliveryFailed ? "Activas, pero el último aviso no llegó" : "Notificaciones activas"
      : diag.permission && diag.permission !== "granted"
        ? "Falta el permiso de notificaciones"
        : "Notificaciones sin activar";

  const deliveryLabel = (() => {
    if (!lastDelivery) return "ninguno registrado";
    const when = fmt(lastDelivery.created_at) || "";
    const estado = lastDelivery.status === "sent"
      ? "entregado a Firebase"
      : lastDelivery.status === "no_token"
        ? "no tenías notificaciones activas"
        : lastDelivery.status === "rejected"
          ? `rechazado (${lastDelivery.reason || "sin detalle"})`
          : `error (${lastDelivery.reason || "sin detalle"})`;
    return `${when} · ${estado}`;
  })();

  const retry = async () => {
    setBusy(true);
    await registerNativePush({ notify });
    // El token llega por el listener, unos segundos despues de register().
    setTimeout(() => { void refreshProfileToken(); }, 4000);
    setBusy(false);
  };

  const copy = async () => {
    const text = `${formatPushDiagnostics()}\nperfil: ${
      profileToken?.error ? `error (${profileToken.error})` : profileToken?.hasToken ? `con token ${profileToken.tail}` : "sin token"
    }\nultimo aviso hacia mi: ${deliveryLabel}`;
    try {
      await navigator.clipboard.writeText(text);
      if (notify) notify("Diagnóstico copiado");
    } catch {
      if (notify) notify(text);
    }
  };

  return (
    <div style={{ ...(cardStyle || {}), marginTop: 12, border: `1px solid ${ok ? "rgba(34,197,94,.35)" : "rgba(245,158,11,.45)"}` }}>
      <button
        type="button"
        onClick={() => setOpen((v) => !v)}
        style={{
          width: "100%",
          background: "transparent",
          border: "none",
          padding: 0,
          display: "flex",
          alignItems: "center",
          justifyContent: "space-between",
          gap: 10,
          cursor: "pointer",
          fontFamily: "inherit",
          color: "#0f172a",
        }}
      >
        <span style={{ display: "flex", alignItems: "center", gap: 8, fontWeight: 800, fontSize: ".84em" }}>
          <span style={{ color: ok ? "#16a34a" : "#d97706" }}>●</span>
          {headline}
        </span>
        <span style={{ color: "#94a3b8", fontSize: ".74em" }}>{open ? "Ocultar" : "Ver detalle"}</span>
      </button>

      {open ? (
        <div style={{ marginTop: 12, borderTop: "1px solid #e2e8f0", paddingTop: 8 }}>
          {native ? (
            <>
              <Row label="Permiso" value={diag.permission || "sin comprobar"} ok={diag.permission ? diag.permission === "granted" : null} />
              <Row label="Registro pedido a Firebase" value={fmt(diag.registerAt) || "nunca"} ok={diag.registerAt ? true : null} />
              <Row
                label="Token recibido"
                value={diag.tokenAt ? `${fmt(diag.tokenAt)} · ${diag.tokenTail}` : "nunca"}
                ok={diag.tokenAt ? true : false}
              />
              <Row label="Guardado en tu perfil" value={fmt(diag.savedAt) || "no"} ok={Boolean(diag.savedAt)} />
              <Row
                label="Comprobado en la base de datos"
                value={
                  profileToken?.error
                    ? `no se pudo leer (${profileToken.error})`
                    : profileToken?.hasToken
                      ? `con token ${profileToken.tail}`
                      : "sin token"
                }
                ok={profileToken?.error ? null : Boolean(profileToken?.hasToken)}
              />
              {diag.lastError ? <Row label="Último error" value={diag.lastError} ok={false} /> : null}
            </>
          ) : null}
          <Row label="Último aviso hacia ti" value={deliveryLabel} ok={lastDelivery ? lastDelivery.status === "sent" : null} />
          {!native ? (
            <p style={{ margin: "10px 0 0", color: "#64748b", fontSize: ".72em", lineHeight: 1.45 }}>
              Tu permiso de notificaciones caducó en este navegador. Vuelve a activarlas para recibir los avisos.
            </p>
          ) : null}

          <div style={{ display: "flex", gap: 8, marginTop: 12, flexWrap: "wrap" }}>
            <button
              type="button"
              onClick={retry}
              disabled={busy || !native}
              hidden={!native}
              style={{
                padding: "8px 14px",
                borderRadius: 8,
                border: "none",
                background: busy ? "#cbd5e1" : "linear-gradient(135deg,#b45309,#f59e0b)",
                color: "#fff",
                fontWeight: 800,
                fontSize: ".78em",
                cursor: busy ? "default" : "pointer",
                fontFamily: "inherit",
              }}
            >
              {busy ? "Reintentando…" : "Reintentar registro"}
            </button>
            <button
              type="button"
              onClick={copy}
              style={{
                padding: "8px 14px",
                borderRadius: 8,
                border: "1px solid #e2e8f0",
                background: "#fff",
                color: "#475569",
                fontWeight: 700,
                fontSize: ".78em",
                cursor: "pointer",
                fontFamily: "inherit",
              }}
            >
              Copiar diagnóstico
            </button>
          </div>
        </div>
      ) : null}
    </div>
  );
}
