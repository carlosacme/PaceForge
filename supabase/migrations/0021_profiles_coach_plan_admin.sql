-- Plan / trial en profiles (coaches) + admin plataforma + biblioteca extendida

ALTER TABLE public.profiles
  ADD COLUMN IF NOT EXISTS plan_status text,
  ADD COLUMN IF NOT EXISTS trial_started_at timestamptz,
  ADD COLUMN IF NOT EXISTS plan_validated_at timestamptz,
  ADD COLUMN IF NOT EXISTS plan_validated_by uuid REFERENCES auth.users (id) ON DELETE SET NULL;

UPDATE public.profiles
SET plan_status = 'active'
WHERE role = 'coach' AND (plan_status IS NULL OR trim(plan_status) = '');

ALTER TABLE public.profiles
  DROP CONSTRAINT IF EXISTS profiles_plan_status_check;
ALTER TABLE public.profiles
  ADD CONSTRAINT profiles_plan_status_check
  CHECK (plan_status IS NULL OR plan_status IN ('trial', 'active', 'blocked'));

ALTER TABLE public.workout_library
  ADD COLUMN IF NOT EXISTS intensity text,
  ADD COLUMN IF NOT EXISTS notes text;

DROP POLICY IF EXISTS profiles_select_own ON public.profiles;
CREATE POLICY profiles_select_own
  ON public.profiles FOR SELECT
  TO authenticated
  USING (auth.uid() = user_id);

-- Admin plataforma (UUID fijo)
DROP POLICY IF EXISTS profiles_platform_admin_select ON public.profiles;
CREATE POLICY profiles_platform_admin_select
  ON public.profiles FOR SELECT
  TO authenticated
  USING (auth.uid() = 'b5c9e44a-6695-4800-99bd-f19b05d2f66f'::uuid);

DROP POLICY IF EXISTS profiles_platform_admin_update ON public.profiles;
CREATE POLICY profiles_platform_admin_update
  ON public.profiles FOR UPDATE
  TO authenticated
  USING (auth.uid() = 'b5c9e44a-6695-4800-99bd-f19b05d2f66f'::uuid)
  WITH CHECK (auth.uid() = 'b5c9e44a-6695-4800-99bd-f19b05d2f66f'::uuid);

DROP POLICY IF EXISTS workout_library_platform_admin_select ON public.workout_library;
CREATE POLICY workout_library_platform_admin_select
  ON public.workout_library FOR SELECT
  TO authenticated
  USING (auth.uid() = 'b5c9e44a-6695-4800-99bd-f19b05d2f66f'::uuid);

-- Coach puede actualizar su propio perfil (p. ej. marcar trial vencido → blocked)
DROP POLICY IF EXISTS profiles_update_own ON public.profiles;
CREATE POLICY profiles_update_own
  ON public.profiles FOR UPDATE
  TO authenticated
  USING (auth.uid() = user_id)
  WITH CHECK (auth.uid() = user_id);
