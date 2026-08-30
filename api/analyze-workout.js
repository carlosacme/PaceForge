import { requireUser, getWorkoutIfAllowed, jsonError, adminHeaders } from "../lib/apiAuth.js";
import { readStructure } from "../src/lib/workoutStructure.js";
import { compareBlocks } from "../src/lib/blockComparison.js";

const SUPABASE_URL = process.env.SUPABASE_URL || process.env.VITE_SUPABASE_URL;

const MODELS = [
  "claude-sonnet-5",
];

/**
 * Techos de salida por accion.
 *
 * Antes analyze usaba el default 800 y el texto se cortaba a mitad de frase.
 * claude-sonnet-5 puede gastar parte del presupuesto en thinking (comportamiento
 * por defecto): 4000 deja sitio para razonamiento + las 4 secciones. No pasamos
 * temperature (deprecated en este modelo) ni forzamos thinking disabled.
 */
const MAX_TOKENS = {
  briefing: 400,
  analyze: 4000,
  adjust: 4000,
};

/**
 * Llama a Anthropic y devuelve texto + diagnostico.
 *
 * Payload minimo: model + max_tokens + messages. Sin temperature (invalid_request
 * en claude-sonnet-5) y sin tocar thinking (dejar el default del modelo).
 */
async function callClaude(apiKey, prompt, maxTokens = MAX_TOKENS.analyze) {
  for (const model of MODELS) {
    try {
      const payload = {
        model,
        max_tokens: maxTokens,
        messages: [{ role: "user", content: prompt }],
      };

      const response = await fetch("https://api.anthropic.com/v1/messages", {
        method: "POST",
        headers: {
          "Content-Type": "application/json",
          "x-api-key": apiKey,
          "anthropic-version": "2023-06-01",
        },
        body: JSON.stringify(payload),
      });
      const data = await response.json();

      // No usar content[0]: claude-sonnet-5 puede devolver "thinking" primero.
      const text = (Array.isArray(data.content) ? data.content : [])
        .filter((b) => b && b.type === "text")
        .map((b) => String(b.text || ""))
        .join("\n")
        .trim();

      const stopReason = data?.stop_reason || null;
      console.log(
        "[analyze-workout] model:",
        model,
        "| status:",
        response.status,
        "| stop_reason:",
        stopReason,
        "| text_chars:",
        text.length,
        "| usage:",
        data?.usage,
      );

      if (response.ok && text) {
        return {
          text,
          model,
          stopReason,
          truncated: stopReason === "max_tokens",
        };
      }
      // Log completo del error de Anthropic (fue lo que diagnostico temperature).
      console.warn(
        `callClaude: model ${model} failed:`,
        "types:",
        (data.content || []).map((b) => b?.type),
        "stop_reason:",
        stopReason,
        "error:",
        JSON.stringify(data?.error || data).slice(0, 800),
      );
    } catch (err) {
      console.warn(`callClaude: model ${model} exception:`, err?.message);
    }
  }
  return null;
}

/**
 * Si Anthropic corto por max_tokens, no enseñas una frase a medias como si
 * estuviera completa: quitas el trozo final truncado y avisas.
 */
function withTruncationGuard(result) {
  if (!result?.truncated) return result;
  console.error(
    "[analyze-workout] RESPUESTA TRUNCADA (stop_reason=max_tokens). chars:",
    result.text.length,
    "| preview:",
    result.text.slice(-80),
  );
  // Quitar la ultima linea/fragmento incompleto (suele acabar a mitad de palabra).
  let cleaned = result.text.replace(/\s+\S*$/, "").trim();
  if (cleaned.length < 40) cleaned = result.text.trim();
  return {
    ...result,
    text:
      `${cleaned}\n\n` +
      `[Análisis incompleto: la respuesta se cortó por límite de tokens. Vuelve a pulsar Analizar.]`,
  };
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

function fmtPaceS(s) {
  const n = Number(s);
  if (!Number.isFinite(n) || n <= 0) return null;
  const m = Math.floor(n / 60);
  const sec = Math.round(n % 60);
  return `${m}:${String(sec).padStart(2, "0")}/km`;
}

/**
 * Número de ejecución para el prompt de adjust: actual_* → manual_*.
 * 0 no cuenta (km planificado de un rodaje por tiempo, o FC nula).
 * No usar en analyze: ese prompt ya tiene su propia prioridad.
 */
function pickExecNumber(...vals) {
  for (const v of vals) {
    const n = Number(v);
    if (Number.isFinite(n) && n > 0) return n;
  }
  return null;
}

function fmtAdjustExecKm(w) {
  const n = pickExecNumber(w?.actual_distance_km, w?.manual_distance_km);
  if (n == null) return "N/A";
  return String(Number.isInteger(n) ? n : Math.round(n * 100) / 100);
}

function fmtAdjustExecMin(w) {
  const n = pickExecNumber(w?.actual_duration_min, w?.manual_duration_min);
  return n == null ? "N/A" : String(Math.round(n));
}

function fmtAdjustExecHr(w, actualKey, manualKey) {
  const n = pickExecNumber(w?.[actualKey], w?.[manualKey]);
  return n == null ? "N/R" : String(Math.round(n));
}

/** Última evaluación del atleta (test_date, luego created_at). No usa athlete.vdot. */
async function latestVdotForAthlete(athleteId) {
  if (!athleteId || !SUPABASE_URL) return null;
  const q =
    `athlete_evaluations?athlete_id=eq.${encodeURIComponent(athleteId)}` +
    `&select=vdot,test_date,created_at&order=test_date.desc.nullslast,created_at.desc&limit=8`;
  try {
    const r = await fetch(`${SUPABASE_URL}/rest/v1/${q}`, { headers: adminHeaders() });
    if (!r.ok) return null;
    const rows = await r.json();
    if (!Array.isArray(rows) || !rows.length) return null;
    const latest = [...rows].sort(
      (a, b) => new Date(b.test_date || b.created_at) - new Date(a.test_date || a.created_at),
    )[0];
    const v = Number(latest?.vdot);
    return Number.isFinite(v) && v > 0 ? v : null;
  } catch {
    return null;
  }
}

async function hydrateWorkout(userId, workout) {
  if (!workout?.id) return workout || null;
  try {
    const allowed = await getWorkoutIfAllowed(userId, workout.id);
    if (!allowed) return workout;
    const clientHasSteps = readStructure(workout).length > 0;
    return {
      ...allowed,
      ...workout,
      structure: clientHasSteps ? (workout.structure ?? allowed.structure) : allowed.structure,
      athlete_id: allowed.athlete_id || workout.athlete_id,
    };
  } catch {
    return workout;
  }
}

function blocksPromptSection(workout, vdot, laps) {
  const structure = readStructure(workout);
  if (!structure.length) return "";
  let rows = [];
  try {
    rows = compareBlocks({
      structure,
      laps: Array.isArray(laps) ? laps : [],
      vdot,
    });
  } catch {
    return "";
  }
  if (!rows.length) return "";
  const lines = rows.map((b, i) => {
    const planned = fmtPaceS(b.planned_pace_s) || "N/A";
    const actual = fmtPaceS(b.actual_pace_s);
    const delta =
      b.delta_s == null ? "" : ` (Δ ${b.delta_s > 0 ? "+" : ""}${Math.round(b.delta_s)}s/km)`;
    const realBit = actual ? ` | ritmo real ${actual}${delta}` : "";
    return `${i + 1}. ${b.step_name || "Bloque"} | objetivo ${b.target_effort || "—"} | ritmo plan ${planned}${realBit}`;
  });
  return `\nPASOS (ritmo objetivo rescalado al VDOT ${vdot ?? "N/A"}):\n${lines.join("\n")}`;
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
    const result = withTruncationGuard(
      await callClaude(apiKey, briefingPrompt, MAX_TOKENS.briefing),
    );
    if (!result) return res.status(500).json({ error: "No se pudo generar el briefing" });
    return res.status(200).json({
      analysis: result.text,
      truncated: !!result.truncated,
    });
  }

  const {
    action = "analyze",
    workout: workoutIn,
    athleteName,
    recentWorkouts,
    role,
    futureWorkouts,
    laps,
  } = req.body || {};

  const workout = await hydrateWorkout(user.id, workoutIn);
  const vdot = await latestVdotForAthlete(workout?.athlete_id);
  const blocksSection = workout ? blocksPromptSection(workout, vdot, laps) : "";

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

    // 4 secciones (coach) o 3 párrafos (atleta). Techo 4000: thinking + texto.
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
${blocksSection}
${recentContext}

Responde en español con 4 secciones cortas (sin markdown, sin asteriscos, sin tablas). Cada sección: 3-5 frases, no más de ~80 palabras:
1. Rendimiento — Compara lo EJECUTADO contra lo PLANIFICADO por bloque (ritmo real vs ritmo plan de cada paso), no solo el promedio de la sesión. ¿Cumplió el objetivo del workout?
2. Señales fisiológicas — ¿Qué indican RPE, FC y ritmo sobre su estado?
3. Tendencia — Basado en los entrenamientos recientes, ¿está progresando, estancado o acumulando fatiga?
4. Ajuste recomendado — ¿Qué ajustar en los próximos 2-3 entrenamientos? (respuesta en texto plano, no tabla)`
      : `Eres un coach de running experto. Analiza este entrenamiento de ${athleteName || "el atleta"} (VDOT ${vdot || "N/A"}) y da retroalimentación motivadora en español.

PLANIFICADO: ${workout.total_km ?? "N/A"} km, ${workout.duration_min ?? "N/A"} min (${workout.type ?? "N/A"})
EJECUTADO (${fuente}): ${realDist ?? "N/R"} km, ${realDur ?? "N/R"} min, ritmo ${paceStr ?? "N/R"}, FC prom/máx ${realHrAvg ?? "N/R"}/${realHrMax ?? "N/R"} lpm
RPE: ${workout.rpe ?? "N/R"} | Sensación: ${workout.feeling ?? workout.athlete_notes ?? "N/R"}
${blocksSection}
${recentContext}

Responde en 3 párrafos cortos (sin markdown, sin asteriscos), cada uno de 2-4 frases:
1. Qué hiciste bien hoy (compara ritmos por bloque plan vs real, no solo el promedio)
2. Cómo estás progresando
3. Consejo para el próximo entrenamiento`;

    const result = withTruncationGuard(
      await callClaude(apiKey, prompt, MAX_TOKENS.analyze),
    );
    if (!result) return res.status(500).json({ error: "Todos los modelos fallaron." });
    return res.status(200).json({
      analysis: result.text,
      model: result.model,
      truncated: !!result.truncated,
    });
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
              `${i + 1}. ${w.title || w.type} — ${fmtAdjustExecKm(w)} km, RPE ${w.rpe ?? "N/R"}, FC ${fmtAdjustExecHr(w, "actual_avg_hr", "manual_avg_hr")}`
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
- Distancia real: ${fmtAdjustExecKm(workout)} km
- Duración real: ${fmtAdjustExecMin(workout)} min
- Ritmo medio: ${fmtPaceS(workout.actual_avg_pace_s) ?? "N/A"}
- RPE: ${workout.rpe ?? "N/R"} / 10
- FC promedio: ${fmtAdjustExecHr(workout, "actual_avg_hr", "manual_avg_hr")} lpm
- FC máxima: ${fmtAdjustExecHr(workout, "actual_max_hr", "manual_max_hr")} lpm
- Notas: ${workout.athlete_notes || "Sin notas"}
${blocksSection}
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

    const result = withTruncationGuard(
      await callClaude(apiKey, prompt, MAX_TOKENS.adjust),
    );
    if (!result) return res.status(500).json({ error: "Todos los modelos fallaron." });

    console.log("adjust raw response:", result.text.slice(0, 500));

    const parsed = extractJson(result.text);

    if (!parsed) {
      console.error("adjust: no se pudo parsear JSON. Raw:", result.text.slice(0, 800));
      // Fallback: retornar respuesta segura en lugar de 500
      return res.status(200).json({
        signal: "bien",
        summary: result.truncated
          ? "El ajuste de IA se cortó por límite de tokens. Intenta de nuevo."
          : "No se pudo procesar la respuesta de IA. Intenta de nuevo.",
        adjustments: [],
        model: result.model,
        parse_error: true,
        truncated: !!result.truncated,
      });
    }

    // Validar estructura mínima
    const safe = {
      signal: parsed.signal || "bien",
      summary: parsed.summary || "Análisis completado.",
      adjustments: Array.isArray(parsed.adjustments) ? parsed.adjustments : [],
      model: result.model,
      truncated: !!result.truncated,
    };

    return res.status(200).json(safe);
  }

  if (action === "adjust-steps") {
    const { workout_id, isSimple, finalType, finalKm, finalDuration, originalKm, originalDuration, description, title } = req.body;

    const owned = await getWorkoutIfAllowed(user.id, workout_id);
    if (!owned) return jsonError(res, 403, "Sin acceso a ese workout");

    const supabaseUrl = process.env.SUPABASE_URL;
    const h = adminHeaders({ Prefer: "return=minimal" });

    // Obtener structure actual
    // Solo `structure`: workout_structure se elimino en la migracion 0044.
    const getRes = await fetch(`${supabaseUrl}/rest/v1/workouts?id=eq.${workout_id}&select=structure,duration_min,total_km`, { headers: h });
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
