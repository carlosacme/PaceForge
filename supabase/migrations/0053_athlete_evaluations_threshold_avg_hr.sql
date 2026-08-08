-- FC media del test de umbral.
--
-- La descripcion del test ya pedia "ingresa tu FC promedio si tienes monitor",
-- pero no existia ningun campo donde ponerla: los unicos de FC eran maxima y
-- reposo, y de ahi salio que un atleta escribiera su FC media de esfuerzo
-- (140 lpm) en el campo de FC en reposo.
--
-- Es un dato de REGISTRO para el coach: no entra en el VDOT (que se calcula
-- solo con distancia y tiempo) ni en las zonas (Karvonen con maxima y reposo).

ALTER TABLE public.athlete_evaluations
  ADD COLUMN IF NOT EXISTS threshold_avg_hr integer;

ALTER TABLE public.athlete_evaluations
  DROP CONSTRAINT IF EXISTS athlete_evaluations_threshold_avg_hr_check;

ALTER TABLE public.athlete_evaluations
  ADD CONSTRAINT athlete_evaluations_threshold_avg_hr_check
  CHECK (threshold_avg_hr IS NULL OR (threshold_avg_hr >= 60 AND threshold_avg_hr <= 250));

COMMENT ON COLUMN public.athlete_evaluations.threshold_avg_hr IS
  'FC media registrada durante el test de umbral, en lpm. Solo referencia: no interviene en el VDOT ni en las zonas.';

NOTIFY pgrst, 'reload schema';
