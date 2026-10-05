-- Wayfinder: one sharing choice at group entry and six-character invite codes.
-- Apply after schema-group-feedback.sql and schema-group-administration.sql,
-- before publishing the matching client. Existing group consent is preserved.
-- Existing long invite links continue to work until their owner rotates/revokes.
-- Re-running this migration does not reset choices, codes, or legacy aliases.

begin;

do $guard$
begin
  if to_regclass('public.group_progress') is null
     or to_regclass('public.personal_progress_sharing_origins') is null
     or to_regprocedure('public.group_completion_feedback_feed(uuid)') is null
     or not exists (
       select 1 from information_schema.columns
        where table_schema = 'public' and table_name = 'group_members'
          and column_name = 'share_feedback'
     ) then
    raise exception 'apply group administration and group feedback migrations first';
  end if;
end
$guard$;

-- NULL means a pre-existing membership has not yet answered the combined
-- choice. Its old consent remains exactly as it was until that member answers.
alter table public.group_members
  add column if not exists sharing_choice_made_at timestamptz;

-- Crockford's 32-symbol alphabet avoids the easily confused I, L, O and U.
-- Six symbols contain 30 bits of entropy. UUID v4 supplies random bytes;
-- 256 divides evenly by 32, so each symbol is uniformly distributed.
create or replace function public.new_group_join_code()
returns text
language plpgsql
volatile
set search_path = pg_catalog, public
as $$
declare
  alphabet constant text := '0123456789ABCDEFGHJKMNPQRSTVWXYZ';
  random_bytes bytea;
  code text;
  i integer;
  attempt integer;
begin
  for attempt in 1..32 loop
    random_bytes := decode(replace(gen_random_uuid()::text, '-', ''), 'hex');
    code := '';
    for i in 0..5 loop
      code := code || substr(alphabet, get_byte(random_bytes, i) % 32 + 1, 1);
    end loop;
    if not exists (select 1 from public.groups g where g.join_code = code)
       and not exists (select 1 from public.group_legacy_invites legacy
                        where legacy.join_code = code) then
      return code;
    end if;
  end loop;
  raise exception 'could not allocate a group invite code';
end;
$$;

-- Retain previously distributed 32-character codes as hidden aliases. Only
-- the new six-character code appears in groups and RPC responses. A later
-- rotation/revocation removes the alias so an old link cannot undo revocation.
create table if not exists public.group_legacy_invites (
  group_id uuid primary key references public.groups(id) on delete cascade,
  join_code text not null unique
);
alter table public.group_legacy_invites enable row level security;
revoke all on public.group_legacy_invites from PUBLIC, anon, authenticated;

insert into public.group_legacy_invites (group_id, join_code)
select id, join_code from public.groups
 where join_code !~ '^[0123456789ABCDEFGHJKMNPQRSTVWXYZ]{6}$'
on conflict (group_id) do nothing;

do $rotate_old_codes$
declare
  old_group record;
  candidate text;
  attempt integer;
  changed boolean;
begin
  for old_group in
    select id, join_code from public.groups
     where join_code !~ '^[0123456789ABCDEFGHJKMNPQRSTVWXYZ]{6}$'
     order by id for update
  loop
    changed := false;
    for attempt in 1..32 loop
      candidate := public.new_group_join_code();
      begin
        update public.groups set join_code = candidate where id = old_group.id;
        changed := true;
        exit;
      exception when unique_violation then
        -- A rare short-code collision is retried without changing the group.
      end;
    end loop;
    if not changed then raise exception 'could not allocate a group invite code'; end if;
  end loop;
end
$rotate_old_codes$;

do $code_constraint$
begin
  if not exists (
    select 1 from pg_constraint
     where conrelid = 'public.groups'::regclass
       and conname = 'groups_join_code_six_characters'
  ) then
    alter table public.groups add constraint groups_join_code_six_characters
      check (join_code ~ '^[0123456789ABCDEFGHJKMNPQRSTVWXYZ]{6}$');
  end if;
end
$code_constraint$;

create or replace function public.expire_legacy_group_invite()
returns trigger
language plpgsql
security definer
set search_path = pg_catalog, public
as $$
begin
  delete from public.group_legacy_invites where group_id = new.id;
  return new;
end;
$$;
drop trigger if exists groups_expire_legacy_invite on public.groups;
create trigger groups_expire_legacy_invite
after update of join_code on public.groups
for each row when (old.join_code is distinct from new.join_code)
execute function public.expire_legacy_group_invite();

-- All invite entry points use this per-account hourly bound. An invalid code
-- returns no row instead of raising an exception, so the failed attempt stays
-- committed. A guessed six-character code cannot be tested without an Auth
-- account, and one account cannot make unlimited guesses.
create table if not exists public.group_join_attempts (
  user_id uuid primary key references auth.users(id) on delete cascade,
  window_started_at timestamptz not null,
  attempts integer not null default 0
);
alter table public.group_join_attempts enable row level security;
revoke all on public.group_join_attempts from PUBLIC, anon, authenticated;

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
  clean_code text := upper(btrim(p_join_code));
  matched_group public.groups%rowtype;
  attempt_count integer;
begin
  if caller is null then raise exception 'not signed in'; end if;
  if nullif(clean_code, '') is null then raise exception 'invite code is required'; end if;
  if clean_code !~ '^[A-Z0-9]{6,32}$' then return; end if;
  if nullif(btrim(p_display_name), '') is null then raise exception 'display name is required'; end if;
  if char_length(btrim(p_display_name)) > 80 then raise exception 'display name is too long'; end if;

  insert into public.group_join_attempts (user_id, window_started_at, attempts)
  values (caller, now(), 1)
  on conflict (user_id) do update
     set window_started_at = case
           when group_join_attempts.window_started_at < now() - interval '1 hour'
             then now() else group_join_attempts.window_started_at end,
         attempts = case
           when group_join_attempts.window_started_at < now() - interval '1 hour'
             then 1 else group_join_attempts.attempts + 1 end
  returning attempts into attempt_count;
  if attempt_count > 20 then return; end if;

  select g.* into matched_group
    from public.groups g
   where (g.join_code = clean_code or exists (
           select 1 from public.group_legacy_invites legacy
            where legacy.group_id = g.id and legacy.join_code = clean_code
         ))
     and g.invite_enabled
     and g.owner_id is not null
   for update;
  if not found then return; end if;

  insert into public.group_members (group_id, user_id, display_name)
  values (matched_group.id, caller, btrim(p_display_name))
  on conflict on constraint group_members_pkey do update
    set display_name = excluded.display_name;

  return query select matched_group.id, matched_group.name, matched_group.join_code;
end;
$$;

-- The one-choice RPCs perform membership and projection changes in one
-- transaction. Even a same-member invite applies the fresh explicit answer.
create or replace function public.choose_group_sharing(
  p_group_id uuid,
  p_share_memories boolean
)
returns void
language plpgsql
security definer
set search_path = pg_catalog, public
as $$
declare
  caller uuid := auth.uid();
  chosen_at timestamptz;
  old_completions boolean;
  old_feedback boolean;
begin
  if caller is null then raise exception 'not signed in'; end if;
  if p_share_memories is null then raise exception 'sharing choice is required'; end if;
  select gm.sharing_choice_made_at, gm.share_completions, gm.share_feedback
    into chosen_at, old_completions, old_feedback
    from public.group_members gm
   where gm.group_id = p_group_id and gm.user_id = caller
   for update;
  if not found then raise exception 'not a member of this group'; end if;
  if chosen_at is not null then
    if old_completions = p_share_memories and old_feedback = p_share_memories then
      return; -- Safe retry after a response is lost.
    end if;
    raise exception 'sharing choice was already made for this membership';
  end if;

  update public.group_members
     set share_completions = p_share_memories,
         share_feedback = p_share_memories,
         sharing_choice_made_at = now()
   where group_id = p_group_id and user_id = caller;
  if p_share_memories then
    insert into public.group_progress (group_id, progress_id, shared_by_id)
    select p_group_id, p.id, caller from public.progress p
     where p.user_id = caller and p.completed
    on conflict on constraint group_progress_pkey do nothing;
  else
    delete from public.group_progress
     where group_id = p_group_id and shared_by_id = caller;
  end if;
end;
$$;

create or replace function public.create_group_with_sharing(
  p_name text,
  p_display_name text,
  p_share_memories boolean
)
returns table (group_id uuid, group_name text, join_code text)
language plpgsql
security definer
set search_path = pg_catalog, public
as $$
declare created record;
begin
  if p_share_memories is null then raise exception 'sharing choice is required'; end if;
  select * into created from public.create_group(p_name, p_display_name);
  perform public.choose_group_sharing(created.group_id, p_share_memories);
  return query select created.group_id, created.group_name, created.join_code;
end;
$$;

create or replace function public.join_group_with_sharing(
  p_join_code text,
  p_display_name text,
  p_share_memories boolean
)
returns table (group_id uuid, group_name text, join_code text)
language plpgsql
security definer
set search_path = pg_catalog, public
as $$
declare
  joined record;
  caller uuid := auth.uid();
begin
  if p_share_memories is null then raise exception 'sharing choice is required'; end if;
  select * into joined from public.join_group_by_code(p_join_code, p_display_name);
  if not found then return; end if;

  -- A repeated invite is a new explicit answer; preserve neither old sharing
  -- nor old projections if this time the member asks to join privately.
  update public.group_members gm
     set share_completions = p_share_memories,
         share_feedback = p_share_memories,
         sharing_choice_made_at = now()
   where gm.group_id = joined.group_id and gm.user_id = caller;
  if p_share_memories then
    insert into public.group_progress (group_id, progress_id, shared_by_id)
    select joined.group_id, p.id, caller from public.progress p
     where p.user_id = caller and p.completed
    on conflict on constraint group_progress_pkey do nothing;
  else
    delete from public.group_progress gp
     where gp.group_id = joined.group_id and gp.shared_by_id = caller;
  end if;
  return query select joined.group_id, joined.group_name, joined.join_code;
end;
$$;

-- Preserve owner controls while retrying rare short-code collisions. Changing
-- the code triggers removal of any historical long-code alias.
create or replace function public.assign_group_join_code(
  p_group_id uuid,
  p_invite_enabled boolean
)
returns text
language plpgsql
security definer
set search_path = pg_catalog, public
as $$
declare candidate text; attempt integer;
begin
  for attempt in 1..32 loop
    candidate := public.new_group_join_code();
    begin
      update public.groups
         set join_code = candidate, invite_enabled = p_invite_enabled
       where id = p_group_id;
      if not found then raise exception 'group not found'; end if;
      return candidate;
    exception when unique_violation then
      -- Try another code without changing the previous invite.
    end;
  end loop;
  raise exception 'could not allocate a group invite code';
end;
$$;

create or replace function public.rotate_group_invite(p_group_id uuid)
returns text
language plpgsql
security definer
set search_path = pg_catalog, public
as $$
declare caller uuid := auth.uid();
begin
  if caller is null then raise exception 'not signed in'; end if;
  if not exists (select 1 from public.groups
                  where id = p_group_id and owner_id = caller for update) then
    raise exception 'only the group owner can change invitations';
  end if;
  return public.assign_group_join_code(p_group_id, true);
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
  if not exists (select 1 from public.groups
                  where id = p_group_id and owner_id = caller for update) then
    raise exception 'only the group owner can change invitations';
  end if;
  perform public.assign_group_join_code(p_group_id, false);
end;
$$;

create or replace function public.stabilize_group_after_member_delete()
returns trigger
language plpgsql
security definer
set search_path = pg_catalog, public
as $$
declare current_owner uuid; successor uuid;
begin
  select g.owner_id into current_owner
    from public.groups g where g.id = old.group_id for update;
  if not found then return old; end if;

  select gm.user_id into successor
    from public.group_members gm
   where gm.group_id = old.group_id
   order by gm.joined_at, gm.user_id limit 1;
  if successor is null then
    delete from public.groups where id = old.group_id;
  elsif current_owner is null or not exists (
    select 1 from public.group_members gm
     where gm.group_id = old.group_id and gm.user_id = current_owner
  ) then
    update public.groups set owner_id = successor where id = old.group_id;
    perform public.assign_group_join_code(old.group_id, false);
  end if;
  return old;
end;
$$;

revoke all on function public.new_group_join_code() from PUBLIC, anon, authenticated;
revoke all on function public.expire_legacy_group_invite() from PUBLIC, anon, authenticated;
revoke all on function public.assign_group_join_code(uuid, boolean) from PUBLIC, anon, authenticated;
revoke all on function public.join_group_by_code(text, text) from PUBLIC, anon, authenticated;
revoke all on function public.choose_group_sharing(uuid, boolean) from PUBLIC, anon, authenticated;
revoke all on function public.create_group_with_sharing(text, text, boolean) from PUBLIC, anon, authenticated;
revoke all on function public.join_group_with_sharing(text, text, boolean) from PUBLIC, anon, authenticated;
grant execute on function public.join_group_by_code(text, text) to authenticated;
grant execute on function public.choose_group_sharing(uuid, boolean) to authenticated;
grant execute on function public.create_group_with_sharing(text, text, boolean) to authenticated;
grant execute on function public.join_group_with_sharing(text, text, boolean) to authenticated;

commit;
notify pgrst, 'reload schema';
