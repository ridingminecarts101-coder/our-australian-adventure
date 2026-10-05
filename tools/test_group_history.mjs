// PostgreSQL-WASM checks for frozen group memories; no production data.
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
  name text not null default 'Trip', group_id uuid references public.groups(id) on delete set null,
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
insert into auth.users(id) values
 ('${alice}'),('${bob}'),('${charlie}'),('${dave}'),('${eve}');
`);

async function migration(name) {
  await db.exec(await readFile(new URL(`../supabase/${name}`, import.meta.url), 'utf8'));
}
async function asUser(id, sql, params = []) {
  await db.exec(`set role authenticated; set "request.jwt.claim.sub" = '${id}'`);
  try { return await db.query(sql, params); }
  finally { await db.exec('reset role; reset "request.jwt.claim.sub"'); }
}
async function row(id, sql, params = []) {
  return (await asUser(id, sql, params)).rows[0];
}
async function feed(id, group) {
  return (await asUser(id, 'select * from public.group_completion_feed($1)', [group])).rows;
}
async function feedback(id, group) {
  return (await asUser(id, 'select * from public.group_completion_feedback_feed($1)', [group])).rows;
}
async function count(sql, params = []) {
  return Number((await db.query(sql, params)).rows[0].n);
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
for (const name of [
  'schema-device-local-photos.sql', 'schema-revenuecat-deletion.sql',
  'schema-group-feedback.sql', 'schema-group-join-choice.sql',
  'schema-group-history.sql',
]) await migration(name);

assert.equal((await db.query(`select has_table_privilege('authenticated',
  'public.group_departed_memories','SELECT') allowed`)).rows[0].allowed, false);
assert.equal((await db.query(`select has_function_privilege('anon',
  'public.group_completion_feed(uuid)','EXECUTE') allowed`)).rows[0].allowed, false);
assert.equal((await db.query(`select has_function_privilege('authenticated',
  'public.archive_group_member_memories(uuid,uuid)','EXECUTE') allowed`)).rows[0].allowed, false);

const one = await row(alice, `select * from public.create_group_with_sharing('Friends','Alice',true)`);
const two = await row(charlie, `select * from public.create_group_with_sharing('Family','Charlie',true)`);
await row(bob, `select * from public.join_group_with_sharing($1,'Bob in Friends',true)`, [one.join_code]);
await row(bob, `select * from public.join_group_with_sharing($1,'Bob in Family',false)`, [two.join_code]);
const personal = await row(bob, `insert into public.progress
  (adventure_id,user_id,completed,completed_at,completed_on,rating,memory)
  values (101,$1,true,'2026-09-01T00:00:00Z','2026-09-01',5,'First memory') returning id`, [bob]);
await asUser(bob, 'select public.choose_group_sharing($1,true)', [one.group_id]);
assert.equal((await feed(alice, one.group_id)).length, 1);
assert.equal((await feedback(alice, one.group_id))[0].memory, 'First memory');
assert.equal((await feed(charlie, two.group_id)).length, 0);

await asUser(bob, 'select public.leave_group($1)', [one.group_id]);
let retained = (await feed(alice, one.group_id))[0];
assert.deepEqual(Object.keys(retained), [
  'adventure_id', 'completed', 'completed_at', 'completed_on',
  'completed_by_id', 'completed_by', 'updated_at', 'source_user_id',
  'source_is_personal', 'shared_by_id',
]);
assert.equal(retained.completed_by_id, bob);
assert.equal(retained.completed_by, 'Bob in Friends');
assert.equal(retained.completed_on.toISOString().slice(0, 10), '2026-09-01');
assert.equal((await feedback(alice, one.group_id))[0].memory, 'First memory');
assert.equal((await feed(bob, one.group_id)).length, 0);
assert.equal((await feed(charlie, two.group_id)).length, 0);
assert.equal(Number((await row(bob, 'select * from public.list_my_retained_group_history()')).retained_count), 1);
await assert.rejects(asUser(bob, 'select * from public.group_departed_memories'));

await asUser(bob, `update public.progress set memory='Later personal edit', rating=1,
  completed_at='2026-10-01T00:00:00Z', completed_on='2026-10-01' where id=$1`, [personal.id]);
assert.equal((await feedback(alice, one.group_id))[0].memory, 'First memory');
assert.equal((await feed(alice, one.group_id))[0].completed_on.toISOString().slice(0, 10), '2026-09-01');
assert.equal((await row(bob, 'select memory from public.progress where id=$1', [personal.id])).memory,
  'Later personal edit');

// Private rejoin retains the old group copy. Sharing rejoin replaces it with
// the current live row exactly once; another departure refreshes the snapshot.
await row(bob, `select * from public.join_group_with_sharing($1,'Bob again',false)`, [one.join_code]);
assert.equal((await feed(alice, one.group_id)).length, 1);
assert.equal((await feedback(alice, one.group_id))[0].memory, 'First memory');
await asUser(bob, 'select public.leave_group($1)', [one.group_id]);
await row(bob, `select * from public.join_group_with_sharing($1,'Bob again',true)`, [one.join_code]);
assert.equal((await feed(alice, one.group_id)).length, 1);
assert.equal((await feedback(alice, one.group_id)).length, 1);
assert.equal((await feedback(alice, one.group_id))[0].memory, 'Later personal edit');
await asUser(bob, 'select public.leave_group($1)', [one.group_id]);
assert.equal((await feedback(alice, one.group_id))[0].memory, 'Later personal edit');

// A pre-existing member who enabled ticks only has never consented to notes.
await row(dave, `select * from public.join_group_with_sharing($1,'Dave',false)`, [one.join_code]);
await asUser(dave, `insert into public.progress
  (adventure_id,user_id,completed,completed_at,rating,memory)
  values (102,$1,true,now(),4,'Private note')`, [dave]);
await asUser(dave, 'select public.set_group_completion_sharing($1,true)', [one.group_id]);
await asUser(dave, 'select public.leave_group($1)', [one.group_id]);
assert.equal((await feed(alice, one.group_id)).filter(x => x.adventure_id === 102).length, 1);
assert.equal((await feedback(alice, one.group_id)).filter(x => x.adventure_id === 102).length, 0);

// The released client's explicit revocation removes old frozen content too.
await row(dave, `select * from public.join_group_with_sharing($1,'Dave again',true)`, [one.join_code]);
await asUser(dave, 'select public.set_group_feedback_sharing($1,true)', [one.group_id]);
await asUser(dave, 'select public.leave_group($1)', [one.group_id]);
assert.equal((await feedback(alice, one.group_id)).find(x => x.adventure_id === 102).memory,
  'Private note');
await row(dave, `select * from public.join_group_with_sharing($1,'Dave third',true)`, [one.join_code]);
await asUser(dave, 'select public.set_group_feedback_sharing($1,false)', [one.group_id]);
assert.equal((await feedback(alice, one.group_id)).some(x => x.adventure_id === 102), false);
assert.equal((await db.query(`select memory from public.group_departed_memories
  where group_id=$1 and shared_by_id=$2 and adventure_id=102`, [one.group_id, dave])).rows[0].memory,
  null);
await asUser(dave, 'select public.set_group_completion_sharing($1,false)', [one.group_id]);
assert.equal((await feed(alice, one.group_id)).some(x => x.adventure_id === 102), false);
assert.equal(await count(`select count(*) n from public.group_departed_memories
  where group_id=$1 and shared_by_id=$2`, [one.group_id, dave]), 0);
await asUser(dave, 'select public.leave_group($1)', [one.group_id]);

// The old group-scoped source cannot turn into a named note on departure.
await row(eve, `select * from public.join_group_with_sharing($1,'Eve',true)`, [one.join_code]);
await asUser(eve, `insert into public.progress
  (adventure_id,user_id,group_id,completed,completed_at,rating,memory)
  values (103,$1,$2,true,now(),5,'Legacy private')`, [eve, one.group_id]);
await asUser(eve, 'select public.leave_group($1)', [one.group_id]);
retained = (await feed(alice, one.group_id)).find(x => x.adventure_id === 103);
assert.equal(retained.source_is_personal, false);
assert.equal(retained.completed_by_id, null);
assert.equal(retained.completed_by, null);
assert.equal(retained.completed_on, null);
assert.equal((await feedback(alice, one.group_id)).some(x => x.adventure_id === 103), false);

// Former members can erase only their own group history, without membership.
const mine = (await asUser(bob, 'select * from public.list_my_retained_group_history()')).rows;
assert.deepEqual(mine.map(x => x.group_name), ['Friends']);
await db.query(`update public.group_members set history_changed_at='2000-01-01'
  where group_id=$1 and user_id=$2`, [one.group_id, alice]);
await asUser(dave, 'select public.erase_my_group_history($1)', [one.group_id]);
assert.equal((await feed(alice, one.group_id)).some(x => x.adventure_id === 102), false);
assert.equal((await feed(alice, one.group_id)).some(x => x.adventure_id === 101), true);
await asUser(bob, 'select public.erase_my_group_history($1)', [one.group_id]);
assert.equal((await db.query(`select history_changed_at > '2000-01-01'::timestamptz refreshed
  from public.group_members where group_id=$1 and user_id=$2`, [one.group_id, alice])).rows[0].refreshed,
  true);
assert.equal((await db.query(`select exists(select 1 from pg_publication_tables
  where pubname='supabase_realtime' and tablename='group_members') published`)).rows[0].published,
  true);
assert.equal((await feed(alice, one.group_id)).some(x => x.adventure_id === 101), false);
assert.equal((await asUser(bob, 'select * from public.list_my_retained_group_history()')).rows.length, 0);

// Owner removal archives consented history and account deletion removes it.
await row(bob, `select * from public.join_group_with_sharing($1,'Bob third',true)`, [one.join_code]);
await asUser(alice, 'select public.remove_group_member($1,$2)', [one.group_id, bob]);
assert.equal((await feedback(alice, one.group_id))[0].memory, 'Later personal edit');
assert.equal((await asUser(bob, 'select * from public.list_my_retained_group_history()')).rows.length, 1);
await row(bob, `select * from public.join_group_with_sharing($1,'Bob family',true)`,
  [two.join_code]);
await asUser(bob, 'select public.leave_group($1)', [two.group_id]);
assert.equal((await asUser(bob, 'select * from public.list_my_retained_group_history()')).rows.length, 2);
await asUser(bob, 'select public.delete_my_account()');
assert.equal((await feed(alice, one.group_id)).some(x => x.adventure_id === 101), false);
assert.equal(await count('select count(*) n from public.group_departed_memories where shared_by_id=$1', [bob]), 0);
assert.equal((await feed(charlie, two.group_id)).some(x => x.adventure_id === 101), false);
assert.equal(await count('select count(*) n from public.revenuecat_deletion_jobs where app_user_id=$1', [bob]), 1);

// Explicit group deletion purges snapshots even when a legacy group source
// forces an inert provenance shell to remain.
assert.equal(await count('select count(*) n from public.group_departed_memories where group_id=$1',
  [one.group_id]), 1);
await asUser(alice, 'select public.delete_group($1)', [one.group_id]);
assert.equal(await count('select count(*) n from public.group_departed_memories where group_id=$1',
  [one.group_id]), 0);
assert.equal((await feed(alice, one.group_id)).length, 0);

const shell = await row(alice,
  `select * from public.create_group_with_sharing('Legacy shell','Alice',false)`);
await asUser(alice, `insert into public.progress
  (adventure_id,user_id,group_id,completed) values (204,$1,$2,true)`,
  [alice, shell.group_id]);
await row(charlie, `select * from public.join_group_with_sharing($1,'Charlie',true)`,
  [shell.join_code]);
await asUser(charlie, `insert into public.progress
  (adventure_id,user_id,completed,memory) values (205,$1,true,'Will clear')`, [charlie]);
await asUser(charlie, 'select public.leave_group($1)', [shell.group_id]);
assert.equal(await count('select count(*) n from public.group_departed_memories where group_id=$1',
  [shell.group_id]), 1);
await asUser(alice, 'select public.leave_group($1)', [shell.group_id]);
assert.equal(await count('select count(*) n from public.groups where id=$1', [shell.group_id]), 1);
assert.equal(await count('select count(*) n from public.group_departed_memories where group_id=$1',
  [shell.group_id]), 0);

// Last member leave deletes an ordinary group and cascades the archive.
await asUser(charlie, 'select public.leave_group($1)', [two.group_id]);
assert.equal(await count('select count(*) n from public.groups where id=$1', [two.group_id]), 0);

await migration('schema-group-history.sql');
assert.equal(await count('select count(*) n from public.group_departed_memories'), 0);
const postflight = await db.exec(await readFile(
  new URL('../supabase/group-history-postflight.sql', import.meta.url), 'utf8'));
assert.equal(postflight[0].rows[0].ownerless_group_rows, 0);
assert.equal(postflight[1].rows[0].owner_erase_rpc_present, true);
assert.equal(postflight[1].rows[0].member_invalidation_published, true);
console.log('PASS: retained group history, legacy privacy, RLS, rejoin, erase and deletion');
await db.close();
