-- ═══════════════════════════════════════════════════════════════════
--  Wayfinder — user recommendations
-- ═══════════════════════════════════════════════════════════════════
--  Run once in the Supabase SQL Editor, after schema-cutover.sql.
--  Safe to re-run.
--
--  A SEPARATE LIST, ON PURPOSE
--
--  Nothing here ever joins the curated adventures. The curated list is
--  checked, and its value is that somebody stands behind every entry.
--  These are recommendations from other travellers, ranked by the people
--  reading them, and the app says so on every screen they appear on.
--
--  There is no promotion path and no shared table. They are different
--  things and they stay different things.
--
--  MODERATION IS NOT OPTIONAL
--
--  Apple's guideline 1.2 requires four things of any app carrying public
--  user content: a way to filter objectionable material, a way to report
--  it, a way to block the person who posted it, and a published contact.
--  Apps ship without these and get rejected. All four are here:
--
--    * report_count with an automatic hide at three reports
--    * a per-viewer block list that filters at the database, not the UI
--    * hidden flag for manual takedown
--    * the contact address is on the support page
-- ═══════════════════════════════════════════════════════════════════


-- ───────────────────────────────────────────────────────────────────
--  Tables
-- ───────────────────────────────────────────────────────────────────
create table if not exists public.recommendations (
  id           uuid        primary key default gen_random_uuid(),
  created_by   uuid        not null references auth.users(id) on delete cascade,
  author_name  text,
  title        text        not null check (length(btrim(title)) between 4 and 90),
  place        text        not null check (length(btrim(place)) between 2 and 90),
  country      text        not null check (length(country) = 2),
  admin1       text,
  category     text,
  description  text        check (description is null or length(description) <= 600),
  -- Denormalised so the list can be sorted without counting rows every time.
  up_votes     integer     not null default 0,
  down_votes   integer     not null default 0,
  stars_sum    integer     not null default 0,
  stars_count  integer     not null default 0,
  report_count integer     not null default 0,
  hidden       boolean     not null default false,
  created_at   timestamptz not null default now()
);

create index if not exists recs_rank_idx on public.recommendations
  ((up_votes - down_votes) desc, created_at desc);
create index if not exists recs_country_idx on public.recommendations (country);

-- One vote and one rating per person per recommendation.
create table if not exists public.recommendation_votes (
  rec_id   uuid     not null references public.recommendations(id) on delete cascade,
  user_id  uuid     not null references auth.users(id) on delete cascade,
  vote     smallint check (vote in (-1, 0, 1)) default 0,
  stars    smallint check (stars is null or stars between 1 and 5),
  voted_at timestamptz not null default now(),
  primary key (rec_id, user_id)
);

create table if not exists public.recommendation_reports (
  rec_id      uuid not null references public.recommendations(id) on delete cascade,
  user_id     uuid not null references auth.users(id) on delete cascade,
  reason      text,
  reported_at timestamptz not null default now(),
  primary key (rec_id, user_id)
);

-- Blocking is per viewer. Blocking somebody hides everything they have ever
-- posted, from you only, immediately.
create table if not exists public.blocked_authors (
  user_id    uuid not null references auth.users(id) on delete cascade,
  blocked_id uuid not null references auth.users(id) on delete cascade,
  blocked_at timestamptz not null default now(),
  primary key (user_id, blocked_id)
);


-- ───────────────────────────────────────────────────────────────────
--  Counters, kept right by the database rather than by the app
-- ───────────────────────────────────────────────────────────────────
create or replace function public.recount_votes()
returns trigger language plpgsql security definer
set search_path = public as $$
declare target uuid;
begin
  target := coalesce(new.rec_id, old.rec_id);
  update public.recommendations r set
    up_votes    = (select count(*) from recommendation_votes v
                    where v.rec_id = target and v.vote = 1),
    down_votes  = (select count(*) from recommendation_votes v
                    where v.rec_id = target and v.vote = -1),
    stars_sum   = coalesce((select sum(stars) from recommendation_votes v
                    where v.rec_id = target and v.stars is not null), 0),
    stars_count = (select count(*) from recommendation_votes v
                    where v.rec_id = target and v.stars is not null)
  where r.id = target;
  return null;
end $$;

drop trigger if exists recount_votes_trg on public.recommendation_votes;
create trigger recount_votes_trg
  after insert or update or delete on public.recommendation_votes
  for each row execute function public.recount_votes();


-- Three independent reports takes it out of everyone's list pending review.
-- Deliberately low: a false positive costs one person a post for a day, a
-- false negative puts something vile in front of everybody.
create or replace function public.recount_reports()
returns trigger language plpgsql security definer
set search_path = public as $$
declare target uuid; n int;
begin
  target := coalesce(new.rec_id, old.rec_id);
  select count(*) into n from recommendation_reports where rec_id = target;
  update public.recommendations
     set report_count = n, hidden = (n >= 3)
   where id = target;
  return null;
end $$;

drop trigger if exists recount_reports_trg on public.recommendation_reports;
create trigger recount_reports_trg
  after insert or delete on public.recommendation_reports
  for each row execute function public.recount_reports();


-- ───────────────────────────────────────────────────────────────────
--  Who may see and do what
-- ───────────────────────────────────────────────────────────────────
alter table public.recommendations        enable row level security;
alter table public.recommendation_votes   enable row level security;
alter table public.recommendation_reports enable row level security;
alter table public.blocked_authors        enable row level security;

drop policy if exists "read visible recommendations" on public.recommendations;
drop policy if exists "post a recommendation"        on public.recommendations;
drop policy if exists "edit your own recommendation" on public.recommendations;
drop policy if exists "delete your own recommendation" on public.recommendations;

-- Hidden posts and blocked authors are filtered here rather than in the app,
-- so a blocked account cannot reach you by any route.
create policy "read visible recommendations" on public.recommendations
  for select to authenticated using (
    (not hidden or created_by = auth.uid())
    and not exists (
      select 1 from public.blocked_authors b
       where b.user_id = auth.uid() and b.blocked_id = recommendations.created_by
    ));

create policy "post a recommendation" on public.recommendations
  for insert to authenticated with check (created_by = auth.uid());
create policy "edit your own recommendation" on public.recommendations
  for update to authenticated
  using (created_by = auth.uid()) with check (created_by = auth.uid());
create policy "delete your own recommendation" on public.recommendations
  for delete to authenticated using (created_by = auth.uid());

drop policy if exists "read votes"   on public.recommendation_votes;
drop policy if exists "cast a vote"  on public.recommendation_votes;
drop policy if exists "change a vote" on public.recommendation_votes;
drop policy if exists "withdraw a vote" on public.recommendation_votes;

-- You can read the totals on the recommendation itself; the individual votes
-- are yours alone, so nobody can see who downvoted them.
create policy "read votes" on public.recommendation_votes
  for select to authenticated using (user_id = auth.uid());
create policy "cast a vote" on public.recommendation_votes
  for insert to authenticated with check (user_id = auth.uid());
create policy "change a vote" on public.recommendation_votes
  for update to authenticated
  using (user_id = auth.uid()) with check (user_id = auth.uid());
create policy "withdraw a vote" on public.recommendation_votes
  for delete to authenticated using (user_id = auth.uid());

drop policy if exists "report something" on public.recommendation_reports;
drop policy if exists "see your reports" on public.recommendation_reports;
create policy "report something" on public.recommendation_reports
  for insert to authenticated with check (user_id = auth.uid());
create policy "see your reports" on public.recommendation_reports
  for select to authenticated using (user_id = auth.uid());

drop policy if exists "manage your block list" on public.blocked_authors;
create policy "manage your block list" on public.blocked_authors
  for all to authenticated
  using (user_id = auth.uid()) with check (user_id = auth.uid());


-- ───────────────────────────────────────────────────────────────────
--  Realtime, so a vote lands on the other phones
-- ───────────────────────────────────────────────────────────────────
do $$
begin
  begin
    alter publication supabase_realtime add table public.recommendations;
  exception when duplicate_object then null;
  end;
end $$;


do $$
declare n int;
begin
  select count(*) into n from public.recommendations;
  raise notice '─────────────────────────────────────────────';
  raise notice 'Recommendations ready. % posted so far.', n;
  raise notice 'Hidden automatically at 3 reports. Blocking is per viewer';
  raise notice 'and filtered in the database, not the interface.';
  raise notice 'Nothing here ever joins the curated adventure list.';
  raise notice '─────────────────────────────────────────────';
end $$;
