// Executes the ownership migration in an in-memory PostgreSQL engine.
// No network, Supabase project, store account, or persisted user is involved.
import { PGlite } from '@electric-sql/pglite';
import { readFile } from 'node:fs/promises';

const db = new PGlite();
const alice = '11111111-1111-4111-8111-111111111111';
const bob = '22222222-2222-4222-8222-222222222222';
const outsider = '33333333-3333-4333-8333-333333333333';

const fixture = `
create role anon nologin;
create role authenticated nologin;
create schema auth;
create schema storage;
create table auth.users (id uuid primary key);
create function auth.uid() returns uuid language sql stable as $$
  select nullif(current_setting('request.jwt.claim.sub', true), '')::uuid
$$;
create function storage.foldername(text) returns text[] language sql immutable as $$
  select regexp_split_to_array($1, '/')
$$;

create table public.groups (
  id uuid primary key default gen_random_uuid(), name text not null,
  join_code text not null unique, created_by uuid references auth.users(id) on delete set null
);
create table public.group_members (
  group_id uuid references public.groups(id) on delete cascade,
  user_id uuid references auth.users(id) on delete cascade,
  display_name text, primary key (group_id, user_id)
);
create table public.progress (
  id uuid primary key default gen_random_uuid(), adventure_id integer not null,
  user_id uuid references auth.users(id) on delete cascade,
  group_id uuid references public.groups(id) on delete set null,
  completed boolean not null default false, completed_at timestamptz,
  completed_by_id uuid references auth.users(id) on delete set null,
  completed_by text, shortlisted boolean default false, rating integer,
  memory text, updated_by text, updated_at timestamptz default now(),
  scope_id uuid generated always as (coalesce(group_id, user_id)) stored,
  unique (adventure_id, scope_id)
);
create table public.photos (
  id uuid primary key default gen_random_uuid(), adventure_id integer,
  storage_path text not null, user_id uuid references auth.users(id) on delete cascade,
  group_id uuid references public.groups(id) on delete set null,
  scope_id uuid generated always as (coalesce(group_id, user_id)) stored
);
create table public.trips (
  id uuid primary key default gen_random_uuid(), user_id uuid references auth.users(id) on delete cascade,
  group_id uuid references public.groups(id) on delete set null,
  scope_id uuid generated always as (coalesce(group_id, user_id)) stored
);
alter table public.progress enable row level security;
alter table public.photos enable row level security;
alter table public.trips enable row level security;
create table storage.objects (id uuid primary key default gen_random_uuid(), bucket_id text, name text);
alter table storage.objects enable row level security;
create publication supabase_realtime;
grant usage on schema public, auth, storage to authenticated;
grant select, insert, update, delete on all tables in schema public to authenticated;
grant select, insert, update, delete on storage.objects to authenticated;
`;

await db.exec(fixture);
await db.query('insert into auth.users(id) values ($1),($2),($3)', [alice, bob, outsider]);
const migration = await readFile(new URL('../supabase/schema-personal-ownership.sql', import.meta.url), 'utf8');
await db.exec(migration);

async function asUser(id, sql, params = []) {
  await db.exec(`set role authenticated; set "request.jwt.claim.sub" = '${id}'`);
  try { return await db.query(sql, params); }
  finally { await db.exec('reset role; reset "request.jwt.claim.sub"'); }
}

async function rejected(label, fn) {
  try { await fn(); }
  catch { pass(label); return; }
  throw new Error(`FAIL: ${label}`);
}

let passed = 0;
function pass(label) { passed++; console.log(`PASS ${passed}: ${label}`); }
function equal(label, actual, expected) {
  if (actual !== expected) throw new Error(`FAIL: ${label}: got ${actual}, expected ${expected}`);
  pass(label);
}

const made = await asUser(alice, `select * from public.create_group('Test travellers','Alice')`);
const groupId = made.rows[0].group_id;
const code = made.rows[0].join_code;
equal('new group begins with private completion sharing',
  (await asUser(alice, 'select share_completions from public.group_members')).rows[0].share_completions, false);
equal('outsider cannot discover groups',
  (await asUser(outsider, 'select count(*)::int as n from public.groups')).rows[0].n, 0);
await rejected('outsider cannot self-enrol without invite RPC', () =>
  asUser(outsider, 'insert into public.group_members values ($1,$2,$3,false)', [groupId, outsider, 'Spy']));
await rejected('wrong invite code is rejected', () =>
  asUser(bob, `select * from public.join_group_by_code('WRONG','Bob')`));
await asUser(bob, 'select * from public.join_group_by_code($1,$2)', [code, 'Bob']);
pass('valid invite joins only the caller');
await asUser(bob, `update public.group_members set display_name='Bob renamed'
  where group_id=$1 and user_id=$2`, [groupId, bob]);
equal('member can still rename their own display name',
  (await asUser(bob, 'select display_name from public.group_members where group_id=$1 and user_id=$2',
    [groupId, bob])).rows[0].display_name, 'Bob renamed');
await rejected('direct display-name edits obey the server length bound', () =>
  asUser(bob, 'update public.group_members set display_name=$1 where group_id=$2 and user_id=$3',
    ['x'.repeat(81), groupId, bob]));
await rejected('direct membership update cannot bypass completion consent RPC', () =>
  asUser(bob, `update public.group_members set share_completions=true
    where group_id=$1 and user_id=$2`, [groupId, bob]));

await asUser(bob, `insert into public.progress
  (adventure_id,user_id,completed,completed_at,completed_by,memory,rating,shortlisted)
  values (42,$1,true,now(),'forged','private note',5,true)`, [bob]);
equal('completion attribution is forced to owner',
  (await asUser(bob, 'select completed_by_id from public.progress where adventure_id=42')).rows[0].completed_by_id, bob);
equal('group member cannot select another owner private progress row',
  (await asUser(alice, 'select count(*)::int as n from public.progress where adventure_id=42')).rows[0].n, 0);
equal('private-by-default join exposes no completion',
  (await asUser(alice, 'select count(*)::int as n from public.group_completion_feed($1)', [groupId])).rows[0].n, 0);

await asUser(alice, `insert into public.photos (adventure_id,storage_path,user_id)
  values (42,$1,$2)`, [`${alice}/42/alice.jpg`, alice]);
await rejected('photo metadata cannot alias another owner Storage path', () =>
  asUser(bob, `insert into public.photos (adventure_id,storage_path,user_id)
    values (42,$1,$2)`, [`${alice}/42/alice.jpg`, bob]));
await asUser(bob, `insert into public.photos (adventure_id,storage_path,user_id)
  values (42,$1,$2)`, [`${bob}/42/bob.jpg`, bob]);
await rejected('photo owner cannot retarget metadata to another owner path', () =>
  asUser(bob, 'update public.photos set storage_path=$1 where user_id=$2',
    [`${alice}/42/alice.jpg`, bob]));
pass('owned photo metadata accepts only the caller Storage prefix');
await db.query(`insert into public.photos (adventure_id,storage_path,user_id)
  values (43,'43/legacy.jpg',$1)`, [alice]);
await db.query(`insert into storage.objects(bucket_id,name)
  values ('memories','43/legacy.jpg')`);
equal('another account cannot read an owned legacy object',
  (await asUser(bob, `select count(*)::int as n from storage.objects
    where name='43/legacy.jpg'`)).rows[0].n, 0);
equal('the metadata owner also has no direct cloud-object read path',
  (await asUser(alice, `select count(*)::int as n from storage.objects
    where name='43/legacy.jpg'`)).rows[0].n, 0);
equal('the metadata owner cannot move a historical cloud object',
  (await asUser(alice, `update storage.objects set name=$1 where name='43/legacy.jpg' returning id`,
    [`${alice}/43/legacy.jpg`])).rows.length, 0);
await db.query(`update storage.objects set name=$1 where name='43/legacy.jpg'`,
  [`${alice}/43/legacy.jpg`]);
await asUser(alice, `update public.photos set storage_path=$1 where storage_path='43/legacy.jpg'`,
  [`${alice}/43/legacy.jpg`]);
pass('administrative fixture cleanup can preserve metadata linkage without restoring client Storage access');

await asUser(bob, 'select public.set_group_completion_sharing($1,true)', [groupId]);
const feed = await asUser(alice, 'select * from public.group_completion_feed($1)', [groupId]);
equal('explicit consent exposes the completion', feed.rows.length, 1);
equal('completion feed exposes the expected adventure', feed.rows[0].adventure_id, 42);
equal('completion feed schema excludes memory', Object.hasOwn(feed.rows[0], 'memory'), false);
equal('completion feed schema excludes rating', Object.hasOwn(feed.rows[0], 'rating'), false);
equal('completion feed schema excludes shortlist', Object.hasOwn(feed.rows[0], 'shortlisted'), false);

await asUser(bob, 'select public.set_group_completion_sharing($1,false)', [groupId]);
equal('revocation removes the projection',
  (await asUser(alice, 'select count(*)::int as n from public.group_completion_feed($1)', [groupId])).rows[0].n, 0);
await rejected('stale device cannot re-share after server-side revocation', () =>
  asUser(bob, 'select public.share_personal_progress($1,null)', [groupId]));
const bobProgressId = (await asUser(bob,
  'select id from public.progress where adventure_id=42')).rows[0].id;
await rejected('stale device cannot insert a projection after revocation', () =>
  asUser(bob, 'insert into public.group_progress values ($1,$2,$3)',
    [groupId, bobProgressId, bob]));

await asUser(bob, 'select public.set_group_completion_sharing($1,true)', [groupId]);
await asUser(bob, 'update public.progress set completed=false where adventure_id=42');
equal('unticking removes future group visibility',
  (await asUser(alice, 'select count(*)::int as n from public.group_completion_feed($1)', [groupId])).rows[0].n, 0);
await asUser(bob, 'update public.progress set completed=true where adventure_id=42');
equal('future completion is projected by persisted consent',
  (await asUser(alice, 'select count(*)::int as n from public.group_completion_feed($1)', [groupId])).rows[0].n, 1);

await asUser(bob, 'select public.leave_group($1)', [groupId]);
equal('leaving removes membership',
  (await asUser(bob, 'select count(*)::int as n from public.group_members')).rows[0].n, 0);
equal('leaving preserves personal progress',
  (await asUser(bob, 'select count(*)::int as n from public.progress where adventure_id=42')).rows[0].n, 1);
equal('leaving removes group visibility',
  (await asUser(alice, 'select count(*)::int as n from public.group_completion_feed($1)', [groupId])).rows[0].n, 0);

await asUser(bob, 'select * from public.join_group_by_code($1,$2)', [code, 'Bob again']);
equal('rejoining starts with sharing disabled again',
  (await asUser(bob, 'select share_completions from public.group_members where group_id=$1 and user_id=$2',
    [groupId,bob])).rows[0].share_completions, false);
equal('rejoining does not silently share earlier personal completions',
  (await asUser(alice, 'select count(*)::int as n from public.group_completion_feed($1)', [groupId])).rows[0].n, 0);
await asUser(bob, 'select public.leave_group($1)', [groupId]);

await db.query(`insert into storage.objects(bucket_id,name) values ('memories',$1)`, [`${bob}/42/bob.jpg`]);
await rejected('account deletion stops while an owned Storage object remains', () =>
  asUser(bob, 'select public.delete_my_account()'));
equal('blocked account deletion preserves the auth identity',
  (await db.query('select count(*)::int as n from auth.users where id=$1', [bob])).rows[0].n, 1);
await db.query('delete from storage.objects where name=$1', [`${bob}/42/bob.jpg`]);
await asUser(bob, 'select public.delete_my_account()');
equal('account deletion cascades personal progress',
  (await db.query('select count(*)::int as n from public.progress where user_id=$1', [bob])).rows[0].n, 0);
equal('account deletion removes the auth identity',
  (await db.query('select count(*)::int as n from auth.users where id=$1', [bob])).rows[0].n, 0);

// Re-running after consent changes must not replay legacy projection backfill.
await asUser(alice, `insert into public.progress
  (adventure_id,user_id,group_id,completed,completed_at)
  values (99,$1,$2,true,now())`, [alice, groupId]);
await db.exec(migration);
equal('migration replay does not recreate revoked/left projections',
  (await db.query('select count(*)::int as n from public.group_progress')).rows[0].n, 0);

await asUser(outsider, 'select * from public.join_group_by_code($1,$2)', [code,'Remaining member']);
await asUser(outsider, `insert into public.progress (adventure_id,user_id,completed,completed_at)
  values (77,$1,true,now())`, [outsider]);
await asUser(outsider, 'select public.set_group_completion_sharing($1,true)', [groupId]);
await db.query('delete from storage.objects where name=$1', [`${alice}/43/legacy.jpg`]);
await asUser(alice, 'select public.delete_my_account()');
equal('deleting the group creator preserves the group for remaining members',
  (await asUser(outsider, 'select count(*)::int as n from public.groups where id=$1', [groupId])).rows[0].n, 1);
equal('deleted creator attribution is cleared using the real schema foreign key',
  (await db.query('select created_by from public.groups where id=$1', [groupId])).rows[0].created_by, null);
equal('creator deletion preserves another member personal completion',
  (await asUser(outsider, 'select count(*)::int as n from public.progress where adventure_id=77')).rows[0].n, 1);
equal('remaining member completion stays available in the group',
  (await asUser(outsider, 'select count(*)::int as n from public.group_completion_feed($1)', [groupId])).rows[0].n, 1);

console.log(`\n${passed} PostgreSQL ownership/RLS/RPC checks passed.`);
await db.close();
