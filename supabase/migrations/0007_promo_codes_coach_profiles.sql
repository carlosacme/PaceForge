-- Códigos promocionales (admin por email) y perfiles extendidos de coach

CREATE TABLE IF NOT EXISTS public.promo_codes (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  code text NOT NULL UNIQUE,
  discount_percent numeric NOT NULL CHECK (discount_percent >= 0 AND discount_percent <= 100),
  max_uses integer NOT NULL DEFAULT 1 CHECK (max_uses >= 0),
  uses_count integer NOT NULL DEFAULT 0 CHECK (uses_count >= 0),
  expires_at timestamptz,
  active boolean NOT NULL DEFAULT true,
  created_at timestamptz NOT NULL DEFAULT now()
);

CREATE INDEX IF NOT EXISTS promo_codes_code_upper_idx ON public.promo_codes (upper(trim(code)));

ALTER TABLE public.promo_codes ENABLE ROW LEVEL SECURITY;

DROP POLICY IF EXISTS promo_codes_admin_select ON public.promo_codes;
DROP POLICY IF EXISTS promo_codes_admin_insert ON public.promo_codes;
DROP POLICY IF EXISTS promo_codes_admin_update ON public.promo_codes;
DROP POLICY IF EXISTS promo_codes_admin_delete ON public.promo_codes;

CREATE POLICY promo_codes_admin_select
  ON public.promo_codes FOR SELECT
  TO authenticated
  USING (lower(coalesce(auth.jwt() ->> 'email', '')) = 'acostamerlano87@gmail.com');

CREATE POLICY promo_codes_admin_insert
  ON public.promo_codes FOR INSERT
  TO authenticated
  WITH CHECK (lower(coalesce(auth.jwt() ->> 'email', '')) = 'acostamerlano87@gmail.com');

CREATE POLICY promo_codes_admin_update
  ON public.promo_codes FOR UPDATE
  TO authenticated
  USING (lower(coalesce(auth.jwt() ->> 'email', '')) = 'acostamerlano87@gmail.com')
  WITH CHECK (lower(coalesce(auth.jwt() ->> 'email', '')) = 'acostamerlano87@gmail.com');

CREATE POLICY promo_codes_admin_delete
  ON public.promo_codes FOR DELETE
  TO authenticated
  USING (lower(coalesce(auth.jwt() ->> 'email', '')) = 'acostamerlano87@gmail.com');

CREATE OR REPLACE FUNCTION public.validate_promo_code(code_input text)
RETURNS TABLE (
  id uuid,
  discount_percent numeric,
  max_uses integer,
  uses_count integer
)
LANGUAGE sql
SECURITY DEFINER
SET search_path = public
AS $$
  SELECT p.id, p.discount_percent, p.max_uses, p.uses_count
  FROM public.promo_codes p
  WHERE upper(trim(p.code)) = upper(trim(code_input))
    AND p.active = true
    AND (p.expires_at IS NULL OR p.expires_at > now())
    AND p.uses_count < p.max_uses;
$$;

CREATE OR REPLACE FUNCTION public.redeem_promo_code(code_input text)
RETURNS boolean
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = public
AS $$
BEGIN
  UPDATE public.promo_codes
  SET uses_count = uses_count + 1
  WHERE upper(trim(code)) = upper(trim(code_input))
    AND active = true
    AND (expires_at IS NULL OR expires_at > now())
    AND uses_count < max_uses;
  RETURN FOUND;
END;
$$;

GRANT EXECUTE ON FUNCTION public.validate_promo_code(text) TO authenticated;
GRANT EXECUTE ON FUNCTION public.redeem_promo_code(text) TO authenticated;

CREATE TABLE IF NOT EXISTS public.coach_profiles (
  user_id uuid PRIMARY KEY REFERENCES auth.users (id) ON DELETE CASCADE,
  avatar_url text,
  full_name text,
  email text,
  phone text,
  country text,
  city text,
  timezone text,
  language text DEFAULT 'es',
  currency text DEFAULT 'COP',
  notify_new_workouts boolean NOT NULL DEFAULT true,
  notify_reminders boolean NOT NULL DEFAULT true,
  subscription_plan text,
  subscription_renews_at date,
  updated_at timestamptz NOT NULL DEFAULT now()
);

ALTER TABLE public.coach_profiles ENABLE ROW LEVEL SECURITY;

DROP POLICY IF EXISTS coach_profiles_select_own ON public.coach_profiles;
DROP POLICY IF EXISTS coach_profiles_insert_own ON public.coach_profiles;
DROP POLICY IF EXISTS coach_profiles_update_own ON public.coach_profiles;
DROP POLICY IF EXISTS coach_profiles_delete_own ON public.coach_profiles;

CREATE POLICY coach_profiles_select_own
  ON public.coach_profiles FOR SELECT
  USING (auth.uid() = user_id);

CREATE POLICY coach_profiles_insert_own
  ON public.coach_profiles FOR INSERT
  WITH CHECK (auth.uid() = user_id);

CREATE POLICY coach_profiles_update_own
  ON public.coach_profiles FOR UPDATE
  USING (auth.uid() = user_id);

CREATE POLICY coach_profiles_delete_own
  ON public.coach_profiles FOR DELETE
  USING (auth.uid() = user_id);

INSERT INTO storage.buckets (id, name, public)
VALUES ('coach-avatars', 'coach-avatars', true)
ON CONFLICT (id) DO NOTHING;

DROP POLICY IF EXISTS "coach_avatars_select" ON storage.objects;
DROP POLICY IF EXISTS "coach_avatars_insert_own" ON storage.objects;
DROP POLICY IF EXISTS "coach_avatars_update_own" ON storage.objects;
DROP POLICY IF EXISTS "coach_avatars_delete_own" ON storage.objects;

CREATE POLICY "coach_avatars_select"
  ON storage.objects FOR SELECT
  USING (bucket_id = 'coach-avatars');

CREATE POLICY "coach_avatars_insert_own"
  ON storage.objects FOR INSERT
  TO authenticated
  WITH CHECK (
    bucket_id = 'coach-avatars'
    AND (storage.foldername(name))[1] = auth.uid()::text
  );

CREATE POLICY "coach_avatars_update_own"
  ON storage.objects FOR UPDATE
  TO authenticated
  USING (
    bucket_id = 'coach-avatars'
    AND (storage.foldername(name))[1] = auth.uid()::text
  );

CREATE POLICY "coach_avatars_delete_own"
  ON storage.objects FOR DELETE
  TO authenticated
  USING (
    bucket_id = 'coach-avatars'
    AND (storage.foldername(name))[1] = auth.uid()::text
  );
