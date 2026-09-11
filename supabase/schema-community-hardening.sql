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

-- A vote belongs to one person and one post. Moving it would leave the old
-- post's aggregate stale and can corrupt totals during an ordinary update.
create or replace function public.guard_recommendation_vote_identity()
returns trigger language plpgsql set search_path = pg_catalog, public as $$
begin
  if new.rec_id is distinct from old.rec_id or new.user_id is distinct from old.user_id then
    raise exception 'vote identity cannot be changed';
  end if;
  return new;
end;
$$;
drop trigger if exists recommendation_vote_identity on public.recommendation_votes;
create trigger recommendation_vote_identity before update on public.recommendation_votes
  for each row execute function public.guard_recommendation_vote_identity();

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
