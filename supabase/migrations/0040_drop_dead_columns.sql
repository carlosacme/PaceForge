-- Borrado de columnas muertas (verificado contra todo el codigo: sin lectores
-- ni escritores). Se usa DROP COLUMN IF EXISTS porque algunas pudieron no
-- haberse creado nunca via migraciones versionadas.
--
-- workouts.intervals:
--   0 de 106 filas con datos y sin lectores en el codigo. Las apariciones de
--   "intervals" en el repo son otra cosa (intervals.icu, src/lib/intervals.js,
--   api/integrations.js, el tipo de workout "interval"), nunca esta columna.
--
-- athlete_evaluations.*_pace (easy/tempo/interval/marathon/half_marathon/
-- race_10k/race_5k):
--   Siempre null. Los ritmos viven en el jsonb 'paces' y ahora se calculan
--   con src/lib/vdot.js. La migracion que creo la tabla (0009) nunca definio
--   estas columnas; ningun codigo las lee ni escribe (EvaluationView.jsx solo
--   escribe el jsonb 'paces').

ALTER TABLE public.workouts
  DROP COLUMN IF EXISTS intervals;

ALTER TABLE public.athlete_evaluations
  DROP COLUMN IF EXISTS easy_pace,
  DROP COLUMN IF EXISTS tempo_pace,
  DROP COLUMN IF EXISTS interval_pace,
  DROP COLUMN IF EXISTS marathon_pace,
  DROP COLUMN IF EXISTS half_marathon_pace,
  DROP COLUMN IF EXISTS race_10k_pace,
  DROP COLUMN IF EXISTS race_5k_pace;

NOTIFY pgrst, 'reload schema';
