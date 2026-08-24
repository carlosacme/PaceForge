import React, { useEffect, useMemo, useRef, useState } from "react";
import { MapContainer, TileLayer, Polyline, useMap } from "react-leaflet";
import L from "leaflet";
import "leaflet/dist/leaflet.css";
import { supabase } from "../lib/supabase";

/** Cache en memoria de sesión: workoutId → { coords, reason?, message? } */
const routeCache = new Map();

function FitBounds({ coords }) {
  const map = useMap();
  useEffect(() => {
    if (!coords?.length) return;
    const bounds = L.latLngBounds(coords.map(([lat, lng]) => [lat, lng]));
    if (bounds.isValid()) {
      map.fitBounds(bounds, { padding: [28, 28], maxZoom: 16 });
    }
  }, [map, coords]);
  return null;
}

function fmtPaceS(s) {
  const n = Number(s);
  if (!Number.isFinite(n) || n <= 0) return "—";
  const m = Math.floor(n / 60);
  const sec = Math.round(n % 60);
  return `${m}:${String(sec).padStart(2, "0")}/km`;
}

/**
 * Botón + mapa Leaflet del recorrido de un workout ejecutado.
 * Pide coords bajo demanda (action activity-map); no escribe en BD.
 */
export default function WorkoutRouteMap({ workout }) {
  const w = workout;
  const [open, setOpen] = useState(false);
  const [loading, setLoading] = useState(false);
  const [error, setError] = useState("");
  const [payload, setPayload] = useState(null);
  const abortRef = useRef(0);

  const canRequest = Boolean(w?.id && w?.athlete_id && w?.intervals_activity_id);

  const coords = payload?.coords || [];
  const noRouteMsg =
    payload?.message ||
    (payload?.reason ? "Esta actividad no tiene datos de ruta" : "");

  const stats = useMemo(
    () => [
      { label: "Distancia", value: w?.actual_distance_km != null ? `${w.actual_distance_km} km` : "—" },
      { label: "Duración", value: w?.actual_duration_min != null ? `${w.actual_duration_min} min` : "—" },
      { label: "Ritmo medio", value: fmtPaceS(w?.actual_avg_pace_s) },
      { label: "FC prom", value: w?.actual_avg_hr != null ? `${w.actual_avg_hr} lpm` : "—" },
      { label: "FC máx", value: w?.actual_max_hr != null ? `${w.actual_max_hr} lpm` : "—" },
      { label: "Desnivel", value: w?.actual_elevation_m != null ? `${w.actual_elevation_m} m` : "—" },
    ],
    [w],
  );

  const loadMap = async () => {
    if (!canRequest) {
      setOpen(true);
      setPayload({ coords: [], reason: "no_activity", message: "Esta actividad no tiene datos de ruta" });
      return;
    }
    const cacheKey = String(w.id);
    if (routeCache.has(cacheKey)) {
      setPayload(routeCache.get(cacheKey));
      setOpen(true);
      setError("");
      return;
    }
    const ticket = ++abortRef.current;
    setLoading(true);
    setError("");
    setOpen(true);
    try {
      const { data: { session } } = await supabase.auth.getSession();
      const resp = await fetch("/api/integrations", {
        method: "POST",
        headers: {
          "Content-Type": "application/json",
          Authorization: `Bearer ${session?.access_token}`,
        },
        body: JSON.stringify({
          action: "activity-map",
          athlete_id: w.athlete_id,
          workout_id: w.id,
        }),
      });
      const data = await resp.json().catch(() => ({}));
      if (ticket !== abortRef.current) return;
      if (!resp.ok || data?.ok === false) {
        setError(data?.error || "No se pudo cargar el mapa");
        setPayload(null);
        return;
      }
      const next = {
        coords: Array.isArray(data.coords) ? data.coords : [],
        reason: data.reason || null,
        message: data.message || null,
      };
      routeCache.set(cacheKey, next);
      setPayload(next);
    } catch (e) {
      if (ticket !== abortRef.current) return;
      console.error("activity-map:", e);
      setError("No se pudo conectar. Revisa tu internet.");
      setPayload(null);
    } finally {
      if (ticket === abortRef.current) setLoading(false);
    }
  };

  if (!w?.actual_synced_at && !w?.intervals_activity_id) return null;

  return (
    <div style={{ marginTop: 12, paddingTop: 10, borderTop: "1px dashed #e2e8f0" }}>
      <button
        type="button"
        onClick={() => {
          if (open) {
            setOpen(false);
            return;
          }
          void loadMap();
        }}
        disabled={loading}
        style={{
          border: "1px solid rgba(14,165,233,.45)",
          background: loading ? "#e0f2fe" : "rgba(14,165,233,.1)",
          color: "#0369a1",
          borderRadius: 8,
          padding: "8px 12px",
          fontWeight: 800,
          fontSize: ".78em",
          cursor: loading ? "wait" : "pointer",
          fontFamily: "inherit",
        }}
      >
        {loading ? "Cargando mapa…" : open ? "Ocultar mapa" : "🗺 Ver mapa del recorrido"}
      </button>

      {open ? (
        <div style={{ marginTop: 10 }}>
          {error ? (
            <div style={{ fontSize: ".82em", color: "#b91c1c", padding: "10px 12px", background: "#fef2f2", borderRadius: 8, border: "1px solid #fecaca" }}>
              {error}
            </div>
          ) : null}

          {!error && !loading && payload && coords.length === 0 ? (
            <div style={{ fontSize: ".84em", color: "#92400e", padding: "12px 14px", background: "#fffbeb", borderRadius: 8, border: "1px solid #fde68a", lineHeight: 1.45 }}>
              Esta actividad no tiene datos de ruta
              {noRouteMsg && noRouteMsg !== "Esta actividad no tiene datos de ruta" ? (
                <span style={{ display: "block", marginTop: 4, color: "#a16207", fontSize: ".92em" }}>{noRouteMsg}</span>
              ) : null}
            </div>
          ) : null}

          {!error && coords.length > 0 ? (
            <>
              <div
                style={{
                  height: 280,
                  width: "100%",
                  borderRadius: 10,
                  overflow: "hidden",
                  border: "1px solid #e2e8f0",
                  marginBottom: 10,
                }}
              >
                <MapContainer
                  center={coords[0]}
                  zoom={14}
                  style={{ height: "100%", width: "100%" }}
                  scrollWheelZoom={false}
                >
                  <TileLayer
                    attribution='&copy; <a href="https://www.openstreetmap.org/copyright">OpenStreetMap</a>'
                    url="https://{s}.tile.openstreetmap.org/{z}/{x}/{y}.png"
                  />
                  <Polyline positions={coords} pathOptions={{ color: "#0ea5e9", weight: 4, opacity: 0.9 }} />
                  <FitBounds coords={coords} />
                </MapContainer>
              </div>
              <div
                style={{
                  display: "grid",
                  gridTemplateColumns: "repeat(3, minmax(0, 1fr))",
                  gap: 8,
                  background: "#f8fafc",
                  border: "1px solid #e2e8f0",
                  borderRadius: 10,
                  padding: 10,
                }}
              >
                {stats.map((s) => (
                  <div key={s.label} style={{ minWidth: 0 }}>
                    <div style={{ fontSize: ".65em", color: "#64748b", fontWeight: 700, textTransform: "uppercase", letterSpacing: ".04em" }}>{s.label}</div>
                    <div style={{ fontSize: ".82em", color: "#0f172a", fontWeight: 800, marginTop: 2 }}>{s.value}</div>
                  </div>
                ))}
              </div>
            </>
          ) : null}
        </div>
      ) : null}
    </div>
  );
}
