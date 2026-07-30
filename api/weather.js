// Distancia entre dos coordenadas en km (Haversine)
function distanceKm(lat1, lon1, lat2, lon2) {
  const R = 6371;
  const toRad = (d) => (d * Math.PI) / 180;
  const dLat = toRad(lat2 - lat1);
  const dLon = toRad(lon2 - lon1);
  const a =
    Math.sin(dLat / 2) ** 2 +
    Math.cos(toRad(lat1)) * Math.cos(toRad(lat2)) * Math.sin(dLon / 2) ** 2;
  return 2 * R * Math.asin(Math.sqrt(a));
}

export default async function handler(req, res) {
  if (req.method !== "GET") return res.status(405).end();

  const { lat, lon } = req.query;
  const apiKey = process.env.OPENWEATHER_API_KEY;
  if (!apiKey) return res.status(500).json({ error: "OPENWEATHER_API_KEY no configurada" });

  const latNum = Number(lat);
  const lonNum = Number(lon);
  if (!Number.isFinite(latNum) || !Number.isFinite(lonNum)) {
    return res.status(400).json({ error: "Indica lat y lon válidos" });
  }

  try {
    // Clima SIEMPRE por coordenadas (nunca por nombre de ciudad)
    const url = `https://api.openweathermap.org/data/2.5/weather?lat=${latNum}&lon=${lonNum}&units=metric&lang=es&appid=${apiKey}`;

    const response = await fetch(url);
    const data = await response.json();
    if (!response.ok) return res.status(response.status).json(data);

    const temp = Math.round(data.main.temp);
    const feelsLike = Math.round(data.main.feels_like);
    const humidity = data.main.humidity;
    const description = data.weather?.[0]?.description || "";
    const icon = data.weather?.[0]?.icon || "";
    const windSpeed = Math.round((data.wind?.speed || 0) * 3.6); // m/s → km/h

    // Consejo de running adaptado a clima tropical LATAM.
    // Driver principal: feels_like (sensacion termica), no temp del aire.
    // En el tropico humedo la sensacion supera la temperatura real y es lo
    // que determina el riesgo de calor para el corredor.
    let advice = "";
    let intensity = "normal"; // normal | caution | warning
    if (feelsLike >= 40) {
      advice = "Sensación de calor extremo. Evita correr entre 10am-5pm. Hidratación cada 15 min, reduce ritmo 15-20%.";
      intensity = "warning";
    } else if (feelsLike >= 33) {
      advice = "Sensación de calor alto. Hidratación extra cada 20 min. Reduce ritmo 8-12% y prefiere zonas con sombra.";
      intensity = "caution";
    } else if (feelsLike >= 27) {
      advice = "Clima cálido típico tropical. Hidratación constante. Ritmo normal con percepción de esfuerzo.";
      intensity = "normal";
    } else if (feelsLike >= 18) {
      advice = "Condiciones ideales para correr. Aprovecha el entrenamiento.";
      intensity = "normal";
    } else if (feelsLike < 10) {
      advice = "Frío inusual. Calienta 10 min extra y usa capas livianas.";
      intensity = "caution";
    } else {
      advice = "Buenas condiciones. Entrena según plan.";
      intensity = "normal";
    }
    // La humedad ya influye en feels_like, pero >=85% agrava la evaporacion
    // del sudor: refuerzo adicional cuando aun no estamos en warning.
    if (humidity >= 85 && intensity !== "warning") {
      advice += " Humedad muy alta — el sudor no enfría bien, reduce esfuerzo adicional 5%.";
      intensity = intensity === "normal" ? "caution" : intensity;
    }

    const rainCodes = [200,201,202,210,211,212,221,230,231,232,300,301,302,310,311,312,313,314,321,500,501,502,503,504,511,520,521,522,531];
    const weatherId = data.weather?.[0]?.id;
    if (rainCodes.includes(weatherId)) {
      advice += " Lluvia detectada — superficies resbaladizas, cuidado en curvas y descensos.";
    }

    // --- Reverse geocoding: nombre del lugar más cercano ---
    // OpenStreetMap/Nominatim (gratis, con cobertura de veredas/corregimientos en Colombia,
    // a diferencia del campo "name" de OpenWeather que devuelve localidades lejanas).
    let placeName = null;
    let placeDistanceKm = null;
    try {
      const geoUrl =
        "https://nominatim.openstreetmap.org/reverse?format=jsonv2" +
        `&lat=${latNum}&lon=${lonNum}&zoom=14&addressdetails=1&accept-language=es`;
      const geoRes = await fetch(geoUrl, {
        headers: {
          // Nominatim exige identificar la app en el User-Agent
          "User-Agent": "RunningApexFlow/1.0 (https://www.runningapexflow.com)",
        },
      });
      if (geoRes.ok) {
        const geo = await geoRes.json();
        const a = geo.address || {};
        // De más específico (vereda/pueblo) a más general (ciudad)
        placeName =
          a.village || a.hamlet || a.locality || a.suburb || a.neighbourhood ||
          a.town || a.city || a.municipality || a.county || null;
        if (geo.lat && geo.lon) {
          placeDistanceKm = distanceKm(latNum, lonNum, Number(geo.lat), Number(geo.lon));
        }
      }
    } catch (e) {
      console.warn("[weather] reverse geocoding falló:", e.message);
    }

    return res.status(200).json({
      // Devolvemos las coordenadas consultadas, NO el data.name de OpenWeather
      // (en zonas como Bahía Málaga/Pacífico devuelve una localidad lejana).
      lat: latNum,
      lon: lonNum,
      placeName,          // <-- nuevo
      placeDistanceKm,    // <-- nuevo
      temp,
      feelsLike,
      humidity,
      description,
      icon,
      windSpeed,
      advice,
      intensity,
    });
  } catch (err) {
    console.error("weather error:", err);
    return res.status(500).json({ error: err?.message || "Error obteniendo clima" });
  }
}