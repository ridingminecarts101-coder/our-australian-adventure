'use strict';

// Exercises real startup and authentication failures with isolated fixtures.
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
  vm.runInContext('toast=()=>{}; renderAll=()=>{}; ', context);
  return { context, values, elements, run: code => vm.runInContext(code, context) };
}


async function main() {
  const h = harness(), run = h.run;
  const el = key => h.elements.get(key);
  run("writeLS(LS.progress,[{adventure_id:7,memory:'keep'}]); writeLS(LS.outbox,[{adventure_id:7,queue_rev:'keep'}]);");
  const original = new Map(h.values);
  const preserve = () => { for (const [k,v] of original) assert.equal(h.values.get(k),v,k+' preserved'); };
  const visibleFailure = () => {
    assert(!el('#lock').classList.contains('hidden'));
    assert(el('#app').classList.contains('hidden'));
    assert.equal(el('#lockBtn').textContent,'Try again');
    assert.equal(el('#lockBtn').disabled,false);
    assert.match(el('#lockMsg').textContent,/saved progress has not been removed/);
    preserve();
  };
  h.context.fetch = async () => { throw new Error('offline'); };
  await run('boot()'); visibleFailure();
  let reloaded = false; h.context.location.reload = () => { reloaded=true; };
  el('#lockForm').onsubmit({preventDefault(){}}); assert(reloaded);

  // Bad network payloads cannot replace a usable offline catalogue.
  const cached = [{id:7,title:'Existing adventure'}];
  h.context.cached = cached; run('writeLS(LS.adv,cached)');
  for (const invalid of [null, {}, [], [{id:'bad',title:'bad'}]]) {
    h.context.fetch = async () => ({ok:true,json:async()=>invalid});
    await run('loadAdventures()');
    assert.deepEqual(JSON.parse(run('JSON.stringify(ADV)')),cached);
    assert.deepEqual(JSON.parse(h.values.get('oaa.adventures.v1') || run('JSON.stringify(readLS(LS.adv))')),cached);
  }

  h.context.OAA_CONFIG.supabaseUrl='https://example.test';
  h.context.OAA_CONFIG.supabaseAnonKey='test-key';
  h.context.supabase = {createClient(){throw new Error('client unavailable');}};
  await run('boot()'); visibleFailure();
  run('loadAdventures=async()=>{}; loadLocalProgress=()=>{}; buildFilterOptions=()=>{}; wireUI=()=>{};');
  h.context.mockAuth = {onAuthStateChange(){},getSession:async()=>{throw new Error('storage unavailable');}};
  h.context.supabase = {createClient:()=>({auth:h.context.mockAuth})};
  await run('boot()'); visibleFailure();
  await run('enterApp()'); visibleFailure();
  h.context.mockAuth.getSession = async()=>({data:{session:null},error:null});
  await run('boot()');
  assert(!el('#lock').classList.contains('hidden'));
  assert.equal(el('#lockBtn').textContent,'Sign in');

  h.context.mockAuth.signInWithPassword=async()=>{throw new Error('offline');};
  assert.equal(await run("trySignIn('test@example.test','password')"),false);
  assert.equal(el('#lockBtn').disabled,false);
  assert.match(el('#lockMsg').textContent,/try again/);
  h.context.mockAuth.signInWithPassword=async()=>({error:null});
  assert.equal(await run("trySignIn('test@example.test','password')"),true);
  h.context.mockAuth.signUp=async()=>{throw new Error('offline');};
  await run("createAccount('test@example.test','password')");
  assert.equal(el('#createAccountBtn').disabled,false);
  assert.match(el('#lockMsg').textContent,/try again/);
  h.context.mockAuth.resetPasswordForEmail=async()=>{throw new Error('offline');};
  await run("sendPasswordReset('test@example.test')");
  assert.match(el('#lockMsg').textContent,/try again/);
  run('sb=null');
  await run("sendPasswordReset('test@example.test')");
  assert.match(el('#lockMsg').textContent,/reach the server/);

  run("sb={auth:mockAuth}; userId='aaaaaaaa-aaaa-4aaa-8aaa-aaaaaaaaaaaa'; accountUser={id:userId,is_anonymous:true}; accountIsAnonymous=true;");
  h.context.mockAuth.updateUser=async()=>{throw new Error('offline');};
  assert.equal(await run("startAnonymousUpgrade('test@example.test')"),false);
  assert.equal(run('accountUpgradeBusy'),false);
  assert.equal(run('readAccountUpgrade()'),null);
  run("accountUser={id:userId,email:'test@example.test',email_confirmed_at:'now'}; accountIsAnonymous=false; writeAccountUpgrade(userId,'set-password');");
  assert.equal(await run("finishAnonymousUpgrade('password')"),false);
  assert.equal(run('accountUpgradeBusy'),false);
  assert.equal(run('readAccountUpgrade().stage'),'set-password');
  preserve();
  console.log('startup/auth failures: visible recovery, catalogue fallback, retries and saved data passed');
}
main().catch(error=>{console.error(error);process.exit(1);});
