# Mapeo detallado: `workout_ai_cache`

Fecha: 2026-08-30  
HEAD de referencia: `master` (`fe8eba0`)  
Estado: **solo mapeo**. Sin implementación. Esperando validación antes de migración + call sites.

Problema: el análisis IA del coach vive en `localStorage` (`raf_analysis_${id}`). El briefing del atleta no se cachea. `/api/analyze-workout` no tiene el techo de `assertGenerateBudget` que sí tiene `generate-workout`. Cambiar de dispositivo o pulsar otra vez **Analizar IA** vuelve a cobrar Anthropic.

Diseño acordado: tabla `workout_ai_cache` (`workout_id`, `kind`, `text`, `created_at`, `input_hash`, unique `(workout_id, kind)`).

---

## 1) Convención de migraciones

| Dato | Valor |
|---|---|
| Carpeta | `supabase/migrations/` |
| Numeración | Prefijo de 4 dígitos. La última aplicada es **`0065_workouts_coach_completion_notified.sql`**. Siguiente: **`0066_workout_ai_cache.sql`**. |
| Nombre | `NNNN_snake_case_descriptivo.sql` |
| Estilo reciente | Comentario de motivo arriba; `BEGIN;` / `COMMIT;` (0064, 0065); `IF NOT EXISTS`; `COMMENT ON`; índice si hace falta; `NOTIFY pgrst, 'reload schema';` al cierre. |
| RLS de tabla nueva | Modelo a copiar: `0060_push_deliveries.sql` — `ENABLE ROW LEVEL SECURITY`, policies con `DROP POLICY IF EXISTS` + `CREATE POLICY`, **sin INSERT de cliente** si solo escribe el backend. |
| RLS más verbosa | `0064_harden_rpc_rls_coach_public.sql` — `TO authenticated`, `USING` + `WITH CHECK`, comentario “qué se rompe”. |

No hay carpeta `seed` que haya que tocar para esta tabla. No usar `supabase migration new` en Paso 2 si el archivo se escribe a mano con el número 0066 (el CLI incrementaría solo si se corre ahí).

`workouts.id` es **bigint**. El FK debe ser `workout_id bigint REFERENCES public.workouts(id) ON DELETE CASCADE`.

---

## 2) Los 4 call sites (archivo + función)

Todos pegan a `POST /api/analyze-workout`. **Solo 2 deben leer/escribir caché.** Adjust y adjust-steps no.

| # | Producto | ¿Caché? | Archivo | Función | Body hoy | Qué hacer en Paso 2 |
|---|---|---|---|---|---|---|
| 1 | Coach analyze | **Sí** (`kind = coach_analyze`) | `src/components/Athletes/useWorkoutAnalysis.js` | `analyzeWorkoutAsCoach` (L44–73) | `{ workout, athleteName, role: "coach", laps? }` | Leer: el `useEffect` de L29–42 (hoy `localStorage`). Escribir: no el cliente — el API tras Claude. El click de **Analizar IA** manda `force: true`. |
| 2 | Coach adjust | **No** | mismo archivo | `adjustPlanWithAI` (L75–125) | `{ action: "adjust", workout, athleteName, recentWorkouts, futureWorkouts, role: "coach" }` | No tocar caché. Propuesta puntual de plan. |
| 3 | Coach adjust-steps | **No** | mismo archivo | `applyAdjustment` (L127–187), fetch L158 | `{ action: "adjust-steps", workout_id, isSimple, finalType, … }` | No tocar caché. Mutación de `structure`. |
| 4 | Atleta briefing | **Sí** (`kind = athlete_briefing`) | `src/components/AthleteHome/useAthleteWorkoutOverlays.js` | `generateBriefing` (L39–61) y `openBriefing` (L63–67) | `{ prompt, mode: "briefing" }` — **sin `workout.id`** | `openBriefing` lee caché (miss → genera). **Regenerar** llama `generateBriefing` con force. Hay que **mandar `workout_id`** (y campos del hash) o el API no puede upsertar. |

### UI que dispara, sin lógica propia

| UI | Archivo | Qué hace |
|---|---|---|
| Menú **🤖 Analizar IA** | `AthleteCalendarSection.jsx` ~L394–400 | `onAnalyze(ctxMenuWorkout, athleteName)` → `analyzeWorkoutAsCoach`. Siempre llama al API. Si ya hay texto, también aparece **📄 Ver análisis** (~L402–414), que **no** refetch: abre `setCoachAnalysisModal` con el string en memoria. |
| Modal análisis | `WorkoutAnalysisOverlays.jsx` | Solo pinta. **🔧 Ajustar plan** → `adjustPlanWithAI` (sin caché). |
| Menú **⚡ Briefing IA** | `AthleteOwnCalendar.jsx` ~L287 | `onOpenBriefing` → `openBriefing` → siempre `generateBriefing`. |
| **Regenerar** | `AthleteWorkoutOverlays.jsx` L41 | `onRegenerateBriefing` = el mismo `generateBriefing`. |

### API (sitio real de Claude + el upsert)

`api/analyze-workout.js` `handler`:

- L257–268: `mode === "briefing"` → `callClaude` → `{ analysis }`. Hoy no sabe qué workout es.
- L285+: `action === "analyze"` (default) → `hydrateWorkout` + `latestVdotForAthlete` + prompt.
- L ~adjust: JSON de ajustes.
- L469+: `adjust-steps` → PATCH `structure`.

**Recomendación:** el hash, el SELECT de hit y el upsert viven **aquí** (service_role), no en el cliente. El cliente deja de escribir `localStorage` y, para hidratar **Ver análisis**, hace un SELECT de `workout_ai_cache` (RLS) o pide al API `force: false`.

---

## 3) RLS (propuesta exacta)

### Cómo funciona `workouts` hoy (prod)

| Policy | Cmd | Quién |
|---|---|---|
| Atleta ve sus propios workouts | SELECT | `athletes.user_id = auth.uid()` |
| athletes can insert/update own | INSERT/UPDATE | mismo |
| Coach ve / gestiona workouts de sus atletas | SELECT / `*` | `workouts.coach_id = auth.uid() OR is_admin()` |
| Coach ve workouts de su staff | SELECT | `coach_staff.coach_id = auth.uid()` y `staff_id = workouts.coach_id` |
| Admin ve todos | SELECT | `profiles.role = 'admin'` |

No hay policy “staff ve workouts cuyo `coach_id` es el padre”. El staff solo ve por RLS las filas que **él** asignó (`workouts.coach_id = staff`). El API es más laxo: `getWorkoutIfAllowed` / `isCoachOf` acepta staff con `staff_athletes` + `coach_staff` aunque el workout lo haya creado el coach dueño.

### Quién debe ver cada `kind`

| kind | Atleta dueño | Coach dueño del atleta | Staff asignado a ese atleta | Admin |
|---|---|---|---|---|
| `coach_analyze` | no | sí | sí (mismo criterio que `isCoachOf`) | sí |
| `athlete_briefing` | sí | sí (el coach debe poder ver lo que se le dijo al atleta) | sí | sí |

El atleta **no** lee el analyze del coach (texto post-sesión, más largo, no es el briefing).

### Writes: no desde el cliente

Igual que `push_deliveries` (0060): **ninguna policy de INSERT/UPDATE/DELETE** para `authenticated`. Escribe solo `analyze-workout` con service_role, **después** de `getWorkoutIfAllowed` (analyze) o `canAccessAthlete` (briefing). Así el atleta no puede fabricar un `coach_analyze`.

### Policies de SELECT (borrador SQL)

Helper mental: “puede ver el workout como coach/staff/admin”, alineado a `isCoachOf`, no solo a `workouts.coach_id`.

```sql
-- coach_analyze: coach dueño, staff asignado, admin
CREATE POLICY workout_ai_cache_select_coach_analyze
  ON public.workout_ai_cache FOR SELECT TO authenticated
  USING (
    kind = 'coach_analyze'
    AND EXISTS (
      SELECT 1
      FROM public.workouts w
      JOIN public.athletes a ON a.id = w.athlete_id
      WHERE w.id = workout_ai_cache.workout_id
        AND (
          public.is_admin()
          OR a.coach_id = auth.uid()
          OR w.coach_id = auth.uid()
          OR EXISTS (
            SELECT 1 FROM public.staff_athletes sa
            JOIN public.coach_staff cs
              ON cs.staff_id = sa.staff_id AND cs.coach_id = a.coach_id
            WHERE sa.athlete_id = a.id AND sa.staff_id = auth.uid()
          )
        )
    )
  );

-- athlete_briefing: atleta dueño, o el mismo círculo coach/staff/admin
CREATE POLICY workout_ai_cache_select_athlete_briefing
  ON public.workout_ai_cache FOR SELECT TO authenticated
  USING (
    kind = 'athlete_briefing'
    AND EXISTS (
      SELECT 1
      FROM public.workouts w
      JOIN public.athletes a ON a.id = w.athlete_id
      WHERE w.id = workout_ai_cache.workout_id
        AND (
          a.user_id = auth.uid()
          OR public.is_admin()
          OR a.coach_id = auth.uid()
          OR w.coach_id = auth.uid()
          OR EXISTS (
            SELECT 1 FROM public.staff_athletes sa
            JOIN public.coach_staff cs
              ON cs.staff_id = sa.staff_id AND cs.coach_id = a.coach_id
            WHERE sa.athlete_id = a.id AND sa.staff_id = auth.uid()
          )
        )
    )
  );
```

`GRANT SELECT` a `authenticated`; sin GRANT de INSERT/UPDATE. `service_role` bypasea RLS.

---

## 4) `input_hash` — no hay patrón de caché; sí hay SHA-256

No existe un hash de “inputs de IA” en el repo. Lo más cercano:

| Sitio | Uso |
|---|---|
| `api/wompi-create-checkout.js` L198 | `crypto.createHash("sha256").update(concatenated).digest("hex")` |
| `api/wompi-webhook.js` | lo mismo, integridad Wompi |

**No hace falta librería nueva.** En el API (Node): el mismo `crypto` de Node.

No hashear en el browser en v1. El API calcula el hash, compara, upserta. El cliente solo manda `force` y el workout / `workout_id`.

Constante de versión del prompt (nueva, no existe hoy): `ANALYZE_PROMPT_V = 1` y `BRIEFING_PROMPT_V = 1`. Subirla invalida todo el kind.

### Payload canónico (JSON estable, keys ordenadas)

**`coach_analyze`:** `prompt_v`, `workout_id`, `structure`, `title`, `type`, `total_km`, `duration_min`, `vdot`, `rpe`, `athlete_notes`, `actual_synced_at`, `actual_distance_km`, `actual_duration_min`, `actual_avg_pace_s`, `actual_avg_hr`, `actual_max_hr`, `manual_*` relevantes, `laps_count` (no el array crudo: el prompt usa `compareBlocks`; basta count + si hay laps).

**`athlete_briefing`:** `prompt_v`, `workout_id`, `title`, `type`, `total_km`, `duration_min`, `athlete_goal`, `fc_max`.

Invalidar si cambia el plan, el VDOT, llegan datos del reloj, o cambia el prompt. No invalidar por abrir el modal.

---

## 5) Force-refresh: no hay flag hoy

Ningún `force` / `regenerate` en `analyze-workout.js` ni en los hooks.

Comportamiento actual:

| Acción | ¿Llama a Anthropic? |
|---|---|
| **Ver análisis** (si hay `raf_analysis_*` o state) | No |
| **Analizar IA** | Siempre. Además borra el texto en state (`set … [id]: ""`) y vuelve a pedir. |
| **Briefing IA** (`openBriefing`) | Siempre (`setBriefingText("")` + `generateBriefing`) |
| **Regenerar** | Siempre (mismo `generateBriefing`) |

**Paso 2:** agregar `force` (boolean) al body.

| Acción | `force` | Comportamiento |
|---|---|---|
| Hidratar calendario / **Ver análisis** | n/a | SELECT caché (cliente o API). Sin Claude. |
| **Analizar IA** | `true` | Claude + upsert. Sustituye el “siempre regenera”. |
| **Briefing IA** (abrir) | `false` | Hit → pintar. Miss → Claude + upsert. |
| **Regenerar** | `true` | Claude + upsert. |

Si se prefiere que el primer **Analizar IA** no cobre cuando el hash sigue igual: que el menú abra el cached y un segundo control sea “Volver a analizar”. Eso es cambio de UX; el mínimo es: Ver análisis = cache, Analizar IA = force (igual que hoy, pero persistido).

---

## 6) Carreras y bordes

### Dos coaches / staff al mismo tiempo

`UNIQUE (workout_id, kind)` + `INSERT … ON CONFLICT (workout_id, kind) DO UPDATE SET text, input_hash, created_at = now()`.

Postgres serializa el upsert. No hay error de unique. **Gana el último write.** Las dos llamadas a Claude se pagan. Aceptable en v1 (el menú ya tiene `coachWorkoutAnalysisLoading` por id en **un** cliente; no hay lock entre pestañas ni entre staff).

No hace falta `SELECT … FOR UPDATE` en v1. Si duele: “si hay fila del mismo hash con `created_at` < 60 s, no llames a Claude” (best-effort).

### Briefing sin `workout_id`

Hoy el API no puede cachear. Paso 2: el cliente manda `workout_id`. El API hidrata con `getWorkoutIfAllowed` / `canAccessAthlete` y **ignora** un `prompt` libre del cliente para el hash (si no, cualquiera invalida o ensucia el caché). El prompt se arma en servidor, igual que analyze.

### Adjust no pisa analyze

Kinds distintos. Aplicar un ajuste **no** borra `coach_analyze`. Si el plan futuro cambia, el analyze del workout **completado** sigue válido (el hash del completed no incluye futuros). Si más adelante el analyze menciona “próximos entrenos”, entonces sí habría que meter un fingerprint de la semana — hoy el prompt de analyze es del workout ejecutado, no de la cola.

### `adjust-steps` sí cambia `structure` de **otro** workout

Eso no invalida el analyze del completado. Correcto.

### localStorage

En Paso 2: dejar de escribir `raf_analysis_*`. Lectura de migración: un pase que copie localStorage → tabla es opcional y no vale en otro dispositivo. Mejor ignorar y regenerar una vez con hash vacío.

### Hidratar N workouts

El `useEffect` actual itera todos los `workouts` y pega a localStorage. Sustituto: `from("workout_ai_cache").select("workout_id,text,input_hash").in("workout_id", ids).eq("kind","coach_analyze")`. RLS filtra. No meter `text` en el SELECT semanal de `workouts`.

### Workout sin `structure` / sin laps

Analyze igual corre (prompt más pobre). Hash con `structure: []` y `laps_count: 0`. Cuando lleguen laps, el hash cambia y el próximo analyze (no force) regenera. **Ver análisis** viejo se queda hasta ese click o hasta force — o el open de Registro con laps puede marcar stale. Documentar: si el coach analiza **antes** de sync del reloj, el texto queda “manual”; hay que **Analizar IA** otra vez (force) o esperar a que el hash difiera y el menú ofrezca regen. Recomendación v1: **Ver análisis** muestra lo guardado aunque el hash actual no coincida, y un chip “desactualizado” si el cliente compara… eso exige hash en el cliente o un GET. Más simple v1: hidratar texto; **Analizar IA** siempre force. El ahorro real es briefing (cada open) y no perder el analyze al cambiar de PC.

Ahorro principal del analyze: no perder el texto; no re-clickear por olvido en otro browser. El force consciente sigue cobrando.

### Service role y IDOR

`hydrateWorkout` ya usa `getWorkoutIfAllowed`. El upsert debe usar el `workout.id` **del workout permitido**, no un id crudo del body. Briefing igual.

---

## 7) Esquema propuesto (0066)

```sql
CREATE TABLE IF NOT EXISTS public.workout_ai_cache (
  id          bigint GENERATED ALWAYS AS IDENTITY PRIMARY KEY,
  workout_id  bigint NOT NULL REFERENCES public.workouts(id) ON DELETE CASCADE,
  kind        text NOT NULL CHECK (kind IN ('coach_analyze', 'athlete_briefing')),
  text        text NOT NULL,
  input_hash  text NOT NULL,
  created_at  timestamptz NOT NULL DEFAULT now(),
  UNIQUE (workout_id, kind)
);

CREATE INDEX IF NOT EXISTS workout_ai_cache_workout_idx
  ON public.workout_ai_cache (workout_id);
```

`created_at` = última escritura (el upsert lo refresca). No hace falta `updated_at` aparte.

---

## 8) Orden sugerido del Paso 2 (cuando valides)

1. Migración 0066 + RLS SELECT + sin INSERT cliente.  
2. Hash + GET/upsert en `api/analyze-workout.js` (`analyze` + `briefing` + `force`). Briefing deja de aceptar solo un `prompt` suelto: arma el texto en servidor y exige `workout_id`.  
3. `useWorkoutAnalysis`: SELECT para hidratar; `analyzeWorkoutAsCoach(..., { force: true })`; quitar `localStorage`.  
4. `useAthleteWorkoutOverlays`: `openBriefing` sin force; Regenerar con force; mandar `workout_id`.  
5. **No** tocar `adjustPlanWithAI` ni `applyAdjustment` salvo que haya que invalidar algo (no).  
6. Rate-limit de analyze/briefing: **otro PR** (`assertGenerateBudget` o techo propio). No mezclarlo en el mismo commit que la tabla si se puede evitar.

*Fin del mapeo — sin cambios de runtime en este commit.*
