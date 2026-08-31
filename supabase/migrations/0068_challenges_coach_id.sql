-- Retos de equipo: coach_id nullable.
-- null = reto global de admin (visible a todos, como hoy).
-- uuid = reto del coach; solo él lo edita/borra y el ranking se recorta a su roster.

ALTER TABLE public.challenges
  ADD COLUMN IF NOT EXISTS coach_id uuid REFERENCES auth.users (id) ON DELETE SET NULL;

CREATE INDEX IF NOT EXISTS challenges_coach_id_idx
  ON public.challenges (coach_id)
  WHERE coach_id IS NOT NULL;

COMMENT ON COLUMN public.challenges.coach_id IS
  'Dueño del reto de equipo. NULL = reto global (admin).';

ALTER TABLE public.challenges ENABLE ROW LEVEL SECURITY;

DROP POLICY IF EXISTS "Retos visibles para autenticados" ON public.challenges;
DROP POLICY IF EXISTS "Coach/admin crea retos" ON public.challenges;
DROP POLICY IF EXISTS "Coach/admin actualiza retos" ON public.challenges;
DROP POLICY IF EXISTS "Admin elimina retos" ON public.challenges;
DROP POLICY IF EXISTS challenges_select ON public.challenges;
DROP POLICY IF EXISTS challenges_insert ON public.challenges;
DROP POLICY IF EXISTS challenges_update ON public.challenges;
DROP POLICY IF EXISTS challenges_delete ON public.challenges;

-- Globales: cualquiera autenticado. De equipo: el coach, sus atletas, o admin.
CREATE POLICY challenges_select
  ON public.challenges FOR SELECT
  TO authenticated
  USING (
    public.is_admin()
    OR coach_id IS NULL
    OR coach_id = auth.uid()
    OR EXISTS (
      SELECT 1
      FROM public.athletes a
      WHERE a.user_id = auth.uid()
        AND a.coach_id IS NOT DISTINCT FROM public.challenges.coach_id
    )
  );

-- Admin: cualquier fila (globales con coach_id null). Coach: solo las suyas.
CREATE POLICY challenges_insert
  ON public.challenges FOR INSERT
  TO authenticated
  WITH CHECK (
    public.is_admin()
    OR (
      coach_id = auth.uid()
      AND created_by = auth.uid()
    )
  );

CREATE POLICY challenges_update
  ON public.challenges FOR UPDATE
  TO authenticated
  USING (
    public.is_admin()
    OR coach_id = auth.uid()
  )
  WITH CHECK (
    public.is_admin()
    OR (
      coach_id = auth.uid()
      AND coach_id IS NOT NULL
    )
  );

CREATE POLICY challenges_delete
  ON public.challenges FOR DELETE
  TO authenticated
  USING (
    public.is_admin()
    OR coach_id = auth.uid()
  );

GRANT SELECT, INSERT, UPDATE, DELETE ON public.challenges TO authenticated;

NOTIFY pgrst, 'reload schema';
