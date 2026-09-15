// Real PostgreSQL-WASM execution; no network, account or production service.
import { PGlite } from '@electric-sql/pglite';
import { readFile } from 'node:fs/promises';

const db = new PGlite();
const alice = '11111111-1111-4111-8111-111111111111';
const bob = '22222222-2222-4222-8222-222222222222';
const charlie = '33333333-3333-4333-8333-333333333333';
const dave = '44444444-4444-4444-8444-444444444444';
const eve = '55555555-5555-4555-8555-555555555555';

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
insert into auth.users(id) values
 ('${alice}'),('${bob}'),('${charlie}'),('${dave}'),('${eve}');
`);

const ownership = await readFile(new URL('../supabase/schema-personal-ownership.sql', import.meta.url), 'utf8');
const administration = await readFile(new URL('../supabase/schema-group-administration.sql', import.meta.url), 'utf8');
await db.exec(ownership);

// Historical empty group: retained for review, but made permanently inert.
const orphan = (await db.query(`insert into public.groups(name,join_code,created_by)
  values ('Historical empty','OLD123',null) returning id`)).rows[0].id;
const adopted = (await db.query(`insert into public.groups(name,join_code,created_by)
  values ('Historical successor','OLD456',null) returning id`)).rows[0].id;
await db.query(`insert into public.group_members(group_id,user_id,display_name)
  values ($1,$2,'Bob'),($1,$3,'Charlie')`, [adopted,bob,charlie]);
await db.query(`insert into public.progress(adventure_id,user_id,completed,memory)
  values (3,$1,true,'Charlie personal history')`, [charlie]);
await db.exec(administration);

async function asUser(id, sql, params = []) {
  await db.exec(`set role authenticated; set "request.jwt.claim.sub" = '${id}'`);
  try { return await db.query(sql, params); }
  finally { await db.exec('reset role; reset "request.jwt.claim.sub"'); }
}
async function asRole(role, sql, params = []) {
  await db.exec(`set role ${role}`);
  try { return await db.query(sql, params); }
  finally { await db.exec('reset role'); }
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

equal('historical empty group is retained',
  (await db.query('select count(*)::int n from public.groups where id=$1', [orphan])).rows[0].n, 1);
equal('historical empty group invite is disabled',
  (await db.query('select invite_enabled from public.groups where id=$1', [orphan])).rows[0].invite_enabled, false);
await rejected('historical orphan invite cannot be used', () =>
  asUser(bob, `select * from public.join_group_by_code('OLD123','Bob')`));
const adoptedRow = (await asUser(bob,
  'select owner_id,invite_enabled from public.groups where id=$1',[adopted])).rows[0];
equal('historical group with members adopts a deterministic surviving member', adoptedRow.owner_id, bob);
equal('historical successor must deliberately issue a new invite', adoptedRow.invite_enabled, false);
equal('historical adoption preserves another member personal history',
  (await asUser(charlie, 'select count(*)::int n from public.progress where adventure_id=3')).rows[0].n, 1);

const made = await asUser(alice, `select * from public.create_group('Administrated group','Alice')`);
const group = made.rows[0].group_id, firstCode = made.rows[0].join_code;
equal('new invite has 32 uppercase hex characters', /^[A-F0-9]{32}$/.test(firstCode), true);
equal('creator is the current owner',
  (await asUser(alice, 'select owner_id from public.groups where id=$1', [group])).rows[0].owner_id, alice);
await asUser(bob, 'select * from public.join_group_by_code($1,$2)', [firstCode, 'Bob']);
equal('outsider cannot discover group owner or invite code',
  (await asUser(charlie, 'select count(*)::int n from public.groups where id=$1', [group])).rows[0].n, 0);
equal('outsider cannot enumerate group membership',
  (await asUser(charlie, 'select count(*)::int n from public.group_members where group_id=$1', [group])).rows[0].n, 0);
equal('member can read the enabled invite by documented design',
  (await asUser(bob, 'select join_code from public.groups where id=$1', [group])).rows[0].join_code, firstCode);
await rejected('authenticated client cannot insert a group directly', () =>
  asUser(alice, `insert into public.groups(name,join_code,created_by,owner_id)
    values ('Direct','AAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAA',$1,$1)`, [alice]));
await rejected('authenticated client cannot add a membership directly', () =>
  asUser(alice, 'insert into public.group_members(group_id,user_id,display_name) values ($1,$2,$3)',
    [group,charlie,'Charlie']));
await rejected('anonymous caller cannot create a group', () =>
  asRole('anon', `select * from public.create_group('Anonymous','Anonymous')`));
await rejected('anonymous caller cannot join with a valid invite', () =>
  asRole('anon', 'select * from public.join_group_by_code($1,$2)', [firstCode,'Anonymous']));
equal('new administration functions expose no anonymous execute privilege',
  (await db.query(`select count(*)::int n from pg_proc p
    join pg_namespace n on n.oid=p.pronamespace
   where n.nspname='public'
     and p.proname in ('rotate_group_invite','revoke_group_invite','remove_group_member',
       'transfer_group_ownership','delete_group','new_group_join_code')
     and has_function_privilege('anon',p.oid,'EXECUTE')`)).rows[0].n, 0);
equal('all security-definer administration functions pin their search path',
  (await db.query(`select count(*)::int n from pg_proc p
    join pg_namespace n on n.oid=p.pronamespace
   where n.nspname='public'
     and p.proname in ('create_group','join_group_by_code','leave_group','rotate_group_invite',
       'revoke_group_invite','remove_group_member','transfer_group_ownership','delete_group',
       'stabilize_group_after_member_delete')
     and (not p.prosecdef or not coalesce(p.proconfig,'{}'::text[]) @> array['search_path=pg_catalog, public'])`)).rows[0].n, 0);
await rejected('owner cannot bypass RPCs with a direct group update', () =>
  asUser(alice, 'update public.groups set invite_enabled=false where id=$1', [group]));
await rejected('invite generator is not exposed to authenticated clients', () =>
  asUser(alice, 'select public.new_group_join_code()'));
await rejected('ownership cannot transfer to a non-member', () =>
  asUser(alice, 'select public.transfer_group_ownership($1,$2)', [group, charlie]));

for (const [label, sql, params] of [
  ['non-owner cannot rotate invite', 'select public.rotate_group_invite($1)', [group]],
  ['non-owner cannot revoke invite', 'select public.revoke_group_invite($1)', [group]],
  ['non-owner cannot remove a member', 'select public.remove_group_member($1,$2)', [group, alice]],
  ['non-owner cannot transfer ownership', 'select public.transfer_group_ownership($1,$2)', [group, bob]],
  ['non-owner cannot delete group', 'select public.delete_group($1)', [group]],
]) await rejected(label, () => asUser(bob, sql, params));

const serializedDefinitions = (await db.query(`select string_agg(pg_get_functiondef(p.oid),' ') body
  from pg_proc p join pg_namespace n on n.oid=p.pronamespace
 where n.nspname='public' and p.proname in ('remove_group_member','transfer_group_ownership')`)).rows[0].body;
equal('member removal and ownership transfer serialize on the group row',
  (serializedDefinitions.match(/for update/gi) || []).length, 2);

await asUser(alice, 'select public.revoke_group_invite($1)', [group]);
const revokedCode = (await asUser(alice, 'select join_code from public.groups where id=$1', [group])).rows[0].join_code;
equal('revoking rotates away from the distributed code', revokedCode === firstCode, false);
await rejected('revoked invite rejects the old code', () =>
  asUser(charlie, 'select * from public.join_group_by_code($1,$2)', [firstCode, 'Charlie']));
await rejected('revoked invite rejects its undistributed replacement code', () =>
  asUser(charlie, 'select * from public.join_group_by_code($1,$2)', [revokedCode, 'Charlie']));

const rotated = (await asUser(alice, 'select public.rotate_group_invite($1) code', [group])).rows[0].code;
equal('rotation creates a different secure invite', /^[A-F0-9]{32}$/.test(rotated) && rotated !== revokedCode, true);
await rejected('rotation leaves the previous code invalid', () =>
  asUser(charlie, 'select * from public.join_group_by_code($1,$2)', [firstCode, 'Charlie']));
await asUser(charlie, 'select * from public.join_group_by_code($1,$2)', [rotated, 'Charlie']);
pass('rotated invite joins only its caller');

await asUser(bob, `insert into public.progress(adventure_id,user_id,completed,completed_at,memory)
  values (42,$1,true,now(),'Bob private memory')`, [bob]);
await asUser(bob, 'select public.set_group_completion_sharing($1,true)', [group]);
const bobProgress = (await asUser(bob, 'select id from public.progress where adventure_id=42')).rows[0].id;
const bobPhoto = (await asUser(bob, `insert into public.photos(adventure_id,storage_path,user_id)
  values (42,$1,$2) returning id`, [`${bob}/42/photo.jpg`, bob])).rows[0].id;
const bobTrip = (await asUser(bob, 'insert into public.trips(user_id) values ($1) returning id', [bob])).rows[0].id;
await asUser(bob, 'insert into public.group_photos(group_id,photo_id,shared_by_id) values ($1,$2,$3)', [group,bobPhoto,bob]);
await asUser(bob, 'insert into public.group_trips(group_id,trip_id,shared_by_id) values ($1,$2,$3)', [group,bobTrip,bob]);

await asUser(alice, 'select public.remove_group_member($1,$2)', [group,bob]);
equal('removed member loses membership',
  (await db.query('select count(*)::int n from public.group_members where group_id=$1 and user_id=$2',[group,bob])).rows[0].n, 0);
equal('member removal clears completion projection',
  (await db.query('select count(*)::int n from public.group_progress where group_id=$1 and shared_by_id=$2',[group,bob])).rows[0].n, 0);
equal('member removal clears photo and trip projections',
  (await db.query(`select (select count(*) from public.group_photos where group_id=$1 and shared_by_id=$2)
    +(select count(*) from public.group_trips where group_id=$1 and shared_by_id=$2) n`,[group,bob])).rows[0].n, 0);
equal('removed member keeps personal progress',
  (await asUser(bob, 'select count(*)::int n from public.progress where id=$1',[bobProgress])).rows[0].n, 1);
equal('removed member keeps personal photo',
  (await asUser(bob, 'select count(*)::int n from public.photos where id=$1',[bobPhoto])).rows[0].n, 1);
equal('removed member keeps personal trip',
  (await asUser(bob, 'select count(*)::int n from public.trips where id=$1',[bobTrip])).rows[0].n, 1);

await asUser(alice, 'select public.transfer_group_ownership($1,$2)', [group,charlie]);
equal('ownership transfers to an existing member',
  (await asUser(charlie, 'select owner_id from public.groups where id=$1',[group])).rows[0].owner_id, charlie);
await rejected('former owner immediately loses administration', () =>
  asUser(alice, 'select public.revoke_group_invite($1)', [group]));
await rejected('current owner must transfer before leaving a multi-member group', () =>
  asUser(charlie, 'select public.leave_group($1)', [group]));
await asUser(alice, 'select public.leave_group($1)', [group]);
equal('former owner can leave without losing personal rows',
  (await db.query('select count(*)::int n from public.group_members where group_id=$1 and user_id=$2',[group,alice])).rows[0].n, 0);

await asUser(charlie, `insert into public.progress(adventure_id,user_id,completed,memory)
  values (77,$1,true,'Charlie private memory')`, [charlie]);
await asUser(charlie, 'select public.delete_group($1)', [group]);
equal('owner can dispose of the group',
  (await db.query('select count(*)::int n from public.groups where id=$1',[group])).rows[0].n, 0);
equal('group disposal keeps owner personal progress',
  (await asUser(charlie, 'select count(*)::int n from public.progress where adventure_id=77')).rows[0].n, 1);

const solo = await asUser(bob, `select * from public.create_group('Solo disposable','Bob')`);
const soloGroup = solo.rows[0].group_id;
await asUser(bob, 'select public.leave_group($1)', [soloGroup]);
equal('last member leaving disposes future empty group',
  (await db.query('select count(*)::int n from public.groups where id=$1',[soloGroup])).rows[0].n, 0);

const succession = await asUser(dave, `select * from public.create_group('Succession','Dave')`);
const successionGroup = succession.rows[0].group_id;
await asUser(bob, 'select * from public.join_group_by_code($1,$2)', [succession.rows[0].join_code,'Bob']);
await db.query('delete from auth.users where id=$1',[dave]);
const inherited = (await db.query('select owner_id,invite_enabled from public.groups where id=$1',[successionGroup])).rows[0];
equal('account deletion promotes a surviving member', inherited.owner_id, bob);
equal('automatic succession pauses invitations', inherited.invite_enabled, false);

const accountDisposable = await asUser(eve, `select * from public.create_group('Account disposal','Eve')`);
await db.query('delete from auth.users where id=$1',[eve]);
equal('deleting a sole owner account disposes of its empty group',
  (await db.query('select count(*)::int n from public.groups where id=$1',[accountDisposable.rows[0].group_id])).rows[0].n, 0);

await db.exec(administration);
equal('migration replay preserves the current invite and owner',
  (await db.query('select owner_id from public.groups where id=$1',[successionGroup])).rows[0].owner_id, bob);

console.log(`\n${passed} PostgreSQL group-administration checks passed.`);
