import assert from 'node:assert/strict';
import { readFile } from 'node:fs/promises';
import { PGlite } from '@electric-sql/pglite';

const db = new PGlite();
const u = [1,2,3,4].map(n=>`${n}`.repeat(8)+'-1111-4111-8111-'+`${n}`.repeat(12));
let checks=0;
const pass = label=>console.log(`PASS ${++checks}: ${label}`);
async function user(id, sql, params=[]) {
  await db.exec(`set role authenticated; set "request.jwt.claim.sub"='${id}'`);
  try { return await db.query(sql,params); }
  finally { await db.exec('reset role; reset "request.jwt.claim.sub"'); }
}
async function row(id){return (await db.query('select * from public.recommendations where id=$1',[id])).rows[0];}
try {
  await db.exec(`create role anon nologin; create role authenticated nologin;
    create schema auth; create table auth.users(id uuid primary key);
    create function auth.uid() returns uuid language sql stable as $$
      select nullif(current_setting('request.jwt.claim.sub',true),'')::uuid $$;
    grant usage on schema public,auth to authenticated;
    create publication supabase_realtime;`);
  for(const id of u)await db.query('insert into auth.users values($1)',[id]);
  const source=async name=>readFile(new URL(`../supabase/${name}`,import.meta.url),'utf8');
  await db.exec(await source('schema-recommendations.sql'));
  await db.exec('grant select,insert,update,delete on all tables in schema public to authenticated');
  await db.exec(await source('schema-community-hardening.sql'));
  await db.exec(`create table public.wayfinder_schema_migrations(
    migration_key text primary key,applied_at timestamptz not null default now());
    revoke all on public.wayfinder_schema_migrations from anon,authenticated;`);
  const legacy=(await user(u[0],`insert into public.recommendations
    (created_by,title,place,country) values($1,'Old visible post','The reserve','AU') returning id`,[u[0]])).rows[0].id;
  const migration=await source('schema-community-premoderation.sql');
  await db.exec(migration);
  assert.equal((await row(legacy)).moderation_status,'pending');
  assert.equal((await row(legacy)).hidden,true);
  assert.equal((await user(u[1],'select id from public.recommendations where id=$1',[legacy])).rows.length,0);
  assert.equal((await user(u[0],'select id from public.recommendations where id=$1',[legacy])).rows.length,1);
  pass('legacy content held once and visible only to author');

  const fresh=(await user(u[0],`insert into public.recommendations
    (created_by,title,place,country) values($1,'New post pending review','The reserve','AU') returning id`,[u[0]])).rows[0].id;
  assert.equal((await row(fresh)).hidden,true);
  assert.equal((await row(fresh)).moderation_status,'pending');
  pass('new content always starts pending');
  for(const assignment of [`moderation_status='approved'`,`hidden=false`,
    `approved_at=now()`,`report_count=0`]) {
    await assert.rejects(user(u[0],`update public.recommendations set ${assignment} where id=$1`,[fresh]),
      e=>e.code==='42501');
  }
  pass('author cannot forge status, approval, visibility or reports');
  await db.exec('grant update(hidden,moderation_status),insert(moderation_status) on public.recommendations to authenticated');
  await assert.rejects(user(u[0],`update public.recommendations set hidden=false where id=$1`,[fresh]),
    /Only an operator may change moderation/);
  await assert.rejects(user(u[0],`insert into public.recommendations
    (created_by,title,place,country,moderation_status)
    values($1,'Forged approved post','The reserve','AU','approved')`,[u[0]]),
    /New Community content must begin pending/);
  pass('invoker trigger rejects moderation forgery even after mistaken broad grants');
  await db.exec(migration);
  await assert.rejects(user(u[0],`update public.recommendations set hidden=false where id=$1`,[fresh]),
    e=>e.code==='42501');
  pass('migration replay removes accidental moderation column grants');
  await db.query(`update public.recommendations set moderation_status='approved',hidden=false where id=$1`,[fresh]);
  assert.equal((await user(u[1],'select id from public.recommendations where id=$1',[fresh])).rows.length,1);
  assert((await row(fresh)).approved_at);
  pass('operator approval exposes post to other travellers');
  await db.exec(migration);
  assert.equal((await row(fresh)).moderation_status,'approved');
  assert.equal((await row(fresh)).hidden,false);
  pass('migration replay preserves operator approval');
  await user(u[0],`update public.recommendations set author_name='Edited by author' where id=$1`,[fresh]);
  assert.equal((await row(fresh)).moderation_status,'pending');
  assert.equal((await row(fresh)).hidden,true);
  assert.equal((await user(u[1],'select id from public.recommendations where id=$1',[fresh])).rows.length,0);
  pass('public author edit returns to private operator queue');
  await db.query(`update public.recommendations set moderation_status='approved',hidden=false where id=$1`,[fresh]);
  await user(u[1],`insert into public.recommendation_votes(rec_id,user_id,vote) values($1,$2,1)`,[fresh,u[1]]);
  assert.equal((await row(fresh)).up_votes,1);
  assert.equal((await row(fresh)).moderation_status,'approved');
  pass('vote recount does not requeue approved content');
  for(const reporter of u.slice(1))await user(reporter,
    `insert into public.recommendation_reports(rec_id,user_id,reason) values($1,$2,'Fixture report')`,[fresh,reporter]);
  assert.equal((await row(fresh)).report_count,3);
  assert.equal((await row(fresh)).hidden,true);
  await db.query(`update public.recommendations set moderation_status='pending' where id=$1`,[fresh]);
  await assert.rejects(db.query(`update public.recommendations set moderation_status='approved',hidden=false where id=$1`,[fresh]),
    /separate operator adjudication/);
  await db.query(`update public.recommendations set moderation_status='approved',hidden=true where id=$1`,[fresh]);
  assert.equal((await row(fresh)).hidden,true);
  await db.query(`update public.recommendations set hidden=false where id=$1`,[fresh]);
  assert.equal((await row(fresh)).hidden,false);
  pass('three-report hold needs separate deliberate operator adjudication');
  await user(u[0],`update public.recommendations set description='New words' where id=$1`,[fresh]);
  assert.equal((await row(fresh)).hidden,true);
  assert.equal((await row(fresh)).report_count,3);
  pass('author edit never clears report history or hold');
  console.log(`${checks} Community premoderation PostgreSQL checks passed.`);
} finally { await db.close(); }
