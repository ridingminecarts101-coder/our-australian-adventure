'use strict';

// Offline execution of the real navigation, catalogue and trip-link functions.
const assert = require('node:assert/strict');
const fs = require('node:fs');
const vm = require('node:vm');

function harness() {
  const elements = new Map(), listeners = new Map(), pushed = [], replaced = [];
  const values = new Map();
  const element = key => {
    if (!elements.has(key)) {
      const classes = new Set(['hidden']);
      const attrs = new Map();
      elements.set(key, {
        innerHTML: '', textContent: '', value: '', disabled: false, dataset: {}, style: {},
        classList: { add: (...xs) => xs.forEach(x => classes.add(x)),
          remove: (...xs) => xs.forEach(x => classes.delete(x)),
          contains: x => classes.has(x),
          toggle: (x, on) => on ? classes.add(x) : classes.delete(x) },
        addEventListener(name, fn) { this.listeners ||= {}; this.listeners[name] = fn; },
        setAttribute(k, v) { attrs.set(k, String(v)); }, getAttribute: k => attrs.get(k) || null,
        querySelector: () => element(`${key}:nested`), querySelectorAll: () => [], click() {},
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
    document: { querySelector: element, querySelectorAll: () => [], createElement: () => element('new'),
      body: element('body') },
    localStorage: { getItem: k => values.get(k) || null,
      setItem: (k, v) => values.set(k, String(v)), removeItem: k => values.delete(k) },
    addEventListener(name, fn) { if (!listeners.has(name)) listeners.set(name, []); listeners.get(name).push(fn); },
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
  run('globalThis.realRenderList=renderList; renderPlaces=()=>{}; renderList=()=>{}; buildFilterOptions=()=>{}; renderTrips=()=>{}; toast=t=>{globalThis.lastToast=t};');
  return { context, run, elements, listeners, pushed, replaced, values };
}

async function main() {
  const all = JSON.parse(fs.readFileSync('data/adventures.json', 'utf8'));
  {
    const h = harness();
    h.run(`ADV=${JSON.stringify(all)}; owned=new Set(['all']); progress=new Map();
      nav={level:'adventures',continent:'Africa',country:null,admin1:null};
      Object.assign(filters,{quick:'all',q:'tetouan',st:'All',cat:'All',diff:5,cost:4,dog:'All'});`);
    const ascii = h.run('filtered().length');
    h.run("filters.q='tétouan'");
    assert(ascii > 0 && ascii === h.run('filtered().length'), 'search must fold common unaccented input');

    const fijiTotal = all.filter(a => a.country === 'FJ').length;
    h.run("nav={level:'adventures',continent:'Oceania',country:'FJ',admin1:null}; filters.q=''; renderList=realRenderList;");
    h.run('renderList()');
    assert.equal(h.elements.get('#resultCount').textContent, `${fijiTotal} adventures`);
    h.run("filters.q='beach'; renderList()");
    assert.match(h.elements.get('#resultCount').textContent, new RegExp(` of ${fijiTotal}(?: |$)`));

    const paid = all.find(a => a.hidden_gem && a.pack && a.pack !== 'all');
    h.run(`ADV=[${JSON.stringify(paid)}]; owned=new Set(); progress=new Map([[${paid.id},{adventure_id:${paid.id},completed:true}]]);`);
    assert.equal(h.run('doneCount()'), 0, 'locked completions must not exceed the countable denominator');
    assert.equal(h.run('catalogueHas(()=>true)'), true, 'locked catalogue rows remain navigable');

    const disabled = h.run("placeRow({label:'Unmapped',sub:'Not mapped',count:0,total:0,done:0,onClick:null})");
    assert.match(disabled, /disabled aria-disabled="true"/);
    assert.doesNotMatch(disabled, /data-go=/);
  }

  {
    const h = harness();
    h.run(`ADV=${JSON.stringify(all)}; owned=new Set(['all']); progress=new Map(); wireBrowserNavigation();`);
    h.run("goTo('continent',{continent:'Oceania'}); goTo('country',{continent:'Oceania',country:'FJ'});");
    assert.equal(h.pushed.length, 2);
    const pop = h.listeners.get('popstate')[0];
    pop({ state: { wayfinderNav: { level: 'continent', continent: 'Oceania' } } });
    assert.equal(h.run('nav.level'), 'continent');
    assert.equal(h.pushed.length, 2, 'popstate restoration must not create a new history entry');
    pop({ state: { wayfinderNav: { level: 'adventures', continent: 'Oceania', country: 'FJ', admin1: 'bogus' } } });
    assert.equal(h.run('nav.level'), 'world', 'invalid restored routes must fail closed');
  }

  {
    const h = harness(); let back, exits = 0;
    h.context.Capacitor = { isNativePlatform: () => true, getPlatform: () => 'android', Plugins: {
      App: { addListener(name, fn) { if (name === 'backButton') back = fn; }, exitApp() { exits++; } },
    } };
    h.context.document.querySelector('.tab.active').dataset.tab = 'tab-list';
    h.run(`ADV=${JSON.stringify(all)}; wireNative(); nav={level:'country',continent:'Oceania',country:'FJ',admin1:null};`);
    back();
    assert.equal(h.run('nav.level'), 'islands', 'island country Back must return to Island nations');
    back();
    assert.equal(h.run('nav.level'), 'continent', 'Island nations Back must return to its continent');
    assert.equal(exits, 0);
  }

  {
    const h = harness(), tripId = '11111111-1111-4111-8111-111111111111';
    let rows = [{ id: tripId, name: 'Remote owner trip', user_id: 'owner-a', adventure_ids: [] }];
    h.context.from = table => {
      assert.equal(table, 'trips'); const filters = {};
      const q = { select() { return q; }, eq(k, v) { filters[k] = v; return q; }, order() { return q; },
        limit(n) { filters.limit = n; return q; }, gt(k, v) { filters.after = v; return q; },
        then(ok, bad) { return Promise.resolve({ data: rows.filter(r => !filters.after || r.id > filters.after), error: null }).then(ok, bad); } };
      return q;
    };
    h.run(`ADV=${JSON.stringify(all)}; sb={from}; online=true; userId=null; authGeneration=1;
      trips=[]; openTripSheet=id=>{globalThis.openedTrip=id}; openDeepLink('?trip=${tripId}');`);
    assert.equal(h.run('pendingTripDeepLink.owner'), null, 'a cold native link may wait without binding data to an account');
    h.run("userId='owner-a'; accountUser={id:userId};");
    await h.run('pullTrips()');
    assert.equal(h.run('openedTrip'), tripId, 'the current owner trip opens after the remote pull');
    assert.equal(h.run('pendingTripDeepLink'), null);

    h.run(`trips=[]; openedTrip=null; openDeepLink('?trip=${tripId}'); userId='owner-b'; authGeneration++; trips=[{id:'${tripId}'}]; resolvePendingTripDeepLink(true);`);
    assert.equal(h.run('openedTrip'), null, 'a pending link cannot cross an account generation');
    assert.equal(h.run('pendingTripDeepLink'), null);
  }

  {
    const h = harness();
    const avoid = all.find(a => a.country === 'CD');
    h.run(`ADV=[${JSON.stringify(avoid)}]; owned=new Set(['all']); progress=new Map();
      nav={level:'adventures',continent:null,country:null,admin1:null};
      Object.assign(filters,{quick:'all',q:'',st:'All',cat:'All',diff:5,cost:4,dog:'All'});
      openRandomAdventure();`);
    assert.match(h.run('lastToast'), /travel advice/, 'avoid-only exhaustion must not claim locked gems');
  }

  console.log('PASS: navigation history, island Back, owner-bound trip links, locked routes, counts, search, disabled routes and random exhaustion');
}

main().catch(error => { console.error(error); process.exitCode = 1; });
