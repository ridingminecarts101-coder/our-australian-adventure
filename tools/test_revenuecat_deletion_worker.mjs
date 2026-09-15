import { strict as assert } from 'node:assert';
import { readFile } from 'node:fs/promises';
import { createDeletionWorker } from '../supabase/functions/_shared/revenuecat-deletion-worker.mjs';

const token = 'worker-token-with-at-least-32-characters';
const env = {
  REVENUECAT_DELETION_WORKER_TOKEN: token,
  SUPABASE_URL: 'https://fixture.supabase.co',
  SUPABASE_SERVICE_ROLE_KEY: 'fixture-service-role-jwt',
  REVENUECAT_SECRET_API_KEY: 'fixture-revenuecat-secret',
  REVENUECAT_PROJECT_ID: 'proj_fixture',
};
const job = {
  job_id: 'aaaaaaaa-aaaa-4aaa-8aaa-aaaaaaaaaaaa',
  app_user_id: '11111111-1111-4111-8111-111111111111',
  claim_token: 'bbbbbbbb-bbbb-4bbb-8bbb-bbbbbbbbbbbb',
  attempt_count: 1,
};

const request = (authorization = `Bearer ${token}`, method = 'POST') =>
  new Request('https://worker.invalid', { method, headers: { authorization } });
const responseJson = (body, status = 200, headers = {}) =>
  new Response(JSON.stringify(body), { status, headers });

{
  let calls = 0;
  const handler = createDeletionWorker({ env, fetchImpl: async () => { calls++; } });
  assert.equal((await handler(request('', 'GET'))).status, 405);
  assert.equal((await handler(request('Bearer wrong'))).status, 401);
  assert.equal(calls, 0, 'unauthorized requests must not reach database or provider');
  const body = await (await handler(request('Bearer wrong'))).text();
  assert(!body.includes(token));
  console.log('PASS: worker method and bearer authentication fail closed');
}

{
  const handler = createDeletionWorker({ env: { REVENUECAT_DELETION_WORKER_TOKEN: token }, fetchImpl: async () => {
    throw new Error('must not fetch');
  }});
  const response = await handler(request());
  assert.equal(response.status, 503);
  assert.deepEqual(await response.json(), { error: 'worker_not_configured' });
  console.log('PASS: missing private configuration is explicit and non-leaking');
}

async function scenario(providerStatus, { providerThrows = false, retryAfter = null } = {}) {
  const calls = [];
  const fetchImpl = async (url, init) => {
    calls.push({ url, init, body: init.body ? JSON.parse(init.body) : null });
    if (url.endsWith('/customers?limit=1')) return responseJson({ object: 'list', items: [] });
    if (url.endsWith('/claim_revenuecat_deletions')) return responseJson([job]);
    if (url.startsWith('https://api.revenuecat.com/v2/projects/proj_fixture/customers/')) {
      assert.equal(init.headers.authorization, 'Bearer fixture-revenuecat-secret');
      assert(!url.includes('fixture-revenuecat-secret'));
      if (providerThrows) throw new Error('fixture network');
      return new Response('', { status: providerStatus, headers: retryAfter ? { 'retry-after': retryAfter } : {} });
    }
    if (url.includes('/rest/v1/rpc/')) return new Response(null, { status: 204 });
    throw new Error(`unexpected URL ${url}`);
  };
  const response = await createDeletionWorker({ env, fetchImpl })(request());
  return { response, result: await response.json(), calls };
}

for (const status of [200, 404]) {
  const { response, result, calls } = await scenario(status);
  assert.equal(response.status, 200);
  assert.deepEqual(result, { claimed: 1, acknowledged: 1, retried: 0 });
  const completion = calls.find(call => call.url.endsWith('/acknowledge_revenuecat_deletion'));
  assert.equal(completion.body.p_http_status, status);
  assert(!JSON.stringify(result).includes(job.app_user_id));
}
console.log('PASS: RevenueCat queued 200 and retry-safe absent 404 are acknowledged without UUID output');

{
  const { result, calls } = await scenario(429, { retryAfter: '600' });
  assert.deepEqual(result, { claimed: 1, acknowledged: 0, retried: 1 });
  const retry = calls.find(call => call.url.endsWith('/retry_revenuecat_deletion'));
  assert.equal(retry.body.p_error_code, 'provider_rate_limited');
  assert.equal(retry.body.p_retry_seconds, 600);
}
{
  const { result, calls } = await scenario(401);
  assert.deepEqual(result, { claimed: 1, acknowledged: 0, retried: 1 });
  assert.equal(calls.find(call => call.url.endsWith('/retry_revenuecat_deletion')).body.p_error_code, 'provider_auth');
}
{
  const { result, calls } = await scenario(0, { providerThrows: true });
  assert.deepEqual(result, { claimed: 1, acknowledged: 0, retried: 1 });
  assert.equal(calls.find(call => call.url.endsWith('/retry_revenuecat_deletion')).body.p_error_code, 'provider_network');
}
console.log('PASS: provider auth, rate-limit and network failures remain visible and retryable');

{
  const calls = [];
  const secretEnv = { ...env, SUPABASE_SECRET_KEY: 'sb_secret_fixture', SUPABASE_SERVICE_ROLE_KEY: undefined };
  const fetchImpl = async (url, init) => {
    calls.push({ url, init });
    if (url.endsWith('/customers?limit=1')) return responseJson({ object: 'list', items: [] });
    if (url.endsWith('/claim_revenuecat_deletions')) return responseJson([]);
    throw new Error('unexpected');
  };
  await createDeletionWorker({ env: secretEnv, fetchImpl })(request());
  const queueCall = calls.find(call => call.url.endsWith('/claim_revenuecat_deletions'));
  assert.equal(queueCall.init.headers.apikey, 'sb_secret_fixture');
  assert.equal(queueCall.init.headers.authorization, undefined,
    'new Supabase secret keys must not be sent as bearer tokens');
}
console.log('PASS: server key headers support legacy service role and new secret-key form');

{
  let databaseCalled = false;
  const fetchImpl = async url => {
    if (url.endsWith('/customers?limit=1')) return responseJson({ object: 'error' }, 404);
    databaseCalled = true;
    throw new Error('queue must not be claimed');
  };
  const response = await createDeletionWorker({ env, fetchImpl })(request());
  assert.equal(response.status, 503);
  assert.deepEqual(await response.json(), { error: 'provider_configuration_invalid' });
  assert.equal(databaseCalled, false);
  console.log('PASS: invalid project/key cannot turn an ambiguous DELETE 404 into completion');
}

{
  const activation = await readFile(new URL('../supabase/activate-revenuecat-deletion-worker.sql', import.meta.url), 'utf8');
  const config = await readFile(new URL('../supabase/config.toml', import.meta.url), 'utf8');
  assert.match(config, /\[functions\.revenuecat-deletion-worker\][\s\S]*verify_jwt\s*=\s*false/);
  assert.match(activation, /wayfinder-revenuecat-deletion-worker[\s\S]*'\*\/5 \* \* \* \*'/);
  assert.match(activation, /vault\.decrypted_secrets[\s\S]*revenuecat_deletion_worker_url/);
  assert.match(activation, /vault\.decrypted_secrets[\s\S]*revenuecat_deletion_worker_token/);
  assert.match(activation, /select decrypted_secret into strict worker_url[\s\S]*name = 'revenuecat_deletion_worker_url'/,
    'missing or duplicate worker URL must abort activation');
  assert.match(activation, /select decrypted_secret into strict worker_token[\s\S]*name = 'revenuecat_deletion_worker_token'/,
    'missing or duplicate worker token must abort activation');
  assert.match(activation,
    /worker_url\s*<>\s*'https:\/\/ajyuozqoukigeeyhvuqc\.supabase\.co\/functions\/v1\/revenuecat-deletion-worker'/,
    'activation must pin the worker URL before sending the bearer token');
  assert.doesNotMatch(activation, /worker_url\s*!~/,
    'a generic HTTPS host check could send the worker token to the wrong host');
  assert.equal((activation.match(/https:\/\/ajyuozqoukigeeyhvuqc\.supabase\.co\/functions\/v1\/revenuecat-deletion-worker/g) || []).length, 2,
    'the reviewed URL must be validated and embedded as the immutable cron target');
  assert.doesNotMatch(activation,
    /url\s*:=\s*\(select decrypted_secret[\s\S]{0,160}revenuecat_deletion_worker_url/,
    'the scheduled request must not follow a later Vault URL change');
  assert(activation.indexOf('invalid RevenueCat deletion worker activation secrets')
      < activation.indexOf('cron.unschedule'),
    'activation must validate all private prerequisites before replacing the schedule');
  assert.doesNotMatch(activation, /sk_[A-Za-z0-9]{8,}/);
  assert.doesNotMatch(activation, /Bearer [A-Za-z0-9_-]{32,}/);
  console.log('PASS: recurring activation reads private values from Vault and embeds no credential');
}

console.log('PASS: RevenueCat deletion worker authentication, completion and retry behavior');
