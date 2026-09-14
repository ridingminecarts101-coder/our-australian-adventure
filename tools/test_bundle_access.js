'use strict';

// Exercises the real entitlement and locked-detail code in an isolated VM.
// No store, account, browser or network state is created.
const assert = require('assert');
const fs = require('fs');
const vm = require('vm');

const elements = new Map();
function element(key) {
  if (!elements.has(key)) {
    const classes = new Set();
    elements.set(key, {
      innerHTML: '', textContent: '', className: '', disabled: false,
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
}

const context = {
  console: { log() {}, warn() {}, error() {} }, setTimeout, clearTimeout, queueMicrotask,
  crypto: require('crypto').webcrypto,
  location: { hostname: 'localhost', origin: 'http://localhost', pathname: '/', search: '' },
  history: { replaceState() {} }, URL, URLSearchParams,
  navigator: { onLine: true, userAgent: '', platform: '', maxTouchPoints: 0 },
  localStorage: { getItem: () => null, setItem() {}, removeItem() {}, clear() {} },
  document: { querySelector: element, querySelectorAll: () => [], createElement: () => element('created') },
  addEventListener() {}, confirm: () => true, prompt: () => null,
  fetch: async () => ({ ok: true, json: async () => [] }),
  Notification: { permission: 'denied' }, OAA_CONFIG: { revenueCat: {} },
};
context.window = context;
context.Capacitor = { isNativePlatform: () => false, getPlatform: () => 'web', Plugins: {} };
vm.createContext(context);
for (const file of ['countries.js', 'world.js', 'store.js', 'app.js']) {
  vm.runInContext(fs.readFileSync(file, 'utf8'), context, { filename: file });
}
const run = code => vm.runInContext(code, context);

run(`
  classic = {id:90001,title:'Secret ice route',description:'Secret description',place:'Secret base',
    region:'Antarctica',admin1:'Antarctica',country:'AQ',continent:'Antarctica',category:'Expedition',
    hidden_gem:false,bundle_only:true,pack:null,difficulty:3,cost:4,dog_friendly:'no',season:'Nov-Mar',duration:'1 day'};
  gem = {id:90002,title:'Secret reef',place:'Secret cay',region:'Oceania',admin1:'FJ',country:'FJ',
    continent:'Oceania',category:'Nature',hidden_gem:true,bundle_only:false,pack:'oceania'};
  aqGem = {...classic, id:90003, hidden_gem:true, pack:'all'};
  loadEntitlements('owner-a');
`);

assert.equal(run('isLocked(classic)'), true);
assert.equal(run('isLocked(gem)'), true);
assert.equal(run('isLocked(aqGem)'), true, 'Antarctic gems require the bundle');
assert.equal(run("packFor('Antarctica').slug"), 'all');
assert.equal(run('PACKS.length'), 8);
assert.equal(run("PACKS.some(p => p.continent === 'Antarctica')"), false);
assert.equal(run('packStats([classic,gem]).all'), 1, 'bundle classics are not hidden-gem counts');
assert.equal(run('bundleOnlyStats([classic,gem])'), 1);
assert.equal(run('packStats([classic,gem,aqGem]).all'), 2, 'all-pack Antarctic gems are counted exactly once');
assert.equal(run('packStats([classic,gem,aqGem]).oceania'), 1);
assert.equal(run('bundleOnlyStats([classic,gem,aqGem])'), 2, 'the Antarctic collection includes classics and gems');

run("owned = new Set(['oceania'])");
assert.equal(run('isLocked(gem)'), false, 'the matching regional pack unlocks its gem');
assert.equal(run('isLocked(classic)'), true, 'a regional pack cannot unlock Antarctica');
assert.equal(run('isLocked(aqGem)'), true, 'a regional pack cannot unlock Antarctic gems');

// Locked cards and detail sheets identify the offer without exposing title,
// place or description, including to group-view rendering paths that use the
// same safeTitle/cardHTML functions.
const card = run('cardHTML(classic)');
assert.match(card, /Bundle exclusive/);
for (const secret of ['Secret ice route', 'Secret base', 'Secret description']) {
  assert(!card.includes(secret), `locked card leaked ${secret}`);
}
run(`ADV=[classic]; bookingLink=()=>null; photosFor=()=>[]; renderSheet(classic.id)`);
const sheet = elements.get('#sheetBody').innerHTML;
assert.match(sheet, /Bundle exclusive/);
assert.match(sheet, /data-buy="all"/);
assert.match(sheet, /Travel, admission and guide fees are separate/);
assert(!/data-buy="(oceania|europe|north-america|asia|middle-east|south-america|africa)"/.test(sheet));
for (const secret of ['Secret ice route', 'Secret base', 'Secret description']) {
  assert(!sheet.includes(secret), `locked detail leaked ${secret}`);
}

run("owned = new Set(['all'])");
assert.equal(run('isLocked(classic)'), false);
assert.equal(run('isLocked(aqGem)'), false);
assert.equal(run('isLocked(gem)'), false);
assert.equal(run('safeTitle(classic)'), 'Secret ice route');

// An entirely locked catalogue remains browsable; it is not an empty place.
run("owned = new Set(); ADV=[classic,aqGem]; nav={level:'world'}; drawWorldMap=()=>{}; renderPlaces()");
assert.match(elements.get('#continentList').innerHTML,/Included with All Continents/);
assert.match(elements.get('#continentList').innerHTML,/Locked adventures/);
run("nav={level:'continent',continent:'Antarctica'}; renderPlaces()");
assert(!elements.get('#placeSub').textContent.includes('none mapped'));
assert.match(elements.get('#placeList').innerHTML,/country/);
assert.match(elements.get('#placeList').innerHTML,/Locked adventures/);
run("nav={level:'country',continent:'Antarctica',country:'AQ'}; renderPlaces()");
assert.equal(elements.get('#placeSub').textContent,'2 locked adventures');
assert(!elements.get('#placeList').innerHTML.includes('Coming soon'));

console.log('bundle access: passed (classic, Antarctic gem, regional gem, counters and locked views)');
