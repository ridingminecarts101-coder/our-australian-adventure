-- Our Australian Adventure — Supabase schema
-- Run this whole file once in the Supabase SQL Editor.
-- Safe to re-run: everything is guarded with "if not exists" / "drop policy if exists".

-- ---------------------------------------------------------------
-- 1. The shared progress table
-- ---------------------------------------------------------------
-- One row per adventure that has been touched. Adventures nobody has
-- interacted with simply have no row, which keeps the table small.

create table if not exists public.progress (
  adventure_id  integer      primary key,
  completed     boolean      not null default false,
  completed_at  timestamptz,
  completed_by  text,
  shortlisted   boolean      not null default false,
  rating        integer      check (rating is null or rating between 1 and 5),
  memory        text,
  updated_at    timestamptz  not null default now(),
  updated_by    text
);

comment on table public.progress is
  'Shared adventure progress for Riley & Elli. One row per adventure touched.';

-- Keep updated_at honest no matter which device writes.
create or replace function public.touch_updated_at()
returns trigger
language plpgsql
as $$
begin
  new.updated_at := now();
  return new;
end;
$$;

drop trigger if exists progress_touch_updated_at on public.progress;
create trigger progress_touch_updated_at
  before update on public.progress
  for each row execute function public.touch_updated_at();

-- ---------------------------------------------------------------
-- 2. Row Level Security
-- ---------------------------------------------------------------
-- The anon key is public — it ships inside the app's JavaScript and
-- anyone can read it. RLS is what actually protects the data: only a
-- signed-in session (i.e. someone who typed the passphrase) can touch
-- these rows. Anonymous visitors get nothing.

alter table public.progress enable row level security;

drop policy if exists "signed in can read progress"   on public.progress;
drop policy if exists "signed in can insert progress" on public.progress;
drop policy if exists "signed in can update progress" on public.progress;
drop policy if exists "signed in can delete progress" on public.progress;

create policy "signed in can read progress"
  on public.progress for select
  to authenticated
  using (true);

create policy "signed in can insert progress"
  on public.progress for insert
  to authenticated
  with check (true);

create policy "signed in can update progress"
  on public.progress for update
  to authenticated
  using (true)
  with check (true);

create policy "signed in can delete progress"
  on public.progress for delete
  to authenticated
  using (true);

-- ---------------------------------------------------------------
-- 3. Realtime
-- ---------------------------------------------------------------
-- This is what makes Elli's phone update seconds after Riley ticks
-- something off. Adds the table to the realtime publication.

do $$
begin
  if not exists (
    select 1 from pg_publication_tables
    where pubname = 'supabase_realtime'
      and schemaname = 'public'
      and tablename  = 'progress'
  ) then
    alter publication supabase_realtime add table public.progress;
  end if;
end
$$;

-- Send the full old row on updates/deletes so the client can diff properly.
alter table public.progress replica identity full;

-- ---------------------------------------------------------------
-- Done. Check it worked:
--   select * from public.progress;           -- should be empty, no error
--   select tablename from pg_publication_tables
--     where pubname = 'supabase_realtime';   -- should list "progress"
-- ---------------------------------------------------------------
