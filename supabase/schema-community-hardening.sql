-- Wayfinder Community authorization repair.
-- Apply after schema-recommendations.sql. Prepared locally; not yet deployed.
-- Authors may edit their words, but cannot set moderation state, attribution,
-- timestamps or aggregate vote/report counters. Existing RLS still limits rows.
begin;

revoke insert, update on public.recommendations from public, anon, authenticated;
-- Remove any earlier per-column grants too, before granting the intended set.
do $column_grants$
declare col record;
begin
  for col in select column_name from information_schema.columns
    where table_schema = 'public' and table_name = 'recommendations'
  loop
    execute format('revoke insert (%I), update (%I) on public.recommendations from public, anon, authenticated',
      col.column_name, col.column_name);
  end loop;
end
$column_grants$;

grant insert (created_by, author_name, title, place, country, admin1, category, description)
  on public.recommendations to authenticated;
grant update (author_name, title, place, country, admin1, category, description)
  on public.recommendations to authenticated;

-- Browser maxlength attributes are usability hints, not an authorization
-- boundary. Bound the remaining user-supplied text at the database. NOT VALID
-- enforces new writes while allowing any historical outlier to be reviewed
-- separately instead of aborting the security rollout.
do $content_constraints$
begin
  if not exists (select 1 from pg_constraint
    where conrelid='public.recommendations'::regclass and conname='recommendations_author_name_length') then
    alter table public.recommendations add constraint recommendations_author_name_length
      check (author_name is null or length(author_name) <= 80) not valid;
  end if;
  if not exists (select 1 from pg_constraint
    where conrelid='public.recommendations'::regclass and conname='recommendations_admin1_length') then
    alter table public.recommendations add constraint recommendations_admin1_length
      check (admin1 is null or length(admin1) <= 100) not valid;
  end if;
  if not exists (select 1 from pg_constraint
    where conrelid='public.recommendations'::regclass and conname='recommendations_category_length') then
    alter table public.recommendations add constraint recommendations_category_length
      check (category is null or length(category) <= 50) not valid;
  end if;
  if not exists (select 1 from pg_constraint
    where conrelid='public.recommendation_reports'::regclass and conname='recommendation_reports_reason_length') then
    alter table public.recommendation_reports add constraint recommendation_reports_reason_length
      check (reason is null or length(reason) <= 300) not valid;
  end if;
end
$content_constraints$;

-- A vote belongs to one person and one post. Moving it would leave the old
-- post's aggregate stale and can corrupt totals during an ordinary update.
create or replace function public.guard_recommendation_vote_identity()
returns trigger language plpgsql set search_path = pg_catalog, public as $$
begin
  if tg_op = 'INSERT' then
    new.voted_at := now();
    return new;
  end if;
  if new.rec_id is distinct from old.rec_id or new.user_id is distinct from old.user_id then
    raise exception 'vote identity cannot be changed';
  end if;
  if new.voted_at is distinct from old.voted_at then
    raise exception 'vote timestamp cannot be changed';
  end if;
  return new;
end;
$$;
drop trigger if exists recommendation_vote_identity on public.recommendation_votes;
create trigger recommendation_vote_identity before insert or update on public.recommendation_votes
  for each row execute function public.guard_recommendation_vote_identity();

create or replace function public.guard_recommendation_report_identity()
returns trigger language plpgsql set search_path = pg_catalog, public as $$
begin
  if tg_op = 'INSERT' then
    new.reported_at := now();
    return new;
  end if;
  if new.rec_id is distinct from old.rec_id or new.user_id is distinct from old.user_id then
    raise exception 'report identity cannot be changed';
  end if;
  if new.reported_at is distinct from old.reported_at then
    raise exception 'report timestamp cannot be changed';
  end if;
  return new;
end;
$$;
drop trigger if exists recommendation_report_identity on public.recommendation_reports;
create trigger recommendation_report_identity before insert or update on public.recommendation_reports
  for each row execute function public.guard_recommendation_report_identity();

drop policy if exists "change your report" on public.recommendation_reports;
create policy "change your report" on public.recommendation_reports
  for update to authenticated
  using (user_id = auth.uid()) with check (user_id = auth.uid());

create or replace function public.recount_votes()
returns trigger language plpgsql security definer
set search_path = pg_catalog, public as $$
declare target uuid;
begin
  target := coalesce(new.rec_id, old.rec_id);
  update public.recommendations r set
    up_votes = (select count(*) from public.recommendation_votes v where v.rec_id = target and v.vote = 1),
    down_votes = (select count(*) from public.recommendation_votes v where v.rec_id = target and v.vote = -1),
    stars_sum = coalesce((select sum(v.stars) from public.recommendation_votes v where v.rec_id = target), 0),
    stars_count = (select count(*) from public.recommendation_votes v where v.rec_id = target and v.stars is not null)
  where r.id = target;
  return null;
end;
$$;

create or replace function public.recount_reports()
returns trigger language plpgsql security definer
set search_path = pg_catalog, public as $$
declare target uuid; n integer;
begin
  target := coalesce(new.rec_id, old.rec_id);
  select count(*) into n from public.recommendation_reports where rec_id = target;
  update public.recommendations
     set report_count = n, hidden = hidden or n >= 3
   where id = target;
  -- Only an operator can clear an existing moderation hold. A later report,
  -- reporter account deletion, or author edit cannot silently unhide it.
  return null;
end;
$$;

-- Recompute aggregates from their authoritative rows, preserving existing holds.
-- On replay, three still-active reports can reapply a previously cleared hold.
update public.recommendations r set
  up_votes = (select count(*) from public.recommendation_votes v where v.rec_id = r.id and v.vote = 1),
  down_votes = (select count(*) from public.recommendation_votes v where v.rec_id = r.id and v.vote = -1),
  stars_sum = coalesce((select sum(v.stars) from public.recommendation_votes v where v.rec_id = r.id), 0),
  stars_count = (select count(*) from public.recommendation_votes v where v.rec_id = r.id and v.stars is not null),
  report_count = (select count(*) from public.recommendation_reports p where p.rec_id = r.id),
  hidden = r.hidden or (select count(*) from public.recommendation_reports p where p.rec_id = r.id) >= 3;

commit;
