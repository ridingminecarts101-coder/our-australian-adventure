-- Wayfinder: optional sharing of a member's rating and text memory with their group.
-- Apply after schema-completion-dates.sql and schema-group-administration.sql,
-- with the reviewed schema-device-local-photos.sql Storage boundary in place,
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

-- The earlier ownership migration allowed historical group_photos projections
-- to expose cloud photo metadata and Storage objects to another group member.
-- Photos are device-only now. Keep old rows for the owner's separate cleanup,
-- but close every client read path through those projections. storage.objects
-- is Supabase-managed, so verify its reviewed policies instead of altering it.
do $photo_policy_guard$
declare p record;
begin
  if to_regclass('public.photos') is null
     or to_regclass('public.group_photos') is null
     or to_regclass('storage.objects') is null
     or to_regclass('storage.buckets') is null then
    raise exception 'photo ownership prerequisites are missing';
  end if;

  if not exists (
    select 1 from storage.buckets where id = 'memories' and not public
  ) then
    raise exception 'memories Storage bucket must remain private';
  end if;

  if not (select relrowsecurity from pg_class where oid = 'public.photos'::regclass)
     or not (select relrowsecurity from pg_class where oid = 'public.group_photos'::regclass)
     or not (select relrowsecurity from pg_class where oid = 'storage.objects'::regclass) then
    raise exception 'photo and Storage row security must remain enabled';
  end if;

  for p in
    select tablename, policyname from pg_policies
     where schemaname = 'public' and tablename in ('photos', 'group_photos')
       and permissive = 'PERMISSIVE' and cmd in ('ALL', 'SELECT')
       and roles && array['public', 'anon', 'authenticated']::name[]
       and not (
         tablename = 'photos'
         and policyname in ('read owned or projected photos', 'read owned photos')
         or tablename = 'group_photos'
         and policyname in ('members read projections', 'owners read photo projections')
       )
  loop
    raise exception 'unreviewed photo read policy: %.%', p.tablename, p.policyname;
  end loop;

  if (select count(*) from pg_policies
       where schemaname = 'storage' and tablename = 'objects'
         and roles && array['public', 'anon', 'authenticated']::name[]) <> 2
     or not exists (
       select 1 from pg_policies
        where schemaname = 'storage' and tablename = 'objects'
          and policyname = 'read owned or projected memory files'
          and cmd = 'SELECT' and permissive = 'PERMISSIVE'
          and roles = array['authenticated']::name[]
          and regexp_replace(lower(coalesce(qual, '')),
                '[[:space:]()]|::text', '', 'g') in (
            'bucket_id=''memories''andcan_read_memory_objectname',
            'bucket_id=''memories''andpublic.can_read_memory_objectname'
          )
     )
     or not exists (
       select 1 from pg_policies
        where schemaname = 'storage' and tablename = 'objects'
          and policyname = 'delete owned memory files'
          and cmd = 'DELETE' and permissive = 'PERMISSIVE'
          and roles = array['authenticated']::name[]
          and regexp_replace(lower(coalesce(qual, '')),
                '[[:space:]()]|::text', '', 'g') in (
            'bucket_id=''memories''andcan_manage_memory_objectname',
            'bucket_id=''memories''andpublic.can_manage_memory_objectname'
          )
     ) then
    raise exception 'reviewed owner-only Storage policies are required';
  end if;
end
$photo_policy_guard$;

create or replace function public.can_read_photo(pid uuid)
returns boolean
language sql
security definer
stable
set search_path = pg_catalog, public
as $$
  select exists (
    select 1 from public.photos p
     where p.id = pid and p.user_id = auth.uid()
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
        select 1 from public.photos p
         where p.storage_path = object_name and p.user_id = auth.uid()
      );
$$;

revoke all on function public.can_read_photo(uuid) from PUBLIC, anon, authenticated;
revoke all on function public.can_read_memory_object(text) from PUBLIC, anon, authenticated;
grant execute on function public.can_read_photo(uuid) to authenticated;
grant execute on function public.can_read_memory_object(text) to authenticated;

drop policy if exists "read owned or projected photos" on public.photos;
drop policy if exists "read owned photos" on public.photos;
create policy "read owned photos" on public.photos
for select to authenticated using (user_id = auth.uid());

drop policy if exists "members read projections" on public.group_photos;
drop policy if exists "owners read photo projections" on public.group_photos;
create policy "owners read photo projections" on public.group_photos
for select to authenticated using (shared_by_id = auth.uid());
drop policy if exists "owners add projections" on public.group_photos;
revoke all on public.group_photos from PUBLIC, anon;
revoke insert, update on public.group_photos from PUBLIC, anon, authenticated;
grant select, delete on public.group_photos to authenticated;

-- Realtime DELETE events are not filtered through row policies. Historical
-- photo IDs must not be broadcast after the group read path has been closed.
do $photo_realtime$
begin
  if exists (
    select 1 from pg_publication_tables
     where pubname = 'supabase_realtime'
       and schemaname = 'public' and tablename = 'group_photos'
  ) then
    alter publication supabase_realtime drop table public.group_photos;
  end if;
  if exists (
    select 1 from pg_publication_tables
     where pubname = 'supabase_realtime'
       and schemaname = 'public' and tablename = 'photos'
  ) then
    alter publication supabase_realtime drop table public.photos;
  end if;
end
$photo_realtime$;

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

-- Deleting a source group sets progress.group_id to NULL. Remember which rows
-- were group-scoped so they cannot later masquerade as personal completions or
-- expose their legacy notes. This table contains no group IDs or note content;
-- the trigger also covers future group deletions. No progress row is rewritten.
-- A row orphaned by a group deletion before this migration is indistinguishable
-- from an older personal row if both now have group_id = NULL and matching
-- attribution. Review live history before claiming every old note is private.
create table if not exists public.group_scoped_progress_origins (
  progress_id uuid primary key references public.progress(id) on delete cascade
);
alter table public.group_scoped_progress_origins enable row level security;
revoke all on public.group_scoped_progress_origins from PUBLIC, anon, authenticated;
insert into public.group_scoped_progress_origins (progress_id)
select id from public.progress where group_id is not null
on conflict do nothing;

create or replace function public.remember_group_scoped_progress()
returns trigger
language plpgsql
security definer
set search_path = pg_catalog, public
as $$
declare was_group_scoped boolean := new.group_id is not null;
begin
  if tg_op = 'UPDATE' then
    was_group_scoped := was_group_scoped or old.group_id is not null;
  end if;
  if was_group_scoped then
    insert into public.group_scoped_progress_origins (progress_id)
    values (new.id) on conflict do nothing;
  end if;
  return new;
end;
$$;
drop trigger if exists progress_remember_group_scope on public.progress;
create trigger progress_remember_group_scope
after insert or update of group_id on public.progress
for each row execute function public.remember_group_scoped_progress();
revoke all on function public.remember_group_scoped_progress()
  from PUBLIC, anon, authenticated;

-- Keep every existing completion fact and legacy row, while marking which
-- rows came from a canonical personal entry. A raw source group ID could name
-- a different private group because completion projections span all of a
-- member's consented groups, so expose only the personal-row boolean.
-- PostgreSQL requires a drop/recreate to extend a RETURNS TABLE signature.
drop function if exists public.group_completion_feed(uuid);
create function public.group_completion_feed(p_group_id uuid)
returns table (
  adventure_id integer,
  completed boolean,
  completed_at timestamptz,
  completed_on date,
  completed_by_id uuid,
  completed_by text,
  updated_at timestamptz,
  source_user_id uuid,
  source_is_personal boolean,
  shared_by_id uuid
)
language sql
security definer
stable
set search_path = pg_catalog, public
as $$
  select p.adventure_id, p.completed, p.completed_at, p.completed_on,
         p.completed_by_id, p.completed_by, p.updated_at,
         p.user_id,
         p.group_id is null and origin.progress_id is null,
         gp.shared_by_id
    from public.group_progress gp
    join public.progress p on p.id = gp.progress_id
    left join public.group_scoped_progress_origins origin on origin.progress_id = p.id
   where gp.group_id = p_group_id
     and p.completed
     and public.is_group_member(p_group_id);
$$;
revoke all on function public.group_completion_feed(uuid)
  from PUBLIC, anon, authenticated;
grant execute on function public.group_completion_feed(uuid) to authenticated;

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
     and not exists (
       select 1 from public.group_scoped_progress_origins origin
        where origin.progress_id = p.id
     )
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
