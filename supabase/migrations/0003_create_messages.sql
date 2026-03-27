-- Chat coach ↔ atleta
create table if not exists public.messages (
  id uuid primary key default gen_random_uuid(),
  athlete_id uuid not null references public.athletes (id) on delete cascade,
  coach_id uuid not null,
  sender_role text not null check (sender_role in ('coach', 'athlete')),
  body text not null,
  created_at timestamptz not null default now()
);

create index if not exists messages_athlete_coach_created_idx
  on public.messages (athlete_id, coach_id, created_at);

alter table public.messages enable row level security;

create policy "messages_select_participants"
  on public.messages for select
  using (auth.uid() = coach_id or auth.uid() = athlete_id);

create policy "messages_insert_coach"
  on public.messages for insert
  with check (
    sender_role = 'coach'
    and auth.uid() = coach_id
    and exists (
      select 1 from public.athletes a
      where a.id = athlete_id and a.coach_id = coach_id
    )
  );

create policy "messages_insert_athlete"
  on public.messages for insert
  with check (
    sender_role = 'athlete'
    and auth.uid() = athlete_id
    and exists (
      select 1 from public.athletes a
      where a.id = athlete_id and a.coach_id = coach_id
    )
  );
