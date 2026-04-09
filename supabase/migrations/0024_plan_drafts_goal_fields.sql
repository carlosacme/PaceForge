ALTER TABLE public.plan_drafts
  ADD COLUMN IF NOT EXISTS competition text;

ALTER TABLE public.plan_drafts
  ADD COLUMN IF NOT EXISTS target_time text;

ALTER TABLE public.plan_drafts
  ADD COLUMN IF NOT EXISTS level text;
