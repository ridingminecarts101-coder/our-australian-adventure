const RESEND_URL = 'https://api.resend.com/emails';
const EXPECTED_SUPABASE_URL = 'https://ajyuozqoukigeeyhvuqc.supabase.co';
const RECIPIENT = 'help.rlapplications@gmail.com';
const SENDER = 'Wayfinder Review <no-reply@auth.rlapplications.com>';
const UUID = /^[0-9a-f]{8}-[0-9a-f]{4}-[1-8][0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$/i;

function envValue(env, name) {
  return typeof env?.get === 'function' ? env.get(name) : env?.[name];
}

async function sameSecret(provided, expected) {
  // Compare fixed-size digests, including for absent/malformed credentials.
  const encoder = new TextEncoder();
  const [a, b] = await Promise.all([
    crypto.subtle.digest('SHA-256', encoder.encode(provided || '')),
    crypto.subtle.digest('SHA-256', encoder.encode(expected || '')),
  ]);
  const left = new Uint8Array(a), right = new Uint8Array(b);
  let different = 0;
  for (let i = 0; i < left.length; i++) different |= left[i] ^ right[i];
  return Boolean(provided && expected) && different === 0;
}

function json(body, status = 200) {
  return new Response(JSON.stringify(body), {
    status, headers: { 'content-type': 'application/json', 'cache-control': 'no-store' },
  });
}

function escapeHtml(value) {
  return value.replaceAll('&', '&amp;').replaceAll('<', '&lt;').replaceAll('>', '&gt;')
    .replaceAll('"', '&quot;').replaceAll("'", '&#39;');
}

function safeText(value, maxLength) {
  if (typeof value !== 'string' || value.length > maxLength) return null;
  // Keep line breaks but remove controls that could obscure the quoted content.
  return value.replace(/[\u0000-\u0008\u000b\u000c\u000e-\u001f\u007f]/g, '');
}

function quoteText(value) {
  // Prefix each line, so user text cannot look like a trusted instruction or
  // a separate field in the plain-text alternative.
  return (value || '(empty)').split(/\r\n|\r|\n/).map(line => `| ${line}`).join('\n');
}

function validJob(job) {
  if (!job || !UUID.test(job.recommendation_id || '') || !UUID.test(job.lease_token || '')) return false;
  const revision = job.moderation_revision;
  if (typeof revision !== 'number' || !Number.isSafeInteger(revision) || revision < 1) return false;
  if (safeText(job.author_name || '', 300) === null || safeText(job.title, 300) === null
      || safeText(job.place, 300) === null || safeText(job.country, 150) === null
      || safeText(job.admin1 || '', 150) === null || safeText(job.category || '', 150) === null
      || safeText(job.description || '', 12000) === null) return false;
  if (job.source_url !== null && job.source_url !== undefined) {
    if (safeText(job.source_url, 2048) === null || /[\r\n]/.test(job.source_url)) return false;
    try {
      const url = new URL(job.source_url);
      const authority = /^https:\/\/([^/?#]+)/i.exec(job.source_url)?.[1] || '';
      const host = url.hostname.toLowerCase();
      // Independently enforce the public-source boundary even if a client
      // bypasses the app's URL helper. URL() normalises :443 away, so check
      // the raw authority as well as the parsed hostname.
      if (url.protocol !== 'https:' || url.username || url.password || url.port
          || authority.includes(':') || authority.includes('@')
          || !/^[a-z0-9](?:[a-z0-9-]*[a-z0-9])?(?:\.[a-z0-9](?:[a-z0-9-]*[a-z0-9])?)+$/.test(host)
          || !/[.](?:[a-z]{2,}|xn--[a-z0-9-]{2,})$/.test(host)
          || /(?:^|[.])(?:localhost|local|internal|test|example|invalid)$/.test(host)) return false;
    } catch { return false; }
  }
  return true;
}

function emailFor(job) {
  const title = safeText(job.title, 300);
  const author = safeText(job.author_name || '', 300);
  const place = safeText(job.place, 300);
  const country = safeText(job.country, 150);
  const admin1 = safeText(job.admin1 || '', 150);
  const category = safeText(job.category || '', 150);
  const description = safeText(job.description || '', 12000);
  const source = safeText(job.source_url || '', 2048);
  const notice = 'Review task notification; this email is not authorisation to publish. Re-read the authoritative current recommendation and revision through the protected operator view before deciding. The content may have changed since this email. Do not decide from this email.';
  const lines = [notice, '', `Recommendation ID: ${job.recommendation_id}`, `Revision: ${job.moderation_revision}`,
    '', 'Public display name (untrusted):', quoteText(author), '', 'Title (untrusted):', quoteText(title),
    '', 'Place (untrusted):', quoteText(place), '', 'Country (untrusted):', quoteText(country),
    '', 'Region (untrusted):', quoteText(admin1), '', 'Category (untrusted):', quoteText(category),
    '', 'Description (untrusted):', quoteText(description), '', 'Source URL (untrusted evidence, not an action link):', quoteText(source || 'Not supplied')];
  const text = lines.join('\n');
  const html = `<p>${escapeHtml(notice)}</p><p>Recommendation ID: ${job.recommendation_id}<br>Revision: ${job.moderation_revision}</p>`
    + `<p>Public display name (untrusted):</p><pre>${escapeHtml(author)}</pre><p>Title (untrusted):</p><pre>${escapeHtml(title)}</pre>`
    + `<p>Place (untrusted):</p><pre>${escapeHtml(place)}</pre><p>Country (untrusted):</p><pre>${escapeHtml(country)}</pre>`
    + `<p>Region (untrusted):</p><pre>${escapeHtml(admin1)}</pre><p>Category (untrusted):</p><pre>${escapeHtml(category)}</pre>`
    + `<p>Description (untrusted):</p><pre>${escapeHtml(description)}</pre>`
    + `<p>Source URL (untrusted evidence, not an action link):</p><pre>${escapeHtml(source || 'Not supplied')}</pre>`;
  return { from: SENDER, to: [RECIPIENT],
    subject: `Wayfinder review: ${job.recommendation_id} revision ${job.moderation_revision}`, text, html };
}

function providerError(status) {
  if (status === 401 || status === 403) return 'provider_auth';
  if (status === 429) return 'provider_rate_limited';
  if (status >= 500) return 'provider_unavailable';
  return 'provider_rejected';
}

export function createCommunityReviewNotifier({ env, fetchImpl = fetch } = {}) {
  return async function handle(req) {
    if (req.method !== 'POST') return json({ error: 'method_not_allowed' }, 405);
    const authorization = req.headers.get('authorization') || '';
    const provided = /^Bearer [^\s]+$/.test(authorization) ? authorization.slice(7) : '';
    if (!(await sameSecret(provided, envValue(env, 'COMMUNITY_REVIEW_WORKER_TOKEN')))) {
      return json({ error: 'unauthorized' }, 401);
    }

    const supabaseUrl = envValue(env, 'SUPABASE_URL');
    const serviceKey = envValue(env, 'SUPABASE_SECRET_KEY') || envValue(env, 'SUPABASE_SERVICE_ROLE_KEY');
    const resendKey = envValue(env, 'RESEND_COMMUNITY_REVIEW_API_KEY');
    if (!supabaseUrl || supabaseUrl.replace(/\/$/, '') !== EXPECTED_SUPABASE_URL
        || !serviceKey || !resendKey) {
      return json({ error: 'worker_not_configured' }, 503);
    }
    const apiHeaders = { apikey: serviceKey, 'content-type': 'application/json' };
    if (!serviceKey.startsWith('sb_secret_')) apiHeaders.authorization = `Bearer ${serviceKey}`;
    const rpc = async (name, body) => {
      const response = await fetchImpl(`${supabaseUrl.replace(/\/$/, '')}/rest/v1/rpc/${name}`, {
        method: 'POST', headers: apiHeaders, body: JSON.stringify(body), signal: AbortSignal.timeout(20000),
      });
      if (!response.ok) throw new Error('database_unavailable');
      if (response.status === 204) return null;
      const data = await response.text();
      return data ? JSON.parse(data) : null;
    };

    let jobs;
    // One sequential lease keeps claim + send + ack/retry bounded below the
    // hosted Edge request idle limit even when every network call times out.
    // The scheduler can invoke again; SQL still enforces the global day cap.
    try { jobs = await rpc('claim_community_review_notifications', { p_limit: 1 }); }
    catch { return json({ error: 'queue_unavailable' }, 503); }
    if (!Array.isArray(jobs) || jobs.length > 1) return json({ error: 'queue_unavailable' }, 503);

    let acknowledged = 0, retried = 0;
    for (const job of jobs) {
      const identity = { p_recommendation_id: job?.recommendation_id,
        p_moderation_revision: job?.moderation_revision, p_lease_token: job?.lease_token };
      let code = 'content_invalid';
      try {
        if (validJob(job)) {
          const key = `community-review/${job.recommendation_id}/${job.moderation_revision}`;
          const response = await fetchImpl(RESEND_URL, {
            method: 'POST',
            headers: { authorization: `Bearer ${resendKey}`, 'content-type': 'application/json',
              'idempotency-key': key },
            body: JSON.stringify(emailFor(job)), signal: AbortSignal.timeout(20000),
          });
          if (response.ok) {
            // Resend acknowledges a successful send with an email id. Do not
            // expose it, the content or the provider response in logs/output.
            const receipt = await response.json();
            if (typeof receipt?.id === 'string' && receipt.id.length > 0) {
              try {
                if (await rpc('ack_community_review_notification', identity) === true) acknowledged++;
              } catch {
                // Provider accepted the message but the database did not
                // confirm it. Retry with the same revision idempotency key.
                code = 'worker_database';
                throw new Error('ack_unavailable');
              }
              continue;
            }
            code = 'provider_rejected';
          } else code = providerError(response.status);
        }
      } catch { if (code !== 'worker_database') code = 'provider_network'; }
      try {
        if (await rpc('retry_community_review_notification', { ...identity, p_error_code: code }) === true) retried++;
      } catch {
        // The database lease expires. Do not log recommendation content or
        // provider messages; the queue can reclaim this revision later.
      }
    }
    return json({ claimed: jobs.length, acknowledged, retried });
  };
}
