-- Wayfinder Community email-review contract. Apply after
-- schema-community-premoderation.sql and schema-verified-community-access.sql.
-- No email, Auth identity, photo, or duplicate customer text is stored in the
-- notifier outbox. This migration is local review material; not deployed.
begin;

do $preflight$
begin
  if to_regclass('public.recommendations') is null or
     to_regclass('public.wayfinder_schema_migrations') is null or
     to_regprocedure('public.guard_recommendation_moderation()') is null or
     to_regprocedure('public.has_verified_email_account()') is null then
    raise exception 'Community premoderation and verified-account migrations required';
  end if;
end $preflight$;

alter table public.recommendations add column if not exists source_url text;
alter table public.recommendations add column if not exists moderation_consent_version text;
alter table public.recommendations add column if not exists moderation_consent_nonce uuid;
alter table public.recommendations add column if not exists moderation_revision bigint not null default 0;
alter table public.recommendations add column if not exists moderation_reason text;

-- Email/source links are never fetched by the mail worker. Still reject URL
-- authority tricks, ports, literal IPs and local/internal domains before a
-- link can reach a reviewer or public recommendation.
create or replace function public.is_public_community_source_url(p_url text)
returns boolean language plpgsql immutable set search_path=pg_catalog,public as $$
declare host text;
begin
  if p_url is null then return true; end if;
  if length(p_url)>2048 or p_url ~ '[<>[:space:]]' or
     p_url !~ '^https://[A-Za-z0-9][A-Za-z0-9.-]*(/[[:graph:]]*)?$' then
    return false;
  end if;
  host := lower(substring(p_url from '^https://([^/]+)'));
  if host !~ '^[a-z0-9](?:[a-z0-9-]*[a-z0-9])?(?:\.[a-z0-9](?:[a-z0-9-]*[a-z0-9])?)+$' or
     host !~ '\.(?:[a-z]{2,}|xn--[a-z0-9][a-z0-9-]*[a-z0-9])$' or
     host ~ '(^|\.)(localhost|local|internal|test|example|invalid)$' then
    return false;
  end if;
  return true;
end;
$$;
revoke all on function public.is_public_community_source_url(text)
  from public,anon,authenticated,service_role;
grant execute on function public.is_public_community_source_url(text) to authenticated;

alter table public.recommendations drop constraint if exists recommendations_moderation_status_check;
alter table public.recommendations add constraint recommendations_moderation_status_check
  check (moderation_status in ('pending','approved','rejected'));

do $constraints$
begin
  if not exists(select 1 from pg_constraint where conrelid='public.recommendations'::regclass
    and conname='recommendations_source_url_check') then
    alter table public.recommendations add constraint recommendations_source_url_check
      check (public.is_public_community_source_url(source_url)) not valid;
  end if;
  if not exists(select 1 from pg_constraint where conrelid='public.recommendations'::regclass
    and conname='recommendations_consent_version_check') then
    alter table public.recommendations add constraint recommendations_consent_version_check
      check (moderation_consent_version is null or
        moderation_consent_version = 'community-ai-2026-09-15') not valid;
  end if;
  if not exists(select 1 from pg_constraint where conrelid='public.recommendations'::regclass
    and conname='recommendations_moderation_reason_check') then
    alter table public.recommendations add constraint recommendations_moderation_reason_check
      check (moderation_reason is null or length(moderation_reason) between 1 and 500) not valid;
  end if;
  if not exists(select 1 from pg_constraint where conrelid='public.recommendations'::regclass
    and conname='recommendations_revision_consent_check') then
    alter table public.recommendations add constraint recommendations_revision_consent_check
      check (moderation_revision = 0 or
        (moderation_revision > 0 and moderation_consent_version = 'community-ai-2026-09-15'
          and moderation_consent_nonce is not null)) not valid;
  end if;
end $constraints$;

-- Do not unpublish recommendations that an operator already approved under
-- the prior manual-review contract. Revision-zero rows never enter the new
-- email/AI outbox; fresh consent is required for any later author edit.

-- Rate events deliberately have no recommendation FK: deleting a post does not
-- reset its author's rolling 3/hour or 20/day budget. Auth deletion cascades.
create table if not exists public.community_review_rate_events(
  owner_id uuid not null references auth.users(id) on delete cascade,
  submitted_at timestamptz not null default now()
);
create index if not exists community_review_rate_owner_time_idx
  on public.community_review_rate_events(owner_id,submitted_at desc);
alter table public.community_review_rate_events enable row level security;
revoke all on public.community_review_rate_events from public,anon,authenticated,service_role;

create table if not exists public.community_review_outbox(
  recommendation_id uuid not null references public.recommendations(id) on delete cascade,
  moderation_revision bigint not null check (moderation_revision > 0),
  state text not null default 'pending'
    check (state in ('pending','leased','sent','superseded','failed')),
  attempt_count integer not null default 0 check (attempt_count between 0 and 10),
  queued_at timestamptz not null default now(),
  first_claimed_at timestamptz,
  next_attempt_at timestamptz not null default now(),
  lease_expires_at timestamptz,
  lease_token uuid,
  error_code text,
  primary key(recommendation_id,moderation_revision)
);
create index if not exists community_review_outbox_pending_idx
  on public.community_review_outbox(next_attempt_at,queued_at)
  where state in ('pending','leased');
alter table public.community_review_outbox enable row level security;
revoke all on public.community_review_outbox from public,anon,authenticated,service_role;

-- A finite community-notification budget leaves nominal capacity for account
-- emails under the shared Resend daily limit; it does not guarantee mail quota.
create table if not exists public.community_review_mail_daily(
  utc_day date primary key,
  claim_count integer not null default 0 check (claim_count between 0 and 50)
);
alter table public.community_review_mail_daily enable row level security;
revoke all on public.community_review_mail_daily from public,anon,authenticated,service_role;

-- Private decision audit: reason is the approval evidence rationale or the
-- author-visible denial reason. No duplicate submitted content or email.
create table if not exists public.community_review_decisions(
  recommendation_id uuid not null references public.recommendations(id) on delete cascade,
  moderation_revision bigint not null,
  decision text not null check (decision in ('approve','reject')),
  reviewer_label text not null check (length(reviewer_label) between 1 and 80),
  reason text not null check (length(reason) between 1 and 500),
  reviewed_at timestamptz not null default now(),
  primary key(recommendation_id,moderation_revision)
);
alter table public.community_review_decisions enable row level security;
revoke all on public.community_review_decisions from public,anon,authenticated,service_role;

-- This helper can only consume the caller's own rate budget. It has no row
-- payload and reveals no other account. An exposed direct call can at worst
-- exhaust the caller's own quota, never another person's.
create or replace function public.record_community_review_rate_event()
returns void language plpgsql security definer
set search_path=pg_catalog,public as $$
declare owner uuid := auth.uid();
declare now_at timestamptz := clock_timestamp();
begin
  if current_setting('role',true) <> 'authenticated' or owner is null then
    raise exception using errcode='42501',message='Verified account required for Community review';
  end if;
  perform pg_advisory_xact_lock(hashtextextended(owner::text,41642));
  if (select count(*) from public.community_review_rate_events
      where owner_id=owner and submitted_at > now_at-interval '1 hour') >= 3 then
    raise exception using errcode='P0001',message='Community review limit: try again later (3 per hour)';
  end if;
  if (select count(*) from public.community_review_rate_events
      where owner_id=owner and submitted_at > now_at-interval '24 hours') >= 20 then
    raise exception using errcode='P0001',message='Community review limit: try again later (20 per day)';
  end if;
  insert into public.community_review_rate_events(owner_id,submitted_at)
    values(owner,now_at);
  delete from public.community_review_rate_events
    where owner_id=owner and submitted_at < now_at-interval '2 days';
end;
$$;
revoke all on function public.record_community_review_rate_event()
  from public,anon,authenticated,service_role;
grant execute on function public.record_community_review_rate_event() to authenticated;

-- Replaces the prior invoker guard. Only an author supplying a fresh consent
-- nonce for this edit can produce a new revision. Operator counter triggers
-- never edit submitted text and therefore never use or consume consent.
create or replace function public.guard_recommendation_moderation()
returns trigger language plpgsql set search_path=pg_catalog,public as $$
declare operator_session boolean := current_user in ('postgres','supabase_admin');
declare client_session boolean := current_user='authenticated';
declare content_changed boolean;
declare resubmitted boolean;
declare review_gate boolean := current_setting('wayfinder.community_review_function',true)='on';
declare legacy_manual boolean;
begin
  if tg_op='INSERT' then
    if not client_session and not operator_session then
      raise exception using errcode='42501',message='Community submission requires a verified user';
    end if;
    if client_session and new.created_by is distinct from auth.uid() then
      raise exception using errcode='42501',message='Community author identity mismatch';
    end if;
    if new.moderation_consent_version is distinct from 'community-ai-2026-09-15' or
       new.moderation_consent_nonce is null or
       new.moderation_consent_nonce='00000000-0000-0000-0000-000000000000'::uuid then
      raise exception using errcode='42501',message='Confirm Community email/AI review before submitting';
    end if;
    if new.moderation_revision <> 0 or new.moderation_status <> 'pending' or
       new.moderation_reason is not null or new.approved_at is not null then
      raise exception using errcode='42501',message='A new Community post must begin private and pending';
    end if;
    if client_session then perform public.record_community_review_rate_event(); end if;
    new.moderation_revision := 1;
    new.moderation_status := 'pending';
    new.moderation_reason := null;
    new.approved_at := null;
    new.hidden := true;
    return new;
  end if;

  content_changed := row(new.author_name,new.title,new.place,new.country,
      new.admin1,new.category,new.description,new.source_url) is distinct from
    row(old.author_name,old.title,old.place,old.country,
      old.admin1,old.category,old.description,old.source_url);
  resubmitted := content_changed or
    new.moderation_consent_version is distinct from old.moderation_consent_version or
    new.moderation_consent_nonce is distinct from old.moderation_consent_nonce;

  if client_session then
    if new.created_by is distinct from old.created_by or
       new.created_at is distinct from old.created_at or
       new.moderation_revision is distinct from old.moderation_revision or
       new.moderation_status is distinct from old.moderation_status or
       new.moderation_reason is distinct from old.moderation_reason or
       new.approved_at is distinct from old.approved_at or
       new.hidden is distinct from old.hidden or
       new.up_votes is distinct from old.up_votes or
       new.down_votes is distinct from old.down_votes or
       new.stars_sum is distinct from old.stars_sum or
       new.stars_count is distinct from old.stars_count or
       new.report_count is distinct from old.report_count then
      raise exception using errcode='42501',message='Only an operator may change Community moderation or counters';
    end if;
    if resubmitted then
      if new.moderation_consent_version is distinct from 'community-ai-2026-09-15' or
         new.moderation_consent_nonce is null or
         new.moderation_consent_nonce is not distinct from old.moderation_consent_nonce then
        raise exception using errcode='42501',message='Confirm Community email/AI review for each edit';
      end if;
      if old.moderation_revision >= 9223372036854775807 then
        raise exception 'Community revision limit reached';
      end if;
      perform public.record_community_review_rate_event();
      new.moderation_revision := old.moderation_revision+1;
      new.moderation_status := 'pending';
      new.moderation_reason := null;
      new.approved_at := null;
      new.hidden := true;
    end if;
    return new;
  end if;

  if not operator_session then
    raise exception using errcode='42501',message='Community server update role denied';
  end if;
  legacy_manual := old.moderation_revision=0 and new.moderation_revision=0 and
    old.moderation_consent_version is null and new.moderation_consent_version is null and
    old.moderation_consent_nonce is null and new.moderation_consent_nonce is null;
  if content_changed or new.moderation_consent_nonce is distinct from old.moderation_consent_nonce or
     new.moderation_consent_version is distinct from old.moderation_consent_version then
    raise exception 'Operator must not edit customer submission text or consent';
  end if;
  if new.moderation_revision is distinct from old.moderation_revision then
    raise exception 'Operator must not alter the author revision';
  end if;
  if (new.moderation_status is distinct from old.moderation_status or
      new.moderation_reason is distinct from old.moderation_reason or
      new.approved_at is distinct from old.approved_at or
      (old.hidden and not new.hidden)) and not review_gate and not legacy_manual then
    raise exception 'Use the locked Community review function for decisions';
  end if;
  if new.moderation_status='approved' then
    if (old.moderation_status is distinct from 'approved' or (old.hidden and not new.hidden)) and
       (new.report_count >= 3 or new.hidden or
        (not legacy_manual and
         (new.moderation_consent_version is distinct from 'community-ai-2026-09-15' or
          new.moderation_consent_nonce is null or new.moderation_revision < 1))) then
      raise exception 'Approval requires current consent, revision and no report hold';
    end if;
    if old.moderation_status is distinct from 'approved' then
      new.approved_at := now();
    end if;
    new.moderation_reason := null;
  elsif new.moderation_status='rejected' then
    if new.moderation_reason is null or length(btrim(new.moderation_reason)) not between 1 and 500 then
      raise exception 'A denial needs a clear reason (1-500 characters)';
    end if;
    new.hidden := true;
    new.approved_at := null;
  else
    new.hidden := true;
    new.approved_at := null;
    new.moderation_reason := null;
  end if;
  return new;
end;
$$;
revoke all on function public.guard_recommendation_moderation() from public,anon,authenticated,service_role;

-- Defence in depth: a direct public reader needs the *approved current*
-- consented revision and no hold, even if a privileged direct edit drifted.
drop policy if exists "read visible recommendations" on public.recommendations;
create policy "read visible recommendations" on public.recommendations
  for select to authenticated using (
    (created_by=auth.uid() or
      (moderation_status='approved' and not hidden and report_count<3 and
       approved_at is not null and
       ((moderation_revision=0 and moderation_consent_version is null and
         moderation_consent_nonce is null) or
        (moderation_revision>0 and moderation_consent_version='community-ai-2026-09-15' and
         moderation_consent_nonce is not null))))
    and not exists(select 1 from public.blocked_authors b
      where b.user_id=auth.uid() and b.blocked_id=recommendations.created_by)
  );

-- Exact client edit surface, including source link and per-edit consent.
revoke insert,update on public.recommendations from public,anon,authenticated;
do $column_grants$
declare col record;
begin
  for col in select column_name from information_schema.columns
    where table_schema='public' and table_name='recommendations' loop
    execute format('revoke insert (%I),update (%I) on public.recommendations from public,anon,authenticated',
      col.column_name,col.column_name);
  end loop;
end $column_grants$;
grant insert(created_by,author_name,title,place,country,admin1,category,
  description,source_url,moderation_consent_version,moderation_consent_nonce)
  on public.recommendations to authenticated;
grant update(author_name,title,place,country,admin1,category,
  description,source_url,moderation_consent_version,moderation_consent_nonce)
  on public.recommendations to authenticated;

create or replace function public.enqueue_community_review_notification()
returns trigger language plpgsql security definer
set search_path=pg_catalog,public as $$
begin
  if tg_op='UPDATE' and new.moderation_revision=old.moderation_revision then
    if new.moderation_status<>'pending' then
      update public.community_review_outbox set state='superseded',lease_token=null,
        lease_expires_at=null
        where recommendation_id=new.id and moderation_revision=new.moderation_revision
          and state in ('pending','leased','failed');
    end if;
    return null;
  end if;
  update public.community_review_outbox set state='superseded',lease_token=null,
    lease_expires_at=null
    where recommendation_id=new.id and moderation_revision<new.moderation_revision
      and state in ('pending','leased','failed');
  if new.moderation_status='pending' and
     new.moderation_consent_version='community-ai-2026-09-15' and
     new.moderation_consent_nonce is not null and new.moderation_revision>0 then
    insert into public.community_review_outbox(recommendation_id,moderation_revision)
      values(new.id,new.moderation_revision)
      on conflict(recommendation_id,moderation_revision) do nothing;
  end if;
  return null;
end;
$$;
drop trigger if exists enqueue_community_review_notification_trg on public.recommendations;
create trigger enqueue_community_review_notification_trg
  after insert or update on public.recommendations for each row
  execute function public.enqueue_community_review_notification();
revoke all on function public.enqueue_community_review_notification()
  from public,anon,authenticated,service_role;

-- Mail worker privileges are deliberately separate from review decisions.
-- The API service role is checked *before* any SECURITY DEFINER row access;
-- current_user would be the definer here and is not a caller identity.
create or replace function public.claim_community_review_notifications(p_limit integer default 10)
returns table(recommendation_id uuid,moderation_revision bigint,lease_token uuid,
  attempt_count integer,author_name text,title text,place text,country text,
  admin1 text,category text,description text,source_url text)
language plpgsql security definer set search_path=pg_catalog,public as $$
declare day_key date := (now() at time zone 'UTC')::date;
declare remaining integer;
declare effective_limit integer;
declare item record;
declare next_token uuid;
declare next_attempt integer;
begin
  if current_setting('role',true)<>'service_role' then
    raise exception using errcode='42501',message='Community notifier service role required';
  end if;
  if p_limit is null or p_limit<1 or p_limit>10 then
    raise exception 'Notifier claim limit must be 1-10';
  end if;
  insert into public.community_review_mail_daily(utc_day,claim_count)
    values(day_key,0) on conflict(utc_day) do nothing;
  select 50-d.claim_count into remaining from public.community_review_mail_daily d
    where d.utc_day=day_key for update;
  effective_limit := least(p_limit,remaining);
  if effective_limit<=0 then return; end if;

  -- Ambiguous delivery is never retried past the provider's 24-hour
  -- idempotency window. Retain failed rows for private operator follow-up.
  update public.community_review_outbox o set state='failed',lease_token=null,
    lease_expires_at=null,error_code='delivery_window_expired'
    where o.state in ('pending','leased') and o.first_claimed_at<=now()-interval '24 hours';
  for item in
    select o.recommendation_id,o.moderation_revision,o.attempt_count,o.first_claimed_at
      from public.community_review_outbox o
      join public.recommendations r on r.id=o.recommendation_id
      where (o.state='pending' or (o.state='leased' and o.lease_expires_at<now()))
        and o.next_attempt_at<=now() and o.attempt_count<5
        and (o.first_claimed_at is null or o.first_claimed_at>now()-interval '24 hours')
        and r.moderation_revision=o.moderation_revision
        and r.moderation_status='pending' and r.hidden
        and r.moderation_consent_version='community-ai-2026-09-15'
        and r.moderation_consent_nonce is not null
      order by o.next_attempt_at,o.queued_at
      for update of o skip locked
      limit effective_limit
  loop
    next_token := gen_random_uuid();
    next_attempt := item.attempt_count+1;
    update public.community_review_outbox o set state='leased',
      attempt_count=next_attempt,lease_token=next_token,
      first_claimed_at=coalesce(o.first_claimed_at,now()),
      lease_expires_at=now()+interval '5 minutes',error_code=null
      where o.recommendation_id=item.recommendation_id
        and o.moderation_revision=item.moderation_revision;
    update public.community_review_mail_daily d set claim_count=claim_count+1
      where d.utc_day=day_key;
    return query
      select item.recommendation_id,item.moderation_revision,next_token,next_attempt,
        r.author_name,r.title,r.place,r.country,r.admin1,r.category,
        r.description,r.source_url
        from public.recommendations r
        where r.id=item.recommendation_id
          and r.moderation_revision=item.moderation_revision
          and r.moderation_status='pending' and r.hidden
          and r.moderation_consent_version='community-ai-2026-09-15'
          and r.moderation_consent_nonce is not null;
  end loop;
end;
$$;
revoke all on function public.claim_community_review_notifications(integer)
  from public,anon,authenticated,service_role;
grant execute on function public.claim_community_review_notifications(integer) to service_role;

create or replace function public.ack_community_review_notification(
  p_recommendation_id uuid,p_moderation_revision bigint,p_lease_token uuid)
returns boolean language plpgsql security definer set search_path=pg_catalog,public as $$
declare touched integer;
begin
  if current_setting('role',true)<>'service_role' then
    raise exception using errcode='42501',message='Community notifier service role required';
  end if;
  update public.community_review_outbox o set state='sent',lease_token=null,
    lease_expires_at=null,error_code=null
    where o.recommendation_id=p_recommendation_id
      and o.moderation_revision=p_moderation_revision and o.state='leased'
      and o.lease_token=p_lease_token and o.lease_expires_at>now()
      and exists(select 1 from public.recommendations r where r.id=o.recommendation_id
        and r.moderation_revision=o.moderation_revision and r.moderation_status='pending'
        and r.moderation_consent_version='community-ai-2026-09-15');
  get diagnostics touched=row_count;
  return touched=1;
end;
$$;
revoke all on function public.ack_community_review_notification(uuid,bigint,uuid)
  from public,anon,authenticated,service_role;
grant execute on function public.ack_community_review_notification(uuid,bigint,uuid) to service_role;

create or replace function public.retry_community_review_notification(
  p_recommendation_id uuid,p_moderation_revision bigint,p_lease_token uuid,p_error_code text)
returns boolean language plpgsql security definer set search_path=pg_catalog,public as $$
declare item public.community_review_outbox%rowtype;
declare permanent boolean;
begin
  if current_setting('role',true)<>'service_role' then
    raise exception using errcode='42501',message='Community notifier service role required';
  end if;
  if p_error_code is null or p_error_code not in ('provider_auth','provider_rate_limited','provider_unavailable',
      'provider_rejected','provider_network','content_invalid','worker_database') then
    raise exception 'Use a coarse reviewed notifier error code';
  end if;
  select o.* into item from public.community_review_outbox o
    where o.recommendation_id=p_recommendation_id
      and o.moderation_revision=p_moderation_revision
    for update;
  if not found or item.state<>'leased' or item.lease_token is distinct from p_lease_token or
     item.lease_expires_at<=now() or not exists(select 1 from public.recommendations r
       where r.id=p_recommendation_id and r.moderation_revision=p_moderation_revision
         and r.moderation_status='pending') then
    return false;
  end if;
  permanent := p_error_code in ('provider_auth','provider_rejected','content_invalid') or
    item.attempt_count>=5 or item.first_claimed_at<=now()-interval '24 hours';
  update public.community_review_outbox o set
      state=case when permanent then 'failed' else 'pending' end,
      next_attempt_at=case when permanent then o.next_attempt_at
        else now()+make_interval(secs=>least(3600,30*power(2,item.attempt_count)::integer)) end,
      lease_token=null,lease_expires_at=null,error_code=p_error_code
    where o.recommendation_id=p_recommendation_id
      and o.moderation_revision=p_moderation_revision;
  return true;
end;
$$;
revoke all on function public.retry_community_review_notification(uuid,bigint,uuid,text)
  from public,anon,authenticated,service_role;
grant execute on function public.retry_community_review_notification(uuid,bigint,uuid,text)
  to service_role;

-- This is a human/Codex-assisted *decision*, never a mail-worker endpoint.
-- The approval reason is a private authenticity/safety evidence note. A denial
-- reason becomes visible to the author; neither reason is public content.
create or replace function public.review_community_recommendation(
  p_recommendation_id uuid,p_expected_revision bigint,p_decision text,p_reason text)
returns text language plpgsql set search_path=pg_catalog,public as $$
declare item public.recommendations%rowtype;
declare clean_reason text := btrim(p_reason);
begin
  if current_user not in ('postgres','supabase_admin') then
    raise exception using errcode='42501',message='Protected Community operator role required';
  end if;
  if p_decision is null or p_decision not in ('approve','reject') or clean_reason is null or
     length(clean_reason) not between 1 and 500 then
    raise exception 'Review needs approve/reject and a reason of 1-500 characters';
  end if;
  select r.* into item from public.recommendations r
    where r.id=p_recommendation_id for update;
  if not found or item.moderation_revision is distinct from p_expected_revision or
     item.moderation_status<>'pending' then
    raise exception 'Community review is stale or already decided';
  end if;
  if item.moderation_revision<1 or
     item.moderation_consent_version is distinct from 'community-ai-2026-09-15' or
     item.moderation_consent_nonce is null then
    raise exception 'Community review has no current author consent';
  end if;
  if p_decision='approve' and item.report_count>=3 then
    raise exception 'A reported Community post cannot be approved for publication';
  end if;
  perform set_config('wayfinder.community_review_function','on',true);
  update public.recommendations r set
      moderation_status=case when p_decision='approve' then 'approved' else 'rejected' end,
      hidden=case when p_decision='approve' then false else true end,
      moderation_reason=case when p_decision='reject' then clean_reason else null end
    where r.id=p_recommendation_id and r.moderation_revision=p_expected_revision;
  perform set_config('wayfinder.community_review_function','off',true);
  insert into public.community_review_decisions(
    recommendation_id,moderation_revision,decision,reviewer_label,reason)
    values(p_recommendation_id,p_expected_revision,p_decision,current_user,clean_reason);
  return case when p_decision='approve' then 'approved' else 'rejected' end;
end;
$$;
revoke all on function public.review_community_recommendation(uuid,bigint,text,text)
  from public,anon,authenticated,service_role;

-- Re-run leaves existing queue, rate counters and decisions intact. No
-- production mail sender, Gmail access, AI classifier or photo pipeline is
-- created by this migration.
commit;
