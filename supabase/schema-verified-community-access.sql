-- Wayfinder verified-account boundary for shared groups and Community writes.
--
-- Apply after schema-group-administration.sql. This migration is additive and
-- replay-safe. It does not remove anonymous users or their existing personal,
-- group, or Community rows. Anonymous legacy sessions retain read/delete and
-- account-conversion access, but cannot create/join groups or add/change public
-- Community material.
begin;

do $preflight$
begin
  if to_regclass('public.groups') is null
     or to_regclass('public.group_members') is null
     or to_regclass('public.recommendations') is null
     or to_regclass('public.recommendation_votes') is null
     or to_regclass('public.recommendation_reports') is null
     or to_regclass('public.blocked_authors') is null then
    raise exception 'verified Community access prerequisites are missing';
  end if;
  if not exists (select 1 from information_schema.columns
    where table_schema='auth' and table_name='users' and column_name='is_anonymous')
     or not exists (select 1 from information_schema.columns
    where table_schema='auth' and table_name='users' and column_name='email_confirmed_at')
     or not exists (select 1 from information_schema.columns
    where table_schema='auth' and table_name='users' and column_name='email') then
    raise exception 'Auth user verification columns are unavailable';
  end if;
end
$preflight$;

-- `authenticated` includes anonymous Auth users. Read the authoritative Auth
-- row rather than trusting auth.uid() alone or user-editable metadata. Requiring
-- both a permanent identity and confirmed email matches Wayfinder's supported
-- recoverable account type. The helper reveals only the caller's own boolean.
create or replace function public.has_verified_email_account()
returns boolean
language sql
stable
security definer
set search_path = pg_catalog, auth
as $$
  select exists (
    select 1
      from auth.users u
     where u.id = auth.uid()
       and u.is_anonymous is false
       and u.email_confirmed_at is not null
       and nullif(btrim(u.email), '') is not null
  )
$$;

revoke all on function public.has_verified_email_account() from public, anon, authenticated;
grant execute on function public.has_verified_email_account() to authenticated;

-- Security-definer group RPCs insert into these tables. Triggers cover both
-- those RPCs and any future client path without restricting an existing member
-- from reading, leaving, deleting their account, or cleaning up owned rows.
create or replace function public.require_verified_group_participant()
returns trigger
language plpgsql
set search_path = pg_catalog, public
as $$
begin
  if auth.uid() is not null and not public.has_verified_email_account() then
    raise exception using
      errcode = '42501',
      message = 'verify a recoverable email account before creating or joining a group';
  end if;
  return new;
end;
$$;

revoke all on function public.require_verified_group_participant() from public, anon, authenticated;

drop trigger if exists require_verified_group_creator on public.groups;
create trigger require_verified_group_creator
before insert on public.groups
for each row execute function public.require_verified_group_participant();

drop trigger if exists require_verified_group_member on public.group_members;
create trigger require_verified_group_member
before insert on public.group_members
for each row execute function public.require_verified_group_participant();

-- Existing permissive ownership policies remain responsible for row identity.
-- These restrictive policies add the permanent, confirmed-email requirement to
-- every Community insert/update path. Deletes remain available for cleanup.
drop policy if exists "verified accounts create recommendations" on public.recommendations;
create policy "verified accounts create recommendations" on public.recommendations
as restrictive for insert to authenticated
with check (public.has_verified_email_account());

drop policy if exists "verified accounts edit recommendations" on public.recommendations;
create policy "verified accounts edit recommendations" on public.recommendations
as restrictive for update to authenticated
using (public.has_verified_email_account())
with check (public.has_verified_email_account());

drop policy if exists "verified accounts cast votes" on public.recommendation_votes;
create policy "verified accounts cast votes" on public.recommendation_votes
as restrictive for insert to authenticated
with check (public.has_verified_email_account());

drop policy if exists "verified accounts change votes" on public.recommendation_votes;
create policy "verified accounts change votes" on public.recommendation_votes
as restrictive for update to authenticated
using (public.has_verified_email_account())
with check (public.has_verified_email_account());

drop policy if exists "verified accounts submit reports" on public.recommendation_reports;
create policy "verified accounts submit reports" on public.recommendation_reports
as restrictive for insert to authenticated
with check (public.has_verified_email_account());

drop policy if exists "verified accounts change reports" on public.recommendation_reports;
create policy "verified accounts change reports" on public.recommendation_reports
as restrictive for update to authenticated
using (public.has_verified_email_account())
with check (public.has_verified_email_account());

drop policy if exists "verified accounts block authors" on public.blocked_authors;
create policy "verified accounts block authors" on public.blocked_authors
as restrictive for insert to authenticated
with check (public.has_verified_email_account());

drop policy if exists "verified accounts change blocks" on public.blocked_authors;
create policy "verified accounts change blocks" on public.blocked_authors
as restrictive for update to authenticated
using (public.has_verified_email_account())
with check (public.has_verified_email_account());

commit;
