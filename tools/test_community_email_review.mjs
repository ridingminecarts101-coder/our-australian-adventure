// Real PostgreSQL engine tests with disposable in-memory Auth users only.
import assert from 'node:assert/strict';
import { readFile } from 'node:fs/promises';
import { randomUUID } from 'node:crypto';
import { PGlite } from '@electric-sql/pglite';

const db=new PGlite();
const users=[1,2,3,4].map(n=>`${n}`.repeat(8)+'-1111-4111-8111-'+`${n}`.repeat(12));
let passed=0;
const pass=s=>console.log(`PASS ${++passed}: ${s}`);
async function asRole(role,sql,params=[],uid=null){
  await db.exec(`set role ${role}; set "request.jwt.claim.sub"='${uid||''}'`);
  try{return await db.query(sql,params);}
  finally{await db.exec('reset role; reset "request.jwt.claim.sub"');}
}
async function user(uid,sql,params=[]){return asRole('authenticated',sql,params,uid);}
async function worker(sql,params=[]){return asRole('service_role',sql,params);}
async function rec(id){return (await db.query('select * from public.recommendations where id=$1',[id])).rows[0];}
async function outbox(id){return (await db.query('select * from public.community_review_outbox where recommendation_id=$1 order by moderation_revision',[id])).rows;}
async function submit(uid,title='Walk the reserve'){return (await user(uid,`insert into public.recommendations
  (created_by,author_name,title,place,country,description,moderation_consent_version,moderation_consent_nonce)
  values($1,'QA public name',$2,'QA reserve','AU','A temporary in-memory test',
    'community-ai-2026-09-15',$3) returning id`,[uid,title,randomUUID()])).rows[0].id;}
const migration=()=>readFile(new URL('../supabase/schema-community-email-review.sql',import.meta.url),'utf8');

try{
  await db.exec(`create role anon nologin; create role authenticated nologin;
    create role service_role nologin; create role supabase_admin nologin;
    create schema auth; create table auth.users(id uuid primary key);
    create function auth.uid() returns uuid language sql stable as $$
      select nullif(current_setting('request.jwt.claim.sub',true),'')::uuid $$;
    grant usage on schema public,auth to authenticated,service_role;
    create publication supabase_realtime;`);
  for(const id of users)await db.query('insert into auth.users values($1)',[id]);
  const source=async name=>readFile(new URL(`../supabase/${name}`,import.meta.url),'utf8');
  await db.exec(await source('schema-recommendations.sql'));
  await db.exec('grant select,insert,update,delete on all tables in schema public to authenticated');
  await db.exec(await source('schema-community-hardening.sql'));
  await db.exec(`create table public.wayfinder_schema_migrations(
    migration_key text primary key,applied_at timestamptz not null default now());
    revoke all on public.wayfinder_schema_migrations from anon,authenticated;
    create function public.has_verified_email_account() returns boolean
      language sql stable as $$ select auth.uid() is not null $$;`);
  await db.exec(await source('schema-community-premoderation.sql'));
  const legacy=(await user(users[0],`insert into public.recommendations
    (created_by,title,place,country) values($1,'Legacy no consent','QA reserve','AU') returning id`,[users[0]])).rows[0].id;
  const sql=await migration();
  await db.exec(sql);
  assert.equal((await rec(legacy)).moderation_revision,0);
  assert.equal((await rec(legacy)).hidden,true);
  assert.equal((await outbox(legacy)).length,0);
  pass('legacy no-consent content held without mail queue');
  await assert.rejects(user(users[0],`insert into public.recommendations
    (created_by,title,place,country) values($1,'Old client post','QA reserve','AU')`,[users[0]]),
    /Confirm Community email\/AI review/);
  await assert.rejects(user(users[0],`update public.recommendations
    set title='Old client revised' where id=$1`,[legacy]),
    /Confirm Community email\/AI review for each edit/);
  assert.equal((await outbox(legacy)).length,0);
  pass('old clients cannot submit or edit without fresh consent');

  const first=await submit(users[0]);
  assert.equal((await rec(first)).moderation_revision,1);
  assert.equal((await rec(first)).moderation_status,'pending');
  assert.equal((await outbox(first)).length,1);
  const columns=(await db.query(`select column_name from information_schema.columns
    where table_schema='public' and table_name='community_review_outbox'`)).rows.map(r=>r.column_name);
  assert(!columns.some(c=>/email|owner|description|author_name|title|place|source_url/i.test(c)));
  pass('consented post queues metadata-only current revision');
  await assert.rejects(user(users[0],`update public.recommendations
    set moderation_status='approved' where id=$1`,[first]),e=>e.code==='42501');
  await db.exec('grant update(hidden,moderation_status) on public.recommendations to authenticated');
  await assert.rejects(user(users[0],`update public.recommendations
    set hidden=false where id=$1`,[first]),/Only an operator may change/);
  await db.exec(sql);
  pass('forged publication fails even after a mistaken broad grant, replay repairs ACL');

  await assert.rejects(user(users[0],`select * from public.claim_community_review_notifications(1)`),
    e=>e.code==='42501');
  await assert.rejects(asRole('anon',`select * from public.claim_community_review_notifications(1)`),
    e=>e.code==='42501');
  const claimed=(await worker('select * from public.claim_community_review_notifications(1)')).rows;
  assert.equal(claimed.length,1);
  assert.equal(claimed[0].recommendation_id,first);
  assert.equal(claimed[0].moderation_revision,1);
  assert.equal(claimed[0].author_name,'QA public name');
  assert.equal(claimed[0].attempt_count,1);
  assert(!Object.keys(claimed[0]).some(k=>/email|owner|created_by/i.test(k)));
  pass('service role alone claims lease/content, excluding private identity');
  assert.equal((await worker(`select public.ack_community_review_notification($1,1,$2) as ok`,
    [first,randomUUID()])).rows[0].ok,false);
  assert.equal((await worker(`select public.ack_community_review_notification($1,1,$2) as ok`,
    [first,claimed[0].lease_token])).rows[0].ok,true);
  assert.equal((await outbox(first))[0].state,'sent');
  pass('ack is idempotent and lease-token bound');

  await assert.rejects(user(users[0],`update public.recommendations
    set title='Edited without new nonce' where id=$1`,[first]),
    /Confirm Community email\/AI review for each edit/);
  const nonce=randomUUID();
  await user(users[0],`update public.recommendations set title='Edited with new consent',
    moderation_consent_version='community-ai-2026-09-15',
    moderation_consent_nonce=$2 where id=$1`,[first,nonce]);
  assert.equal((await rec(first)).moderation_revision,2);
  assert.equal((await outbox(first))[1].state,'pending');
  assert.equal((await outbox(first))[0].state,'sent');
  pass('fresh nonce edit creates new revision without duplicate customer text');
  await assert.rejects(db.query(`select public.review_community_recommendation($1,1,'approve','Old email review')`,[first]),
    /stale or already decided/);
  await assert.rejects(user(users[0],`select public.review_community_recommendation($1,2,'approve','Forged')`,[first]),
    e=>e.code==='42501');
  await assert.rejects(worker(`select public.review_community_recommendation($1,2,'approve','Forged')`,[first]),
    e=>e.code==='42501');
  pass('stale email and client/worker decisions cannot publish');
  assert.equal((await db.query(`select public.review_community_recommendation($1,2,'approve',$2) as result`,
    [first,'Reviewed public name and reserve listing against source evidence'])).rows[0].result,'approved');
  assert.equal((await rec(first)).hidden,false);
  assert.equal((await user(users[1],`select id from public.recommendations where id=$1`,[first])).rows.length,1);
  assert.equal((await db.query(`select count(*)::int as n from public.community_review_decisions
    where recommendation_id=$1`,[first])).rows[0].n,1);
  await assert.rejects(db.query(`select public.review_community_recommendation($1,2,'approve','Replay')`,[first]),
    /stale or already decided/);
  pass('protected operator approval is current, public and auditable once');

  const denied=await submit(users[1],'Survey the reedbeds');
  assert.equal((await db.query(`select public.review_community_recommendation($1,1,'reject',$2) as result`,
    [denied,'The activity description needs a current source.'])).rows[0].result,'rejected');
  assert.equal((await rec(denied)).hidden,true);
  assert.equal((await rec(denied)).moderation_reason,'The activity description needs a current source.');
  assert.equal((await user(users[1],`select moderation_reason from public.recommendations where id=$1`,[denied])).rows.length,1);
  assert.equal((await user(users[2],`select id from public.recommendations where id=$1`,[denied])).rows.length,0);
  pass('denial remains private and reason is visible only to author');

  const held=await submit(users[2],'Reported reserve walk');
  for(const reporter of [users[0],users[1],users[3]])
    await user(reporter,`insert into public.recommendation_reports(rec_id,user_id,reason)
      values($1,$2,'Needs operator review')`,[held,reporter]);
  assert.equal((await rec(held)).report_count,3);
  assert.equal((await rec(held)).hidden,true);
  await assert.rejects(db.query(`select public.review_community_recommendation($1,1,'approve','Evidence checked')`,[held]),
    /reported Community post cannot be approved/);
  await assert.rejects(user(users[2],`update public.recommendations set hidden=false where id=$1`,[held]),
    e=>e.code==='42501');
  const heldNonce=randomUUID();
  await user(users[2],`update public.recommendations set title='Corrected reported walk',
    moderation_consent_nonce=$2 where id=$1`,[held,heldNonce]);
  assert.equal((await rec(held)).report_count,3);
  assert.equal((await rec(held)).hidden,true);
  await assert.rejects(db.query(`select public.review_community_recommendation($1,2,'approve','Evidence checked')`,[held]),
    /reported Community post cannot be approved/);
  pass('three reports hold approval; author re-edit cannot erase the report hold');

  for(const url of ['http://parks.gov.au/visit','https://localhost/visit',
    'https://127.0.0.1/visit','https://host.internal/visit',
    'https://parks.gov.au:8443/visit','https://parks.gov.au:443/visit',
    'https://user@parks.gov.au/visit','https://a-.com/visit',
    'https://-a.com/visit','https://a..com/visit','https://example.xn--a-/visit'])
    assert.equal((await db.query(`select public.is_public_community_source_url($1) as ok`,[url])).rows[0].ok,false,url);
  for(const url of ['https://parks.gov.au/visit','https://xn--bcher-kva.de/guide',
    'https://example.xn--p1ai/guide'])
    assert.equal((await db.query(`select public.is_public_community_source_url($1) as ok`,[url])).rows[0].ok,true,url);
  await assert.rejects(user(users[3],`insert into public.recommendations
    (created_by,title,place,country,source_url,moderation_consent_version,moderation_consent_nonce)
    values($1,'Invalid URL','QA reserve','AU','https://localhost/a','community-ai-2026-09-15',$2)`,
    [users[3],randomUUID()]),/recommendations_source_url_check/);
  pass('public HTTPS IDN/punycode sources pass; private hosts, malformed labels, credentials and ports fail');

  const deletion=await submit(users[3],'Ephemeral review');
  assert.equal((await outbox(deletion)).length,1);
  await user(users[3],`delete from public.recommendations where id=$1`,[deletion]);
  assert.equal((await outbox(deletion)).length,0);
  assert.equal((await db.query(`select count(*)::int as n from public.community_review_rate_events
    where owner_id=$1`,[users[3]])).rows[0].n,1);
  pass('post deletion cascades queued notification but does not reset author rate budget');

  await assert.rejects(worker(`select public.retry_community_review_notification($1,1,$2,null)`,
    [held,randomUUID()]),/coarse reviewed notifier error code/);
  const lease=(await worker(`select * from public.claim_community_review_notifications(10)`)).rows
    .find(r=>r.recommendation_id===held && r.moderation_revision===2);
  assert(lease);
  assert.equal((await worker(`select public.retry_community_review_notification($1,2,$2,'provider_network') as ok`,
    [held,randomUUID()])).rows[0].ok,false);
  assert.equal((await worker(`select public.retry_community_review_notification($1,2,$2,'provider_network') as ok`,
    [held,lease.lease_token])).rows[0].ok,true);
  assert.equal((await outbox(held)).find(r=>r.moderation_revision===2).state,'pending');
  pass('retry validates coarse code and lease, then schedules bounded retry');

  const raceNonce=randomUUID();
  await user(users[1],`update public.recommendations set title='Revised after denial',
    moderation_consent_nonce=$2 where id=$1`,[denied,raceNonce]);
  const raceLease=(await worker(`select * from public.claim_community_review_notifications(10)`)).rows
    .find(r=>r.recommendation_id===denied && r.moderation_revision===2);
  assert(raceLease);
  await user(users[1],`update public.recommendations set title='Revised again while leased',
    moderation_consent_nonce=$2 where id=$1`,[denied,randomUUID()]);
  assert.equal((await rec(denied)).moderation_revision,3);
  assert.equal((await outbox(denied)).find(r=>r.moderation_revision===2).state,'superseded');
  assert.equal((await worker(`select public.ack_community_review_notification($1,2,$2) as ok`,
    [denied,raceLease.lease_token])).rows[0].ok,false);
  assert.equal((await worker(`select public.retry_community_review_notification($1,2,$2,'provider_network') as ok`,
    [denied,raceLease.lease_token])).rows[0].ok,false);
  pass('edit during mail lease supersedes old revision; stale acknowledgement/retry cannot succeed');

  const day=(await db.query(`select (now() at time zone 'UTC')::date as day`)).rows[0].day;
  await db.query(`insert into public.community_review_mail_daily(utc_day,claim_count) values($1,49)
    on conflict(utc_day) do update set claim_count=49`,[day]);
  const capped=(await worker(`select * from public.claim_community_review_notifications(10)`)).rows;
  assert(capped.length<=1);
  assert.equal((await db.query(`select claim_count from public.community_review_mail_daily
    where utc_day=$1`,[day])).rows[0].claim_count,50);
  assert.equal((await worker(`select * from public.claim_community_review_notifications(10)`)).rows.length,0);
  pass('global community mail claims stop at fifty per UTC day');

  const beforeReplay=(await db.query(`select count(*)::int as n from public.community_review_decisions`)).rows[0].n;
  await db.exec(sql);
  assert.equal((await rec(first)).moderation_status,'approved');
  assert.equal((await rec(denied)).moderation_status,'pending');
  assert.equal((await rec(denied)).moderation_revision,3);
  assert.equal((await db.query(`select count(*)::int as n from public.community_review_decisions`)).rows[0].n,beforeReplay);
  assert.equal((await outbox(first)).filter(r=>r.state==='sent').length,1);
  pass('migration replay preserves approvals, current revisions, decision audit and sent leases');

  const quotaA=await submit(users[3],'Quota walk A');
  const quotaB=await submit(users[3],'Quota walk B');
  assert.equal((await db.query(`select count(*)::int as n from public.community_review_rate_events
    where owner_id=$1`,[users[3]])).rows[0].n,3);
  await assert.rejects(submit(users[3],'Quota walk C'),/3 per hour/);
  assert.equal((await db.query(`select count(*)::int as n from public.recommendations
    where created_by=$1`,[users[3]])).rows[0].n,2);
  await db.query(`update public.community_review_rate_events
    set submitted_at=clock_timestamp()-interval '2 hours' where owner_id=$1`,[users[3]]);
  for(let i=0;i<17;i++)await db.query(`insert into public.community_review_rate_events(owner_id,submitted_at)
    values($1,clock_timestamp()-interval '2 hours')`,[users[3]]);
  assert.equal((await db.query(`select count(*)::int as n from public.community_review_rate_events
    where owner_id=$1`,[users[3]])).rows[0].n,20);
  await assert.rejects(submit(users[3],'Daily quota'),/20 per day/);
  await user(users[3],`delete from public.recommendations where id in ($1,$2)`,[quotaA,quotaB]);
  await assert.rejects(submit(users[3],'Deletion resets quota'),/20 per day/);
  pass('three per hour and twenty per day limits reject atomically; post deletion does not reset either');

  const remaining=await db.query(`select count(*)::int as n from public.community_review_outbox
    where recommendation_id=$1`,[held]);
  assert.equal(remaining.rows[0].n,2);
  await db.query('delete from auth.users where id=$1',[users[2]]);
  assert.equal((await outbox(held)).length,0);
  assert.equal((await db.query(`select count(*)::int as n from public.community_review_rate_events
    where owner_id=$1`,[users[2]])).rows[0].n,0);
  assert.equal((await db.query(`select count(*)::int as n from public.community_review_decisions
    where recommendation_id=$1`,[held])).rows[0].n,0);
  pass('Auth deletion cascades owned posts, notification metadata and rate events');

  console.log(`${passed} email-review PostgreSQL checks passed.`);
}finally{await db.close();}
