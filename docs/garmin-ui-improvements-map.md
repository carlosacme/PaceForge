# Mapeo: mejoras UI de resultados (inspiradas en Garmin Connect)

Fecha: 2026-08-29  
HEAD de referencia: `aa609fc` (`master`)  
Alcance: vista de **resultados / registro** de un workout completado  
Estado: **solo mapeo**. Sin implementación. Esperando validación del orden.

Las 3 mejoras pedidas:

1. Filtro por tipo de paso (Todos / Calentamiento / Carrera / Enfriamiento) sobre la tabla de intervalos.
2. Splits expandibles dentro de un intervalo largo (p. ej. un 3K → desglose por km).
3. Gráfico ritmo real vs ritmo objetivo superpuesto en el tiempo.

---

## 1) Dónde vive hoy la vista de resultados

### Coach — modal **📋 Registro** (`Athletes.jsx`)

Esta es la superficie correcta. No es `WorkoutDetailBreakdown` (ese es el plan, tipo TrainingPeaks, en el menú contextual del calendario).

| Pieza | Ubicación | Qué hace |
|---|---|---|
| Estado del modal | `Athletes.jsx` `registroModal` (~920) | Workout de la fila al abrir |
| Deep link push | `openRegistroWorkoutId` → `setRegistroModal` (~925–932) | `coach_workout_completed` |
| Fetch de laps | `useEffect` (~934–972) | `POST /api/integrations` `action: "activity-intervals"` |
| Comparación | `registroBlocks` (~987–996) | `compareBlocks({ structure, laps: registroLaps, vdot })` |
| UI tabla | modal ~3709–3808, tabla ~3765–3793 | Bloque / ritmo previsto / real / Δ |
| Mapa | `<WorkoutRouteMap workout={w} />` (~3755) | Otro fetch: `activity-map` (GPS) |
| Lógica pura | `src/lib/blockComparison.js` | Alinea laps ICU → steps del plan por **tiempo acumulado** |

Apertura: menú contextual del calendario → **📊 Ver registro** (`~2946`).

`athleteVdot` ya se resuelve desde `athlete_evaluations` (no desde `athletes.vdot`, que no existe).

Ancho del modal: `maxWidth: 560`. Un gráfico a lo Garmin va a pedir más ancho (o scroll horizontal).

### Qué **no** es esta vista

| Componente | Rol | ¿Sirve para las 3 mejoras? |
|---|---|---|
| `WorkoutDetailBreakdown` | Plan (pasos + `groupRepeats`) | No. No tiene ejecutado. |
| `WorkoutStructureTable` | Plan en Builder/Biblioteca | No. |
| `AthleteHome.jsx` | Calendario del atleta | **No tiene** tabla plan-vs-real ni llama `activity-intervals`. Si el atleta debe ver lo mismo, es un **segundo** consumidor (fuera de este mapeo salvo nota). |

### Datos que el modal ya pinta (sin laps)

De la fila `workouts` (resumen de **sesión**):

- Plan: `total_km`, `duration_min`, `structure`, `title`
- Reloj: `actual_distance_km`, `actual_duration_min`, `actual_avg_pace_s`, `actual_avg_hr`, `actual_max_hr`, `actual_elevation_m`, `actual_synced_at`
- Ancla ICU: `intervals_activity_id`
- Manual (si no hay reloj): `manual_*`, notas, RPE

---

## 2) Qué hay (y qué no) en base de datos vs ICU

### Persistido en `workouts` (`0041_add_actual_columns.sql`)

Solo el **resumen de la actividad** + el id de ICU:

`actual_distance_km`, `actual_duration_min`, `actual_avg_pace_s`, `actual_avg_hr`, `actual_max_hr`, `actual_elevation_m`, `intervals_activity_id`, `actual_synced_at`.

**No hay** tabla ni JSON de:

- laps / splits / `icu_intervals`
- timeseries (ritmo, FC, distancia por segundo)
- coords GPS

El webhook / pull escribe esos `actual_*` desde el objeto actividad (`integrations.js` ~137–156). Un número de ritmo medio de sesión. Nada por km.

### Laps — existen, pero **en vivo**, no en BD

Al abrir Registro, si hay `intervals_activity_id` **y** `structure`:

```
ICU  GET /activity/{id}/intervals
  → actionActivityIntervals
  → { icu_intervals: [{ moving_time, distance, average_speed, average_heartrate }] }
```

- No se guarda el array.
- Se recortan el resto de campos que ICU pueda mandar (índices, tipo de intervalo, start/end).
- `compareBlocks` **consume** esos laps en cola y **agrega** un ritmo real por step del plan. Un 3K partido en 3 auto-laps de 1 km termina como **una** fila.

Comentario ya en `blockComparison.js`: el Auto Lap del reloj suele partir un bloque largo en varios laps (~1 km). Esa es exactamente la materia prima de la mejora 2 — hoy se tira al agregar.

### Timeseries de ritmo — **no existe** en BD ni en el cliente

El único stream que pedimos hoy:

```
ICU  GET /activity/{id}/streams?types=latlng
  → actionActivityMap  (WorkoutRouteMap, bajo demanda)
```

Solo lat/lng. Sin `time`, sin `velocity` / pace, sin `distance`.

No hay columna ni cache de samples. Cerrar el modal pierde laps; el mapa cachea coords **en memoria de sesión** (`routeCache`), no en Supabase.

---

## 3) Viabilidad de cada mejora

### Mejora 1 — Filtro Todos / Calentamiento / Carrera / Enfriamiento

**Viable con datos actuales. Cero llamadas nuevas.**

Entrada: `registroBlocks` + `structure` (nombres `block_type` / `phase`).

Ya hay clasificadores **no exportados** en `intervals.js`:

- `sectionOf(label)` → `"Warmup"` | `"Cooldown"` | `null` (`calent|warm` / `enfri|cool|vuelta a la calma`)
- `isWarmupish`, `isRecovery`

“Carrera” en Garmin = el cuerpo (intervalo / test / serie), no un tipo de workout. Aquí: todo lo que no sea warmup ni cooldown (las recuperaciones entre series quedan en Carrera o en un 5º chip “Recup.” — decisión de producto).

Hueco: nombres Garmin importados (`WU`, `CD`, `TEST 3K`, `Main Set`) vs español del builder. El filtro fallará en bloques mal etiquetados; conviene reutilizar/ampliar `sectionOf` y exportarlo, no copiar regex en el JSX.

**Tamaño:** **S (~80–140 líneas)**  
UI chips + `filter` sobre la tabla. Extraer `classifyStepSection(name)` a `intervals.js` o `blockComparison.js` (~20–40 líneas). Sin API, sin schema.

**Complejidad:** baja. Riesgo principal = taxonomía de nombres, no datos.

---

### Mejora 2 — Splits expandibles dentro de un bloque largo

**Viable en el caso típico (Auto Lap ~1 km) sin API nueva. No es un timeseries.**

Hoy `compareBlocks` sabe que un step “se come” varios laps, pero **no los devuelve**. El UI no puede expandir.

Camino A (recomendado, 1ª entrega):

1. Extender `compareBlocks` para que cada step traiga `splits[]` (cada lap o fracción consumida: dist, tiempo, pace).
2. En la tabla: chevron si `splits.length > 1` (o si `actual_dist_m >= ~1500`).
3. Opcional: enriquecer `actionActivityIntervals` con campos ICU que ya vienen y hoy se tiran (`start_index`, `end_index`, `elapsed_time`) — sigue siendo **la misma** llamada.

No hace falta persistir laps. Siguen en el fetch al abrir el modal.

**No cubre:** actividad con **un solo lap** para todo el 3K (auto-lap apagado, o ICU agrupa el intervalo). Ahí no hay km que expandir salvo inventarlos con streams (mejora 3 / camino B).

Camino B (solo si A se queda corto en producción):

- Pedir `streams?types=distance,time` (o `velocity_smooth,time`) y cortar cada 1000 m **dentro** de la ventana de tiempo del bloque.
- Es la **misma familia de API** que el mapa, **otros `types`**, acción nueva o ampliar `activity-map`.
- Más fiel a Garmin; más trabajo y más payload.

**Tamaño camino A:** **M (~180–280 líneas)**  
`blockComparison.js` + tests mentales/unitarios del consumo (~80–120) + filas anidadas en el modal (~80–120) + opcional extra fields en `actionActivityIntervals` (~15).

**Tamaño camino B:** **M–L (~250–400)** encima o en vez de A, más una acción ICU.

**Complejidad:** media. El riesgo no es el chevron: es que `icu_intervals` no sean vueltas de 1 km.

---

### Mejora 3 — Gráfico ritmo real vs objetivo en el tiempo

Hay dos lecturas de “Garmin”:

| Lectura | ¿Datos hoy? | ¿API nueva? |
|---|---|---|
| **Escalón por bloque** (una Y constante = `planned_pace_s` / `actual_pace_s` durante `actual_dur_s`) | Sí: `registroBlocks` | No |
| **Línea continua** (sample a sample, como Connect) | No | **Sí**: `streams` con tiempo + velocidad/pace |

La línea continua **no se puede** reconstruir desde `actual_avg_pace_s` ni desde 3–15 laps.

ICU ya se usa así en `activity-map`. Falta algo tipo:

`GET /activity/{id}/streams?types=time,velocity_smooth`

(o `velocity` / pace si el tenant lo da). Misma auth `getConnection` + `icuFetch`. Acción nueva `activity-streams` (o ampliar mapa) para no mezclar GPS con series largas.

El **objetivo** no viene en el stream: se pinta como escalón desde `structure` + `planned_pace_s` (o rango `target_pace`) alineado por tiempo de plan o por el mismo consumo que `compareBlocks`.

No hay `recharts` / Chart.js en `package.json`. El coach ya tiene un SVG de forma/fatiga (`Athletes.jsx` ~94). Un sparkline custom evita dependencia; un chart lib son ~+15–40 KB gzip.

**Tamaño (escalón, sin stream):** **M (~150–220 líneas)** — SVG + escala invertida (min/km) + leyenda.

**Tamaño (línea continua):** **L (~280–450 líneas)** — acción ICU + downsample (una 10K puede ser miles de samples) + cache sesión como el mapa + SVG. No persistir en Postgres en v1 (mismo criterio que coords).

**Complejidad:** media-alta. Indoor / cinta: stream de pace puede existir sin GPS; al revés, mapa sin velocity. Hay que degradar a “sin gráfico” o al escalón.

---

## 4) Estimación por mejora (para implementar **una a una**)

| # | Mejora | Datos | API nueva | LOC (orden) | Esfuerzo | Extraer de Athletes? |
|---|---|---|---|---|---|---|
| **1** | Filtro de pasos | `registroBlocks` + labels | No | **80–140** | 0.5 día | Opcional. Cabe en el modal. |
| **2A** | Expandir km desde laps ya fetcheados | Extender `compareBlocks` | No (mismo `activity-intervals`) | **180–280** | 1–1.5 días | Lógica en `blockComparison.js`; UI en modal. |
| **2B** | km “de verdad” vía streams | `distance`/`time` | Sí, streams | **+250–400** | +1–2 días | Solo si 2A no basta en Castro-like. |
| **3A** | Gráfico escalón bloque | `registroBlocks` | No | **150–220** | 1 día | Componente nuevo (`RegistroPaceChart.jsx`) para no hinchar el monolito. |
| **3B** | Gráfico continuo Garmin | streams velocity+time | Sí | **280–450** | 2–3 días | Misma extracción + `activity-streams`. |

Suma 1 + 2A + 3A (sin streams extra): **~410–640 líneas**, todo sobre datos que **ya** se piden al abrir Registro.  
Sumar 3B (y/o 2B): otra ida a ICU, payload grande, downsample obligatorio.

---

## 5) Riesgos y dependencias

### Independencias (se pueden hacer en cualquier orden)

- **1** no depende de 2 ni 3.
- **3A** no depende de 2 (usa las filas agregadas).
- **2A** no depende del filtro; el filtro debe aplicarse a la **fila padre** (si filtras “Carrera”, el 3K expandido sigue siendo Carrera).

### Dependencias reales

| Dependencia | Detalle |
|---|---|
| 2A → `compareBlocks` | Hoy tira los laps internos. Sin cambiar el return, la UI no tiene hijos. |
| 3B → ICU streams | Misma cuota/conexión que el mapa. Abrir Registro + mapa + gráfico = **3** idas a ICU si no se unifica. |
| 2B y 3B | Pueden **compartir** un `activity-streams`. Si se aprueba gráfico continuo, no hacer 2B con un fetch aparte. |
| 1 → nombres | `sectionOf` no exportado; “TEST 3K” / `Main Set` no son warmup/cooldown. Documentar reglas antes de pintar chips. |
| Modal 560 px | Filtro cabe. Gráfico + splits piden `maxWidth` ~720–800 o el gráfico a full-bleed. |
| Solo coach | El atleta no ve esta tabla. Copiar a `AthleteHome` es otro mapa (mismo fetch, otro shell). |
| Sin `structure` | El effect de laps **no corre**. Filtro/splits/gráfico de bloques mueren. Queda el resumen `actual_*`. |
| Laps ≠ 1 km | 2A muestra “vueltas del reloj”, no “km Garmin”. Si el reloj lapea cada 2 min, expandir no es “cada km”. Decirlo en UI (“Vueltas del reloj”) o exigir 2B. |
| `Athletes.jsx` 3738 líneas | Meter 3B + Leaflet + jsPDF en el mismo archivo empeora el hallazgo de auditoría. 2A mínimo en `blockComparison.js`; 3\* en componente nuevo. |
| No persistir streams/laps en v1 | Consistente con el mapa. Coste: cada apertura del modal refetch. Aceptable. Persistencia = migración + RLS + tamaño JSON — fuera de este paso. |

### Orden sugerido (para cuando valides)

1. **Mejora 1** — visible, barata, valida taxonomía de nombres con workouts reales (Castro / imports Garmin).
2. **Mejora 2A** — desbloquea el caso “3K = una fila”; reutiliza el fetch actual; enseña si `icu_intervals` son km o vueltas raras.
3. **Mejora 3A o 3B** — si 2A ya muestra que los laps son ~1 km, 3A (escalón) puede bastar. Si el coach pide la curva tipo Connect, 3B + unificar streams con el mapa.

No implementar 2B hasta ver 2A en actividades reales.

---

## 6) Contrato actual (para no romperlo)

`compareBlocks` hoy devuelve, por step:

`step_name`, `target_effort`, `target_zone`, `planned_pace_s`, `actual_pace_s`, `delta_s`, `planned_dur_s`, `actual_dur_s`, `actual_dist_m`, `dur_mismatch`, `incomplete`.

La tabla del modal solo usa nombre, paces, delta, flags.

**2A** debe ser **aditivo** (`splits?: [...]`). No cambiar el agregado: el Δ de la fila padre sigue siendo el del bloque entero.

`actionActivityIntervals` hoy:

```json
{ "ok": true, "count": N, "icu_intervals": [{ "moving_time", "distance", "average_speed", "average_heartrate" }] }
```

Campos extra = aditivos. El modal actual no se rompe.

---

## 7) Fuera de alcance (no decidir ahora)

- Vista gemela en `AthleteHome`.
- Guardar laps/streams en Supabase.
- Librería de charts.
- Score tipo “Puntuación de ejecución 59%” (otro problema: el analyze no recibe `structure`).
- Filtro sobre el **plan** en `WorkoutDetailBreakdown` (otra pantalla).

---

## Plan de commits (cuando se implemente, no ahora)

Un PR por mejora, en el orden validado:

1. `feat(registro): filtrar bloques warmup / carrera / cooldown`
2. `feat(registro): expandir vueltas del reloj dentro de un bloque`
3. `feat(registro): gráfico ritmo plan vs real` (3A o 3B según validación)

*Fin del mapeo — sin cambios de runtime en este commit.*
