'use strict';

// Runs the real adventure sheet with verified links and locked/owned gem fixtures.
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
for (const file of ['countries.js', 'world.js', 'store.js', 'booking-links.js', 'partners.js', 'app.js']) {
  vm.runInContext(fs.readFileSync(file, 'utf8'), context, { filename: file });
}
const run = code => vm.runInContext(code, context);


const catalogue = JSON.parse(fs.readFileSync('data/adventures.json','utf8'));
context.catalogue=catalogue;
run(`ADV=catalogue; owned=new Set(['all']); userId='test-owner'; who='Test traveller';
 progress=new Map(); personalProgress=new Map(); progressView='personal';
 photosFor=()=>[]; hydrateThumbs=()=>{};
 OAA_CONFIG.partners={viatorEnabled:true,viatorPartnerId:'P00321485'};`);
run('renderSheet(529)');
const html = elements.get('#sheetBody').innerHTML;
assert.match(html, /View experience on Viator/);
assert.match(html, /pid=P00321485&amp;mcid=42383&amp;medium=link&amp;campaign=wayfinder/);
assert.match(html, /underground glowworm boat ride/);
assert.ok(html.indexOf('data-act="short"') < html.indexOf('class="btn-ghost booking"'));
assert.ok(html.indexOf('class="btn-ghost booking"') < html.indexOf('data-act="share"'));
assert.match(html, /We may earn a commission/);
run('renderSheet(681)');
assert.match(elements.get('#sheetBody').innerHTML,/View matching option on Viator/);
assert.match(elements.get('#sheetBody').innerHTML,/from Apia/);
run(`ADV=ADV.map(a=>a.id===529?{...a,hidden_gem:true,pack:'oceania'}:a);
 owned=new Set(); renderSheet(529)`);
assert.doesNotMatch(elements.get('#sheetBody').innerHTML,/class="btn-ghost booking"/);
run(`owned=new Set(['oceania']); renderSheet(529)`);
assert.match(elements.get('#sheetBody').innerHTML,/View experience on Viator/);
run('OAA_CONFIG.partners.viatorEnabled=false; renderSheet(529)');
assert.doesNotMatch(elements.get('#sheetBody').innerHTML,/class="btn-ghost booking"/);
if (process.argv.includes('--preview')) {
 fs.mkdirSync('build',{recursive:true});
 fs.writeFileSync('build/viator-preview.html','<!doctype html><html lang="en"><meta charset="utf-8"><meta name="viewport" content="width=device-width,initial-scale=1"><title>Wayfinder Viator development preview</title><link rel="stylesheet" href="../styles.css"><body><main style="max-width:560px;margin:auto;padding:20px"><p>Development preview · no accounts or bookings</p>'+html+'</main></body></html>');
}
console.log('Real adventure-sheet rendering, link placement, disclosure, trip details and disabled-state checks passed');
