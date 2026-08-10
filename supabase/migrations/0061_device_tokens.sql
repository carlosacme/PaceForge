-- Un token de push por DISPOSITIVO, en vez de uno por usuario.
--
-- MOTIVO: profiles.fcm_token es una sola columna, asi que un usuario con
-- navegador Y app solo recibe en el ultimo dispositivo que registro: el segundo
-- registro sobrescribe al primero y el primero deja de sonar sin que nada
-- avise. En push_deliveries se ve el sintoma exacto: filas con status 'sent'
-- (FCM acepto el envio) de avisos que el destinatario nunca vio, porque el
-- token apuntaba al otro dispositivo.
--
-- A partir de aqui device_tokens es la fuente de verdad y el envio manda una
-- copia a CADA token del destinatario. profiles.fcm_token se sigue escribiendo
-- por compatibilidad y como red de seguridad mientras los usuarios no vuelvan a
-- registrar; el envio lo usa de reserva cuando un usuario todavia no tiene
-- ninguna fila aqui.
--
-- Escribe el backend con service_role (el registro necesita poder retirar un
-- token del usuario ANTERIOR, y eso la RLS no lo permite desde el cliente).
-- Las policies dejan a cada usuario gestionar y leer los suyos, que es lo que
-- necesita el panel de diagnostico para verificar que su token quedo guardado.

CREATE TABLE IF NOT EXISTS public.device_tokens (
  id           bigint GENERATED ALWAYS AS IDENTITY PRIMARY KEY,
  user_id      uuid NOT NULL REFERENCES auth.users (id) ON DELETE CASCADE,
  token        text NOT NULL UNIQUE,          -- un token identifica un dispositivo
  platform     text NOT NULL DEFAULT 'web' CHECK (platform IN ('web', 'android', 'ios')),
  created_at   timestamptz NOT NULL DEFAULT now(),
  updated_at   timestamptz NOT NULL DEFAULT now(),
  last_seen_at timestamptz NOT NULL DEFAULT now()
);

CREATE INDEX IF NOT EXISTS idx_device_tokens_user
  ON public.device_tokens (user_id);

ALTER TABLE public.device_tokens ENABLE ROW LEVEL SECURITY;

DROP POLICY IF EXISTS "device_tokens_select_own" ON public.device_tokens;
CREATE POLICY "device_tokens_select_own"
  ON public.device_tokens FOR SELECT
  USING (user_id = auth.uid());

DROP POLICY IF EXISTS "device_tokens_insert_own" ON public.device_tokens;
CREATE POLICY "device_tokens_insert_own"
  ON public.device_tokens FOR INSERT
  WITH CHECK (user_id = auth.uid());

DROP POLICY IF EXISTS "device_tokens_update_own" ON public.device_tokens;
CREATE POLICY "device_tokens_update_own"
  ON public.device_tokens FOR UPDATE
  USING (user_id = auth.uid())
  WITH CHECK (user_id = auth.uid());

-- Necesaria para el cierre de sesion: el dispositivo que sale retira SU token
-- y deja de recibir, sin tocar los demas dispositivos del mismo usuario.
DROP POLICY IF EXISTS "device_tokens_delete_own" ON public.device_tokens;
CREATE POLICY "device_tokens_delete_own"
  ON public.device_tokens FOR DELETE
  USING (user_id = auth.uid());

-- Arranque en caliente: sin esto, device_tokens nace vacia y ningun usuario
-- tendria token hasta volver a abrir la app. Los tokens que hay hoy en profiles
-- son de navegador (el registro nativo nunca llego a guardar), asi que entran
-- como 'web'; el proximo registro real corrige la plataforma.
-- Si dos perfiles compartieran token, ON CONFLICT deja solo el primero: el
-- endpoint de registro lo reasignara al dueño correcto en su siguiente arranque.
INSERT INTO public.device_tokens (user_id, token, platform)
SELECT user_id, fcm_token, 'web'
FROM public.profiles
WHERE fcm_token IS NOT NULL AND fcm_token <> ''
ON CONFLICT (token) DO NOTHING;

-- La auditoria pasa a ser por token: sin saber a QUE dispositivo fue cada
-- intento, dos filas con el mismo status son indistinguibles. Se guarda solo la
-- cola del token, suficiente para identificar el dispositivo sin dejar
-- credenciales de envio en la tabla de logs.
ALTER TABLE public.push_deliveries
  ADD COLUMN IF NOT EXISTS platform   text,
  ADD COLUMN IF NOT EXISTS token_tail text;

NOTIFY pgrst, 'reload schema';
