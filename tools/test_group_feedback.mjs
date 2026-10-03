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
create table storage.buckets (id text primary key, public boolean not null);
insert into storage.buckets(id, public) values ('memories', false);
create publication supabase_realtime;
alter publication supabase_realtime set (publish_generated_columns = stored);
alter publication supabase_realtime add table public.trips;
alter publication supabase_realtime add table public.photos;
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
await db.exec(`
  create policy "read owned or projected memory files" on storage.objects
    for select to authenticated
    using (bucket_id = 'memories' and public.can_read_memory_object(name));
  create policy "delete owned memory files" on storage.objects
    for delete to authenticated
    using (bucket_id = 'memories' and public.can_manage_memory_object(name));
`);
await db.exec(await readFile(new URL('../supabase/schema-device-local-photos.sql', import.meta.url), 'utf8'));
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
async function visibleProjection(who, groupId, progressId) {
  return (await asUser(who, `select count(*)::int n from public.group_progress
    where group_id=$1 and progress_id=$2`, [groupId, progressId])).rows[0].n;
}
function anonymousCompletion(label, row) {
  equal(`${label} keeps only an aggregate tick`,
    JSON.stringify([row.adventure_id, row.completed, row.source_is_personal]),
    JSON.stringify([row.adventure_id, true, false]));
  for (const field of [
    'completed_at', 'completed_on', 'completed_by_id', 'completed_by',
    'updated_at', 'source_user_id', 'shared_by_id',
  ]) equal(`${label} masks ${field}`, row[field], null);
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
const legacySourceGroup = (await asUser(bob,
  `select * from public.create_group('Legacy source','Bob')`)).rows[0];
const orphanCandidateId = (await asUser(bob, `insert into public.progress
  (adventure_id,user_id,group_id,completed,rating,memory)
  values (46,$1,$2,false,2,'Old group-only private note') returning id`,
  [bob,legacySourceGroup.group_id])).rows[0].id;
const legacyUpdatedBeforeMigration = (await db.query(
  'select updated_at from public.progress where id=$1', [orphanCandidateId]
)).rows[0].updated_at;

// Older clients could leave a cloud photo and a group projection before the
// device-local boundary. The boundary blocks new uploads but did not revoke a
// member's access to a historical projection.
const photoPath = `${bob}/42/historical.jpg`;
const photoId = (await db.query(`insert into public.photos
  (adventure_id,storage_path,user_id) values (42,$1,$2) returning id`,
  [photoPath,bob])).rows[0].id;
await db.query(`insert into storage.objects(bucket_id,name) values ('memories',$1)`, [photoPath]);
await asUser(bob, `insert into public.group_photos(group_id,photo_id,shared_by_id)
  values ($1,$2,$3)`, [first.group_id,photoId,bob]);
equal('historical projection previously exposed cloud photo metadata',
  (await asUser(alice, 'select count(*)::int n from public.photos where id=$1',
    [photoId])).rows[0].n, 1);
equal('historical projection previously exposed the cloud object',
  (await asUser(alice, 'select count(*)::int n from storage.objects where name=$1',
    [photoPath])).rows[0].n, 1);
const beforeCompletion = (await asUser(alice,
  'select * from public.group_completion_feed($1)', [first.group_id])).rows[0];
// A deleted source group can leave a NULL-group row that is indistinguishable
// from a personal row by the time this migration runs. Keep it incomplete so
// existing completion-count assertions below are unaffected until its test.
const deletedBeforeMigration = (await asUser(bob,
  `select * from public.create_group('Deleted old source','Bob')`)).rows[0];
const oldUnattributedOrphanId = (await asUser(bob, `insert into public.progress
  (adventure_id,user_id,group_id,completed,rating,memory)
  values (47,$1,$2,false,3,'Deleted group private note') returning id`,
  [bob,deletedBeforeMigration.group_id])).rows[0].id;
await db.query('delete from public.groups where id=$1', [deletedBeforeMigration.group_id]);
await db.exec(migration);

equal('migration remembers existing group-scoped progress without changing it',
  (await db.query(`select count(*)::int n from public.group_scoped_progress_origins
    where progress_id=$1`, [orphanCandidateId])).rows[0].n, 1);
equal('provenance backfill does not rewrite old progress timestamps',
  (await db.query('select updated_at from public.progress where id=$1',
    [orphanCandidateId])).rows[0].updated_at.getTime(),
  legacyUpdatedBeforeMigration.getTime());
const oldPersonalId = (await asUser(bob,
  'select id from public.progress where adventure_id=42')).rows[0].id;
equal('no historical NULL-group row is silently marked personal',
  (await db.query(`select count(*)::int n from public.personal_progress_sharing_origins
    where progress_id in ($1,$2)`, [oldPersonalId,oldUnattributedOrphanId])).rows[0].n, 0);
equal('deleted-before-migration group row has no knowable group-origin marker',
  (await db.query(`select count(*)::int n from public.group_scoped_progress_origins
    where progress_id=$1`, [oldUnattributedOrphanId])).rows[0].n, 0);
await rejected('ordinary members cannot read private personal-origin records', () =>
  asUser(bob, 'select * from public.personal_progress_sharing_origins'));
await rejected('owner cannot forge a personal-origin marker', () =>
  asUser(bob, `insert into public.personal_progress_sharing_origins(progress_id)
    values ($1)`, [oldPersonalId]));
await rejected('ordinary members cannot read private origin records', () =>
  asUser(bob, 'select * from public.group_scoped_progress_origins'));
await rejected('owner cannot erase durable group provenance', () =>
  asUser(bob, 'delete from public.group_scoped_progress_origins where progress_id=$1',
    [orphanCandidateId]));

equal('photo migration preserves the historical metadata row',
  (await db.query('select count(*)::int n from public.photos where id=$1',
    [photoId])).rows[0].n, 1);
equal('photo migration preserves the historical Storage object',
  (await db.query('select count(*)::int n from storage.objects where name=$1',
    [photoPath])).rows[0].n, 1);
equal('photo migration preserves the historical projection for owner cleanup',
  (await db.query('select count(*)::int n from public.group_photos where photo_id=$1',
    [photoId])).rows[0].n, 1);
equal('group member cannot read another member photo metadata',
  (await asUser(alice, 'select count(*)::int n from public.photos where id=$1',
    [photoId])).rows[0].n, 0);
equal('group member cannot read historical cloud photo object',
  (await asUser(alice, 'select count(*)::int n from storage.objects where name=$1',
    [photoPath])).rows[0].n, 0);
equal('group member cannot read historical photo projection',
  (await asUser(alice, 'select count(*)::int n from public.group_photos where photo_id=$1',
    [photoId])).rows[0].n, 0);
equal('photo tables stop broadcasting historical Realtime identifiers',
  (await db.query(`select count(*)::int n from pg_publication_tables
    where pubname='supabase_realtime' and schemaname='public'
      and tablename in ('photos','group_photos')`)).rows[0].n, 0);
equal('group member photo helper does not reauthorize the projection',
  (await asUser(alice, 'select public.can_read_photo($1) allowed',
    [photoId])).rows[0].allowed, false);
equal('group member Storage helper does not reauthorize the projection',
  (await asUser(alice, 'select public.can_read_memory_object($1) allowed',
    [photoPath])).rows[0].allowed, false);
equal('anonymous role cannot invoke photo read helpers',
  (await db.query(`select has_function_privilege('anon',
    'public.can_read_memory_object(text)', 'EXECUTE') allowed`)).rows[0].allowed, false);
equal('group member cannot delete another member historical cloud object',
  (await asUser(alice, 'delete from storage.objects where name=$1 returning id',
    [photoPath])).rows.length, 0);
equal('group member cannot delete another member historical photo metadata',
  (await asUser(alice, 'delete from public.photos where id=$1 returning id',
    [photoId])).rows.length, 0);
equal('owner retains historical photo metadata access',
  (await asUser(bob, 'select count(*)::int n from public.photos where id=$1',
    [photoId])).rows[0].n, 1);
equal('owner retains historical photo projection access',
  (await asUser(bob, 'select count(*)::int n from public.group_photos where photo_id=$1',
    [photoId])).rows[0].n, 1);
equal('owner retains historical cloud object access',
  (await asUser(bob, 'select count(*)::int n from storage.objects where name=$1',
    [photoPath])).rows[0].n, 1);
await rejected('old client cannot add another group photo projection', () =>
  asUser(bob, `insert into public.group_photos(group_id,photo_id,shared_by_id)
    values ($1,$2,$3)`, [second.group_id,photoId,bob]));

equal('existing members begin without feedback consent',
  (await db.query('select count(*)::int n from public.group_members where share_feedback')).rows[0].n, 0);
equal('existing completion feed still excludes rating',
  Object.hasOwn((await asUser(alice,
    'select * from public.group_completion_feed($1)', [first.group_id])).rows[0], 'rating'), false);
equal('existing completion feed still excludes note',
  Object.hasOwn((await asUser(alice,
    'select * from public.group_completion_feed($1)', [first.group_id])).rows[0], 'memory'), false);
const personalCompletion = (await asUser(alice,
  'select * from public.group_completion_feed($1)', [first.group_id])).rows[0];
equal('completion feed retains the original field names before source markers',
  Object.keys(personalCompletion).slice(0,7).join(','),
  'adventure_id,completed,completed_at,completed_on,completed_by_id,completed_by,updated_at');
equal('migration preserves the old aggregate adventure and tick',
  JSON.stringify([personalCompletion.adventure_id, personalCompletion.completed]),
  JSON.stringify([beforeCompletion.adventure_id, beforeCompletion.completed]));
equal('completion feed exposes only the three trailing source markers',
  Object.keys(personalCompletion).slice(7).join(','),
  'source_user_id,source_is_personal,shared_by_id');
anonymousCompletion('unconfirmed historical completion', personalCompletion);
equal('old personal row still exists unchanged for its owner',
  (await asUser(bob, 'select completed_by_id from public.progress where id=$1',
    [oldPersonalId])).rows[0].completed_by_id, bob);
equal('owner can read own unconfirmed completion projection',
  await visibleProjection(bob, first.group_id, oldPersonalId), 1);
equal('member cannot directly read unconfirmed completion projection',
  await visibleProjection(alice, first.group_id, oldPersonalId), 0);
equal('member in a second group cannot directly read the same unconfirmed projection',
  await visibleProjection(charlie, second.group_id, oldPersonalId), 0);
equal('outsider cannot directly read a completion projection',
  await visibleProjection(outsider, first.group_id, oldPersonalId), 0);
equal('only the owner can list the old completed personal candidate',
  (await asUser(bob, 'select adventure_id from public.list_unconfirmed_personal_progress()'))
    .rows.map(row => row.adventure_id).join(','), '42');
equal('another member cannot list the owner candidate',
  (await asUser(alice, 'select * from public.list_unconfirmed_personal_progress()')).rows.length, 0);
await rejected('another member cannot confirm the owner candidate', () =>
  asUser(alice, 'select public.revalidate_personal_progress($1)', [oldPersonalId]));
await rejected('owner cannot confirm an unfinished legacy row', () =>
  asUser(bob, 'select public.revalidate_personal_progress($1)', [oldUnattributedOrphanId]));
equal('anonymous role cannot list old personal candidates',
  (await db.query(`select has_function_privilege('anon',
    'public.list_unconfirmed_personal_progress()', 'EXECUTE') allowed`)).rows[0].allowed, false);
equal('anonymous role cannot confirm old personal progress',
  (await db.query(`select has_function_privilege('anon',
    'public.revalidate_personal_progress(uuid)', 'EXECUTE') allowed`)).rows[0].allowed, false);
equal('anonymous role cannot execute the extended completion feed',
  (await db.query(`select has_function_privilege('anon',
    'public.group_completion_feed(uuid)', 'EXECUTE') allowed`)).rows[0].allowed, false);
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
equal('consent alone cannot release an old rating or note',
  (await feedback(alice, first.group_id)).length, 0);
equal('consent alone does not rewrite every completion projection',
  (await refreshTime(first.group_id)).getTime(), new Date('2000-01-01T00:00:00Z').getTime());
await asUser(bob, `update public.progress set rating=3,memory='Still private'
  where id=$1`, [oldPersonalId]);
equal('substantive direct edit cannot bypass explicit reconfirmation',
  (await feedback(alice, first.group_id)).length, 0);
equal('quarantined edit does not signal private feedback to a group',
  (await refreshTime(first.group_id)).getTime(), new Date('2000-01-01T00:00:00Z').getTime());
await asUser(bob, `update public.progress set rating=4,memory='A private old note'
  where id=$1`, [oldPersonalId]);
await asUser(bob, 'select public.revalidate_personal_progress($1)', [oldPersonalId]);
const firstFeedback = await feedback(alice, first.group_id);
equal('consented rating is visible to another current member', firstFeedback[0].rating, 4);
equal('consented note is visible to another current member', firstFeedback[0].memory, 'A private old note');
equal('explicit reconfirmation changes old tick to safely named personal',
  (await asUser(alice,
    'select source_is_personal from public.group_completion_feed($1) where adventure_id=42',
    [first.group_id])).rows[0].source_is_personal, true);
equal('confirmed completion identifies its owner to a group member',
  (await asUser(alice,
    'select completed_by_id from public.group_completion_feed($1) where adventure_id=42',
    [first.group_id])).rows[0].completed_by_id, bob);
equal('confirmation opens direct projection reads in the first consented group',
  await visibleProjection(alice, first.group_id, oldPersonalId), 1);
equal('confirmation opens direct projection reads in the second consented group',
  await visibleProjection(charlie, second.group_id, oldPersonalId), 1);
equal('explicit reconfirmation wakes only this owner projected row',
  (await refreshTime(first.group_id)) > new Date('2000-01-01T00:00:00Z'), true);
equal('confirmed row drops out of the Personal-view candidate list',
  (await asUser(bob, 'select * from public.list_unconfirmed_personal_progress()')).rows.length, 0);
equal('feedback opt-in does not share a projected historical photo',
  (await asUser(alice, 'select count(*)::int n from storage.objects where name=$1',
    [photoPath])).rows[0].n, 0);
equal('feedback identifies its actual owner', firstFeedback[0].completed_by_id, bob);
equal('feedback feed has only its four specified fields',
  Object.keys(firstFeedback[0]).sort().join(','),
  'adventure_id,completed_by_id,memory,rating');
const refreshedAfterConfirmation = (await refreshTime(first.group_id)).getTime();
await asUser(bob, 'select public.revalidate_personal_progress($1)', [oldPersonalId]);
equal('reconfirmation is idempotent and does not rebroadcast',
  (await refreshTime(first.group_id)).getTime(), refreshedAfterConfirmation);
equal('group member changes are in the realtime publication',
  (await db.query(`select count(*)::int n from pg_publication_tables
    where pubname='supabase_realtime' and schemaname='public'
      and tablename='group_members'`)).rows[0].n, 1);
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
equal('revocation does not rewrite every completion projection',
  (await refreshTime(first.group_id)).getTime(), new Date('2000-01-01T00:00:00Z').getTime());
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
equal('migration replay preserves personal source identity',
  (await asUser(alice,
    'select source_user_id from public.group_completion_feed($1) where adventure_id=42',
    [first.group_id])).rows[0].source_user_id, bob);
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
equal('feedback consent never reopens historical photo metadata',
  (await asUser(charlie, 'select count(*)::int n from public.photos where id=$1',
    [photoId])).rows[0].n, 0);
equal('feedback consent never reopens historical cloud photo objects',
  (await asUser(charlie, 'select count(*)::int n from storage.objects where name=$1',
    [photoPath])).rows[0].n, 0);
// Older clients could leave a second, group-scoped row for the same owner and
// adventure. The current client prefers the personal row; feedback must agree.
await asUser(bob, `insert into public.progress
  (adventure_id,user_id,group_id,completed,completed_at,rating,memory)
  values (42,$1,$2,true,now(),1,'Legacy group-only note')`, [bob,second.group_id]);
const duplicateFeedback = (await feedback(charlie, second.group_id))
  .filter(row => row.adventure_id === 42);
equal('duplicate group-scoped note is excluded', duplicateFeedback.length, 1);
equal('the canonical personal note wins over the legacy duplicate',
  duplicateFeedback[0].memory, 'Private again');
const legacyDuplicateId = (await asUser(bob, `select id from public.progress
  where adventure_id=42 and group_id=$1`, [second.group_id])).rows[0].id;
equal('owner can read own group-only projection',
  await visibleProjection(bob, second.group_id, legacyDuplicateId), 1);
equal('member cannot directly read a group-only completion projection',
  await visibleProjection(charlie, second.group_id, legacyDuplicateId), 0);
await db.query(`update public.group_progress set refreshed_at='2000-01-01T00:00:00Z'
  where group_id=$1 and progress_id=$2`, [second.group_id,legacyDuplicateId]);
await asUser(bob, `update public.progress set memory='Legacy edit remains private'
  where id=$1`, [legacyDuplicateId]);
equal('editing hidden legacy feedback does not signal a group refresh',
  (await db.query(`select refreshed_at from public.group_progress
    where group_id=$1 and progress_id=$2`, [second.group_id,legacyDuplicateId]))
    .rows[0].refreshed_at.getTime(), new Date('2000-01-01T00:00:00Z').getTime());
await asUser(bob, `insert into public.progress
  (adventure_id,user_id,group_id,completed,completed_at,rating,memory)
  values (44,$1,$2,true,now(),2,'Legacy-only private note')`, [bob,second.group_id]);
equal('legacy-only group-scoped feedback stays private',
  (await feedback(charlie, second.group_id)).filter(row => row.adventure_id === 44).length, 0);
// Pre-migration group records may truthfully attribute the completion to a
// person other than the personal row owner. Do not mislabel that owner's note.
await asUser(bob, `insert into public.progress
  (adventure_id,user_id,group_id,completed,completed_at,rating,memory)
  values (43,$1,$2,true,now(),3,'Bob personal history')`, [bob,second.group_id]);
await db.exec('alter table public.progress disable trigger progress_attribute_personal_completion');
await db.query('update public.progress set completed_by_id=$1 where adventure_id=43', [charlie]);
await db.exec('alter table public.progress enable trigger progress_attribute_personal_completion');
const legacyCompletion = (await asUser(charlie,
  'select * from public.group_completion_feed($1) where adventure_id=43',
  [second.group_id])).rows[0];
anonymousCompletion('historical non-owner group completion', legacyCompletion);
equal('completion feed does not reveal the source group ID',
  Object.hasOwn(legacyCompletion, 'source_group_id'), false);
equal('owner note is not mislabelled as the historical completer note',
  (await feedback(charlie, second.group_id)).filter(row => row.adventure_id === 43).length, 0);

await asUser(bob, 'update public.progress set completed=true where id=$1', [orphanCandidateId]);
anonymousCompletion('known group-scoped completion',
  (await asUser(charlie,
    'select * from public.group_completion_feed($1) where adventure_id=46',
    [second.group_id])).rows[0]);
equal('member cannot directly read known group-scoped projection',
  await visibleProjection(charlie, second.group_id, orphanCandidateId), 0);
await db.query('delete from public.groups where id=$1', [legacySourceGroup.group_id]);
equal('deleting the old group clears its nullable source ID',
  (await db.query('select group_id from public.progress where id=$1',
    [orphanCandidateId])).rows[0].group_id, null);
equal('durable origin marker survives the source group deletion',
  (await db.query(`select count(*)::int n from public.group_scoped_progress_origins
    where progress_id=$1`, [orphanCandidateId])).rows[0].n, 1);
anonymousCompletion('orphaned known group-scoped completion',
  (await asUser(charlie,
    'select * from public.group_completion_feed($1) where adventure_id=46',
    [second.group_id])).rows[0]);
equal('orphaned legacy note remains outside the feedback feed',
  (await feedback(charlie, second.group_id)).filter(row => row.adventure_id === 46).length, 0);
await rejected('known group-origin row cannot be reconfirmed after its group was deleted', () =>
  asUser(bob, 'select public.revalidate_personal_progress($1)', [orphanCandidateId]));
// This row lost its group ID before the migration, so there is no surviving
// group-origin marker to distinguish it. The migration nevertheless keeps it
// anonymous and keeps its old group-only note private until explicit owner
// reconfirmation, even after ordinary changes to the completion.
await asUser(bob, 'update public.progress set completed=true where id=$1',
  [oldUnattributedOrphanId]);
anonymousCompletion('pre-migration ambiguous orphan',
  (await asUser(charlie,
    'select * from public.group_completion_feed($1) where adventure_id=47',
    [second.group_id])).rows[0]);
equal('member cannot directly read pre-migration ambiguous orphan projection',
  await visibleProjection(charlie, second.group_id, oldUnattributedOrphanId), 0);
equal('pre-migration ambiguous orphan note remains private despite consent',
  (await feedback(charlie, second.group_id)).filter(row => row.adventure_id === 47).length, 0);
await asUser(bob, `update public.progress set rating=4,memory='Changed but still private'
  where id=$1`, [oldUnattributedOrphanId]);
equal('ordinary update cannot release pre-migration ambiguous orphan feedback',
  (await feedback(charlie, second.group_id)).filter(row => row.adventure_id === 47).length, 0);
equal('old ambiguous row is not marked personal after its update',
  (await db.query(`select count(*)::int n from public.personal_progress_sharing_origins
    where progress_id=$1`, [oldUnattributedOrphanId])).rows[0].n, 0);
await asUser(charlie, 'select public.leave_group($1)', [second.group_id]);
equal('leaving immediately removes read access to the remaining feedback',
  (await feedback(charlie, second.group_id)).length, 0);
await asUser(charlie, 'select * from public.join_group_by_code($1,$2)', [second.join_code,'Charlie again']);
equal('rejoined member sees only currently consented feedback',
  (await feedback(charlie, second.group_id))[0].rating, 5);
const newPersonalId = (await asUser(bob, `insert into public.progress
  (adventure_id,user_id,completed,rating,memory)
  values (49,$1,true,4,'New personal note') returning id`, [bob])).rows[0].id;
equal('fresh authenticated personal insert is marked at creation',
  (await db.query(`select count(*)::int n from public.personal_progress_sharing_origins
    where progress_id=$1`, [newPersonalId])).rows[0].n, 1);
equal('new personal completion has named attribution automatically',
  (await asUser(charlie,
    'select source_is_personal from public.group_completion_feed($1) where adventure_id=49',
    [second.group_id])).rows[0].source_is_personal, true);
equal('new personal feedback follows consent normally',
  (await feedback(charlie, second.group_id)).find(row => row.adventure_id === 49).memory,
  'New personal note');
await db.exec(migration);
equal('migration replay never reseeds ambiguous historical personal markers',
  (await db.query(`select count(*)::int n from public.personal_progress_sharing_origins
    where progress_id=$1`, [oldUnattributedOrphanId])).rows[0].n, 0);
equal('migration replay keeps explicit and fresh personal markers',
  (await db.query(`select count(*)::int n from public.personal_progress_sharing_origins
    where progress_id in ($1,$2)`, [oldPersonalId,newPersonalId])).rows[0].n, 2);
equal('migration replay keeps the historical photo private',
  (await asUser(charlie, 'select count(*)::int n from public.photos where id=$1',
    [photoId])).rows[0].n, 0);
equal('owner can delete the historical cloud object',
  (await asUser(bob, 'delete from storage.objects where name=$1 returning id',
    [photoPath])).rows.length, 1);
equal('owner can delete the historical photo metadata',
  (await asUser(bob, 'delete from public.photos where id=$1 returning id',
    [photoId])).rows.length, 1);
equal('photo metadata deletion cascades its old projection',
  (await db.query('select count(*)::int n from public.group_photos where photo_id=$1',
    [photoId])).rows[0].n, 0);
await asUser(bob, 'select public.delete_my_account()');
equal('deleting the contributor account clears group feedback',
  (await feedback(charlie, second.group_id)).length, 0);

await db.exec(`update storage.buckets set public=true where id='memories'`);
await rejected('public memories bucket aborts the migration', () => db.exec(migration));
await db.exec('rollback');
await db.exec(`update storage.buckets set public=false where id='memories'`);
await db.exec(`
  drop policy "read owned or projected memory files" on storage.objects;
  create policy "read owned or projected memory files" on storage.objects
    for select to authenticated
    using ((bucket_id = 'memories' and public.can_read_memory_object(name)) or true);
`);
await rejected('broadened Storage read policy aborts the migration', () => db.exec(migration));
await db.exec('rollback');
await db.exec(`
  drop policy "read owned or projected memory files" on storage.objects;
  create policy "read owned or projected memory files" on storage.objects
    for select to authenticated
    using (bucket_id = 'memories' and public.can_read_memory_object(name));
  create policy "unexpected photo read" on public.photos
    for select to authenticated using (true);
`);
await rejected('unreviewed photo read policy aborts the migration', () => db.exec(migration));
await db.exec('rollback');

console.log(`\n${passed} group-feedback database checks passed.`);
await db.close();
