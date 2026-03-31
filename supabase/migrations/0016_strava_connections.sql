CREATE TABLE IF NOT EXISTS public.strava_connections (
  user_id uuid PRIMARY KEY REFERENCES auth.users (id) ON DELETE CASCADE,
  athlete_id_strava bigint,
  access_token text,
  refresh_token text,
  expires_at bigint,
  strava_athlete_name text,
  created_at timestamptz NOT NULL DEFAULT now()
);

ALTER TABLE public.strava_connections ENABLE ROW LEVEL SECURITY;

DROP POLICY IF EXISTS strava_connections_select_own ON public.strava_connections;
CREATE POLICY strava_connections_select_own
  ON public.strava_connections FOR SELECT
  TO authenticated
  USING (user_id = auth.uid());

DROP POLICY IF EXISTS strava_connections_insert_own ON public.strava_connections;
CREATE POLICY strava_connections_insert_own
  ON public.strava_connections FOR INSERT
  TO authenticated
  WITH CHECK (user_id = auth.uid());

DROP POLICY IF EXISTS strava_connections_update_own ON public.strava_connections;
CREATE POLICY strava_connections_update_own
  ON public.strava_connections FOR UPDATE
  TO authenticated
  USING (user_id = auth.uid())
  WITH CHECK (user_id = auth.uid());

DROP POLICY IF EXISTS strava_connections_delete_own ON public.strava_connections;
CREATE POLICY strava_connections_delete_own
  ON public.strava_connections FOR DELETE
  TO authenticated
  USING (user_id = auth.uid());
