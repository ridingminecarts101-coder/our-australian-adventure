-- ⚠️  DO NOT RUN THIS YET.
--
-- This is the migration that turns the app from "one shared list" into
-- "everyone has their own list, and can share it with people they choose".
-- It is the single thing standing between this app and a public release.
--
-- Running it BEFORE the matching app change lands will break the live app for
-- both phones, because every existing row has no owner and the new policies
-- will hide them. Land the app change and this together, in that order:
--
--   1. Deploy an app build that writes user_id / group_id on every row
--   2. Run section 1 and 2 below (adds columns, backfills existing rows)
--   3. Run section 3 (swaps the policies) - this is the cutover
--
-- Sections 1 and 2 are safe on their own and change no behaviour.

-- ═══════════════════════════════════════════════════════════════════
--  1. Groups - so a couple, a family or four friends share one list
-- ═══════════════════════════════════════════════════════════════════

create table if not exists public.groups (
  id          uuid        primary key default gen_random_uuid(),
  name        text        not null,
  -- Short human-typeable code, the thing you read out to someone.
  join_code   text        not null unique,
  created_by  uuid        references auth.users(id) on delete set null,
  created_at  timestamptz not null default now()
);

create table if not exists public.group_members (
  group_id  uuid        not null references public.groups(id) on delete cascade,
  user_id   uuid        not null references auth.users(id) on delete cascade,
  -- The name shown beside this person's ticks. Not their real identity.
  display_name text,
  joined_at timestamptz not null default now(),
  primary key (group_id, user_id)
);

create index if not exists group_members_user_idx on public.group_members (user_id);

-- Answers "may this user see rows belonging to this group?" without the
-- recursive policy problem you get from querying group_members inside its own
-- policy. security definer is deliberate and the function is intentionally tiny.
create or replace function public.is_group_member(gid uuid)
returns boolean
language sql
security definer
stable
set search_path = public
as $$
  select exists (
    select 1 from public.group_members
    where group_id = gid and user_id = auth.uid()
  );
$$;

-- ═══════════════════════════════════════════════════════════════════
--  2. Ownership columns - safe to run early, changes nothing yet
-- ═══════════════════════════════════════════════════════════════════
-- Every row belongs to exactly one user. It may ALSO belong to a group, in
-- which case everyone in that group can see it.

alter table public.progress add column if not exists user_id  uuid references auth.users(id) on delete cascade;
alter table public.progress add column if not exists group_id uuid references public.groups(id) on delete set null;
alter table public.photos   add column if not exists user_id  uuid references auth.users(id) on delete cascade;
alter table public.photos   add column if not exists group_id uuid references public.groups(id) on delete set null;
alter table public.trips    add column if not exists user_id  uuid references auth.users(id) on delete cascade;
alter table public.trips    add column if not exists group_id uuid references public.groups(id) on delete set null;

create index if not exists progress_owner_idx on public.progress (user_id, group_id);
create index if not exists photos_owner_idx   on public.photos   (user_id, group_id);
create index if not exists trips_owner_idx    on public.trips    (user_id, group_id);

-- progress is keyed on adventure_id alone today, which only works while there
-- is one list in the world. Re-key it per owner.
alter table public.progress drop constraint if exists progress_pkey;
alter table public.progress add primary key (adventure_id, user_id);

-- ═══════════════════════════════════════════════════════════════════
--  3. THE CUTOVER - only run once the app writes user_id
-- ═══════════════════════════════════════════════════════════════════
-- Before running this, backfill the existing rows onto a real account and a
-- group, or they become invisible. Replace both UUIDs first:
--
--   insert into public.groups (name, join_code, created_by)
--     values ('Riley & Elli', 'RILELL', '<your-user-uuid>')
--     returning id;
--
--   update public.progress set user_id = '<your-user-uuid>', group_id = '<group-id>'
--     where user_id is null;
--   update public.photos   set user_id = '<your-user-uuid>', group_id = '<group-id>'
--     where user_id is null;
--   update public.trips    set user_id = '<your-user-uuid>', group_id = '<group-id>'
--     where user_id is null;
--
-- Only then:

/*
alter table public.groups        enable row level security;
alter table public.group_members enable row level security;

drop policy if exists "signed in can read progress"   on public.progress;
drop policy if exists "signed in can insert progress" on public.progress;
drop policy if exists "signed in can update progress" on public.progress;
drop policy if exists "signed in can delete progress" on public.progress;

create policy "own or shared progress readable" on public.progress
  for select to authenticated
  using (user_id = auth.uid() or (group_id is not null and public.is_group_member(group_id)));

create policy "insert own progress" on public.progress
  for insert to authenticated with check (user_id = auth.uid());

create policy "update own progress" on public.progress
  for update to authenticated
  using (user_id = auth.uid()) with check (user_id = auth.uid());

create policy "delete own progress" on public.progress
  for delete to authenticated using (user_id = auth.uid());

-- Repeat the same four for public.photos and public.trips.

create policy "see groups you belong to" on public.groups
  for select to authenticated using (public.is_group_member(id));

create policy "see your own memberships" on public.group_members
  for select to authenticated using (user_id = auth.uid());
*/

-- ═══════════════════════════════════════════════════════════════════
--  4. Account deletion - Apple guideline 5.1.1(v) requires this in-app
-- ═══════════════════════════════════════════════════════════════════
-- Deleting from auth.users cascades to every row above, because each
-- user_id foreign key is declared on delete cascade. Photos in Storage are
-- NOT covered by that and must be removed separately by the client before
-- calling this.

create or replace function public.delete_my_account()
returns void
language plpgsql
security definer
set search_path = public
as $$
begin
  if auth.uid() is null then
    raise exception 'not signed in';
  end if;
  delete from auth.users where id = auth.uid();
end;
$$;

revoke all on function public.delete_my_account() from public;
grant execute on function public.delete_my_account() to authenticated;
