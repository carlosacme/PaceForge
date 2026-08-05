import React, { useState } from "react";
import { supabase } from "../lib/supabase";

/**
 * PushToWatchButton
 * -----------------------------------------------------------
 * Boton del coach para enviar los entrenamientos pendientes del atleta
 * a su reloj (via intervals.icu -> Garmin/COROS).
 *
 * Rango: lo calcula el backend (hoy -> workout pendiente mas lejano,
 * tope 90 dias). Ya NO se usa una ventana fija de 14 dias.
 *
 * El endpoint rechaza/omite automaticamente:
 *   - atleta sin evaluacion VDOT  -> 400
 *   - atleta sin intervals.icu    -> 400
 *   - sesiones que no son carrera -> skipped
 *   - workouts con fecha pasada   -> skipped
 * Y actualiza (PUT) los eventos ya existentes por uid/external_id
 * raf-<workout.id> para no duplicar al reenviar.
 *
 * Uso en App.jsx (cabecera del atleta, junto a "Exportar PDF"):
 *   <PushToWatchButton athleteId={athlete?.id} athleteName={athlete?.name} />
 * -----------------------------------------------------------
 */
export default function PushToWatchButton({ athleteId, athleteName }) {
  const [busy, setBusy] = useState(false);
  const [result, setResult] = useState(null);   // { ok, pushed, created, updated, skipped, failed, results }
  const [error, setError] = useState("");

  const handlePush = async () => {
    if (!athleteId) return;
    setBusy(true); setError(""); setResult(null);
    try {
      const { data: { session } } = await supabase.auth.getSession();
      if (!session?.access_token) throw new Error("Sesión expirada. Vuelve a entrar.");

      const res = await fetch("/api/integrations", {
        method: "POST",
        headers: {
          "Content-Type": "application/json",
          Authorization: `Bearer ${session.access_token}`,
        },
        body: JSON.stringify({
          action: "push-range",
          athlete_id: athleteId,
          // Sin from/to: el backend cubre todo el plan pendiente (tope 90d).
        }),
      });
      const data = await res.json().catch(() => ({}));
      if (!res.ok) throw new Error(data?.error || `Error ${res.status}`);
      setResult(data);
    } catch (e) {
      setError(e.message);
    } finally {
      setBusy(false);
    }
  };

  const S = {
    btn: {
      background: busy ? "#fef3c7" : "#f1f5f9",
      border: "1px solid #cbd5e1",
      borderRadius: 8,
      padding: "8px 14px",
      color: "#0f172a",
      fontWeight: 700,
      cursor: busy ? "not-allowed" : "pointer",
      fontFamily: "inherit",
      fontSize: ".8em",
      whiteSpace: "nowrap",
    },
    panel: {
      marginTop: 8, padding: 12, borderRadius: 8,
      border: "1px solid #e2e8f0", background: "#f8fafc",
      fontSize: ".78em", color: "#334155", lineHeight: 1.6,
    },
    ok: { color: "#166534", fontWeight: 800 },
    warn: { color: "#b45309", fontWeight: 700 },
    bad: { color: "#b91c1c", fontWeight: 700 },
    err: {
      marginTop: 8, background: "#fef2f2", border: "1px solid #fecaca",
      color: "#b91c1c", borderRadius: 8, padding: "8px 12px",
      fontSize: ".78em", fontWeight: 600, maxWidth: 420,
    },
  };

  if (!athleteId) return null;

  return (
    <div style={{ display: "inline-block" }}>
      <button type="button" onClick={handlePush} disabled={busy} style={S.btn}
        title={`Envía los entrenamientos pendientes al reloj de ${athleteName || "el atleta"}`}>
        {busy ? "Enviando…" : "📲 Enviar al reloj"}
      </button>

      {error && (
        <div style={S.err}>
          {error}
        </div>
      )}

      {result && (
        <div style={S.panel}>
          {result.pushed > 0 ? (
            <div style={S.ok}>
              ✅ {result.pushed} entrenamiento{result.pushed !== 1 ? "s" : ""} enviado
              {result.pushed !== 1 ? "s" : ""} al reloj
              {(result.created != null || result.updated != null) ? (
                <span style={{ fontWeight: 600, color: "#64748b" }}>
                  {" "}({result.created || 0} nuevo{(result.created || 0) !== 1 ? "s" : ""}
                  , {result.updated || 0} actualizado{(result.updated || 0) !== 1 ? "s" : ""})
                </span>
              ) : null}
            </div>
          ) : (
            <div style={S.warn}>
              No se envió ningún entrenamiento
            </div>
          )}

          {result.from && result.to && (
            <div style={{ color: "#64748b", marginTop: 4 }}>
              Rango: {result.from} → {result.to}
            </div>
          )}

          {result.vdot_used && (
            <div style={{ color: "#64748b", marginTop: 4 }}>
              Ritmos calculados con VDOT {result.vdot_used}
            </div>
          )}

          {result.skipped > 0 && (
            <div style={{ marginTop: 4, color: "#64748b" }}>
              {result.skipped} omitida{result.skipped !== 1 ? "s" : ""} (sin ritmos
              o fecha pasada)
            </div>
          )}

          {result.failed > 0 && (
            <div style={{ ...S.bad, marginTop: 4 }}>
              {result.failed} con error
            </div>
          )}

          {Array.isArray(result.results) && result.results.length > 0 && (
            <ul style={{ margin: "8px 0 0", paddingLeft: 18 }}>
              {result.results.map((r) => (
                <li key={r.id} style={{ marginBottom: 2 }}>
                  {r.ok ? "✅" : "❌"} {r.title}
                  {r.ok && r.action === "updated" ? " · actualizado" : ""}
                  {r.ok && r.action === "created" ? " · nuevo" : ""}
                  {r.ok && r.steps ? ` · ${r.steps} paso${r.steps !== 1 ? "s" : ""}` : ""}
                  {!r.ok && r.error ? ` · ${r.error}` : ""}
                </li>
              ))}
            </ul>
          )}

          <div style={{ marginTop: 8, paddingTop: 8, borderTop: "1px solid #e2e8f0", color: "#64748b" }}>
            Los entrenamientos se envían a intervals.icu al instante. Cada uno aparece en tu reloj Garmin unos días antes de su fecha programada (aprox. 7 días), no todos de golpe. Si no ves los más lejanos todavía, es normal.
          </div>
        </div>
      )}
    </div>
  );
}
