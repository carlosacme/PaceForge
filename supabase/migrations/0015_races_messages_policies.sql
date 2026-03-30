-- Carreras: coach puede editar y eliminar
DROP POLICY IF EXISTS races_update_coach ON public.races;
CREATE POLICY races_update_coach
  ON public.races FOR UPDATE
  TO authenticated
  USING (coach_id = auth.uid())
  WITH CHECK (coach_id = auth.uid());

DROP POLICY IF EXISTS races_delete_coach ON public.races;
CREATE POLICY races_delete_coach
  ON public.races FOR DELETE
  TO authenticated
  USING (coach_id = auth.uid());

-- Chat: coach y atleta pueden borrar mensajes de su conversación
DROP POLICY IF EXISTS messages_delete_coach ON public.messages;
CREATE POLICY messages_delete_coach
  ON public.messages FOR DELETE
  TO authenticated
  USING (coach_id = auth.uid());

DROP POLICY IF EXISTS messages_delete_athlete ON public.messages;
CREATE POLICY messages_delete_athlete
  ON public.messages FOR DELETE
  TO authenticated
  USING (
    EXISTS (
      SELECT 1
      FROM public.athletes a
      WHERE a.id = messages.athlete_id
        AND (
          a.user_id = auth.uid()
          OR lower(btrim(coalesce(a.email, ''))) = lower(btrim(coalesce(auth.jwt() ->> 'email', '')))
        )
    )
  );
