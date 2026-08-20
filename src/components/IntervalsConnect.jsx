import React, { useState, useEffect, useCallback } from "react";
import { Capacitor } from "@capacitor/core";
import { supabase } from "../lib/supabase";

/**
 * IntervalsConnect
 * -----------------------------------------------------------
 * Conexion del atleta con intervals.icu, puente hacia Garmin/COROS.
 *
 * Dos modos:
 *  - OAuth (recomendado): un clic, el atleta autoriza en intervals.icu.
 *  - API key (alternativo): pegar la clave a mano. Se conserva como
 *    plan B por si OAuth falla o la app aun no esta publicada.
 *
 * Tras conectar, se insiste en el segundo paso: enlazar el reloj DENTRO
 * de intervals.icu (Settings → Connections) y activar planned workouts.
 * -----------------------------------------------------------
 */

const INTERVALS_SETTINGS_URL = "https://intervals.icu/settings";

const CALLBACK_MSG = {
  connected:     { ok: true,  text: "¡Listo! Tu cuenta de intervals.icu quedó conectada." },
  cancelled:     { ok: false, text: "Cancelaste la conexión con intervals.icu." },
  expired:       { ok: false, text: "La solicitud expiró. Inténtalo de nuevo." },
  invalid_state: { ok: false, text: "No se pudo validar la solicitud. Inténtalo de nuevo." },
  token_error:   { ok: false, text: "intervals.icu no entregó el permiso. Inténtalo de nuevo." },
  error:         { ok: false, text: "Algo salió mal al conectar. Inténtalo de nuevo." },
};

function watchHintStorageKey(athleteId) {
  return `raf_intervals_watch_hint_dismissed_${athleteId}`;
}

/**
 * Abre https en el navegador del sistema.
 * No usa @capacitor/browser (eso es in-app) ni App Launcher (plugin extra).
 * En nativo, target=_blank / window.open lo enruta el WebView de Capacitor
 * fuera de la app cuando el dominio no es el de server.url.
 */
function openExternalUrl(url) {
  if (typeof window === "undefined") return;
  try {
    const opened = window.open(url, "_blank", "noopener,noreferrer");
    if (opened) return;
  } catch {
    /* fall through */
  }
  const a = document.createElement("a");
  a.href = url;
  a.target = "_blank";
  a.rel = "noopener noreferrer";
  a.style.display = "none";
  document.body.appendChild(a);
  a.click();
  a.remove();
  // Ultimo recurso en WebView raro: no navegar con location.href (sacaria
  // al atleta de RunningApexFlow). Solo log.
  if (Capacitor.isNativePlatform()) {
    console.info("[IntervalsConnect] openExternalUrl:", url);
  }
}

export default function IntervalsConnect({ athleteId, onNotify, refreshNonce = 0 }) {
  const [status, setStatus] = useState(null);
  const [loading, setLoading] = useState(true);
  const [apiKey, setApiKey] = useState("");
  const [busy, setBusy] = useState(false);
  const [guideOpen, setGuideOpen] = useState(false);
  const [manualOpen, setManualOpen] = useState(false);
  const [error, setError] = useState("");
  const [callbackMsg, setCallbackMsg] = useState(null);
  const [watchHintDismissed, setWatchHintDismissed] = useState(() => {
    if (!athleteId || typeof localStorage === "undefined") return false;
    return localStorage.getItem(watchHintStorageKey(athleteId)) === "1";
  });

  useEffect(() => {
    if (!athleteId || typeof localStorage === "undefined") {
      setWatchHintDismissed(false);
      return;
    }
    setWatchHintDismissed(localStorage.getItem(watchHintStorageKey(athleteId)) === "1");
  }, [athleteId]);

  const call = useCallback(async (body) => {
    const { data: { session } } = await supabase.auth.getSession();
    if (!session?.access_token) throw new Error("Sesión expirada. Vuelve a entrar.");
    const res = await fetch("/api/integrations", {
      method: "POST",
      headers: {
        "Content-Type": "application/json",
        Authorization: `Bearer ${session.access_token}`,
      },
      body: JSON.stringify({ ...body, athlete_id: athleteId }),
    });
    const data = await res.json().catch(() => ({}));
    if (!res.ok) throw new Error(data?.error || `Error ${res.status}`);
    return data;
  }, [athleteId]);

  const loadStatus = useCallback(async ({ silent = false } = {}) => {
    if (!athleteId) return;
    if (!silent) setLoading(true);
    try {
      const d = await call({ action: "status" });
      setStatus(d);
      setError("");
    } catch (e) {
      setError(e.message);
    } finally {
      if (!silent) setLoading(false);
    }
  }, [athleteId, call]);

  useEffect(() => { loadStatus(); }, [loadStatus]);

  useEffect(() => {
    if (!refreshNonce || !athleteId) return;
    void loadStatus({ silent: true });
  }, [refreshNonce, athleteId, loadStatus]);

  useEffect(() => {
    if (typeof window === "undefined") return;
    const params = new URLSearchParams(window.location.search);
    const st = params.get("intervals");
    if (!st) return;
    setCallbackMsg(CALLBACK_MSG[st] || CALLBACK_MSG.error);
    // Si acaba de conectar, volver a mostrar el aviso del reloj.
    if (st === "connected" && athleteId && typeof localStorage !== "undefined") {
      localStorage.removeItem(watchHintStorageKey(athleteId));
      setWatchHintDismissed(false);
    }
    params.delete("intervals");
    const qs = params.toString();
    window.history.replaceState({}, "", window.location.pathname + (qs ? `?${qs}` : ""));
  }, [athleteId]);

  const dismissWatchHint = () => {
    if (athleteId && typeof localStorage !== "undefined") {
      localStorage.setItem(watchHintStorageKey(athleteId), "1");
    }
    setWatchHintDismissed(true);
  };

  const handleOAuthConnect = async () => {
    setBusy(true); setError("");
    try {
      const d = await call({ action: "oauth-start" });
      if (!d?.authorize_url) throw new Error("No se pudo iniciar la conexión");
      window.location.href = d.authorize_url;
    } catch (e) {
      setError(e.message);
      setBusy(false);
    }
  };

  const handleApiKeyConnect = async () => {
    const key = apiKey.trim();
    if (key.length < 8) { setError("Pega tu API key de intervals.icu"); return; }
    setBusy(true); setError("");
    try {
      await call({ action: "connect", api_key: key });
      setApiKey("");
      if (athleteId && typeof localStorage !== "undefined") {
        localStorage.removeItem(watchHintStorageKey(athleteId));
      }
      setWatchHintDismissed(false);
      await loadStatus();
      onNotify?.("intervals.icu conectado. Ahora conecta tu reloj dentro de intervals.icu.");
    } catch (e) {
      setError(e.message);
    } finally {
      setBusy(false);
    }
  };

  const handleDisconnect = async () => {
    if (!window.confirm("¿Desconectar intervals.icu? Dejarás de recibir los entrenamientos en el reloj.")) return;
    setBusy(true); setError("");
    try {
      await call({ action: "disconnect" });
      await loadStatus();
      onNotify?.("intervals.icu desconectado");
    } catch (e) {
      setError(e.message);
    } finally {
      setBusy(false);
    }
  };

  const S = {
    pillOk: {
      display: "inline-flex",
      alignItems: "center",
      gap: 8,
      background: "rgba(34,197,94,.12)",
      border: "1px solid rgba(34,197,94,.4)",
      color: "#166534",
      borderRadius: 8,
      padding: "8px 14px",
      fontWeight: 700,
      fontSize: ".84em",
      marginBottom: 10,
    },
    nextStepCard: {
      marginTop: 4,
      marginBottom: 12,
      padding: "14px 14px 12px",
      borderRadius: 12,
      border: "1px solid rgba(255,138,61,.45)",
      background: "linear-gradient(145deg,rgba(255,138,61,.12),rgba(248,250,252,.95))",
      boxShadow: "0 4px 14px rgba(15,23,42,.06)",
    },
    btnPrimary: {
      background: "linear-gradient(135deg,#e86f28,#ff8a3d)",
      border: "none",
      borderRadius: 8,
      padding: "11px 18px",
      color: "#fff",
      fontWeight: 800,
      fontFamily: "inherit",
      cursor: "pointer",
      fontSize: ".88em",
      width: "100%",
      boxSizing: "border-box",
    },
    btnDanger: {
      background: "#fef2f2",
      border: "1px solid #fecaca",
      borderRadius: 8,
      padding: "8px 12px",
      color: "#b91c1c",
      fontWeight: 700,
      fontFamily: "inherit",
      cursor: "pointer",
      fontSize: ".82em",
    },
    btnGhost: {
      background: "#f1f5f9",
      border: "1px solid #cbd5e1",
      borderRadius: 8,
      padding: "6px 10px",
      color: "#334155",
      fontWeight: 700,
      fontFamily: "inherit",
      cursor: "pointer",
      fontSize: ".76em",
    },
    linkBtn: {
      background: "none",
      border: "none",
      color: "#64748b",
      fontWeight: 700,
      fontFamily: "inherit",
      cursor: "pointer",
      fontSize: ".74em",
      textDecoration: "underline",
      padding: 0,
    },
    manageLink: {
      display: "inline-block",
      marginTop: 2,
      marginBottom: 12,
      background: "none",
      border: "none",
      color: "#64748b",
      fontWeight: 600,
      fontFamily: "inherit",
      cursor: "pointer",
      fontSize: ".76em",
      textDecoration: "underline",
      padding: 0,
    },
    input: {
      padding: "9px 12px",
      borderRadius: 8,
      border: "1px solid #e2e8f0",
      background: "#fff",
      fontSize: ".84em",
      boxSizing: "border-box",
      width: "100%",
      fontFamily: "inherit",
    },
    err: {
      background: "#fef2f2",
      border: "1px solid #fecaca",
      color: "#b91c1c",
      borderRadius: 8,
      padding: "8px 12px",
      fontSize: ".78em",
      fontWeight: 600,
      marginTop: 8,
    },
    okMsg: {
      background: "rgba(34,197,94,.12)",
      border: "1px solid rgba(34,197,94,.4)",
      color: "#166534",
      borderRadius: 8,
      padding: "8px 12px",
      fontSize: ".78em",
      fontWeight: 600,
      marginBottom: 10,
    },
    guide: {
      background: "#f8fafc",
      border: "1px solid #e2e8f0",
      borderRadius: 8,
      padding: 14,
      marginTop: 10,
      fontSize: ".8em",
      color: "#334155",
      lineHeight: 1.7,
    },
    step: { marginBottom: 8 },
    link: { color: "#f59e0b", fontWeight: 700, textDecoration: "none" },
    manualBox: { marginTop: 12, paddingTop: 12, borderTop: "1px dashed #e2e8f0" },
  };

  if (!athleteId) return null;

  const showWatchHint = Boolean(status?.connected) && !watchHintDismissed;

  return (
    <div style={{ marginBottom: 12 }}>
      <div style={{ fontWeight: 800, fontSize: ".9em", marginBottom: 6 }}>
        ⌚ Entrenamientos en tu reloj
      </div>
      <div style={{ fontSize: ".78em", color: "#64748b", marginBottom: 10 }}>
        Conecta intervals.icu para recibir los entrenamientos de tu coach
        directamente en tu Garmin o COROS, con los ritmos objetivo.
      </div>

      {callbackMsg && (
        <div style={callbackMsg.ok ? S.okMsg : S.err}>{callbackMsg.text}</div>
      )}

      {loading ? (
        <div style={{ fontSize: ".8em", color: "#94a3b8" }}>Cargando…</div>
      ) : status?.connected ? (
        <>
          <div style={S.pillOk}>
            ✅ intervals.icu conectado
            {status.auth_type === "api_key" ? " (con API key)" : ""}
          </div>

          <button
            type="button"
            onClick={() => openExternalUrl(INTERVALS_SETTINGS_URL)}
            style={S.manageLink}
          >
            Gestionar conexión de mi reloj
          </button>

          {showWatchHint ? (
            <div style={S.nextStepCard} role="status">
              <div style={{ fontWeight: 900, color: "#9a3412", fontSize: ".95em", marginBottom: 8 }}>
                ¡intervals.icu conectado! Falta un paso
              </div>
              <div style={{ fontSize: ".84em", color: "#334155", lineHeight: 1.55, marginBottom: 12 }}>
                Ahora tienes que conectar tu reloj DENTRO de intervals.icu. Sin esto, los
                entrenamientos no llegarán a tu Garmin o COROS.
              </div>
              <button
                type="button"
                onClick={() => openExternalUrl(INTERVALS_SETTINGS_URL)}
                style={S.btnPrimary}
              >
                Conectar mi reloj
              </button>
              <div style={{ fontSize: ".78em", color: "#57534e", lineHeight: 1.5, marginTop: 12 }}>
                Marca la casilla <strong>&quot;Carga entrenamientos planificados&quot;</strong> — es la
                que hace que los entrenos bajen a tu reloj.
              </div>
              <div style={{ marginTop: 10, textAlign: "center" }}>
                <button type="button" onClick={dismissWatchHint} style={S.linkBtn}>
                  Ya lo hice
                </button>
              </div>
            </div>
          ) : null}

          {status.last_push_at && (
            <div style={{ fontSize: ".74em", color: "#64748b", marginBottom: 8 }}>
              Último envío: {new Date(status.last_push_at).toLocaleString("es-CO")}
            </div>
          )}
          {status.last_error && (
            <div style={S.err}>Último error: {status.last_error}</div>
          )}
          <button type="button" onClick={handleDisconnect} disabled={busy} style={S.btnDanger}>
            {busy ? "Desconectando…" : "Desconectar intervals.icu"}
          </button>
        </>
      ) : (
        <>
          <button type="button" onClick={handleOAuthConnect} disabled={busy} style={S.btnPrimary}>
            {busy ? "Conectando…" : "Conectar con intervals.icu"}
          </button>
          <div style={{ fontSize: ".74em", color: "#94a3b8", marginTop: 8 }}>
            Te llevaremos a intervals.icu para que autorices el acceso. No
            necesitas copiar ninguna clave.
          </div>

          <button
            type="button"
            onClick={() => setGuideOpen((v) => !v)}
            style={{ ...S.btnGhost, marginTop: 10 }}
          >
            {guideOpen ? "▲ Ocultar pasos previos" : "▼ Antes de conectar, revisa esto"}
          </button>

          {guideOpen && (
            <div style={S.guide}>
              <div style={S.step}>
                <strong>1.</strong> Crea una cuenta gratis en{" "}
                <a href="https://intervals.icu" target="_blank" rel="noreferrer" style={S.link}>intervals.icu</a>
              </div>
              <div style={S.step}>
                <strong>2.</strong> Entra a <em>Settings → Connections</em> y conecta tu Garmin o COROS.
              </div>
              <div style={S.step}>
                <strong>3.</strong> En ese mismo bloque, activa la casilla{" "}
                <em>“Upload planned workouts”</em> / <em>“Carga entrenamientos planificados”</em>.
                Sin esto los entrenamientos no llegan al reloj.
              </div>
              <div style={{ marginTop: 10, paddingTop: 10, borderTop: "1px solid #e2e8f0", color: "#64748b" }}>
                Los entrenamientos se envían a intervals.icu al instante. Cada uno aparece en tu reloj Garmin unos días antes de su fecha programada (aprox. 7 días), no todos de golpe. Si no ves los más lejanos todavía, es normal.
                También puedes forzarlos desde intervals.icu con “Send to watch”.
              </div>
            </div>
          )}

          <div style={S.manualBox}>
            <button type="button" onClick={() => setManualOpen((v) => !v)} style={S.linkBtn}>
              {manualOpen ? "Ocultar método alternativo" : "¿Problemas? Conectar con API key"}
            </button>

            {manualOpen && (
              <>
                <div style={{ fontSize: ".74em", color: "#64748b", margin: "8px 0" }}>
                  Copia tu clave desde <em>Settings → Developer Settings</em> en
                  intervals.icu y pégala aquí.
                </div>
                <div style={{ display: "flex", gap: 8, alignItems: "center", flexWrap: "wrap" }}>
                  <input
                    type="password"
                    value={apiKey}
                    onChange={(e) => setApiKey(e.target.value)}
                    placeholder="Pega tu API key de intervals.icu"
                    style={{ ...S.input, flex: "1 1 220px", maxWidth: 320 }}
                    autoComplete="off"
                  />
                  <button
                    type="button"
                    onClick={handleApiKeyConnect}
                    disabled={busy}
                    style={{ ...S.btnPrimary, padding: "8px 12px", fontSize: ".82em", width: "auto" }}
                  >
                    {busy ? "Conectando…" : "Conectar"}
                  </button>
                </div>
              </>
            )}
          </div>
        </>
      )}

      {error && <div style={S.err}>{error}</div>}
    </div>
  );
}
