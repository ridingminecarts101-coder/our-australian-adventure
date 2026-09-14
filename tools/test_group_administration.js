'use strict';

// Executes the real group-administration client functions in an isolated VM.
const assert = require('node:assert/strict');
const fs = require('node:fs');
const vm = require('node:vm');

function deferred() {
  let resolve;
  const promise = new Promise(r => { resolve = r; });
  return { promise, resolve };
}

function harness() {
  const values = new Map(), elements = new Map(), notices = [];
  const element = key => {
    if (!elements.has(key)) {
      const classes = new Set();
      elements.set(key, { innerHTML: '', textContent: '', value: '', disabled: false,
        classList: { add: (...xs) => xs.forEach(x => classes.add(x)),
          remove: (...xs) => xs.forEach(x => classes.delete(x)),
          contains: x => classes.has(x), toggle: (x, on) => on ? classes.add(x) : classes.delete(x) },
        addEventListener() {}, setAttribute() {}, querySelector: () => element('nested') });
    }
    return elements.get(key);
  };
  const context = { console: { log() {}, warn() {}, error() {} }, setTimeout, clearTimeout, queueMicrotask,
    crypto: require('node:crypto').webcrypto, URL, URLSearchParams,
    location: { hostname: 'localhost', origin: 'http://localhost', pathname: '/', search: '' },
    navigator: { onLine: true, userAgent: '', platform: '', maxTouchPoints: 0 }, history: { replaceState() {} },
    document: { querySelector: element, querySelectorAll: () => [], createElement: () => element('new') },
    localStorage: { getItem: k => values.get(k) || null, setItem: (k, v) => values.set(k, String(v)), removeItem: k => values.delete(k) },
    addEventListener() {}, confirm: () => true, prompt: () => null, Notification: { permission: 'denied' },
    fetch: async () => { throw new Error('Unexpected network'); }, OAA_CONFIG: { revenueCat: {} },
    CONTINENT_ORDER: ['Oceania'], countryName: c => c, countryFlag: () => '' };
  context.window = context;
  context.Capacitor = { isNativePlatform: () => false, getPlatform: () => 'web', Plugins: {} };
  vm.createContext(context);
  for (const file of ['store.js', 'app.js']) vm.runInContext(fs.readFileSync(file, 'utf8'), context, { filename: file });
  const run = code => vm.runInContext(code, context);
  run("userId='account-a'; accountUser={id:userId}; authGeneration=1; who='Alex'; toast=m=>testNotices.push(m); renderAll=()=>{}; renderMe=()=>{};");
  context.testNotices = notices;
  return { context, run, values, elements, notices };
}

async function turns() { await new Promise(r => setImmediate(r)); }

function uiChecks() {
  const h = harness();
  h.run(`sb={}; activeGroupId='group-1';
    myGroups=[{id:'group-1',name:'Friends',join_code:'0123456789ABCDEF0123456789ABCDEF',owner_id:'account-a',invite_enabled:true,share_completions:true}];
    members=new Map([['account-a','Alex'],['account-b','Blair']]); renderMe_groups();`);
  let html = h.elements.get('#groupPanel').innerHTML;
  assert.match(html, /Send an invite link/);
  assert.match(html, /Rotate invite code/);
  assert.match(html, /data-groupact="transfer-owner" data-member="account-b"/);
  assert.match(html, /data-groupact="remove-member" data-member="account-b"/);
  assert.doesNotMatch(html, />Leave this group</);
  assert.match(html, /Transfer ownership before leaving/);

  h.run("myGroups[0].owner_id='account-b'; renderMe_groups();");
  html = h.elements.get('#groupPanel').innerHTML;
  assert.doesNotMatch(html, /Rotate invite code|Pause invitations|Make owner|data-groupact="remove-member"/);
  assert.match(html, />Leave this group</);

  h.run("myGroups[0].invite_enabled=false; renderMe_groups();");
  html = h.elements.get('#groupPanel').innerHTML;
  assert.match(html, /Invitations are paused/);
  assert.doesNotMatch(html, /Send an invite link|joincode/);

  h.run("myGroups[0].owner_id='account-a'; renderMe_groups();");
  html = h.elements.get('#groupPanel').innerHTML;
  assert.match(html, /Create a new invite/);
  console.log('PASS: group owner, member and paused-invite controls expose only permitted actions');
}

async function operationChecks() {
  {
    const h = harness(), calls = [];
    h.context.rpc = async (name, args) => {
      calls.push([name, args]);
      if (name === 'join_group_by_code') return { data: [{ group_id: 'group-1', group_name: 'Friends' }], error: null };
      return { data: null, error: null };
    };
    h.run("sb={rpc}; loadGroups=async()=>{myGroups=[{id:'group-1',share_completions:false}]}; setProgressView=async()=>{}; pullPhotos=async()=>{}; pullTrips=async()=>{};");
    await h.run("joinGroup('0123456789abcdef0123456789abcdef')");
    assert.equal(calls[0][0], 'join_group_by_code');
    assert.equal(calls[0][1].p_join_code, '0123456789ABCDEF0123456789ABCDEF');
  }
  {
    const h = harness(), calls = [];
    h.context.rpc = async (name, args) => { calls.push([name, args]); return { data: null, error: { message: 'denied' } }; };
    h.run("sb={rpc}; activeGroupId='group-1'; myGroups=[{id:'group-1',name:'Friends',owner_id:'account-a'}]; members=new Map([['account-a','Alex'],['account-b','Blair']]);");
    await h.run("removeGroupMember('group-1','account-b')");
    assert.deepEqual(JSON.parse(JSON.stringify(calls)), [['remove_group_member', { p_group_id: 'group-1', p_user_id: 'account-b' }]]);
    assert.equal(h.run("members.has('account-b')"), true, 'failed server removal must preserve the local member');
    assert.equal(h.run('groupLifecycleBusy'), null, 'failure must release the lifecycle lock');
  }
  {
    const h = harness(), gate = deferred(), calls = [];
    h.context.rpc = (name, args) => { calls.push([name, args]); return gate.promise; };
    h.run("sb={rpc}; activeGroupId='group-1'; myGroups=[{id:'group-1',name:'Friends',owner_id:'account-a'}]; members=new Map([['account-a','Alex'],['account-b','Blair']]);");
    const first = h.run("transferGroupOwnership('group-1','account-b')");
    await turns();
    await h.run("revokeGroupInvite('group-1')");
    assert.equal(calls.length, 1, 'concurrent administration must issue only one RPC');
    h.run("userId='account-c'; authGeneration++; activeGroupId='group-c'; myGroups=[{id:'group-c',name:'Other'}]");
    gate.resolve({ error: null });
    await first;
    assert.equal(h.run("myGroups[0].id"), 'group-c', 'a stale ownership response must not alter the next account');
  }
  {
    const h = harness(), calls = [];
    h.context.prompt = () => 'Friends';
    h.context.rpc = async (name, args) => { calls.push([name, args]); return { error: null }; };
    h.run(`sb={rpc}; activeGroupId='group-1'; progressView='group';
      myGroups=[{id:'group-1',name:'Friends',owner_id:'account-a'}];
      progress=new Map([[7,{completed:true}]]); photos=[{id:'photo-a',user_id:'account-a',local:true}]; trips=[{id:'trip-a',user_id:'account-a'}];
      loadGroups=async()=>{myGroups=[]}; setProgressView=async v=>{progressView=v}; pullPhotos=async()=>{}; pullTrips=async()=>{};`);
    await h.run("deleteOwnedGroup('group-1')");
    assert.deepEqual(JSON.parse(JSON.stringify(calls)), [['delete_group', { p_group_id: 'group-1' }]]);
    assert.equal(h.run('progress.size'), 1);
    assert.equal(h.run('photos.length'), 1);
    assert.equal(h.run('trips.length'), 1);
    assert.equal(h.run('progressView'), 'personal');
    assert.equal(h.run('activeGroupId'), null);
  }
  console.log('PASS: admin failures, duplicate submits, account switches and disposal preserve personal state');
}

(async () => { uiChecks(); await operationChecks(); })().catch(error => {
  console.error(error);
  process.exitCode = 1;
});
