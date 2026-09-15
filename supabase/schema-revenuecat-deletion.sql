-- Wayfinder RevenueCat customer-erasure queue
-- Apply only after schema-personal-ownership.sql. This migration changes no
-- purchase entitlement: it makes provider erasure durable before Auth removal.

begin;

create table public.revenuecat_deletion_jobs (
  id uuid primary key default gen_random_uuid(),
  app_user_id uuid,
  state text not null default 'pending'
    check (state in ('pending', 'processing', 'retry', 'accepted', 'absent')),
  attempt_count integer not null default 0 check (attempt_count >= 0),
  next_attempt_at timestamptz,
  lease_until timestamptz,
  claim_token uuid,
  last_http_status integer check (last_http_status between 100 and 599),
  last_error_code text check (last_error_code is null or last_error_code ~ '^[a-z0-9_]{1,64}$'),
  provider_result text check (provider_result is null or provider_result in ('deletion_queued', 'already_absent')),
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now(),
  provider_acknowledged_at timestamptz,
  check ((state in ('accepted', 'absent')) = (app_user_id is null)),
  check ((state = 'processing') = (claim_token is not null and lease_until is not null)),
  check ((state in ('accepted', 'absent')) = (provider_acknowledged_at is not null)),
  check (
    (state = 'accepted' and provider_result = 'deletion_queued')
    or (state = 'absent' and provider_result = 'already_absent')
    or (state not in ('accepted', 'absent') and provider_result is null)
  )
);

create unique index revenuecat_deletion_pending_subject
  on public.revenuecat_deletion_jobs (app_user_id)
  where app_user_id is not null;
create index revenuecat_deletion_ready
  on public.revenuecat_deletion_jobs (next_attempt_at, created_at)
  where state in ('pending', 'retry', 'processing');

alter table public.revenuecat_deletion_jobs enable row level security;
alter table public.revenuecat_deletion_jobs force row level security;
revoke all on table public.revenuecat_deletion_jobs from public, anon, authenticated;

-- Claim a small batch with a lease. SKIP LOCKED permits two scheduled workers
-- without delivering the same customer concurrently. One token may cover the
-- batch; job id + token together identify each acknowledgement.
create or replace function public.claim_revenuecat_deletions(
  p_limit integer default 10,
  p_lease_seconds integer default 300
)
returns table (
  job_id uuid,
  app_user_id uuid,
  claim_token uuid,
  attempt_count integer
)
language plpgsql
security definer
set search_path = pg_catalog, public
as $$
declare
  token uuid := gen_random_uuid();
  batch_size integer := least(greatest(coalesce(p_limit, 10), 1), 25);
  lease_seconds integer := least(greatest(coalesce(p_lease_seconds, 300), 60), 900);
begin
  return query
  with ready as (
    select j.id
      from public.revenuecat_deletion_jobs j
     where (j.state in ('pending', 'retry') and coalesce(j.next_attempt_at, j.created_at) <= now())
        or (j.state = 'processing' and j.lease_until <= now())
     order by coalesce(j.next_attempt_at, j.created_at), j.created_at
     for update skip locked
     limit batch_size
  )
  update public.revenuecat_deletion_jobs j
     set state = 'processing',
         attempt_count = j.attempt_count + 1,
         claim_token = token,
         lease_until = now() + make_interval(secs => lease_seconds),
         updated_at = now()
    from ready
   where j.id = ready.id
  returning j.id, j.app_user_id, j.claim_token, j.attempt_count;
end;
$$;

create or replace function public.acknowledge_revenuecat_deletion(
  p_job_id uuid,
  p_claim_token uuid,
  p_http_status integer
)
returns void
language plpgsql
security definer
set search_path = pg_catalog, public
as $$
begin
  if p_http_status not in (200, 404) then
    raise exception 'invalid provider acknowledgement status';
  end if;

  update public.revenuecat_deletion_jobs
     set state = case p_http_status when 200 then 'accepted' else 'absent' end,
         app_user_id = null,
         claim_token = null,
         lease_until = null,
         next_attempt_at = null,
         last_http_status = p_http_status,
         last_error_code = null,
         provider_result = case p_http_status when 200 then 'deletion_queued' else 'already_absent' end,
         provider_acknowledged_at = now(),
         updated_at = now()
   where id = p_job_id
     and state = 'processing'
     and claim_token = p_claim_token;
  if not found then raise exception 'stale or unknown deletion claim'; end if;
end;
$$;

create or replace function public.retry_revenuecat_deletion(
  p_job_id uuid,
  p_claim_token uuid,
  p_error_code text,
  p_http_status integer default null,
  p_retry_seconds integer default 300
)
returns void
language plpgsql
security definer
set search_path = pg_catalog, public
as $$
declare
  safe_delay integer := least(greatest(coalesce(p_retry_seconds, 300), 60), 86400);
begin
  if p_error_code is null or p_error_code !~ '^[a-z0-9_]{1,64}$' then
    raise exception 'invalid deletion error code';
  end if;
  if p_http_status is not null and (p_http_status < 100 or p_http_status > 599) then
    raise exception 'invalid HTTP status';
  end if;

  update public.revenuecat_deletion_jobs
     set state = 'retry',
         claim_token = null,
         lease_until = null,
         next_attempt_at = now() + make_interval(secs => safe_delay),
         last_http_status = p_http_status,
         last_error_code = p_error_code,
         updated_at = now()
   where id = p_job_id
     and state = 'processing'
     and claim_token = p_claim_token;
  if not found then raise exception 'stale or unknown deletion claim'; end if;
end;
$$;

-- Replace the existing RPC without changing its client contract. Queue insert
-- and Auth deletion are one transaction: either both commit or neither does.
create or replace function public.delete_my_account()
returns void
language plpgsql
security definer
set search_path = pg_catalog, public
as $$
declare caller uuid := auth.uid();
begin
  if caller is null then raise exception 'not signed in'; end if;
  if exists (
    select 1
      from storage.objects o
     where o.bucket_id = 'memories'
       and (
         (storage.foldername(o.name))[1] = caller::text
         or exists (
           select 1 from public.photos p
            where p.user_id = caller and p.storage_path = o.name
         )
       )
  ) then
    raise exception 'owned Storage objects must be removed before account deletion';
  end if;

  insert into public.revenuecat_deletion_jobs (app_user_id, state, next_attempt_at)
  values (caller, 'pending', now())
  on conflict (app_user_id) where app_user_id is not null do nothing;

  delete from auth.users where id = caller;
  if not found then raise exception 'account no longer exists'; end if;
end;
$$;

revoke all on function public.claim_revenuecat_deletions(integer, integer) from public, anon, authenticated;
revoke all on function public.acknowledge_revenuecat_deletion(uuid, uuid, integer) from public, anon, authenticated;
revoke all on function public.retry_revenuecat_deletion(uuid, uuid, text, integer, integer) from public, anon, authenticated;
grant execute on function public.claim_revenuecat_deletions(integer, integer) to service_role;
grant execute on function public.acknowledge_revenuecat_deletion(uuid, uuid, integer) to service_role;
grant execute on function public.retry_revenuecat_deletion(uuid, uuid, text, integer, integer) to service_role;

revoke all on function public.delete_my_account() from public, anon;
grant execute on function public.delete_my_account() to authenticated;

comment on table public.revenuecat_deletion_jobs is
  'Server-only provider-erasure queue. app_user_id is nulled after RevenueCat queues deletion or reports it absent; accepted does not claim synchronous erasure.';

commit;
