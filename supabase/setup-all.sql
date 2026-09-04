-- ═══════════════════════════════════════════════════════════════════
--  Wayfinder — everything still outstanding, in one paste
-- ═══════════════════════════════════════════════════════════════════
--  Run this whole file once in the Supabase SQL Editor. It is safe to
--  re-run, and it changes no existing behaviour: it adds the photo and
--  trip tables, and prepares the ownership columns without switching the
--  security rules over.
--
--  Assumes supabase/schema.sql has already been run. It has.
--
--  Everything that WOULD change behaviour lives in schema-multiuser.sql
--  section 3, which is deliberately not included here.
-- ═══════════════════════════════════════════════════════════════════


-- ═══════════════════════════════════════════════════════════════════
--  STOP if the cutover has already been run
-- ═══════════════════════════════════════════════════════════════════
--  This file creates the old permissive policies - "any signed-in account
--  may read everything" - which were fine for two trusted phones. It says
--  it is safe to re-run, and it is, RIGHT UP UNTIL schema-cutover.sql has
--  been applied. After that, re-running this would put the permissive
--  policies back and quietly expose every row to anybody who installs the
--  app. So it refuses.
--
--  If you need something from this file after the cutover, take that one
--  statement rather than running the whole thing.
-- ═══════════════════════════════════════════════════════════════════
do $guard$
begin
  if exists (select 1 from information_schema.columns
              where table_schema = 'public' and table_name = 'progress'
                and column_name = 'scope_id') then
    raise exception using
      message = 'schema-cutover.sql has already been run on this project.',
      detail  = 'Re-running setup-all.sql would restore the permissive '
                'security policies it replaced and expose every row.',
      hint    = 'Nothing has been changed. Run only the statement you need.';
  end if;
end $guard$;


-- ───────────────────────────────────────────────────────────────────
--  PART 1 — Photos
-- ───────────────────────────────────────────────────────────────────

create table if not exists public.photos (
  id              uuid         primary key default gen_random_uuid(),
  adventure_id    integer      not null,
  storage_path    text         not null unique,
  taken_at        timestamptz,
  taken_at_source text,
  width           integer,
  height          integer,
  bytes           integer,
  caption         text,
  uploaded_by     text,
  created_at      timestamptz  not null default now()
);

create index if not exists photos_adventure_idx on public.photos (adventure_id);
create index if not exists photos_taken_at_idx  on public.photos (taken_at desc);

alter table public.photos enable row level security;

drop policy if exists "signed in can read photos"   on public.photos;
drop policy if exists "signed in can insert photos" on public.photos;
drop policy if exists "signed in can update photos" on public.photos;
drop policy if exists "signed in can delete photos" on public.photos;

create policy "signed in can read photos"
  on public.photos for select to authenticated using (true);
create policy "signed in can insert photos"
  on public.photos for insert to authenticated with check (true);
create policy "signed in can update photos"
  on public.photos for update to authenticated using (true) with check (true);
create policy "signed in can delete photos"
  on public.photos for delete to authenticated using (true);

-- Private bucket. Photos are not readable by URL; the app mints
-- short-lived signed links instead.
insert into storage.buckets (id, name, public, file_size_limit, allowed_mime_types)
values ('memories', 'memories', false, 10485760,
        array['image/jpeg', 'image/png', 'image/webp'])
on conflict (id) do update
  set public             = false,
      file_size_limit    = excluded.file_size_limit,
      allowed_mime_types = excluded.allowed_mime_types;

drop policy if exists "signed in can read memory files"   on storage.objects;
drop policy if exists "signed in can upload memory files" on storage.objects;
drop policy if exists "signed in can delete memory files" on storage.objects;

create policy "signed in can read memory files"
  on storage.objects for select to authenticated using (bucket_id = 'memories');
create policy "signed in can upload memory files"
  on storage.objects for insert to authenticated with check (bucket_id = 'memories');
create policy "signed in can delete memory files"
  on storage.objects for delete to authenticated using (bucket_id = 'memories');


-- ───────────────────────────────────────────────────────────────────
--  PART 2 — Trips
-- ───────────────────────────────────────────────────────────────────

create table if not exists public.trips (
  id             uuid         primary key default gen_random_uuid(),
  name           text         not null,
  starts_on      date,
  ends_on        date,
  adventure_ids  integer[]    not null default '{}',
  notes          text,
  created_by     text,
  created_at     timestamptz  not null default now(),
  updated_at     timestamptz  not null default now()
);

drop trigger if exists trips_touch_updated_at on public.trips;
create trigger trips_touch_updated_at
  before update on public.trips
  for each row execute function public.touch_updated_at();

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


-- ───────────────────────────────────────────────────────────────────
--  PART 3 — Groups and ownership columns
-- ───────────────────────────────────────────────────────────────────
--  Adds the structure. Does NOT switch the security rules over - that
--  is the separate cutover, and it needs your rows backfilled first.

create table if not exists public.groups (
  id          uuid        primary key default gen_random_uuid(),
  name        text        not null,
  join_code   text        not null unique,
  created_by  uuid        references auth.users(id) on delete set null,
  created_at  timestamptz not null default now()
);

create table if not exists public.group_members (
  group_id     uuid        not null references public.groups(id) on delete cascade,
  user_id      uuid        not null references auth.users(id) on delete cascade,
  display_name text,
  joined_at    timestamptz not null default now(),
  primary key (group_id, user_id)
);

create index if not exists group_members_user_idx on public.group_members (user_id);

create or replace function public.is_group_member(gid uuid)
returns boolean language sql security definer stable
set search_path = public as $$
  select exists (
    select 1 from public.group_members
    where group_id = gid and user_id = auth.uid()
  );
$$;

alter table public.groups        enable row level security;
alter table public.group_members enable row level security;

drop policy if exists "see groups you belong to"  on public.groups;
drop policy if exists "create groups"             on public.groups;
drop policy if exists "see your own memberships"  on public.group_members;
drop policy if exists "join a group"              on public.group_members;
drop policy if exists "leave a group"             on public.group_members;

-- Anyone signed in may look a group up, because joining requires knowing
-- the code and the code is the secret.
create policy "see groups you belong to" on public.groups
  for select to authenticated using (true);
create policy "create groups" on public.groups
  for insert to authenticated with check (created_by = auth.uid());

create policy "see your own memberships" on public.group_members
  for select to authenticated using (user_id = auth.uid());
create policy "join a group" on public.group_members
  for insert to authenticated with check (user_id = auth.uid());
create policy "leave a group" on public.group_members
  for delete to authenticated using (user_id = auth.uid());

-- Ownership columns. Nothing reads them yet.
alter table public.progress add column if not exists user_id  uuid references auth.users(id) on delete cascade;
alter table public.progress add column if not exists group_id uuid references public.groups(id) on delete set null;
alter table public.photos   add column if not exists user_id  uuid references auth.users(id) on delete cascade;
alter table public.photos   add column if not exists group_id uuid references public.groups(id) on delete set null;
alter table public.trips    add column if not exists user_id  uuid references auth.users(id) on delete cascade;
alter table public.trips    add column if not exists group_id uuid references public.groups(id) on delete set null;

create index if not exists progress_owner_idx on public.progress (user_id, group_id);
create index if not exists photos_owner_idx   on public.photos   (user_id, group_id);
create index if not exists trips_owner_idx    on public.trips    (user_id, group_id);

-- Account deletion, which Apple requires to be possible from inside the app.
create or replace function public.delete_my_account()
returns void language plpgsql security definer
set search_path = public as $$
begin
  if auth.uid() is null then
    raise exception 'not signed in';
  end if;
  delete from auth.users where id = auth.uid();
end;
$$;

revoke all on function public.delete_my_account() from public;
grant execute on function public.delete_my_account() to authenticated;


-- ───────────────────────────────────────────────────────────────────
--  PART 4 — Realtime
-- ───────────────────────────────────────────────────────────────────

do $$
declare t text;
begin
  foreach t in array array['photos', 'trips', 'groups', 'group_members'] loop
    if not exists (
      select 1 from pg_publication_tables
      where pubname = 'supabase_realtime' and schemaname = 'public' and tablename = t
    ) then
      execute format('alter publication supabase_realtime add table public.%I', t);
    end if;
  end loop;
end
$$;

alter table public.photos replica identity full;
alter table public.trips  replica identity full;


-- ═══════════════════════════════════════════════════════════════════
--  Done. Check it worked:
--
--    select count(*) from public.photos;   -- 0, no error
--    select count(*) from public.trips;    -- 0, no error
--    select count(*) from public.groups;   -- 0, no error
--    select id, public from storage.buckets where id = 'memories';
--                                          -- one row, public = false
-- ═══════════════════════════════════════════════════════════════════
