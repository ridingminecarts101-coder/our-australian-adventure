// PostgreSQL-WASM check for group feedback consent, revocation and isolation.
// Runs entirely in memory; no Supabase project or customer data is touched.
import { PGlite } from '@electric-sql/pglite';
import { readFile } from 'node:fs/promises';

const db = new PGlite();
const alice = '11111111-1111-4111-8111-111111111111';
const bob = '22222222-2222-4222-8222-222222222222';
const charlie = '33333333-3333-4333-8333-333333333333';
const outsider = '44444444-4444-4444-8444-444444444444';

await db.exec(`
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
  name text not null default 'Trip',
  group_id uuid references public.groups(id) on delete set null,
  scope_id uuid generated always as (coalesce(group_id, user_id)) stored
);
alter table public.progress enable row level security;
alter table public.photos enable row level security;
alter table public.trips enable row level security;
create table storage.objects (id uuid primary key default gen_random_uuid(), bucket_id text, name text);
alter table storage.objects enable row level security;
create publication supabase_realtime;
alter publication supabase_realtime set (publish_generated_columns = stored);
alter publication supabase_realtime add table public.trips;
alter table public.trips replica identity full;
grant usage on schema public, auth, storage to authenticated;
grant select, insert, update, delete on all tables in schema public to authenticated;
grant select, insert, update, delete on storage.objects to authenticated;
insert into auth.users(id) values
 ('${alice}'),('${bob}'),('${charlie}'),('${outsider}');
`);

for (const name of [
  'schema-personal-ownership.sql',
  'schema-completion-dates.sql',
  'schema-group-administration.sql',
]) {
  await db.exec(await readFile(new URL(`../supabase/${name}`, import.meta.url), 'utf8'));
}
const migration = await readFile(new URL('../supabase/schema-group-feedback.sql', import.meta.url), 'utf8');

async function asUser(id, sql, params = []) {
  await db.exec(`set role authenticated; set "request.jwt.claim.sub" = '${id}'`);
  try { return await db.query(sql, params); }
  finally { await db.exec('reset role; reset "request.jwt.claim.sub"'); }
}
async function rejected(label, call) {
  try { await call(); }
  catch { pass(label); return; }
  throw new Error(`FAIL: ${label}`);
}
let passed = 0;
function pass(label) { console.log(`PASS ${++passed}: ${label}`); }
function equal(label, actual, expected) {
  if (actual !== expected) throw new Error(`FAIL: ${label}: ${actual} !== ${expected}`);
  pass(label);
}
async function feedback(who, groupId) {
  return (await asUser(who, 'select * from public.group_completion_feedback_feed($1)', [groupId])).rows;
}
async function refreshTime(groupId) {
  return (await db.query(`select refreshed_at from public.group_progress
    where group_id=$1 and shared_by_id=$2`, [groupId,bob])).rows[0].refreshed_at;
}

// Both groups existed, with completion sharing enabled, before the new feature.
const first = (await asUser(alice, `select * from public.create_group('First','Alice')`)).rows[0];
await asUser(bob, 'select * from public.join_group_by_code($1,$2)', [first.join_code,'Bob']);
const second = (await asUser(bob, `select * from public.create_group('Second','Bob')`)).rows[0];
await asUser(charlie, 'select * from public.join_group_by_code($1,$2)', [second.join_code,'Charlie']);
await asUser(bob, `insert into public.progress
  (adventure_id,user_id,completed,completed_at,rating,memory)
  values (42,$1,true,now(),4,'A private old note')`, [bob]);
await asUser(bob, 'select public.set_group_completion_sharing($1,true)', [first.group_id]);
await asUser(bob, 'select public.set_group_completion_sharing($1,true)', [second.group_id]);
await db.exec(migration);

equal('existing members begin without feedback consent',
  (await db.query('select count(*)::int n from public.group_members where share_feedback')).rows[0].n, 0);
equal('existing completion feed still excludes rating',
  Object.hasOwn((await asUser(alice,
    'select * from public.group_completion_feed($1)', [first.group_id])).rows[0], 'rating'), false);
equal('existing completion feed still excludes note',
  Object.hasOwn((await asUser(alice,
    'select * from public.group_completion_feed($1)', [first.group_id])).rows[0], 'memory'), false);
equal('old completion consent does not expose private feedback',
  (await feedback(alice, first.group_id)).length, 0);
await rejected('feedback cannot be enabled before completion sharing', () =>
  asUser(alice, 'select public.set_group_feedback_sharing($1,true)', [first.group_id]));
await rejected('outsider cannot set consent in another group', () =>
  asUser(outsider, 'select public.set_group_feedback_sharing($1,true)', [first.group_id]));
await rejected('member cannot edit consent column directly', () =>
  asUser(bob, 'update public.group_members set share_feedback=true where group_id=$1 and user_id=$2',
    [first.group_id,bob]));
await asUser(bob, `update public.group_members set display_name='Bob updated'
  where group_id=$1 and user_id=$2`, [first.group_id,bob]);
equal('existing display-name permission remains available',
  (await asUser(bob, `select display_name from public.group_members
    where group_id=$1 and user_id=$2`, [first.group_id,bob])).rows[0].display_name,
  'Bob updated');
await rejected('feedback RPC rejects a missing consent choice', () =>
  asUser(bob, 'select public.set_group_feedback_sharing($1,null)', [first.group_id]));
equal('anonymous role has no feedback RPC execute grant',
  (await db.query(`select has_function_privilege('anon',
    'public.group_completion_feedback_feed(uuid)', 'EXECUTE') allowed`)).rows[0].allowed, false);
equal('anonymous role cannot change feedback consent',
  (await db.query(`select has_function_privilege('anon',
    'public.set_group_feedback_sharing(uuid,boolean)', 'EXECUTE') allowed`)).rows[0].allowed, false);

await db.query(`update public.group_progress set refreshed_at='2000-01-01T00:00:00Z'
  where group_id=$1 and shared_by_id=$2`, [first.group_id,bob]);
await asUser(bob, 'select public.set_group_feedback_sharing($1,true)', [first.group_id]);
const firstFeedback = await feedback(alice, first.group_id);
equal('consented rating is visible to another current member', firstFeedback[0].rating, 4);
equal('consented note is visible to another current member', firstFeedback[0].memory, 'A private old note');
equal('feedback identifies its actual owner', firstFeedback[0].completed_by_id, bob);
equal('feedback feed has only its four specified fields',
  Object.keys(firstFeedback[0]).sort().join(','),
  'adventure_id,completed_by_id,memory,rating');
equal('consent touches the existing realtime projection',
  (await refreshTime(first.group_id)) > new Date('2000-01-01T00:00:00Z'), true);
equal('consent to one group leaves another group private',
  (await feedback(charlie, second.group_id)).length, 0);
equal('non-member cannot fetch another group feedback',
  (await feedback(outsider, first.group_id)).length, 0);
equal('non-member cannot directly read the private progress row',
  (await asUser(outsider, 'select count(*)::int n from public.progress where adventure_id=42')).rows[0].n, 0);
equal('group member cannot directly read the private progress row',
  (await asUser(alice, 'select count(*)::int n from public.progress where adventure_id=42')).rows[0].n, 0);
equal('group member cannot edit the owner note',
  (await asUser(alice, `update public.progress set memory='tampered'
    where adventure_id=42 returning id`)).rows.length, 0);

await db.query(`update public.group_progress set refreshed_at='2000-01-01T00:00:00Z'
  where group_id=$1 and shared_by_id=$2`, [first.group_id,bob]);
await db.query(`update public.group_progress set refreshed_at='2000-01-01T00:00:00Z'
  where group_id=$1 and shared_by_id=$2`, [second.group_id,bob]);
await asUser(bob, `update public.progress set rating=5,memory='A revised note'
  where adventure_id=42`);
equal('owner edit is reflected without copied feedback data',
  (await feedback(alice, first.group_id))[0].memory, 'A revised note');
equal('owner feedback edit touches the realtime projection',
  (await refreshTime(first.group_id)) > new Date('2000-01-01T00:00:00Z'), true);
equal('owner feedback edit leaves a non-consenting group quiet',
  (await refreshTime(second.group_id)).getTime(),
  new Date('2000-01-01T00:00:00Z').getTime());
equal('group projection contains no note or rating columns',
  (await db.query(`select count(*)::int n from information_schema.columns
    where table_schema='public' and table_name='group_progress'
      and column_name in ('rating','memory')`)).rows[0].n, 0);

await db.query(`update public.group_progress set refreshed_at='2000-01-01T00:00:00Z'
  where group_id=$1 and shared_by_id=$2`, [first.group_id,bob]);
await asUser(bob, 'select public.set_group_feedback_sharing($1,false)', [first.group_id]);
equal('revocation immediately removes feedback from the server feed',
  (await feedback(alice, first.group_id)).length, 0);
equal('revocation retains consented completion facts',
  (await asUser(alice, 'select count(*)::int n from public.group_completion_feed($1)',
    [first.group_id])).rows[0].n, 1);
equal('revocation touches the realtime projection',
  (await refreshTime(first.group_id)) > new Date('2000-01-01T00:00:00Z'), true);
await db.query(`update public.group_progress set refreshed_at='2000-01-01T00:00:00Z'
  where group_id=$1 and shared_by_id=$2`, [first.group_id,bob]);
await asUser(bob, `update public.progress set memory='Private again' where adventure_id=42`);
equal('a private note edit does not trigger a group refresh',
  (await refreshTime(first.group_id)).getTime(), new Date('2000-01-01T00:00:00Z').getTime());
equal('a private note edit stays private', (await feedback(alice, first.group_id)).length, 0);

await asUser(bob, 'select public.set_group_feedback_sharing($1,true)', [first.group_id]);
await db.exec(migration);
equal('migration replay preserves deliberate opt-in',
  (await feedback(alice, first.group_id))[0].memory, 'Private again');
await asUser(bob, 'select public.set_group_completion_sharing($1,false)', [first.group_id]);
equal('turning off completions also clears feedback consent',
  (await db.query(`select share_feedback from public.group_members
    where group_id=$1 and user_id=$2`, [first.group_id,bob])).rows[0].share_feedback, false);
equal('turning off completions removes feedback projection',
  (await feedback(alice, first.group_id)).length, 0);
await asUser(bob, 'select public.set_group_completion_sharing($1,true)', [first.group_id]);
equal('turning completions back on does not revive feedback consent',
  (await feedback(alice, first.group_id)).length, 0);
await db.exec(migration);
equal('migration replay does not revive revoked feedback consent',
  (await feedback(alice, first.group_id)).length, 0);

await asUser(bob, 'select public.set_group_feedback_sharing($1,true)', [first.group_id]);
await asUser(alice, 'select public.remove_group_member($1,$2)', [first.group_id,bob]);
equal('removing the contributor cuts off their feedback',
  (await feedback(alice, first.group_id)).length, 0);
equal('member removal retains the owner personal note',
  (await asUser(bob, 'select memory from public.progress where adventure_id=42')).rows[0].memory,
  'Private again');
equal('other group remains independent',
  (await asUser(charlie, 'select count(*)::int n from public.group_completion_feed($1)',
    [second.group_id])).rows[0].n, 1);
await asUser(bob, 'select public.set_group_feedback_sharing($1,true)', [second.group_id]);
equal('second group sees feedback only after its own opt-in',
  (await feedback(charlie, second.group_id))[0].rating, 5);
await asUser(bob, 'update public.progress set completed=false where adventure_id=42');
equal('unticking a shared experience removes its feedback',
  (await feedback(charlie, second.group_id)).length, 0);
await asUser(bob, 'update public.progress set completed=true where adventure_id=42');
equal('reticking restores feedback only while consent is current',
  (await feedback(charlie, second.group_id))[0].rating, 5);
// Pre-migration group records may truthfully attribute the completion to a
// person other than the personal row owner. Do not mislabel that owner's note.
await asUser(bob, `insert into public.progress
  (adventure_id,user_id,group_id,completed,completed_at,rating,memory)
  values (43,$1,$2,true,now(),3,'Bob personal history')`, [bob,second.group_id]);
await db.exec('alter table public.progress disable trigger progress_attribute_personal_completion');
await db.query('update public.progress set completed_by_id=$1 where adventure_id=43', [charlie]);
await db.exec('alter table public.progress enable trigger progress_attribute_personal_completion');
equal('historical non-owner completion attribution remains in completion feed',
  (await asUser(charlie, 'select completed_by_id from public.group_completion_feed($1) where adventure_id=43',
    [second.group_id])).rows[0].completed_by_id, charlie);
equal('owner note is not mislabelled as the historical completer note',
  (await feedback(charlie, second.group_id)).filter(row => row.adventure_id === 43).length, 0);
await asUser(charlie, 'select public.leave_group($1)', [second.group_id]);
equal('leaving immediately removes read access to the remaining feedback',
  (await feedback(charlie, second.group_id)).length, 0);
await asUser(charlie, 'select * from public.join_group_by_code($1,$2)', [second.join_code,'Charlie again']);
equal('rejoined member sees only currently consented feedback',
  (await feedback(charlie, second.group_id))[0].rating, 5);
await asUser(bob, 'select public.delete_my_account()');
equal('deleting the contributor account clears group feedback',
  (await feedback(charlie, second.group_id)).length, 0);

console.log(`\n${passed} group-feedback database checks passed.`);
await db.close();
