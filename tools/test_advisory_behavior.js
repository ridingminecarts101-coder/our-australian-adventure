'use strict';

// Focused regression for advisory-aware automatic discovery. This runs the
// real country advisory table and client helpers without opening a browser or
// creating any account or external state.
const assert = require('assert');
const fs = require('fs');
const vm = require('vm');

const appSource = fs.readFileSync('app.js', 'utf8');
const context = {
  console: { log() {}, warn() {}, error() {} },
  setTimeout, clearTimeout, queueMicrotask,
  crypto: require('crypto').webcrypto,
  location: { hostname: 'localhost', origin: 'http://localhost', pathname: '/', search: '' },
  history: { replaceState() {} }, URL, URLSearchParams,
  navigator: { onLine: true, userAgent: '', platform: '', maxTouchPoints: 0 },
  localStorage: { getItem: () => null, setItem() {}, removeItem() {}, clear() {} },
  document: { querySelector: () => null, querySelectorAll: () => [], createElement: () => ({}) },
  addEventListener() {}, confirm: () => true, prompt: () => null,
  fetch: async () => ({ ok: true, json: async () => [] }),
  Notification: { permission: 'denied' },
  OAA_CONFIG: { revenueCat: {} },
};
context.window = context;
context.Capacitor = { isNativePlatform: () => false, getPlatform: () => 'web', Plugins: {} };
vm.createContext(context);
vm.runInContext(fs.readFileSync('countries.js', 'utf8'), context, { filename: 'countries.js' });
vm.runInContext(fs.readFileSync('store.js', 'utf8'), context, { filename: 'store.js' });
vm.runInContext(appSource, context, { filename: 'app.js' });

const run = code => vm.runInContext(code, context);

// Avoid entries are excluded, ordinary and care entries stay eligible.
assert.equal(run("automaticDiscoveryAllowed({country:'AF'})"), false);
assert.equal(run("automaticDiscoveryAllowed({country:'CD'})"), false);
assert.equal(run("automaticDiscoveryAllowed({country:'TD'})"), false);
assert.equal(run("automaticDiscoveryAllowed({country:'IL'})"), true);
assert.equal(run("automaticDiscoveryAllowed({country:'AU'})"), true);

// Explicit detail views retain the saved warning and point to the verified
// authoritative destination index instead of constructing a country slug.
const avoidDetail = run("advisoryPanelHTML('AF')");
assert.match(avoidDetail, /Do not travel/);
assert.match(avoidDetail, /Armed conflict/);
assert.match(avoidDetail, /https:\/\/www\.smartraveller\.gov\.au\/destinations/);
assert.match(avoidDetail, /Check current advice on Smartraveller/);
assert.equal(run("advisoryPanelHTML('AU')"), '');
assert.match(run("advisoryPanelHTML('IL')"), /Take care/);

// Guard every automatic route. The catalogue's filtered() function deliberately
// does not use this helper, so explicitly browsed historical rows remain visible.
const previewRoute = appSource.slice(appSource.indexOf('async function previewReminder('),
  appSource.indexOf('async function toggleNotifications('));
const seasonalRoute = appSource.slice(appSource.indexOf('async function seasonalNudge('),
  appSource.indexOf('// ══════════════════════════════════════════════════════════════════════',
    appSource.indexOf('async function seasonalNudge(')));
const randomRoute = appSource.slice(appSource.indexOf('// Random pick'),
  appSource.indexOf("$('#progressViewBtn').onclick"));
for (const [name, source] of [['previewReminder', previewRoute],
  ['seasonalNudge', seasonalRoute], ['random pick', randomRoute]]) {
  assert(source.includes('automaticDiscoveryAllowed(a)'), `${name} must exclude avoid advisories`);
}
const filteredStart = appSource.indexOf('function filtered()');
const filteredEnd = appSource.indexOf('function cardHTML(', filteredStart);
assert(!appSource.slice(filteredStart, filteredEnd).includes('automaticDiscoveryAllowed'),
  'explicit catalogue browsing must retain avoid entries');
assert((appSource.match(/advisoryPanelHTML\(a\.country\)/g) || []).length >= 2,
  'both locked and unlocked detail sheets must show advisories');

console.log('advisory behavior: 15 passed');
