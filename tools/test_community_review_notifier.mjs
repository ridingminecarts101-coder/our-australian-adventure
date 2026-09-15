import assert from 'node:assert/strict';
import { createCommunityReviewNotifier } from '../supabase/functions/_shared/community-review-notifier.mjs';

const ID = '11111111-1111-4111-8111-111111111111';
const LEASE = '22222222-2222-4222-8222-222222222222';
const JOB = {
  recommendation_id: ID, moderation_revision: 3, lease_token: LEASE,
  author_name: 'Guest <script>alert(1)</script>', title: 'Walk & picnic',
  place: 'Cove', country: 'Australia', admin1: 'NSW', category: 'Walk',
  description: 'A nice walk\n<svg onload="attack()">', source_url: 'https://example.org/evidence?a=1&b=2',
  author_id: 'must-not-leak', author_email: 'must-not-leak@example.org',
};
const env = {
  COMMUNITY_REVIEW_WORKER_TOKEN: 'strong-worker-token',
  SUPABASE_URL: 'https://sample.supabase.co', SUPABASE_SECRET_KEY: 'sb_secret_test',
  RESEND_COMMUNITY_REVIEW_API_KEY: 're_mock',
};
const request = (token = env.COMMUNITY_REVIEW_WORKER_TOKEN, method = 'POST') =>
  new Request('https://localhost/notifier', { method, headers: { authorization: `Bearer ${token}` } });
const answer = (payload, status = 200) => new Response(JSON.stringify(payload), { status });

function harness({ jobs = [JOB], resend = () => answer({ id: 'provider-email-id' }), ack = true, retry = true } = {}) {
  const calls = [];
  const fetchImpl = async (url, options) => {
    const name = String(url).split('/').at(-1);
    calls.push({ url: String(url), options, name });
    if (name === 'claim_community_review_notifications') return answer(jobs);
    if (name === 'ack_community_review_notification') return ack === 'unavailable' ? answer({}, 503) : answer(ack);
    if (name === 'retry_community_review_notification') return answer(retry);
    if (String(url) === 'https://api.resend.com/emails') return resend(url, options);
    throw Error('Unexpected network route');
  };
  return { calls, handle: createCommunityReviewNotifier({ env, fetchImpl }) };
}

{
  const { calls, handle } = harness();
  assert.equal((await handle(request('forged'))).status, 401);
  assert.equal((await handle(request('strong-worker-token', 'GET'))).status, 405);
  assert.equal(calls.length, 0, 'forged/GET calls never claim or send');
  const noToken = new Request('https://localhost/notifier', { method: 'POST' });
  assert.equal((await handle(noToken)).status, 401);
  assert.equal(calls.length, 0);
}

{
  let networkCalls = 0;
  const missingToken = createCommunityReviewNotifier({
    env: { ...env, COMMUNITY_REVIEW_WORKER_TOKEN: '' },
    fetchImpl: async () => { networkCalls++; return answer([]); },
  });
  assert.equal((await missingToken(request())).status, 401);
  assert.equal(networkCalls, 0, 'missing configured token is not an auth bypass');
}

{
  const { calls, handle } = harness();
  assert.deepEqual(await (await handle(request())).json(), { claimed: 1, acknowledged: 1, retried: 0 });
  const send = calls.find(c => c.url === 'https://api.resend.com/emails');
  assert.equal(send.options.headers['idempotency-key'], `community-review/${ID}/3`);
  assert.equal(send.options.headers.authorization, 'Bearer re_mock');
  const body = JSON.parse(send.options.body);
  assert.deepEqual(body.to, ['help.rlapplications@gmail.com']);
  assert.equal(body.from, 'Wayfinder Review <no-reply@auth.rlapplications.com>');
  assert.equal(body.subject, `Wayfinder review: ${ID} revision 3`);
  assert.ok(body.html.includes('&lt;script&gt;'));
  assert.ok(body.html.includes('&lt;svg onload=&quot;attack()&quot;&gt;'));
  assert.ok(body.html.includes('a=1&amp;b=2'));
  assert.ok(!body.html.includes('<a '), 'no action links');
  assert.ok(!body.html.includes('<script>'));
  assert.ok(body.text.includes('protected operator view before deciding'));
  assert.ok(body.text.includes('| A nice walk\n| <svg'), 'plain-text lines are marked untrusted');
  assert.ok(!body.text.includes('must-not-leak'));
  assert.ok(!body.html.includes('must-not-leak'));
  assert.equal(calls.find(c => c.name === 'ack_community_review_notification').options.body,
    JSON.stringify({ p_recommendation_id: ID, p_moderation_revision: 3, p_lease_token: LEASE }));
}

{
  const sends = [];
  const { calls, handle } = harness({ resend: (_url, options) => { sends.push(options); return answer({ id: 'same-provider-id' }); } });
  assert.equal((await (await handle(request())).json()).acknowledged, 1);
  assert.equal((await (await handle(request())).json()).acknowledged, 1);
  assert.equal(sends.length, 2, 'claim retry uses the same frozen revision payload');
  assert.equal(sends[0].headers['idempotency-key'], sends[1].headers['idempotency-key']);
  assert.equal(sends[0].body, sends[1].body);
  assert.equal(calls.filter(c => c.name === 'ack_community_review_notification').length, 2);
}

{
  const { calls, handle } = harness({ resend: () => answer({ error: 'down' }, 503) });
  assert.deepEqual(await (await handle(request())).json(), { claimed: 1, acknowledged: 0, retried: 1 });
  assert.equal(JSON.parse(calls.find(c => c.name === 'retry_community_review_notification').options.body).p_error_code,
    'provider_unavailable');
}

{
  const { calls, handle } = harness({ resend: () => { throw Error('private provider body'); } });
  assert.deepEqual(await (await handle(request())).json(), { claimed: 1, acknowledged: 0, retried: 1 });
  assert.equal(JSON.parse(calls.find(c => c.name === 'retry_community_review_notification').options.body).p_error_code,
    'provider_network');
}

{
  const { calls, handle } = harness({ ack: false, retry: false });
  assert.deepEqual(await (await handle(request())).json(), { claimed: 1, acknowledged: 0, retried: 0 });
  assert.equal(calls.filter(c => c.name === 'retry_community_review_notification').length, 0,
    'stale lease cannot be retried after provider success');
}

{
  const { calls, handle } = harness({ ack: 'unavailable' });
  assert.deepEqual(await (await handle(request())).json(), { claimed: 1, acknowledged: 0, retried: 1 });
  assert.equal(JSON.parse(calls.find(c => c.name === 'retry_community_review_notification').options.body).p_error_code,
    'worker_database');
  assert.equal(calls.filter(c => c.url === 'https://api.resend.com/emails').length, 1);
}

{
  const privateSources = [
    'javascript:attack()', 'https://localhost/', 'https://api.internal/review',
    'https://host.local/', 'https://site.test/', 'https://site.example/',
    'https://127.0.0.1/', 'https://[::1]/', 'https://example.org:8443/',
    'https://example.org:443/', 'https://user:pass@example.org/',
    'https://a-.com/', 'https://-a.com/',
  ];
  for (const source_url of privateSources) {
    const { calls, handle } = harness({ jobs: [{ ...JOB, source_url }] });
    assert.deepEqual(await (await handle(request())).json(), { claimed: 1, acknowledged: 0, retried: 1 }, source_url);
    assert.equal(calls.filter(c => c.url === 'https://api.resend.com/emails').length, 0, source_url);
    assert.equal(JSON.parse(calls.find(c => c.name === 'retry_community_review_notification').options.body).p_error_code,
      'content_invalid', source_url);
  }
}

{
  const { calls, handle } = harness({ jobs: [{ ...JOB, source_url: 'https://example.xn--p1ai/path' }] });
  assert.equal((await (await handle(request())).json()).acknowledged, 1,
    'well-formed public punycode TLD is reviewable');
  assert.equal(calls.filter(c => c.url === 'https://api.resend.com/emails').length, 1);
}

{
  const { calls, handle } = harness({ jobs: [{ ...JOB, description: null, source_url: null }] });
  assert.equal((await (await handle(request())).json()).acknowledged, 1);
  const send = calls.find(c => c.url === 'https://api.resend.com/emails');
  const body = JSON.parse(send.options.body);
  assert.ok(body.text.includes('| (empty)'), 'optional description remains a reviewable empty field');
}

{
  const { calls, handle } = harness({ jobs: [{ ...JOB, source_url: 'https://example.org/\nFake approval: yes' }] });
  assert.equal((await (await handle(request())).json()).retried, 1);
  assert.equal(calls.filter(c => c.url === 'https://api.resend.com/emails').length, 0);
}

{
  const { calls, handle } = harness();
  const badEnv = { ...env, RESEND_COMMUNITY_REVIEW_API_KEY: '' };
  const bad = createCommunityReviewNotifier({ env: badEnv, fetchImpl: async () => { calls.push('unexpected'); } });
  assert.equal((await bad(request())).status, 503);
  assert.equal(calls.length, 0, 'missing provider key fails before claim');
  assert.equal((await handle(request())).status, 200);
}

console.log('Community review notifier mock HTTP: 13 scenarios PASS');
