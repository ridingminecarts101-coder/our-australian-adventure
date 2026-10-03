'use strict';
// Exercises the real client date editor and outbox without a live account.
const assert = require('node:assert/strict');
const fs = require('node:fs');
const vm = require('node:vm');

const values = new Map(), elements = new Map(), notices = [];
function element(key) {
  if (!elements.has(key)) {
    const classes = new Set();
    elements.set(key, {
      value: '', innerHTML: '', textContent: '', dataset: {},
      classList: { add: x => classes.add(x), remove: x => classes.delete(x),
        contains: x => classes.has(x), toggle: (x, yes) => yes ? classes.add(x) : classes.delete(x) },
      setAttribute() {}, addEventListener() {}, focus() {},
      querySelector: () => element('nested'),
    });
  }
  return elements.get(key);
}
const context = {
  console, setTimeout, clearTimeout, queueMicrotask,
  crypto: require('node:crypto').webcrypto, URL, URLSearchParams,
  location: { hostname: 'localhost', origin: 'http://localhost', pathname: '/', search: '' },
  navigator: { onLine: false, userAgent: '' }, history: { replaceState() {} },
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
for (const file of ['store.js', 'app.js']) {
  vm.runInContext(fs.readFileSync(file, 'utf8'), context, { filename: file });
}
const run = code => vm.runInContext(code, context);
context.recordNotice = message => notices.push(message);
run(`userId='account-a'; who='Alice'; authGeneration=1; online=false; sb=null;
  renderAll=()=>{}; toast=recordNotice; progressView='personal';`);

for (const good of ['1900-01-01', '2000-02-29', '2100-12-31']) {
  assert.equal(run(`validCompletionDay('${good}')`), true, good);
}
for (const bad of ['', '1899-12-31', '1900-02-29', '2026-02-30', '2100-02-29',
  '2101-01-01', '2026-1-01', 'not-a-date']) {
  assert.equal(run(`validCompletionDay('${bad}')`), false, bad);
}
assert.equal(run(`fmtCompletionDate({completed_on:'1900-01-01',
  completed_at:'1899-12-31T23:00:00Z'})`), '1 Jan 1900',
'a chosen calendar date must be stable even if an instant would display differently');
assert.match(run(`completionDateEditor({completed:true,completed_on:'2100-12-31'})`),
  /min="1900-01-01" max="2100-12-31"/);

// In Group view the aggregate can belong to Bob. The editor must modify only
// Alice's row and preserve her completion attribution and private note.
run(`ADV=[{id:17,title:'A walk',country:'AU',continent:'Oceania'}];
  progressView='group'; personalCacheReady=true;
  personalProgress=new Map([[17,{adventure_id:17,completed:true,
    completed_at:'2026-10-03T06:00:00Z',completed_by_id:userId,
    completed_by:'Alice',memory:'Private memory'}]]);
  progress=new Map([[17,{adventure_id:17,completed:true,
    completed_at:'2026-10-04T06:00:00Z',completed_by_id:'account-b',
    completed_by:'Bob'}]]);`);
element('#completedOnInput').value = '1900-02-29';
run('saveCompletedDate(17)');
assert.equal(run('personalProgress.get(17).completed_on'), undefined);
element('#completedOnInput').value = '1900-01-01';
run('saveCompletedDate(17)');
assert.equal(run('personalProgress.get(17).completed_on'), '1900-01-01');
assert.equal(run('personalProgress.get(17).completed_at'), '1900-01-01T12:00:00.000Z');
assert.equal(run('personalProgress.get(17).completed_by_id'), 'account-a');
assert.equal(run('personalProgress.get(17).memory'), 'Private memory');
assert.equal(run('readLS(LS.outbox,[])[0].completed_on'), '1900-01-01');

// A manually backfilled stamp shows its true calendar day and no fabricated
// time, and changing the day changes the country ordering.
run(`ADV=[{id:17,title:'A walk',country:'AU',continent:'Oceania'},
  {id:18,title:'A paddle',country:'NZ',continent:'Oceania'}];
  personalProgress.set(18,{adventure_id:18,completed:true,
    completed_at:'2025-01-01T08:00:00Z'});
  progress.set(18,personalProgress.get(18)); renderPassport();`);
const stamps = element('#stampGrid').innerHTML;
assert(stamps.indexOf('AU') < stamps.indexOf('NZ'), 'backfilled country moves to the front');
assert.match(stamps, /01 Jan 1900/);
assert.doesNotMatch(stamps.slice(stamps.indexOf('AU'), stamps.indexOf('NZ')), /stamp-time/,
  'a backfilled date has no known time');

// The queued date and owner survive an offline edit and reach the normal
// progress upsert. A successful sync clears only the queued revision.
const writes = [];
context.capture = row => { writes.push(row); return Promise.resolve({ error: null }); };
run(`online=true; sb={from:table=>({upsert:row=>capture(row)})};`);
(async () => {
  await run('flushOutbox()');
  assert.equal(writes.length, 1);
  assert.equal(writes[0].user_id, 'account-a');
  assert.equal(writes[0].completed_on, '1900-01-01');
  assert.equal(writes[0].completed_at, '1900-01-01T12:00:00.000Z');
  assert.equal(run('readLS(LS.outbox,[]).length'), 0);
  run(`ADV=[{id:17,title:'A walk',place:'The path',country:'AU',continent:'Oceania',
    category:'Hiking',difficulty:2,cost:0,duration:'Half day',season:'Year-round',dog_friendly:'no'}];
    bookingLink=()=>null; photosFor=()=>[]; hydrateThumbs=()=>{};
    advisoryPanelHTML=()=>''; renderTripPicker=()=>'';`);
  run('renderSheet(17)');
  assert.match(element('#sheetBody').innerHTML, /id="completedOnInput"/);
  assert.match(element('#sheetBody').innerHTML, /value="1900-01-01"/);
  run(`ADV[0].availability={status:'unavailable'}; availabilityPanelHTML=()=>'';
    renderSheet(17);`);
  assert.match(element('#sheetBody').innerHTML, /id="completedOnInput"/,
    'an existing completion on a paused listing can still be corrected');
  run('delete ADV[0].availability');
  run('online=false; sb=null; toggleDone(17)');
  assert.equal(run('personalProgress.get(17).completed'), false);
  assert.equal(run('personalProgress.get(17).completed_on'), null);
  assert.equal(run('personalProgress.get(17).completed_at'), null);
  assert.equal(run('readLS(LS.outbox,[])[0].completed_on'), null);
  run(`progress.set(17,{adventure_id:17,completed:true,completed_at:'2026-10-04T06:00:00Z',
    completed_by_id:'account-b',completed_by:'Bob'}); renderSheet(17);`);
  assert.match(element('#sheetBody').innerHTML, /Ticked off by Bob/);
  assert.match(element('#sheetBody').innerHTML, />\s*Mark as completed\s*</);
  assert.doesNotMatch(element('#sheetBody').innerHTML, /id="completedOnInput"/,
    'another member completion must not make an editable date appear');
  assert(notices.includes('Completion date saved'));
  console.log('PASS: date boundaries, group ownership, offline sync, stamp order and untick');
})().catch(error => { console.error(error); process.exitCode = 1; });
