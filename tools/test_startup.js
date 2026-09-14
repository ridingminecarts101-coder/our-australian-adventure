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

async function testPasswordRecovery() {
  const h = harness(), run = h.run;
  const el = key => h.elements.get(key);
  const owner = 'aaaaaaaa-aaaa-4aaa-8aaa-aaaaaaaaaaaa';
  const other = 'bbbbbbbb-bbbb-4bbb-8bbb-bbbbbbbbbbbb';
  run(`writeLS(LS.progress,[{adventure_id:7,memory:'keep'}]);
    writeLS(LS.outbox,[{adventure_id:7,queue_rev:'keep'}]);`);
  const progressBefore = h.values.get('oaa.progress.v3');
  const outboxBefore = h.values.get('oaa.outbox.v2');
  const assertOwnerState = () => {
    assert.equal(h.values.get('oaa.progress.v3'), progressBefore);
    assert.equal(h.values.get('oaa.outbox.v2'), outboxBefore);
  };

  h.context.mockAuth = {};
  run(`sb={auth:mockAuth}; userId='${owner}'; accountUser={id:userId,email:'owner@example.test'};
    accountIsAnonymous=false; passwordRecoveryMode=true; passwordRecoveryOwnerId=userId; authGeneration=4;`);
  run('showPasswordRecoveryScreen()');
  assert(!el('#lock').classList.contains('hidden'));
  assert(el('#app').classList.contains('hidden'));
  assert(el('#accountEmail').classList.contains('hidden'));
  assert.equal(el('#accountEmail').required, false);
  assert(!el('#accountPassword').classList.contains('hidden'));
  assert.equal(el('#accountPassword').required, true);
  assert.equal(el('#accountPassword').autocomplete, 'new-password');
  assert.equal(el('#lockBtn').textContent, 'Save new password');
  assert(el('#createAccountBtn').classList.contains('hidden'));
  assert(el('#forgotPasswordBtn').classList.contains('hidden'));

  let calls = 0;
  h.context.mockAuth.updateUser = async () => { calls++; return {data:{user:{id:owner}},error:null}; };
  assert.equal(await run("finishPasswordRecovery('short')"), false);
  assert.equal(calls, 0);
  assert.equal(run('passwordRecoveryMode'), true);
  assert.match(el('#lockMsg').textContent, /at least 6/);
  assertOwnerState();

  h.context.mockAuth.updateUser = async () => ({data:{user:null},error:new Error('rejected')});
  assert.equal(await run("finishPasswordRecovery('long-enough')"), false);
  assert.equal(run('passwordRecoveryMode'), true);
  assert.match(el('#lockMsg').textContent, /rejected/);
  assert.equal(el('#lockBtn').disabled, false);
  assertOwnerState();

  h.context.pending = deferred();
  h.context.mockAuth.updateUser = () => h.context.pending.promise;
  const stale = run("finishPasswordRecovery('long-enough')");
  run(`receivePasswordRecovery({user:{id:'${other}',email:'other@example.test'}});
    showPasswordRecoveryScreen();`);
  h.context.pending.resolve({data:{user:{id:owner}},error:null});
  assert.equal(await stale, false);
  assert.equal(run('passwordRecoveryMode'), true);
  assert.equal(run('passwordRecoveryOwnerId'), other);
  assert.equal(el('#lockBtn').disabled, false);
  assertOwnerState();

  run(`userId='${owner}'; accountUser={id:userId,email:'owner@example.test'};
    passwordRecoveryOwnerId=userId; authGeneration++; enterApp=async()=>true;`);
  h.context.mockAuth.updateUser = async () => ({data:{user:{id:owner,email:'owner@example.test'}},error:null});
  assert.equal(await run("finishPasswordRecovery('long-enough')"), true);
  assert.equal(run('passwordRecoveryMode'), false);
  assertOwnerState();

  const h2 = harness(), run2 = h2.run;
  let groupCalls = 0;
  h2.context.mockAuth = {getSession: async () => ({data:{session:{user:{id:other,email:'other@example.test'}}},error:null})};
  h2.context.groupCall = () => { groupCalls++; };
  h2.context.URL.revokeObjectURL = () => {};
  run2(`sb={auth:mockAuth}; accountUiReady=true; accountBootReady=true;
    userId='${owner}'; accountUser={id:userId}; localStorage.setItem(LS.owner,'legacy-owner-a');
    progress=new Map([[7,{adventure_id:7,memory:'owner A'}]]); personalProgress=new Map(progress);
    photos=[{id:'photo-a',owner_id:userId}]; pendingPhotos=[{id:'queued-a',owner_id:userId}];
    trips=[{id:'trip-a'}]; members=new Map([['${owner}','Owner A']]); myGroups=[{id:'group-a'}];
    recs=[{id:'private-rec-a'}]; myVotes=new Map([['private-rec-a',{vote:1}]]); recBusy=true; pushedName='Owner A';
    objectUrls.set('photo-a','blob:owner-a'); signedUrls.set('path-a',{url:'signed-a'});
    openId=7; openTripId='trip-a'; photoTargetId=7; lightbox={list:photos,index:0};
    for (const id of ['#sheet','#tripSheet','#recSheet','#lightbox']) $(id).classList.remove('hidden');
    $('#sheetBody').innerHTML='private memory'; $('#tripBody').innerHTML='private trip';
    $('#recBody').innerHTML='private draft'; $('#lbImg').src='blob:owner-a';
    $('#lbTitle').textContent='private title'; $('#lbSub').textContent='private location';
    $('#photoInput').value='private-file'; $('#cameraInput').value='private-camera';
    loadGroups=async()=>{groupCall();};`);
  run2(`receivePasswordRecovery({user:{id:'${other}',email:'other@example.test'}})`);
  await new Promise(resolve => setTimeout(resolve, 5));
  assert.equal(run2('progress.size + personalProgress.size + photos.length + pendingPhotos.length + trips.length + members.size + myGroups.length'), 0);
  assert.equal(run2('objectUrls.size + signedUrls.size'), 0);
  assert.equal(run2('recs.length + myVotes.size + (recBusy?1:0) + (pushedName?1:0)'), 0);
  for (const id of ['#sheet','#tripSheet','#recSheet','#lightbox']) assert(h2.elements.get(id).classList.contains('hidden'));
  for (const id of ['#sheetBody','#tripBody','#recBody']) assert.equal(h2.elements.get(id).innerHTML, '');
  assert.equal(h2.elements.get('#lbImg').src, '');
  assert.equal(h2.elements.get('#lbTitle').textContent + h2.elements.get('#lbSub').textContent, '');
  assert.equal(h2.elements.get('#photoInput').value + h2.elements.get('#cameraInput').value, '');
  assert.equal(run2('openId === null && openTripId === null && photoTargetId === null && lightbox.list.length'), 0);
  assert.equal(run2('passwordRecoveryOwnerId'), other);
  assert.equal(groupCalls, 0);
  assert.equal(h2.elements.get('#lockBtn').textContent, 'Save new password');

  const h3 = harness(), run3 = h3.run;
  const adventureGate = deferred(), sessionGate = deferred(), groupGate = deferred();
  let authEvent, bootGroupCalls = 0, updates = 0;
  h3.context.OAA_CONFIG.supabaseUrl = 'https://example.test';
  h3.context.OAA_CONFIG.supabaseAnonKey = 'test-key';
  h3.context.adventureGate = adventureGate;
  h3.context.groupCall = () => { bootGroupCalls++; };
  h3.context.mockAuth = {
    onAuthStateChange: callback => { authEvent = callback; },
    getSession: () => sessionGate.promise,
    updateUser: async () => {
      updates++;
      return updates === 1
        ? {data:{user:null},error:new Error('temporary rejection')}
        : {data:{user:{id:owner,email:'owner@example.test'}},error:null};
    },
  };
  h3.context.supabase = {createClient: () => ({auth:h3.context.mockAuth})};
  h3.context.groupGate = groupGate;
  run3(`loadAdventures=()=>adventureGate.promise; wireUI=()=>{};
    loadGroups=()=>{groupCall(); return groupGate.promise;};`);
  const booting = run3('boot()');
  authEvent('PASSWORD_RECOVERY', {user:{id:owner,email:'owner@example.test'}});
  assert.equal(run3('accountUiReady'), false);
  adventureGate.resolve();
  await new Promise(resolve => setTimeout(resolve, 0));
  assert.equal(run3('accountUiReady'), true);
  assert.equal(bootGroupCalls, 0);
  sessionGate.resolve({data:{session:{user:{id:owner,email:'owner@example.test'}}},error:null});
  await booting;
  assert.equal(run3('accountUiReady && accountBootReady'), true);
  assert.equal(bootGroupCalls, 0);
  assert.equal(h3.elements.get('#lockBtn').textContent, 'Save new password');
  run3(`idbAll=async()=>[]; notificationPermission=async()=>{}; pullProgress=async()=>{};
    pullPhotos=async()=>{}; pullTrips=async()=>{}; subscribeRealtime=()=>{};
    startSyncTicker=()=>{}; wirePullToRefresh=()=>{}; flushOutbox=()=>{};
    flushPhotoQueue=()=>{}; flushTrips=()=>{}; seasonalNudge=()=>{}; migrateLegacyPhotos=()=>{};`);
  h3.elements.get('#accountPassword').value = 'new-password';
  await h3.elements.get('#lockForm').onsubmit({preventDefault(){}});
  assert.equal(updates, 1);
  assert.equal(run3('passwordRecoveryMode'), true);
  assert.equal(h3.elements.get('#lockBtn').disabled, false);
  assert.match(h3.elements.get('#lockMsg').textContent, /temporary rejection/);
  const successfulRetry = h3.elements.get('#lockForm').onsubmit({preventDefault(){}});
  await new Promise(resolve => setTimeout(resolve, 0));
  assert.equal(updates, 2);
  assert.equal(bootGroupCalls, 1);
  groupGate.resolve();
  await successfulRetry;
  assert.equal(run3('passwordRecoveryMode'), false);
  assert.equal(bootGroupCalls, 1);
  assert.equal(h3.elements.get('#lockBtn').disabled, false);
  run3(`for (const id of ['#sheet','#tripSheet','#recSheet','#lightbox']) $(id).classList.remove('hidden');
    $('#sheetBody').innerHTML='signed-out memory'; $('#tripBody').innerHTML='signed-out trip';
    $('#recBody').innerHTML='signed-out draft'; $('#lbImg').src='blob:signed-out';`);
  await run3('handleSignedOut()');
  assert.equal(h3.elements.get('#lockBtn').textContent, 'Sign in');
  assert.equal(h3.elements.get('#lockBtn').disabled, false);
  for (const id of ['#sheet','#tripSheet','#recSheet','#lightbox']) assert(h3.elements.get(id).classList.contains('hidden'));
  for (const id of ['#sheetBody','#tripBody','#recBody']) assert.equal(h3.elements.get(id).innerHTML, '');
  assert.equal(h3.elements.get('#lbImg').src, '');

  const h4 = harness(), run4 = h4.run;
  h4.context.mockAuth = {getSession: async () => ({data:{session:{user:{id:other}}},error:null})};
  run4(`sb={auth:mockAuth}; accountUiReady=true; accountBootReady=true;
    userId='${other}'; accountUser={id:userId}; passwordRecoveryMode=true;
    passwordRecoveryOwnerId='${owner}'; passwordRecoveryAttempt=9;`);
  assert.equal(await run4(`enterApp({recoveryOwnerId:'${owner}',recoveryAttempt:9})`), false);
  assert.equal(run4('passwordRecoveryMode'), false);
  assert.match(h4.elements.get('#lockMsg').textContent, /does not match/);
  assert.equal(run4('receivePasswordRecovery(null)'), false);
  assert.match(h4.elements.get('#lockMsg').textContent, /invalid or expired/);

  const h5 = harness(), run5 = h5.run, prepareGate = deferred(), photoGate = deferred();
  h5.context.mockAuth = {getSession: async () => ({data:{session:{user:{id:owner}}},error:null})};
  h5.context.prepareGate = prepareGate; h5.context.photoGate = photoGate;
  run5(`sb={auth:mockAuth}; bindLocalDataToUser=async()=>{}; loadGroups=async()=>{};
    nativePhotoFiles=()=>({prepare:()=>prepareGate.promise});
    idbAll=()=>photoGate.promise; loadLocalTrips=()=>{}; notificationPermission=async()=>{};
    Billing.init=async()=>false; openDeepLink=()=>{}; pullProgress=async()=>{}; pullPhotos=async()=>{};
    pullTrips=async()=>{}; subscribeRealtime=()=>{}; startSyncTicker=()=>{}; wirePullToRefresh=()=>{};
    flushOutbox=()=>{}; flushPhotoQueue=()=>{}; flushTrips=()=>{}; seasonalNudge=()=>{};
    migrateLegacyPhotos=()=>{}; renderAll=()=>{$('#passportGrid').innerHTML='owner render';};
    $('#app').classList.add('hidden'); $('#lock').classList.remove('hidden');
    $('#passportGrid').innerHTML='previous owner DOM';`);
  const opening = run5('enterApp()');
  await new Promise(resolve => setTimeout(resolve, 0));
  assert(h5.elements.get('#app').classList.contains('hidden'));
  assert.equal(h5.elements.get('#passportGrid').innerHTML, 'previous owner DOM');
  prepareGate.resolve(true);
  await new Promise(resolve => setTimeout(resolve, 0));
  assert(h5.elements.get('#app').classList.contains('hidden'));
  photoGate.resolve([]);
  assert.equal(await opening, true);
  assert(!h5.elements.get('#app').classList.contains('hidden'));
  assert.equal(h5.elements.get('#passportGrid').innerHTML, 'owner render');

  const h5stale = harness(), run5stale = h5stale.run, stalePhotoGate = deferred();
  h5stale.context.mockAuth = {getSession: async () => ({data:{session:{user:{id:owner}}},error:null})};
  h5stale.context.stalePhotoGate = stalePhotoGate;
  run5stale(`sb={auth:mockAuth}; bindLocalDataToUser=async()=>{}; loadGroups=async()=>{};
    idbAll=()=>stalePhotoGate.promise; loadLocalTrips=()=>{}; notificationPermission=async()=>{};
    renderAll=()=>{throw new Error('stale owner rendered');};
    $('#app').classList.add('hidden'); $('#lock').classList.remove('hidden');`);
  const staleOpening = run5stale('enterApp()');
  await new Promise(resolve => setTimeout(resolve, 0));
  run5stale(`authGeneration++; userId=null; accountUser=null;`);
  stalePhotoGate.resolve([]);
  assert.equal(await staleOpening, false);
  assert(h5stale.elements.get('#app').classList.contains('hidden'));

  const h5auth = harness(), run5auth = h5auth.run, authGate = deferred();
  h5auth.context.authGate = authGate;
  h5auth.context.mockAuth = {getSession: () => authGate.promise};
  run5auth(`sb={auth:mockAuth,removeAllChannels:async()=>{}};
    bindLocalDataToUser=async()=>{}; loadGroups=async()=>{}; idbAll=async()=>[];
    loadLocalTrips=()=>{}; notificationPermission=async()=>{};
    flushOutbox.requested=false; flushPhotoQueue.requested=false; flushTrips.requested=false;`);
  const staleSessionOpening = run5auth('enterApp()');
  await new Promise(resolve => setTimeout(resolve, 0));
  await run5auth("handleSignedOut('Signed out by another tab.')");
  authGate.resolve({data:{session:{user:{id:owner,email:'owner@example.test'}}},error:null});
  assert.equal(await staleSessionOpening, false);
  assert.equal(run5auth('userId'), null);
  assert(h5auth.elements.get('#app').classList.contains('hidden'));

  const h6 = harness(), run6 = h6.run;
  const callbacks = {}, statuses = {};
  h6.context.callbacks = callbacks; h6.context.statuses = statuses;
  h6.context.makeChannel = name => {
    const chain = {
      on(_kind, _filter, callback) { callbacks[name] = callback; return chain; },
      subscribe(callback) { if (callback) statuses[name] = callback; return chain; },
    };
    return chain;
  };
  run6(`sb={getChannels:()=>[],removeAllChannels:async()=>{},removeChannel:()=>{},channel:name=>makeChannel(name)};
    userId='${owner}'; accountUser={id:userId}; accountIsAnonymous=false; authGeneration=3;
    progress=new Map([[7,{adventure_id:7}]]); photos=[{id:'old-photo'}]; trips=[{id:'old-trip'}];
    subscribeRealtime(); receivePasswordRecovery({user:{id:'${other}'}});`);
  callbacks['progress-sync']({eventType:'INSERT',new:{adventure_id:8,user_id:owner}});
  callbacks['photo-sync']({eventType:'INSERT',new:{id:'late-photo',user_id:owner}});
  callbacks['trip-sync']({eventType:'INSERT',new:{id:'late-trip',user_id:owner}});
  if (statuses['progress-sync']) statuses['progress-sync']('SUBSCRIBED');
  assert.equal(run6('progress.size + photos.length + trips.length'), 0);
  assert.notEqual(run6('realtimeOk'), true);

  const h7 = harness(), run7 = h7.run, memberGate = deferred(), recommendationGate = deferred();
  h7.context.memberGate = memberGate; h7.context.recommendationGate = recommendationGate;
  h7.context.table = name => {
    if (name === 'group_members') return {
      select() { return this; }, eq() { return memberGate.promise; },
    };
    if (name === 'recommendations') return {
      select() { return this; }, limit() { return recommendationGate.promise; },
    };
    throw new Error('unexpected table ' + name);
  };
  run7(`sb={from:name=>table(name),removeAllChannels:async()=>{}}; online=true;
    userId='${owner}'; accountUser={id:userId}; authGeneration=2; activeGroupId='group-a';
    members=new Map([['${owner}','Old owner']]);`);
  const oldMembers = run7('loadMembers()');
  run7(`receivePasswordRecovery({user:{id:'${other}'}})`);
  memberGate.resolve({data:[{user_id:owner,display_name:'Late owner A'}],error:null});
  await oldMembers;
  assert.equal(run7('members.size'), 0);

  run7(`userId='${owner}'; accountUser={id:userId}; authGeneration=8;
    passwordRecoveryMode=false; passwordRecoveryOwnerId=null; recs=[{id:'old-a'}];
    myVotes=new Map([['old-a',{vote:1}]]);`);
  const oldRecommendations = run7('pullRecommendations()');
  run7(`receivePasswordRecovery({user:{id:'${other}'}})`);
  recommendationGate.resolve({data:[{id:'late-a',created_by:owner}],error:null});
  await oldRecommendations;
  assert.equal(run7('recs.length + myVotes.size + (recBusy?1:0)'), 0);

  const h8 = harness(), run8 = h8.run, signOutGate = deferred();
  let billingSignOuts = 0, signIns = 0, signUps = 0;
  h8.context.signOutGate = signOutGate;
  h8.context.mockAuth = {
    signInWithPassword: async () => { signIns++; return {error:null}; },
    signUp: async () => { signUps++; return {data:{session:null},error:null}; },
    resetPasswordForEmail: async () => ({error:null}),
  };
  h8.context.billingSignOut = async () => { billingSignOuts++; };
  run8(`sb={auth:mockAuth,removeAllChannels:()=>signOutGate.promise};
    userId='${owner}'; accountUser={id:userId}; accountIsAnonymous=false;
    idbClear=async()=>{}; Billing.signOut=billingSignOut;
    localStorage.removeItem(LS.owner);`);
  const signingOut = run8('handleSignedOut()');
  const joiningSignOut = run8('handleSignedOut()');
  assert.equal(run8('signOutHandling'), true);
  assert.equal(await run8("trySignIn('test@example.test','password')"), false);
  await run8("createAccount('test@example.test','password')");
  assert.equal(await run8("sendPasswordReset('test@example.test')"), false);
  assert.equal(run8(`receivePasswordRecovery({user:{id:'${other}'}})`), false);
  assert.equal(signIns + signUps, 0, 'auth actions cannot start during sign-out cleanup');
  signOutGate.resolve();
  await Promise.all([signingOut, joiningSignOut]);
  assert.equal(billingSignOuts, 1, 'concurrent sign-out events share one cleanup operation');
  assert.equal(run8('signOutHandling'), false);
  assert.equal(run8('signOutWork'), null);

  const h9 = harness(), run9 = h9.run;
  let sessionReads = 0;
  h9.context.OAA_CONFIG.supabaseUrl = 'https://example.test';
  h9.context.OAA_CONFIG.supabaseAnonKey = 'test-key';
  h9.context.mockAuth = {
    onAuthStateChange() {},
    getSession: async () => { sessionReads++; return {data:{session:{user:{id:owner}}},error:null}; },
  };
  h9.context.supabase = {createClient: () => ({auth:h9.context.mockAuth})};
  run9(`loadAdventures=async()=>{}; loadLocalProgress=()=>{}; buildFilterOptions=()=>{}; wireUI=()=>{};
    writeLS(LS.accountDeletion,{owner_id:'${owner}',stage:'confirmed'});
    Billing.deleteLocalOwner=async()=>{}; idbDeleteLocalOwner=async()=>{throw new Error('device busy');};`);
  assert.equal(await run9('boot()'), false);
  assert.equal(sessionReads, 0, 'startup cannot reopen a deleted session while confirmed cleanup is incomplete');
  assert.equal(run9("readLS(LS.accountDeletion).stage"), 'confirmed');

  const h10 = harness(), run10 = h10.run;
  let directAuthEvent, reloaded = false;
  h10.context.OAA_CONFIG.supabaseUrl = 'https://example.test';
  h10.context.OAA_CONFIG.supabaseAnonKey = 'test-key';
  h10.context.location.reload = () => { reloaded = true; };
  h10.context.mockAuth = {
    onAuthStateChange: callback => { directAuthEvent = callback; },
    getSession: async () => ({data:{session:null},error:null}),
  };
  h10.context.supabase = {createClient: () => ({auth:h10.context.mockAuth})};
  run10('loadAdventures=async()=>{}; loadLocalProgress=()=>{}; buildFilterOptions=()=>{}; wireUI=()=>{};');
  await run10('boot()');
  run10(`userId='${owner}'; accountUser={id:userId}; authGeneration=12;
    progress=new Map([[7,{memory:'owner A'}]]); personalProgress=new Map(progress);
    photos=[{id:'photo-a'}]; pendingPhotos=[{id:'queued-a'}]; trips=[{id:'trip-a'}];
    recs=[{id:'rec-a'}]; blockedPeople=[{user_id:'blocked-a'}]; blockedPeopleOwner=userId;
    $('#app').classList.remove('hidden'); $('#lightbox').classList.remove('hidden');
    $('#lbImg').src='blob:owner-a';`);
  directAuthEvent('SIGNED_IN', {user:{id:other}});
  assert.equal(reloaded, true);
  assert(h10.elements.get('#app').classList.contains('hidden'));
  assert(h10.elements.get('#lightbox').classList.contains('hidden'));
  assert.equal(h10.elements.get('#lbImg').src, '');
  assert.equal(run10('progress.size + personalProgress.size + photos.length + pendingPhotos.length + trips.length + recs.length + blockedPeople.length'), 0,
    'a direct owner transition clears private memory before navigation');
  assert.equal(run10('authGeneration'), 13);
  console.log('password recovery: automatic screen, failures, stale account guard and owner-state preservation passed');
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
  const resetGate = deferred(); let resetCalls = 0;
  h.context.resetGate = resetGate;
  h.context.mockAuth.resetPasswordForEmail=()=>{ resetCalls++; return resetGate.promise; };
  const firstReset = run("sendPasswordReset('test@example.test')");
  assert.equal(await run("sendPasswordReset('test@example.test')"), false);
  assert.equal(resetCalls, 1);
  assert.equal(el('#forgotPasswordBtn').disabled, true);
  resetGate.resolve({error:null});
  assert.equal(await firstReset, true);
  assert.equal(el('#forgotPasswordBtn').disabled, false);
  h.context.mockAuth.resetPasswordForEmail=async()=>{ resetCalls++; return {error:null}; };
  assert.equal(await run("sendPasswordReset('test@example.test')"), true);
  assert.equal(resetCalls, 2);
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
  await testPasswordRecovery();
  console.log('startup/auth failures: visible recovery, catalogue fallback, retries and saved data passed');
}
main().catch(error=>{console.error(error);process.exit(1);});
