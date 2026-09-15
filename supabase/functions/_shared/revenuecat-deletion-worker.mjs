const RC_BASE = 'https://api.revenuecat.com/v2/projects/';

function envValue(env, name) {
  return typeof env?.get === 'function' ? env.get(name) : env?.[name];
}

async function sameSecret(provided, expected) {
  if (!provided || !expected) return false;
  const enc = new TextEncoder();
  const [a, b] = await Promise.all([
    crypto.subtle.digest('SHA-256', enc.encode(provided)),
    crypto.subtle.digest('SHA-256', enc.encode(expected)),
  ]);
  const left = new Uint8Array(a), right = new Uint8Array(b);
  let different = left.length ^ right.length;
  for (let i = 0; i < Math.max(left.length, right.length); i++) {
    different |= (left[i % left.length] || 0) ^ (right[i % right.length] || 0);
  }
  return different === 0;
}

function json(body, status = 200) {
  return new Response(JSON.stringify(body), {
    status,
    headers: { 'content-type': 'application/json', 'cache-control': 'no-store' },
  });
}

function retryDelay(attempt, response) {
  const requested = Number.parseInt(response?.headers?.get('retry-after') || '', 10);
  if (Number.isFinite(requested) && requested > 0) return Math.min(Math.max(requested, 60), 86400);
  return Math.min(60 * (2 ** Math.min(Math.max(attempt - 1, 0), 10)), 86400);
}

function errorCode(status) {
  if (status === 401 || status === 403) return 'provider_auth';
  if (status === 429) return 'provider_rate_limited';
  if (status >= 500) return 'provider_unavailable';
  return 'provider_rejected';
}

export function createDeletionWorker({ env, fetchImpl = fetch } = {}) {
  return async function handle(req) {
    if (req.method !== 'POST') return json({ error: 'method_not_allowed' }, 405);

    const expectedToken = envValue(env, 'REVENUECAT_DELETION_WORKER_TOKEN');
    const authorization = req.headers.get('authorization') || '';
    const providedToken = authorization.startsWith('Bearer ') ? authorization.slice(7) : '';
    if (!(await sameSecret(providedToken, expectedToken))) return json({ error: 'unauthorized' }, 401);

    const supabaseUrl = envValue(env, 'SUPABASE_URL');
    const serviceKey = envValue(env, 'SUPABASE_SECRET_KEY')
      || envValue(env, 'SUPABASE_SERVICE_ROLE_KEY');
    const revenueCatKey = envValue(env, 'REVENUECAT_SECRET_API_KEY');
    const revenueCatProject = envValue(env, 'REVENUECAT_PROJECT_ID');
    if (!supabaseUrl || !serviceKey || !revenueCatKey || !revenueCatProject
        || !/^[A-Za-z0-9_-]{1,255}$/.test(revenueCatProject)) {
      return json({ error: 'worker_not_configured' }, 503);
    }

    const apiHeaders = { apikey: serviceKey, 'content-type': 'application/json' };
    // Legacy service-role JWTs require Authorization. New sb_secret keys are
    // intentionally sent only in apikey, per Supabase's server-key guidance.
    if (!serviceKey.startsWith('sb_secret_')) apiHeaders.authorization = `Bearer ${serviceKey}`;

    const revenueCatHeaders = { authorization: `Bearer ${revenueCatKey}`, accept: 'application/json' };
    const revenueCatProjectUrl = `${RC_BASE}${encodeURIComponent(revenueCatProject)}`;

    // Validate the project/key pair before claiming any UUID. A DELETE 404 is
    // only safe to interpret as "customer absent" after this project-scoped
    // request succeeds; otherwise a mistyped project could discard the job.
    try {
      const check = await fetchImpl(`${revenueCatProjectUrl}/customers?limit=1`, {
        method: 'GET', headers: revenueCatHeaders,
      });
      if (!check.ok) return json({ error: 'provider_configuration_invalid' }, 503);
    } catch {
      return json({ error: 'provider_unavailable' }, 503);
    }

    const rpc = async (name, body) => {
      const response = await fetchImpl(`${supabaseUrl}/rest/v1/rpc/${name}`, {
        method: 'POST', headers: apiHeaders, body: JSON.stringify(body),
      });
      if (!response.ok) throw new Error(`database_${response.status}`);
      if (response.status === 204) return null;
      const text = await response.text();
      return text ? JSON.parse(text) : null;
    };

    let jobs;
    try {
      jobs = await rpc('claim_revenuecat_deletions', { p_limit: 10, p_lease_seconds: 300 });
    } catch {
      return json({ error: 'queue_unavailable' }, 503);
    }

    let acknowledged = 0, retried = 0;
    for (const job of Array.isArray(jobs) ? jobs : []) {
      let response = null;
      try {
        response = await fetchImpl(`${revenueCatProjectUrl}/customers/${encodeURIComponent(job.app_user_id)}`, {
          method: 'DELETE',
          headers: revenueCatHeaders,
        });
        if (response.status === 200 || response.status === 404) {
          await rpc('acknowledge_revenuecat_deletion', {
            p_job_id: job.job_id,
            p_claim_token: job.claim_token,
            p_http_status: response.status,
          });
          acknowledged++;
          continue;
        }
        await rpc('retry_revenuecat_deletion', {
          p_job_id: job.job_id,
          p_claim_token: job.claim_token,
          p_error_code: errorCode(response.status),
          p_http_status: response.status,
          p_retry_seconds: retryDelay(job.attempt_count, response),
        });
        retried++;
      } catch {
        try {
          await rpc('retry_revenuecat_deletion', {
            p_job_id: job.job_id,
            p_claim_token: job.claim_token,
            p_error_code: response ? 'worker_database' : 'provider_network',
            p_http_status: response?.status || null,
            p_retry_seconds: retryDelay(job.attempt_count, response),
          });
          retried++;
        } catch {
          // The lease expires and makes this job claimable again. Never expose
          // the customer id or provider response in this endpoint's output.
        }
      }
    }

    return json({ claimed: Array.isArray(jobs) ? jobs.length : 0, acknowledged, retried });
  };
}
