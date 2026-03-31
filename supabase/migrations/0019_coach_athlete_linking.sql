-- Vinculacion coach-atleta: invitaciones, solicitudes y directorio publico

alter table public.coach_profiles
  add column if not exists is_public boolean not null default false;

create table if not exists public.invitations (
  id uuid primary key default gen_random_uuid(),
  coach_id uuid not null references auth.users (id) on delete cascade,
  email text not null,
  code uuid not null unique default gen_random_uuid(),
  status text not null default 'pending' check (status in ('pending', 'accepted')),
  created_at timestamptz not null default now(),
  accepted_at timestamptz
);

create index if not exists invitations_coach_id_idx on public.invitations (coach_id);
create index if not exists invitations_email_idx on public.invitations (lower(email));
create index if not exists invitations_code_idx on public.invitations (code);

alter table public.invitations enable row level security;

drop policy if exists invitations_coach_select on public.invitations;
drop policy if exists invitations_coach_insert on public.invitations;
drop policy if exists invitations_coach_update on public.invitations;
drop policy if exists invitations_public_select_pending on public.invitations;
drop policy if exists invitations_athlete_accept on public.invitations;

create policy invitations_coach_select
  on public.invitations for select
  to authenticated
  using (auth.uid() = coach_id);

create policy invitations_coach_insert
  on public.invitations for insert
  to authenticated
  with check (auth.uid() = coach_id);

create policy invitations_coach_update
  on public.invitations for update
  to authenticated
  using (auth.uid() = coach_id)
  with check (auth.uid() = coach_id);

-- Permite resolver un codigo de invitacion desde el cliente (anon/autenticado).
create policy invitations_public_select_pending
  on public.invitations for select
  to anon, authenticated
  using (status = 'pending');

-- El atleta autenticado puede marcar su invitacion como aceptada.
create policy invitations_athlete_accept
  on public.invitations for update
  to authenticated
  using (
    status = 'pending'
    and lower(email) = lower(coalesce(auth.jwt() ->> 'email', ''))
  )
  with check (
    status = 'accepted'
    and lower(email) = lower(coalesce(auth.jwt() ->> 'email', ''))
    and accepted_at is not null
  );

create table if not exists public.coach_requests (
  id uuid primary key default gen_random_uuid(),
  athlete_id uuid not null references public.athletes (id) on delete cascade,
  coach_id uuid not null references auth.users (id) on delete cascade,
  status text not null default 'pending' check (status in ('pending', 'accepted', 'rejected')),
  created_at timestamptz not null default now(),
  unique (athlete_id, coach_id)
);

create index if not exists coach_requests_coach_id_idx on public.coach_requests (coach_id);
create index if not exists coach_requests_athlete_id_idx on public.coach_requests (athlete_id);

alter table public.coach_requests enable row level security;

drop policy if exists coach_requests_coach_select on public.coach_requests;
drop policy if exists coach_requests_coach_update on public.coach_requests;
drop policy if exists coach_requests_athlete_insert on public.coach_requests;
drop policy if exists coach_requests_athlete_select on public.coach_requests;

create policy coach_requests_coach_select
  on public.coach_requests for select
  to authenticated
  using (auth.uid() = coach_id);

create policy coach_requests_coach_update
  on public.coach_requests for update
  to authenticated
  using (auth.uid() = coach_id)
  with check (auth.uid() = coach_id);

create policy coach_requests_athlete_insert
  on public.coach_requests for insert
  to authenticated
  with check (
    exists (
      select 1
      from public.athletes a
      where a.id = athlete_id and a.user_id = auth.uid()
    )
  );

create policy coach_requests_athlete_select
  on public.coach_requests for select
  to authenticated
  using (
    exists (
      select 1
      from public.athletes a
      where a.id = athlete_id and a.user_id = auth.uid()
    )
  );

drop policy if exists coach_profiles_public_select on public.coach_profiles;
create policy coach_profiles_public_select
  on public.coach_profiles for select
  to anon, authenticated
  using (is_public = true);
