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
      console.warn(`callClaude: model ${model} failed:`, JSON.stringify(data).slice(0, 300));
    } catch (err) {
      console.warn(`callClaude: model ${model} exception:`, err?.message);
    }
  }
  return null;
}

/** Intenta extraer el JSON del texto de Claude de múltiples formas */
function extractJson(text) {
  if (!text) return null;

  // 1. Intento directo
  try { return JSON.parse(text.trim()); } catch {}

  // 2. Quitar bloques markdown ```json ... ```
  const clean1 = text.replace(/```json\s*/gi, "").replace(/```\s*/g, "").trim();
  try { return JSON.parse(clean1); } catch {}

  // 3. Extraer primer bloque { ... } del texto
  const match = text.match(/\{[\s\S]*\}/);
  if (match) {
    try { return JSON.parse(match[0]); } catch {}
  }

  // 4. Quitar comentarios JS y limpiar
  const clean2 = clean1
    .replace(/\/\/[^\n]*/g, "")
    .replace(/\/\*[\s\S]*?\*\//g, "")
    .trim();
  try { return JSON.parse(clean2); } catch {}

  return null;
}

export default async function handler(req, res) {
  if (req.method !== "POST") return res.status(405).end();

  const apiKey = process.env.ANTHROPIC_API_KEY;
  if (!apiKey) return res.status(500).json({ error: "ANTHROPIC_API_KEY no configurada" });

  const {
    action = "analyze",
    workout,
    athleteName,
    vdot,
    recentWorkouts,
    role,
    futureWorkouts,
  } = req.body || {};

  // ── ACTION: analyze ──────────────────────────────────────────
  if (action === "analyze") {
    if (!workout) return res.status(400).json({ error: "No workout data" });

    const isCoach = role === "coach";
    const recentContext =
      Array.isArray(recentWorkouts) && recentWorkouts.length > 0
        ? `\nÚltimos ${recentWorkouts.length} entrenamientos completados:\n${recentWorkouts
            .map((w, i) =>
              `${i + 1}. ${w.title || w.type} — ${w.total_km || 0}km, ${w.duration_min || 0}min, RPE ${w.rpe ?? "N/R"}, FC prom ${w.manual_avg_hr ?? "N/R"}`
            )
            .join("\n")}`
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

Responde en español con 4 secciones cortas (sin markdown, sin asteriscos, sin tablas):
1. Rendimiento — ¿Ejecutó bien el workout según el objetivo?
2. Señales fisiológicas — ¿Qué indican RPE y FC sobre su estado?
3. Tendencia — Basado en los entrenamientos recientes, ¿está progresando, estancado o acumulando fatiga?
4. Ajuste recomendado — ¿Qué ajustar en los próximos 2-3 entrenamientos? (respuesta en texto plano, no tabla)`
      : `Eres un coach de running experto. Analiza este entrenamiento de ${athleteName || "el atleta"} (VDOT ${vdot || "N/A"}) y da retroalimentación motivadora en español.

Datos:
- ${workout.title || workout.type} — ${workout.manual_distance_km ?? workout.total_km ?? "N/A"} km, ${workout.manual_duration_min ?? workout.duration_min ?? "N/A"} min
- RPE: ${workout.rpe ?? "N/R"} | FC prom: ${workout.manual_avg_hr ?? "N/R"} lpm
- Notas: ${workout.athlete_notes || "Sin notas"}
${recentContext}

Responde en 3 párrafos cortos (sin markdown, sin asteriscos):
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

    const recentContext =
      Array.isArray(recentWorkouts) && recentWorkouts.length > 0
        ? `\nÚltimos entrenamientos:\n${recentWorkouts
            .map((w, i) =>
              `${i + 1}. ${w.title || w.type} — ${w.total_km || 0}km, RPE ${w.rpe ?? "N/R"}, FC ${w.manual_avg_hr ?? "N/R"}`
            )
            .join("\n")}`
        : "";

    const futureContext = futureWorkouts
      .map((w) =>
        `ID:${w.id} | ${w.scheduled_date} | ${w.type} | "${w.title}" | ${w.total_km}km | ${w.duration_min}min`
      )
      .join("\n");

    const prompt = `Eres un coach de running experto. Analiza el último entrenamiento completado y ajusta los próximos workouts del atleta ${athleteName || ""} (VDOT ${vdot || "N/A"}).

ÚLTIMO ENTRENAMIENTO COMPLETADO:
- Tipo: ${workout.type} | Título: ${workout.title}
- Distancia real: ${workout.manual_distance_km ?? workout.total_km ?? "N/A"} km
- Duración real: ${workout.manual_duration_min ?? workout.duration_min ?? "N/A"} min
- RPE: ${workout.rpe ?? "N/R"} / 10
- FC promedio: ${workout.manual_avg_hr ?? "N/R"} lpm
- FC máxima: ${workout.manual_max_hr ?? "N/R"} lpm
- Notas: ${workout.athlete_notes || "Sin notas"}
${recentContext}

PRÓXIMOS ENTRENAMIENTOS:
${futureContext}

REGLAS:
- RPE >= 8 → reducir km y duration_min 10-15% en próximos 2 workouts; cambiar interval/tempo a recovery
- RPE <= 3 → aumentar km y duration_min 5-10% en siguiente workout similar
- 3+ workouts con RPE >= 7 → reducir semana siguiente 25-30%
- FC alta + RPE bajo → solo nota de alerta, no cambiar carga
- RPE 5-7 y FC normal → no cambiar o ajustes mínimos

IMPORTANTE: Responde ÚNICAMENTE con el siguiente JSON, sin texto antes ni después, sin comentarios, sin markdown:
{"signal":"bien","summary":"texto explicación","adjustments":[{"workout_id":"ID","changes":{"total_km":null,"duration_min":null,"type":null,"description":null},"reason":"razón"}]}

Si no hay cambios necesarios: {"signal":"bien","summary":"El atleta está en buen estado, no se requieren ajustes.","adjustments":[]}

Los valores de signal válidos son exactamente: fatiga_alta, fatiga_media, bien, descarga_necesaria, puede_progresar`;

    const result = await callClaude(apiKey, prompt, 1500);
    if (!result) return res.status(500).json({ error: "Todos los modelos fallaron." });

    console.log("adjust raw response:", result.text.slice(0, 500));

    const parsed = extractJson(result.text);

    if (!parsed) {
      console.error("adjust: no se pudo parsear JSON. Raw:", result.text.slice(0, 800));
      // Fallback: retornar respuesta segura en lugar de 500
      return res.status(200).json({
        signal: "bien",
        summary: "No se pudo procesar la respuesta de IA. Intenta de nuevo.",
        adjustments: [],
        model: result.model,
        parse_error: true,
      });
    }

    // Validar estructura mínima
    const safe = {
      signal: parsed.signal || "bien",
      summary: parsed.summary || "Análisis completado.",
      adjustments: Array.isArray(parsed.adjustments) ? parsed.adjustments : [],
      model: result.model,
    };

    return res.status(200).json(safe);
  }

  return res.status(400).json({ error: "action debe ser 'analyze' o 'adjust'" });
}
