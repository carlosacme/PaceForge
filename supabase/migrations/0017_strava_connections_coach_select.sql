DROP POLICY IF EXISTS strava_connections_select_coach ON public.strava_connections;
CREATE POLICY strava_connections_select_coach
  ON public.strava_connections FOR SELECT
  TO authenticated
  USING (
    EXISTS (
      SELECT 1
      FROM public.athletes a
      WHERE a.user_id = strava_connections.user_id
        AND a.coach_id = auth.uid()
    )
  );
