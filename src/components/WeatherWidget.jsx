import { useState, useEffect, useCallback } from "react";
import { getCurrentCoords, geoNoticeText, geoCanRetry } from "../lib/geo";
import { authApiFetch } from "./shared/appShared";

const INTENSITY_STYLES = {
 normal: { bg: "rgba(34,197,94,.1)", border: "rgba(34,197,94,.4)", color: "#166534", icon: "" },
caution: { bg: "rgba(245,158,11,.1)", border: "rgba(245,158,11,.4)", color: "#92400e", icon: "Precaucion:" },
warning: { bg: "rgba(239,68,68,.1)", border: "rgba(239,68,68,.4)", color: "#991b1b", icon: "Alerta:" },
};

// Lugares propios con nombre fijo (override manual)
const KNOWN_PLACES = [
  { name: "Base Naval ARC Málaga", lat: 3.9740, lon: -77.3269, radiusKm: 5 },
];
const PLACE_RADIUS_KM = 5; // radio para aceptar el nombre automático del geocoder

const distanceKm = (lat1, lon1, lat2, lon2) => {
  const R = 6371;
  const toRad = (d) => (d * Math.PI) / 180;
  const dLat = toRad(lat2 - lat1);
  const dLon = toRad(lon2 - lon1);
  const a =
    Math.sin(dLat / 2) ** 2 +
    Math.cos(toRad(lat1)) * Math.cos(toRad(lat2)) * Math.sin(dLon / 2) ** 2;
  return 2 * R * Math.asin(Math.sqrt(a));
};

const formatLocationLabel = (w, approximate = false) => {
  if (!w || w.lat == null || w.lon == null) return "Tu ubicacion";
  const lat = Number(w.lat);
  const lon = Number(w.lon);

  // Sin ubicacion real no se puede llamar "tu ubicacion" a las coordenadas de
  // respaldo: se etiqueta como aproximada.
  if (approximate) {
    return w.placeName ? "Ubicación aproximada: " + w.placeName : "Ubicación aproximada";
  }

  // 1) Lugar conocido propio (Málaga)
  const known = KNOWN_PLACES.find((p) => distanceKm(lat, lon, p.lat, p.lon) <= p.radiusKm);
  if (known) return known.name;

  // 2) Nombre automático del geocoder, si está dentro del radio
  if (w.placeName && (w.placeDistanceKm == null || w.placeDistanceKm <= PLACE_RADIUS_KM)) {
    return w.placeName;
  }

  // 3) Nada conocido cerca: coordenadas
  return "Tu ubicacion (" + lat.toFixed(4) + ", " + lon.toFixed(4) + ")";
};

/** Ubicacion + clima. Compartido por el widget y el hook useWeather. */
function useWeatherData() {
  const [weather, setWeather] = useState(null);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState("");
  const [geo, setGeo] = useState({ approximate: false, reason: null });
  const [attempt, setAttempt] = useState(0);

  useEffect(() => {
    let cancelled = false;
    (async () => {
      setLoading(true);
      const coords = await getCurrentCoords({ force: attempt > 0 });
      if (cancelled) return;
      setGeo({ approximate: coords.approximate, reason: coords.reason });
      try {
        const res = await authApiFetch("/api/weather?lat=" + coords.lat + "&lon=" + coords.lon);
        const data = await res.json();
        if (cancelled) return;
        if (!res.ok) { setError("No se pudo obtener el clima"); return; }
        setError("");
        setWeather(data);
      } catch {
        if (!cancelled) setError("Error de red");
      } finally {
        if (!cancelled) setLoading(false);
      }
    })();
    return () => { cancelled = true; };
  }, [attempt]);

  // Reintento: en nativo vuelve a lanzar requestPermissions, asi que sirve
  // como boton "permitir ubicacion".
  const retry = useCallback(() => setAttempt((n) => n + 1), []);

  return { weather, loading, error, geo, retry };
}

function GeoNotice({ reason, onRetry, color }) {
  return (
    <div style={{ fontSize: ".72em", color: color || "#92400e", marginTop: 4, lineHeight: 1.4 }}>
      {geoNoticeText(reason)}
      {geoCanRetry(reason) ? (
        <button
          type="button"
          onClick={onRetry}
          style={{ marginLeft: 6, border: "none", background: "none", padding: 0, color: "inherit", fontWeight: 800, textDecoration: "underline", cursor: "pointer", fontFamily: "inherit", fontSize: "1em" }}
        >
          Reintentar
        </button>
      ) : null}
    </div>
  );
}

export default function WeatherWidget({ compact = false }) {
  const { weather, loading, error, geo, retry } = useWeatherData();

  if (loading) return (
    <div style={{ padding: "10px 14px", borderRadius: 10, background: "#f1f5f9", border: "1px solid #e2e8f0", fontSize: ".78em", color: "#64748b" }}>
      Cargando clima...
    </div>
  );

  if (error || !weather) return null;

  const st = INTENSITY_STYLES[weather.intensity] || INTENSITY_STYLES.normal;

  if (compact) {
    return (
      <div style={{ padding: "8px 12px", borderRadius: 10, background: st.bg, border: "1px solid " + st.border, display: "flex", alignItems: "center", gap: 10, flexWrap: "wrap" }}>
        <img src={"https://openweathermap.org/img/wn/" + weather.icon + ".png"} alt={weather.description} style={{ width: 32, height: 32 }} />
        <div style={{ flex: 1, minWidth: 0 }}>
          <div style={{ fontSize: ".78em", fontWeight: 800, color: st.color }}>
            {formatLocationLabel(weather, geo.approximate)} - {weather.temp}C - {weather.humidity}% hum
          </div>
          <div style={{ fontSize: ".72em", color: st.color, marginTop: 2, lineHeight: 1.4 }}>
            {st.icon} {weather.advice}
          </div>
          {geo.approximate ? <GeoNotice reason={geo.reason} onRetry={retry} color={st.color} /> : null}
        </div>
      </div>
    );
  }

  return (
    <div style={{ padding: "14px 16px", borderRadius: 12, background: st.bg, border: "1px solid " + st.border, marginBottom: 14 }}>
      <div style={{ display: "flex", alignItems: "center", gap: 12, marginBottom: 8, flexWrap: "wrap" }}>
        <img src={"https://openweathermap.org/img/wn/" + weather.icon + "@2x.png"} alt={weather.description} style={{ width: 48, height: 48 }} />
        <div>
          <div style={{ fontSize: ".72em", fontWeight: 800, color: st.color, textTransform: "uppercase", letterSpacing: ".1em" }}>
            {formatLocationLabel(weather, geo.approximate)}
          </div>
          <div style={{ fontSize: "1.6em", fontWeight: 900, color: st.color, lineHeight: 1 }}>
            {weather.temp} C
          </div>
          <div style={{ fontSize: ".72em", color: st.color, marginTop: 2 }}>
            Sensacion {weather.feelsLike}C - {weather.humidity}% humedad - {weather.windSpeed} km/h viento
          </div>
        </div>
      </div>
      <div style={{ fontSize: ".8em", color: st.color, fontWeight: 700, lineHeight: 1.5 }}>
        {st.icon} {weather.advice}
      </div>
      {geo.approximate ? <GeoNotice reason={geo.reason} onRetry={retry} color={st.color} /> : null}
    </div>
  );
}

export function useWeather() {
  const { weather, geo, retry } = useWeatherData();

  const getWorkoutWeatherNote = () => {
    if (!weather) return "";
    // Con ubicacion aproximada el consejo no corresponde a la zona del atleta.
    if (geo.approximate) return "";
    const { temp, humidity, intensity } = weather;
    if (intensity === "warning") return "Calor extremo (" + temp + "C, " + humidity + "% hum) - reduce ritmo 15-20% y prioriza hidratacion.";
    if (intensity === "caution") return "Clima calido (" + temp + "C, " + humidity + "% hum) - reduce ritmo 8-12% y lleva agua extra.";
    if (humidity >= 85) return "Humedad alta (" + humidity + "%) - ajusta esfuerzo percibido.";
    return "";
  };

  return { weather, geo, retry, getWorkoutWeatherNote };
}