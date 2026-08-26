-- Timestamp de la 1ª notificación al coach de "workout completado".
-- Sirve de claim atómico para no duplicar push (marcado manual + webhook ICU).

BEGIN;

ALTER TABLE public.workouts
  ADD COLUMN IF NOT EXISTS coach_completion_notified_at timestamptz;

COMMENT ON COLUMN public.workouts.coach_completion_notified_at IS
  'Primera notificación push al coach por este workout completado (manual o webhook). NULL = aún no avisado.';

CREATE INDEX IF NOT EXISTS idx_workouts_coach_completion_notified
  ON public.workouts (coach_completion_notified_at)
  WHERE coach_completion_notified_at IS NOT NULL;

NOTIFY pgrst, 'reload schema';

COMMIT;
