-- Wayfinder 1.1.0: editable calendar dates for completed adventures.
-- Apply after schema-personal-ownership.sql and before publishing the 1.1.0
-- client. No existing completion timestamp is rewritten. Safe to re-run.

begin;

alter table public.progress add column if not exists completed_on date;
alter table public.group_progress add column if not exists refreshed_at timestamptz not null default now();

do $range_constraint$
begin
  if not exists (
    select 1 from pg_constraint
     where conrelid = 'public.progress'::regclass
       and conname = 'progress_completed_on_range'
  ) then
    alter table public.progress add constraint progress_completed_on_range
      check (completed_on is null or completed_on between date '1900-01-01' and date '2100-12-31');
  end if;
end
$range_constraint$;

-- An older client may still untick by changing only completed. Never leave a
-- custom date waiting to reappear if that same account ticks the row later.
create or replace function public.clear_uncompleted_date()
returns trigger
language plpgsql
set search_path = pg_catalog, public
as $$
begin
  if not new.completed then
    new.completed_on := null;
  elsif tg_op = 'UPDATE' and new.completed_on is null
        and old.completed_on is not null then
    -- An older client can omit this new column during a stale rating/note
    -- upsert. Keep both parts of the corrected date until someone unticks or
    -- uses the new date editor to make an explicit replacement.
    new.completed_on := old.completed_on;
    new.completed_at := old.completed_at;
  end if;
  return new;
end;
$$;

drop trigger if exists progress_clear_uncompleted_date on public.progress;
create trigger progress_clear_uncompleted_date
before insert or update of completed, completed_on on public.progress
for each row execute function public.clear_uncompleted_date();

-- The group projection is an ownership/consent boundary. Touch only its
-- refresh timestamp when a completion fact changes, so subscribed members
-- receive an UPDATE and re-fetch the restricted feed. Private notes, ratings
-- and shortlist edits do not create a group event.
create or replace function public.sync_completion_projections()
returns trigger
language plpgsql
security definer
set search_path = pg_catalog, public
as $$
begin
  if tg_op = 'UPDATE'
     and old.completed is not distinct from new.completed
     and old.completed_at is not distinct from new.completed_at
     and old.completed_on is not distinct from new.completed_on then
    return new;
  end if;
  if new.completed then
    insert into public.group_progress (group_id, progress_id, shared_by_id)
    select gm.group_id, new.id, new.user_id
      from public.group_members gm
     where gm.user_id = new.user_id and gm.share_completions
    on conflict (group_id, progress_id)
      do update set refreshed_at = now();
  else
    delete from public.group_progress
     where progress_id = new.id and shared_by_id = new.user_id;
  end if;
  return new;
end;
$$;

drop trigger if exists progress_sync_completion_projections on public.progress;
create trigger progress_sync_completion_projections
after insert or update of completed, completed_at, completed_on on public.progress
for each row execute function public.sync_completion_projections();

-- Postgres cannot replace a RETURNS TABLE function with an extra column.
-- Its security-definer membership check remains the same as the previous RPC.
drop function if exists public.group_completion_feed(uuid);
create function public.group_completion_feed(p_group_id uuid)
returns table (
  adventure_id integer,
  completed boolean,
  completed_at timestamptz,
  completed_on date,
  completed_by_id uuid,
  completed_by text,
  updated_at timestamptz
)
language sql
security definer
stable
set search_path = pg_catalog, public
as $$
  select p.adventure_id, p.completed, p.completed_at, p.completed_on,
         p.completed_by_id, p.completed_by, p.updated_at
    from public.group_progress gp
    join public.progress p on p.id = gp.progress_id
   where gp.group_id = p_group_id
     and p.completed
     and public.is_group_member(p_group_id);
$$;

revoke all on function public.group_completion_feed(uuid) from PUBLIC, anon, authenticated;
grant execute on function public.group_completion_feed(uuid) to authenticated;

commit;
notify pgrst, 'reload schema';
