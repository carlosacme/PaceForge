alter table public.workouts
  add column if not exists manual_distance_km numeric,
  add column if not exists manual_duration_min integer,
  add column if not exists manual_avg_hr integer,
  add column if not exists manual_max_hr integer,
  add column if not exists manual_calories integer,
  add column if not exists athlete_notes text,
  add column if not exists completed_at timestamptz;
