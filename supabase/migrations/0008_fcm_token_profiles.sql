-- Token FCM por usuario (profiles) y vínculo atleta ↔ auth (athletes.user_id)

ALTER TABLE public.profiles
  ADD COLUMN IF NOT EXISTS fcm_token text;

ALTER TABLE public.athletes
  ADD COLUMN IF NOT EXISTS user_id uuid REFERENCES auth.users (id) ON DELETE SET NULL;

CREATE INDEX IF NOT EXISTS athletes_user_id_idx ON public.athletes (user_id);

-- Coach puede leer perfiles de atletas vinculados (p. ej. fcm_token)
DROP POLICY IF EXISTS "profiles_select_coached_athletes" ON public.profiles;
CREATE POLICY "profiles_select_coached_athletes"
  ON public.profiles FOR SELECT
  TO authenticated
  USING (
    EXISTS (
      SELECT 1 FROM public.athletes a
      WHERE a.coach_id = auth.uid()
        AND a.user_id IS NOT NULL
        AND a.user_id = profiles.user_id
    )
  );

-- Atleta puede leer el perfil de su coach (para fcm_token del coach)
DROP POLICY IF EXISTS "profiles_athlete_read_coach" ON public.profiles;
CREATE POLICY "profiles_athlete_read_coach"
  ON public.profiles FOR SELECT
  TO authenticated
  USING (
    EXISTS (
      SELECT 1 FROM public.athletes a
      WHERE a.coach_id = profiles.user_id
        AND lower(btrim(coalesce(a.email, ''))) = lower(btrim(coalesce(auth.jwt() ->> 'email', '')))
    )
  );

-- Atleta actualiza su fila en athletes (vincular user_id) si el email coincide
DROP POLICY IF EXISTS "athletes_update_self_by_email" ON public.athletes;
CREATE POLICY "athletes_update_self_by_email"
  ON public.athletes FOR UPDATE
  TO authenticated
  USING (
    lower(btrim(coalesce(athletes.email, ''))) = lower(btrim(coalesce(auth.jwt() ->> 'email', '')))
  )
  WITH CHECK (
    lower(btrim(coalesce(athletes.email, ''))) = lower(btrim(coalesce(auth.jwt() ->> 'email', '')))
  );
