// PostgreSQL-WASM test for verified email gating; no network or live accounts.
import assert from 'node:assert/strict';
import { readFile } from 'node:fs/promises';
import { PGlite } from '@electric-sql/pglite';

const db = new PGlite();
const verified = '11111111-1111-4111-8111-111111111111';
const anonymous = '22222222-2222-4222-8222-222222222222';
const unverified = '33333333-3333-4333-8333-333333333333';
const converted = '44444444-4444-4444-8444-444444444444';
let passed = 0;
const pass = label => console.log(`PASS ${++passed}: ${label}`);

await db.exec(`
create role anon nologin;
create role authenticated nologin;
create schema auth;
create table auth.users (
  id uuid primary key, email text, email_confirmed_at timestamptz,
  is_anonymous boolean not null default false
);
create function auth.uid() returns uuid language sql stable as $$
  select nullif(current_setting('request.jwt.claim.sub', true),'')::uuid
$$;
create function auth.jwt() returns jsonb language sql stable as $$
  select coalesce(nullif(current_setting('request.jwt.claims', true),''),'{}')::jsonb
$$;
grant usage on schema public, auth to authenticated;
insert into auth.users values
 ('${verified}','verified@example.test',now(),false),
 ('${anonymous}',null,null,true),
 ('${unverified}','waiting@example.test',null,false),
 ('${converted}','converted@example.test',now(),false);

create table public.groups (
 id uuid primary key default gen_random_uuid(), name text not null,
 join_code text not null unique, created_by uuid references auth.users(id),
 owner_id uuid references auth.users(id), invite_enabled boolean not null default true
);
create table public.group_members (
 group_id uuid references public.groups(id) on delete cascade,
 user_id uuid references auth.users(id) on delete cascade,
 display_name text, primary key(group_id,user_id)
);
create function public.create_group(p_name text,p_display_name text)
returns uuid language plpgsql security definer set search_path=pg_catalog,public as $$
declare gid uuid; caller uuid:=auth.uid(); begin
 if caller is null then raise exception 'not signed in'; end if;
 insert into public.groups(name,join_code,created_by,owner_id)
 values(p_name,upper(replace(gen_random_uuid()::text,'-','')),caller,caller) returning id into gid;
 insert into public.group_members values(gid,caller,p_display_name); return gid;
end $$;
create function public.join_group_by_code(p_code text,p_display_name text)
returns uuid language plpgsql security definer set search_path=pg_catalog,public as $$
declare gid uuid; caller uuid:=auth.uid(); begin
 select id into gid from public.groups where join_code=upper(p_code) and invite_enabled;
 if gid is null then raise exception 'invalid invite'; end if;
 insert into public.group_members values(gid,caller,p_display_name); return gid;
end $$;
create function public.leave_group(p_group uuid)
returns void language sql security definer set search_path=pg_catalog,public as $$
 delete from public.group_members where group_id=p_group and user_id=auth.uid()
$$;
grant execute on function public.create_group(text,text), public.join_group_by_code(text,text),
 public.leave_group(uuid) to authenticated;

create table public.recommendations (
 id uuid primary key default gen_random_uuid(), created_by uuid references auth.users(id),
 title text, hidden boolean not null default false
);
create table public.recommendation_votes (
 rec_id uuid references public.recommendations(id) on delete cascade,
 user_id uuid references auth.users(id) on delete cascade, vote smallint,
 primary key(rec_id,user_id)
);
create table public.recommendation_reports (
 rec_id uuid references public.recommendations(id) on delete cascade,
 user_id uuid references auth.users(id) on delete cascade, reason text,
 primary key(rec_id,user_id)
);
create table public.blocked_authors (
 user_id uuid references auth.users(id) on delete cascade,
 blocked_id uuid references auth.users(id) on delete cascade,
 primary key(user_id,blocked_id)
);
create table public.progress (user_id uuid references auth.users(id), adventure_id int, memory text);
alter table public.recommendations enable row level security;
alter table public.recommendation_votes enable row level security;
alter table public.recommendation_reports enable row level security;
alter table public.blocked_authors enable row level security;
alter table public.progress enable row level security;
create policy own_recommendations on public.recommendations for all to authenticated
 using(created_by=auth.uid()) with check(created_by=auth.uid());
create policy own_votes on public.recommendation_votes for all to authenticated
 using(user_id=auth.uid()) with check(user_id=auth.uid());
create policy own_reports on public.recommendation_reports for all to authenticated
 using(user_id=auth.uid()) with check(user_id=auth.uid());
create policy own_blocks on public.blocked_authors for all to authenticated
 using(user_id=auth.uid()) with check(user_id=auth.uid());
create policy own_progress on public.progress for all to authenticated
 using(user_id=auth.uid()) with check(user_id=auth.uid());
grant select,insert,update,delete on public.recommendations,public.recommendation_votes,
 public.recommendation_reports,public.blocked_authors,public.progress to authenticated;
`);

async function asUser(id, anonymousClaim, sql, params=[]) {
  const claims = JSON.stringify({sub:id,is_anonymous:anonymousClaim}).replaceAll("'","''");
  await db.exec(`set role authenticated; set "request.jwt.claim.sub"='${id}'; set "request.jwt.claims"='${claims}'`);
  try { return await db.query(sql,params); }
  finally { await db.exec('reset role; reset "request.jwt.claim.sub"; reset "request.jwt.claims"'); }
}
async function denied(label, action) {
  await assert.rejects(action, error => error.code === '42501'); pass(label);
}

// Seed legacy content before the boundary exists.
const legacyGroup=(await db.query(`insert into public.groups(name,join_code,created_by,owner_id)
 values('Legacy group','LEGACY','${anonymous}','${anonymous}') returning id`)).rows[0].id;
await db.query('insert into public.group_members values($1,$2,$3)',[legacyGroup,anonymous,'Legacy']);
const legacyRec=(await db.query(`insert into public.recommendations(created_by,title)
 values($1,'Legacy recommendation') returning id`,[anonymous])).rows[0].id;
const targetRec=(await db.query(`insert into public.recommendations(created_by,title)
 values($1,'Verified target') returning id`,[verified])).rows[0].id;
await db.query('insert into public.recommendation_votes values($1,$2,1)',[legacyRec,anonymous]);
await db.query('insert into public.recommendation_reports values($1,$2,$3)',[legacyRec,anonymous,'Legacy report']);
await db.query('insert into public.blocked_authors values($1,$2)',[anonymous,verified]);
await db.query('insert into public.progress values($1,7,$2)',[anonymous,'Legacy memory']);

const migration=await readFile(new URL('../supabase/schema-verified-community-access.sql',import.meta.url),'utf8');
await db.exec(migration);

assert.equal((await asUser(verified,false,'select public.has_verified_email_account() ok')).rows[0].ok,true); pass('confirmed permanent email is accepted');
assert.equal((await asUser(anonymous,false,'select public.has_verified_email_account() ok')).rows[0].ok,false); pass('forged permanent JWT claim cannot override anonymous Auth row');
assert.equal((await asUser(unverified,false,'select public.has_verified_email_account() ok')).rows[0].ok,false); pass('permanent but unconfirmed email is rejected');
assert.equal((await asUser(converted,true,'select public.has_verified_email_account() ok')).rows[0].ok,true); pass('authoritative converted Auth row tolerates a stale anonymous access-token claim');

const group=(await asUser(verified,false,`select public.create_group('Verified group','Verified') id`)).rows[0].id;
const code=(await db.query('select join_code from public.groups where id=$1',[group])).rows[0].join_code;
await denied('anonymous Auth user cannot create a group',asUser(anonymous,true,`select public.create_group('Spam','Anon')`));
await denied('unconfirmed email account cannot create a group',asUser(unverified,false,`select public.create_group('Early','Waiting')`));
await denied('anonymous Auth user cannot join a group',asUser(anonymous,true,'select public.join_group_by_code($1,$2)',[code,'Anon']));
await asUser(converted,true,'select public.join_group_by_code($1,$2)',[code,'Converted']); pass('converted verified owner can join even before JWT claim refresh');

for (const [label,sql,params] of [
 ['post',`insert into public.recommendations(created_by,title) values($1,'Blocked')`,[anonymous]],
 ['vote','insert into public.recommendation_votes values($1,$2,1)',[targetRec,anonymous]],
 ['report','insert into public.recommendation_reports values($1,$2,$3)',[targetRec,anonymous,'Blocked'],],
 ['block','insert into public.blocked_authors values($1,$2)',[anonymous,converted]],
]) await denied(`anonymous Auth user cannot ${label}`,asUser(anonymous,true,sql,params));
assert.equal((await asUser(anonymous,true,
 'update public.recommendations set title=$1 where id=$2 returning id',['Changed',legacyRec])).rows.length,0);
assert.equal((await db.query('select title from public.recommendations where id=$1',[legacyRec])).rows[0].title,'Legacy recommendation');
pass('anonymous author cannot change public recommendation text');

const verifiedRec=(await asUser(verified,false,`insert into public.recommendations(created_by,title)
 values($1,'Verified post') returning id`,[verified])).rows[0].id; pass('verified account can post');
await asUser(verified,false,'insert into public.recommendation_votes values($1,$2,1)',[verifiedRec,verified]);
await asUser(verified,false,'insert into public.recommendation_reports values($1,$2,$3)',[verifiedRec,verified,'Review']);
await asUser(verified,false,'insert into public.blocked_authors values($1,$2)',[verified,anonymous]); pass('verified vote, report and block writes remain available');

assert.equal((await asUser(anonymous,true,'select count(*)::int n from public.progress where user_id=$1',[anonymous])).rows[0].n,1); pass('anonymous legacy owner retains personal-data read');
await asUser(anonymous,true,'update public.progress set memory=$1 where user_id=$2',['Preserved',anonymous]); pass('anonymous legacy owner retains personal-data maintenance');
await asUser(anonymous,true,'delete from public.recommendation_votes where rec_id=$1 and user_id=$2',[legacyRec,anonymous]);
await asUser(anonymous,true,'delete from public.recommendation_reports where rec_id=$1 and user_id=$2',[legacyRec,anonymous]);
await asUser(anonymous,true,'delete from public.blocked_authors where user_id=$1 and blocked_id=$2',[anonymous,verified]);
await asUser(anonymous,true,'delete from public.recommendations where id=$1',[legacyRec]); pass('anonymous legacy owner can delete existing Community rows');
await asUser(anonymous,true,'select public.leave_group($1)',[legacyGroup]); pass('anonymous legacy member can leave a group');

await db.exec(migration); pass('migration is replay-safe');
console.log(`\n${passed} verified Community access checks passed.`);
await db.close();
