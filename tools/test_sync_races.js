'use strict';

// Exercises the real client sync functions with deferred network responses.
// No account, browser, database or filesystem state is created outside this process.
const assert = require('assert');
const fs = require('fs');
const vm = require('vm');

function deferred() {
  let resolve, reject;
  const promise = new Promise((ok, no) => { resolve = ok; reject = no; });
  return { promise, resolve, reject };
}

function harness() {
  const values = new Map();
  const elements = new Map();
  const element = key => {
    if (!elements.has(key)) {
      const classes = new Set();
      elements.set(key, {
        className: '', textContent: '', disabled: false, autocomplete: '',
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
    location: { hostname: 'localhost', origin: 'http://localhost', pathname: '/', search: '' },
    history: { replaceState() {} }, URL, URLSearchParams,
    navigator: { onLine: true, userAgent: '', platform: '', maxTouchPoints: 0 },
    localStorage: {
      getItem: key => values.has(key) ? values.get(key) : null,
      setItem: (key, value) => values.set(key, String(value)),
      removeItem: key => values.delete(key), clear: () => values.clear(),
    },
    document: { querySelector: element, querySelectorAll: () => [], createElement: () => element('created') },
    addEventListener() {}, confirm: () => true, prompt: () => null,
    fetch: async () => ({ ok: true, json: async () => [] }),
    Notification: { permission: 'denied' },
    OAA_CONFIG: { revenueCat: {} },
  };
  context.window = context;
  context.Capacitor = { isNativePlatform: () => false, getPlatform: () => 'web', Plugins: {} };
  vm.createContext(context);
  vm.runInContext(fs.readFileSync('store.js', 'utf8'), context, { filename: 'store.js' });
  vm.runInContext(fs.readFileSync('app.js', 'utf8'), context, { filename: 'app.js' });
  vm.runInContext(`renderAll=()=>{}; renderPhotoStatus=()=>{}; renderTrips=()=>{};
    refreshSyncBar=()=>{}; saveLocalTrips=()=>{}; toast=()=>{};`, context);
  return { context, values, elements };
}

async function turns(n = 3) {
  while (n--) await new Promise(resolve => setImmediate(resolve));
}

async function main() {
  const h = harness();
  const run = code => vm.runInContext(code, h.context);
  const ownerA = 'aaaaaaaa-aaaa-4aaa-8aaa-aaaaaaaaaaaa';
  const ownerB = 'bbbbbbbb-bbbb-4bbb-8bbb-bbbbbbbbbbbb';

  // A newer edit for the same row must survive acknowledgement of the older request.
  const first = deferred(), second = deferred();
  let progressCalls = 0;
  h.context.mockSb = { from: () => ({ upsert: () => (++progressCalls === 1 ? first.promise : second.promise) }) };
  run(`userId='${ownerA}'; authGeneration=1; online=true;
    sb=mockSb; writeLS(LS.outbox,[{adventure_id:7,owner_id:userId,updated_at:'same',queue_rev:'old',completed:true}])`);
  const flushing = run('flushOutbox()');
  await turns(1);
  run(`writeLS(LS.outbox,[{adventure_id:7,owner_id:userId,updated_at:'same',queue_rev:'new',completed:false}]); flushOutbox()`);
  first.resolve({ error: null });
  await turns();
  assert.equal(JSON.parse(h.values.get('oaa.outbox.v1'))[0].queue_rev, 'new');
  for (let i = 0; i < 20 && progressCalls < 2; i++) await turns(1);
  assert.equal(progressCalls, 2, 'new edit should schedule a second flush');
  second.resolve({ error: null });
  await flushing; await turns(5);
  assert.deepEqual(JSON.parse(h.values.get('oaa.outbox.v1')), []);

  // An old account response cannot rewrite the replacement account's queue.
  const stale = deferred();
  progressCalls = 0;
  h.context.mockSb = { from: () => ({ upsert: () => stale.promise }) };
  run(`flushOutbox.busy=false; flushOutbox.requested=false; userId='${ownerA}'; authGeneration=3;
    sb=mockSb; writeLS(LS.outbox,[{adventure_id:8,owner_id:userId,updated_at:'a',queue_rev:'a',completed:true}])`);
  const staleFlush = run('flushOutbox()');
  await turns(1);
  run(`userId='${ownerB}'; authGeneration=4;
    writeLS(LS.outbox,[{adventure_id:9,owner_id:userId,updated_at:'b',queue_rev:'b',completed:true}])`);
  stale.resolve({ error: null });
  await staleFlush;
  assert.equal(JSON.parse(h.values.get('oaa.outbox.v1'))[0].owner_id, ownerB);

  // Trip acknowledgements use the same exact-version rule.
  const tripOld = deferred(), tripNew = deferred();
  let tripCalls = 0;
  h.context.mockSb = { from: () => ({ upsert: () => (++tripCalls === 1 ? tripOld.promise : tripNew.promise) }) };
  run(`flushTrips.busy=false; flushTrips.requested=false; userId='${ownerA}'; authGeneration=6; sb=mockSb;
    writeLS(LS.tripOutbox,[{id:'trip-1',owner_id:userId,updated_at:'same',queue_rev:'old',name:'Old'}])`);
  const tripFlushing = run('flushTrips()');
  await turns(1);
  run(`writeLS(LS.tripOutbox,[{id:'trip-1',owner_id:userId,updated_at:'same',queue_rev:'new',name:'New'}]); flushTrips()`);
  tripOld.resolve({ error: null });
  for (let i = 0; i < 20 && tripCalls < 2; i++) await turns(1);
  assert.equal(JSON.parse(h.values.get('oaa.tripoutbox.v1'))[0].queue_rev, 'new');
  tripNew.resolve({ error: null });
  await tripFlushing; await turns(5);
  assert.deepEqual(JSON.parse(h.values.get('oaa.tripoutbox.v1')), []);

  // A photo upload response from account A cannot create metadata or mutate
  // account B's UI after the auth generation changes.
  const photoUpload = deferred();
  let photoInserts = 0;
  h.context.mockSb = {
    storage: { from: () => ({ upload: () => photoUpload.promise }) },
    from: () => ({ insert: () => { photoInserts++; return { select() { return this; }, single: async () => ({ data: {}, error: null }) }; } }),
  };
  run(`flushPhotoQueue.busy=false; flushPhotoQueue.requested=false; userId='${ownerA}'; authGeneration=8; sb=mockSb;
    pendingPhotos=[{id:'photo-1',adventure_id:4,owner_id:userId,blob:{},taken_at:'now'}]`);
  const photoFlushing = run('flushPhotoQueue()');
  await turns(1);
  run(`userId='${ownerB}'; authGeneration=9`);
  photoUpload.resolve({ error: null });
  await photoFlushing;
  assert.equal(photoInserts, 0);
  assert.equal(run('pendingPhotos.length'), 1);

  // A late pull is discarded after account change.
  const pull = deferred();
  h.context.mockSb = { from: () => ({ select() { return this; }, eq() { return this; },
    order() { return this; }, range: () => pull.promise }) };
  run(`userId='${ownerA}'; authGeneration=10; progressView='personal'; activeGroupId=null;
    sb=mockSb; progress=new Map([[99,{adventure_id:99,memory:'current B state'}]])`);
  const pulling = run('pullProgress()');
  await turns(1);
  run(`userId='${ownerB}'; authGeneration=11`);
  pull.resolve({ data: [{ adventure_id: 1, memory: 'late A state' }], error: null });
  await pulling;
  assert.equal(run('progress.has(99)'), true);
  assert.equal(run('progress.has(1)'), false);

  // Group refresh overlays unsynced personal edits on the canonical personal cache.
  const own = deferred();
  h.context.mockSb = {
    rpc: () => ({ order() { return this; }, range: async () => ({ data: [], error: null }) }),
    from: () => ({ select() { return this; }, eq() { return this; },
      order() { return this; }, range: () => own.promise }),
  };
  run(`userId='${ownerA}'; authGeneration=20; progressView='group'; activeGroupId='group-1';
    sb=mockSb; writeLS(LS.outbox,[{adventure_id:5,owner_id:userId,updated_at:'newer',queue_rev:'pending',memory:'pending'}])`);
  const groupPull = run('pullProgress()');
  await turns(1);
  own.resolve({ data: [{ adventure_id: 5, updated_at: 'older', memory: 'server' }], error: null });
  await groupPull;
  assert.equal(run('personalProgress.get(5).memory'), 'pending');

  // Progress and the completion feed page past Supabase's default limit. A
  // canonical personal row wins over a later legacy group-owned duplicate.
  const personalRows = Array.from({ length: 1200 }, (_, i) => ({
    id: `p-${String(i + 1).padStart(4, '0')}`, adventure_id: i + 1,
    group_id: null, memory: i === 4 ? 'canonical' : null,
  }));
  personalRows.push({ id: 'z-legacy', adventure_id: 5, group_id: 'legacy-group', memory: 'legacy' });
  h.context.personalRows = personalRows;
  h.context.mockSb = { from: () => ({ select() { return this; }, eq() { return this; },
    order() { return this; }, range: (from, to) => Promise.resolve({
      data: personalRows.slice(from, to + 1), error: null,
    }) }) };
  run('sb=mockSb');
  const allPersonal = await run(`fetchAllPersonalProgress('${ownerA}')`);
  assert.equal(allPersonal.data.length, 1201);
  h.context.rowsForCanonical = allPersonal.data;
  assert.equal(run(`canonicalPersonalProgress(rowsForCanonical).get(5).memory`), 'canonical');

  const groupRows = Array.from({ length: 1001 }, (_, i) => ({
    adventure_id: i + 1, completed_by_id: ownerA,
  }));
  h.context.mockSb = { rpc: () => ({ order() { return this; }, range: (from, to) => Promise.resolve({
    data: groupRows.slice(from, to + 1), error: null,
  }) }) };
  run('sb=mockSb');
  const allGroup = await run(`fetchAllGroupCompletions('group-1')`);
  assert.equal(allGroup.data.length, 1001);

  // Cross-tab sign-out hides the private app synchronously, before slow cleanup.
  const cleanup = deferred();
  run(`idbClear=()=>cleanupPromise; sb={removeAllChannels:async()=>{}};
    Billing.signOut=async()=>{}; userId='${ownerA}'; authGeneration=30;
    document.querySelector('#app').classList.remove('hidden');`);
  h.context.cleanupPromise = cleanup.promise;
  const signingOut = run('handleSignedOut()');
  assert.equal(h.elements.get('#app').classList.contains('hidden'), true);
  assert.equal(run('userId'), null);
  cleanup.resolve();
  await signingOut;

  // Deletion paginates independently of the currently loaded photo view and
  // recursively includes orphaned objects below the account prefix.
  const photoRows = Array.from({ length: 1205 }, (_, i) => ({ storage_path: `legacy/${i}.jpg` }));
  h.context.mockSb = {
    from: () => ({ select() { return this; }, eq() { return this; },
      range: (from, to) => Promise.resolve({ data: photoRows.slice(from, to + 1), error: null }) }),
    storage: { from: () => ({ list: async prefix => ({
      data: prefix === ownerA
        ? [{ id: null, name: '4', metadata: null }]
        : prefix === `${ownerA}/4`
          ? [{ id: 'object-id', name: 'orphan.jpg', metadata: { size: 1 } }]
          : [], error: null,
    }) }) },
  };
  run(`sb=mockSb`);
  const deletionPaths = await run(`allOwnedPhotoPaths('${ownerA}')`);
  assert.equal(deletionPaths.length, 1206);
  assert.equal(deletionPaths.includes(`${ownerA}/4/orphan.jpg`), true);

  // Storage failure aborts before the auth user RPC, because Supabase cannot
  // delete an auth user that still owns Storage objects.
  let deleteRpcCalls = 0;
  h.context.prompt = () => 'DELETE';
  h.context.mockSb = {
    from: () => ({ select() { return this; }, eq() { return this; },
      range: async () => ({ data: [{ storage_path: 'legacy/photo.jpg' }], error: null }) }),
    storage: { from: () => ({
      list: async () => ({ data: [], error: null }),
      remove: async () => ({ error: new Error('storage unavailable') }),
    }) },
    rpc: async () => { deleteRpcCalls++; return { error: null }; },
  };
  run(`sb=mockSb; userId='${ownerA}'; authGeneration=40; online=true; accountDeletionInProgress=false`);
  await run('deleteAccount()');
  assert.equal(deleteRpcCalls, 0);
  assert.equal(run('accountDeletionInProgress'), false);

  console.log('  sync races: newer edits, account switches, pulls and cross-tab sign-out passed');
}

main().catch(error => { console.error(error); process.exit(1); });
