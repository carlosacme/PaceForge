-- Registro de intentos de envio de push.
--
-- MOTIVO: hoy no queda rastro de ningun envio. Cuando un coach dice "no me
-- llego la notificacion de mi atleta" no hay forma de distinguir entre:
--   a) el cliente nunca llamo a /api/send-push,
--   b) el destinatario no tiene fcm_token,
--   c) FCM rechazo el token (UNREGISTERED) y el fallo murio en un console.warn,
--   d) FCM lo acepto y el problema esta en el dispositivo.
-- Con esta tabla la respuesta se consulta en una linea.
--
-- Solo escribe el backend con service_role (no hay policy de INSERT). Leen el
-- remitente, el destinatario y el admin: al atleta le sirve para saber si su
-- coach tiene las notificaciones activas.

CREATE TABLE IF NOT EXISTS public.push_deliveries (
  id             bigint GENERATED ALWAYS AS IDENTITY PRIMARY KEY,
  created_at     timestamptz NOT NULL DEFAULT now(),
  from_user_id   uuid,                       -- null en los envios del cron
  to_user_id     uuid NOT NULL,
  kind           text,                       -- data.type: coach_chat, athlete_calendar, …
  title          text,
  status         text NOT NULL CHECK (status IN ('sent', 'no_token', 'rejected', 'error')),
  reason         text,
  fcm_message_id text
);

CREATE INDEX IF NOT EXISTS idx_push_deliveries_to_user
  ON public.push_deliveries (to_user_id, created_at DESC);

CREATE INDEX IF NOT EXISTS idx_push_deliveries_created
  ON public.push_deliveries (created_at DESC);

ALTER TABLE public.push_deliveries ENABLE ROW LEVEL SECURITY;

DROP POLICY IF EXISTS "push_deliveries_select_participants" ON public.push_deliveries;
CREATE POLICY "push_deliveries_select_participants"
  ON public.push_deliveries FOR SELECT
  USING (
    to_user_id = auth.uid()
    OR from_user_id = auth.uid()
    OR public.is_admin()
  );

NOTIFY pgrst, 'reload schema';
