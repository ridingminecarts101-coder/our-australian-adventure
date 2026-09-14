'use strict';

// Exercises the real anonymous-upgrade state machine with mocked Auth calls.
// It creates no external account and never persists a password.
const assert = require('assert');
const fs = require('fs');
const vm = require('vm');

function deferred() {
  let resolve;
  const promise = new Promise(ok => { resolve = ok; });
  return { promise, resolve };
}

function harness() {
  const values = new Map();
  const elements = new Map();
  const element = key => {
    if (!elements.has(key)) {
      const classes = new Set();
      elements.set(key, {
        innerHTML: '', textContent: '', className: '', required: false, value: '',
        disabled: false, autocomplete: '',
        classList: {
          add: (...xs) => xs.forEach(x => classes.add(x)),
          remove: (...xs) => xs.forEach(x => classes.delete(x)),
          toggle: (x, force) => force ? classes.add(x) : classes.delete(x),
          contains: x => classes.has(x),
        },
        addEventListener() {}, querySelector: () => element('nested'),
      });
    }
    return elements.get(key);
  };
  const context = {
    console: { log() {}, warn() {}, error() {} }, setTimeout, clearTimeout, queueMicrotask,
    crypto: require('crypto').webcrypto,
    location: { hostname: 'localhost', origin: 'http://localhost', pathname: '/', search: '', reload() {} },
    history: { replaceState() {} }, URL, URLSearchParams,
    navigator: { onLine: true, userAgent: '', platform: '', maxTouchPoints: 0 },
    localStorage: {
      getItem: key => values.has(key) ? values.get(key) : null,
      setItem: (key, value) => values.set(key, String(value)),
      removeItem: key => values.delete(key), clear: () => values.clear(),
    },
    document: { querySelector: element, querySelectorAll: () => [], createElement: () => element('created') },
    addEventListener() {}, confirm: () => true, prompt: () => null,
    fetch: async () => ({ ok: true, json: async () => [] }), Notification: { permission: 'denied' },
    OAA_CONFIG: { revenueCat: {}, shareBase: 'https://example.test/wayfinder/' },
  };
  context.window = context;
  context.Capacitor = { isNativePlatform: () => false, getPlatform: () => 'web', Plugins: {} };
  vm.createContext(context);
  vm.runInContext(fs.readFileSync('store.js', 'utf8'), context, { filename: 'store.js' });
  vm.runInContext(fs.readFileSync('app.js', 'utf8'), context, { filename: 'app.js' });
  vm.runInContext('toast=()=>{}; renderAll=()=>{}; enterApp=async()=>true;', context);
  return { context, values, elements, run: code => vm.runInContext(code, context) };
}

async function main() {
  const h = harness(), run = h.run;
  const ownerA = 'aaaaaaaa-aaaa-4aaa-8aaa-aaaaaaaaaaaa';
  const ownerB = 'bbbbbbbb-bbbb-4bbb-8bbb-bbbbbbbbbbbb';
  const anonymous = { id: ownerA, is_anonymous: true, app_metadata: { provider: 'anonymous' } };
  const verified = { id: ownerA, email: 'review@example.test', email_confirmed_at: 'now',
    is_anonymous: false, app_metadata: { provider: 'email' } };
  h.context.anonymous = anonymous;
  h.context.verified = verified;

  const calls = [];
  h.context.mockSb = { auth: { updateUser: async (...args) => {
    calls.push(args); return { data: { user: anonymous }, error: null };
  } } };
  run(`sb=mockSb; userId=anonymous.id; accountUser=anonymous; accountIsAnonymous=true;
    authGeneration=1; writeLS(LS.progress,[{adventure_id:7,memory:'keep'}]);
    writeLS(LS.outbox,[{adventure_id:7,owner_id:userId,queue_rev:'keep'}])`);
  const progressBefore = h.values.get('oaa.progress.v1');
  const outboxBefore = h.values.get('oaa.outbox.v1');

  assert.equal(await run("startAnonymousUpgrade('review@example.test')"), true);
  assert.deepEqual(calls[0][0], { email: 'review@example.test' });
  assert.equal(Object.prototype.hasOwnProperty.call(calls[0][0], 'password'), false);
  assert.equal(calls[0][1].emailRedirectTo, 'https://example.test/wayfinder/');
  const marker = JSON.parse(h.values.get('oaa.account-upgrade.v1'));
  assert.deepEqual(Object.keys(marker).sort(), ['owner_id', 'stage']);
  assert.equal(marker.owner_id, ownerA);
  assert.equal(marker.stage, 'awaiting-email');
  assert(!JSON.stringify(marker).includes('review@example.test'));
  assert.equal(h.values.get('oaa.progress.v1'), progressBefore);
  assert.equal(h.values.get('oaa.outbox.v1'), outboxBefore);

  // The verified link may return in a reload or an auth event. The persisted
  // marker advances only for the same Supabase user ID.
  run('accountUser=verified; accountIsAnonymous=false');
  assert.equal(run('accountUpgradeFor(accountUser).stage'), 'set-password');
  assert.equal(JSON.parse(h.values.get('oaa.account-upgrade.v1')).stage, 'set-password');
  h.values.set('oaa.local-owner.v1', ownerA);
  await run('bindLocalDataToUser()');
  assert.equal(h.values.get('oaa.progress.v1'), progressBefore);
  assert.equal(h.values.get('oaa.outbox.v1'), outboxBefore);
  assert.equal(JSON.parse(h.values.get('oaa.account-upgrade.v1')).stage, 'set-password');

  h.context.mockSb.auth.updateUser = async () => ({ data: null, error: new Error('password rejected') });
  assert.equal(await run("finishAnonymousUpgrade('six-or-more')"), false);
  assert.equal(JSON.parse(h.values.get('oaa.account-upgrade.v1')).stage, 'set-password');
  assert.equal(h.values.get('oaa.outbox.v1'), outboxBefore);

  calls.length = 0;
  h.context.mockSb.auth.updateUser = async (...args) => {
    calls.push(args); return { data: { user: verified }, error: null };
  };
  assert.equal(await run("finishAnonymousUpgrade('six-or-more')"), true);
  assert.deepEqual(calls[0][0], { password: 'six-or-more' });
  assert.equal(Object.prototype.hasOwnProperty.call(calls[0][0], 'email'), false);
  assert.equal(h.values.has('oaa.account-upgrade.v1'), false);
  assert.equal(h.values.get('oaa.progress.v1'), progressBefore);
  assert.equal(h.values.get('oaa.outbox.v1'), outboxBefore);

  // Email-link failure leaves data intact and no half-started marker.
  run(`accountUser=anonymous; accountIsAnonymous=true; userId=anonymous.id;
    authGeneration=2; clearAccountUpgrade()`);
  h.context.mockSb.auth.updateUser = async () => ({ data: null, error: new Error('mailer unavailable') });
  assert.equal(await run("startAnonymousUpgrade('review@example.test')"), false);
  assert.equal(h.values.has('oaa.account-upgrade.v1'), false);
  assert.equal(h.values.get('oaa.outbox.v1'), outboxBefore);

  // A response arriving after an account switch cannot create an upgrade marker.
  const late = deferred();
  h.context.mockSb.auth.updateUser = () => late.promise;
  const starting = run("startAnonymousUpgrade('review@example.test')");
  run(`userId='${ownerB}'; authGeneration=4`);
  late.resolve({ data: { user: anonymous }, error: null });
  assert.equal(await starting, false);
  assert.equal(h.values.has('oaa.account-upgrade.v1'), false);

  // A marker from A is discarded when B becomes the active account.
  run(`writeAccountUpgrade('${ownerA}','awaiting-email')`);
  h.context.other = { id: ownerB, email: 'other@example.test', email_confirmed_at: 'now' };
  assert.equal(run('accountUpgradeFor(other)'), null);
  assert.equal(h.values.has('oaa.account-upgrade.v1'), false);

  // Missing new group schema must not leave a cached group aggregate selected.
  h.context.mockSb = { from: () => ({ select() { return this; },
    eq: async () => ({ data: null, error: new Error('column share_completions does not exist') }) }) };
  run(`sb=mockSb; userId='${ownerA}'; online=true; progressView='group';
    activeGroupId='stale-group'; members=new Map([['someone','Stale member']]);
    personalCacheReady=true; personalProgress=new Map([[5,{adventure_id:5,memory:'mine'}]]);
    progress=new Map([[5,{adventure_id:5,memory:'someone else'}]]);
    localStorage.setItem(LS.group,activeGroupId); localStorage.setItem(LS.view,'group')`);
  await run('loadGroups()');
  assert.equal(run('groupSchemaReady'), false);
  assert.equal(run('activeGroupId'), null);
  assert.equal(run('members.size'), 0);
  assert.equal(run('progressView'), 'personal');
  assert.equal(run('progress.get(5).memory'), 'mine');

  console.log('auth upgrade: sequencing, failures, account switch, local data and schema fallback passed');
}

if (require.main === module) main().catch(error => { console.error(error); process.exit(1); });
module.exports = { harness, deferred };
