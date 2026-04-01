-- Período de prueba, aprobación admin y políticas para panel administración

ALTER TABLE public.coach_profiles
  ADD COLUMN IF NOT EXISTS trial_start timestamptz,
  ADD COLUMN IF NOT EXISTS trial_days integer,
  ADD COLUMN IF NOT EXISTS subscription_status text,
  ADD COLUMN IF NOT EXISTS approved_by_admin boolean,
  ADD COLUMN IF NOT EXISTS approved_at timestamptz,
  ADD COLUMN IF NOT EXISTS registered_at timestamptz;

-- Coaches existentes: activos de forma indefinida (no perder acceso)
UPDATE public.coach_profiles
SET
  trial_start = COALESCE(trial_start, updated_at),
  trial_days = COALESCE(trial_days, 10),
  subscription_status = COALESCE(subscription_status, 'active'),
  approved_by_admin = COALESCE(approved_by_admin, true),
  approved_at = COALESCE(approved_at, updated_at),
  registered_at = COALESCE(registered_at, updated_at);

ALTER TABLE public.coach_profiles
  ALTER COLUMN trial_start SET DEFAULT now(),
  ALTER COLUMN trial_start SET NOT NULL;

ALTER TABLE public.coach_profiles
  ALTER COLUMN trial_days SET DEFAULT 10,
  ALTER COLUMN trial_days SET NOT NULL;

ALTER TABLE public.coach_profiles
  ALTER COLUMN subscription_status SET DEFAULT 'trial';

ALTER TABLE public.coach_profiles
  ALTER COLUMN subscription_status SET NOT NULL;

ALTER TABLE public.coach_profiles
  ALTER COLUMN approved_by_admin SET DEFAULT false,
  ALTER COLUMN approved_by_admin SET NOT NULL;

ALTER TABLE public.coach_profiles
  ALTER COLUMN registered_at SET DEFAULT now(),
  ALTER COLUMN registered_at SET NOT NULL;

ALTER TABLE public.coach_profiles
  DROP CONSTRAINT IF EXISTS coach_profiles_subscription_status_check;
ALTER TABLE public.coach_profiles
  ADD CONSTRAINT coach_profiles_subscription_status_check
  CHECK (subscription_status IN ('trial', 'active', 'expired', 'blocked'));

-- Admin (mismo criterio que promo_codes)
DROP POLICY IF EXISTS coach_profiles_admin_select ON public.coach_profiles;
CREATE POLICY coach_profiles_admin_select
  ON public.coach_profiles FOR SELECT
  TO authenticated
  USING (lower(btrim(coalesce(auth.jwt() ->> 'email', ''))) = 'acostamerlano87@gmail.com');

DROP POLICY IF EXISTS coach_profiles_admin_update ON public.coach_profiles;
CREATE POLICY coach_profiles_admin_update
  ON public.coach_profiles FOR UPDATE
  TO authenticated
  USING (lower(btrim(coalesce(auth.jwt() ->> 'email', ''))) = 'acostamerlano87@gmail.com')
  WITH CHECK (lower(btrim(coalesce(auth.jwt() ->> 'email', ''))) = 'acostamerlano87@gmail.com');

DROP POLICY IF EXISTS workout_library_admin_select ON public.workout_library;
CREATE POLICY workout_library_admin_select
  ON public.workout_library FOR SELECT
  TO authenticated
  USING (lower(btrim(coalesce(auth.jwt() ->> 'email', ''))) = 'acostamerlano87@gmail.com');

-- Agregados sin depender de RLS en athletes/workouts (solo email admin)
CREATE OR REPLACE FUNCTION public.admin_coach_directory_stats()
RETURNS TABLE (
  coach_id uuid,
  athlete_count bigint,
  total_km_done numeric
)
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = public
AS $$
BEGIN
  IF lower(btrim(coalesce(auth.jwt() ->> 'email', ''))) IS DISTINCT FROM 'acostamerlano87@gmail.com' THEN
    RAISE EXCEPTION 'not allowed' USING ERRCODE = '42501';
  END IF;
  RETURN QUERY
  SELECT
    c.user_id,
    (SELECT count(*)::bigint FROM public.athletes a WHERE a.coach_id = c.user_id),
    coalesce((
      SELECT sum(w.total_km)::numeric
      FROM public.workouts w
      WHERE w.coach_id = c.user_id AND w.done = true
    ), 0)
  FROM public.coach_profiles c;
END;
$$;

GRANT EXECUTE ON FUNCTION public.admin_coach_directory_stats() TO authenticated;
