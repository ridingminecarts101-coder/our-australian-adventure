-- Wayfinder device-local photo boundary.
-- Apply only after schema-personal-ownership.sql and
-- schema-community-hardening.sql. Prepared locally; not yet deployed.
--
-- Authenticated clients retain read/delete access to legacy cloud photos and
-- memory objects, but cannot create or modify either. SECURITY DEFINER/admin
-- operations remain a separate privileged boundary.
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

  -- Storage privileges are table-wide and may support unrelated buckets. Do
  -- not revoke them or drop an unknown policy. Stop so that policy can be
  -- reviewed and explicitly allowlisted instead.
  for p in
    select policyname, cmd from pg_policies
     where schemaname = 'storage' and tablename = 'objects'
       and permissive = 'PERMISSIVE'
       and cmd in ('ALL', 'INSERT', 'UPDATE')
       and roles && array['public', 'anon', 'authenticated']::name[]
       and policyname not in ('upload owned memory files', 'move owned memory files')
  loop
    raise exception 'Unreviewed permissive storage.objects write policy: % (%)', p.policyname, p.cmd;
  end loop;

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

drop policy if exists "upload owned memory files" on storage.objects;
drop policy if exists "move owned memory files" on storage.objects;

-- Restrictive policies compose with every current or future permissive policy.
-- They block only the memories bucket and leave other buckets to their own
-- grants and permissive policies.
drop policy if exists "device local photos block memory inserts" on storage.objects;
create policy "device local photos block memory inserts" on storage.objects
as restrictive for insert to public
with check (bucket_id <> 'memories');

drop policy if exists "device local photos block memory updates" on storage.objects;
create policy "device local photos block memory updates" on storage.objects
as restrictive for update to public
using (bucket_id <> 'memories')
with check (bucket_id <> 'memories');

commit;
