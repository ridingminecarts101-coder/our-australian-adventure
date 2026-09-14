'use strict';

// Runs the real client and store helpers with an unavailable historic row.
// It creates no account, browser storage or network state.
const assert = require('node:assert/strict');
const fs = require('node:fs');
const vm = require('node:vm');

const elements = new Map();
function element(key) {
  if (!elements.has(key)) {
    const classes = new Set();
    elements.set(key, {
      innerHTML: '', textContent: '', className: '', value: '', disabled: false,
      classList: { add: (...xs) => xs.forEach(x => classes.add(x)),
        remove: (...xs) => xs.forEach(x => classes.delete(x)),
        toggle: (x, on) => on ? classes.add(x) : classes.delete(x),
        contains: x => classes.has(x) },
      addEventListener() {}, querySelector: () => element('nested'), querySelectorAll: () => [],
      setAttribute() {}, click() {},
    });
  }
  return elements.get(key);
}

const context = {
  console: { log() {}, warn() {}, error() {} }, setTimeout, clearTimeout, queueMicrotask,
  crypto: require('node:crypto').webcrypto, URL, URLSearchParams,
  location: { hostname: 'localhost', origin: 'http://localhost', pathname: '/', search: '' },
  history: { replaceState() {} }, navigator: { onLine: true, userAgent: '', platform: '', maxTouchPoints: 0 },
  localStorage: { getItem: () => null, setItem() {}, removeItem() {}, clear() {} },
  document: { querySelector: element, querySelectorAll: () => [], createElement: () => element('created'), body: element('body') },
  addEventListener() {}, confirm: () => true, prompt: () => null,
  fetch: async () => ({ ok: true, json: async () => [] }), Notification: { permission: 'denied' },
  OAA_CONFIG: { revenueCat: {} },
};
context.window = context;
context.Capacitor = { isNativePlatform: () => false, getPlatform: () => 'web', Plugins: {} };
vm.createContext(context);
for (const file of ['countries.js', 'world.js', 'store.js', 'partners.js', 'app.js']) {
  vm.runInContext(fs.readFileSync(file, 'utf8'), context, { filename: file });
}
const run = code => vm.runInContext(code, context);

run(`
available={id:1,title:'Open walk',place:'Open',region:'Region',admin1:'NSW',country:'AU',continent:'Oceania',
 category:'Hiking',hidden_gem:true,pack:'oceania',bundle_only:false,difficulty:2,cost:1,dog_friendly:'yes',season:'Year-round'};
closed={...available,id:42,title:'Closed walk',place:'Closed Track',availability:{status:'unavailable',
 reason:'Research is inconclusive, so this listing is paused pending a current operator source.',reviewed_at:'2026-09-14',
 source:{type:'primary',publisher:'Fixture Archive',url:'https://archive.example.test/source'},replacement_id:1}};
reopened={...closed,availability:{...closed.availability,status:'available'}};
owned=new Set(['all']); ADV=[available,closed];
progress=new Map([[42,{adventure_id:42,completed:true,completed_at:'2025-01-01',rating:4,memory:'Our old walk'}]]);
personalProgress=new Map(progress); progressView='personal'; who='Owner'; userId='owner';
toast=m=>{globalThis.lastToast=m}; bookingLink=()=>null; photosFor=()=>[]; hydrateThumbs=()=>{};
`);

assert.equal(run('isUnavailable(closed)'), true);
assert.equal(run('isUnavailable(reopened)'), false, 'reviewed available status reverses the suppression');
assert.equal(run('countableTotal()'), 1, 'unavailable history is outside the completion denominator');
assert.equal(run('doneCount()'), 0, 'an old tick is preserved but does not inflate the numerator');
assert.equal(run('automaticDiscoveryAllowed(closed)'), false);
assert.equal(run('packStats([available,closed]).all'), 1, 'unavailable gem is excluded from paid value');
assert.equal(run('packStats([reopened]).all'), 1, 'a reviewed reopening restores paid value');
assert.equal(run('bundleOnlyStats([{...closed,bundle_only:true}])'), 0);
assert.equal(run('countable(reopened)'), true, 'a reviewed reopening restores the target');

run('owned=new Set()');
const card = run('cardHTML(closed)');
assert.match(card, /Closed walk/);
assert.match(card, /Listing paused/);
assert.doesNotMatch(card, / disabled/, 'an existing personal tick remains removable');
assert.doesNotMatch(card, /card [^>]*locked/, 'paid styling must not blur the public closure identity');
assert.doesNotMatch(card, /· locked/, 'an unavailable row must not advertise a purchase');

run('renderSheet(42)');
const historic = elements.get('#sheetBody').innerHTML;
assert.match(historic, /Listing paused/);
assert.match(historic, /Fixture Archive/);
assert.match(historic, /archive\.example\.test\/source/);
assert.match(historic, /Read the source from/);
assert.match(historic, /data-open="1"[^>]*>Open current listing/, 'duplicate history links through the existing detail handler');
assert.match(historic, /Your past completion is preserved/);
assert.match(historic, /Our old walk/);
assert.doesNotMatch(historic, /data-buy=/, 'the closure notice must sit outside the paid gate');
assert.match(historic, /Remove mistaken completion tick/);
assert.match(historic, /data-act="addPhoto"/);
assert.match(run("placeRow({label:'Closed region',count:0,total:1,unavailable:1,done:0,onClick:{level:'adventures'}})"),
  /Paused listings/, 'a paused-only route must not be labelled as paid/locked');
assert.match(run("placeRow({label:'Mixed region',count:0,total:2,unavailable:1,done:0,onClick:{level:'adventures'}})"),
  /Paused or locked listings/, 'a mixed zero-target route must describe both causes');

run(`applyPatch=(id,patch)=>{progress.set(id,{...progress.get(id),...patch});
  personalProgress.set(id,{...personalProgress.get(id),...patch})}`);
run('toggleDone(42)');
assert.equal(run('progress.get(42).completed'), false, 'owner may remove a mistaken historical tick');
run('toggleDone(42)');
assert.equal(run('progress.get(42).completed'), false, 'paused listing cannot receive a new completion');
assert.match(run('lastToast'), /listing is paused/);

run("trips=[{id:'trip',adventure_ids:[42]}]; upsertTrip=()=>{globalThis.saved=true}; toggleTripMember('trip',42)");
assert.equal(run("JSON.stringify(trips[0].adventure_ids)"), '[]', 'removal from an old trip remains available');
run("trips=[{id:'trip',adventure_ids:[]}]; saved=false; toggleTripMember('trip',42)");
assert.equal(run("JSON.stringify(trips[0].adventure_ids)"), '[]', 'unavailable experience cannot be newly planned');
assert.equal(run('saved'), false);

run(`progress=new Map([[42,{adventure_id:42,completed:false,rating:3,memory:'Memory without tick'}]]);
  personalProgress=new Map(progress); photosFor=()=>[{id:'local-photo',adventure_id:42,local:true}]; renderSheet(42)`);
const uncheckedHistory = elements.get('#sheetBody').innerHTML;
assert.match(uncheckedHistory, /Memory without tick/);
assert.match(uncheckedHistory, /data-act="addPhoto"/);
assert.match(uncheckedHistory, /data-photo="local-photo"/);

run('progress=new Map(); personalProgress=new Map(); photosFor=()=>[]; renderSheet(42)');
const neverDone = elements.get('#sheetBody').innerHTML;
assert.doesNotMatch(neverDone, /memoryBox/);
assert.match(neverDone, /listing is paused and cannot be marked complete or added to a trip/i);

console.log('availability behavior: historic ID/tick retained; discovery, targets and paid counts excluded');
