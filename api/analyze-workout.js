const MODELS = [
  "claude-sonnet-4-6",
  "claude-opus-4-6", 
  "claude-haiku-4-5-20251001",
];

export default async function handler(req, res) {
  if (req.method !== "POST") return res.status(405).end();

  const { workout, athleteName, vdot, recentWorkouts } = req.body || {};
  if (!workout) return res.status(400).json({ error: "No workout data" });

  const apiKey = process.env.ANTHROPIC_API_KEY;
  if (!apiKey) return res.status(500).json({ error: "ANTHROPIC_API_KEY no configurada" });

  const prompt = `Eres un coach de running experto. Analiza este entrenamiento de ${athleteName || "el atleta"} (VDOT ${vdot || "N/A"}) y da retroalimentación concisa en español.

Datos del entrenamiento:
${JSON.stringify(workout, null, 2)}

${recentWorkouts?.length ? `Últimos entrenamientos:\n${JSON.stringify(recentWorkouts, null, 2)}` : ""}

Responde en máximo 4 párrafos cortos:
1. Resumen del rendimiento
2. Puntos positivos
3. Áreas de mejora
4. Recomendación para el próximo entrenamiento`;

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