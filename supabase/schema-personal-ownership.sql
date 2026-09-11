-- Wayfinder personal ownership and consent-based group sharing
--
-- Apply after schema-cutover.sql and schema-group-repair.sql. This migration is
-- additive and safe to re-run. It does not delete, merge, or reassign any
-- progress, photo, or trip row. Existing group_id values remain as compatibility
-- metadata, while explicit projection rows become the authority for group reads.
--
-- Roll out in a maintenance window: pause client publication, apply this file,
-- then publish the aligned client before reopening group actions. Older clients
-- that insert group_members directly are rejected once these policies replace
-- the unsafe ones; the aligned client deliberately shows a maintenance message
-- when this schema is absent.

begin;

do $guard$
begin
  if not exists (
    select 1 from information_schema.columns
     where table_schema = 'public' and table_name = 'progress'
       and column_name = 'id'
  ) or not exists (
    select 1 from information_schema.columns
     where table_schema = 'public' and table_name = 'progress'
       and column_name = 'completed_by_id'
  ) then
    raise exception using
      message = 'schema-cutover.sql must be applied first',
      hint = 'Apply schema-cutover.sql, then schema-group-repair.sql, then this file.';
  end if;
end
$guard$;

-- A projection is explicit consent to show one personal record to one group.
-- Composite foreign keys prove that shared_by_id owns the source record.
create unique index if not exists progress_id_owner_key
  on public.progress (id, user_id);
create unique index if not exists photos_id_owner_key
  on public.photos (id, user_id);
create unique index if not exists trips_id_owner_key
  on public.trips (id, user_id);

create table if not exists public.group_progress (
  group_id      uuid        not null references public.groups(id) on delete cascade,
  progress_id   uuid        not null,
  shared_by_id  uuid        not null references auth.users(id) on delete cascade,
  shared_at     timestamptz not null default now(),
  primary key (group_id, progress_id),
  foreign key (progress_id, shared_by_id)
    references public.progress(id, user_id) on delete cascade
);

create table if not exists public.group_photos (
  group_id      uuid        not null references public.groups(id) on delete cascade,
  photo_id      uuid        not null,
  shared_by_id  uuid        not null references auth.users(id) on delete cascade,
  shared_at     timestamptz not null default now(),
  primary key (group_id, photo_id),
  foreign key (photo_id, shared_by_id)
    references public.photos(id, user_id) on delete cascade
);

create table if not exists public.group_trips (
  group_id      uuid        not null references public.groups(id) on delete cascade,
  trip_id       uuid        not null,
  shared_by_id  uuid        not null references auth.users(id) on delete cascade,
  shared_at     timestamptz not null default now(),
  primary key (group_id, trip_id),
  foreign key (trip_id, shared_by_id)
    references public.trips(id, user_id) on delete cascade
);

create index if not exists group_progress_shared_by_idx
  on public.group_progress (shared_by_id, group_id);
create index if not exists group_photos_shared_by_idx
  on public.group_photos (shared_by_id, group_id);
create index if not exists group_trips_shared_by_idx
  on public.group_trips (shared_by_id, group_id);

alter table public.group_members
  add column if not exists share_completions boolean not null default false;

-- Preserve visibility intentionally created by the legacy group_id model once.
-- The durable marker prevents a later replay from recreating consent a person
-- has revoked.
create table if not exists public.wayfinder_schema_migrations (
  migration_key text primary key,
  applied_at timestamptz not null default now()
);
alter table public.wayfinder_schema_migrations enable row level security;
revoke all on table public.wayfinder_schema_migrations from anon, authenticated;

do $legacy_projection_backfill$
begin
  if not exists (
    select 1 from public.wayfinder_schema_migrations
     where migration_key = 'personal-ownership-legacy-projections-v1'
  ) then
    -- These memberships came from the earlier shared-list model. Preserve that
    -- already-established visibility; new joins default to private.
    update public.group_members set share_completions = true;

    insert into public.group_progress (group_id, progress_id, shared_by_id)
    select p.group_id, p.id, p.user_id from public.progress p
     where p.group_id is not null and p.user_id is not null
       and exists (select 1 from public.group_members gm
                    where gm.group_id = p.group_id and gm.user_id = p.user_id)
    on conflict (group_id, progress_id) do nothing;

    insert into public.group_photos (group_id, photo_id, shared_by_id)
    select p.group_id, p.id, p.user_id from public.photos p
     where p.group_id is not null and p.user_id is not null
       and exists (select 1 from public.group_members gm
                    where gm.group_id = p.group_id and gm.user_id = p.user_id)
    on conflict (group_id, photo_id) do nothing;

    insert into public.group_trips (group_id, trip_id, shared_by_id)
    select t.group_id, t.id, t.user_id from public.trips t
     where t.group_id is not null and t.user_id is not null
       and exists (select 1 from public.group_members gm
                    where gm.group_id = t.group_id and gm.user_id = t.user_id)
    on conflict (group_id, trip_id) do nothing;

    insert into public.wayfinder_schema_migrations (migration_key)
    values ('personal-ownership-legacy-projections-v1');
  end if;
end
$legacy_projection_backfill$;

-- Policy helpers are SECURITY DEFINER to avoid recursive RLS evaluation. Each
-- has a fixed search path and exposes only a boolean, never group metadata.
create or replace function public.is_group_member(gid uuid)
returns boolean
language sql
security definer
stable
set search_path = pg_catalog, public
as $$
  select auth.uid() is not null and exists (
    select 1 from public.group_members gm
     where gm.group_id = gid and gm.user_id = auth.uid()
  );
$$;

create or replace function public.can_read_progress(pid uuid)
returns boolean
language sql
security definer
stable
set search_path = pg_catalog, public
as $$
  select exists (
    select 1
      from public.group_progress gp
      join public.group_members gm on gm.group_id = gp.group_id
     where gp.progress_id = pid and gm.user_id = auth.uid()
  );
$$;

create or replace function public.can_read_photo(pid uuid)
returns boolean
language sql
security definer
stable
set search_path = pg_catalog, public
as $$
  select exists (
    select 1
      from public.group_photos gp
      join public.group_members gm on gm.group_id = gp.group_id
     where gp.photo_id = pid and gm.user_id = auth.uid()
  );
$$;

create or replace function public.can_read_trip(tid uuid)
returns boolean
language sql
security definer
stable
set search_path = pg_catalog, public
as $$
  select exists (
    select 1
      from public.group_trips gt
      join public.group_members gm on gm.group_id = gt.group_id
     where gt.trip_id = tid and gm.user_id = auth.uid()
  );
$$;

create or replace function public.can_read_memory_object(object_name text)
returns boolean
language sql
security definer
stable
set search_path = pg_catalog, public
as $$
  select (storage.foldername(object_name))[1] = auth.uid()::text
      or exists (
        select 1
          from public.photos p
         where p.storage_path = object_name and p.user_id = auth.uid()
      )
      or exists (
        select 1
          from public.photos p
          join public.group_photos gp on gp.photo_id = p.id
          join public.group_members gm on gm.group_id = gp.group_id
         where p.storage_path = object_name and gm.user_id = auth.uid()
      );
$$;

create or replace function public.can_manage_memory_object(object_name text)
returns boolean
language sql
security definer
stable
set search_path = pg_catalog, public
as $$
  select (storage.foldername(object_name))[1] = auth.uid()::text
      or exists (
        select 1
          from public.photos p
         where p.storage_path = object_name and p.user_id = auth.uid()
      );
$$;

revoke all on function public.is_group_member(uuid) from public;
revoke all on function public.can_read_progress(uuid) from public;
revoke all on function public.can_read_photo(uuid) from public;
revoke all on function public.can_read_trip(uuid) from public;
revoke all on function public.can_read_memory_object(text) from public;
revoke all on function public.can_manage_memory_object(text) from public;
grant execute on function public.is_group_member(uuid) to authenticated;
grant execute on function public.can_read_progress(uuid) to authenticated;
grant execute on function public.can_read_photo(uuid) to authenticated;
grant execute on function public.can_read_trip(uuid) to authenticated;
grant execute on function public.can_read_memory_object(text) to authenticated;
grant execute on function public.can_manage_memory_object(text) to authenticated;

-- Clients may rename themselves, but may never move a membership to another
-- user or group. SECURITY DEFINER RPCs perform joins and leaves.
create or replace function public.guard_membership_identity()
returns trigger
language plpgsql
set search_path = pg_catalog, public
as $$
begin
  if new.group_id is distinct from old.group_id
     or new.user_id is distinct from old.user_id then
    raise exception 'membership identity cannot be changed';
  end if;
  return new;
end;
$$;

drop trigger if exists group_members_guard_identity on public.group_members;
create trigger group_members_guard_identity
before update on public.group_members
for each row execute function public.guard_membership_identity();

-- Personal record ownership and legacy group metadata cannot be reassigned by
-- an authenticated client. Administrative migrations have auth.uid() = null.
create or replace function public.guard_personal_record_identity()
returns trigger
language plpgsql
set search_path = pg_catalog, public
as $$
begin
  if auth.uid() is not null and tg_op = 'UPDATE' and (
       new.user_id is distinct from old.user_id
       or new.group_id is distinct from old.group_id
     ) then
    raise exception 'record ownership and legacy group metadata cannot be changed';
  end if;
  return new;
end;
$$;

do $triggers$
declare t text;
begin
  foreach t in array array['progress', 'photos', 'trips'] loop
    execute format('drop trigger if exists %I on public.%I', t || '_guard_identity', t);
    execute format(
      'create trigger %I before update on public.%I for each row execute function public.guard_personal_record_identity()',
      t || '_guard_identity', t
    );
  end loop;
end
$triggers$;

-- Canonical completion attribution follows the personal owner. Historical
-- group rows retain truthful non-owner attribution until completion changes.
create or replace function public.attribute_personal_completion()
returns trigger
language plpgsql
set search_path = pg_catalog, public
as $$
begin
  if new.group_id is null then
    if new.completed then
      new.completed_by_id := new.user_id;
    else
      new.completed_by_id := null;
    end if;
  elsif tg_op = 'INSERT' then
    new.completed_by_id := case when new.completed then new.user_id else null end;
  elsif new.completed is distinct from old.completed then
    new.completed_by_id := case when new.completed then new.user_id else null end;
  elsif new.completed_by_id is distinct from old.completed_by_id then
    raise exception 'historical completion attribution cannot be reassigned';
  end if;
  return new;
end;
$$;

drop trigger if exists progress_attribute_personal_completion on public.progress;
create trigger progress_attribute_personal_completion
before insert or update of completed, completed_by_id, user_id, group_id
on public.progress
for each row execute function public.attribute_personal_completion();

-- Replace every direct group/membership policy. A group row is visible only
-- after membership exists; membership creation and removal occur through RPCs.
alter table public.groups enable row level security;
alter table public.group_members enable row level security;

do $policies$
declare p record;
begin
  for p in select policyname from pg_policies
            where schemaname = 'public' and tablename = 'groups'
  loop
    execute format('drop policy if exists %I on public.groups', p.policyname);
  end loop;
  for p in select policyname from pg_policies
            where schemaname = 'public' and tablename = 'group_members'
  loop
    execute format('drop policy if exists %I on public.group_members', p.policyname);
  end loop;
end
$policies$;

create policy "members can see their groups" on public.groups
for select to authenticated
using (public.is_group_member(id));

create policy "members can see group membership" on public.group_members
for select to authenticated
using (public.is_group_member(group_id));

create policy "members can rename themselves" on public.group_members
for update to authenticated
using (user_id = auth.uid() and public.is_group_member(group_id))
with check (user_id = auth.uid() and public.is_group_member(group_id));

-- Source rows are readable through an explicit projection. Only their owner
-- may create, edit, or delete them. Legacy group_id may be retained on insert
-- during the client transition, but must name a group the owner belongs to.
do $source_policies$
declare p record;
begin
  for p in select policyname, tablename from pg_policies
            where schemaname = 'public'
              and tablename in ('progress', 'photos', 'trips')
  loop
    execute format('drop policy if exists %I on public.%I', p.policyname, p.tablename);
  end loop;
end
$source_policies$;

create policy "read owned or projected progress" on public.progress
for select to authenticated
using (user_id = auth.uid());
create policy "insert owned progress" on public.progress
for insert to authenticated
with check (user_id = auth.uid()
            and (group_id is null or public.is_group_member(group_id)));
create policy "update owned progress" on public.progress
for update to authenticated
using (user_id = auth.uid())
with check (user_id = auth.uid());
create policy "delete owned progress" on public.progress
for delete to authenticated
using (user_id = auth.uid());

create policy "read owned or projected photos" on public.photos
for select to authenticated
using (user_id = auth.uid() or public.can_read_photo(id));
create policy "insert owned photos" on public.photos
for insert to authenticated
with check (user_id = auth.uid()
            and (group_id is null or public.is_group_member(group_id)));
create policy "update owned photos" on public.photos
for update to authenticated
using (user_id = auth.uid())
with check (user_id = auth.uid());
create policy "delete owned photos" on public.photos
for delete to authenticated
using (user_id = auth.uid());

create policy "read owned or projected trips" on public.trips
for select to authenticated
using (user_id = auth.uid() or public.can_read_trip(id));
create policy "insert owned trips" on public.trips
for insert to authenticated
with check (user_id = auth.uid()
            and (group_id is null or public.is_group_member(group_id)));
create policy "update owned trips" on public.trips
for update to authenticated
using (user_id = auth.uid())
with check (user_id = auth.uid());
create policy "delete owned trips" on public.trips
for delete to authenticated
using (user_id = auth.uid());

-- Memory objects follow photo ownership/projection rather than trusting a UUID
-- embedded in the path. This also removes the old all-authenticated exception
-- for numeric legacy paths while retaining access through their metadata row.
drop policy if exists "signed in can read memory files" on storage.objects;
drop policy if exists "signed in can upload memory files" on storage.objects;
drop policy if exists "signed in can delete memory files" on storage.objects;
drop policy if exists "read own or shared memory files" on storage.objects;
drop policy if exists "upload own memory files" on storage.objects;
drop policy if exists "delete own or shared memory files" on storage.objects;
drop policy if exists "read owned or projected memory files" on storage.objects;
drop policy if exists "upload owned memory files" on storage.objects;
drop policy if exists "delete owned memory files" on storage.objects;

create policy "read owned or projected memory files" on storage.objects
for select to authenticated
using (bucket_id = 'memories' and public.can_read_memory_object(name));

create policy "upload owned memory files" on storage.objects
for insert to authenticated
with check (
  bucket_id = 'memories'
  and (storage.foldername(name))[1] = auth.uid()::text
);

create policy "delete owned memory files" on storage.objects
for delete to authenticated
using (bucket_id = 'memories' and public.can_manage_memory_object(name));

do $projection_policies$
declare t text;
declare p record;
begin
  foreach t in array array['group_progress', 'group_photos', 'group_trips'] loop
    execute format('alter table public.%I enable row level security', t);
    for p in select policyname from pg_policies
              where schemaname = 'public' and tablename = t
    loop
      execute format('drop policy if exists %I on public.%I', p.policyname, t);
    end loop;
    execute format(
      'create policy "members read projections" on public.%I for select to authenticated using (public.is_group_member(group_id))',
      t
    );
    execute format(
      'create policy "owners add projections" on public.%I for insert to authenticated with check (shared_by_id = auth.uid() and public.is_group_member(group_id))',
      t
    );
    execute format(
      'create policy "owners remove projections" on public.%I for delete to authenticated using (shared_by_id = auth.uid())',
      t
    );
  end loop;
end
$projection_policies$;

-- A direct projection write must obey the same durable completion consent as
-- the sharing RPC. This closes the stale-client route after a person revokes
-- sharing on another device.
drop policy if exists "owners add projections" on public.group_progress;
create policy "owners add consented completion projections" on public.group_progress
for insert to authenticated
with check (
  shared_by_id = auth.uid()
  and exists (
    select 1 from public.group_members gm
     where gm.group_id = group_progress.group_id
       and gm.user_id = auth.uid()
       and gm.share_completions
  )
);

grant select on public.groups, public.group_members,
  public.progress, public.photos, public.trips,
  public.group_progress, public.group_photos, public.group_trips
to authenticated;
grant insert, update, delete on public.progress, public.photos, public.trips to authenticated;
grant update on public.group_members to authenticated;
grant insert, delete on public.group_progress, public.group_photos, public.group_trips to authenticated;

-- Group lifecycle is server-owned so invite codes never require a discovery
-- SELECT and callers cannot enrol an arbitrary user id.
create or replace function public.create_group(
  p_name text,
  p_display_name text
)
returns table (group_id uuid, group_name text, join_code text)
language plpgsql
security definer
set search_path = pg_catalog, public
as $$
declare
  caller uuid := auth.uid();
  created public.groups%rowtype;
  candidate text;
  attempt integer := 0;
begin
  if caller is null then raise exception 'not signed in'; end if;
  if nullif(btrim(p_name), '') is null then raise exception 'group name is required'; end if;
  if char_length(btrim(p_name)) > 80 then raise exception 'group name is too long'; end if;
  if nullif(btrim(p_display_name), '') is null then raise exception 'display name is required'; end if;
  if char_length(btrim(p_display_name)) > 80 then raise exception 'display name is too long'; end if;

  loop
    attempt := attempt + 1;
    candidate := upper(substr(replace(gen_random_uuid()::text, '-', ''), 1, 12));
    begin
      insert into public.groups (name, join_code, created_by)
      values (btrim(p_name), candidate, caller)
      returning * into created;
      exit;
    exception when unique_violation then
      if attempt >= 10 then raise exception 'could not allocate an invite code'; end if;
    end;
  end loop;

  insert into public.group_members (group_id, user_id, display_name)
  values (created.id, caller, btrim(p_display_name));

  return query select created.id, created.name, created.join_code;
end;
$$;

create or replace function public.join_group_by_code(
  p_join_code text,
  p_display_name text
)
returns table (group_id uuid, group_name text, join_code text)
language plpgsql
security definer
set search_path = pg_catalog, public
as $$
declare
  caller uuid := auth.uid();
  matched_group public.groups%rowtype;
begin
  if caller is null then raise exception 'not signed in'; end if;
  if nullif(btrim(p_join_code), '') is null then raise exception 'invite code is required'; end if;
  if nullif(btrim(p_display_name), '') is null then raise exception 'display name is required'; end if;
  if char_length(btrim(p_display_name)) > 80 then raise exception 'display name is too long'; end if;

  select g.* into matched_group
    from public.groups g
   where upper(g.join_code) = upper(btrim(p_join_code))
   limit 1;
  if not found then raise exception 'invite code is invalid'; end if;

  insert into public.group_members (group_id, user_id, display_name)
  values (matched_group.id, caller, btrim(p_display_name))
  on conflict on constraint group_members_pkey do update
    set display_name = excluded.display_name;

  return query select matched_group.id, matched_group.name, matched_group.join_code;
end;
$$;

create or replace function public.leave_group(p_group_id uuid)
returns void
language plpgsql
security definer
set search_path = pg_catalog, public
as $$
declare caller uuid := auth.uid();
begin
  if caller is null then raise exception 'not signed in'; end if;
  if not exists (
    select 1 from public.group_members gm
     where gm.group_id = p_group_id and gm.user_id = caller
  ) then
    raise exception 'not a member of this group';
  end if;

  delete from public.group_progress where group_id = p_group_id and shared_by_id = caller;
  delete from public.group_photos   where group_id = p_group_id and shared_by_id = caller;
  delete from public.group_trips    where group_id = p_group_id and shared_by_id = caller;
  delete from public.group_members  where group_id = p_group_id and user_id = caller;
end;
$$;

-- Bulk or selected progress consent. NULL means all owned progress; an empty
-- array means none. The composite FK remains the final ownership check.
create or replace function public.share_personal_progress(
  p_group_id uuid,
  p_progress_ids uuid[] default null
)
returns integer
language plpgsql
security definer
set search_path = pg_catalog, public
as $$
declare caller uuid := auth.uid(); affected integer;
begin
  if caller is null then raise exception 'not signed in'; end if;
  if not exists (
    select 1 from public.group_members gm
     where gm.group_id = p_group_id and gm.user_id = caller
       and gm.share_completions
  ) then
    raise exception 'completion sharing is not enabled for this group';
  end if;

  insert into public.group_progress (group_id, progress_id, shared_by_id)
  select p_group_id, p.id, caller
    from public.progress p
     where p.user_id = caller and p.completed
     and (p_progress_ids is null or p.id = any(p_progress_ids))
  on conflict (group_id, progress_id) do nothing;
  get diagnostics affected = row_count;
  return affected;
end;
$$;

create or replace function public.unshare_personal_progress(
  p_group_id uuid,
  p_progress_ids uuid[] default null
)
returns integer
language plpgsql
security definer
set search_path = pg_catalog, public
as $$
declare caller uuid := auth.uid(); affected integer;
begin
  if caller is null then raise exception 'not signed in'; end if;
  delete from public.group_progress gp
   where gp.group_id = p_group_id and gp.shared_by_id = caller
     and (p_progress_ids is null or gp.progress_id = any(p_progress_ids));
  get diagnostics affected = row_count;
  return affected;
end;
$$;

-- Future completed rows follow the consent stored on each membership. This is
-- server-side so a stale second device cannot recreate sharing after revocation.
create or replace function public.sync_completion_projections()
returns trigger
language plpgsql
security definer
set search_path = pg_catalog, public
as $$
begin
  if new.completed then
    insert into public.group_progress (group_id, progress_id, shared_by_id)
    select gm.group_id, new.id, new.user_id
      from public.group_members gm
     where gm.user_id = new.user_id and gm.share_completions
    on conflict (group_id, progress_id) do nothing;
  else
    delete from public.group_progress
     where progress_id = new.id and shared_by_id = new.user_id;
  end if;
  return new;
end;
$$;

drop trigger if exists progress_sync_completion_projections on public.progress;
create trigger progress_sync_completion_projections
after insert or update of completed on public.progress
for each row execute function public.sync_completion_projections();

create or replace function public.set_group_completion_sharing(
  p_group_id uuid,
  p_enabled boolean
)
returns void
language plpgsql
security definer
set search_path = pg_catalog, public
as $$
declare caller uuid := auth.uid();
begin
  if caller is null then raise exception 'not signed in'; end if;
  update public.group_members
     set share_completions = p_enabled
   where group_id = p_group_id and user_id = caller;
  if not found then raise exception 'not a member of this group'; end if;

  if p_enabled then
    insert into public.group_progress (group_id, progress_id, shared_by_id)
    select p_group_id, p.id, caller
      from public.progress p
     where p.user_id = caller and p.completed
    on conflict (group_id, progress_id) do nothing;
  else
    delete from public.group_progress
     where group_id = p_group_id and shared_by_id = caller;
  end if;
end;
$$;

-- Group members receive completion facts only. Ratings, shortlist state and
-- private memory text never cross this boundary.
create or replace function public.group_completion_feed(p_group_id uuid)
returns table (
  adventure_id integer,
  completed boolean,
  completed_at timestamptz,
  completed_by_id uuid,
  completed_by text,
  updated_at timestamptz
)
language sql
security definer
stable
set search_path = pg_catalog, public
as $$
  select p.adventure_id, p.completed, p.completed_at,
         p.completed_by_id, p.completed_by, p.updated_at
    from public.group_progress gp
    join public.progress p on p.id = gp.progress_id
   where gp.group_id = p_group_id
     and p.completed
     and public.is_group_member(p_group_id);
$$;

-- Keep the in-app deletion route present and pinned to a safe search path.
-- Cascades remove canonical rows, memberships and projections; the client
-- removes owned Storage objects before calling this function.
create or replace function public.delete_my_account()
returns void
language plpgsql
security definer
set search_path = pg_catalog, public
as $$
declare caller uuid := auth.uid();
begin
  if caller is null then raise exception 'not signed in'; end if;
  delete from auth.users where id = caller;
end;
$$;

revoke all on function public.create_group(text, text) from public;
revoke all on function public.join_group_by_code(text, text) from public;
revoke all on function public.leave_group(uuid) from public;
revoke all on function public.share_personal_progress(uuid, uuid[]) from public;
revoke all on function public.unshare_personal_progress(uuid, uuid[]) from public;
revoke all on function public.set_group_completion_sharing(uuid, boolean) from public;
revoke all on function public.group_completion_feed(uuid) from public;
revoke all on function public.delete_my_account() from public;
grant execute on function public.create_group(text, text) to authenticated;
grant execute on function public.join_group_by_code(text, text) to authenticated;
grant execute on function public.leave_group(uuid) to authenticated;
grant execute on function public.share_personal_progress(uuid, uuid[]) to authenticated;
grant execute on function public.unshare_personal_progress(uuid, uuid[]) to authenticated;
grant execute on function public.set_group_completion_sharing(uuid, boolean) to authenticated;
grant execute on function public.group_completion_feed(uuid) to authenticated;
grant execute on function public.delete_my_account() to authenticated;

-- Realtime carries projection/consent changes to current group members.
do $publication$
declare t text;
begin
  foreach t in array array['group_progress', 'group_photos', 'group_trips'] loop
    if not exists (
      select 1 from pg_publication_tables
       where pubname = 'supabase_realtime'
         and schemaname = 'public' and tablename = t
    ) then
      execute format('alter publication supabase_realtime add table public.%I', t);
    end if;
    execute format('alter table public.%I replica identity full', t);
  end loop;
end
$publication$;

commit;
