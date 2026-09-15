import { strict as assert } from 'node:assert';
import { readFile } from 'node:fs/promises';
import { PGlite } from '@electric-sql/pglite';

const db = new PGlite();
const alice = '11111111-1111-4111-8111-111111111111';
const bob = '22222222-2222-4222-8222-222222222222';
const blocked = '33333333-3333-4333-8333-333333333333';

await db.exec(`
  create role anon nologin;
  create role authenticated nologin;
  create role service_role nologin bypassrls;
  create schema auth;
  create schema storage;
  create table auth.users (id uuid primary key);
  create function auth.uid() returns uuid language sql stable as $$
    select nullif(current_setting('request.jwt.claim.sub', true), '')::uuid
  $$;
  create function storage.foldername(text) returns text[] language sql immutable as $$
    select regexp_split_to_array($1, '/')
  $$;
  create table storage.objects (id uuid primary key default gen_random_uuid(), bucket_id text, name text);
  create table public.photos (
    id uuid primary key default gen_random_uuid(), user_id uuid references auth.users(id) on delete cascade,
    storage_path text not null
  );
  create table public.progress (
    id uuid primary key default gen_random_uuid(), user_id uuid references auth.users(id) on delete cascade
  );
  grant usage on schema public, auth, storage to authenticated, service_role;
  grant select, delete on storage.objects to authenticated;
  insert into auth.users(id) values ('${alice}'),('${bob}'),('${blocked}');
  insert into public.progress(user_id) values ('${alice}'),('${bob}');
`);

const migration = await readFile(new URL('../supabase/schema-revenuecat-deletion.sql', import.meta.url), 'utf8');
await db.exec(migration);

const deleteFunctionConfig = (await db.query(`
  select proconfig
    from pg_proc p
    join pg_namespace n on n.oid = p.pronamespace
   where n.nspname = 'public' and p.proname = 'delete_my_account'
`)).rows[0].proconfig;
assert.deepEqual(deleteFunctionConfig, ['search_path=pg_catalog, public']);
console.log('PASS: account deletion function uses a minimal pinned search path');

async function asRole(role, sql, params = [], subject = '') {
  await db.exec(`set role ${role}; set "request.jwt.claim.sub" = '${subject}'`);
  try { return await db.query(sql, params); }
  finally { await db.exec('reset role; reset "request.jwt.claim.sub"'); }
}

async function rejects(label, fn) {
  await assert.rejects(fn, undefined, label);
  console.log(`PASS: ${label}`);
}

await rejects('authenticated clients cannot inspect the deletion queue', () =>
  asRole('authenticated', 'select * from public.revenuecat_deletion_jobs', [], alice));
await rejects('anonymous clients cannot inspect the deletion queue', () =>
  asRole('anon', 'select * from public.revenuecat_deletion_jobs'));
await rejects('authenticated clients cannot claim jobs', () =>
  asRole('authenticated', 'select * from public.claim_revenuecat_deletions()', [], alice));

await db.query(`insert into storage.objects(bucket_id,name) values ('memories',$1)`, [`${alice}/7/legacy.jpg`]);
await rejects('owned Storage prevents both account deletion and queue insertion', () =>
  asRole('authenticated', 'select public.delete_my_account()', [], alice));
assert.equal((await db.query('select count(*)::int n from auth.users where id=$1', [alice])).rows[0].n, 1);
assert.equal((await db.query('select count(*)::int n from public.revenuecat_deletion_jobs')).rows[0].n, 0);
await db.query('delete from storage.objects where name=$1', [`${alice}/7/legacy.jpg`]);

await asRole('authenticated', 'select public.delete_my_account()', [], alice);
assert.equal((await db.query('select count(*)::int n from auth.users where id=$1', [alice])).rows[0].n, 0);
assert.equal((await db.query('select count(*)::int n from public.progress where user_id=$1', [alice])).rows[0].n, 0);
let jobs = await db.query('select * from public.revenuecat_deletion_jobs');
assert.equal(jobs.rows.length, 1);
assert.equal(jobs.rows[0].app_user_id, alice);
console.log('PASS: Auth deletion commits with one durable provider intent and cascades personal rows');

// A database failure after queue insertion must roll the whole function back.
await db.exec(`
  create function auth.reject_selected_delete() returns trigger language plpgsql as $$
  begin
    if old.id = '${blocked}' then raise exception 'fixture deletion failure'; end if;
    return old;
  end $$;
  create trigger reject_selected_delete before delete on auth.users
    for each row execute function auth.reject_selected_delete();
`);
await rejects('failed Auth removal cannot leave a false provider intent', () =>
  asRole('authenticated', 'select public.delete_my_account()', [], blocked));
assert.equal((await db.query('select count(*)::int n from auth.users where id=$1', [blocked])).rows[0].n, 1);
assert.equal((await db.query('select count(*)::int n from public.revenuecat_deletion_jobs where app_user_id=$1', [blocked])).rows[0].n, 0);

const first = await asRole('service_role', 'select * from public.claim_revenuecat_deletions(1,60)');
assert.equal(first.rows.length, 1);
assert.equal(first.rows[0].app_user_id, alice);
assert.equal(first.rows[0].attempt_count, 1);
const firstToken = first.rows[0].claim_token;
const jobId = first.rows[0].job_id;
assert.equal((await asRole('service_role', 'select count(*)::int n from public.claim_revenuecat_deletions(1,60)')).rows[0].n, 0);
console.log('PASS: active leases prevent concurrent duplicate delivery');

await db.query(`update public.revenuecat_deletion_jobs set lease_until=now()-interval '1 second' where id=$1`, [jobId]);
const second = await asRole('service_role', 'select * from public.claim_revenuecat_deletions(1,60)');
assert.equal(second.rows.length, 1);
assert.notEqual(second.rows[0].claim_token, firstToken);
await rejects('an expired worker cannot complete another worker claim', () =>
  asRole('service_role', 'select public.acknowledge_revenuecat_deletion($1,$2,200)', [jobId, firstToken]));

await asRole('service_role',
  `select public.retry_revenuecat_deletion($1,$2,'provider_rate_limited',429,120)`,
  [jobId, second.rows[0].claim_token]);
assert.equal((await asRole('service_role', 'select count(*)::int n from public.claim_revenuecat_deletions(1,60)')).rows[0].n, 0);
await db.query(`update public.revenuecat_deletion_jobs set next_attempt_at=now()-interval '1 second' where id=$1`, [jobId]);
const third = (await asRole('service_role', 'select * from public.claim_revenuecat_deletions(1,60)')).rows[0];
assert.equal(third.attempt_count, 3);
await asRole('service_role', 'select public.acknowledge_revenuecat_deletion($1,$2,404)', [jobId, third.claim_token]);
jobs = await db.query('select * from public.revenuecat_deletion_jobs where id=$1', [jobId]);
assert.equal(jobs.rows[0].state, 'absent');
assert.equal(jobs.rows[0].app_user_id, null);
assert.equal(jobs.rows[0].last_http_status, 404);
assert.equal(jobs.rows[0].provider_result, 'already_absent');
assert(!JSON.stringify(jobs.rows[0]).includes(alice), 'acknowledgement evidence must not retain the account UUID');
console.log('PASS: retries are leased and provider absence removes the provider identity');

await rejects('acknowledged non-identifying evidence cannot be claimed again', async () => {
  const rows = (await asRole('service_role', 'select * from public.claim_revenuecat_deletions(1,60)')).rows;
  if (!rows.length) throw new Error('not claimable');
});

await asRole('authenticated', 'select public.delete_my_account()', [], bob);
const accepted = (await asRole('service_role', 'select * from public.claim_revenuecat_deletions(1,60)')).rows[0];
await asRole('service_role', 'select public.acknowledge_revenuecat_deletion($1,$2,200)',
  [accepted.job_id, accepted.claim_token]);
const acceptedRow = (await db.query('select * from public.revenuecat_deletion_jobs where id=$1', [accepted.job_id])).rows[0];
assert.equal(acceptedRow.state, 'accepted');
assert.equal(acceptedRow.provider_result, 'deletion_queued');
assert.equal(acceptedRow.app_user_id, null);
assert(!JSON.stringify(acceptedRow).includes(bob));
console.log('PASS: HTTP 200 records asynchronous provider acceptance without claiming synchronous erasure');

console.log('PASS: RevenueCat deletion migration atomicity, RLS, leases, retry and minimisation');
