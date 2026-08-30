/**
 * Importar workouts FIT/JSON a la biblioteca.
 *
 * Solo lo usa WorkoutLibrary. Vive aqui (no en appShared) para no
 * arrastrar fit-file-parser al chunk compartido de la SPA.
 *
 * normalizeLibraryRow / libraryRowToBuilderWorkout se quedan en appShared:
 * dependen de normalizeWorkoutStructure y WORKOUT_TYPES.
 */
import FitParser from "fit-file-parser";

/** Mismos ids que WORKOUT_TYPES en appShared. No importar appShared. */
const WORKOUT_TYPES = [
  { id: "easy" },
  { id: "tempo" },
  { id: "interval" },
  { id: "long" },
  { id: "recovery" },
  { id: "race" },
];

/** Palabras clave en el título FIT → tipo de sesión (tempo / intervalos). */
const fitTitleKeywords = {
  tempo: /\btempo\b/i,
  interval: /\b(interval|intervalos|repeats?|series)\b/i,
};

/** Cuenta cambios bruscos de velocidad en records FIT (≥15% entre muestras). */
export const getFitAvgSpeedChanges = (records) => {
  const speeds = (Array.isArray(records) ? records : [])
    .map((r) => Number(r?.enhanced_speed ?? r?.speed))
    .filter((s) => Number.isFinite(s) && s > 0);
  if (speeds.length < 3) return 0;
  let changes = 0;
  for (let i = 1; i < speeds.length; i += 1) {
    const prev = speeds[i - 1];
    const curr = speeds[i];
    if (prev <= 0 || curr <= 0) continue;
    const delta = Math.abs(curr - prev) / prev;
    if (delta >= 0.15) changes += 1;
  }
  return changes;
};

/** Clasifica sport/título/velocidad FIT → id de WORKOUT_TYPES. */
export const mapFitWorkoutType = ({ sport, title, speedChanges, durationMin, distanceKm }) => {
  const sportKey = String(sport || "").toLowerCase();
  const safeTitle = String(title || "").trim();
  const hasTempoWord = fitTitleKeywords.tempo.test(safeTitle);
  const hasIntervalWord = fitTitleKeywords.interval.test(safeTitle);
  const isIntervalBySpeed = Number(speedChanges) > 3;
  const isLong = Number(durationMin) >= 80 || Number(distanceKm) >= 14;
  if (sportKey === "running") {
    if (hasTempoWord) return "tempo";
    if (hasIntervalWord || isIntervalBySpeed) return "interval";
    if (isLong) return "long";
    return "easy";
  }
  if (sportKey === "walking") return "recovery";
  return "easy";
};

export const parseFitFileToLibraryDraft = async (file) => {
  const parser = new FitParser({
    force: true,
    speedUnit: "km/h",
    lengthUnit: "km",
    mode: "cascade",
  });
  const data = await parser.parseAsync(await file.arrayBuffer());
  const session = Array.isArray(data?.sessions) && data.sessions.length > 0 ? data.sessions[0] : null;
  const records = Array.isArray(data?.records) ? data.records : [];
  const laps = Array.isArray(data?.laps) ? data.laps : [];
  const sessionTitle = String(session?.name || session?.sport || "").trim();
  const title =
    sessionTitle ||
    String(file?.name || "Workout FIT")
      .replace(/\.fit$/i, "")
      .replace(/[_-]+/g, " ")
      .trim();
  const sport = String(session?.sport || data?.activity?.type || "running").toLowerCase();
  const durationMinRaw = Number(session?.total_timer_time ?? session?.total_elapsed_time);
  const distanceKmRaw = Number(session?.total_distance);
  const duration_min = Number.isFinite(durationMinRaw) && durationMinRaw > 0 ? Math.round(durationMinRaw / 60) : 0;
  const distance_km = Number.isFinite(distanceKmRaw) && distanceKmRaw > 0 ? Number((distanceKmRaw / 1000).toFixed(2)) : 0;
  const avgHrSession = Number(session?.avg_heart_rate);
  const avgHrRecords = records
    .map((r) => Number(r?.heart_rate))
    .filter((v) => Number.isFinite(v) && v > 0);
  const avg_hr = Number.isFinite(avgHrSession) && avgHrSession > 0
    ? Math.round(avgHrSession)
    : avgHrRecords.length
      ? Math.round(avgHrRecords.reduce((acc, v) => acc + v, 0) / avgHrRecords.length)
      : null;
  const speedChanges = getFitAvgSpeedChanges(records);
  const type = mapFitWorkoutType({
    sport,
    title,
    speedChanges,
    durationMin: duration_min,
    distanceKm: distance_km,
  });
  const structureFromLaps = laps
    .slice(0, 10)
    .map((lap, idx) => {
      const lapDuration = Number(lap?.total_timer_time ?? lap?.total_elapsed_time);
      const lapDistance = Number(lap?.total_distance);
      const row = {
        block_type: idx % 2 === 0 ? "Intervalo" : "Recuperación",
      };
      if (Number.isFinite(lapDuration) && lapDuration > 0) row.duration_min = String(Math.max(1, Math.round(lapDuration / 60)));
      if (Number.isFinite(lapDistance) && lapDistance > 0) row.distance_km = String((lapDistance / 1000).toFixed(2));
      return row;
    })
    .filter(Boolean);
  return {
    id: `fit_${Date.now()}_${Math.random().toString(36).slice(2, 8)}`,
    sourceFileName: file?.name || "",
    title: title || "Workout FIT",
    sport,
    type,
    duration_min,
    total_km: distance_km,
    distance_km,
    avg_hr,
    structure: structureFromLaps,
    speedChanges,
  };
};

export const mapJsonWorkoutToLibraryDraft = (row, fileName, idx) => {
  if (!row || typeof row !== "object" || Array.isArray(row)) return null;
  const isGarminLike =
    row.workoutName != null ||
    row.estimatedDurationInSecs != null ||
    row.estimatedDistanceInMeters != null ||
    Array.isArray(row.workoutSegments);
  const titleValue = row.title ?? row.name ?? (isGarminLike ? row.workoutName : "");
  const sport = String(row.sport ?? "running").trim().toLowerCase() || "running";
  const rawType = String(row.type ?? row.workout_type ?? "").trim().toLowerCase();
  const garminSegments = Array.isArray(row.workoutSegments) ? row.workoutSegments : [];
  const garminSteps = Array.isArray(garminSegments[0]?.workoutSteps) ? garminSegments[0].workoutSteps : [];

  const stepTypeKeyOf = (step) =>
    String(step?.stepType?.stepTypeKey || step?.stepTypeKey || step?.stepType || step?.type || "").trim().toLowerCase();
  const hasRepeatGroup = garminSteps.some((step) => {
    const t = String(step?.type || step?.stepType?.stepTypeKey || "").toLowerCase();
    return t.includes("repeatgroupdto") || t.includes("repeat_group") || t.includes("repeatgroup");
  });
  const hasIntervalStep = garminSteps.some((step) => stepTypeKeyOf(step) === "interval");

  /**
   * Tipo de sesion segun el titulo. Solo si el titulo no dice nada se mira la
   * estructura.
   *
   * Antes era al reves y cualquier paso "interval" ganaba; como los archivos de
   * Garmin usan un paso interval para el bloque principal de casi cualquier
   * sesion, un plan entero entraba clasificado como series, largos incluidos.
   *
   * El ORDEN de las reglas es la regla: en un titulo mixto gana lo que define la
   * sesion. "Long Bloques T" es un largo con tramos en umbral, no un tempo, y
   * "Rodaje E Strides" es un rodaje con progresivos, no series.
   */
  const TYPE_BY_TITLE = [
    // Competicion y tests a tope. No vale la distancia sola ("Long 21K Pace" es
    // un largo a ritmo de media, no una media).
    ["race", /\b(maratón|maraton|test)\b/i],
    ["long", /\b(long|largo)\b/i],
    ["recovery", /\b(shakeout|recuperación|recuperacion|recuperar|regenerativo|regeneración|regeneracion|recovery)\b/i],
    // Progresivos y tecnica: no convierten el rodaje que los lleva en series.
    ["easy", /\b(strides|drills)\b/i],
    // Umbral y ritmo de maraton. Incluye la notacion Daniels de token suelto
    // ("3x2km T", "14km M", "5x2km 95M", "4x4km M+") y los simulacros y ensayos,
    // que son trabajo continuo a ritmo objetivo aunque vengan troceados en
    // repeticiones ("Canova SIM 18K" son 6x3km a ritmo de media).
    ["tempo", /\b(tempo|umbral|threshold|cruise|sustained|sim|simulacro|rehearsal)\b|\britmo\s*\d+\s*k\b|(?:^|[\s-])(?:T|M\+|M|\d+M)(?=$|[\s\-/])/i],
    ["interval", /\d+\s*[x×]|\b(I|series|intervalos|fartlek|cuestas|hill|circuit|sharpening)\b/i],
    ["easy", /\b(rodaje|trote|easy|E)\b/i],
  ];

  const tituloTipo = String(titleValue || "");
  const porTitulo = TYPE_BY_TITLE.find(([, re]) => re.test(tituloTipo));
  let inferredType = "easy";
  if (porTitulo) inferredType = porTitulo[0];
  else if (hasIntervalStep || hasRepeatGroup) inferredType = "interval";
  const safeMappedType = WORKOUT_TYPES.some((t) => t.id === rawType) ? rawType : inferredType;

  const durationRaw = Number(
    row.duration_min ??
      row.duration ??
      (isGarminLike ? Number(row.estimatedDurationInSecs) / 60 : NaN),
  );
  const distanceRaw = Number(
    row.total_km ??
      row.distance_km ??
      (isGarminLike && row.estimatedDistanceInMeters != null ? Number(row.estimatedDistanceInMeters) / 1000 : NaN),
  );
  // La cabecera es solo la primera opcion: los exports de Garmin dejan
  // estimatedDistanceInMeters en null muy a menudo, y de ahi venia el 0 km.
  const headerDurationMin = Number.isFinite(durationRaw) ? Math.max(0, Math.round(durationRaw)) : 0;
  const headerDistanceKm = Number.isFinite(distanceRaw) ? Math.max(0, Number(distanceRaw)) : 0;

  const round2 = (n) => Number(Number(n).toFixed(2));

  const speedToPace = (mps) => {
    const speed = Number(mps);
    if (!Number.isFinite(speed) || speed <= 0) return null;
    // Se redondea a segundos ENTEROS antes de partir en min:seg. Redondear los
    // segundos por separado daba 4:60 y habia que aplastarlo a 4:59.
    const secPerKm = Math.round(1000 / speed);
    return `${Math.floor(secPerKm / 60)}:${String(secPerKm % 60).padStart(2, "0")}`;
  };
  const secToMinInt = (sec) => {
    const n = Number(sec);
    if (!Number.isFinite(n) || n <= 0) return 0;
    return Math.max(1, Math.round(n / 60));
  };
  const numericTarget = (step, key) => Number(step?.[key] ?? step?.targetType?.[key]);

  /**
   * Ritmo objetivo del paso. Garmin da la velocidad en m/s y casi siempre como
   * RANGO (targetValueOne y targetValueTwo), de donde sale "5:38-6:08".
   *
   * Al pasar de velocidad a ritmo el orden se INVIERTE (mas m/s es menos
   * min/km), asi que el extremo rapido se calcula con la velocidad mayor. Se
   * ordena por valor en vez de fiarse de cual campo trae cual extremo.
   */
  const targetPaceOf = (step) => {
    const speeds = [numericTarget(step, "targetValueOne"), numericTarget(step, "targetValueTwo")]
      .filter((v) => Number.isFinite(v) && v > 0);
    if (!speeds.length) return { label: null, secPerKm: null };
    const fast = speedToPace(Math.max(...speeds));
    const slow = speedToPace(Math.min(...speeds));
    if (!fast || !slow) return { label: null, secPerKm: null };
    const segsPorKm = speeds.map((v) => Math.round(1000 / v));
    return {
      label: fast === slow ? fast : `${fast}-${slow}`,
      // Punto medio del rango, para estimar la distancia de los pasos por tiempo.
      secPerKm: segsPorKm.reduce((a, b) => a + b, 0) / segsPorKm.length,
    };
  };
  const paceLabel = (pace) => (pace ? `${pace}/km` : "");

  /**
   * Como termina el paso. En el formato nativo de Garmin esto vive en
   * endCondition.conditionTypeKey ("time" | "distance" | "iterations" |
   * "lap.button"); los nombres planos son de otros exportadores.
   */
  const endConditionKeyOf = (st) =>
    String(st?.endCondition?.conditionTypeKey ?? st?.endConditionType ?? st?.endConditionTypeKey ?? "")
      .trim()
      .toLowerCase();

  /**
   * Antes esto se decidia SOLO con un heuristico (valor >= 400 = metros) porque
   * no se leia endCondition.conditionTypeKey. Con datos reales eso es fatal: un
   * rodaje de 45' (endConditionValue 2700) se tomaria por 2,7 km. Manda el tipo
   * declarado, y el heuristico queda para los archivos que no lo traen.
   */
  const stepEndsByDistance = (st) => {
    const key = endConditionKeyOf(st);
    if (key) return key.includes("distance");
    const v = Number(st?.endConditionValue);
    return Number.isFinite(v) && v >= 400;
  };

  // Metros del paso, o null si no va por distancia.
  const stepMeters = (st) => {
    if (!st) return null;
    if (stepEndsByDistance(st)) {
      const ev = Number(st?.endConditionValue);
      if (Number.isFinite(ev) && ev > 0) return ev;
    }
    // Exportadores que traen la distancia aparte del endCondition.
    const dm = Number(st?.distance ?? st?.totalDistance);
    return Number.isFinite(dm) && dm > 400 ? dm : null;
  };

  // Segundos del paso, o null si no va por tiempo (distancia, lap.button...).
  const stepSeconds = (st) => {
    if (!st || stepEndsByDistance(st)) return null;
    const key = endConditionKeyOf(st);
    if (key && !key.includes("time")) return null;
    const ev = Number(st?.endConditionValue);
    return Number.isFinite(ev) && ev > 0 ? ev : null;
  };

  const BLOCK_TYPE_BY_STEP_KEY = {
    warmup: "Calentamiento",
    cooldown: "Enfriamiento",
    recovery: "Recuperación",
    rest: "Recuperación",
    interval: "Intervalo",
  };

  const isRepeatStep = (st) => {
    const raw = String(st?.type || "").toLowerCase();
    return (
      raw.includes("repeatgroupdto") ||
      raw.includes("repeat_group") ||
      raw.includes("repeatgroup") ||
      stepTypeKeyOf(st) === "repeat"
    );
  };

  /**
   * Convierte UN paso ejecutable en su fila de estructura, sea de primer nivel o
   * de dentro de un grupo de repeticiones.
   *
   * Antes cada tipo de paso tenia su propia rama y solo la de intervalo leia el
   * target: por eso calentamientos, enfriamientos y recuperaciones llegaban sin
   * ritmo aunque el archivo lo trajera. Con una sola funcion, lo que se lea vale
   * para todos por construccion.
   *
   * Devuelve tambien los metros y segundos CRUDOS del paso, que es con lo que se
   * calculan los totales cuando la cabecera no los da (redondear ahi y sumar
   * despues arrastraria el error de cada paso).
   */
  const stepToStructureRow = (st) => {
    const blockType = BLOCK_TYPE_BY_STEP_KEY[stepTypeKeyOf(st)] || "Rodaje";
    const { label: pace, secPerKm } = targetPaceOf(st);
    const meters = stepMeters(st);
    const seconds = meters == null ? stepSeconds(st) : null;
    const km = meters != null ? round2(meters / 1000) : null;
    const mins = seconds != null ? secToMinInt(seconds) : null;

    const parts = [];
    if (km != null) parts.push(`${km}km`);
    else if (mins != null) parts.push(`${mins}min`);
    if (pace) parts.push(paceLabel(pace));
    const armado = parts.length ? `${blockType} · ${parts.join(" · ")}` : blockType;
    // La etiqueta del propio archivo ("WU @ 5:38-6:08/km - 10' calentamiento")
    // describe el paso mejor que cualquier texto que armemos aqui.
    const delArchivo = String(st?.description || st?.stepName || "").trim();

    return {
      row: {
        block_type: blockType,
        ...(km != null ? { distance_km: String(km) } : {}),
        ...(mins != null ? { duration_min: String(mins) } : {}),
        target_pace: paceLabel(pace),
        description: delArchivo || `Paso: ${armado}`,
      },
      seconds,
      // Metros que aporta el paso al total. Los que van por tiempo aportan los
      // suyos derivados del ritmo objetivo (tiempo / ritmo = distancia): es una
      // estimacion, pero es la unica forma de que una sesion entera por tiempo
      // no quede en 0 km.
      metersForTotal:
        meters != null ? meters : seconds != null && secPerKm > 0 ? (seconds / secPerKm) * 1000 : 0,
      line: delArchivo || armado,
      // Resumen corto para la linea "4x(...)" del grupo de repeticiones.
      brief: [km != null ? `${km}km` : mins != null ? `${mins}'` : "", paceLabel(pace)]
        .filter(Boolean)
        .join(" @ "),
    };
  };

  const descriptionLines = [];
  const structureRows = [];
  // Metros y segundos crudos de los pasos, para los totales cuando la cabecera
  // no los trae. Se acumula el dato sin redondear en vez de releer las columnas
  // ya redondeadas de cada fila, para no arrastrar el error paso a paso.
  // Los pasos por tiempo aportan su distancia derivada del ritmo objetivo: sin
  // eso, una sesion entera por tiempo (la mitad de un plan tipico) seguiria
  // quedando en 0 km, que es justo lo que se venia a arreglar.
  let metersFromSteps = 0;
  let secondsFromSteps = 0;

  const acumular = (built) => {
    structureRows.push({ ...built.row });
    metersFromSteps += built.metersForTotal;
    if (built.seconds != null) secondsFromSteps += built.seconds;
  };

  for (const step of garminSteps) {
    if (isRepeatStep(step)) {
      const reps = Math.max(1, Math.floor(Number(step?.numberOfIterations)) || 1);
      const nested = Array.isArray(step?.workoutSteps) ? step.workoutSteps : [];
      const built = nested.map((ns) => stepToStructureRow(ns));

      const resumen = built.map((b) => b.brief).filter(Boolean);
      descriptionLines.push(resumen.length ? `${reps}x(${resumen.join(" + ")})` : `${reps}x(bloque)`);

      // El grupo se expande: una fila por repeticion y paso, que es lo que espera
      // el editor de estructura y lo que hace directa la suma de los totales.
      for (let r = 0; r < reps; r += 1) built.forEach(acumular);
      continue;
    }
    const built = stepToStructureRow(step);
    acumular(built);
    descriptionLines.push(built.line);
  }

  const durationMin = headerDurationMin > 0
    ? headerDurationMin
    : secondsFromSteps > 0 ? Math.max(1, Math.round(secondsFromSteps / 60)) : 0;
  const distanceKm = headerDistanceKm > 0
    ? headerDistanceKm
    : metersFromSteps > 0 ? round2(metersFromSteps / 1000) : 0;

  // La nota de cabecera da el contexto ("Test 3K - all-out") y las lineas de los
  // pasos la estructura: se quedan las dos.
  const notaCabecera = row.description != null ? String(row.description).trim() : "";
  const garminDescription = [
    ...(notaCabecera && !descriptionLines.includes(notaCabecera) ? [notaCabecera] : []),
    ...descriptionLines,
  ].join("\n");

  return {
    id: `json_${Date.now()}_${idx}_${Math.random().toString(36).slice(2, 8)}`,
    sourceFileName: fileName || "",
    title: String(titleValue ?? "").trim() || `Workout JSON ${idx + 1}`,
    sport,
    type: safeMappedType,
    duration_min: durationMin,
    total_km: distanceKm,
    distance_km: distanceKm,
    avg_hr: null,
    structure: structureRows,
    speedChanges: 0,
    // garminDescription ya lleva la nota de cabecera delante de las lineas de los
    // pasos, asi que sirve igual para un JSON con workoutSteps y para uno que
    // solo trae description.
    description: garminDescription,
  };
};

export const INVALID_JSON_WORKOUT_FORMAT_MSG = "Formato JSON inválido. Debe ser un workout o array de workouts.";

export const parseJsonFileToLibraryDrafts = async (file) => {
  const jsonContent = await file.text();
  let parsed;
  try {
    parsed = JSON.parse(jsonContent);
  } catch {
    throw new Error(INVALID_JSON_WORKOUT_FORMAT_MSG);
  }
  const payload = parsed;
  const list = Array.isArray(payload) ? payload : payload && typeof payload === "object" ? [payload] : null;
  if (!list) {
    throw new Error(INVALID_JSON_WORKOUT_FORMAT_MSG);
  }
  const drafts = list.map((row, idx) => mapJsonWorkoutToLibraryDraft(row, file?.name || "", idx)).filter(Boolean);
  if (!drafts.length) {
    throw new Error(INVALID_JSON_WORKOUT_FORMAT_MSG);
  }
  return drafts;
};
