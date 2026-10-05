// Real PostgreSQL-WASM checks; no production service or customer data.
import assert from 'node:assert/strict';
import { readFile } from 'node:fs/promises';
import { PGlite } from '@electric-sql/pglite';

const db = new PGlite();
const alice = '11111111-1111-4111-8111-111111111111';
const bob = '22222222-2222-4222-8222-222222222222';
const charlie = '33333333-3333-4333-8333-333333333333';
const dave = '44444444-4444-4444-8444-444444444444';
const eve = '55555555-5555-4555-8555-555555555555';

await db.exec(`
create role anon nologin;
create role authenticated nologin;
create role service_role nologin;
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
create table storage.buckets (id text primary key, public boolean not null);
insert into storage.buckets(id,public) values ('memories',false);
create publication supabase_realtime;
alter publication supabase_realtime set (publish_generated_columns = stored);
alter publication supabase_realtime add table public.trips;
alter publication supabase_realtime add table public.photos;
alter table public.trips replica identity full;
grant usage on schema public, auth, storage to authenticated;
grant select, insert, update, delete on all tables in schema public to authenticated;
grant select, insert, update, delete on storage.objects to authenticated;
insert into auth.users(id) values ('${alice}'),('${bob}'),('${charlie}'),('${dave}'),('${eve}');
`);

async function migration(name) {
  await db.exec(await readFile(new URL(`../supabase/${name}`, import.meta.url), 'utf8'));
}
for (const name of [
  'schema-personal-ownership.sql', 'schema-completion-dates.sql',
  'schema-group-administration.sql',
]) await migration(name);
await db.exec(`
create policy "read owned or projected memory files" on storage.objects
  for select to authenticated
  using (bucket_id = 'memories' and public.can_read_memory_object(name));
create policy "delete owned memory files" on storage.objects
  for delete to authenticated
  using (bucket_id = 'memories' and public.can_manage_memory_object(name));
`);
await migration('schema-device-local-photos.sql');
await migration('schema-revenuecat-deletion.sql');
const accountDeletionBefore = (await db.query(
  "select pg_get_functiondef('public.delete_my_account()'::regprocedure) definition"
)).rows[0].definition;

async function asUser(id, sql, params = []) {
  await db.exec(`set role authenticated; set "request.jwt.claim.sub" = '${id}'`);
  try { return await db.query(sql, params); }
  finally { await db.exec('reset role; reset "request.jwt.claim.sub"'); }
}
async function row(id, sql, params = []) { return (await asUser(id, sql, params)).rows[0]; }
async function denied(promise) {
  await assert.rejects(promise);
}
async function groupFeed(who, group) {
  return (await asUser(who, 'select * from public.group_completion_feed($1)', [group])).rows;
}
async function feedback(who, group) {
  return (await asUser(who, 'select * from public.group_completion_feedback_feed($1)', [group])).rows;
}
async function flags(group, who) {
  return (await db.query(`select share_completions,share_feedback,sharing_choice_made_at
    from public.group_members where group_id=$1 and user_id=$2`, [group, who])).rows[0];
}

// A pre-existing member sharing only ticks has not consented to share notes.
const old = await row(alice, `select * from public.create_group('Old friends','Alice')`);
const oldLongCode = old.join_code;
await asUser(bob, 'select * from public.join_group_by_code($1,$2)', [oldLongCode, 'Bob']);
await asUser(bob, `insert into public.progress
  (adventure_id,user_id,completed,completed_at,rating,memory)
  values (42,$1,true,now(),5,'Shared only after a new choice')`, [bob]);
await asUser(bob, 'select public.set_group_completion_sharing($1,true)', [old.group_id]);
await migration('schema-group-feedback.sql');
assert.equal((await feedback(alice, old.group_id)).length, 0);

await migration('schema-group-join-choice.sql');
assert.equal((await db.query(
  "select pg_get_functiondef('public.delete_my_account()'::regprocedure) definition"
)).rows[0].definition, accountDeletionBefore);
const shortCode = (await db.query('select join_code from public.groups where id=$1', [old.group_id])).rows[0].join_code;
assert.match(shortCode, /^[0123456789ABCDEFGHJKMNPQRSTVWXYZ]{6}$/);
assert.notEqual(shortCode, oldLongCode);
assert.equal((await flags(old.group_id, bob)).share_completions, true);
assert.equal((await flags(old.group_id, bob)).share_feedback, false);
assert.equal((await flags(old.group_id, bob)).sharing_choice_made_at, null);
assert.equal((await feedback(alice, old.group_id)).length, 0);
console.log('PASS: existing consent stays unchanged; new short code is displayed');

// Previously sent long links still join through a hidden alias.
await asUser(charlie, 'select * from public.join_group_with_sharing($1,$2,$3)',
  [oldLongCode, 'Charlie', false]);
assert.deepEqual([(await flags(old.group_id, charlie)).share_completions,
  (await flags(old.group_id, charlie)).share_feedback], [false, false]);
assert.equal((await flags(old.group_id, charlie)).sharing_choice_made_at instanceof Date, true);
await denied(asUser(charlie, `update public.group_members set share_feedback=true
  where group_id=$1 and user_id=$2`, [old.group_id, charlie]));
console.log('PASS: old invite link joins privately and direct consent write is blocked');

const oldClientGroup = await row(charlie, `select * from public.create_group('Released app','Charlie')`);
assert.match(oldClientGroup.join_code, /^[0123456789ABCDEFGHJKMNPQRSTVWXYZ]{6}$/);
assert.equal((await flags(oldClientGroup.group_id, charlie)).sharing_choice_made_at, null);
await asUser(charlie, 'select public.set_group_completion_sharing($1,true)',
  [oldClientGroup.group_id]);
assert.equal((await flags(oldClientGroup.group_id, charlie)).share_feedback, false);
assert.equal((await flags(oldClientGroup.group_id, charlie)).sharing_choice_made_at, null);
console.log('PASS: released two-argument create and split consent still work');

// Legacy members answer once; a retry is safe, and a different answer requires
// the explicit rejoin path rather than a silent toggle.
await asUser(bob, 'select public.choose_group_sharing($1,$2)', [old.group_id, true]);
assert.deepEqual([(await flags(old.group_id, bob)).share_completions,
  (await flags(old.group_id, bob)).share_feedback], [true, true]);
assert.equal((await feedback(alice, old.group_id)).length, 0,
  'one group choice does not release an ambiguous old note');
const oldProgress = await row(bob, 'select id from public.progress where adventure_id=42');
await asUser(bob, 'select public.revalidate_personal_progress($1)', [oldProgress.id]);
assert.equal((await feedback(alice, old.group_id))[0].memory,
  'Shared only after a new choice');
await asUser(bob, 'select public.choose_group_sharing($1,$2)', [old.group_id, true]);
await denied(asUser(bob, 'select public.choose_group_sharing($1,$2)', [old.group_id, false]));
console.log('PASS: one legacy choice governs tick and written feedback together');

await asUser(bob, 'select * from public.join_group_with_sharing($1,$2,$3)',
  [shortCode, 'Bob', false]);
assert.deepEqual([(await flags(old.group_id, bob)).share_completions,
  (await flags(old.group_id, bob)).share_feedback], [false, false]);
assert.equal((await feedback(alice, old.group_id)).length, 0);
assert.equal((await groupFeed(alice, old.group_id)).filter(r => r.adventure_id === 42).length, 0);
await asUser(bob, 'select * from public.join_group_with_sharing($1,$2,$3)',
  [shortCode, 'Bob', true]);
assert.equal((await feedback(alice, old.group_id))[0].memory,
  'Shared only after a new choice');
console.log('PASS: repeated invite applies its fresh explicit answer atomically');

await asUser(bob, 'select public.set_group_feedback_sharing($1,false)', [old.group_id]);
assert.equal((await flags(old.group_id, bob)).sharing_choice_made_at, null);
assert.equal((await feedback(alice, old.group_id)).length, 0);
await asUser(bob, 'select public.choose_group_sharing($1,true)', [old.group_id]);
assert.equal((await flags(old.group_id, bob)).sharing_choice_made_at instanceof Date, true);
await asUser(bob, 'select public.set_group_completion_sharing($1,false)', [old.group_id]);
assert.equal((await flags(old.group_id, bob)).sharing_choice_made_at, null);
assert.equal((await groupFeed(alice, old.group_id)).filter(r => r.adventure_id === 42).length, 0);
await asUser(bob, 'select public.set_group_completion_sharing($1,true)', [old.group_id]);
assert.equal((await flags(old.group_id, bob)).share_feedback, false);
await asUser(bob, 'select public.choose_group_sharing($1,true)', [old.group_id]);
assert.equal((await feedback(alice, old.group_id))[0].memory,
  'Shared only after a new choice');
console.log('PASS: released split-consent RPCs reset the new choice marker');

// A new group and a second group both receive the same owner's eligible
// personal adventure, with its name and feedback under that adventure.
const second = await row(bob, 'select * from public.create_group_with_sharing($1,$2,$3)',
  ['Second friends', 'Bob', true]);
assert.match(second.join_code, /^[0123456789ABCDEFGHJKMNPQRSTVWXYZ]{6}$/);
await asUser(dave, 'select * from public.join_group_with_sharing($1,$2,$3)',
  [second.join_code, 'Dave', false]);
assert.equal((await feedback(dave, second.group_id))[0].memory,
  'Shared only after a new choice');
assert.equal((await groupFeed(dave, second.group_id))[0].source_is_personal, true);
assert.equal((await groupFeed(alice, old.group_id))[0].source_is_personal, true);
console.log('PASS: personal memory is visible in every consented group');

await asUser(alice, 'select public.choose_group_sharing($1,$2)', [old.group_id, true]);
await asUser(alice, `insert into public.progress
  (adventure_id,user_id,completed,completed_at,rating,memory)
  values (42,$1,true,now(),4,'Alice remembers the same adventure')`, [alice]);
const sharedAdventure = (await feedback(charlie, old.group_id))
  .filter(r => r.adventure_id === 42);
assert.equal(sharedAdventure.length, 2);
assert.deepEqual(sharedAdventure.map(r => r.completed_by_id).sort(), [alice, bob]);
assert.equal((await groupFeed(charlie, old.group_id))
  .filter(r => r.adventure_id === 42).length, 2);
console.log('PASS: all member notes for one adventure reach every group member');

await asUser(bob, `insert into public.progress
  (adventure_id,user_id,group_id,completed,completed_at,rating,memory)
  values (42,$1,$2,true,now(),1,'Old group-only duplicate')`, [bob, old.group_id]);
assert.equal((await groupFeed(charlie, old.group_id))
  .filter(r => r.adventure_id === 42).length, 2);
assert.equal((await groupFeed(dave, second.group_id))
  .filter(r => r.adventure_id === 42).length, 1);
assert.equal((await feedback(charlie, old.group_id))
  .filter(r => r.adventure_id === 42).length, 2);
assert.equal((await feedback(dave, second.group_id))
  .find(r => r.adventure_id === 42).memory, 'Shared only after a new choice');
console.log('PASS: old group-scoped duplicate does not create an extra anonymous tick');

// A pre-migration ambiguous row stays anonymous/private until its owner
// explicitly confirms it, even though the group has a combined yes choice.
const ambiguous = await row(bob, `insert into public.progress
  (adventure_id,user_id,completed,completed_at,rating,memory)
  values (45,$1,true,now(),4,'Ambiguous older note') returning id`, [bob]);
await db.query('delete from public.personal_progress_sharing_origins where progress_id=$1', [ambiguous.id]);
const before = (await groupFeed(alice, old.group_id)).find(r => r.adventure_id === 45);
assert.equal(before.source_is_personal, false);
assert.equal(before.completed_by_id, null);
assert.equal((await feedback(alice, old.group_id)).some(r => r.adventure_id === 45), false);
await asUser(bob, `insert into public.progress
  (adventure_id,user_id,group_id,completed,completed_at,memory)
  values (45,$1,$2,true,now(),'Second old group-only copy')`, [bob, old.group_id]);
assert.equal((await groupFeed(alice, old.group_id))
  .filter(r => r.adventure_id === 45).length, 1);
await asUser(bob, 'select public.revalidate_personal_progress($1)', [ambiguous.id]);
assert.equal((await feedback(alice, old.group_id)).find(r => r.adventure_id === 45).memory,
  'Ambiguous older note');
assert.equal((await groupFeed(alice, old.group_id))
  .filter(r => r.adventure_id === 45).length, 1);
assert.equal((await groupFeed(alice, old.group_id))
  .find(r => r.adventure_id === 45).source_is_personal, true);
console.log('PASS: ambiguous historical note remains private until owner confirmation');

// Leaving removes the named projection and note from this group while the
// personal tick and note remain on the owner's account and other group.
await asUser(bob, 'select public.transfer_group_ownership($1,$2)', [second.group_id, dave]);
await asUser(bob, 'select public.leave_group($1)', [second.group_id]);
assert.equal((await feedback(dave, second.group_id)).length, 0);
assert.equal((await groupFeed(dave, second.group_id)).length, 0);
assert.equal((await row(bob, 'select completed,memory from public.progress where id=$1',
  [ambiguous.id])).completed, true);
assert.equal((await feedback(alice, old.group_id)).some(r => r.adventure_id === 45), true);
console.log('PASS: leaving keeps only the person-owned tick and other-group consent');

const rotated = await row(alice, 'select public.rotate_group_invite($1) code', [old.group_id]);
assert.match(rotated.code, /^[0123456789ABCDEFGHJKMNPQRSTVWXYZ]{6}$/);
assert.equal((await asUser(dave, 'select * from public.join_group_by_code($1,$2)',
  [oldLongCode, 'Dave'])).rows.length, 0);
assert.equal((await asUser(dave, 'select * from public.join_group_by_code($1,$2)',
  [shortCode, 'Dave'])).rows.length, 0);
assert.equal((await asUser(dave, 'select * from public.join_group_by_code($1,$2)',
  [rotated.code, 'Dave'])).rows.length, 1);
console.log('PASS: rotation expires old long and short codes');

const fresh = await row(alice, 'select * from public.create_group_with_sharing($1,$2,$3)',
  ['Rate limited', 'Alice', false]);
for (let i = 0; i < 20; i++)
  assert.equal((await asUser(eve, 'select * from public.join_group_by_code($1,$2)',
    ['ZZZZZZ', 'Eve'])).rows.length, 0);
assert.equal((await asUser(eve, 'select * from public.join_group_by_code($1,$2)',
  [fresh.join_code, 'Eve'])).rows.length, 0);
assert.equal((await asUser(dave, 'select * from public.join_group_by_code($1,$2)',
  [fresh.join_code, 'Dave'])).rows.length, 1);
console.log('PASS: repeated guesses are limited per account without locking out others');

const historical = await row(bob, 'select * from public.create_group_with_sharing($1,$2,$3)',
  ['Old personal duplicate', 'Bob', false]);
await asUser(bob, `insert into public.progress(adventure_id,user_id,completed,memory)
  values (52,$1,true,'Personal copy')`, [bob]);
await asUser(bob, `insert into public.progress(adventure_id,user_id,group_id,completed,memory)
  values (52,$1,$2,true,'Old group copy')`, [bob, historical.group_id]);
await asUser(bob, 'select public.leave_group($1)', [historical.group_id]);
assert.equal((await row(bob, 'select count(*)::int n from public.progress where adventure_id=52')).n, 2);
assert.equal((await row(bob, 'select count(*)::int n from public.groups where id=$1',
  [historical.group_id])).n, 0);
assert.deepEqual((await db.query('select owner_id,invite_enabled from public.groups where id=$1',
  [historical.group_id])).rows[0], { owner_id: null, invite_enabled: false });
console.log('PASS: leaving a sole-member group preserves duplicate historical progress');

const oldShared = await row(bob, 'select * from public.create_group_with_sharing($1,$2,$3)',
  ['Old shared duplicate', 'Bob', true]);
await asUser(charlie, 'select * from public.join_group_with_sharing($1,$2,$3)',
  [oldShared.join_code, 'Charlie', false]);
await asUser(bob, `insert into public.progress(adventure_id,user_id,completed,memory)
  values (53,$1,true,'Personal before delete')`, [bob]);
await asUser(bob, `insert into public.progress(adventure_id,user_id,group_id,completed,memory)
  values (53,$1,$2,true,'Group-only before delete')`, [bob, oldShared.group_id]);
await asUser(bob, 'select public.delete_group($1)', [oldShared.group_id]);
assert.equal((await db.query('select count(*)::int n from public.group_members where group_id=$1',
  [oldShared.group_id])).rows[0].n, 0);
assert.equal((await db.query('select count(*)::int n from public.group_progress where group_id=$1',
  [oldShared.group_id])).rows[0].n, 0);
assert.equal((await row(bob, 'select count(*)::int n from public.progress where adventure_id=53')).n, 2);
assert.equal((await row(charlie, 'select count(*)::int n from public.groups where id=$1',
  [oldShared.group_id])).n, 0);
console.log('PASS: deleting a legacy group removes all access while retaining owner records');

const retiring = await row(eve, 'select * from public.create_group_with_sharing($1,$2,$3)',
  ['Account deletion shell', 'Eve', false]);
await asUser(eve, `insert into public.progress(adventure_id,user_id,group_id,completed,memory)
  values (54,$1,$2,true,'Removed with the account')`, [eve, retiring.group_id]);
await db.query(`insert into public.photos (adventure_id,user_id,group_id,storage_path)
  values (54,$1,$2,'old/account/photo')`, [eve, retiring.group_id]);
await db.query(`insert into public.trips (user_id,group_id,name)
  values ($1,$2,'Old account trip')`, [eve, retiring.group_id]);
await asUser(eve, 'select public.leave_group($1)', [retiring.group_id]);
assert.equal((await db.query('select count(*)::int n from public.groups where id=$1',
  [retiring.group_id])).rows[0].n, 1);
await asUser(eve, 'select public.delete_my_account()');
assert.equal((await db.query('select count(*)::int n from auth.users where id=$1', [eve])).rows[0].n, 0);
assert.deepEqual((await db.query(`select app_user_id,state from public.revenuecat_deletion_jobs
  where app_user_id=$1`, [eve])).rows, [{app_user_id: eve, state: 'pending'}]);
assert.equal((await db.query('select count(*)::int n from public.progress where user_id=$1',
  [eve])).rows[0].n, 0);
assert.equal((await db.query('select count(*)::int n from public.photos where user_id=$1',
  [eve])).rows[0].n, 0);
assert.equal((await db.query('select count(*)::int n from public.trips where user_id=$1',
  [eve])).rows[0].n, 0);
assert.equal((await db.query('select count(*)::int n from public.groups where id=$1',
  [retiring.group_id])).rows[0].n, 0);
console.log('PASS: account deletion queues RevenueCat erasure and clears the inert shell');

const shellIds = [historical.group_id, oldShared.group_id];
const shellCodes = (await db.query('select id,join_code from public.groups where id=any($1::uuid[])',
  [shellIds])).rows;
await migration('schema-group-join-choice.sql');
assert.equal((await db.query('select join_code from public.groups where id=$1',
  [old.group_id])).rows[0].join_code, rotated.code);
assert.equal((await flags(old.group_id, bob)).share_feedback, true);
assert.deepEqual((await db.query('select id,join_code from public.groups where id=any($1::uuid[])',
  [shellIds])).rows, shellCodes);
for (const shellId of shellIds) {
  const shell = (await db.query(`select owner_id,invite_enabled,
    retired_at is not null as retired from public.groups where id=$1`,
    [shellId])).rows[0];
  assert.deepEqual(shell, { owner_id: null, invite_enabled: false, retired: true });
  assert.equal((await db.query('select count(*)::int n from public.group_members where group_id=$1',
    [shellId])).rows[0].n, 0);
  assert.equal((await db.query('select count(*)::int n from public.group_progress where group_id=$1',
    [shellId])).rows[0].n, 0);
  assert.equal((await db.query('select count(*)::int n from public.group_legacy_invites where group_id=$1',
    [shellId])).rows[0].n, 0);
}
for (const signature of [
  'public.create_group_with_sharing(text,text,boolean)',
  'public.join_group_with_sharing(text,text,boolean)',
  'public.choose_group_sharing(uuid,boolean)',
]) {
  assert.equal((await db.query('select has_function_privilege($1,$2,$3) allowed',
    ['anon', signature, 'EXECUTE'])).rows[0].allowed, false);
}
console.log('PASS: replay preserves hidden shells, choices and codes; anonymous RPC access is denied');

const lastSources = await row(alice, 'select * from public.create_group_with_sharing($1,$2,$3)',
  ['Historical source cleanup', 'Alice', false]);
await db.query(`insert into public.progress (adventure_id,user_id,group_id,completed)
  values (55,$1,$2,true)`, [alice, lastSources.group_id]);
await db.query(`insert into public.photos (adventure_id,user_id,group_id,storage_path)
  values (55,$1,$2,'old/group/photo')`, [alice, lastSources.group_id]);
await db.query(`insert into public.trips (user_id,group_id,name)
  values ($1,$2,'Old group trip')`, [alice, lastSources.group_id]);
await asUser(alice, 'select public.leave_group($1)', [lastSources.group_id]);
assert.equal((await db.query('select retired_at is not null retired from public.groups where id=$1',
  [lastSources.group_id])).rows[0].retired, true);
await db.query('delete from public.progress where adventure_id=55 and group_id=$1',
  [lastSources.group_id]);
await db.query('delete from public.photos where adventure_id=55 and group_id=$1',
  [lastSources.group_id]);
assert.equal((await db.query('select count(*)::int n from public.groups where id=$1',
  [lastSources.group_id])).rows[0].n, 1);
await db.query('delete from public.trips where group_id=$1', [lastSources.group_id]);
assert.equal((await db.query('select count(*)::int n from public.groups where id=$1',
  [lastSources.group_id])).rows[0].n, 0);
console.log('PASS: retired shell remains until the final progress, photo or trip source is deleted');
await db.close();
