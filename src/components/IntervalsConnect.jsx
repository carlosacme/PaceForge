import React, { useState, useEffect, useCallback } from "react";
import { supabase } from "../lib/supabase";

/**
 * IntervalsConnect
 * -----------------------------------------------------------
 * Conexion del atleta con intervals.icu, que actua de puente
 * para enviar los entrenamientos planificados a Garmin/COROS.
 *
 * Se usa mientras Garmin y COROS aprueban el acceso directo a sus APIs.
 *
 * Uso en AthleteHome.jsx (tab "config", junto a Strava):
 *   <IntervalsConnect athleteId={athleteInfo?.id} onNotify={setMessage} />
 * -----------------------------------------------------------
 */
export default function IntervalsConnect({ athleteId, onNotify }) {
  const [status, setStatus] = useState(null);     // { connected, last_push_at, last_error }
  const [loading, setLoading] = useState(true);
  const [apiKey, setApiKey] = useState("");
  const [busy, setBusy] = useState(false);
  const [guideOpen, setGuideOpen] = useState(false);
  const [error, setError] = useState("");

  /** Llamada autenticada a /api/integrations */
  const call = useCallback(async (body) => {
    const { data: { session } } = await supabase.auth.getSession();
    if (!session?.access_token) throw new Error("Sesion expirada. Vuelve a entrar.");
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

  const loadStatus = useCallback(async () => {
    if (!athleteId) return;
    setLoading(true);
    try {
      const d = await call({ action: "status" });
      setStatus(d);
      setError("");
    } catch (e) {
      setError(e.message);
    } finally {
      setLoading(false);
    }
  }, [athleteId, call]);

  useEffect(() => { loadStatus(); }, [loadStatus]);

  const handleConnect = async () => {
    const key = apiKey.trim();
    if (key.length < 8) { setError("Pega tu API key de intervals.icu"); return; }
    setBusy(true); setError("");
    try {
      await call({ action: "connect", api_key: key });
      setApiKey("");
      await loadStatus();
      onNotify?.("intervals.icu conectado. Tus entrenamientos llegaran al reloj.");
    } catch (e) {
      setError(e.message);
    } finally {
      setBusy(false);
    }
  };

  const handleDisconnect = async () => {
    if (!window.confirm("Desconectar intervals.icu? Dejaras de recibir los entrenamientos en el reloj.")) return;
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

  /* ---------- estilos (mismo patron del resto de la app) ---------- */
  const S = {
    pillOk: { display: "inline-flex", alignItems: "center", gap: 8, background: "rgba(34,197,94,.12)", border: "1px solid rgba(34,197,94,.4)", color: "#166534", borderRadius: 8, padding: "8px 14px", fontWeight: 700, fontSize: ".84em", marginBottom: 10 },
    btnPrimary: { background: "linear-gradient(135deg,#b45309,#f59e0b)", border: "none", borderRadius: 8, padding: "8px 12px", color: "#fff", fontWeight: 800, fontFamily: "inherit", cursor: "pointer", fontSize: ".82em" },
    btnDanger: { background: "#fef2f2", border: "1px solid #fecaca", borderRadius: 8, padding: "8px 12px", color: "#b91c1c", fontWeight: 700, fontFamily: "inherit", cursor: "pointer", fontSize: ".82em" },
    btnGhost: { background: "#f1f5f9", border: "1px solid #cbd5e1", borderRadius: 8, padding: "6px 10px", color: "#334155", fontWeight: 700, fontFamily: "inherit", cursor: "pointer", fontSize: ".76em" },
    input: { padding: "9px 12px", borderRadius: 8, border: "1px solid #e2e8f0", background: "#fff", fontSize: ".84em", boxSizing: "border-box", width: "100%", fontFamily: "inherit" },
    err: { background: "#fef2f2", border: "1px solid #fecaca", color: "#b91c1c", borderRadius: 8, padding: "8px 12px", fontSize: ".78em", fontWeight: 600, marginTop: 8 },
    guide: { background: "#f8fafc", border: "1px solid #e2e8f0", borderRadius: 8, padding: 14, marginTop: 10, fontSize: ".8em", color: "#334155", lineHeight: 1.7 },
    step: { marginBottom: 8 },
    link: { color: "#f59e0b", fontWeight: 700, textDecoration: "none" },
  };

  if (!athleteId) return null;

  return (
    <div style={{ marginBottom: 12 }}>
      <div style={{ fontWeight: 800, fontSize: ".9em", marginBottom: 6 }}>
        ⌚ Entrenamientos en tu reloj
      </div>
      <div style={{ fontSize: ".78em", color: "#64748b", marginBottom: 10 }}>
        Conecta intervals.icu para recibir los entrenamientos de tu coach
        directamente en tu Garmin o COROS, con los ritmos objetivo.
      </div>

      {loading ? (
        <div style={{ fontSize: ".8em", color: "#94a3b8" }}>Cargando…</div>
      ) : status?.connected ? (
        <>
          <div style={S.pillOk}>✅ intervals.icu conectado</div>
          {status.last_push_at && (
            <div style={{ fontSize: ".74em", color: "#64748b", marginBottom: 8 }}>
              Ultimo envio: {new Date(status.last_push_at).toLocaleString("es-CO")}
            </div>
          )}
          {status.last_error && (
            <div style={S.err}>Ultimo error: {status.last_error}</div>
          )}
          <br />
          <button type="button" onClick={handleDisconnect} disabled={busy} style={S.btnDanger}>
            {busy ? "Desconectando…" : "Desconectar intervals.icu"}
          </button>
        </>
      ) : (
        <>
          <button type="button" onClick={() => setGuideOpen((v) => !v)} style={S.btnGhost}>
            {guideOpen ? "▲ Ocultar pasos" : "▼ Como obtengo mi API key?"}
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
                <em>“Upload planned workouts”</em>. Sin esto los entrenamientos
                no llegan al reloj.
              </div>
              <div style={S.step}>
                <strong>4.</strong> Ve a <em>Settings → Developer Settings</em> y copia tu <em>API key</em>.
              </div>
              <div style={S.step}>
                <strong>5.</strong> Pegala aqui abajo y dale Conectar.
              </div>
              <div style={{ marginTop: 10, paddingTop: 10, borderTop: "1px solid #e2e8f0", color: "#64748b" }}>
                Los entrenamientos llegan al reloj la manana del dia programado.
                Tambien puedes forzarlos desde intervals.icu con “Send to watch”.
              </div>
            </div>
          )}

          <div style={{ display: "flex", gap: 8, marginTop: 10, alignItems: "center", flexWrap: "wrap" }}>
            <input
              type="password"
              value={apiKey}
              onChange={(e) => setApiKey(e.target.value)}
              placeholder="Pega tu API key de intervals.icu"
              style={{ ...S.input, flex: "1 1 220px", maxWidth: 320 }}
              autoComplete="off"
            />
            <button type="button" onClick={handleConnect} disabled={busy} style={S.btnPrimary}>
              {busy ? "Conectando…" : "Conectar"}
            </button>
          </div>
        </>
      )}

      {error && <div style={S.err}>{error}</div>}
    </div>
  );
}
