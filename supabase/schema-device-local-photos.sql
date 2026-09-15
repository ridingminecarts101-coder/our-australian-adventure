-- Wayfinder device-local photo boundary.
-- Apply only after schema-personal-ownership.sql and
-- schema-community-hardening.sql. Prepared locally; not yet deployed.
--
-- Authenticated clients retain owned metadata access while all direct access
-- to historical cloud objects is disabled through the managed Storage-policy
-- prerequisite below. SECURITY DEFINER/admin operations remain a separate
-- privileged boundary for owner-authorised removal of those originals.
begin;

do $preflight$
declare p record;
begin
  if to_regclass('public.photos') is null or to_regclass('storage.objects') is null then
    raise exception 'device-local photo migration prerequisites are missing';
  end if;

  for p in
    select policyname, cmd from pg_policies
     where schemaname = 'public' and tablename = 'photos'
       and permissive = 'PERMISSIVE'
       and cmd in ('ALL', 'INSERT', 'UPDATE')
       and roles && array['public', 'anon', 'authenticated']::name[]
       and policyname not in ('insert owned photos', 'update owned photos')
  loop
    raise exception 'Unreviewed permissive public.photos write policy: % (%)', p.policyname, p.cmd;
  end loop;

  if not exists (
    select 1 from pg_class c
     where c.oid = 'storage.objects'::regclass and c.relrowsecurity
  ) then
    raise exception 'storage.objects RLS must remain enabled';
  end if;
  if (select count(*) from pg_policies
       where schemaname = 'storage' and tablename = 'objects'
         and roles && array['public', 'anon', 'authenticated']::name[]) <> 2
     or not exists (
       select 1 from pg_policies where schemaname = 'storage' and tablename = 'objects'
         and policyname = 'read owned or projected memory files' and cmd = 'SELECT'
         and permissive = 'PERMISSIVE' and roles = array['authenticated']::name[]
         and coalesce(qual, '') like '%can_read_memory_object%'
     )
     or not exists (
       select 1 from pg_policies where schemaname = 'storage' and tablename = 'objects'
         and policyname = 'delete owned memory files' and cmd = 'DELETE'
         and permissive = 'PERMISSIVE' and roles = array['authenticated']::name[]
         and coalesce(qual, '') like '%can_manage_memory_object%'
     )
     or exists (
       select 1 from pg_policies where schemaname = 'storage' and tablename = 'objects'
         and cmd in ('ALL', 'INSERT', 'UPDATE')
         and roles && array['public', 'anon', 'authenticated']::name[]
     ) then
    raise exception 'reviewed final storage.objects policies must be installed in Storage > Policies first';
  end if;

  -- Fail closed if an authenticated SECURITY DEFINER RPC could recreate the
  -- client write path after direct privileges are removed. Dynamic SQL and
  -- externally managed functions still require production review.
  for p in
    select n.nspname, x.proname
      from pg_proc x join pg_namespace n on n.oid = x.pronamespace
     where n.nspname in ('public', 'storage') and x.prosecdef
       and has_function_privilege('authenticated', x.oid, 'EXECUTE')
       and (
         lower(x.prosrc) ~ '(insert[[:space:]]+into|update[[:space:]]+)(public[.])?photos'
         or lower(x.prosrc) ~ '(insert[[:space:]]+into|update[[:space:]]+)(storage[.])?objects'
       )
  loop
    raise exception 'Authenticated photo-writing SECURITY DEFINER function requires review: %.%', p.nspname, p.proname;
  end loop;
end
$preflight$;

drop policy if exists "insert owned photos" on public.photos;
drop policy if exists "update owned photos" on public.photos;
revoke insert, update on public.photos from public, anon, authenticated;

-- No storage.objects DDL is attempted here. Its managed owner is intentionally
-- preserved. With RLS enabled and no client-applicable INSERT, UPDATE or ALL
-- policy, PostgreSQL denies new memory writes by default. The two ownership
-- policies preserve temporary read/delete of historical objects.

commit;
