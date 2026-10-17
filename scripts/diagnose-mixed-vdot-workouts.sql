-- diagnose-mixed-vdot-workouts.sql
-- SOLO LECTURA. No hace UPDATE/INSERT/DELETE.
-- Pegar en el SQL editor de Supabase (o psql) cuando Carlos lo autorice.
-- No infiere VDOT por paso (eso es el .mjs); esto inventaría y cuenta.

-- A) Inventario
SELECT
  count(*) AS entrenos_con_structure,
  count(*) FILTER (WHERE generated_with_vdot IS NOT NULL) AS con_origen_vdot,
  count(*) FILTER (WHERE generated_with_vdot IS NULL) AS sin_origen_vdot,
  count(*) FILTER (
    WHERE coalesce(done, false) = false
      AND scheduled_date >= current_date
  ) AS pendientes_futuros,
  count(*) FILTER (WHERE coalesce(done, false) = true) AS hechos,
  count(*) FILTER (
    WHERE description ~* '\d{1,2}:[0-5]\d.*\/\s*km'
  ) AS description_con_ritmo_km
FROM public.workouts
WHERE structure IS NOT NULL
  AND jsonb_typeof(structure) = 'array'
  AND jsonb_array_length(structure) > 0;

-- B) Pasos: cuántos traen target_zone (el rescale actual solo lo escribe
--    si paceToZone acertó; las recetas no lo guardan)
SELECT
  count(*) AS pasos,
  count(*) FILTER (
    WHERE nullif(btrim(step->>'target_zone'), '') IS NOT NULL
  ) AS pasos_con_target_zone,
  count(*) FILTER (
    WHERE coalesce(step->>'target_pace', step->>'pace', '') ~ '\d{1,2}:[0-5]\d'
  ) AS pasos_con_ritmo_numerico
FROM public.workouts w
CROSS JOIN LATERAL jsonb_array_elements(w.structure) AS step
WHERE jsonb_typeof(w.structure) = 'array';

-- C) Ritmos distintos dentro de un mismo entreno (texto, no VDOT).
--    Un Long Progresivo E+M tiene 2 ritmos a propósito: no es bug.
--    Sirve para muestrear. El mezclado REAL de VDOT lo marca el .mjs.
SELECT
  w.id,
  w.title,
  w.scheduled_date,
  w.done,
  w.generated_with_vdot,
  (
    SELECT count(DISTINCT regexp_replace(
      coalesce(s->>'target_pace', s->>'pace', ''),
      '\s*/\s*km.*$',
      ''
    ))
    FROM jsonb_array_elements(w.structure) s
    WHERE coalesce(s->>'target_pace', s->>'pace', '') ~ '\d{1,2}:[0-5]\d'
  ) AS ritmos_distintos_en_pasos,
  left(w.description, 180) AS description_head
FROM public.workouts w
WHERE jsonb_typeof(w.structure) = 'array'
  AND jsonb_array_length(w.structure) > 0
  AND w.description ~* '\d{1,2}:[0-5]\d.*\/\s*km'
ORDER BY w.scheduled_date DESC
LIMIT 50;

-- D) Muestra de pasos de un entreno concreto (sustituir :id)
-- SELECT
--   ordinality AS paso,
--   step->>'block_type' AS block_type,
--   step->>'description' AS description,
--   step->>'target_pace' AS target_pace,
--   step->>'pace' AS pace,
--   step->>'target_zone' AS target_zone
-- FROM public.workouts w
-- CROSS JOIN LATERAL jsonb_array_elements(w.structure) WITH ORDINALITY AS step
-- WHERE w.id = :id;
