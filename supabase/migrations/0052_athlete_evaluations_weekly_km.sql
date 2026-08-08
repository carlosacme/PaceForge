-- Kilometraje semanal que el atleta declara en el momento de la evaluacion.
-- Es el dato que fija el VOLUMEN del plan de 2 semanas: hasta ahora el volumen
-- salia de una tabla fija por distancia objetivo (maraton 50 km, media 35...),
-- asi que dos atletas con estados muy distintos recibian la misma carga.
--
-- Se guarda en la evaluacion (no solo en athletes) para tener historico: el
-- volumen declarado cambia con el tiempo igual que el VDOT, y el plan debe
-- usar el de la evaluacion mas reciente.
--
-- 0 es un valor valido y significativo: "viene de una pausa". En ese caso
-- Plan2Weeks aplica el piso de arranque por nivel (STARTING_WEEKLY_KM).

ALTER TABLE public.athlete_evaluations
  ADD COLUMN IF NOT EXISTS weekly_km_declared integer;

ALTER TABLE public.athlete_evaluations
  DROP CONSTRAINT IF EXISTS athlete_evaluations_weekly_km_declared_check;

ALTER TABLE public.athlete_evaluations
  ADD CONSTRAINT athlete_evaluations_weekly_km_declared_check
  CHECK (weekly_km_declared IS NULL OR (weekly_km_declared >= 0 AND weekly_km_declared <= 400));

COMMENT ON COLUMN public.athlete_evaluations.weekly_km_declared IS
  'Km/semana que corre el atleta al hacer la evaluacion. NULL = no declarado, 0 = viene de pausa.';

NOTIFY pgrst, 'reload schema';
