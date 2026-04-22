-- Recurrencia opcional para retos (renovación manual desde la app)
alter table public.challenges
  add column if not exists is_recurring boolean not null default false;

alter table public.challenges
  add column if not exists recurrence text;

comment on column public.challenges.is_recurring is 'Si true, al vencer puede renovarse desde el panel admin.';
comment on column public.challenges.recurrence is 'Valores esperados: monthly | weekly';
