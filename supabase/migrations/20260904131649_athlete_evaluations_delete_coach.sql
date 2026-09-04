-- DELETE de evaluaciones VDOT: solo el coach que figura en la fila.
-- SELECT e INSERT ya existen (0009); sin esta policy el cliente recibe 200
-- y 0 filas, igual que messages antes de 0059.
--
-- USING directo sobre athlete_evaluations.coach_id. No hay join a athletes:
-- esa columna ya es el auth.users.id de quien guardó la evaluación.

DROP POLICY IF EXISTS athlete_evaluations_delete_coach ON public.athlete_evaluations;

CREATE POLICY athlete_evaluations_delete_coach
  ON public.athlete_evaluations
  FOR DELETE
  TO authenticated
  USING (auth.uid() = coach_id);

NOTIFY pgrst, 'reload schema';
