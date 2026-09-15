// Local PostgreSQL policy test. No network, Supabase project or customer row.
import assert from 'node:assert/strict';
import { readFile } from 'node:fs/promises';
import { PGlite } from '@electric-sql/pglite';

const alice = '11111111-1111-4111-8111-111111111111';
const bob = '22222222-2222-4222-8222-222222222222';
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
create table public.groups (id uuid primary key default gen_random_uuid(), name text not null,
  join_code text not null unique, created_by uuid references auth.users(id) on delete set null);
create table public.group_members (group_id uuid references public.groups(id) on delete cascade,
  user_id uuid references auth.users(id) on delete cascade, display_name text,
  primary key (group_id,user_id));
create table public.progress (id uuid primary key default gen_random_uuid(), adventure_id integer not null,
  user_id uuid references auth.users(id) on delete cascade, group_id uuid references public.groups(id) on delete set null,
  completed boolean not null default false, completed_at timestamptz,
  completed_by_id uuid references auth.users(id) on delete set null, completed_by text,
  shortlisted boolean default false, rating integer, memory text, updated_by text,
  updated_at timestamptz default now(), scope_id uuid generated always as (coalesce(group_id,user_id)) stored,
  unique(adventure_id,scope_id));
create table public.photos (id uuid primary key default gen_random_uuid(), adventure_id integer,
  storage_path text not null, user_id uuid references auth.users(id) on delete cascade,
  group_id uuid references public.groups(id) on delete set null,
  scope_id uuid generated always as (coalesce(group_id,user_id)) stored);
create table public.trips (id uuid primary key default gen_random_uuid(),
  user_id uuid references auth.users(id) on delete cascade,
  group_id uuid references public.groups(id) on delete set null,
  scope_id uuid generated always as (coalesce(group_id,user_id)) stored);
alter table public.progress enable row level security;
alter table public.photos enable row level security;
alter table public.trips enable row level security;
create table storage.objects (id uuid primary key default gen_random_uuid(), bucket_id text, name text);
alter table storage.objects enable row level security;
create publication supabase_realtime;
grant usage on schema public, auth, storage to authenticated;
grant select,insert,update,delete on all tables in schema public to authenticated;
grant select,insert,update,delete on storage.objects to authenticated;
`;
const personal = await readFile(new URL('../supabase/schema-personal-ownership.sql', import.meta.url), 'utf8');
const boundary = await readFile(new URL('../supabase/schema-device-local-photos.sql', import.meta.url), 'utf8');

async function setup() {
  const db = new PGlite();
  await db.exec(fixture);
  await db.query('insert into auth.users(id) values ($1),($2)', [alice,bob]);
  await db.exec(personal);
  return db;
}
async function asUser(db, user, sql, params = []) {
  await db.exec(`set role authenticated; set "request.jwt.claim.sub" = '${user}'`);
  try { return await db.query(sql, params); }
  finally { await db.exec('reset role; reset "request.jwt.claim.sub"'); }
}
async function denied(label, fn) {
  await assert.rejects(fn, error => error.code === '42501');
  console.log(`PASS: ${label}`);
}

const db = await setup();
const group = (await asUser(db, alice, `select * from public.create_group('Test group','Alice')`)).rows[0];
await asUser(db, bob, 'select * from public.join_group_by_code($1,$2)', [group.join_code,'Bob']);
const photo = (await db.query(`insert into public.photos(adventure_id,storage_path,user_id)
  values (7,$1,$2) returning id`, [`${bob}/7/legacy.jpg`,bob])).rows[0];
await db.query(`insert into storage.objects(bucket_id,name) values ('memories',$1)`, [`${bob}/7/legacy.jpg`]);
await db.exec(`
  create policy "read owned or projected memory files" on storage.objects
    for select to authenticated
    using (bucket_id = 'memories' and public.can_read_memory_object(name));
  create policy "delete owned memory files" on storage.objects
    for delete to authenticated
    using (bucket_id = 'memories' and public.can_manage_memory_object(name));
`);
await db.exec(boundary);

await denied('old client photo metadata INSERT is denied', () => asUser(db, bob,
  `insert into public.photos(adventure_id,storage_path,user_id) values (8,$1,$2)`, [`${bob}/8/new.jpg`,bob]));
await denied('old client photo metadata UPDATE is denied', () => asUser(db, bob,
  `update public.photos set adventure_id=8 where id=$1`, [photo.id]));
await denied('old client memory object INSERT is denied', () => asUser(db, bob,
  `insert into storage.objects(bucket_id,name) values ('memories',$1)`, [`${bob}/8/new.jpg`]));
assert.equal((await asUser(db, bob,
  `update storage.objects set name=$1 where name=$2 returning id`,
  [`${bob}/7/moved.jpg`,`${bob}/7/legacy.jpg`])).rows.length, 0);
console.log('PASS: old client memory object UPDATE changes no row');

assert.equal((await asUser(db, bob, 'select count(*)::int n from public.photos where id=$1', [photo.id])).rows[0].n, 1);
assert.equal((await asUser(db, bob, 'select count(*)::int n from storage.objects where name=$1', [`${bob}/7/legacy.jpg`])).rows[0].n, 1);
console.log('PASS: owner can still read a historical object until administrative removal');
await asUser(db, bob, 'insert into public.group_photos(group_id,photo_id,shared_by_id) values ($1,$2,$3)',
  [group.group_id,photo.id,bob]);
assert.equal((await asUser(db, alice, 'select count(*)::int n from public.photos where id=$1', [photo.id])).rows[0].n, 1);
console.log('PASS: existing legacy photo projection remains readable to a group member');
await asUser(db, bob, 'delete from storage.objects where name=$1', [`${bob}/7/legacy.jpg`]);
await asUser(db, bob, 'delete from public.photos where id=$1', [photo.id]);
console.log('PASS: owner can delete historical object and metadata before the cloud-original cleanup completes');
await db.exec(boundary);
console.log('PASS: migration replay preserves the device-local boundary');

const guarded = await setup();
await guarded.exec(`create policy "unexpected legacy uploader" on storage.objects
  for insert to authenticated with check (bucket_id='memories')`);
await assert.rejects(guarded.exec(boundary), /reviewed final storage[.]objects policies must be installed/);
console.log('PASS: missing or unexpected final Storage policy set aborts the candidate migration');

console.log('device-local server boundary: 9 policy checks passed');
