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
    if (name === 'group_completion_feed') return query({ data: [
      { adventure_id: 17, completed: true, completed_by_id: 'bob', completed_by: 'Bob' },
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
  await h.run("setProgressView('personal')");
  assert.equal(h.run('groupFeedback.size'), 0, 'switching to personal view discards remote feedback');

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

  console.log('PASS: opt-in group feedback, read-only owner boundary, ephemeral cache and stale response');
}

main().catch(error => { console.error(error); process.exitCode = 1; });
