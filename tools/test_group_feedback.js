'use strict';
// Exercises explicit client consent and the ephemeral, read-only group feedback view.
const assert = require('node:assert/strict');
const fs = require('node:fs');
const vm = require('node:vm');

function deferred() {
  let resolve;
  const promise = new Promise(done => { resolve = done; });
  return { promise, resolve };
}

function harness() {
  const values = new Map(), elements = new Map();
  const element = key => {
    if (!elements.has(key)) {
      const classes = new Set();
      elements.set(key, {
        value: '', innerHTML: '', textContent: '', dataset: {},
        classList: { contains: x => classes.has(x), add: x => classes.add(x),
          remove: x => classes.delete(x), toggle: (x, yes) => yes ? classes.add(x) : classes.delete(x) },
        setAttribute() {}, focus() {}, querySelector: () => element('nested'),
      });
    }
    return elements.get(key);
  };
  const context = {
    console, setTimeout, clearTimeout, queueMicrotask,
    crypto: require('node:crypto').webcrypto, URL, URLSearchParams,
    location: { hostname: 'localhost', origin: 'http://localhost', pathname: '/', search: '' },
    navigator: { onLine: true, userAgent: '', platform: '', maxTouchPoints: 0 },
    history: { replaceState() {} },
    document: { querySelector: element, querySelectorAll: () => [], createElement: () => element('new') },
    localStorage: { getItem: key => values.get(key) ?? null,
      setItem: (key, value) => values.set(key, String(value)), removeItem: key => values.delete(key) },
    addEventListener() {}, confirm: () => true, prompt: () => null,
    Notification: { permission: 'denied' }, OAA_CONFIG: { revenueCat: {} },
    countryName: x => x, countryFlag: () => '', CONTINENT_ORDER: ['Oceania'],
  };
  context.window = context;
  context.Capacitor = { isNativePlatform: () => false, getPlatform: () => 'web', Plugins: {} };
  vm.createContext(context);
  for (const file of ['store.js', 'app.js'])
    vm.runInContext(fs.readFileSync(file, 'utf8'), context, { filename: file });
  const run = code => vm.runInContext(code, context);
  run(`userId='alice'; who='Alice'; authGeneration=1; online=true;
    progressView='group'; activeGroupId='group-a'; renderAll=()=>{}; toast=()=>{};
    members=new Map([['alice','Alice'],['bob','Bob'],['charlie','Charlie']]);`);
  return { context, run, values, elements };
}

function query(result) {
  return { order() { return this; }, range() { return Promise.resolve(result); } };
}

async function main() {
  const h = harness();
  h.run(`groupFeedback=indexGroupFeedback([
    {adventure_id:17,completed_by_id:'alice',rating:5,memory:'My own'},
    {adventure_id:17,completed_by_id:'bob',rating:4,memory:'A <private> note & more'},
    {adventure_id:17,completed_by_id:'charlie',rating:2,memory:'Second member'},
    {adventure_id:17,completed_by_id:'nobody',rating:null,memory:null}
  ]); groupFeedbackScope={ownerId:userId,groupId:activeGroupId};`);
  const html = h.run('groupFeedbackHTML(17)');
  assert.match(html, /Bob/);
  assert.match(html, /Charlie/);
  assert.match(html, /A &lt;private&gt; note &amp; more/);
  assert.doesNotMatch(html, /My own|nobody/);
  assert.match(html, /aria-label="4 stars"/);
  h.run(`groupFeedback=indexGroupFeedback([
    {adventure_id:17,completed_by_id:'bob',rating:5,memory:'first claim'},
    {adventure_id:17,completed_by_id:'bob',rating:1,memory:'second claim'},
    {adventure_id:17,completed_by_id:'bob',rating:4,memory:'third claim'},
    {adventure_id:17,completed_by_id:'charlie',rating:3,memory:'unambiguous'},
    {adventure_id:18,completed_by_id:'bob',rating:null,memory:null},
    {adventure_id:18,completed_by_id:'bob',rating:5,memory:'later claim'}
  ]);`);
  assert.equal(h.run('groupFeedback.get(17).has("bob")'), false,
    'ambiguous duplicate owner rows must all be hidden');
  assert.equal(h.run('groupFeedback.get(17).has("charlie")'), true,
    'another member on the same adventure remains visible');
  assert.equal(h.run('groupFeedback.has(18)'), false,
    'even an empty first duplicate invalidates the later memory');
  h.run(`groupFeedback=indexGroupFeedback([
    {adventure_id:17,completed_by_id:'bob',rating:4,memory:'A <private> note & more'},
    {adventure_id:17,completed_by_id:'charlie',rating:2,memory:'Second member'}
  ]);`);
  h.run("activeGroupId='group-b'");
  assert.equal(h.run('groupFeedbackHTML(17)'), '', 'group scope blocks stale feedback');
  h.run("activeGroupId='group-a'; userId='other-account'");
  assert.equal(h.run('groupFeedbackHTML(17)'), '', 'owner scope blocks stale feedback');
  h.run("userId='alice'");
  h.run('online=false');
  assert.equal(h.run('groupFeedbackHTML(17)'), '', 'do not show cached remote feedback offline');
  h.run('online=true');

  h.run(`ADV=[{id:17,title:'A walk',place:'The path',country:'AU',continent:'Oceania',
    category:'Hiking',difficulty:2,cost:0,duration:'Half day',season:'Year-round',dog_friendly:'no'}];
    personalProgress=new Map([[17,{adventure_id:17,completed:true,rating:5,memory:'Alice private draft'}]]);
    personalCacheReady=true;
    progress=new Map([[17,{adventure_id:17,completed:true,completed_by_id:'bob',completed_by:'Bob'}]]);
    bookingLink=()=>null; photosFor=()=>[]; hydrateThumbs=()=>{};
    advisoryPanelHTML=()=>''; renderTripPicker=()=>'';`);
  h.run('renderSheet(17)');
  const sheet = h.elements.get('#sheetBody').innerHTML;
  assert.match(sheet, /A &lt;private&gt; note &amp; more/);
  assert.match(sheet, /<textarea id="memoryBox"[^>]*>Alice private draft<\/textarea>/,
    'editable memory must come from the signed-in owner');
  assert.doesNotMatch(sheet, /<textarea[^>]*>A &lt;private&gt;/,
    'another member memory must never enter the editable field');
  h.run(`groupCompletions=indexGroupCompletions([
    {adventure_id:17,completed:true,completed_by_id:'bob',completed_on:'2026-10-01',
      source_is_personal:true,source_user_id:'bob',shared_by_id:'bob'}
  ]);
  groupLegacyCompletions=indexLegacyGroupCompletions([
    {adventure_id:17,completed:true,completed_by_id:'charlie',
      source_is_personal:false,source_user_id:'bob',shared_by_id:'bob'}
  ]);
  progress=new Map([[17,{adventure_id:17,completed:true,completed_by_id:'charlie'}]]);
  renderSheet(17);`);
  const attributedSheet = h.elements.get('#sheetBody').innerHTML;
  assert.match(attributedSheet, /Ticked off by Bob on 1 Oct 2026/);
  assert.match(attributedSheet, /earlier shared completion without verified personal attribution/);
  assert.doesNotMatch(attributedSheet, /Ticked off by Charlie/,
    'a legacy aggregate cannot credit the wrong member in the detail sheet');
  assert.equal(h.run('completionCountsByPerson().get("bob")'), 1);
  assert.equal(h.run('completionCountsByPerson().has("charlie")'), false,
    'group Me stats count only verified personal completions');

  let foregroundRedraws = 0;
  h.context.recordForegroundRedraw = () => { foregroundRedraws++; };
  h.run('openId=17; renderSheet=recordForegroundRedraw; clearGroupFeedbackForForeground()');
  assert.equal(h.run('groupFeedback.size'), 0,
    'foreground refresh hides feedback before the server request completes');
  assert.equal(h.run('groupFeedbackScope'), null);
  assert.equal(foregroundRedraws, 1, 'an open detail sheet loses its stale note immediately');

  const rpcCalls = [];
  h.context.rpc = async (name, args) => {
    rpcCalls.push([name, args]);
    return { error: null };
  };
  h.run(`sb={rpc}; myGroups=[{id:'group-a',share_completions:false,share_feedback:false}];`);
  assert.equal(await h.run("setFeedbackSharing('group-a',true)"), false);
  assert.equal(rpcCalls.length, 0, 'feedback cannot be shared without completion consent');
  h.run('myGroups[0].share_completions=true');
  assert.equal(await h.run("setFeedbackSharing('group-a',true)"), true);
  assert.equal(rpcCalls[0][0], 'set_group_feedback_sharing');
  assert.deepEqual(JSON.parse(JSON.stringify(rpcCalls[0][1])),
    { p_group_id: 'group-a', p_enabled: true });
  assert.equal(h.run('myGroups[0].share_feedback'), true);
  assert.equal(h.run('groupFeedback.size'), 0, 'consent change discards the old feed');

  h.context.groupRpc = (name) => {
    if (name === 'list_unconfirmed_personal_progress')
      return Promise.resolve({ data: [], error: null });
    if (name === 'group_completion_feed') return query({ data: [
      { adventure_id: 17, completed: true, completed_by_id: 'bob', completed_by: 'Bob',
        source_is_personal:true,source_user_id:'bob',shared_by_id:'bob' },
    ], error: null });
    if (name === 'group_completion_feedback_feed') return query({ data: [
      { adventure_id: 17, completed_by_id: 'bob', rating: 4, memory: 'Bob shared note' },
      { adventure_id: 17, completed_by_id: 'charlie', rating: 3, memory: 'Charlie shared note' },
    ], error: null });
    throw new Error(name);
  };
  h.context.personalQuery = () => ({ select() { return this; }, eq() { return this; },
    order() { return this; }, range() { return Promise.resolve({ data: [], error: null }); } });
  h.run('sb={rpc:groupRpc,from:personalQuery};');
  await h.run('pullProgress()');
  assert.equal(h.run('groupFeedback.get(17).size'), 2,
    'all consented members remain available even when the completion summary collapses to one');
  const cached = JSON.parse(h.values.get('oaa.progress.v1'));
  assert.equal(cached.length, 1);
  assert.equal(Object.hasOwn(cached[0], 'memory'), false,
    'remote written memories must not be saved in the progress cache');
  assert.equal(Object.hasOwn(cached[0], 'rating'), false,
    'remote ratings must not be saved in the progress cache');
  assert.equal(h.run('groupCompletions.get(17).has("bob")'), true,
    'the member tick remains available separately from the aggregate');
  await h.run("setProgressView('personal')");
  assert.equal(h.run('groupFeedback.size'), 0, 'switching to personal view discards remote feedback');
  assert.equal(h.run('groupCompletions.size'), 0,
    'switching to personal view discards remote member ticks');

  const pendingOwn = harness();
  pendingOwn.context.groupRpc = name => query({ data: name === 'group_completion_feed'
    ? [{ adventure_id:17, completed:true, completed_by_id:'bob', completed_on:'2026-10-01',
      source_is_personal:true,source_user_id:'bob',shared_by_id:'bob' }]
    : [], error:null });
  pendingOwn.context.personalQuery = h.context.personalQuery;
  pendingOwn.run(`sb={rpc:groupRpc,from:personalQuery};
    writeLS(LS.outbox,[{adventure_id:17,owner_id:'alice',completed:false,
      memory:'My private draft',queue_rev:1}]);`);
  await pendingOwn.run('pullProgress()');
  assert.equal(pendingOwn.run('progress.get(17).completed_by_id'), 'bob',
    'a pending personal edit cannot hide another member\'s shared tick');
  assert.equal(pendingOwn.run('groupCompletions.get(17).has("bob")'), true);
  pendingOwn.context.groupRpc = () => query({ data:[], error:null });
  pendingOwn.run(`sb.rpc=groupRpc; writeLS(LS.outbox,[{adventure_id:17,owner_id:'alice',completed:true,
    queue_rev:2}]);`);
  await pendingOwn.run('pullProgress()');
  assert.equal(pendingOwn.run('progress.has(17)'), false,
    'an unsynced private tick cannot appear as a shared group completion');

  const failedFeed = harness(), notices = [];
  failedFeed.context.groupRpc = name => query(name === 'group_completion_feed'
    ? { data:[{adventure_id:17,completed:true,completed_by_id:'bob',
      source_is_personal:true,source_user_id:'bob',shared_by_id:'bob'}], error:null }
    : { data:null,error:{message:'temporarily unavailable'} });
  failedFeed.context.personalQuery = h.context.personalQuery;
  failedFeed.context.recordNotice = message => notices.push(message);
  failedFeed.run(`sb={rpc:groupRpc,from:personalQuery}; toast=recordNotice;
    loadGroups=async()=>{}; pullPhotos=async()=>{}; pullTrips=async()=>{};
    pullGroupTrips=async()=>{};`);
  assert.equal(await failedFeed.run('syncNow({loud:true})'), false,
    'a failed group feedback read cannot report the full group view up to date');
  assert.equal(failedFeed.run('groupFeedbackAvailable'), false);
  assert.equal(failedFeed.run('groupCompletions.get(17).has("bob")'), true,
    'completion ticks remain available when the separate feedback feed fails');
  assert.match(notices.at(-1), /group ratings and memories are unavailable/);

  const stale = harness(), gate = deferred();
  stale.context.groupRpc = name => name === 'group_completion_feed'
    ? query({ data: [{ adventure_id: 17, completed: true, completed_by_id: 'bob' }], error: null })
    : { order() { return this; }, range() { return gate.promise; } };
  stale.context.personalQuery = h.context.personalQuery;
  stale.run('sb={rpc:groupRpc,from:personalQuery};');
  const pending = stale.run('pullProgress()');
  await new Promise(resolve => setImmediate(resolve));
  stale.run("activeGroupId='group-b'; clearGroupFeedback()");
  gate.resolve({ data: [{ adventure_id: 17, completed_by_id: 'bob', rating: 5,
    memory: 'stale group secret' }], error: null });
  await pending;
  assert.equal(stale.run('groupFeedback.size'), 0,
    'a late response from the previous group must not restore its feedback');

  // Two pulls for the same owner, view and group can finish out of order. The
  // older request may have read a note before its owner revoked consent.
  const reordered = harness(), oldFeedback = deferred();
  let completionCalls = 0, feedbackCalls = 0;
  reordered.context.groupRpc = name => {
    if (name === 'group_completion_feed') {
      completionCalls++;
      return query({ data: [{ adventure_id: 17, completed: true,
        completed_by_id: completionCalls === 1 ? 'bob' : 'charlie' }], error: null });
    }
    if (name === 'group_completion_feedback_feed') {
      feedbackCalls++;
      return feedbackCalls === 1
        ? { order() { return this; }, range() { return oldFeedback.promise; } }
        : query({ data: [], error: null });
    }
    throw new Error(name);
  };
  reordered.context.personalQuery = h.context.personalQuery;
  reordered.run('sb={rpc:groupRpc,from:personalQuery};');
  const olderPull = reordered.run('pullProgress()');
  await new Promise(resolve => setImmediate(resolve));
  assert.equal(feedbackCalls, 1, 'older pull is waiting for its feedback response');
  await reordered.run('pullProgress()');
  assert.equal(reordered.run('groupFeedback.size'), 0,
    'newer empty consent feed clears the group view');
  assert.equal(reordered.run('progress.get(17).completed_by_id'), 'charlie');
  oldFeedback.resolve({ data: [{ adventure_id: 17, completed_by_id: 'bob',
    rating: 5, memory: 'revoked memory' }], error: null });
  await olderPull;
  assert.equal(reordered.run('groupFeedback.size'), 0,
    'older same-group response cannot reinstate a revoked memory');
  assert.equal(reordered.run('progress.get(17).completed_by_id'), 'charlie',
    'older completion summary cannot replace the newer result');

  const burst = harness(), timers = new Map();
  let timerId = 0, burstRenders = 0, burstPulls = 0;
  burst.context.setTimeout = callback => {
    const id = ++timerId;
    timers.set(id, callback);
    return id;
  };
  burst.context.clearTimeout = id => timers.delete(id);
  burst.context.renderAll = () => { burstRenders++; };
  burst.context.pullProgress = () => { burstPulls++; return Promise.resolve(); };
  burst.run(`groupFeedback=indexGroupFeedback([
    {adventure_id:17,completed_by_id:'bob',rating:4,memory:'Shared note'}
  ]); groupFeedbackScope={ownerId:userId,groupId:activeGroupId};`);
  burst.run("queueGroupProgressRefresh({new:{group_id:'group-b'}})");
  assert.equal(burst.run('groupFeedback.size'), 1,
    'another group event must not clear the current group feed');
  assert.equal(timers.size, 0, 'another group event must not queue a pull');
  burst.run("queueGroupProgressRefresh({new:{group_id:'group-a'}})");
  assert.equal(burst.run('groupFeedback.size'), 0,
    'the first event immediately hides displayed feedback');
  assert.equal(burstRenders, 1, 'the first event immediately redraws the detail view');
  for (let i = 0; i < 100; i++)
    burst.run("queueGroupProgressRefresh({new:{group_id:'group-a'}})");
  assert.equal(timers.size, 1, 'a burst of projection changes has one pending pull');
  assert.equal(burstRenders, 1, 'later events do not repeatedly redraw an empty feed');
  assert.equal(burstPulls, 0, 'the pull waits until the burst settles');
  [...timers.values()][0]();
  timers.clear();
  assert.equal(burstPulls, 1, 'the burst produces exactly one progress pull');

  burst.run("queueGroupProgressRefresh({old:{group_id:'group-a'}})");
  burst.run("activeGroupId='group-b'");
  [...timers.values()][0]();
  timers.clear();
  assert.equal(burstPulls, 1, 'a delayed event cannot pull after a group switch');
  burst.run("activeGroupId='group-a'; queueGroupProgressRefresh({new:{group_id:'group-a'}}); userId='other-account'");
  [...timers.values()][0]();
  timers.clear();
  assert.equal(burstPulls, 1, 'a delayed event cannot pull after an account switch');
  burst.run("userId='alice'; queueGroupProgressRefresh({new:{group_id:'group-a'}})");
  burst.run('clearGroupFeedback()');
  assert.equal(timers.size, 0, 'leaving the feed cancels a pending refresh');

  burst.run(`sb={}; groupSchemaReady=true; myGroups=[{id:'group-a',name:'First',
    owner_id:'alice',share_completions:true,share_feedback:false,invite_enabled:false}];
    renderMe_groups();`);
  assert.match(burst.elements.get('#groupPanel').innerHTML,
    /ratings and written memories are not shared with this group/,
    'the off-state describes only the selected group');

  const revoked = harness(), beforeRevocation = deferred();
  revoked.context.groupRpc = name => name === 'group_completion_feed'
    ? query({ data: [], error: null })
    : { order() { return this; }, range() { return beforeRevocation.promise; } };
  revoked.context.personalQuery = h.context.personalQuery;
  revoked.run('sb={rpc:groupRpc,from:personalQuery};');
  const inFlight = revoked.run('pullProgress()');
  await new Promise(resolve => setImmediate(resolve));
  revoked.run('clearGroupFeedback()'); // consent revocation or projection event
  beforeRevocation.resolve({ data: [{ adventure_id: 17, completed_by_id: 'bob',
    rating: 5, memory: 'old consent' }], error: null });
  await inFlight;
  assert.equal(revoked.run('groupFeedback.size'), 0,
    'clearing after revocation invalidates an in-flight response');

  console.log('PASS: opt-in group feedback, read-only owner boundary, ephemeral cache and response ordering');
}

main().catch(error => { console.error(error); process.exitCode = 1; });
