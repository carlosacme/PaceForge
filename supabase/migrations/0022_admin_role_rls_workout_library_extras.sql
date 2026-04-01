-- RLS por role=admin (sustituye políticas solo-UUID) + campos extra biblioteca + email en profiles

ALTER TABLE public.workout_library
  ADD COLUMN IF NOT EXISTS distance_km numeric,
  ADD COLUMN IF NOT EXISTS workout_type text;

UPDATE public.workout_library wl
SET
  distance_km = COALESCE(wl.distance_km, wl.total_km),
  workout_type = COALESCE(NULLIF(trim(wl.workout_type), ''), wl.type)
WHERE wl.distance_km IS NULL OR wl.workout_type IS NULL;

ALTER TABLE public.profiles
  ADD COLUMN IF NOT EXISTS email text;

DROP POLICY IF EXISTS profiles_platform_admin_select ON public.profiles;
DROP POLICY IF EXISTS profiles_platform_admin_update ON public.profiles;
DROP POLICY IF EXISTS workout_library_platform_admin_select ON public.workout_library;

CREATE POLICY profiles_admin_role_select_all
  ON public.profiles FOR SELECT
  TO authenticated
  USING (
    EXISTS (
      SELECT 1 FROM public.profiles pr
      WHERE pr.user_id = auth.uid() AND pr.role = 'admin'
    )
  );

CREATE POLICY profiles_admin_role_update_all
  ON public.profiles FOR UPDATE
  TO authenticated
  USING (
    EXISTS (
      SELECT 1 FROM public.profiles pr
      WHERE pr.user_id = auth.uid() AND pr.role = 'admin'
    )
  )
  WITH CHECK (
    EXISTS (
      SELECT 1 FROM public.profiles pr
      WHERE pr.user_id = auth.uid() AND pr.role = 'admin'
    )
  );

CREATE POLICY workout_library_admin_role_select_all
  ON public.workout_library FOR SELECT
  TO authenticated
  USING (
    EXISTS (
      SELECT 1 FROM public.profiles pr
      WHERE pr.user_id = auth.uid() AND pr.role = 'admin'
    )
  );
