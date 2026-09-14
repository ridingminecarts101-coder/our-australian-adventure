'use strict';

// Unknown prices must remain visible in ordinary browsing without being
// represented as free or as satisfying a selected maximum-price filter.
const assert = require('node:assert/strict');
const fs = require('node:fs');
const vm = require('node:vm');

const elements = new Map();
function element(key) {
  if (!elements.has(key)) elements.set(key, {
    innerHTML: '', textContent: '', value: '', classList: { add() {}, remove() {}, toggle() {} },
    setAttribute() {}, addEventListener() {}, querySelector() { return null; }, querySelectorAll() { return []; },
  });
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
base={title:'Known walk',place:'Known',region:'Region',admin1:'NSW',country:'AU',continent:'Oceania',
 category:'Hiking',hidden_gem:false,pack:null,bundle_only:false,difficulty:2,cost:1,dog_friendly:'check',
 season:'Year-round',duration:'1-2 hrs',description:'A known-price fixture used only by the local regression test.'};
known={...base,id:1}; unknown={...base,id:2,title:'Unknown walk',place:'Unknown',cost:null,
 season:'Check dates',duration:'Check duration'};
expensive={...base,id:3,title:'Expensive walk',place:'Expensive',cost:3};
ADV=[known,unknown,expensive]; progress=new Map(); personalProgress=new Map(); progressView='personal';
owned=new Set(['all']); nav={level:'adventures',continent:null,country:null,admin1:null};
`);

assert.equal(run('costLabel(null)'), 'Check pricing');
assert.equal(run('costLabel(0)'), 'Free');
assert.equal(run("inSeason('Check dates', 0)"), false);
assert.equal(run("inSeason('Check dates', 6)"), false);
assert.equal(run('inSeason(null, 0)'), true, 'legacy missing season retains its existing behavior');
assert.equal(run("inSeason('Year-round', 6)"), true);
assert.equal(run("inSeason('Apr-Oct', 5)"), true);
assert.equal(run("inSeason('Apr-Oct', 11)"), false);
assert.match(run('cardHTML(unknown)'), /Check pricing/);
assert.doesNotMatch(run('cardHTML(unknown)'), />Free</);

run("filters.cost='All'");
assert.deepEqual(Array.from(run('filtered().map(a=>a.id)')), [1, 2, 3], 'default browsing includes unknown prices');
run('filters.cost=4');
assert.deepEqual(Array.from(run('filtered().map(a=>a.id)')), [1, 3], 'any explicit maximum excludes unknown prices');
run('filters.cost=1');
assert.deepEqual(Array.from(run('filtered().map(a=>a.id)')), [1], 'limited filter keeps only qualifying known prices');

run('openId=2; renderSheet(2)');
assert.match(elements.get('#sheetBody').innerHTML, /<b>Rough cost<\/b><span>Check pricing<\/span>/);
assert.match(elements.get('#sheetBody').innerHTML, /<b>Time needed<\/b><span>Check duration<\/span>/);
assert.match(elements.get('#sheetBody').innerHTML, /<b>Best time<\/b><span>Check dates<\/span>/);
assert.doesNotMatch(elements.get('#sheetBody').innerHTML, /<b>Rough cost<\/b><span>Free<\/span>/);

run(`capturedShare=null; share=async payload=>{capturedShare=payload}; shareAdventure(2)`);
setImmediate(() => {
  assert.match(run('capturedShare.text'), /Check pricing/);
  assert.match(run('capturedShare.text'), /dates: check before visiting/);
  assert.doesNotMatch(run('capturedShare.text'), /best Check dates/);
  assert.doesNotMatch(run('capturedShare.text'), / · Free · /);
  run('buildFilterOptions()');
  assert.match(elements.get('#fCost').innerHTML, /^<option value="All" selected>Any price<\/option>/);
  console.log('unknown cost and schedule UI: 24 passed');
});
