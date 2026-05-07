import { useState, useEffect } from "react";

const INTENSITY_STYLES = {
  normal: { bg: "rgba(34,197,94,.1)", border: "rgba(34,197,94,.4)", color: "#166534", icon: "OK" },
  caution: { bg: "rgba(245,158,11,.1)", border: "rgba(245,158,11,.4)", color: "#92400e", icon: "!" },
  warning: { bg: "rgba(239,68,68,.1)", border: "rgba(239,68,68,.4)", color: "#991b1b", icon: "!!" },
};

export default function WeatherWidget({ defaultCity = "Bogota,CO", compact = false }) {
  const [weather, setWeather] = useState(null);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState("");

  useEffect(() => {
    let cancelled = false;
    const fetchWeather = async (lat, lon) => {
      try {
        const params = lat && lon
          ? "lat=" + lat + "&lon=" + lon
          : "city=" + encodeURIComponent(defaultCity);
        const res = await fetch("/api/weather?" + params);
        const data = await res.json();
        if (cancelled) return;
        if (!res.ok) { setError("No se pudo obtener el clima"); return; }
        setWeather(data);
      } catch (e) {
        if (!cancelled) setError("Error de red");
      } finally {
        if (!cancelled) setLoading(false);
      }
    };

    if (typeof navigator !== "undefined" && navigator.geolocation) {
      navigator.geolocation.getCurrentPosition(
        (pos) => fetchWeather(pos.coords.latitude, pos.coords.longitude),
        () => fetchWeather(null, null),
        { timeout: 5000 }
      );
    } else {
      fetchWeather(null, null);
    }
    return () => { cancelled = true; };
  }, [defaultCity]);

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
            {weather.city} - {weather.temp}C - {weather.humidity}% hum
          </div>
          <div style={{ fontSize: ".72em", color: st.color, marginTop: 2, lineHeight: 1.4 }}>
            {st.icon} {weather.advice}
          </div>
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
            {weather.city}
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
    </div>
  );
}

export function useWeather(defaultCity = "Bogota,CO") {
  const [weather, setWeather] = useState(null);

  useEffect(() => {
    let cancelled = false;
    const fetchWeather = async (lat, lon) => {
      try {
        const params = lat && lon
          ? "lat=" + lat + "&lon=" + lon
          : "city=" + encodeURIComponent(defaultCity);
        const res = await fetch("/api/weather?" + params);
        if (!res.ok) return;
        const data = await res.json();
        if (!cancelled) setWeather(data);
      } catch (e) {
        console.error("useWeather error:", e);
      }
    };

    if (typeof navigator !== "undefined" && navigator.geolocation) {
      navigator.geolocation.getCurrentPosition(
        (pos) => fetchWeather(pos.coords.latitude, pos.coords.longitude),
        () => fetchWeather(null, null),
        { timeout: 5000 }
      );
    } else {
      fetchWeather(null, null);
    }
    return () => { cancelled = true; };
  }, [defaultCity]);

  const getWorkoutWeatherNote = () => {
    if (!weather) return "";
    const { temp, humidity, intensity } = weather;
    if (intensity === "warning") return "Calor extremo (" + temp + "C, " + humidity + "% hum) - reduce ritmo 15-20% y prioriza hidratacion.";
    if (intensity === "caution") return "Clima calido (" + temp + "C, " + humidity + "% hum) - reduce ritmo 8-12% y lleva agua extra.";
    if (humidity >= 85) return "Humedad alta (" + humidity + "%) - ajusta esfuerzo percibido.";
    return "";
  };

  return { weather, getWorkoutWeatherNote };
}