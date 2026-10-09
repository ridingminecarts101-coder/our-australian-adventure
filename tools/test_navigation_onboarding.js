'use strict';

// Focused first-use navigation contracts: visible parent controls and world search.
const assert = require('node:assert/strict');
const fs = require('node:fs');
const vm = require('node:vm');

const html = fs.readFileSync('index.html', 'utf8');
const css = fs.readFileSync('styles.css', 'utf8');
for (const id of ['hereBtn', 'worldSearchBtn', 'placeBackBtn', 'listBackBtn', 'search']) {
  assert.equal((html.match(new RegExp(`id="${id}"`, 'g')) || []).length, 1, `${id} appears once`);
}
assert(html.indexOf('id="hereBtn"') < html.indexOf('id="worldSearchBtn"'),
  'world search sits directly after Near me');
assert.match(html, /id="worldSearchBtn"[^>]*type="button"[^>]*>[^<]*Search all adventures/);
assert.match(html, /id="placeBackBtn"[^>]*type="button"/);
assert.match(html, /id="listBackBtn"[^>]*type="button"/);
assert.match(css, /\.world-search\s*\{[^}]*min-height:\s*44px/s);
assert.match(css, /\.browse-back\s*\{[^}]*min-height:\s*44px/s);

function harness() {
  const elements = new Map(), collections = new Map(), listeners = new Map();
  const pushed = [], replaced = [], values = new Map();
  const element = key => {
    if (!elements.has(key)) {
      const classes = new Set(['hidden']), attrs = new Map();
      elements.set(key, {
        innerHTML: '', textContent: '', value: '', disabled: false, dataset: {}, style: {}, focused: 0,
        classList: {
          add: (...xs) => xs.forEach(x => classes.add(x)),
          remove: (...xs) => xs.forEach(x => classes.delete(x)),
          contains: x => classes.has(x),
          toggle: (x, on) => on ? classes.add(x) : classes.delete(x),
        },
        addEventListener() {},
        setAttribute(k, v) { attrs.set(k, String(v)); },
        getAttribute(k) { return attrs.get(k) || null; },
        querySelector: () => element(`${key}:nested`),
        querySelectorAll: () => [],
        focus() { this.focused++; },
        click() {},
      });
    }
    return elements.get(key);
  };
  const history = {
    state: null,
    pushState(state) { this.state = state; pushed.push(state); },
    replaceState(state) { this.state = state; replaced.push(state); },
  };
  const context = {
    console: { log() {}, warn() {}, error() {} }, setTimeout, clearTimeout, queueMicrotask,
    crypto: require('node:crypto').webcrypto, URL, URLSearchParams,
    location: { hostname: 'localhost', origin: 'http://localhost', pathname: '/', search: '' },
    history, navigator: { onLine: true, userAgent: '', platform: '', maxTouchPoints: 0 },
    document: {
      querySelector: element,
      querySelectorAll: selector => collections.get(selector) || [],
      createElement: () => element('new'),
      body: element('body'),
    },
    localStorage: {
      getItem: key => values.get(key) || null,
      setItem: (key, value) => values.set(key, String(value)),
      removeItem: key => values.delete(key),
    },
    addEventListener(name, fn) {
      if (!listeners.has(name)) listeners.set(name, []);
      listeners.get(name).push(fn);
    },
    confirm: () => true, prompt: () => null, Notification: { permission: 'denied' },
    fetch: async () => { throw new Error('network disabled'); }, OAA_CONFIG: { revenueCat: {} },
  };
  context.window = context;
  context.window.scrollTo = () => {};
  context.Capacitor = { isNativePlatform: () => false, getPlatform: () => 'web', Plugins: {} };
  vm.createContext(context);
  for (const file of ['countries.js', 'world.js', 'store.js', 'partners.js', 'app.js']) {
    vm.runInContext(fs.readFileSync(file, 'utf8'), context, { filename: file });
  }
  const run = code => vm.runInContext(code, context);
  run('globalThis.realRenderList=renderList; renderPlaces=()=>{}; renderList=()=>{}; buildFilterOptions=()=>{};');
  return { context, run, elements, collections, listeners, pushed, replaced, element };
}

const h = harness();
const adventures = JSON.parse(fs.readFileSync('data/adventures.json', 'utf8'));
h.run(`ADV=${JSON.stringify(adventures)}; owned=new Set(['all']); progress=new Map();`);

assert.deepEqual(
  JSON.parse(h.run("JSON.stringify(safeNavigationState({level:'adventures'}))")),
  { level: 'adventures', continent: null, country: null, admin1: null },
  'world-wide adventure search is a valid restorable route');

h.run("nav={level:'adventures',continent:'Oceania',country:'AU',admin1:'NSW'}");
assert.deepEqual(JSON.parse(h.run('JSON.stringify(browseParent())')),
  { level: 'country', continent: 'Oceania', country: 'AU', admin1: null },
  'a state adventure list returns to its country state list');
h.run('renderBrowseBack()');
assert.equal(h.elements.get('#listBackBtn').textContent, '← Back to Australia');

h.run('browseBack()');
assert.equal(h.run('nav.level'), 'country');
assert.equal(h.pushed.length, 1, 'visible Back creates browser history like other in-app navigation');
assert.equal(h.pushed[0].wayfinderNav.level, 'country');

h.run("nav={level:'adventures',continent:'Oceania',country:'FJ',admin1:null}");
assert.equal(h.run('browseParent().level'), 'islands', 'an island adventure list returns to Island nations');
h.run("nav={level:'adventures',continent:'Europe',country:'GB',admin1:null}");
assert.equal(h.run('browseParent().level'), 'continent', 'a direct mainland country list returns to its continent');
h.run("nav={level:'adventures',continent:null,country:null,admin1:null}");
assert.equal(h.run('browseParent().level'), 'world', 'world search results return to the world screen');

const allChip = h.element('allChip');
allChip.dataset.quick = 'all';
const todoChip = h.element('todoChip');
todoChip.dataset.quick = 'todo';
todoChip.classList.add('on');
h.collections.set('#quickChips .chip', [allChip, todoChip]);
h.elements.set('#quickChips .chip[data-quick="all"]', allChip);
h.element('#search').value = 'old query';
h.run("Object.assign(filters,{quick:'done',q:'old query',st:'NSW',cat:'Nature',diff:2,cost:1,dog:'yes'});");
h.run('openWorldSearch()');
assert.deepEqual(JSON.parse(h.run('JSON.stringify(filters)')),
  { quick: 'all', q: '', st: 'All', cat: 'All', diff: 5, cost: 'All', dog: 'All' },
  'world search opens with an unfiltered catalogue');
assert.deepEqual(JSON.parse(h.run('JSON.stringify(nav)')),
  { level: 'adventures', continent: null, country: null, admin1: null });
assert.equal(h.elements.get('#search').value, '');
assert.equal(h.elements.get('#search').focused, 1, 'the existing search field receives focus');
assert.equal(allChip.classList.contains('on'), true);
assert.equal(todoChip.classList.contains('on'), false);
assert.equal(allChip.getAttribute('aria-pressed'), 'true');

const many = Array.from({ length: 5000 }, (_, index) => ({
  id: 100000 + index,
  title: `Match adventure ${index}`,
  place: `Match place ${index}`,
  region: 'Sydney',
  description: 'A global match used to verify bounded rendering.',
  continent: 'Oceania', country: 'AU', admin1: 'NSW', category: 'Nature',
  difficulty: 1, cost: 0, dog_friendly: 'no', hidden_gem: false, bundle_only: false,
}));
h.run(`ADV=${JSON.stringify(many)}; owned=new Set(['all']); progress=new Map();
  nav={level:'adventures',continent:null,country:null,admin1:null};
  Object.assign(filters,{quick:'all',q:'',st:'All',cat:'All',diff:5,cost:'All',dog:'All'});
  renderList=realRenderList; renderList();`);
assert.equal(h.elements.get('#resultCount').textContent, 'Search all adventures');
assert.match(h.elements.get('#list').innerHTML, /Type a place, country or activity above to start/);
assert.equal((h.elements.get('#list').innerHTML.match(/<article class="card/g) || []).length, 0,
  'an empty global query does not materialize the whole catalogue');

h.run("filters.q='match'; renderList()");
assert.equal(h.elements.get('#resultCount').textContent, '5000 adventures',
  'global result count describes every match rather than only rendered cards');
assert.equal((h.elements.get('#list').innerHTML.match(/<article class="card/g) || []).length, 200,
  'global search renders at most 200 cards');
assert.match(h.elements.get('#list').innerHTML,
  /Showing the first 200 matches\. Add a country or place to narrow your search\./);

const countryRows = many.slice(0, 205);
h.run(`ADV=${JSON.stringify(countryRows)};
  nav={level:'adventures',continent:'Oceania',country:'AU',admin1:null}; filters.q=''; renderList();`);
assert.equal(h.elements.get('#resultCount').textContent, '205 adventures');
assert.equal((h.elements.get('#list').innerHTML.match(/<article class="card/g) || []).length, 205,
  'country-scoped lists remain complete when they contain more than 200 adventures');
assert.doesNotMatch(h.elements.get('#list').innerHTML, /Showing the first 200 matches/);

const browser = harness();
browser.run(`ADV=${JSON.stringify(adventures)}; renderPlaces=()=>{}; renderList=()=>{};
  buildFilterOptions=()=>{}; wireBrowserNavigation(); goTo('adventures');`);
assert.equal(browser.pushed.at(-1).wayfinderNav.level, 'adventures');
assert.equal(browser.pushed.at(-1).wayfinderNav.continent, null);
const pop = browser.listeners.get('popstate')[0];
pop({ state: { wayfinderNav: { level: 'world', continent: null, country: null, admin1: null } } });
assert.equal(browser.run('nav.level'), 'world');
assert.equal(browser.pushed.length, 1, 'restoring World does not add another history entry');

console.log('PASS: visible hierarchical Back and focusable world-wide search preserve browser history');
