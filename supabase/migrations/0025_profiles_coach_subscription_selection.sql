-- Elección de plan coach (visible para admin en profiles)

ALTER TABLE public.profiles
  ADD COLUMN IF NOT EXISTS subscription_plan text,
  ADD COLUMN IF NOT EXISTS subscription_period text,
  ADD COLUMN IF NOT EXISTS subscription_amount numeric;
