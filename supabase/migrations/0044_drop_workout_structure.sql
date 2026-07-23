-- Fuente unica de estructura: la columna `structure`.
--
-- `workout_structure` se anadio en 0030 y desde entonces convivio duplicada
-- con `structure`, con el riesgo de divergir (llego a haber filas con una
-- vacia y la otra con datos, y api/analyze-workout.js podia sobrescribir
-- datos buenos con un array vacio).
--
-- Antes de este drop:
--   - Todos los writers escriben solo `structure`
--   - readStructure() lee `structure` primero
--   - Verificado: 0 filas donde workout_structure tenga datos y structure no
--     (ni en workouts ni en workout_library)
--
-- Los blobs JSON de plan_marketplace conservan la clave workout_structure en
-- 8 planes antiguos; eso NO se toca aqui (no es una columna) y readStructure
-- lo sigue leyendo como fallback.

ALTER TABLE public.workouts
  DROP COLUMN IF EXISTS workout_structure;

ALTER TABLE public.workout_library
  DROP COLUMN IF EXISTS workout_structure;

NOTIFY pgrst, 'reload schema';
