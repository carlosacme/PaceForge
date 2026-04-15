alter table public.workouts
  add column if not exists workout_structure jsonb;

alter table public.workout_library
  add column if not exists workout_structure jsonb;
