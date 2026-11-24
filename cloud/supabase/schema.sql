-- Framesflow cloud accounts: run this once in Supabase → SQL Editor.
-- Stores each signed-in user's project JSON (never media files) so projects follow their account.
-- Row Level Security means a user can only ever read or change their own rows.

create table if not exists public.projects (
  user_id    uuid        not null default auth.uid() references auth.users(id) on delete cascade,
  id         text        not null,
  name       text        not null,
  data       jsonb       not null,
  updated_at timestamptz not null default now(),
  primary key (user_id, id)
);

create index if not exists projects_user_updated on public.projects (user_id, updated_at desc);

alter table public.projects enable row level security;

drop policy if exists "projects: read own"   on public.projects;
drop policy if exists "projects: insert own" on public.projects;
drop policy if exists "projects: update own" on public.projects;
drop policy if exists "projects: delete own" on public.projects;

create policy "projects: read own"   on public.projects for select using (auth.uid() = user_id);
create policy "projects: insert own" on public.projects for insert with check (auth.uid() = user_id);
create policy "projects: update own" on public.projects for update using (auth.uid() = user_id) with check (auth.uid() = user_id);
create policy "projects: delete own" on public.projects for delete using (auth.uid() = user_id);
