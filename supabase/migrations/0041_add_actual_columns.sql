-- Datos REALES ejecutados, traidos desde intervals.icu (Garmin/COROS).
-- Separados de los campos manual_* (que el atleta escribe a mano) y del plan,
-- para que el coach pueda comparar planificado vs ejecutado.
--
-- El match plan<->actividad se hace por fecha (el external_id de la actividad
-- ejecutada es el ID de Garmin, no el raf-<id> que enviamos al planificarla).
-- intervals_activity_id ancla la actividad exacta y evita re-importar.
--
-- Aplicada en produccion el 2026-07-21; versionada despues.

ALTER TABLE public.workouts
  ADD COLUMN IF NOT EXISTS actual_distance_km    real,
  ADD COLUMN IF NOT EXISTS actual_duration_min   integer,
  ADD COLUMN IF NOT EXISTS actual_avg_pace_s     integer,  -- segundos/km
  ADD COLUMN IF NOT EXISTS actual_avg_hr         integer,
  ADD COLUMN IF NOT EXISTS actual_max_hr         integer,
  ADD COLUMN IF NOT EXISTS actual_elevation_m    integer,
  ADD COLUMN IF NOT EXISTS intervals_activity_id text,
  ADD COLUMN IF NOT EXISTS actual_synced_at      timestamptz;

CREATE INDEX IF NOT EXISTS idx_workouts_intervals_activity
  ON public.workouts (intervals_activity_id)
  WHERE intervals_activity_id IS NOT NULL;

NOTIFY pgrst, 'reload schema';
