// Isolated acceptance probe for the 5 October owner decision. No live service
// or customer rows are contacted; PGlite applies the candidate migrations.
import { readFile } from 'node:fs/promises';
import { existsSync } from 'node:fs';
import { fileURLToPath } from 'node:url';
import { resolve } from 'node:path';
import { PGlite } from '@electric-sql/pglite';

const db = new PGlite();
const repo = resolve(process.env.REVIEW_TARGET || fileURLToPath(new URL('..', import.meta.url)));
const alice = '11111111-1111-4111-8111-111111111111';
const bob = '22222222-2222-4222-8222-222222222222';
const outcomes = [];
const check = (id, label, ok, actual) => {
  const status = ok ? 'PASS' : 'FAIL';
  outcomes.push({ id, label, status, actual });
  console.log(`REVIEW ${id} ${status}: ${label}${ok ? '' : ` (actual: ${actual})`}`);
};

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
insert into auth.users(id) values ('${alice}'),('${bob}');
`);

async function migration(name) {
  await db.exec(await readFile(resolve(repo, 'supabase', name), 'utf8'));
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
]) await migration(name);
const historySql = resolve(repo, 'supabase', 'schema-group-history.sql');
if (existsSync(historySql)) {
  await migration('schema-group-history.sql');
  console.log('MIGRATION: group-history applied after group-join-choice');
} else {
  console.log('MIGRATION: group-history absent from this candidate');
}

async function asUser(id, sql, params = []) {
  await db.exec(`set role authenticated; set "request.jwt.claim.sub" = '${id}'`);
  try { return await db.query(sql, params); }
  finally { await db.exec('reset role; reset "request.jwt.claim.sub"'); }
}
const one = async (id, sql, params = []) => (await asUser(id, sql, params)).rows[0];

const group = await one(alice,
  'select * from public.create_group_with_sharing($1,$2,$3)',
  ['Shared history', 'Alice', true]);
await asUser(bob, 'select * from public.join_group_with_sharing($1,$2,$3)',
  [group.join_code, 'Bob', true]);
const progress = await one(bob, `insert into public.progress
  (adventure_id,user_id,completed,completed_at,completed_on,rating,memory)
  values (42,$1,true,'2026-10-05T00:00:00Z','2026-10-05',5,'Bob remembers this')
  returning id`, [bob]);
const beforeTick = await one(alice,
  'select * from public.group_completion_feed($1) where adventure_id=42', [group.group_id]);
const beforeNote = await one(alice,
  'select * from public.group_completion_feedback_feed($1) where adventure_id=42', [group.group_id]);
if (!beforeTick || !beforeNote) throw new Error('Fixture did not share history before leave');

await asUser(bob, 'select public.leave_group($1)', [group.group_id]);
const afterTick = await one(alice,
  'select * from public.group_completion_feed($1) where adventure_id=42', [group.group_id]);
const afterNote = await one(alice,
  'select * from public.group_completion_feedback_feed($1) where adventure_id=42', [group.group_id]);
const ownProgress = await one(bob,
  'select completed, memory from public.progress where id=$1', [progress.id]);
check(1, 'leaver keeps own completed tick and note',
  ownProgress?.completed === true && ownProgress?.memory === 'Bob remembers this',
  JSON.stringify(ownProgress));
check(2, 'group retains leaver name, date, tick and note',
  afterTick?.completed === true && afterTick?.completed_by === 'Bob'
    && new Date(afterTick?.completed_on).toISOString().slice(0, 10) === '2026-10-05'
    && afterNote?.memory === 'Bob remembers this',
  `tick=${JSON.stringify(afterTick || null)}, note=${JSON.stringify(afterNote || null)}`);

const solo = await one(bob,
  'select * from public.create_group_with_sharing($1,$2,$3)',
  ['Sole member group', 'Bob', false]);
await asUser(bob, 'select public.leave_group($1)', [solo.group_id]);
const remaining = (await db.query('select count(*)::int n from public.groups where id=$1',
  [solo.group_id])).rows[0].n;
check(3, 'last-member empty group is disposed when nobody can administer it', remaining === 0, remaining);

await db.close();
if (outcomes.some(result => result.status === 'FAIL')) process.exitCode = 1;
