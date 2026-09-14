-- Wayfinder group administration and invite lifecycle
--
-- Apply fourth, after schema-personal-ownership.sql,
-- schema-community-hardening.sql and schema-device-local-photos.sql. The hard
-- dependency is personal ownership, but this migration must remain later than
-- it because it replaces that migration's create/join/leave RPC definitions.
-- This migration is additive and safe to re-run. It does not delete, merge or reassign personal progress,
-- photos or trips. Existing short invite codes are rotated once to 32-digit
-- UUID-derived secrets; publish the aligned client in the same maintenance
-- window because older clients accept only 12 characters.

begin;

do $guard$
begin
  if not exists (
    select 1 from information_schema.columns
     where table_schema = 'public' and table_name = 'group_members'
       and column_name = 'share_completions'
  ) or to_regclass('public.group_progress') is null then
    raise exception using
      message = 'schema-personal-ownership.sql must be applied first',
      hint = 'Apply the reviewed ownership migration before group administration.';
  end if;
end
$guard$;

alter table public.groups
  add column if not exists owner_id uuid,
  add column if not exists invite_enabled boolean not null default true;

alter table public.group_members
  add column if not exists joined_at timestamptz not null default now();

do $owner_fk$
begin
  if not exists (
    select 1 from pg_constraint
     where conrelid = 'public.groups'::regclass
       and conname = 'groups_owner_id_fkey'
  ) then
    alter table public.groups
      add constraint groups_owner_id_fkey
      foreign key (owner_id) references auth.users(id) on delete set null;
  end if;
end
$owner_fk$;

create index if not exists groups_owner_id_idx on public.groups(owner_id);
create index if not exists group_members_joined_idx
  on public.group_members(group_id, joined_at, user_id);

-- Prefer the original creator when they are still a member. Otherwise choose
-- a deterministic existing member. Historical groups with no members remain
-- for explicit owner review, but their invites are disabled and cannot be used.
-- A historical successor also receives the group with invitations paused,
-- matching the account-deletion succession rule below.
update public.groups g
   set invite_enabled = false
 where g.owner_id is null
   and not exists (
     select 1 from public.group_members gm
      where gm.group_id = g.id and gm.user_id = g.created_by
   );

update public.groups g
   set owner_id = coalesce(
     (select gm.user_id from public.group_members gm
       where gm.group_id = g.id and gm.user_id = g.created_by),
     (select gm.user_id from public.group_members gm
       where gm.group_id = g.id order by gm.joined_at, gm.user_id limit 1)
   )
 where g.owner_id is null;

update public.groups set invite_enabled = false where owner_id is null;

-- UUID v4 contributes 122 unpredictable bits. Keeping all 32 hex digits makes
-- online guessing impractical while preserving case-insensitive manual entry.
create or replace function public.new_group_join_code()
returns text
language sql
volatile
set search_path = pg_catalog, public
as $$
  select upper(replace(gen_random_uuid()::text, '-', ''))
$$;

-- Rotate legacy 6-12 character codes once. Replaying the migration preserves
-- already compliant codes, including a deliberately revoked group's secret.
update public.groups
   set join_code = public.new_group_join_code()
 where join_code !~ '^[A-F0-9]{32}$';

-- If an account deletion removes the current owner's membership, promote the
-- longest-standing surviving member and pause invitations for their review.
-- A future group with no members deletes itself. Pre-existing empty groups are
-- retained inert by the backfill above rather than silently erased.
create or replace function public.stabilize_group_after_member_delete()
returns trigger
language plpgsql
security definer
set search_path = pg_catalog, public
as $$
declare
  current_owner uuid;
  successor uuid;
begin
  select g.owner_id into current_owner
    from public.groups g where g.id = old.group_id for update;
  if not found then return old; end if;

  select gm.user_id into successor
    from public.group_members gm
   where gm.group_id = old.group_id
   order by gm.joined_at, gm.user_id
   limit 1;

  if successor is null then
    delete from public.groups where id = old.group_id;
  elsif current_owner is null or not exists (
    select 1 from public.group_members gm
     where gm.group_id = old.group_id and gm.user_id = current_owner
  ) then
    update public.groups
       set owner_id = successor,
           invite_enabled = false,
           join_code = public.new_group_join_code()
     where id = old.group_id;
  end if;
  return old;
end;
$$;

drop trigger if exists group_members_stabilize_owner on public.group_members;
create trigger group_members_stabilize_owner
after delete on public.group_members
for each row execute function public.stabilize_group_after_member_delete();

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
    candidate := public.new_group_join_code();
    begin
      insert into public.groups (name, join_code, created_by, owner_id, invite_enabled)
      values (btrim(p_name), candidate, caller, caller, true)
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
   where g.join_code = upper(btrim(p_join_code))
     and g.invite_enabled
     and g.owner_id is not null
   for update;
  if not found then raise exception 'invite code is invalid or no longer active'; end if;

  insert into public.group_members (group_id, user_id, display_name)
  values (matched_group.id, caller, btrim(p_display_name))
  on conflict on constraint group_members_pkey do update
    set display_name = excluded.display_name;

  return query select matched_group.id, matched_group.name, matched_group.join_code;
end;
$$;

create or replace function public.rotate_group_invite(p_group_id uuid)
returns text
language plpgsql
security definer
set search_path = pg_catalog, public
as $$
declare
  caller uuid := auth.uid();
  candidate text;
begin
  if caller is null then raise exception 'not signed in'; end if;
  candidate := public.new_group_join_code();
  update public.groups
     set join_code = candidate, invite_enabled = true
   where id = p_group_id and owner_id = caller;
  if not found then raise exception 'only the group owner can change invitations'; end if;
  return candidate;
end;
$$;

create or replace function public.revoke_group_invite(p_group_id uuid)
returns void
language plpgsql
security definer
set search_path = pg_catalog, public
as $$
declare caller uuid := auth.uid();
begin
  if caller is null then raise exception 'not signed in'; end if;
  update public.groups
     set join_code = public.new_group_join_code(), invite_enabled = false
   where id = p_group_id and owner_id = caller;
  if not found then raise exception 'only the group owner can change invitations'; end if;
end;
$$;

create or replace function public.remove_group_member(p_group_id uuid, p_user_id uuid)
returns void
language plpgsql
security definer
set search_path = pg_catalog, public
as $$
declare
  caller uuid := auth.uid();
  current_owner uuid;
begin
  if caller is null then raise exception 'not signed in'; end if;
  select g.owner_id into current_owner
    from public.groups g where g.id = p_group_id for update;
  if not found or current_owner is distinct from caller then
    raise exception 'only the group owner can remove members';
  end if;
  if p_user_id = caller then raise exception 'the owner cannot remove themselves'; end if;
  if not exists (
    select 1 from public.group_members gm
     where gm.group_id = p_group_id and gm.user_id = p_user_id
  ) then raise exception 'that person is not a group member'; end if;

  delete from public.group_progress where group_id = p_group_id and shared_by_id = p_user_id;
  delete from public.group_photos   where group_id = p_group_id and shared_by_id = p_user_id;
  delete from public.group_trips    where group_id = p_group_id and shared_by_id = p_user_id;
  delete from public.group_members  where group_id = p_group_id and user_id = p_user_id;
end;
$$;

create or replace function public.transfer_group_ownership(p_group_id uuid, p_user_id uuid)
returns void
language plpgsql
security definer
set search_path = pg_catalog, public
as $$
declare
  caller uuid := auth.uid();
  current_owner uuid;
begin
  if caller is null then raise exception 'not signed in'; end if;
  select g.owner_id into current_owner
    from public.groups g where g.id = p_group_id for update;
  if not found or current_owner is distinct from caller then
    raise exception 'only the group owner can transfer ownership';
  end if;
  if p_user_id = caller then raise exception 'choose another member'; end if;
  if not exists (
    select 1 from public.group_members gm
     where gm.group_id = p_group_id and gm.user_id = p_user_id
  ) then raise exception 'the new owner must already be a group member'; end if;

  update public.groups set owner_id = p_user_id where id = p_group_id and owner_id = caller;
  if not found then raise exception 'group ownership changed; refresh and try again'; end if;
end;
$$;

create or replace function public.delete_group(p_group_id uuid)
returns void
language plpgsql
security definer
set search_path = pg_catalog, public
as $$
declare caller uuid := auth.uid();
begin
  if caller is null then raise exception 'not signed in'; end if;
  delete from public.groups where id = p_group_id and owner_id = caller;
  if not found then raise exception 'only the group owner can delete this group'; end if;
end;
$$;

create or replace function public.leave_group(p_group_id uuid)
returns void
language plpgsql
security definer
set search_path = pg_catalog, public
as $$
declare
  caller uuid := auth.uid();
  current_owner uuid;
  member_count integer;
begin
  if caller is null then raise exception 'not signed in'; end if;
  select g.owner_id into current_owner
    from public.groups g where g.id = p_group_id for update;
  if not found or not exists (
    select 1 from public.group_members gm
     where gm.group_id = p_group_id and gm.user_id = caller
  ) then raise exception 'not a member of this group'; end if;

  select count(*) into member_count from public.group_members where group_id = p_group_id;
  if caller = current_owner and member_count > 1 then
    raise exception 'transfer ownership before leaving this group';
  end if;

  delete from public.group_progress where group_id = p_group_id and shared_by_id = caller;
  delete from public.group_photos   where group_id = p_group_id and shared_by_id = caller;
  delete from public.group_trips    where group_id = p_group_id and shared_by_id = caller;
  delete from public.group_members  where group_id = p_group_id and user_id = caller;
end;
$$;

revoke all on function public.new_group_join_code() from public, anon, authenticated;
revoke all on function public.rotate_group_invite(uuid) from public, anon, authenticated;
revoke all on function public.revoke_group_invite(uuid) from public, anon, authenticated;
revoke all on function public.remove_group_member(uuid, uuid) from public, anon, authenticated;
revoke all on function public.transfer_group_ownership(uuid, uuid) from public, anon, authenticated;
revoke all on function public.delete_group(uuid) from public, anon, authenticated;
revoke all on function public.create_group(text, text) from public, anon;
revoke all on function public.join_group_by_code(text, text) from public, anon;
revoke all on function public.leave_group(uuid) from public, anon;

grant execute on function public.rotate_group_invite(uuid) to authenticated;
grant execute on function public.revoke_group_invite(uuid) to authenticated;
grant execute on function public.remove_group_member(uuid, uuid) to authenticated;
grant execute on function public.transfer_group_ownership(uuid, uuid) to authenticated;
grant execute on function public.delete_group(uuid) to authenticated;

commit;
