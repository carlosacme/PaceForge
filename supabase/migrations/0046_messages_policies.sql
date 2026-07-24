-- Policies de `messages`: versionar las reales y cerrar el INSERT abierto.
--
-- CONTEXTO 1 — repo vs produccion:
-- El repo tenia (0003_create_messages.sql) una policy de SELECT rota:
--     using (auth.uid() = coach_id or auth.uid() = athlete_id)
-- El segundo termino nunca se cumple: `athlete_id` es athletes.id (integer),
-- no el user_id del atleta. Segun el repo un atleta no podria leer sus
-- mensajes, pero en produccion el chat funciona porque alguien corrigio la
-- policy en el dashboard sin versionarla. Esto lo alinea.
--
-- CONTEXTO 2 — el INSERT estaba abierto:
-- La policy de INSERT era WITH CHECK (true): cualquier usuario autenticado
-- podia escribir en CUALQUIER conversacion, y ademas elegir el sender_role.
-- Es decir, un usuario podia hacerse pasar por el coach de otro atleta.
-- Ahora se exige ser participante de la conversacion Y que el sender_role
-- corresponda al rol real de quien escribe.
--
-- Importa especialmente porque el chat usa Supabase Realtime, que respeta
-- RLS: una policy mal escrita hace que los eventos no lleguen, en silencio.

ALTER TABLE public.messages ENABLE ROW LEVEL SECURITY;

-- Limpieza de nombres previos (0003 y los aplicados a mano)
DROP POLICY IF EXISTS "messages_select_participants"    ON public.messages;
DROP POLICY IF EXISTS "messages_insert_participants"    ON public.messages;
DROP POLICY IF EXISTS "Usuario ve sus mensajes"         ON public.messages;
DROP POLICY IF EXISTS "Usuario inserta mensajes"        ON public.messages;
DROP POLICY IF EXISTS "Usuario actualiza sus mensajes"  ON public.messages;

-- ---------------------------------------------------------------
-- SELECT: participantes de la conversacion o admin.
-- El atleta se resuelve contra athletes.user_id (lo correcto).
-- ---------------------------------------------------------------
CREATE POLICY "Usuario ve sus mensajes"
  ON public.messages FOR SELECT
  USING (
    coach_id = auth.uid()
    OR public.is_admin()
    OR EXISTS (
      SELECT 1 FROM public.athletes a
      WHERE a.id = messages.athlete_id
        AND a.user_id = auth.uid()
    )
  );

-- ---------------------------------------------------------------
-- UPDATE: mismo criterio.
-- ---------------------------------------------------------------
CREATE POLICY "Usuario actualiza sus mensajes"
  ON public.messages FOR UPDATE
  USING (
    coach_id = auth.uid()
    OR public.is_admin()
    OR EXISTS (
      SELECT 1 FROM public.athletes a
      WHERE a.id = messages.athlete_id
        AND a.user_id = auth.uid()
    )
  );

-- ---------------------------------------------------------------
-- INSERT: solo participantes, y el sender_role debe coincidir con
-- quien realmente escribe. Antes era WITH CHECK (true).
-- ---------------------------------------------------------------
CREATE POLICY "Usuario inserta mensajes"
  ON public.messages FOR INSERT
  WITH CHECK (
    -- El coach dueño de la conversacion escribiendo como coach
    (coach_id = auth.uid() AND sender_role = 'coach')
    -- El atleta de esa conversacion escribiendo como atleta
    OR (
      sender_role = 'athlete'
      AND EXISTS (
        SELECT 1 FROM public.athletes a
        WHERE a.id = messages.athlete_id
          AND a.user_id = auth.uid()
      )
    )
    -- Admin: puede escribir en cualquier conversacion (soporte)
    OR public.is_admin()
  );

NOTIFY pgrst, 'reload schema';
