import { requireUser, getWorkoutIfAllowed, jsonError } from "../lib/apiAuth.js";
import { readStructure } from "../src/lib/workoutStructure.js";

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

  // Todas las acciones consumen cuota de Anthropic: exige identidad.
  const user = await requireUser(req);
  if (!user) return jsonError(res, 401, "No autenticado");

  // ── BRIEFING MODE ──────────────────────────────────────────
  const { prompt: briefingPrompt, mode } = req.body || {};
  if (mode === "briefing" && briefingPrompt) {
    const result = await callClaude(apiKey, briefingPrompt, 300);
    if (!result) return res.status(500).json({ error: "No se pudo generar el briefing" });
    return res.status(200).json({ analysis: result.text });
  }

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

    // Valores efectivos de lo EJECUTADO, priorizando reloj > manual > plan.
    const hasWatch = !!workout.actual_synced_at;
    const realDist = workout.actual_distance_km ?? workout.manual_distance_km ?? null;
    const realDur  = workout.actual_duration_min ?? workout.manual_duration_min ?? null;
    const realHrAvg = workout.actual_avg_hr ?? workout.manual_avg_hr ?? null;
    const realHrMax = workout.actual_max_hr ?? workout.manual_max_hr ?? null;
    const paceS = workout.actual_avg_pace_s ?? null;
    const paceStr = paceS ? `${Math.floor(paceS/60)}:${String(paceS%60).padStart(2,"0")}/km` : null;
    const fuente = hasWatch ? "datos reales del reloj (Garmin/COROS)" : "datos ingresados manualmente";

    const recentContext =
      Array.isArray(recentWorkouts) && recentWorkouts.length > 0
        ? `\nÚltimos ${recentWorkouts.length} entrenamientos completados:\n${recentWorkouts
            .map((w, i) =>
              `${i + 1}. ${w.title || w.type} — ${w.actual_distance_km ?? w.manual_distance_km ?? w.total_km ?? 0}km, ${w.actual_duration_min ?? w.manual_duration_min ?? w.duration_min ?? 0}min, RPE ${w.rpe ?? "N/R"}, FC prom ${w.actual_avg_hr ?? w.manual_avg_hr ?? "N/R"}`
            )
            .join("\n")}`
        : "";

    const prompt = isCoach
      ? `Eres un coach de running experto analizando el entrenamiento de ${athleteName || "tu atleta"} (VDOT ${vdot || "N/A"}).

PLANIFICADO:
- Distancia: ${workout.total_km ?? "N/A"} km
- Duración: ${workout.duration_min ?? "N/A"} min
- Tipo: ${workout.type ?? "N/A"}
- Título: ${workout.title ?? "N/A"}

EJECUTADO (${fuente}):
- Distancia: ${realDist ?? "N/R"} km
- Duración: ${realDur ?? "N/R"} min
- Ritmo medio: ${paceStr ?? "N/R"}
- FC promedio/máxima: ${realHrAvg ?? "N/R"} / ${realHrMax ?? "N/R"} lpm
- Desnivel: ${workout.actual_elevation_m ?? "N/R"} m
- RPE: ${workout.rpe ?? "N/R"}
- Sensación: ${workout.feeling ?? workout.athlete_notes ?? "N/R"}
${recentContext}

Responde en español con 4 secciones cortas (sin markdown, sin asteriscos, sin tablas):
1. Rendimiento — Compara lo EJECUTADO contra lo PLANIFICADO (distancia completada, ritmo real vs objetivo, duración). ¿Cumplió el objetivo del workout?
2. Señales fisiológicas — ¿Qué indican RPE, FC y ritmo sobre su estado?
3. Tendencia — Basado en los entrenamientos recientes, ¿está progresando, estancado o acumulando fatiga?
4. Ajuste recomendado — ¿Qué ajustar en los próximos 2-3 entrenamientos? (respuesta en texto plano, no tabla)`
      : `Eres un coach de running experto. Analiza este entrenamiento de ${athleteName || "el atleta"} (VDOT ${vdot || "N/A"}) y da retroalimentación motivadora en español.

PLANIFICADO: ${workout.total_km ?? "N/A"} km, ${workout.duration_min ?? "N/A"} min (${workout.type ?? "N/A"})
EJECUTADO (${fuente}): ${realDist ?? "N/R"} km, ${realDur ?? "N/R"} min, ritmo ${paceStr ?? "N/R"}, FC prom/máx ${realHrAvg ?? "N/R"}/${realHrMax ?? "N/R"} lpm
RPE: ${workout.rpe ?? "N/R"} | Sensación: ${workout.feeling ?? workout.athlete_notes ?? "N/R"}
${recentContext}

Responde en 3 párrafos cortos (sin markdown, sin asteriscos):
1. Qué hiciste bien hoy (compara lo que hiciste con lo planificado)
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

REGLAS DE AJUSTE (respeta la periodización y el propósito de cada sesión):

Primero clasifica el nivel de fatiga según RPE, FC y notas:
- Fatiga leve/normal: RPE 5-7, FC normal, sin quejas → ajustes mínimos o ninguno
- Fatiga media: RPE 7-8, o FC elevada con sensación de cansancio
- Fatiga alta: RPE >= 9, o 3+ workouts recientes con RPE >= 7, o nota explícita de agotamiento/dolor

Según el TIPO de cada workout futuro, ajusta así:

INTERVALOS / FARTLEK / SERIES (interval, fartlek):
- Fatiga media → MANTÉN el tipo (no cambies a recovery). Reduce el volumen: baja total_km y duration_min 10-15%. La idea es menos repeticiones pero conservar el estímulo de velocidad/VO2max.
- Fatiga alta → reduce duration_min y total_km 20-25% manteniendo el tipo, O si la fatiga es severa (RPE>=9 o dolor), entonces sí convierte a recovery.
- No elimines el trabajo de calidad por fatiga moderada; el atleta perdería adaptaciones.

TEMPO / UMBRAL (tempo):
- Fatiga media → mantén tipo tempo, reduce duración del bloque 10-15% o reduce ligeramente el ritmo objetivo.
- Fatiga alta → reduce 20% o convierte a easy si es severa.

RODAJES / LARGOS (easy, long, recovery, progression):
- Fatiga media → reduce total_km y duration_min 10-15%, mantén el tipo.
- Fatiga alta → reduce 20-25%, mantén el tipo (un largo cansado se acorta, no se elimina).

RECUPERACIÓN A PROGRESIÓN:
- RPE <= 3 y FC baja → el atleta puede progresar: aumenta total_km y duration_min 5-10% en el siguiente workout similar (signal: puede_progresar).

Solo usa signal "descarga_necesaria" cuando detectes fatiga alta sostenida (3+ sesiones duras seguidas) — en ese caso reduce TODA la semana siguiente 25-30%.

En cada adjustment incluye un campo "title" descriptivo coherente con el ajuste: si reduces un intervalo mantén el formato de intervalo (ej. "Intervalos 5x800m" en vez de 6x800m), si reduces un largo ajusta los km (ej. "Largo 16km"), etc. NO cambies el nombre a "rodaje suave" salvo que realmente conviertas a recovery por fatiga severa.

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

  if (action === "adjust-steps") {
    const { workout_id, isSimple, finalType, finalKm, finalDuration, originalKm, originalDuration, description, title } = req.body;

    const owned = await getWorkoutIfAllowed(user.id, workout_id);
    if (!owned) return jsonError(res, 403, "Sin acceso a ese workout");

    const supabaseUrl = process.env.SUPABASE_URL;
    const serviceKey = process.env.SUPABASE_SERVICE_ROLE_KEY;
    const h = { "apikey": serviceKey, "Authorization": `Bearer ${serviceKey}`, "Content-Type": "application/json", "Prefer": "return=minimal" };

    // Obtener structure actual
    const getRes = await fetch(`${supabaseUrl}/rest/v1/workouts?id=eq.${workout_id}&select=structure,workout_structure,duration_min,total_km`, { headers: h });
    const rows = await getRes.json();
    const currentStructure = readStructure(rows?.[0]);
    const origDuration = originalDuration || rows?.[0]?.duration_min || 30;
    const origKm = originalKm || rows?.[0]?.total_km || 0;

    let newStructure;

    if (isSimple) {
      // 1 solo paso simple
      newStructure = [{
        block_type: title || "Bloque principal",
        duration_min: `${finalDuration} min`,
        target_pace: finalType === "recovery" ? "Muy suave, ritmo de recuperación" : finalType === "easy" ? "Ritmo conversacional suave" : finalType === "long" ? "Ritmo aeróbico base" : "Ritmo tempo",
        target_hr: finalType === "recovery" ? "Z1" : finalType === "easy" ? "Z2" : finalType === "long" ? "Z2-Z3" : "Z3-Z4",
        distance_km: "",
        description: "",
      }];
    } else {
      // Intervalos/Fartlek: escalar duración de cada fase proporcionalmente
      if (Array.isArray(currentStructure) && currentStructure.length > 0) {
        const durRatio = origDuration > 0 ? finalDuration / origDuration : 1;

        const parseToSeconds = (str) => {
          const s = String(str || "").toLowerCase();
          let total = 0;
          const minMatch = s.match(/(\d+(?:\.\d+)?)\s*min/);
          const secMatch = s.match(/(\d+)\s*sec/);
          if (minMatch) total += parseFloat(minMatch[1]) * 60;
          if (secMatch) total += parseInt(secMatch[1], 10);
          if (!minMatch && !secMatch) {
            const plain = s.match(/(\d+(?:\.\d+)?)/);
            if (plain) total += parseFloat(plain[1]) * 60;
          }
          return total;
        };

        const formatFromSeconds = (totalSec) => {
          const rounded = Math.round(totalSec);
          if (rounded < 60) return `${rounded} sec`;
          const mins = Math.floor(rounded / 60);
          const secs = rounded % 60;
          return secs === 0 ? `${mins} min` : `${mins} min ${secs} sec`;
        };

        newStructure = currentStructure.map(step => {
          const origSec = parseToSeconds(step.duration_min);
          if (origSec > 0) {
            return { ...step, duration_min: formatFromSeconds(origSec * durRatio) };
          }
          return step;
        });
      } else {
        newStructure = currentStructure;
      }
    }

    // Actualizar ambos campos de structure en workouts
    await fetch(`${supabaseUrl}/rest/v1/workouts?id=eq.${workout_id}`, {
      method: "PATCH",
      headers: h,
      body: JSON.stringify({ structure: newStructure })
    });

    return res.status(200).json({ ok: true, structure: newStructure });
  }

  return res.status(400).json({ error: "action debe ser 'analyze' o 'adjust'" });
}
