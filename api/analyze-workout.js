const MODELS = [
  "claude-sonnet-4-6",
  "claude-opus-4-6",
  "claude-haiku-4-5-20251001",
];

export default async function handler(req, res) {
  if (req.method !== "POST") return res.status(405).end();

  const { workout, athleteName, vdot, recentWorkouts, role } = req.body || {};
  if (!workout) return res.status(400).json({ error: "No workout data" });

  const apiKey = process.env.ANTHROPIC_API_KEY;
  if (!apiKey) return res.status(500).json({ error: "ANTHROPIC_API_KEY no configurada" });

  const isCoach = role === "coach";

  const recentContext = Array.isArray(recentWorkouts) && recentWorkouts.length > 0
    ? `\nÚltimos ${recentWorkouts.length} entrenamientos completados:\n${recentWorkouts.map((w, i) =>
        `${i + 1}. ${w.title || w.type} — ${w.total_km || 0}km, ${w.duration_min || 0}min, RPE ${w.rpe ?? "N/R"}, FC prom ${w.manual_avg_hr ?? "N/R"}`
      ).join("\n")}`
    : "";

  const prompt = isCoach
    ? `Eres un coach de running experto analizando el entrenamiento de ${athleteName || "tu atleta"} (VDOT ${vdot || "N/A"}).

Workout analizado:
- Tipo: ${workout.type || "N/A"}
- Título: ${workout.title || "N/A"}
- Distancia: ${workout.manual_distance_km ?? workout.total_km ?? "N/A"} km
- Duración: ${workout.manual_duration_min ?? workout.duration_min ?? "N/A"} min
- RPE registrado: ${workout.rpe ?? "N/R"}
- FC promedio: ${workout.manual_avg_hr ?? "N/R"} lpm
- FC máxima: ${workout.manual_max_hr ?? "N/R"} lpm
- Notas del atleta: ${workout.athlete_notes || "Sin notas"}
${recentContext}

Como coach, responde en español con 4 secciones cortas:
1. **Rendimiento** — ¿Ejecutó bien el workout según el objetivo?
2. **Señales fisiológicas** — ¿Qué indican RPE y FC sobre su estado?
3. **Tendencia** — Basado en los entrenamientos recientes, ¿está progresando, estancado o acumulando fatiga?
4. **Ajuste recomendado** — ¿Qué ajustar en los próximos 2-3 entrenamientos?`
    : `Eres un coach de running experto. Analiza este entrenamiento de ${athleteName || "el atleta"} (VDOT ${vdot || "N/A"}) y da retroalimentación motivadora en español.

Datos:
- ${workout.title || workout.type} — ${workout.manual_distance_km ?? workout.total_km ?? "N/A"} km, ${workout.manual_duration_min ?? workout.duration_min ?? "N/A"} min
- RPE: ${workout.rpe ?? "N/R"} | FC prom: ${workout.manual_avg_hr ?? "N/R"} lpm
- Notas: ${workout.athlete_notes || "Sin notas"}
${recentContext}

Responde en 3 párrafos cortos:
1. Qué hiciste bien hoy
2. Cómo te estás progresando
3. Consejo para el próximo entrenamiento`;

  for (const model of MODELS) {
    try {
      const response = await fetch("https://api.anthropic.com/v1/messages", {
        method: "POST",
        headers: {
          "Content-Type": "application/json",
          "x-api-key": apiKey,
          "anthropic-version": "2023-06-01",
        },
        body: JSON.stringify({
          model,
          max_tokens: 800,
          messages: [{ role: "user", content: prompt }],
        }),
      });

      const data = await response.json();
      if (response.ok && data.content?.[0]?.text) {
        return res.status(200).json({ analysis: data.content[0].text, model });
      }
      console.warn(`analyze-workout: model ${model} failed:`, data);
    } catch (err) {
      console.warn(`analyze-workout: model ${model} exception:`, err?.message);
    }
  }

  return res.status(500).json({ error: "Todos los modelos fallaron. Intenta de nuevo." });
}