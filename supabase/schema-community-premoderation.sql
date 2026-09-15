-- Wayfinder Community: every new or edited public recommendation requires
-- operator approval. Apply after schema-community-hardening.sql and
-- schema-personal-ownership.sql. Do not deploy the client before this migration.
begin;

do $preflight$
begin
  if to_regclass('public.recommendations') is null or
     to_regclass('public.wayfinder_schema_migrations') is null then
    raise exception 'Community and ownership migrations must be applied first';
  end if;
end $preflight$;

alter table public.recommendations
  add column if not exists moderation_status text not null default 'pending';
alter table public.recommendations
  add column if not exists approved_at timestamptz;

do $constraint$
begin
  if not exists (select 1 from pg_constraint where
    conrelid = 'public.recommendations'::regclass and
    conname = 'recommendations_moderation_status_check') then
    alter table public.recommendations add constraint recommendations_moderation_status_check
      check (moderation_status in ('pending', 'approved'));
  end if;
end $constraint$;

-- This is a one-time privacy cutover. Replaying this script must never hide
-- content an operator subsequently reviewed and approved.
do $initial_hold$
begin
  if not exists (select 1 from public.wayfinder_schema_migrations
    where migration_key = 'community-premoderation-v1') then
    update public.recommendations set moderation_status = 'pending',
      approved_at = null, hidden = true;
    insert into public.wayfinder_schema_migrations (migration_key)
      values ('community-premoderation-v1');
  end if;
end $initial_hold$;

-- Ordinary clients already have only content-column UPDATE grants. This
-- invoker trigger is a second boundary if a future grant is accidentally
-- broadened. Counter changes by existing SECURITY DEFINER vote/report triggers
-- do not count as content edits and do not requeue the post.
create or replace function public.guard_recommendation_moderation()
returns trigger language plpgsql set search_path = pg_catalog, public as $$
declare operator_session boolean := current_user in ('postgres', 'supabase_admin');
declare content_changed boolean;
begin
  if tg_op = 'INSERT' then
    if new.moderation_status <> 'pending' or new.approved_at is not null then
      raise exception 'New Community content must begin pending';
    end if;
    -- The original hidden default is false. Force private even on a legitimate
    -- insert that omits moderation fields or a client that tries hidden=false.
    new.hidden := true;
    return new;
  end if;

  content_changed := row(new.author_name,new.title,new.place,new.country,
      new.admin1,new.category,new.description) is distinct from
    row(old.author_name,old.title,old.place,old.country,
      old.admin1,old.category,old.description);

  if not operator_session then
    if new.created_by is distinct from old.created_by or
       new.created_at is distinct from old.created_at or
       new.moderation_status is distinct from old.moderation_status or
       new.approved_at is distinct from old.approved_at or
       new.hidden is distinct from old.hidden or
       new.up_votes is distinct from old.up_votes or
       new.down_votes is distinct from old.down_votes or
       new.stars_sum is distinct from old.stars_sum or
       new.stars_count is distinct from old.stars_count or
       new.report_count is distinct from old.report_count then
      raise exception 'Only an operator may change moderation or counters';
    end if;
    -- Every author edit, including an author-name change on a held post,
    -- must go through review. This never clears a report hold.
    new.moderation_status := 'pending';
    new.approved_at := null;
    new.hidden := true;
    return new;
  end if;

  if content_changed then
    new.moderation_status := 'pending';
    new.approved_at := null;
    new.hidden := true;
  elsif new.moderation_status = 'approved' and old.moderation_status <> 'approved' then
    new.approved_at := now();
    if old.report_count >= 3 and not new.hidden then
      raise exception 'Reported content needs a separate operator adjudication';
    end if;
  elsif new.moderation_status = 'pending' then
    new.approved_at := null;
    new.hidden := true;
  end if;
  if new.moderation_status = 'approved' and new.approved_at is null then
    raise exception 'Approved content requires an approval timestamp';
  end if;
  if not new.hidden and new.moderation_status <> 'approved' then
    raise exception 'Only approved content can be public';
  end if;
  return new;
end;
$$;

drop trigger if exists recommendation_moderation_guard on public.recommendations;
create trigger recommendation_moderation_guard
  before insert or update on public.recommendations
  for each row execute function public.guard_recommendation_moderation();
-- Trigger invocation does not require a client-callable SQL function.
revoke all on function public.guard_recommendation_moderation() from public, anon, authenticated;

drop policy if exists "read visible recommendations" on public.recommendations;
create policy "read visible recommendations" on public.recommendations
  for select to authenticated using (
    (created_by = auth.uid() or (moderation_status = 'approved' and not hidden))
    and not exists (select 1 from public.blocked_authors b
      where b.user_id = auth.uid() and b.blocked_id = recommendations.created_by)
  );

-- Reassert the exact client write surface, including the new columns.
revoke insert, update on public.recommendations from public, anon, authenticated;
do $column_grants$
declare col record;
begin
  for col in select column_name from information_schema.columns
    where table_schema='public' and table_name='recommendations' loop
    execute format('revoke insert (%I), update (%I) on public.recommendations from public, anon, authenticated',
      col.column_name, col.column_name);
  end loop;
end $column_grants$;
grant insert (created_by, author_name, title, place, country, admin1, category, description)
  on public.recommendations to authenticated;
grant update (author_name, title, place, country, admin1, category, description)
  on public.recommendations to authenticated;

-- Operator playbook (SQL Editor only): inspect title, place, description and
-- reports for the exact id; approve with status='approved',hidden=false if
-- report_count<3. For an existing >=3-report hold, first approve while hidden;
-- then, after separate adjudication, explicitly unhide the approved row.
-- No client approval RPC or service-role key is exposed by this migration.
commit;
