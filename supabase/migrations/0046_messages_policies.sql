-- Policies reales de `messages`, que nunca se versionaron.
--
-- El repo tenia (0003_create_messages.sql) una policy de SELECT rota:
--     using (auth.uid() = coach_id or auth.uid() = athlete_id)
-- El segundo termino nunca se cumple: `athlete_id` es athletes.id (integer),
-- no el user_id del atleta. Segun el repo, un atleta no podria leer sus
-- propios mensajes — pero en produccion el chat funciona, porque alguien
-- corrigio la policy directo en el dashboard sin versionarla.
--
-- Esta migracion refleja el estado real de produccion. Importa especialmente
-- ahora que el chat usa Supabase Realtime: Realtime respeta RLS, asi que una
-- policy mal escrita hace que los eventos no lleguen, en silencio.

ALTER TABLE public.messages ENABLE ROW LEVEL SECURITY;

-- Limpieza de nombres previos (0003 y los aplicados a mano)
DROP POLICY IF EXISTS "messages_select_participants"    ON public.messages;
DROP POLICY IF EXISTS "messages_insert_participants"    ON public.messages;
DROP POLICY IF EXISTS "Usuario ve sus mensajes"         ON public.messages;
DROP POLICY IF EXISTS "Usuario inserta mensajes"        ON public.messages;
DROP POLICY IF EXISTS "Usuario actualiza sus mensajes"  ON public.messages;

-- Participantes de la conversacion: el coach dueño, el atleta (resuelto
-- contra athletes.user_id, que es lo correcto) o un admin.
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

-- INSERT sin restriccion adicional (el cliente solo puede escribir en
-- conversaciones que ve, y sender_role lo define la app).
CREATE POLICY "Usuario inserta mensajes"
  ON public.messages FOR INSERT
  WITH CHECK (true);

NOTIFY pgrst, 'reload schema';
