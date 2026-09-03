-- Our Australian Adventure — trip planning
-- Run once in the Supabase SQL Editor, after schema.sql. Safe to re-run.

create table if not exists public.trips (
  id             uuid         primary key default gen_random_uuid(),
  name           text         not null,
  starts_on      date,
  ends_on        date,
  -- Which adventures are in the trip, in the order you want to do them.
  adventure_ids  integer[]    not null default '{}',
  notes          text,
  created_by     text,
  created_at     timestamptz  not null default now(),
  updated_at     timestamptz  not null default now()
);

comment on table public.trips is
  'Planned trips: a named, ordered set of adventures with optional dates.';

drop trigger if exists trips_touch_updated_at on public.trips;
create trigger trips_touch_updated_at
  before update on public.trips
  for each row execute function public.touch_updated_at();

-- ---------------------------------------------------------------
-- Row Level Security
-- ---------------------------------------------------------------
alter table public.trips enable row level security;

drop policy if exists "signed in can read trips"   on public.trips;
drop policy if exists "signed in can insert trips" on public.trips;
drop policy if exists "signed in can update trips" on public.trips;
drop policy if exists "signed in can delete trips" on public.trips;

create policy "signed in can read trips"
  on public.trips for select to authenticated using (true);
create policy "signed in can insert trips"
  on public.trips for insert to authenticated with check (true);
create policy "signed in can update trips"
  on public.trips for update to authenticated using (true) with check (true);
create policy "signed in can delete trips"
  on public.trips for delete to authenticated using (true);

-- ---------------------------------------------------------------
-- Realtime, so a trip edited on one phone appears on the other
-- ---------------------------------------------------------------
do $$
begin
  if not exists (
    select 1 from pg_publication_tables
    where pubname = 'supabase_realtime'
      and schemaname = 'public' and tablename = 'trips'
  ) then
    alter publication supabase_realtime add table public.trips;
  end if;
end
$$;

alter table public.trips replica identity full;

-- Check it worked:  select * from public.trips;   -- empty, no error
