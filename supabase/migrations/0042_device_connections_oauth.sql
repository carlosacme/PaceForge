-- OAuth para intervals.icu (client 605), conviviendo con el modo API key.
--
-- Hasta ahora el atleta pegaba su API key personal. Con OAuth autoriza con un
-- clic y recibimos tokens que caducan, por eso hacen falta refresh_token y
-- expires_at. auth_type distingue los dos modos para no romper a los atletas
-- ya conectados.

ALTER TABLE public.device_connections
  ADD COLUMN IF NOT EXISTS auth_type      text NOT NULL DEFAULT 'api_key',
  ADD COLUMN IF NOT EXISTS access_token   text,
  ADD COLUMN IF NOT EXISTS refresh_token  text,
  ADD COLUMN IF NOT EXISTS expires_at     timestamptz,
  ADD COLUMN IF NOT EXISTS scope          text;

-- api_key -> columna api_key ; oauth -> access_token + refresh_token
ALTER TABLE public.device_connections
  DROP CONSTRAINT IF EXISTS device_connections_auth_type_check;
ALTER TABLE public.device_connections
  ADD CONSTRAINT device_connections_auth_type_check
  CHECK (auth_type IN ('api_key', 'oauth'));

-- api_key era NOT NULL: con OAuth no hay api_key, asi que debe permitir null.
ALTER TABLE public.device_connections
  ALTER COLUMN api_key DROP NOT NULL;

-- Las filas existentes son todas del modo viejo.
UPDATE public.device_connections
  SET auth_type = 'api_key'
  WHERE auth_type IS NULL;

-- Para el webhook: intervals.icu manda su athlete id, no el nuestro.
CREATE INDEX IF NOT EXISTS idx_device_connections_provider_athlete
  ON public.device_connections (provider_athlete_id)
  WHERE provider_athlete_id IS NOT NULL;

-- Estado temporal del flujo OAuth: el 'state' anti-CSRF que enviamos y
-- verificamos al volver del callback. Se limpian solos por expiracion.
CREATE TABLE IF NOT EXISTS public.oauth_states (
  state       text PRIMARY KEY,
  athlete_id  integer NOT NULL REFERENCES public.athletes(id) ON DELETE CASCADE,
  user_id     uuid NOT NULL,
  created_at  timestamptz NOT NULL DEFAULT now(),
  expires_at  timestamptz NOT NULL DEFAULT (now() + interval '15 minutes')
);

CREATE INDEX IF NOT EXISTS idx_oauth_states_expires
  ON public.oauth_states (expires_at);

-- Solo el servidor (service_role) toca esta tabla; ningun cliente.
ALTER TABLE public.oauth_states ENABLE ROW LEVEL SECURITY;

NOTIFY pgrst, 'reload schema';
