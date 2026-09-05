-- Vinculo estable workout asignado → plantilla de biblioteca.
-- workout_library.id es bigint (no uuid). NULL: Builder / Plan2Weeks / GPX /
-- marketplace IA sin id de biblioteca.
-- ON DELETE SET NULL: borrar la plantilla no tumba el calendario del atleta.

ALTER TABLE public.workouts
  ADD COLUMN IF NOT EXISTS library_id bigint REFERENCES public.workout_library(id) ON DELETE SET NULL;

CREATE INDEX IF NOT EXISTS idx_workouts_library_id
  ON public.workouts (library_id)
  WHERE library_id IS NOT NULL;

NOTIFY pgrst, 'reload schema';
