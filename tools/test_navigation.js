'use strict';

// Offline execution of the real navigation, catalogue and trip-link functions.
const assert = require('node:assert/strict');
const fs = require('node:fs');
const vm = require('node:vm');

function harness() {
  const elements = new Map(), listeners = new Map(), pushed = [], replaced = [];
  const values = new Map();
  const collections = new Map();
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
    document: { querySelector: element, querySelectorAll: selector => collections.get(selector) || [], createElement: () => element('new'),
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
  run('globalThis.realRenderList=renderList; globalThis.realRenderPlaces=renderPlaces; renderPlaces=()=>{}; renderList=()=>{}; buildFilterOptions=()=>{}; renderTrips=()=>{}; toast=t=>{globalThis.lastToast=t};');
  return { context, run, elements, listeners, pushed, replaced, values, collections, element };
}

async function main() {
  const all = JSON.parse(fs.readFileSync('data/adventures.json', 'utf8'));
  const finalGeography = JSON.parse(fs.readFileSync(
    'tools/fixtures/geographic-correction-overlay-final.json', 'utf8'));
  {
    const h = harness();

    const adventuresTab = h.element('adventuresTab');
    adventuresTab.dataset.tab = 'tab-list';
    const communityTab = h.element('communityTab');
    communityTab.dataset.tab = 'tab-community';
    communityTab.classList.remove('hidden');
    communityTab.classList.add('active');
    const adventuresPanel = h.element('#tab-list');
    const communityPanel = h.element('#tab-community');
    communityPanel.classList.remove('hidden');
    h.collections.set('.tab', [adventuresTab, communityTab]);
    h.collections.set('.panel', [adventuresPanel, communityPanel]);
    h.context.adventuresTab = adventuresTab;
    h.run(`renderPlaces=()=>{
      globalThis.mapRedraws=(globalThis.mapRedraws||0)+1;
      globalThis.adventuresVisibleAtRedraw=!document.querySelector('#tab-list').classList.contains('hidden');
    }; activateAppTab(adventuresTab);`);
    assert.equal(h.run('mapRedraws'), 1, 'opening Adventures redraws its map');
    assert.equal(h.run('adventuresVisibleAtRedraw'), true,
      'the map redraw happens only after its panel has visible layout');
    assert.equal(adventuresPanel.classList.contains('hidden'), false);
    assert.equal(communityPanel.classList.contains('hidden'), true);

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

    h.run(`ADV=[{id:9001,continent:'Antarctica',country:'AQ',admin1:'Antarctica',
      hidden_gem:true,pack:'all'}]; owned=new Set(); progress=new Map();
      nav={level:'world',continent:null,country:null,admin1:null};
      drawWorldMap=(_canvas,counts)=>{globalThis.capturedMapCounts=counts};
      renderPlaces=realRenderPlaces; renderPlaces();`);
    assert.equal(h.run('capturedMapCounts.Antarctica'), 1,
      'bundle-only Antarctica must remain lit as real catalogue content');
    assert.equal(h.run('countOf(a=>a.continent==="Antarctica")'), 0,
      'map presence must not change the unlocked count or completion denominator');
    assert.match(h.elements.get('#continentList').innerHTML, /Included with All Continents/);
    h.run('renderPlaces=()=>{}');

    const disabled = h.run("placeRow({label:'Unmapped',sub:'Not mapped',count:0,total:0,done:0,onClick:null})");
    assert.match(disabled, /disabled aria-disabled="true"/);
    assert.doesNotMatch(disabled, /data-go=/);

    h.run(`ADV=[
      {continent:'Oceania',country:'AU',admin1:'NSW'},
      {continent:'Oceania',country:'FJ',admin1:'Central Division'},
      {continent:'Oceania',country:'FJ',admin1:'Northern Division'},
      {continent:'Oceania',country:'FJ',admin1:'Western Division'},
      {continent:'Oceania',country:'FJ',admin1:'Eastern Division'},
      {continent:'Oceania',country:'FJ',admin1:'Rotuma'},
      {continent:'Oceania',country:'FJ',admin1:'Invented sixth catalogue area'}
    ];`);
    assert.equal(h.run("COUNTRY_SUBDIVISION_COUNT.AU"), 8);
    assert.equal(h.run("COUNTRY_SUBDIVISION_COUNT.FJ"), 5);
    assert.equal(h.run("COUNTRY_SUBDIVISION_COUNT.IE"), 26,
      'historical province containment is overridden by sourced statutory counties');
    assert.equal(h.run("COUNTRY_SUBDIVISION_COUNT.CV"), 22,
      'geographic island groups are overridden by sourced municipalities');
    assert.equal(h.run("COUNTRY_SUBDIVISION_COUNT.HK"), 18,
      'territories absent from CLDR containment can use sourced functional districts');
    assert.equal(h.run("COUNTRY_SUBDIVISION_COUNT.CK"), 10,
      'territories absent from CLDR containment can use sourced island governments');
    assert.equal(h.run("countryDestination('Oceania','AU').level"), 'country',
      'Australia gets a subdivision step even with only one populated catalogue state');
    assert.equal(h.run("countryDestination('Oceania','FJ').level"), 'adventures',
      'six catalogue labels cannot invent a sixth first-level Fiji subdivision');
    assert.equal(h.run("safeNavigationState({level:'country',continent:'Oceania',country:'FJ'}).level"), 'adventures',
      'old country-level history normalises to the direct route');
    assert.equal(h.run("safeNavigationState({level:'adventures',continent:'Oceania',country:'FJ',admin1:'Central Division'}).admin1"),
      'Central Division', 'existing region deep links remain valid');

    h.run(`ADV=[
      {id:1,continent:'North America',country:'BB',admin1:'Barbados',hidden_gem:false,bundle_only:false},
      {id:2,continent:'North America',country:'BB',admin1:'Saint Andrew',hidden_gem:false,bundle_only:false}
    ]; owned=new Set(['all']); progress=new Map(); nav={level:'country',continent:'North America',country:'BB',admin1:null};
    renderPlaces=realRenderPlaces; drawWorldMap=()=>{}; renderPlaces();`);
    const barbadosRows = h.elements.get('#placeList').innerHTML;
    assert.match(barbadosRows, /Everything in Barbados/);
    assert.match(barbadosRows, /0 \/ 2/, 'Everything retains placeholder and researched rows');
    assert.match(barbadosRows, /Saint Andrew/);
    assert.doesNotMatch(barbadosRows, /"admin1":"Barbados"/,
      'country-name placeholder must not render as a fake parish');
    assert.equal(h.run("safeNavigationState({level:'adventures',continent:'North America',country:'BB',admin1:'Barbados'}).admin1"),
      null, 'an old placeholder deep link normalises to all country adventures');

    h.run(`ADV=[{id:3,continent:'Europe',country:'AD',admin1:'Andorra',hidden_gem:false,bundle_only:false}];
      nav={level:'country',continent:'Europe',country:'AD',admin1:null}; renderPlaces()`);
    const allPlaceholder = h.elements.get('#placeList').innerHTML;
    assert.match(allPlaceholder, /Everything in Andorra/);
    assert.doesNotMatch(allPlaceholder, /"admin1":"Andorra"/,
      'an all-placeholder country keeps Everything without a fake country tile');

    assert.equal(h.run("placeholderAdmin1('FJ','Fiji')"), false,
      'countries below the threshold still route directly without placeholder inference');
    assert.equal(h.run("placeholderAdmin1('AU','AUS')"), true,
      'the reviewed Australia-wide ISO3 bin must not render as a state');
    assert.equal(h.run("placeholderAdmin1('AU','ACT')"), false,
      'real Australian state and territory codes remain selectable');
    h.run(`ADV=[
      {id:4,continent:'Oceania',country:'AU',admin1:'AUS',hidden_gem:false,bundle_only:false},
      {id:5,continent:'Oceania',country:'AU',admin1:'NSW',hidden_gem:false,bundle_only:false}
    ]; owned=new Set(['all']); progress=new Map(); nav={level:'country',continent:'Oceania',country:'AU',admin1:null};
    renderPlaces=realRenderPlaces; drawWorldMap=()=>{}; renderPlaces();`);
    const australiaRows = h.elements.get('#placeList').innerHTML;
    assert.match(australiaRows, /Everything in Australia/);
    assert.match(australiaRows, /0 \/ 2/, 'Everything retains the Australia-wide row');
    assert.doesNotMatch(australiaRows, /"admin1":"AUS"/, 'Australia-wide must not render as a state tile');
    assert.equal(h.run("safeNavigationState({level:'adventures',continent:'Oceania',country:'AU',admin1:'AUS'}).admin1"),
      null, 'an old AUS deep link opens Everything in Australia');

    const countryCard = (html, name) => html.split('</button>').find(row => row.includes(name)) || '';
    const preCorrectionAustralia = [
      { id: 4400, continent: 'Oceania', country: 'AU', admin1: 'ACT' },
      { id: 4401, continent: 'Oceania', country: 'AU', admin1: 'NSW' },
      { id: 4402, continent: 'Oceania', country: 'AU', admin1: 'NT' },
      { id: 4403, continent: 'Oceania', country: 'AU', admin1: 'QLD' },
      { id: 4404, continent: 'Oceania', country: 'AU', admin1: 'SA' },
      { id: 4405, continent: 'Oceania', country: 'AU', admin1: 'TAS' },
      { id: 4406, continent: 'Oceania', country: 'AU', admin1: 'VIC' },
      { id: 4407, continent: 'Oceania', country: 'AU', admin1: 'WA' },
      { id: 4408, continent: 'Oceania', country: 'AU', admin1: 'AUS' },
      { id: 4445, continent: 'Oceania', country: 'AU', admin1: 'Victoria' },
      { id: 4446, continent: 'Oceania', country: 'AU', admin1: 'Victoria' },
    ];
    h.run(`ADV=${JSON.stringify(preCorrectionAustralia)}; owned=new Set(['all']); progress=new Map();
      nav={level:'continent',continent:'Oceania',country:null,admin1:null};
      renderPlaces=realRenderPlaces; drawWorldMap=()=>{}; renderPlaces();`);
    assert.match(countryCard(h.elements.get('#placeList').innerHTML, 'Australia'), /9 regions/,
      'the precise pre-correction fixture has nine visible labels after excluding the AUS placeholder');

    const correctedAustralia = preCorrectionAustralia.map(adventure => {
      const repair = finalGeography.row_overrides.find(row => row.id === adventure.id);
      return repair ? { ...adventure, ...repair.new } : adventure;
    });
    h.run(`ADV=${JSON.stringify(correctedAustralia)}; nav={level:'continent',continent:'Oceania',country:null,admin1:null};
      renderPlaces();`);
    assert.match(countryCard(h.elements.get('#placeList').innerHTML, 'Australia'), /8 regions/,
      'the final Victoria repair reports Australia\'s eight visible state and territory routes');

    h.run(`ADV=[
      {id:6,continent:'North America',country:'US',admin1:'VIC'},
      {id:7,continent:'Oceania',country:'AU',admin1:'VIC'}
    ]; nav={level:'adventures',continent:'Oceania',country:'AU',admin1:'VIC'};`);
    const scopedCrumb = h.run('crumbHTML()');
    assert.match(scopedCrumb, /Victoria/,
      'the subdivision crumb resolves its display label from the selected country');
    assert.doesNotMatch(scopedCrumb, /crumb-here">VIC</,
      'a same-named subdivision in another country cannot supply the crumb label');

    h.run(`ADV=[
      {id:10,continent:'Europe',country:'IE',admin1:'Leinster'},
      {id:11,continent:'Europe',country:'GB',admin1:'Northern Ireland'},
      {id:12,continent:'Europe',country:'DK',admin1:'Capital Region'},
      {id:13,continent:'Europe',country:'FO',admin1:'Vágar'},
      {id:14,continent:'Oceania',country:'NZ',admin1:'Manawatū-Whanganui'},
      {id:15,continent:'North America',country:'BB',admin1:'Saint Michael'},
      {id:16,continent:'Oceania',country:'AU',admin1:'VIC'}
    ];`);
    assert.deepEqual(
      JSON.parse(h.run("JSON.stringify(safeNavigationState({level:'adventures',continent:'Europe',country:'IE',admin1:'Antrim'}))")),
      { level: 'adventures', continent: 'Europe', country: 'GB', admin1: 'Northern Ireland' },
      'an old Ireland/Antrim bookmark follows the reviewed move to Northern Ireland');
    assert.deepEqual(
      JSON.parse(h.run("JSON.stringify(safeNavigationState({level:'adventures',continent:'Europe',country:'DK',admin1:'Faroe Islands'}))")),
      { level: 'adventures', continent: 'Europe', country: 'FO', admin1: 'Vágar' },
      'an old Denmark/Faroe Islands bookmark follows the reviewed country move');
    assert.equal(
      h.run("safeNavigationState({level:'adventures',continent:'Oceania',country:'NZ',admin1:'Manawatu-Whanganui'}).admin1"),
      'Manawatū-Whanganui', 'an old unaccented subdivision bookmark resolves to the current spelling');
    assert.equal(
      h.run("safeNavigationState({level:'adventures',continent:'North America',country:'BB',admin1:'Barbados'}).admin1"),
      null, 'an ambiguous country-wide placeholder opens Everything rather than guessing a parish');
    assert.equal(
      h.run("safeNavigationState({level:'adventures',continent:'Oceania',country:'AU',admin1:'Victoria'}).admin1"),
      'VIC', 'an old full-name Victoria route restores to the established Australian state code');

    const expectedAliases = {
      'AL|Gjirokaster': ['AL', 'Gjirokastër'], 'AL|Kukes': ['AL', 'Kukës'],
      'AL|Sarande': ['AL', 'Vlorë'], 'AL|Shkoder': ['AL', 'Shkodër'],
      'AL|Tirane': ['AL', 'Tirana'], 'AL|Vlore': ['AL', 'Vlorë'],
      'AR|Rio Negro': ['AR', 'Río Negro'], 'AU|Victoria': ['AU', 'VIC'],
      'CL|Araucania': ['CL', 'Araucanía'],
      'CL|Aysen': ['CL', 'Aysén'], 'CL|Valparaiso': ['CL', 'Valparaíso'],
      'CU|Guantanamo': ['CU', 'Guantánamo'], 'CZ|Usti nad Labem': ['CZ', 'Ústí nad Labem'],
      'DK|Faroe Islands': ['FO', 'Vágar'], 'ES|Castile and Leon': ['ES', 'Castile and León'],
      'GT|Peten': ['GT', 'Petén'], 'HN|Atlantida': ['HN', 'Atlántida'],
      'HU|Veszprem': ['HU', 'Veszprém'], 'IE|Antrim': ['GB', 'Northern Ireland'],
      'NZ|Manawatu-Whanganui': ['NZ', 'Manawatū-Whanganui'],
      'PA|Chiriqui': ['PA', 'Chiriquí'], 'PY|Boqueron': ['PY', 'Boquerón'],
      'SK|Banska Bystrica': ['SK', 'Banská Bystrica'], 'SK|Zilina': ['SK', 'Žilina'],
    };
    assert.equal(finalGeography.row_overrides.length, 60,
      'final geographic overlay retains 58 reviewed repairs and adds the two Victoria rows');
    assert.equal(finalGeography.admin1_navigation_aliases.length, 24,
      'final geographic overlay declares all 24 saved-route aliases');
    const overlayAliases = Object.fromEntries(finalGeography.admin1_navigation_aliases.map(alias => [
      `${alias.old.country}|${alias.old.admin1}`,
      [alias.new.country, alias.new.admin1],
    ]));
    assert.deepEqual(overlayAliases, expectedAliases,
      'navigation alias contract matches the final 60-row geographic overlay');
    assert.deepEqual(JSON.parse(h.run('JSON.stringify(ADMIN1_NAV_ALIASES)')), expectedAliases,
      'all 24 unambiguous route aliases derived from the final overlay remain registered');
    for (const [oldKey, [newCountry, newAdmin1]] of Object.entries(expectedAliases)) {
      const [oldCountry, oldAdmin1] = oldKey.split('|');
      const oldContinent = h.run(`COUNTRY_CONT[${JSON.stringify(oldCountry)}]`);
      const newContinent = h.run(`COUNTRY_CONT[${JSON.stringify(newCountry)}]`);
      h.run(`ADV=[
        {id:20,continent:${JSON.stringify(newContinent)},country:${JSON.stringify(newCountry)},admin1:${JSON.stringify(newAdmin1)}},
        {id:21,continent:${JSON.stringify(oldContinent)},country:${JSON.stringify(oldCountry)},admin1:'Current unrelated scope'}
      ]`);
      const restored = JSON.parse(h.run(`JSON.stringify(safeNavigationState({level:'adventures',
        continent:${JSON.stringify(oldContinent)},country:${JSON.stringify(oldCountry)},admin1:${JSON.stringify(oldAdmin1)}}))`));
      assert.deepEqual(restored, { level: 'adventures', continent: newContinent,
        country: newCountry, admin1: newAdmin1 }, `${oldKey} restores to its reviewed current route`);
    }

    h.run("ADV=[{id:16,continent:'Europe',country:'IE',admin1:'Antrim'}]");
    assert.equal(
      h.run("safeNavigationState({level:'adventures',continent:'Europe',country:'IE',admin1:'Antrim'}).country"),
      'IE', 'an old route remains unchanged while its exact catalogue scope still exists');
  }

  {
    const h = harness();
    h.run(`ADV=${JSON.stringify(all)}; owned=new Set(['all']); progress=new Map(); wireBrowserNavigation();`);
    h.run("goTo('continent',{continent:'Oceania'}); goTo('country',{continent:'Oceania',country:'FJ'});");
    assert.equal(h.pushed.length, 2);
    assert.equal(h.run('nav.level'), 'adventures', 'Fiji opens its country adventure list directly');
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
    h.run(`ADV=${JSON.stringify(all)}; wireNative(); nav={level:'adventures',continent:'Oceania',country:'FJ',admin1:null};`);
    back();
    assert.equal(h.run('nav.level'), 'islands', 'direct island country Back must return to Island nations');
    back();
    assert.equal(h.run('nav.level'), 'continent', 'Island nations Back must return to its continent');
    h.run("nav={level:'adventures',continent:'Oceania',country:'AU',admin1:'NSW'};");
    back();
    assert.equal(h.run('nav.level'), 'country', 'a subdivision adventure list returns to its country states');
    h.run("nav={level:'adventures',continent:'Europe',country:'GB',admin1:null};");
    back();
    assert.equal(h.run('nav.level'), 'continent', 'a direct mainland country list returns to its continent');
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

  console.log('PASS: sourced subdivision threshold, direct country routes, history, Back, trip links, counts, search and exhaustion');
}

main().catch(error => { console.error(error); process.exitCode = 1; });
