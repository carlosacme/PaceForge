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

    // Consejo de running adaptado a clima tropical LATAM
    let advice = "";
    let intensity = "normal"; // normal | caution | warning

    if (temp >= 35) {
      advice = "Calor extremo. Evita correr entre 10am-5pm. Hidratación cada 15 min, reduce ritmo 15-20%.";
      intensity = "warning";
    } else if (temp >= 30) {
      advice = "Calor alto. Hidratación extra cada 20 min. Reduce ritmo 8-12% y prefiere zonas con sombra.";
      intensity = "caution";
    } else if (temp >= 25) {
      advice = "Clima cálido típico tropical. Hidratación constante. Ritmo normal con percepción de esfuerzo.";
      intensity = "normal";
    } else if (temp >= 18) {
      advice = "Condiciones ideales para correr. Aprovecha el entrenamiento.";
      intensity = "normal";
    } else if (temp < 10) {
      advice = "Frío inusual. Calienta 10 min extra y usa capas livianas.";
      intensity = "caution";
    } else {
      advice = "Buenas condiciones. Entrena según plan.";
      intensity = "normal";
    }

    if (humidity >= 85 && intensity !== "warning") {
      advice += " Humedad muy alta — el sudor no enfría bien, reduce esfuerzo adicional 5%.";
      intensity = intensity === "normal" ? "caution" : intensity;
    }

    const rainCodes = [200,201,202,210,211,212,221,230,231,232,300,301,302,310,311,312,313,314,321,500,501,502,503,504,511,520,521,522,531];
    const weatherId = data.weather?.[0]?.id;
    if (rainCodes.includes(weatherId)) {
      advice += " Lluvia detectada — superficies resbaladizas, cuidado en curvas y descensos.";
    }

    return res.status(200).json({
      // Devolvemos las coordenadas consultadas, NO el data.name de OpenWeather
      // (en zonas como Bahía Málaga/Pacífico devuelve una localidad lejana).
      lat: latNum,
      lon: lonNum,
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