ALTER TABLE public.strava_connections
  ADD COLUMN IF NOT EXISTS athlete_id uuid REFERENCES public.athletes (id) ON DELETE CASCADE;

CREATE UNIQUE INDEX IF NOT EXISTS strava_connections_athlete_id_key
  ON public.strava_connections (athlete_id)
  WHERE athlete_id IS NOT NULL;

DROP POLICY IF EXISTS strava_connections_select_coach ON public.strava_connections;
CREATE POLICY strava_connections_select_coach
  ON public.strava_connections FOR SELECT
  TO authenticated
  USING (
    EXISTS (
      SELECT 1
      FROM public.athletes a
      WHERE a.id = strava_connections.athlete_id
        AND a.coach_id = auth.uid()
    )
  );

DROP POLICY IF EXISTS strava_connections_select_athlete ON public.strava_connections;
CREATE POLICY strava_connections_select_athlete
  ON public.strava_connections FOR SELECT
  TO authenticated
  USING (
    EXISTS (
      SELECT 1
      FROM public.athletes a
      WHERE a.id = strava_connections.athlete_id
        AND (
          a.user_id = auth.uid()
          OR lower(btrim(coalesce(a.email, ''))) = lower(btrim(coalesce(auth.jwt() ->> 'email', '')))
        )
    )
  );

DROP POLICY IF EXISTS strava_connections_insert_coach ON public.strava_connections;
CREATE POLICY strava_connections_insert_coach
  ON public.strava_connections FOR INSERT
  TO authenticated
  WITH CHECK (
    EXISTS (
      SELECT 1
      FROM public.athletes a
      WHERE a.id = strava_connections.athlete_id
        AND a.coach_id = auth.uid()
    )
  );

DROP POLICY IF EXISTS strava_connections_insert_athlete ON public.strava_connections;
CREATE POLICY strava_connections_insert_athlete
  ON public.strava_connections FOR INSERT
  TO authenticated
  WITH CHECK (
    EXISTS (
      SELECT 1
      FROM public.athletes a
      WHERE a.id = strava_connections.athlete_id
        AND (
          a.user_id = auth.uid()
          OR lower(btrim(coalesce(a.email, ''))) = lower(btrim(coalesce(auth.jwt() ->> 'email', '')))
        )
    )
  );

DROP POLICY IF EXISTS strava_connections_update_coach ON public.strava_connections;
CREATE POLICY strava_connections_update_coach
  ON public.strava_connections FOR UPDATE
  TO authenticated
  USING (
    EXISTS (
      SELECT 1
      FROM public.athletes a
      WHERE a.id = strava_connections.athlete_id
        AND a.coach_id = auth.uid()
    )
  )
  WITH CHECK (
    EXISTS (
      SELECT 1
      FROM public.athletes a
      WHERE a.id = strava_connections.athlete_id
        AND a.coach_id = auth.uid()
    )
  );

DROP POLICY IF EXISTS strava_connections_update_athlete ON public.strava_connections;
CREATE POLICY strava_connections_update_athlete
  ON public.strava_connections FOR UPDATE
  TO authenticated
  USING (
    EXISTS (
      SELECT 1
      FROM public.athletes a
      WHERE a.id = strava_connections.athlete_id
        AND (
          a.user_id = auth.uid()
          OR lower(btrim(coalesce(a.email, ''))) = lower(btrim(coalesce(auth.jwt() ->> 'email', '')))
        )
    )
  )
  WITH CHECK (
    EXISTS (
      SELECT 1
      FROM public.athletes a
      WHERE a.id = strava_connections.athlete_id
        AND (
          a.user_id = auth.uid()
          OR lower(btrim(coalesce(a.email, ''))) = lower(btrim(coalesce(auth.jwt() ->> 'email', '')))
        )
    )
  );

DROP POLICY IF EXISTS strava_connections_delete_coach ON public.strava_connections;
CREATE POLICY strava_connections_delete_coach
  ON public.strava_connections FOR DELETE
  TO authenticated
  USING (
    EXISTS (
      SELECT 1
      FROM public.athletes a
      WHERE a.id = strava_connections.athlete_id
        AND a.coach_id = auth.uid()
    )
  );

DROP POLICY IF EXISTS strava_connections_delete_athlete ON public.strava_connections;
CREATE POLICY strava_connections_delete_athlete
  ON public.strava_connections FOR DELETE
  TO authenticated
  USING (
    EXISTS (
      SELECT 1
      FROM public.athletes a
      WHERE a.id = strava_connections.athlete_id
        AND (
          a.user_id = auth.uid()
          OR lower(btrim(coalesce(a.email, ''))) = lower(btrim(coalesce(auth.jwt() ->> 'email', '')))
        )
    )
  );
