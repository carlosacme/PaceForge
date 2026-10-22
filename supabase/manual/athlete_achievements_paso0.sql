-- =============================================================================
-- PASO 0 — duplicados de athlete_achievements (PRODUCCIÓN)
-- =============================================================================
-- Orden obligatorio (no saltar):
--   1) Desplegar el cliente que trata 409 / "ya lo tenía" (sin toast) y
--      comprueba existentes ANTES de insertar. Esperar ~1 día por el
--      service worker (caché del JS viejo que sigue insertando).
--   2) Este archivo: A backup → B listado dry-run. PEGAR B y aprobar.
--      NO correr C ni D hasta esa aprobación.
--   3) C DELETE (conserva min(id) por athlete_id+achievement_code).
--   4) D CREATE UNIQUE INDEX.
--   5) Recién entonces el backfill de achieved_on
--      (scripts/backfill-achievement-dates.mjs, default dry-run).
--
-- Nada de esto es migración automática. No hay FK; no hace falta tocar
-- public.achievements.
-- =============================================================================

-- A) BACKUP (escritura de tabla nueva; no toca athlete_achievements)
--    Correr UNA vez. Si la tabla ya existe, abortar y no pisar el backup.
-- CREATE TABLE public.athlete_achievements_backup_paso0 AS
-- SELECT * FROM public.athlete_achievements;

-- B) DRY-RUN — resumen (solo lectura)
SELECT
  athlete_id,
  achievement_code,
  count(*) AS copias,
  min(id) AS keep_id,
  count(*) - 1 AS a_borrar,
  min(earned_at) AS earned_at_min,
  max(earned_at) AS earned_at_max
FROM public.athlete_achievements
GROUP BY athlete_id, achievement_code
HAVING count(*) > 1
ORDER BY a_borrar DESC, athlete_id, achievement_code;

-- B2) DRY-RUN — filas que se borrarían (conserva el id más bajo)
SELECT
  d.id,
  d.athlete_id,
  d.achievement_code,
  d.value,
  d.earned_at
FROM public.athlete_achievements d
INNER JOIN (
  SELECT athlete_id, achievement_code, min(id) AS keep_id
  FROM public.athlete_achievements
  GROUP BY athlete_id, achievement_code
  HAVING count(*) > 1
) k
  ON k.athlete_id = d.athlete_id
 AND k.achievement_code = d.achievement_code
WHERE d.id <> k.keep_id
ORDER BY d.athlete_id, d.achievement_code, d.id;

-- B3) Totales
SELECT
  count(*) AS filas_totales,
  (SELECT count(*) FROM (
     SELECT 1 FROM public.athlete_achievements
     GROUP BY athlete_id, achievement_code HAVING count(*) > 1
   ) dup_groups) AS grupos_duplicados,
  (SELECT coalesce(sum(c - 1), 0) FROM (
     SELECT count(*) AS c FROM public.athlete_achievements
     GROUP BY athlete_id, achievement_code HAVING count(*) > 1
   ) x) AS filas_a_borrar;

-- C) DELETE — NO EJECUTAR hasta aprobación del listado B
-- DELETE FROM public.athlete_achievements d
-- USING (
--   SELECT athlete_id, achievement_code, min(id) AS keep_id
--   FROM public.athlete_achievements
--   GROUP BY athlete_id, achievement_code
--   HAVING count(*) > 1
-- ) k
-- WHERE d.athlete_id = k.athlete_id
--   AND d.achievement_code = k.achievement_code
--   AND d.id <> k.keep_id;

-- D) UNIQUE — solo cuando B3.filas_a_borrar = 0
-- CREATE UNIQUE INDEX IF NOT EXISTS athlete_achievements_athlete_code_uq
--   ON public.athlete_achievements (athlete_id, achievement_code);
