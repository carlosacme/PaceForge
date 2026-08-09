-- Policies de `messages`: cerrar el INSERT abierto (otra vez) y crear el DELETE
-- que nunca existio en la base.
--
-- ESTADO REAL EN PRODUCCION antes de esta migracion (consultado en pg_policy):
--   INSERT  "Usuario inserta mensajes"    WITH CHECK (true)      <-- abierto
--   SELECT  "Usuario ve sus mensajes"     participantes + admin   (correcta)
--   UPDATE  "Usuario actualiza sus mensajes" participantes + admin (correcta)
--   DELETE  -- ninguna --                                        <-- falta
--
-- CONSECUENCIA 1 (seguridad): con WITH CHECK (true) cualquier usuario
-- autenticado puede insertar en CUALQUIER conversacion y elegir el sender_role,
-- o sea hacerse pasar por el coach de otro atleta o por otro atleta. La
-- migracion 0046 ya escribio la policy correcta, pero la base tiene la laxa:
-- alguien la reemplazo desde el dashboard despues. Esto la vuelve a poner.
--
-- CONSECUENCIA 2 (funcional): sin policy de DELETE, RLS niega todo borrado y la
-- API de Supabase responde 200 con 0 filas. Por eso "limpiar el chat" y el
-- borrado de mensajes al eliminar un atleta fallan EN SILENCIO. Las policies de
-- DELETE de 0015 no llegaron nunca a produccion.
--
-- Importa especialmente porque el chat usa Supabase Realtime, que respeta RLS:
-- una policy mal escrita hace que los eventos no lleguen, sin ningun error.
--
-- STAFF: a proposito NO se incluye a staff_athletes en ninguna rama. Las
-- policies de SELECT y UPDATE no contemplan al staff, asi que darle INSERT y
-- DELETE lo dejaria escribiendo y borrando mensajes que no puede leer. Hoy
-- ningun flujo de la app escribe en el chat como staff. Cuando haga falta, se
-- añade a las CUATRO policies de una vez.

ALTER TABLE public.messages ENABLE ROW LEVEL SECURITY;

-- ---------------------------------------------------------------
-- INSERT: participante de la conversacion Y sender_role coherente
-- con quien escribe de verdad. Reemplaza el WITH CHECK (true).
--
-- Sobre 0046 se anade una sola condicion en la rama del atleta:
-- que el coach_id de la fila sea el coach real del atleta. Sin
-- ella un atleta podria colar mensajes en la bandeja de un coach
-- que no es el suyo. La app siempre envia athleteInfo.coach_id,
-- asi que no cambia nada para el uso normal (verificado: las 37
-- filas existentes cumplen messages.coach_id = athletes.coach_id).
-- ---------------------------------------------------------------
DROP POLICY IF EXISTS "messages_insert_participants" ON public.messages;
DROP POLICY IF EXISTS "messages_insert_coach"        ON public.messages;
DROP POLICY IF EXISTS "messages_insert_athlete"      ON public.messages;
DROP POLICY IF EXISTS "Usuario inserta mensajes"     ON public.messages;

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
          AND a.coach_id = messages.coach_id
      )
    )
    -- Admin: soporte, puede escribir en cualquier conversacion
    OR public.is_admin()
  );

-- ---------------------------------------------------------------
-- DELETE: exactamente el mismo criterio de participante que SELECT
-- y UPDATE. El coach borra la conversacion con SU atleta; el atleta
-- los mensajes de su propia conversacion; el admin, cualquiera (lo
-- necesita el borrado de atleta desde el panel de admin).
--
-- La rama del atleta NO lleva a.coach_id = messages.coach_id, al
-- contrario que en el INSERT: aqui el criterio debe coincidir con
-- el de SELECT, o el atleta veria mensajes viejos (de un coach
-- anterior) que no puede borrar.
--
-- Se resuelve al atleta SOLO por athletes.user_id, sin el fallback
-- por email que traia 0015, por el mismo motivo de coherencia. Hoy
-- los 7 atletas tienen user_id, y sin user_id el atleta ya no puede
-- ni leer sus mensajes.
-- ---------------------------------------------------------------
DROP POLICY IF EXISTS "messages_delete_coach"        ON public.messages;
DROP POLICY IF EXISTS "messages_delete_athlete"      ON public.messages;
DROP POLICY IF EXISTS "Usuario borra sus mensajes"   ON public.messages;

CREATE POLICY "Usuario borra sus mensajes"
  ON public.messages FOR DELETE
  USING (
    coach_id = auth.uid()
    OR public.is_admin()
    OR EXISTS (
      SELECT 1 FROM public.athletes a
      WHERE a.id = messages.athlete_id
        AND a.user_id = auth.uid()
    )
  );

NOTIFY pgrst, 'reload schema';
