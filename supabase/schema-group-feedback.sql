-- Wayfinder: optional sharing of a member's rating and text memory with their group.
-- Apply after schema-completion-dates.sql and schema-group-administration.sql,
-- before publishing the aligned client. No existing member is opted in.
-- Replaying this migration preserves current consent and personal records.

begin;

do $guard$
begin
  if to_regclass('public.group_progress') is null
     or to_regprocedure('public.group_completion_feed(uuid)') is null
     or not exists (
       select 1 from information_schema.columns
        where table_schema = 'public' and table_name = 'group_members'
          and column_name = 'share_completions'
     )
     or not exists (
       select 1 from information_schema.columns
        where table_schema = 'public' and table_name = 'group_progress'
          and column_name = 'refreshed_at'
     ) then
    raise exception 'apply ownership and completion-date migrations before group feedback';
  end if;
end
$guard$;

-- Completion sharing remains independent. In particular, a member who opted
-- into sharing completions earlier has never consented to sharing private text.
alter table public.group_members
  add column if not exists share_feedback boolean not null default false;
alter table public.group_members alter column share_feedback set default false;
update public.group_members set share_feedback = false where share_feedback is null;
alter table public.group_members alter column share_feedback set not null;

-- The old completion-sharing RPC updates this column only. Clearing feedback
-- in a trigger ensures that opting out of completions cannot leave latent
-- consent that takes effect after a later opt-in.
create or replace function public.clear_feedback_without_completion()
returns trigger
language plpgsql
set search_path = pg_catalog, public
as $$
begin
  if not new.share_completions then
    new.share_feedback := false;
  end if;
  return new;
end;
$$;

drop trigger if exists group_members_clear_feedback on public.group_members;
create trigger group_members_clear_feedback
before update of share_completions on public.group_members
for each row execute function public.clear_feedback_without_completion();

update public.group_members set share_feedback = false
 where share_feedback and not share_completions;

do $consent_constraint$
begin
  if not exists (
    select 1 from pg_constraint
     where conrelid = 'public.group_members'::regclass
       and conname = 'group_members_feedback_requires_completion'
  ) then
    alter table public.group_members
      add constraint group_members_feedback_requires_completion
      check (not share_feedback or share_completions);
  end if;
end
$consent_constraint$;

-- Group membership is never a grant to change another member's consent.
-- Preserve the existing display-name edit grant while closing any broad
-- historical table-level UPDATE grant.
revoke update on public.group_members from PUBLIC, anon, authenticated;
revoke update (share_feedback) on public.group_members from PUBLIC, anon, authenticated;
grant update (display_name) on public.group_members to authenticated;

create or replace function public.set_group_feedback_sharing(
  p_group_id uuid,
  p_enabled boolean
)
returns void
language plpgsql
security definer
set search_path = pg_catalog, public
as $$
declare
  caller uuid := auth.uid();
  completion_enabled boolean;
begin
  if caller is null then raise exception 'not signed in'; end if;
  if p_enabled is null then raise exception 'feedback sharing choice is required'; end if;

  select gm.share_completions into completion_enabled
    from public.group_members gm
   where gm.group_id = p_group_id and gm.user_id = caller
   for update;
  if not found then raise exception 'not a member of this group'; end if;
  if p_enabled and not completion_enabled then
    raise exception 'enable completion sharing before feedback sharing';
  end if;

  update public.group_members
     set share_feedback = p_enabled
   where group_id = p_group_id and user_id = caller;
end;
$$;

-- The feedback feed reads the owner's current fields; it never copies them to
-- a shared table. Every read checks current membership, the completion
-- projection, and both current consent flags. Revocation is therefore
-- effective even before a subscribed client processes the refresh event.
create or replace function public.group_completion_feedback_feed(p_group_id uuid)
returns table (
  adventure_id integer,
  completed_by_id uuid,
  rating integer,
  memory text
)
language sql
security definer
stable
set search_path = pg_catalog, public
as $$
  select p.adventure_id, p.completed_by_id, p.rating, p.memory
    from public.group_progress gp
    join public.progress p on p.id = gp.progress_id
    join public.group_members gm
      on gm.group_id = gp.group_id and gm.user_id = gp.shared_by_id
   where gp.group_id = p_group_id
     and p.completed
     -- The aligned client treats a group_id-free personal row as canonical.
     -- Legacy group-scoped rows can duplicate it or be the sole old copy;
     -- neither case authorizes exposing their separate private feedback.
     and p.group_id is null
     -- Historical group rows can name someone other than their record owner
     -- as completer. Never label the owner's private note as that person's.
     and p.completed_by_id = gp.shared_by_id
     and gm.share_completions
     and gm.share_feedback
     and public.is_group_member(p_group_id);
$$;

-- Consent changes arrive through the existing group_members subscription.
-- Ensure that table is published; touching every group_progress projection
-- for one toggle would fan out thousands of redundant events for active users.
do $realtime$
begin
  if not exists (
    select 1 from pg_publication_tables
     where pubname = 'supabase_realtime'
       and schemaname = 'public' and tablename = 'group_members'
  ) then
    alter publication supabase_realtime add table public.group_members;
  end if;
end
$realtime$;
drop trigger if exists group_members_refresh_feedback on public.group_members;
drop function if exists public.refresh_group_feedback_on_consent();

-- Reuse the existing group_progress subscription for edits to feedback that
-- is already shared. The projection contains neither rating nor memory.

create or replace function public.refresh_group_feedback_on_edit()
returns trigger
language plpgsql
security definer
set search_path = pg_catalog, public
as $$
begin
  if new.completed and new.group_id is null and
     (old.rating is distinct from new.rating or old.memory is distinct from new.memory) then
    update public.group_progress gp
       set refreshed_at = clock_timestamp()
      from public.group_members gm
     where gp.progress_id = new.id
       and gp.group_id = gm.group_id
       and gp.shared_by_id = gm.user_id
       and gm.share_completions and gm.share_feedback;
  end if;
  return new;
end;
$$;

drop trigger if exists progress_refresh_group_feedback on public.progress;
create trigger progress_refresh_group_feedback
after update of rating, memory on public.progress
for each row execute function public.refresh_group_feedback_on_edit();

revoke all on function public.set_group_feedback_sharing(uuid, boolean)
  from PUBLIC, anon, authenticated;
revoke all on function public.group_completion_feedback_feed(uuid)
  from PUBLIC, anon, authenticated;
grant execute on function public.set_group_feedback_sharing(uuid, boolean) to authenticated;
grant execute on function public.group_completion_feedback_feed(uuid) to authenticated;
revoke all on function public.clear_feedback_without_completion()
  from PUBLIC, anon, authenticated;
revoke all on function public.refresh_group_feedback_on_edit()
  from PUBLIC, anon, authenticated;

commit;
notify pgrst, 'reload schema';
