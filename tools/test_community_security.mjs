// Real PostgreSQL permissions, RLS and triggers; disposable in-memory users only.
import assert from 'node:assert/strict';
import { readFile } from 'node:fs/promises';
import { PGlite } from '@electric-sql/pglite';

const db = new PGlite();
const users = [1, 2, 3, 4].map(n => `${n}`.repeat(8) + '-1111-4111-8111-' + `${n}`.repeat(12));
let passed = 0;
function pass(label) { console.log(`PASS ${++passed}: ${label}`); }
async function asUser(user, sql, params = []) {
  await db.exec(`set role authenticated; set "request.jwt.claim.sub" = '${user}'`);
  try { return await db.query(sql, params); }
  finally { await db.exec('reset role; reset "request.jwt.claim.sub"'); }
}
async function denied(label, sql, params = [], user = users[0]) {
  await assert.rejects(asUser(user, sql, params), e => e.code === '42501');
  pass(label);
}
async function post(user, title) {
  return (await asUser(user, `insert into public.recommendations
    (created_by,author_name,title,place,country,description)
    values ($1,'Test traveller',$2,'Test reserve','AU','Disposable test record') returning id`,
  [user, title])).rows[0].id;
}
async function row(id) { return (await db.query('select * from public.recommendations where id=$1', [id])).rows[0]; }

try {
  await db.exec(`create role anon nologin; create role authenticated nologin;
    create schema auth; create table auth.users (id uuid primary key);
    create function auth.uid() returns uuid language sql stable as $$
      select nullif(current_setting('request.jwt.claim.sub', true),'')::uuid
    $$;
    grant usage on schema public, auth to authenticated;
    create publication supabase_realtime;`);
  for (const id of users) await db.query('insert into auth.users values ($1)', [id]);
  await db.exec(await readFile(new URL('../supabase/schema-recommendations.sql', import.meta.url), 'utf8'));
  await db.exec('grant select,insert,update,delete on all tables in schema public to authenticated');
  const first = await post(users[0], 'Watch birds along the reserve track');
  await asUser(users[0], 'update public.recommendations set up_votes=999, hidden=true where id=$1', [first]);
  assert.equal((await row(first)).up_votes, 999);
  pass('reproduced original author-controlled aggregate/moderation flaw');

  const migration = await readFile(new URL('../supabase/schema-community-hardening.sql', import.meta.url), 'utf8');
  await db.exec(migration);
  assert.equal((await row(first)).up_votes, 0);
  assert.equal((await row(first)).hidden, true);
  pass('repair recalculates forged totals while preserving moderation holds');

  const second = await post(users[0], 'Explore the second reserve track');
  pass('ordinary client-shaped post creation still works');
  await asUser(users[0], 'update public.recommendations set description=$1 where id=$2', ['Updated personal words', first]);
  assert.equal((await row(first)).description, 'Updated personal words');
  pass('author can edit text on own moderated post');
  for (const [column, value] of [['hidden','false'], ['up_votes','100'], ['report_count','0'],
    ['created_by',`'${users[1]}'`], ['created_at',"'2000-01-01'"]]) {
    await denied(`author cannot update ${column}`, `update public.recommendations set ${column}=${value} where id=$1`, [first]);
  }
  await denied('author cannot supply counters while posting', `insert into public.recommendations
    (created_by,title,place,country,up_votes) values ($1,'A forged recommendation','Reserve','AU',1000)`, [users[0]]);
  await denied('user cannot post under another identity', `insert into public.recommendations
    (created_by,title,place,country) values ($1,'A forged author name','Reserve','AU')`, [users[1]]);
  await assert.rejects(asUser(users[0], `insert into public.recommendations
    (created_by,author_name,title,place,country) values ($1,$2,'Bounded text check','Reserve','AU')`,
    [users[0], 'x'.repeat(81)]), /recommendations_author_name_length/);
  pass('server bounds recommendation author text independently of the form');
  assert.equal((await asUser(users[1], 'update public.recommendations set title=$1 where id=$2 returning id',
    ['Attempted other author edit', second])).rows.length, 0);
  pass('another user cannot edit the author post');

  await asUser(users[1], 'insert into public.recommendation_votes(rec_id,user_id,vote,stars) values ($1,$2,1,4)', [second,users[1]]);
  assert.equal((await row(second)).up_votes, 1);
  assert.equal((await row(second)).stars_sum, 4);
  pass('valid feedback updates totals through the server trigger');
  await asUser(users[2], `insert into public.recommendation_votes(rec_id,user_id,vote,voted_at)
    values ($1,$2,1,'2000-01-01')`, [second,users[2]]);
  assert.notEqual((await db.query('select voted_at from public.recommendation_votes where rec_id=$1 and user_id=$2',
    [second,users[2]])).rows[0].voted_at.getUTCFullYear(), 2000);
  pass('server assigns vote time even when a client supplies one');
  await asUser(users[2], 'delete from public.recommendation_votes where rec_id=$1', [second]);
  await asUser(users[1], 'update public.recommendation_votes set vote=-1,stars=2 where rec_id=$1', [second]);
  assert.equal((await row(second)).up_votes, 0);
  assert.equal((await row(second)).down_votes, 1);
  assert.equal((await row(second)).stars_sum, 2);
  pass('changing a vote preserves accurate aggregate counts');
  await assert.rejects(asUser(users[1], 'update public.recommendation_votes set rec_id=$1 where rec_id=$2',
    [first,second]), /vote identity cannot be changed/);
  pass('a vote cannot be moved to corrupt another post total');
  await assert.rejects(asUser(users[1], `update public.recommendation_votes
    set voted_at='2000-01-01' where rec_id=$1`, [second]), /vote timestamp cannot be changed/);
  pass('a voter cannot forge the server vote timestamp');
  assert.equal((await asUser(users[2], 'select * from public.recommendation_votes')).rows.length, 0);
  pass('individual vote and rating rows remain private');
  await asUser(users[1], 'delete from public.recommendation_votes where rec_id=$1', [second]);
  assert.equal((await row(second)).down_votes, 0);
  assert.equal((await row(second)).stars_count, 0);
  pass('withdrawing feedback clears its aggregate contribution');

  for (const user of users.slice(1)) await asUser(user,
    `insert into public.recommendation_reports(rec_id,user_id,reason,reported_at)
     values ($1,$2,$3,'2000-01-01')`, [second,user,'Test report']);
  assert.notEqual((await db.query('select reported_at from public.recommendation_reports where rec_id=$1 and user_id=$2',
    [second,users[1]])).rows[0].reported_at.getUTCFullYear(), 2000);
  pass('server assigns report time even when a client supplies one');
  assert.equal((await row(second)).hidden, true);
  assert.equal((await row(second)).report_count, 3);
  assert.equal((await asUser(users[1], 'select id from public.recommendations where id=$1', [second])).rows.length, 0);
  pass('three separate reporters hide the post from other readers');
  await asUser(users[1], `update public.recommendation_reports set reason='Updated test reason'
    where rec_id=$1`, [second]);
  pass('a reporter can update only their own report content');
  await assert.rejects(asUser(users[1], `update public.recommendation_reports
    set reported_at='2000-01-01' where rec_id=$1`, [second]), /report timestamp cannot be changed/);
  pass('a reporter cannot forge the server report timestamp');
  await assert.rejects(asUser(users[1], 'update public.recommendation_reports set reason=$1 where rec_id=$2',
    ['x'.repeat(301), second]), /recommendation_reports_reason_length/);
  pass('server bounds report text independently of the prompt');
  await denied('author cannot clear the report-triggered hold', 'update public.recommendations set hidden=false where id=$1', [second]);
  await db.query('delete from auth.users where id=$1', [users[3]]);
  assert.equal((await row(second)).report_count, 2);
  assert.equal((await row(second)).hidden, true);
  pass('deleting a reporter account does not silently lift moderation');
  await db.query('insert into public.recommendation_reports(rec_id,user_id,reason) values ($1,$2,$3)', [first,users[1],'Later report']);
  assert.equal((await row(first)).hidden, true);
  pass('a new report preserves an existing operator hold');
  await db.exec(migration);
  await denied('migration replay preserves field permissions', 'update public.recommendations set hidden=false where id=$1', [first]);
  await asUser(users[0], 'delete from public.recommendations where id=$1', [first]);
  assert.equal(await row(first), undefined);
  pass('author can still delete an own post and its dependent records');
  console.log(`\n${passed} Community permission/RLS/trigger checks passed.`);
} finally { await db.close(); }
