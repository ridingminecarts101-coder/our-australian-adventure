'use strict';

// Deterministic coverage of the real Near me implementation. No device location
// or provider request leaves this process.
const assert = require('node:assert/strict');
const fs = require('node:fs');
const vm = require('node:vm');

const deferred = () => {
  let resolve, reject;
  const promise = new Promise((yes, no) => { resolve = yes; reject = no; });
  return { promise, resolve, reject };
};
const turn = () => new Promise(resolve => setImmediate(resolve));
const plain = value => JSON.parse(JSON.stringify(value));

function harness() {
  const elements = new Map(), values = new Map(), effects = [], timers = new Map();
  let nextTimer = 1;
  const element = key => {
    if (!elements.has(key)) {
      const classes = new Set();
      elements.set(key, {
        innerHTML: '', textContent: '', value: '', disabled: false, dataset: {}, style: {},
        classList: { add: (...xs) => xs.forEach(x => classes.add(x)),
          remove: (...xs) => xs.forEach(x => classes.delete(x)),
          contains: x => classes.has(x), toggle: (x, on) => on ? classes.add(x) : classes.delete(x) },
        addEventListener() {}, setAttribute() {}, querySelector: () => null, querySelectorAll: () => [],
      });
    }
    return elements.get(key);
  };
  const context = {
    console: { log() {}, warn() {}, error() {} }, queueMicrotask,
    setTimeout(fn, ms) { const id = nextTimer++; timers.set(id, { fn, ms }); return id; },
    clearTimeout(id) { timers.delete(id); },
    AbortController, crypto: require('node:crypto').webcrypto, URL, URLSearchParams,
    location: { hostname: 'localhost', origin: 'http://localhost', pathname: '/', search: '' },
    history: { state: null, pushState() {}, replaceState() {} },
    navigator: { onLine: true, userAgent: '', platform: '', maxTouchPoints: 0 },
    document: { querySelector: element, querySelectorAll: () => [], createElement: () => element('new'),
      body: element('body') },
    localStorage: { getItem: key => values.get(key) || null,
      setItem: (key, value) => values.set(key, String(value)), removeItem: key => values.delete(key) },
    addEventListener() {}, confirm: () => true, prompt: () => null,
    Notification: { permission: 'denied' }, OAA_CONFIG: { revenueCat: {} }, effects,
    fetch: async () => { throw new Error('network disabled'); },
  };
  context.window = context;
  context.window.scrollTo = () => {};
  context.Capacitor = { isNativePlatform: () => false, getPlatform: () => 'web', Plugins: {} };
  vm.createContext(context);
  for (const file of ['countries.js', 'world.js', 'store.js', 'partners.js', 'app.js']) {
    vm.runInContext(fs.readFileSync(file, 'utf8'), context, { filename: file });
  }
  const run = code => vm.runInContext(code, context);
  run(`ADV=[
    {id:1,continent:'Oceania',country:'AU',admin1:'SA',hidden_gem:false},
    {id:2,continent:'Oceania',country:'AU',admin1:'VIC',hidden_gem:false},
    {id:3,continent:'Oceania',country:'AU',admin1:'AUS',hidden_gem:false},
    {id:4,continent:'Oceania',country:'NZ',admin1:'Manawatū-Whanganui',hidden_gem:false},
    {id:5,continent:'North America',country:'CA',admin1:'Québec',hidden_gem:false},
    {id:6,continent:'North America',country:'CA',admin1:'Quebec',hidden_gem:false}
  ]; userId='owner-a'; authGeneration=1; owned=new Set(['all']);
  renderPlaces=()=>{}; renderList=()=>{}; buildFilterOptions=()=>{}; renderTrips=()=>{};
  toast=message=>effects.push({kind:'toast',message});
  goTo=(level,opts={})=>{effects.push({kind:'nav',level,opts});return true};`);
  return { context, run, elements, values, effects, timers, element,
    fireTimer(ms) {
      const found = [...timers].find(([, timer]) => timer.ms === ms);
      assert(found, `expected a ${ms}ms timer`);
      timers.delete(found[0]);
      found[1].fn();
    } };
}

function navEffects(h) { return h.effects.filter(effect => effect.kind === 'nav'); }

async function main() {
  {
    const h = harness();
    let nativeOptions;
    h.context.Capacitor = { isNativePlatform: () => true, Plugins: { Geolocation: {
      getCurrentPosition(options) {
        nativeOptions = options;
        return Promise.resolve({ coords: { latitude: -34.9285, longitude: 138.6007, accuracy: 23 } });
      },
    } } };
    h.context.navigator.geolocation = { getCurrentPosition() { assert.fail('native must use the plugin'); } };
    assert.deepEqual(plain(await h.run('locate()')), { lat: -34.9285, lon: 138.6007, accuracy: 23 });
    assert.deepEqual(plain(nativeOptions), { enableHighAccuracy: false, timeout: 12000, maximumAge: 0 },
      'native lookup requests a fresh, one-shot coarse fix');
  }

  {
    const h = harness();
    let webOptions;
    h.context.navigator.geolocation = { getCurrentPosition(success, _failure, options) {
      webOptions = options;
      success({ coords: { latitude: -33.86, longitude: 151.21, accuracy: 41 } });
    } };
    assert.deepEqual(plain(await h.run('locate()')), { lat: -33.86, lon: 151.21, accuracy: 41 });
    assert.deepEqual(plain(webOptions), { enableHighAccuracy: false, timeout: 12000, maximumAge: 0 },
      'web lookup also rejects a cached location');
  }

  {
    const h = harness();
    h.context.Capacitor = { isNativePlatform: () => true, Plugins: { Geolocation: {
      getCurrentPosition: () => Promise.reject({ code: 'OS-PLUG-GLOC-0003' }),
    } } };
    await assert.rejects(h.run('locate()'), /Location access is unavailable/,
      'native permission denial has a manual-browsing recovery message');
    h.context.Capacitor = { isNativePlatform: () => false, Plugins: {} };
    h.context.navigator.geolocation = { getCurrentPosition(_success, failure) {
      failure({ code: 1, PERMISSION_DENIED: 1 });
    } };
    await assert.rejects(h.run('locate()'), /Location is turned off for Wayfinder/,
      'web permission denial remains distinct from a failed fix');
  }

  {
    const h = harness();
    h.context.fetch = async () => ({ ok: true, json: async () => ({
      countryCode: 'au', principalSubdivision: 'Victoria', principalSubdivisionCode: 'au-sa',
    }) });
    const here = JSON.parse(await h.run('whereAmI(-34.9285,138.6007).then(JSON.stringify)'));
    assert.deepEqual(here, {
      continent: 'Oceania', country: 'AU', region: 'Victoria', regionCode: 'au-sa',
    }, 'provider country is normalized and subdivision code is retained');
    assert.equal(h.run("matchRegion('AU', 'Victoria', 'au-sa')"), 'SA',
      'matching ISO code takes precedence over a conflicting localized name');
    assert.equal(h.run("matchRegion('AU', 'South Austrália', 'NZ-SA')"), 'SA',
      'a mismatched ISO country prefix is ignored before accent-folded alias matching');
    assert.equal(h.run("matchRegion('NZ', 'Manawatu-Whanganui')"), 'Manawatū-Whanganui',
      'accent-folded exact names remain supported');
    assert.equal(h.run("matchRegion('CA', 'Quebec')"), null,
      'two catalogue labels that normalize identically are ambiguous');
    assert.equal(h.run("matchRegion('AU', 'South Australian coast', 'NZ-SA')"), null,
      'unknown names do not substring-match a state');
  }

  {
    const h = harness();
    h.context.fetch = async () => ({ ok: false });
    assert.deepEqual(JSON.parse(await h.run('whereAmI(-34.9,138.6).then(JSON.stringify)')),
      { continent: 'Oceania', approximate: true }, 'HTTP failure uses only the offline continent');
    h.context.fetch = async () => ({ ok: true, json: async () => ({ countryCode: 'zz' }) });
    assert.deepEqual(JSON.parse(await h.run('whereAmI(-34.9,138.6).then(JSON.stringify)')),
      { continent: 'Oceania', approximate: true }, 'unknown provider country is not trusted');
  }

  {
    const h = harness();
    h.context.fetch = (_url, { signal }) => new Promise((_resolve, reject) => {
      signal.addEventListener('abort', () => reject(new Error('aborted')), { once: true });
    });
    const pending = h.run('whereAmI(-34.9,138.6)');
    h.fireTimer(8000);
    assert.deepEqual(JSON.parse(JSON.stringify(await pending)),
      { continent: 'Oceania', approximate: true }, 'manual timeout aborts and returns offline fallback');
  }

  {
    const h = harness();
    let confirmations = 0;
    h.context.confirm = () => { confirmations++; return false; };
    h.run("locate=async()=>{effects.push({kind:'locate'})}; whereAmI=async()=>{effects.push({kind:'vendor'})}");
    await h.run('jumpToHere()');
    assert.equal(confirmations, 1);
    assert.equal(h.effects.length, 0, 'cancellation performs no device or provider request');
    assert.equal(h.elements.has('#hereBtn'), false, 'cancellation does not mutate the button');
  }

  {
    const h = harness(), gate = deferred();
    h.context.locationGate = gate;
    h.run(`locate=()=>{effects.push({kind:'locate'});return locationGate.promise};
      whereAmI=async()=>({continent:'Oceania',country:'AU',region:'South Australia',regionCode:'AU-SA'})`);
    const first = h.run('jumpToHere()');
    const second = h.run('jumpToHere()');
    await turn();
    assert.equal(h.effects.filter(effect => effect.kind === 'locate').length, 1,
      'a repeated tap while busy cannot launch another lookup');
    assert.equal(h.element('#hereBtn').disabled, true);
    gate.resolve({ lat: -34.9, lon: 138.6, accuracy: 20 });
    await Promise.all([first, second]);
    assert.deepEqual(plain(navEffects(h)[0]), {
      kind: 'nav', level: 'adventures',
      opts: { continent: 'Oceania', country: 'AU', admin1: 'SA' },
    });
    assert.equal(h.element('#hereBtn').disabled, false);
    assert.equal(h.element('#hereBtn').textContent, '📍 Near me');
    assert.equal(h.run('jumpToHere.busy'), false);
    assert.equal(h.run('lastFix'), null, 'the coordinate fix is discarded after navigation');
    assert.equal(h.values.size, 0, 'Near me does not persist coordinates');
  }

  {
    const h = harness();
    h.run("locate=async()=>{throw new Error('fixture failure')}");
    await h.run('jumpToHere()');
    assert.equal(h.element('#hereBtn').disabled, false, 'failure restores the button');
    assert.equal(h.element('#hereBtn').textContent, '📍 Near me');
    assert.equal(h.run('lastFix'), null);
    assert.equal(h.effects.at(-1).message, 'fixture failure');
  }

  {
    const h = harness(), lookup = deferred();
    h.context.lookup = lookup;
    h.run(`locate=async()=>({lat:-34.9,lon:138.6,accuracy:20}); whereAmI=()=>lookup.promise;`);
    const pending = h.run('jumpToHere()');
    await turn();
    h.run("userId='owner-b';authGeneration++");
    lookup.resolve({ continent: 'Oceania', country: 'AU', region: 'South Australia', regionCode: 'AU-SA' });
    await pending;
    assert.equal(navEffects(h).length, 0, 'a lookup cannot navigate a different account session');
    assert.equal(h.element('#hereBtn').disabled, false);
    assert.equal(h.run('lastFix'), null);
  }

  {
    const h = harness();
    h.run(`locate=async()=>({lat:-34.9,lon:138.6,accuracy:20});
      whereAmI=async()=>({continent:'Oceania',country:'AU',region:'Invented State',regionCode:'NZ-SA'})`);
    await h.run('jumpToHere()');
    assert.deepEqual(plain(navEffects(h)[0]), {
      kind: 'nav', level: 'country', opts: { continent: 'Oceania', country: 'AU' },
    }, 'unmatched state falls back to the mapped country');
  }

  {
    const h = harness();
    h.run(`locate=async()=>({lat:-34.9,lon:138.6,accuracy:20});
      whereAmI=async()=>({continent:'Oceania',approximate:true})`);
    await h.run('jumpToHere()');
    assert.deepEqual(plain(navEffects(h)[0]), {
      kind: 'nav', level: 'continent', opts: { continent: 'Oceania' },
    }, 'failed country resolution falls back to the mapped continent');
    assert.match(h.effects.find(effect => effect.kind === 'toast').message, /choose your country manually/);
  }

  console.log('PASS: Near me native/web permission, provider resolution, fallbacks, races and privacy boundaries');
}

main().catch(error => { console.error(error); process.exitCode = 1; });
