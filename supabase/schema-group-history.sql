-- Wayfinder: retain consented group memories when a member leaves.
-- Apply after schema-group-join-choice.sql and schema-revenuecat-deletion.sql,
-- before publishing a client that describes retained group history. The
-- migration is transactional, additive and safe to replay. It never copies
-- photos or changes the account deletion / RevenueCat erasure queue.

begin;

do $guard$
begin
  if to_regprocedure('public.join_group_with_sharing(text,text,boolean)') is null
     or to_regprocedure('public.group_completion_feedback_feed(uuid)') is null
     or to_regclass('public.personal_progress_sharing_origins') is null
     or to_regclass('public.revenuecat_deletion_jobs') is null then
    raise exception 'apply group join choice, group feedback and RevenueCat deletion migrations first';
  end if;
end
$guard$;

-- These rows are copies of what one group was already permitted to see when
-- membership ended. They deliberately have no progress FK: later personal
-- edits/deletions cannot rewrite the group's old memory. The Auth FK erases
-- every retained row on account deletion, including direct Auth deletion.
create table if not exists public.group_departed_memories (
  group_id uuid not null references public.groups(id) on delete cascade,
  shared_by_id uuid not null references auth.users(id) on delete cascade,
  adventure_id integer not null,
  source_is_personal boolean not null,
  completed_at timestamptz,
  completed_on date,
  completed_by text,
  source_updated_at timestamptz,
  rating integer,
  memory text,
  feedback_shared boolean not null default false,
  departed_at timestamptz not null default now(),
  primary key (group_id, shared_by_id, adventure_id),
  check (source_is_personal or
         (completed_at is null and completed_on is null and completed_by is null
          and source_updated_at is null and rating is null and memory is null
          and not feedback_shared)),
  check (feedback_shared or (rating is null and memory is null)),
  check (completed_by is null or length(completed_by) <= 80)
);
create index if not exists group_departed_memories_owner_idx
  on public.group_departed_memories (shared_by_id, group_id);
alter table public.group_departed_memories enable row level security;
revoke all on public.group_departed_memories from PUBLIC, anon, authenticated;

-- The released client already listens to group_members changes and refetches
-- both memory feeds. A content-free timestamp update supplies that event when
-- a former member erases history; the private snapshot is never published to
-- Realtime. A normal leave also emits its existing membership/projection
-- deletes. Fresh clients keep the same invalidation path.
alter table public.group_members
  add column if not exists history_changed_at timestamptz;
create or replace function public.refresh_group_after_history_change()
returns trigger
language plpgsql security definer
set search_path = pg_catalog, public
as $$
declare changed_group uuid;
begin
  changed_group := case when tg_op = 'DELETE' then old.group_id else new.group_id end;
  update public.group_members
     set history_changed_at = clock_timestamp()
   where group_id = changed_group;
  return null;
end;
$$;
drop trigger if exists group_departed_memories_refresh_members on public.group_departed_memories;
create trigger group_departed_memories_refresh_members
after insert or update or delete on public.group_departed_memories
for each row execute function public.refresh_group_after_history_change();

-- Called only from the server-owned leave/remove RPCs. For every adventure,
-- prefer a confirmed personal completion over a duplicate old group row.
-- Historical rows lacking owner-confirmed personal provenance retain only
-- their previously visible anonymous tick, never their name/date/feedback.
create or replace function public.archive_group_member_memories(
  p_group_id uuid, p_user_id uuid
)
returns void
language plpgsql
security definer
set search_path = pg_catalog, public
as $$
declare member_row public.group_members%rowtype;
begin
  select gm.* into member_row from public.group_members gm
   where gm.group_id = p_group_id and gm.user_id = p_user_id
   for update;
  if not found or not member_row.share_completions then return; end if;

  insert into public.group_departed_memories (
    group_id, shared_by_id, adventure_id, source_is_personal,
    completed_at, completed_on, completed_by, source_updated_at,
    rating, memory, feedback_shared, departed_at
  )
  with candidates as (
    select p.*, (p.group_id is null and personal.progress_id is not null
               and origin.progress_id is null and p.user_id = p_user_id
               and p.completed_by_id = p_user_id) as safe_personal,
           row_number() over (
             partition by p.adventure_id
             order by (p.group_id is null and personal.progress_id is not null
                       and origin.progress_id is null and p.user_id = p_user_id
                       and p.completed_by_id = p_user_id) desc,
                      p.updated_at desc nulls last, p.id desc
           ) as source_rank
      from public.group_progress gp
      join public.progress p on p.id = gp.progress_id
      left join public.group_scoped_progress_origins origin
        on origin.progress_id = p.id
      left join public.personal_progress_sharing_origins personal
        on personal.progress_id = p.id
     where gp.group_id = p_group_id and gp.shared_by_id = p_user_id
       and p.completed
  )
  select p_group_id, p_user_id, c.adventure_id, c.safe_personal,
         case when c.safe_personal then c.completed_at end,
         case when c.safe_personal then c.completed_on end,
         case when c.safe_personal then
           coalesce(nullif(btrim(member_row.display_name), ''),
                    nullif(btrim(c.completed_by), ''), 'Former member') end,
         case when c.safe_personal then c.updated_at end,
         case when c.safe_personal and member_row.share_feedback then c.rating end,
         case when c.safe_personal and member_row.share_feedback then c.memory end,
         c.safe_personal and member_row.share_feedback, now()
    from candidates c where c.source_rank = 1
  on conflict (group_id, shared_by_id, adventure_id) do update
    set source_is_personal = excluded.source_is_personal,
        completed_at = excluded.completed_at,
        completed_on = excluded.completed_on,
        completed_by = excluded.completed_by,
        source_updated_at = excluded.source_updated_at,
        rating = excluded.rating,
        memory = excluded.memory,
        feedback_shared = excluded.feedback_shared,
        departed_at = excluded.departed_at;
end;
$$;

-- Owner removal has the same history behavior as a voluntary departure.
create or replace function public.remove_group_member(p_group_id uuid, p_user_id uuid)
returns void
language plpgsql
security definer
set search_path = pg_catalog, public
as $$
declare caller uuid := auth.uid(); current_owner uuid;
begin
  if caller is null then raise exception 'not signed in'; end if;
  select g.owner_id into current_owner from public.groups g
   where g.id = p_group_id for update;
  if not found or current_owner is distinct from caller then
    raise exception 'only the group owner can remove members';
  end if;
  if p_user_id = caller then raise exception 'the owner cannot remove themselves'; end if;
  if not exists (select 1 from public.group_members gm
                  where gm.group_id = p_group_id and gm.user_id = p_user_id) then
    raise exception 'that person is not a group member';
  end if;

  perform public.archive_group_member_memories(p_group_id, p_user_id);
  delete from public.group_progress where group_id = p_group_id and shared_by_id = p_user_id;
  delete from public.group_photos   where group_id = p_group_id and shared_by_id = p_user_id;
  delete from public.group_trips    where group_id = p_group_id and shared_by_id = p_user_id;
  delete from public.group_members  where group_id = p_group_id and user_id = p_user_id;
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
  select g.owner_id into current_owner from public.groups g
   where g.id = p_group_id for update;
  if not found or not exists (select 1 from public.group_members gm
                             where gm.group_id = p_group_id and gm.user_id = caller) then
    raise exception 'not a member of this group';
  end if;

  select count(*) into member_count from public.group_members where group_id = p_group_id;
  if caller = current_owner and member_count > 1 then
    raise exception 'transfer ownership before leaving this group';
  end if;

  perform public.archive_group_member_memories(p_group_id, caller);
  delete from public.group_progress where group_id = p_group_id and shared_by_id = caller;
  delete from public.group_photos   where group_id = p_group_id and shared_by_id = caller;
  delete from public.group_trips    where group_id = p_group_id and shared_by_id = caller;
  delete from public.group_members  where group_id = p_group_id and user_id = caller;
end;
$$;

-- A released 1.1.0 client still has separate Stop sharing controls. Treat an
-- explicit revocation as withdrawal of the old snapshot as well; merely
-- rejoining privately does not silently erase an earlier frozen memory.
create or replace function public.set_group_completion_sharing(
  p_group_id uuid, p_enabled boolean
)
returns void
language plpgsql security definer
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
    select p_group_id, p.id, caller from public.progress p
     where p.user_id = caller and p.completed
    on conflict (group_id, progress_id) do nothing;
  else
    delete from public.group_progress
     where group_id = p_group_id and shared_by_id = caller;
    delete from public.group_departed_memories
     where group_id = p_group_id and shared_by_id = caller;
  end if;
end;
$$;

create or replace function public.set_group_feedback_sharing(
  p_group_id uuid, p_enabled boolean
)
returns void
language plpgsql security definer
set search_path = pg_catalog, public
as $$
declare caller uuid := auth.uid(); completion_enabled boolean;
begin
  if caller is null then raise exception 'not signed in'; end if;
  if p_enabled is null then raise exception 'feedback sharing choice is required'; end if;
  select gm.share_completions into completion_enabled
    from public.group_members gm
   where gm.group_id = p_group_id and gm.user_id = caller for update;
  if not found then raise exception 'not a member of this group'; end if;
  if p_enabled and not completion_enabled then
    raise exception 'enable completion sharing before feedback sharing';
  end if;
  update public.group_members set share_feedback = p_enabled
   where group_id = p_group_id and user_id = caller;
  if not p_enabled then
    update public.group_departed_memories
       set rating = null, memory = null, feedback_shared = false
     where group_id = p_group_id and shared_by_id = caller;
  end if;
end;
$$;

-- A final leave normally deletes the group. A legacy group-scoped source can
-- keep a provenance shell instead; clear all archived personal data before
-- that ownerless, inaccessible shell is parked.
create or replace function public.stabilize_group_after_member_delete()
returns trigger
language plpgsql security definer
set search_path = pg_catalog, public
as $$
declare current_owner uuid; successor uuid;
begin
  select g.owner_id into current_owner
    from public.groups g where g.id = old.group_id for update;
  if not found then return old; end if;

  select gm.user_id into successor from public.group_members gm
   where gm.group_id = old.group_id
   order by gm.joined_at, gm.user_id limit 1;
  if successor is null then
    delete from public.group_departed_memories where group_id = old.group_id;
    if public.has_group_scoped_source(old.group_id) then
      update public.groups
         set owner_id = null, retired_at = coalesce(retired_at, now())
       where id = old.group_id;
      perform public.assign_group_join_code(old.group_id, false);
    else
      delete from public.groups where id = old.group_id;
    end if;
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

-- Keep the old, ten-column completion and four-column feedback RPC contracts
-- for the public 1.1.0 client. Their common internal feed picks one source per
-- person/adventure. A newly shared live personal row wins on rejoin; a private
-- rejoin leaves the frozen old memory visible until its owner erases it.
create or replace function public.group_memory_rows(p_group_id uuid)
returns table (
  adventure_id integer, completed boolean, completed_at timestamptz,
  completed_on date, completed_by_id uuid, completed_by text,
  updated_at timestamptz, source_user_id uuid, source_is_personal boolean,
  shared_by_id uuid, rating integer, memory text, feedback_shared boolean
)
language sql
security definer
stable
set search_path = pg_catalog, public
as $$
  with candidates as (
    select p.adventure_id, p.completed,
           case when safe.safe_personal then p.completed_at end as completed_at,
           case when safe.safe_personal then p.completed_on end as completed_on,
           case when safe.safe_personal then p.completed_by_id end as completed_by_id,
           case when safe.safe_personal then p.completed_by end as completed_by,
           case when safe.safe_personal then p.updated_at end as updated_at,
           case when safe.safe_personal then p.user_id end as source_user_id,
           safe.safe_personal as source_is_personal,
           case when safe.safe_personal then gp.shared_by_id end as shared_by_id,
           case when safe.safe_personal and gm.share_feedback then p.rating end as rating,
           case when safe.safe_personal and gm.share_feedback then p.memory end as memory,
           safe.safe_personal and gm.share_feedback as feedback_shared,
           gp.shared_by_id as internal_owner, true as is_live,
           p.id as source_rank_id
      from public.group_progress gp
      join public.progress p on p.id = gp.progress_id
      join public.group_members gm
        on gm.group_id = gp.group_id and gm.user_id = gp.shared_by_id
      left join public.group_scoped_progress_origins origin
        on origin.progress_id = p.id
      left join public.personal_progress_sharing_origins personal
        on personal.progress_id = p.id
      cross join lateral (
        select p.group_id is null and origin.progress_id is null
          and personal.progress_id is not null
          and p.user_id = gp.shared_by_id
          and p.completed_by_id = gp.shared_by_id as safe_personal
      ) safe
     where gp.group_id = p_group_id and p.completed and gm.share_completions
    union all
    select s.adventure_id, true,
           s.completed_at, s.completed_on,
           case when s.source_is_personal then s.shared_by_id end,
           s.completed_by, s.source_updated_at,
           case when s.source_is_personal then s.shared_by_id end,
           s.source_is_personal,
           case when s.source_is_personal then s.shared_by_id end,
           s.rating, s.memory, s.feedback_shared,
           s.shared_by_id, false, null::uuid
      from public.group_departed_memories s
     where s.group_id = p_group_id
  ), ranked as (
    select c.*, row_number() over (
      partition by c.internal_owner, c.adventure_id
      order by c.source_is_personal desc, c.is_live desc,
               c.updated_at desc nulls last, c.source_rank_id desc nulls last
    ) as selected_rank
    from candidates c
  )
  select r.adventure_id, r.completed, r.completed_at, r.completed_on,
         r.completed_by_id, r.completed_by, r.updated_at, r.source_user_id,
         r.source_is_personal, r.shared_by_id, r.rating, r.memory,
         r.feedback_shared
    from ranked r
   where r.selected_rank = 1 and public.is_group_member(p_group_id);
$$;

create or replace function public.group_completion_feed(p_group_id uuid)
returns table (
  adventure_id integer, completed boolean, completed_at timestamptz,
  completed_on date, completed_by_id uuid, completed_by text,
  updated_at timestamptz, source_user_id uuid, source_is_personal boolean,
  shared_by_id uuid
)
language sql security definer stable
set search_path = pg_catalog, public
as $$
  select m.adventure_id, m.completed, m.completed_at, m.completed_on,
         m.completed_by_id, m.completed_by, m.updated_at, m.source_user_id,
         m.source_is_personal, m.shared_by_id
    from public.group_memory_rows(p_group_id) m;
$$;

create or replace function public.group_completion_feedback_feed(p_group_id uuid)
returns table (
  adventure_id integer, completed_by_id uuid, rating integer, memory text
)
language sql security definer stable
set search_path = pg_catalog, public
as $$
  select m.adventure_id, m.completed_by_id, m.rating, m.memory
    from public.group_memory_rows(p_group_id) m
   where m.source_is_personal and m.feedback_shared;
$$;

-- A former member can discover and erase only their own retained history.
-- Current membership is not required, since leaving removes it. A later
-- rejoin with fresh sharing is governed by that new membership's consent.
create or replace function public.list_my_retained_group_history()
returns table (group_id uuid, group_name text, retained_count bigint)
language sql security definer stable
set search_path = pg_catalog, public
as $$
  select s.group_id, g.name, count(*)
    from public.group_departed_memories s
    join public.groups g on g.id = s.group_id
   where auth.uid() is not null and s.shared_by_id = auth.uid()
     and not exists (select 1 from public.group_members gm
                      where gm.group_id = s.group_id and gm.user_id = auth.uid())
   group by s.group_id, g.name;
$$;

create or replace function public.erase_my_group_history(p_group_id uuid)
returns void
language plpgsql security definer
set search_path = pg_catalog, public
as $$
declare caller uuid := auth.uid();
begin
  if caller is null then raise exception 'not signed in'; end if;
  delete from public.group_departed_memories
   where group_id = p_group_id and shared_by_id = caller;
end;
$$;

-- A group with old group-scoped source rows becomes an inert shell on delete;
-- explicitly clear its memory archive before parking it. Ordinary group
-- deletion cascades through the snapshot FK. Personal source rows survive.
create or replace function public.delete_group(p_group_id uuid)
returns void
language plpgsql security definer
set search_path = pg_catalog, public
as $$
declare caller uuid := auth.uid(); current_owner uuid;
begin
  if caller is null then raise exception 'not signed in'; end if;
  select g.owner_id into current_owner from public.groups g
   where g.id = p_group_id for update;
  if not found or current_owner is distinct from caller then
    raise exception 'only the group owner can delete this group';
  end if;

  if public.has_group_scoped_source(p_group_id) then
    delete from public.group_departed_memories where group_id = p_group_id;
    delete from public.group_progress where group_id = p_group_id;
    delete from public.group_photos where group_id = p_group_id;
    delete from public.group_trips where group_id = p_group_id;
    delete from public.group_members where group_id = p_group_id;
    update public.groups
       set owner_id = null, retired_at = coalesce(retired_at, now())
     where id = p_group_id;
    perform public.assign_group_join_code(p_group_id, false);
  else
    delete from public.groups where id = p_group_id;
  end if;
end;
$$;

revoke all on function public.archive_group_member_memories(uuid,uuid)
  from PUBLIC, anon, authenticated;
revoke all on function public.refresh_group_after_history_change()
  from PUBLIC, anon, authenticated;
revoke all on function public.group_memory_rows(uuid)
  from PUBLIC, anon, authenticated;
revoke all on function public.list_my_retained_group_history()
  from PUBLIC, anon, authenticated;
revoke all on function public.erase_my_group_history(uuid)
  from PUBLIC, anon, authenticated;
revoke all on function public.remove_group_member(uuid,uuid)
  from PUBLIC, anon, authenticated;
revoke all on function public.stabilize_group_after_member_delete()
  from PUBLIC, anon, authenticated;
revoke all on function public.leave_group(uuid)
  from PUBLIC, anon, authenticated;
revoke all on function public.delete_group(uuid)
  from PUBLIC, anon, authenticated;
revoke all on function public.group_completion_feed(uuid)
  from PUBLIC, anon, authenticated;
revoke all on function public.group_completion_feedback_feed(uuid)
  from PUBLIC, anon, authenticated;
revoke all on function public.set_group_completion_sharing(uuid,boolean)
  from PUBLIC, anon, authenticated;
revoke all on function public.set_group_feedback_sharing(uuid,boolean)
  from PUBLIC, anon, authenticated;
grant execute on function public.list_my_retained_group_history() to authenticated;
grant execute on function public.erase_my_group_history(uuid) to authenticated;
grant execute on function public.remove_group_member(uuid,uuid) to authenticated;
grant execute on function public.leave_group(uuid) to authenticated;
grant execute on function public.delete_group(uuid) to authenticated;
grant execute on function public.group_completion_feed(uuid) to authenticated;
grant execute on function public.group_completion_feedback_feed(uuid) to authenticated;
grant execute on function public.set_group_completion_sharing(uuid,boolean) to authenticated;
grant execute on function public.set_group_feedback_sharing(uuid,boolean) to authenticated;

commit;
notify pgrst, 'reload schema';
