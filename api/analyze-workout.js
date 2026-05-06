import Anthropic from "@anthropic-ai/sdk";

export default async function handler(req, res) {
  if (req.method !== "POST") return res.status(405).json({ error: "Method not allowed" });

  const { workout, recentWorkouts, athleteName } = req.body || {};
  if (!workout) return res.status(400).json({ error: "Missing workout data" });

  const client = new Anthropic({ apiKey: process.env.ANTHROPIC_API_KEY });

  const recentSummary = (recentWorkouts || []).slice(0, 5).map((w, i) =>
    `- ${w.scheduled_date}: ${w.title} | ${w.total_km || 0}km | ${w.duration_min || 0}min | RPE: ${w.rpe || "N/A"} | FC prom: ${w.manual_avg_hr || "N/A"}`
  ).join("\n");

  const prompt = `Eres un coach de running experto. Analiza este entrenamiento completado por ${athleteName || "el atleta"} y da retroalimentación en español, concisa y motivadora (máximo 150 palabras).

ENTRENAMIENTO ACTUAL:
- Tipo: ${workout.type || "N/A"}
- Título: ${workout.title || "N/A"}
- Fecha: ${workout.scheduled_date || "N/A"}
- Distancia objetivo: ${workout.total_km || 0} km
- Distancia real: ${workout.manual_distance_km || workout.total_km || 0} km
- Duración: ${workout.manual_duration_min || workout.duration_min || 0} min
- RPE: ${workout.rpe || "N/A"}/10
- FC promedio: ${workout.manual_avg_hr || "N/A"} lpm
- FC máxima: ${workout.manual_max_hr || "N/A"} lpm
- Calorías: ${workout.manual_calories || "N/A"}
- Notas del atleta: ${workout.athlete_notes || "Sin notas"}

ÚLTIMOS ENTRENAMIENTOS:
${recentSummary || "Sin historial reciente"}

Da un análisis breve con: 1) qué salió bien, 2) qué mejorar, 3) recomendación para el siguiente entrenamiento. Usa emojis y tono motivador.`;

  try {
    const message = await client.messages.create({
      model: "claude-sonnet-4-20250514",
      max_tokens: 400,
      messages: [{ role: "user", content: prompt }],
    });
    const analysis = message.content?.[0]?.text || "No se pudo generar el análisis.";
    return res.status(200).json({ analysis });
  } catch (e) {
    console.error("[analyze-workout]", e);
    return res.status(500).json({ error: "Error generando análisis" });
  }
}
