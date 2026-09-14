-- Timestamp de la 1ª notificación al coach de "entreno de ayer sin reloj".
-- Claim atómico para no duplicar el push si Vercel reintenta el cron el mismo día.

BEGIN;

ALTER TABLE public.workouts
  ADD COLUMN IF NOT EXISTS watch_sync_miss_notified_at timestamptz;

COMMENT ON COLUMN public.workouts.watch_sync_miss_notified_at IS
  'Primera notificación push al coach porque este workout de ayer no trajo datos de reloj. NULL = aún no avisado.';

CREATE INDEX IF NOT EXISTS idx_workouts_watch_sync_miss_notified
  ON public.workouts (watch_sync_miss_notified_at)
  WHERE watch_sync_miss_notified_at IS NOT NULL;

NOTIFY pgrst, 'reload schema';

COMMIT;
