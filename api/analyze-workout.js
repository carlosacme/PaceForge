const MODELS = [
  "claude-sonnet-4-6",
  "claude-opus-4-6",
  "claude-haiku-4-5-20251001",
];

async function callClaude(apiKey, prompt, maxTokens = 800) {
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
          max_tokens: maxTokens,
          messages: [{ role: "user", content: prompt }],
        }),
      });
      const data = await response.json();
      if (response.ok && data.content?.[0]?.text) {
        return { text: data.content[0].text, model };
      }
      console.warn(`callClaude: model ${model} failed:`, data);
    } catch (err) {
      console.warn(`callClaude: model ${model} exception:`, err?.message);
    }
  }
  return null;
}

export default async function handler(req, res) {
  if (req.method !== "POST") return res.status(405).end();

  const apiKey = process.env.ANTHROPIC_API_KEY;
  if (!apiKey) return res.status(500).json({ error: "ANTHROPIC_API_KEY no configurada" });

  const { action = "analyze", workout, athleteName, vdot, recentWorkouts, role, futureWorkouts } = req.body || {};

  // ── ACTION: analyze ──────────────────────────────────────────
  if (action === "analyze") {
    if (!workout) return res.status(400).json({ error: "No workout data" });

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

Responde en español con 4 secciones cortas:
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
2. Cómo estás progresando
3. Consejo para el próximo entrenamiento`;

    const result = await callClaude(apiKey, prompt);
    if (!result) return res.status(500).json({ error: "Todos los modelos fallaron." });
    return res.status(200).json({ analysis: result.text, model: result.model });
  }

  // ── ACTION: adjust ───────────────────────────────────────────
  if (action === "adjust") {
    if (!workout || !Array.isArray(futureWorkouts) || futureWorkouts.length === 0) {
      return res.status(400).json({ error: "Faltan workout completado o entrenamientos futuros" });
    }

    const recentContext = Array.isArray(recentWorkouts) && recentWorkouts.length > 0
      ? `\nÚltimos entrenamientos:\n${recentWorkouts.map((w, i) =>
          `${i + 1}. ${w.title || w.type} — ${w.total_km || 0}km, RPE ${w.rpe ?? "N/R"}, FC ${w.manual_avg_hr ?? "N/R"}`
        ).join("\n")}`
      : "";

    const futureContext = futureWorkouts.map((w, i) =>
      `ID:${w.id} | ${w.scheduled_date} | ${w.type} | "${w.title}" | ${w.total_km}km | ${w.duration_min}min`
    ).join("\n");

    const prompt = `Eres un coach de running experto. Basado en el último entrenamiento completado, ajusta los próximos workouts del atleta ${athleteName || ""} (VDOT ${vdot || "N/A"}).

ÚLTIMO ENTRENAMIENTO COMPLETADO:
- Tipo: ${workout.type} | Título: ${workout.title}
- Distancia real: ${workout.manual_distance_km ?? workout.total_km ?? "N/A"} km
- Duración real: ${workout.manual_duration_min ?? workout.duration_min ?? "N/A"} min
- RPE: ${workout.rpe ?? "N/R"} / 10
- FC promedio: ${workout.manual_avg_hr ?? "N/R"} lpm
- FC máxima: ${workout.manual_max_hr ?? "N/R"} lpm
- Notas: ${workout.athlete_notes || "Sin notas"}
${recentContext}

PRÓXIMOS ENTRENAMIENTOS A AJUSTAR:
${futureContext}

REGLAS DE AJUSTE:
- RPE >= 8 o FC > 90% de lo esperado → reducir km y duration_min 10-15% en los próximos 2 workouts; si el siguiente es interval o tempo, cambiar tipo a "recovery"
- RPE <= 3 (muy fácil) → aumentar km y duration_min 5-10% en el siguiente workout similar
- 3+ workouts seguidos con RPE >= 7 → reducir TODOS los workouts de la semana siguiente 25-30% (semana de descarga)
- FC alta con RPE bajo → solo agregar nota de alerta, no cambiar carga
- Si el atleta está bien (RPE 5-7, FC normal) → no cambiar nada o ajustes menores

Responde SOLO con JSON válido, sin texto adicional, con esta estructura exacta:
{
  "signal": "fatiga_alta" | "fatiga_media" | "bien" | "descarga_necesaria" | "puede_progresar",
  "summary": "Explicación breve en español de qué detectaste y por qué ajustas",
  "adjustments": [
    {
      "workout_id": "ID del workout",
      "changes": {
        "total_km": número o null,
        "duration_min": número o null,
        "type": "tipo nuevo" o null,
        "description": "nota adicional para el atleta" o null
      },
      "reason": "Por qué este ajuste específico"
    }
  ]
}

Solo incluye en "adjustments" los workouts que realmente necesitan cambio. Si ninguno necesita cambio, devuelve "adjustments": [].`;

    const result = await callClaude(apiKey, prompt, 1200);
    if (!result) return res.status(500).json({ error: "Todos los modelos fallaron." });

    try {
      const clean = result.text.replace(/```json|```/g, "").trim();
      const parsed = JSON.parse(clean);
      return res.status(200).json({ ...parsed, model: result.model });
    } catch (e) {
      console.error("adjust-plan JSON parse error:", e, result.text);
      return res.status(500).json({ error: "Error procesando respuesta de IA", raw: result.text });
    }
  }

  return res.status(400).json({ error: "action debe ser 'analyze' o 'adjust'" });
}