/* Wayfinder self-test.
 *
 * Drives every control the app exposes and asserts on the result, so a
 * regression shows up here rather than on somebody's phone in the Flinders
 * Ranges. Loaded into the running page, not bundled with it.
 *
 *   const s = document.createElement('script');
 *   s.src = 'tools/selftest.js'; document.head.appendChild(s);
 *   await window.runDiagnostics();
 */
(function () {
  'use strict';

  const R = { pass: [], fail: [], warn: [], metric: {} };
  const ok   = (n, d) => R.pass.push(d ? `${n} — ${d}` : n);
  const bad  = (n, d) => R.fail.push(d ? `${n} — ${d}` : n);
  const warn = (n, d) => R.warn.push(d ? `${n} — ${d}` : n);
  const chk  = (n, cond, d) => (cond ? ok : bad)(n, d);
  const wait = ms => new Promise(r => setTimeout(r, ms));
  const $$$  = s => [...document.querySelectorAll(s)];

  // ── colour contrast, for the accessibility pass ────────────────────
  function srgb(c) { c /= 255; return c <= 0.03928 ? c / 12.92 : Math.pow((c + 0.055) / 1.055, 2.4); }
  function lum(rgb) { return 0.2126 * srgb(rgb[0]) + 0.7152 * srgb(rgb[1]) + 0.0722 * srgb(rgb[2]); }
  function parse(col) {
    const m = col.match(/rgba?\(([\d.]+),\s*([\d.]+),\s*([\d.]+)(?:,\s*([\d.]+))?\)/);
    return m ? [+m[1], +m[2], +m[3], m[4] === undefined ? 1 : +m[4]] : null;
  }
  function effectiveBg(el) {
    let n = el;
    while (n && n !== document.documentElement) {
      const c = parse(getComputedStyle(n).backgroundColor);
      if (c && c[3] > 0.5) return c;
      n = n.parentElement;
    }
    return parse(getComputedStyle(document.body).backgroundColor) || [255, 255, 255, 1];
  }
  function contrast(el) {
    const fg = parse(getComputedStyle(el).color);
    if (!fg) return null;
    const bg = effectiveBg(el);
    const a = lum(fg), b = lum(bg);
    return (Math.max(a, b) + 0.05) / (Math.min(a, b) + 0.05);
  }

  async function reset() {
    // The app may be sitting behind the passphrase screen, in which case #app
    // is display:none and every measurement comes back zero. Reveal it, or the
    // layout assertions test nothing at all.
    $('#lock').classList.add('hidden');
    $('#app').classList.remove('hidden');
    localStorage.removeItem('oaa.progress.v1');
    localStorage.removeItem('oaa.outbox.v1');
    localStorage.removeItem('oaa.trips.v1');
    localStorage.removeItem('oaa.packs.v1');
    loadEntitlements();
    progress = new Map();
    trips = [];
    pendingPhotos = [];
    photos = [];
    goTo('world');
    // Draw every panel, not just the one on screen. Tab buttons only toggle
    // visibility, so a suite that opens the Me tab reads whatever was last
    // rendered - which on a page that never finished signing in is nothing,
    // and the suite fails for a reason that has nothing to do with the app.
    renderAll();
    await wait(60);
  }

  async function testData() {
    chk('data loads', ADV.length > 1000, `${ADV.length} adventures`);
    R.metric.adventures = ADV.length;
    R.metric.countries = new Set(ADV.map(a => a.country)).size;
    R.metric.continents = new Set(ADV.map(a => a.continent)).size;
    R.metric.regions = new Set(ADV.map(a => a.country + '/' + a.admin1)).size;

    const fields = ['id','title','place','continent','country','admin1','region','category',
                    'difficulty','cost','duration','season','dog_friendly','hidden_gem','description'];
    const missing = ADV.filter(a => fields.some(f => a[f] === undefined || a[f] === null || a[f] === ''));
    chk('every entry has every field', missing.length === 0,
        missing.length ? `${missing.length} incomplete, first id ${missing[0].id}` : '');

    const ids = new Set(ADV.map(a => a.id));
    chk('ids unique', ids.size === ADV.length);

    const long = ADV.filter(a => a.description.length > 220);
    if (long.length) warn('long descriptions', `${long.length} over 220 chars, may clip on small screens`);

    const short = ADV.filter(a => a.description.length < 40);
    if (short.length) warn('thin descriptions', `${short.length} under 40 chars`);

    const paidMismatch = ADV.filter(a => (!!a.hidden_gem) !== (!!a.pack));
    chk('paid entries all carry a pack', paidMismatch.length === 0, `${paidMismatch.length} mismatched`);

    R.metric.hiddenGems = ADV.filter(a => a.hidden_gem).length;
    R.metric.dogYes = ADV.filter(a => a.dog_friendly === 'yes').length;
    R.metric.withCoords = ADV.filter(a => a.lat !== null && a.lon !== null).length;
    if (!R.metric.withCoords) warn('no coordinates', 'distance sorting and a pin map are impossible until these exist');
  }

  async function testNavigation() {
    goTo('world'); await wait(80);
    chk('world screen shows', !$('#worldView').classList.contains('hidden'));
    chk('every continent listed', $$$('#continentList .placerow').length === CONTINENT_ORDER.length);

    const populated = CONTINENT_ORDER.filter(c => countOf(a => a.continent === c));
    let deadEnds = [], drilled = 0, regionsChecked = 0;

    for (const cont of populated) {
      goTo('continent', { continent: cont });
      if (!$$$('#placeList .placerow').length) { deadEnds.push(cont); continue; }

      for (const code of [...new Set(ADV.filter(a => a.continent === cont).map(a => a.country))]) {
        goTo('country', { continent: cont, country: code });
        if (!$$$('#placeList .placerow').length) deadEnds.push(`${cont}/${code}`);

        goTo('adventures', { continent: cont, country: code });
        if (!$$$('#list .card').length) deadEnds.push(`${cont}/${code} list`);
        drilled++;

        for (const r of [...new Set(ADV.filter(a => a.country === code).map(a => a.admin1))]) {
          goTo('adventures', { continent: cont, country: code, admin1: r });
          if (!$$$('#list .card').length) deadEnds.push(`${cont}/${code}/${r}`);
          regionsChecked++;
        }
      }
    }
    chk('every country and region reaches a list', deadEnds.length === 0, deadEnds.slice(0, 6).join(', '));
    R.metric.countriesDrilled = drilled;
    R.metric.regionsDrilled = regionsChecked;

    // breadcrumbs
    goTo('adventures', { continent: 'Oceania', country: 'AU', admin1: 'SA' }); await wait(40);
    const crumb = $('#crumbList').textContent.replace(/\s+/g, ' ');
    chk('breadcrumb reflects the path', crumb.includes('Oceania') && crumb.includes('Australia'), crumb.trim());
    const link = $('#crumbList .crumb-link');
    if (link) { link.click(); await wait(40); chk('breadcrumb navigates', nav.level !== 'adventures', nav.level); }
    else bad('breadcrumb has a link');
  }

  async function testMap() {
    goTo('world'); await wait(120);
    const map = $('#worldMap'), r = map.getBoundingClientRect();

    // A headless or hidden browser pane lays the page out at zero width, which
    // makes every hit-test miss. That is the harness being unable to measure,
    // not the map being broken, so say so rather than reporting a failure.
    if (r.width < 50 || r.height < 20) {
      warn('map layout not measurable here',
           `canvas ${Math.round(r.width)}x${Math.round(r.height)} — run with the browser pane visible`);
      chk('every continent has a colour', Object.keys(CONTINENT_COLOUR).length === CONTINENT_ORDER.length);
      chk('colours are all distinct', new Set(Object.values(CONTINENT_COLOUR)).size === CONTINENT_ORDER.length);
      return;
    }
    ok('map canvas has size', `${Math.round(r.width)}x${Math.round(r.height)}`);

    const at = (lat, lon) => continentFromPoint(map,
      r.left + ((lon + 180) / 360) * r.width, r.top + ((78 - lat) / 136) * r.height);
    const spots = [[-25, 134, 'Oceania'], [39.5, -98.5, 'North America'], [51, 10, 'Europe'],
                   [36, 138, 'Asia'], [24, 45, 'Middle East'], [-10, -55, 'South America'], [0, 20, 'Africa']];
    let wrong = [];
    for (const [lat, lon, want] of spots) if (at(lat, lon) !== want) wrong.push(`${want}->${at(lat, lon)}`);
    chk('map taps resolve to the right continent', wrong.length === 0, wrong.join(', '));
    chk('every continent has a colour', Object.keys(CONTINENT_COLOUR).length === CONTINENT_ORDER.length);
    chk('colours are all distinct', new Set(Object.values(CONTINENT_COLOUR)).size === CONTINENT_ORDER.length);
  }

  async function testFilters() {
    goTo('adventures', { continent: 'Oceania', country: 'AU' }); await wait(60);
    const total = +$('#resultCount').textContent.match(/^(\d+)/)[1];
    // The list shows locked gems too, blurred, so this counts rows on screen -
    // not the completion target, which deliberately excludes them.
    chk('country list populated',
        total === ADV.filter(a => a.country === 'AU').length, `${total}`);

    for (const q of ['all', 'todo', 'done', 'short', 'gem']) {
      const chip = $(`#quickChips .chip[data-quick="${q}"]`);
      if (!chip) { bad(`chip ${q} exists`); continue; }
      chip.click(); await wait(25);
      chk(`chip ${q} filters`, /adventure/.test($('#resultCount').textContent), $('#resultCount').textContent.trim());
    }
    $('#quickChips .chip[data-quick="all"]').click(); await wait(20);

    $('#search').value = 'waterfall';
    $('#search').dispatchEvent(new Event('input')); await wait(30);
    const searched = +$('#resultCount').textContent.match(/^(\d+)/)[1];
    chk('search narrows', searched > 0 && searched < total, `${searched} of ${total}`);
    $('#search').value = ''; $('#search').dispatchEvent(new Event('input')); await wait(20);

    for (const [sel, val] of [['#fCat', 'Hiking'], ['#fDiff', '2'], ['#fCost', '1'], ['#fDog', 'yes']]) {
      const el = $(sel);
      el.value = val; el.dispatchEvent(new Event('change')); await wait(25);
      const n = +$('#resultCount').textContent.match(/^(\d+)/)[1];
      chk(`filter ${sel} applies`, n >= 0 && n <= total, `${n}`);
    }
    $('#clearFilters').click(); await wait(30);
    chk('clear filters restores', +$('#resultCount').textContent.match(/^(\d+)/)[1] === total);

    // dice
    $('#randomBtn').click(); await wait(120);
    chk('random opens an adventure', !$('#sheet').classList.contains('hidden'));
    closeSheet(); await wait(30);
  }

  async function testSheet() {
    const a = ADV.find(x => x.country === 'AU' && x.dog_friendly === 'yes');
    openSheet(a.id); await wait(120);
    chk('sheet opens', !$('#sheet').classList.contains('hidden'));

    const facts = $$$('.fact b').map(e => e.textContent);
    chk('all six facts render', facts.length === 6, facts.join(', '));
    chk('dogs fact present', facts.includes('Dogs'));

    const acts = $$$('#sheetBody [data-act]').map(e => e.dataset.act);
    for (const need of ['toggle', 'short', 'share', 'saveMemory', 'takePhoto', 'addPhoto'])
      chk(`sheet action: ${need}`, acts.includes(need));

    chk('maps link present', !!$('#sheetBody a[href*="maps"]'));
    chk('rating has five stars', $$$('#sheetBody [data-rate]').length === 5);
    chk('memory box present', !!$('#memoryBox'));

    // complete → undo
    $('#sheetBody [data-act="toggle"]').click(); await wait(60);
    chk('marking complete records it', isDone(a.id));
    chk('completion is attributed', !!row(a.id).completed_at);
    $('#sheetBody [data-act="toggle"]').click(); await wait(60);
    chk('undo works', !isDone(a.id));

    // shortlist
    $('#sheetBody [data-act="short"]').click(); await wait(50);
    chk('shortlist toggles on', row(a.id).shortlisted);
    $('#sheetBody [data-act="short"]').click(); await wait(50);
    chk('shortlist toggles off', !row(a.id).shortlisted);

    // rating
    for (const n of [3, 5, 1]) {
      $(`#sheetBody [data-rate="${n}"]`).click(); await wait(40);
      if (row(a.id).rating !== n) { bad('rating sets', `wanted ${n} got ${row(a.id).rating}`); break; }
    }
    if (row(a.id).rating === 1) ok('rating sets and changes');

    // memory
    $('#memoryBox').value = 'Self-test memory';
    $('#sheetBody [data-act="saveMemory"]').click(); await wait(60);
    chk('memory saves', row(a.id).memory === 'Self-test memory', row(a.id).memory);

    // memory survives closing without pressing save
    $('#memoryBox').value = 'Edited but not saved';
    closeSheet(); await wait(40);
    chk('unsaved memory is kept on close', row(a.id).memory === 'Edited but not saved', row(a.id).memory);
    chk('sheet closes', $('#sheet').classList.contains('hidden'));
  }

  // Sized and textured like a real phone photo. A small flat-colour image
  // would already be under the 1600px cap and would re-encode to the same
  // number of bytes, so the shrink assertion would be meaningless.
  async function fakePhotoBlob() {
    const c = document.createElement('canvas'); c.width = 3000; c.height = 2000;
    const x = c.getContext('2d');
    for (let i = 0; i < 1500; i++) {
      x.fillStyle = `hsl(${(i * 37) % 360},${40 + (i % 40)}%,${25 + (i % 50)}%)`;
      x.fillRect((i * 97) % 3000, (i * 53) % 2000, 60, 60);
    }
    return new Promise(r => c.toBlob(r, 'image/jpeg', 0.9));
  }

  async function testPhotos() {
    const a = ADV.find(x => x.country === 'NZ');
    const blob = await fakePhotoBlob();

    const t0 = performance.now();
    await addPhotos(a.id, [new File([blob], 'IMG.JPG', { type: 'image/jpeg' })]);
    await wait(300);
    R.metric.photoProcessMs = Math.round(performance.now() - t0);

    chk('photo queued', pendingPhotos.length === 1);
    chk('photo resized under the cap', pendingPhotos[0] && Math.max(pendingPhotos[0].width, pendingPhotos[0].height) <= 1600,
        pendingPhotos[0] ? `${pendingPhotos[0].width}x${pendingPhotos[0].height}` : '');
    chk('photo shrunk', pendingPhotos[0] && pendingPhotos[0].bytes < blob.size,
        pendingPhotos[0] ? `${Math.round(pendingPhotos[0].bytes / 1024)}KB from ${Math.round(blob.size / 1024)}KB` : '');

    openSheet(a.id); await wait(150);
    chk('photo shows on the adventure', $$$('#sheetBody .thumb:not(.add)').length === 1);
    chk('thumbnail has an image', !!$('#sheetBody .thumb:not(.add) img'));
    closeSheet();

    // undecodable file must fail loudly, not silently
    try {
      await decodeImage(new File([new Blob(['nope'])], 'x.heic', { type: 'image/heic' }));
      bad('undecodable file rejected');
    } catch (e) { ok('undecodable file rejected', e.message); }

    // EXIF date extraction
    const exifDate = await readExifDate(new File([blob], 'p.jpg', { type: 'image/jpeg' }));
    chk('no-EXIF photo returns null rather than throwing', exifDate === null);
  }

  async function testMemoriesTab() {
    $('.tab[data-tab="tab-memories"]').click(); await wait(120);
    for (const g of ['adventure', 'month', 'year', 'category']) {
      $(`#groupChips .chip[data-group="${g}"]`).click(); await wait(60);
      chk(`memories group: ${g}`, $('#memList').children.length > 0 || $('#memList').textContent.includes('No'),
          `${$('#memList').children.length} blocks`);
    }
    $('#groupChips .chip[data-group="adventure"]').click(); await wait(60);

    if (!pendingPhotos.length) {
      const blob = await fakePhotoBlob();
      await addPhotos(ADV.find(x => x.country === 'NZ').id,
                      [new File([blob], 'IMG.JPG', { type: 'image/jpeg' })]);
      await wait(300);
      $('.tab[data-tab="tab-memories"]').click(); await wait(120);
    }

    const thumb = $('#memList .thumb:not(.add)');
    if (thumb) {
      thumb.click(); await wait(200);
      chk('lightbox opens', !$('#lightbox').classList.contains('hidden'));
      chk('lightbox names the adventure', !!$('#lbTitle').textContent.trim(), $('#lbTitle').textContent);
      chk('lightbox shows a date', /\d/.test($('#lbSub').textContent), $('#lbSub').textContent.slice(0, 50));
      $('[data-lbclose]').click(); await wait(80);
      chk('lightbox closes', $('#lightbox').classList.contains('hidden'));
    } else warn('lightbox untested', 'no photo present');
  }

  async function testPassport() {
    // Stamps are earned on the first tick in a country, so this suite only
    // means anything from a clean slate. Make one rather than assuming the
    // suite order provides it.
    progress = new Map();
    localStorage.removeItem('oaa.progress.v1');
    renderAll();
    $('.tab[data-tab="tab-passport"]').click(); await wait(120);
    const countries = new Set(ADV.map(a => a.country)).size;
    chk('a stamp slot per country', $$$('.stamp').length === countries, `${$$$('.stamp').length} of ${countries}`);
    chk('no stamps before anything is done', $$$('.stamp.earned').length === 0);

    const a = ADV.find(x => x.country === 'JP');
    toggleDone(a.id); await wait(120);
    $('.tab[data-tab="tab-passport"]').click(); await wait(80);
    chk('completing earns exactly one stamp', $$$('.stamp.earned').length === 1);
    const face = $('.stamp.earned').textContent.replace(/\s+/g, ' ');
    chk('stamp carries a date', /\d{2} \w{3} \d{2}/.test(face), face);
    chk('stamp carries a time', /\d{2}:\d{2}/.test(face), face);

    // a second tick in the same country must not add a stamp or move the date
    const before = $('.stamp.earned').textContent.replace(/\s+/g, ' ');
    const b = ADV.filter(x => x.country === 'JP')[1];
    if (b) {
      toggleDone(b.id); await wait(120);
      $('.tab[data-tab="tab-passport"]').click(); await wait(80);
      chk('second tick does not add a stamp', $$$('.stamp.earned').length === 1);
      const after = $('.stamp.earned').textContent.replace(/\s+/g, ' ');
      chk('stamp date does not move', before.match(/\d{2} \w{3} \d{2}/)[0] === after.match(/\d{2} \w{3} \d{2}/)[0]);
    }
    chk('category grid removed from passport', !$('#catGrid'));
  }

  async function testTrips() {
    $('.tab[data-tab="tab-me"]').click(); await wait(100);
    const trip = { id: newTripId(), name: 'Self-test trip', starts_on: null, ends_on: null,
                   adventure_ids: [], notes: null, created_by: 'test' };
    upsertTrip(trip); await wait(80);
    chk('trip created', trips.length === 1);
    chk('trip card renders', $$$('.trip').length === 1);

    const picks = [ADV.find(a => a.country === 'AU'), ADV.find(a => a.country === 'NZ')];
    picks.forEach(a => toggleTripMember(trip.id, a.id));
    await wait(80);
    chk('adventures added to trip', trips[0].adventure_ids.length === 2);

    openTripSheet(trip.id); await wait(150);
    chk('trip sheet opens', !$('#tripSheet').classList.contains('hidden'));
    chk('itinerary grouped by country', $$$('.tripgroup').length === 2, `${$$$('.tripgroup').length} groups`);
    chk('trip has date fields', !!$('#tripStart') && !!$('#tripEnd'));
    chk('trip has notes', !!$('#tripNotes'));

    $('#tripStart').value = '2026-12-01'; $('#tripEnd').value = '2026-12-14';
    $('#tripNotes').value = 'notes from the self-test';
    $('[data-tripact="save"]').click(); await wait(120);
    chk('trip dates save', trips[0].starts_on === '2026-12-01', String(trips[0].starts_on));
    chk('trip notes save', trips[0].notes === 'notes from the self-test');

    const rm = $('[data-tripremove]');
    if (rm) { rm.click(); await wait(100); chk('removing from a trip works', trips[0].adventure_ids.length === 1); }
    else bad('trip item has a remove control');

    closeTripSheet(); await wait(50);
    chk('trip sheet closes', $('#tripSheet').classList.contains('hidden'));

    // picker on the adventure itself
    openSheet(picks[1].id); await wait(120);
    chk('trip picker on adventure', $$$('#sheetBody [data-tripadd]').length >= 1);
    closeSheet();
  }

  async function testStore() {
    const counts = packStats(ADV);
    const sell = sellablePacks(ADV);

    chk('every sellable pack has something in it',
        sell.every(p => p.slug === 'all' || (counts[p.slug] || 0) > 0),
        sell.map(p => `${p.slug}:${counts[p.slug] || 0}`).join(' '));
    chk('empty continents are not for sale',
        !sell.some(p => ['south-america', 'africa'].includes(p.slug)));
    chk('the bundle counts every gem',
        counts.all === ADV.filter(a => a.hidden_gem).length,
        `${counts.all} vs ${ADV.filter(a => a.hidden_gem).length}`);
    chk('every gem belongs to a pack',
        ADV.filter(a => a.hidden_gem && !a.pack).length === 0);
    chk('every pack slug is one we sell',
        [...new Set(ADV.filter(a => a.pack).map(a => a.pack))]
          .every(slug => !!packBySlug(slug)));

    // Nothing is owned at the start of a run, so gems are locked.
    const euGem = ADV.find(a => a.hidden_gem && a.pack === 'europe');
    const asiaGem = ADV.find(a => a.hidden_gem && a.pack === 'asia');
    const plain = ADV.find(a => !a.hidden_gem);
    chk('a gem starts locked', isLocked(euGem));
    chk('an ordinary adventure is never locked', !isLocked(plain));
    chk('a locked card hides the title',
        !cardHTML(euGem).includes(euGem.title), 'title leaked into the card');
    chk('a locked card still says where it is',
        cardHTML(euGem).includes(regionName(euGem)));

    // Buying one pack unlocks that pack and nothing else.
    const realConfirm = window.confirm;
    window.confirm = () => true;
    try {
      await buyPack('europe'); await wait(60);
      chk('buying a pack unlocks it', !isLocked(euGem));
      chk('buying one pack does not unlock another', isLocked(asiaGem));
      chk('an unlocked card shows the real title', cardHTML(euGem).includes(euGem.title));

      await buyPack('all'); await wait(60);
      chk('the bundle unlocks everything',
          !ADV.some(a => isLocked(a)),
          `${ADV.filter(a => isLocked(a)).length} still locked`);

      const res = await Billing.restore();
      chk('restore reports what is owned', res.ok && res.restored.includes('all'));
    } finally {
      window.confirm = realConfirm;
      localStorage.removeItem('oaa.packs.v1');
      loadEntitlements();
    }
    chk('clearing entitlements re-locks the gems', isLocked(euGem));

    // The point of the whole design: paying for nothing must still let you
    // finish. A region's target is what you can actually reach.
    const gemCount = ADV.filter(a => a.hidden_gem).length;
    chk('locked gems are excluded from the total',
        countableTotal() === ADV.length - gemCount,
        `${countableTotal()} countable of ${ADV.length}, ${gemCount} gems`);

    const inSA = a => a.country === 'AU' && a.admin1 === 'sa';
    const saAll = ADV.filter(inSA).length;
    const saGems = ADV.filter(a => inSA(a) && a.hidden_gem).length;
    chk('a region asks only for what is unlocked',
        countOf(inSA) === saAll - saGems,
        `South Australia asks ${countOf(inSA)} of ${saAll} (${saGems} gems locked)`);

    window.confirm = () => true;
    try {
      await buyPack('oceania'); await wait(60);
      chk('buying raises the region target', countOf(inSA) === saAll,
          `${countOf(inSA)} vs ${saAll}`);
    } finally {
      window.confirm = realConfirm;
      localStorage.removeItem('oaa.packs.v1');
      loadEntitlements();
      // Repaint. Buying re-rendered the page while a pack was owned, and a
      // later suite reading that stale markup sees totals that no longer
      // match the entitlements - which is a test bug, not an app one.
      renderAll();
    }
    chk('and lowers it again when not owned', countOf(inSA) === saAll - saGems);
  }

  async function testCommunity() {
    $('.tab[data-tab="tab-community"]').click(); await wait(150);
    chk('community tab exists', !!$('#tab-community'));
    chk('community panel shows', !$('#tab-community').classList.contains('hidden'));
    chk('it says it is not the curated list',
        /not checked by us|never join/i.test($('#tab-community').textContent));

    // Two posts, standing in for the server.
    const before = ADV.length;
    recs = [
      { id: 'r1', created_by: 'a', author_name: 'Riley', title: 'Walk the old jetty at dusk',
        place: 'Port Vincent', admin1: 'SA', country: 'AU', category: 'Scenic',
        description: 'A long timber jetty locals fish off.', up_votes: 7, down_votes: 1,
        stars_sum: 22, stars_count: 5, report_count: 0, hidden: false, created_at: '2026-09-01' },
      { id: 'r2', created_by: 'b', author_name: 'Ryno', title: 'Swim the flooded quarry',
        place: 'Schladitzer See', admin1: 'Saxony', country: 'DE', category: 'Water',
        description: 'A lignite pit with a beach.', up_votes: 3, down_votes: 0,
        stars_sum: 8, stars_count: 2, report_count: 0, hidden: false, created_at: '2026-09-02' },
    ];
    renderRecs(); await wait(80);
    chk('recommendations render', $$$('.reccard').length === 2);

    // The point of the whole design.
    chk('recommendations never enter the adventure list',
        ADV.length === before && !ADV.some(a => a.title === 'Walk the old jetty at dusk'));
    chk('and never count towards completion',
        countableTotal() === ADV.filter(a => !isLocked(a)).length);

    // Ranking
    recSort = 'top';
    chk('top rated sorts by score', sortedRecs()[0].id === 'r1');
    recSort = 'new';
    chk('newest sorts by date', sortedRecs()[0].id === 'r2');
    recSort = 'stars';
    // r1 averages 4.4 from five ratings, r2 averages 4.0 from two.
    chk('stars sorts by average', sortedRecs()[0].id === 'r1',
        `${recStars(recs[0]).toFixed(1)} vs ${recStars(recs[1]).toFixed(1)}`);
    recSort = 'top';

    chk('a score is up minus down', recScore(recs[0]) === 6);
    chk('an unrated post reports no stars', recStars({ stars_sum: 0, stars_count: 0 }) === 0);

    // Moderation controls have to be present, or the app cannot ship.
    const card = $('.reccard');
    chk('every post can be reported', !!card.querySelector('[data-recreport]'));
    chk('every author can be blocked', !!card.querySelector('[data-recblock]'));
    chk('a hidden post is marked as such', (() => {
      recs[0].hidden = true; renderRecs();
      const marked = !!$('.reccard.hidden-post');
      recs[0].hidden = false; renderRecs();
      return marked;
    })());

    // Writing one
    openRecSheet(null); await wait(100);
    chk('the submit sheet opens', !$('#recSheet').classList.contains('hidden'));
    for (const id of ['recTitle', 'recPlace', 'recAdmin', 'recCountry', 'recCategory', 'recDesc'])
      chk(`submit field present: ${id}`, !!$('#' + id));
    chk('every country is offered', $('#recCountry').options.length === Object.keys(COUNTRY_NAME).length);
    chk('the form warns about what not to post',
        /unsafe|abusive|advertising/i.test($('#recBody').textContent));
    closeRecSheet(); await wait(60);
    chk('the sheet closes', $('#recSheet').classList.contains('hidden'));

    recs = [];
    renderRecs();
  }

  /* Everything found in the bug sweep, so none of it comes back.
   *
   * Most of these are about a paid title escaping through a route that does
   * not go via the card renderer. An entitlement is not permanent - a refund,
   * a family-sharing revoke, or a second phone that never bought the pack all
   * leave rows pointing at gems this device may not read.
   */
  async function testLeaks() {
    localStorage.removeItem('oaa.packs.v1');
    localStorage.removeItem('oaa.preview.v1');
    loadEntitlements();
    const gem = ADV.find(a => a.hidden_gem);
    const words = gem.title.split(' ').slice(0, 3).join(' ').toLowerCase();
    chk('there is a locked gem to test with', isLocked(gem));

    // Search must not match text the reader cannot see.
    goTo('adventures', { continent: gem.continent, country: gem.country });
    filters.q = words;
    chk('search does not match a locked title', !filtered().some(a => a.id === gem.id));
    filters.q = gem.category.toLowerCase();
    chk('search still matches what IS visible', filtered().some(a => a.id === gem.id));
    filters.q = '';

    // The dice must never hand back something that cannot be opened.
    const pool = filtered().filter(a => !isDone(a.id) && !isLocked(a));
    chk('the random pool excludes locked gems', !pool.some(a => isLocked(a)));

    // Trips
    const t = { id: newTripId(), name: 'leak probe', starts_on: null, ends_on: null,
                adventure_ids: [], notes: null, created_by: 'test' };
    upsertTrip(t);
    toggleTripMember(t.id, gem.id);
    chk('a locked gem cannot be added to a trip',
        !(trips.find(x => x.id === t.id).adventure_ids || []).includes(gem.id));

    // One added while owned, then the entitlement goes away.
    setPreview(true);
    toggleTripMember(t.id, gem.id);
    const added = (trips.find(x => x.id === t.id).adventure_ids || []).includes(gem.id);
    setPreview(false);
    renderAll();
    chk('it could be added while owned', added);
    openTripSheet(t.id); await wait(150);
    chk('a revoked gem does not leak its title into a trip',
        !$('#tripBody').textContent.includes(gem.title));
    closeTripSheet();
    trips = trips.filter(x => x.id !== t.id); saveLocalTrips();

    chk('safeTitle hides a locked title', safeTitle(gem) !== gem.title);
    chk('safeTitle passes an unlocked one through', (() => {
      const plain = ADV.find(a => !a.hidden_gem);
      return safeTitle(plain) === plain.title;
    })());

    // An achievement behind a paywall is not an achievement.
    chk('no gem achievement is offered with nothing bought',
        gemTarget() === 0);
    setPreview(true);
    chk('and it appears, reachable, once unlocked', gemTarget() > 0 && gemTarget() <= 25);
    setPreview(false);

    // The 1-in-5 rule means no region can be entirely paid.
    const byRegion = new Map();
    for (const a of ADV) {
      const k = a.country + '/' + a.admin1;
      if (!byRegion.has(k)) byRegion.set(k, []);
      byRegion.get(k).push(a);
    }
    const dead = [...byRegion.entries()].filter(([, v]) => v.every(isLocked));
    chk('no region is completable only by paying', dead.length === 0,
        dead.slice(0, 3).map(([k]) => k).join(', '));

    // Rendering has to stay quick as the list grows.
    goTo('continent', { continent: 'North America' });
    // Warm up first. The first render after a page load carries layout, style
    // recalculation and first paint with it - measuring that reports about
    // 400ms and tells you nothing about whether a tick feels quick, which is
    // the question. Take the median of a few settled ones instead.
    for (let i = 0; i < 3; i++) renderAll();
    const runs = [];
    for (let i = 0; i < 5; i++) {
      const t0 = performance.now(); renderAll();
      runs.push(performance.now() - t0);
    }
    runs.sort((a, b) => a - b);
    const ms = Math.round(runs[2]);
    R.metric.renderAllMs = ms;
    chk('a settled render stays under 150ms', ms < 150, `${ms}ms median of five`);

    // Seasons. The old test read a range as a list: "Apr-Oct".includes("Jun")
    // is false, so June matched nothing that ran April to October, and
    // year-round matched no month at all. In January it found twenty
    // adventures in season out of the 1,367 that were.
    const seasonCases = [
      ['Apr-Oct', 5, true], ['Apr-Oct', 0, false],
      ['Nov-Mar', 0, true], ['Nov-Mar', 5, false],
      ['Year-round', 3, true], ['Jun-Jul', 5, true], ['Jun-Jul', 7, false],
      ['Dec-Feb', 11, true], ['Oct', 9, true], ['Oct', 2, false],
    ];
    const wrong = seasonCases.filter(([sn, m, want]) => inSeason(sn, m) !== want);
    chk('season ranges are read as ranges', wrong.length === 0,
        wrong.map(([sn, m]) => `${sn}@${m}`).join(', '));
    chk('a wrapping range covers the new year', inSeason('Nov-Mar', 0));
    chk('every month has things in season',
        [...Array(12).keys()].every(m => ADV.some(a => inSeason(a.season, m))));
    chk('every season parses as a month or a range',
        ADV.every(a => /^(Year-round|[A-Z][a-z]{2}(-[A-Z][a-z]{2})?)$/.test(a.season)),
        ADV.filter(a => !/^(Year-round|[A-Z][a-z]{2}(-[A-Z][a-z]{2})?)$/.test(a.season))
           .slice(0, 3).map(a => a.season).join(', '));

    // A group of three people all showing as "Someone" is useless, so a name
    // is required before joining or creating one - and only then, because a
    // person on their own never needs one.
    const savedWho = who;
    const realPrompt = window.prompt;
    try {
      localStorage.removeItem('oaa.who.v1'); who = null;
      window.prompt = () => null;
      chk('cancelling the name prompt aborts', (await requireName('t')) === false);
      window.prompt = () => '   ';
      chk('a blank name is refused', (await requireName('t')) === false);
      window.prompt = () => 'Tester';
      chk('a real name is accepted', (await requireName('t')) === true);
      chk('and remembered', who === 'Tester' && localStorage.getItem('oaa.who.v1') === 'Tester');
      let asked = false;
      window.prompt = () => { asked = true; return 'X'; };
      await requireName('t');
      chk('it does not ask again once set', !asked);
      localStorage.removeItem('oaa.who.v1'); who = null;
      window.prompt = () => 'z'.repeat(200);
      await requireName('t');
      chk('a very long name is trimmed', who.length === 40);
    } finally {
      window.prompt = realPrompt;
      who = savedWho;
      if (who) localStorage.setItem('oaa.who.v1', who);
      else localStorage.removeItem('oaa.who.v1');
    }
    chk('an invite link carries the join code',
        linkTo({ join: 'ABC234' }).endsWith('?join=ABC234'));

    // What goes into the outbox has to be something the server will accept.
    // rating has a `between 1 and 5` check on it; a value outside that was
    // stored locally and then rejected on every sync attempt for ever, with
    // the sync bar permanently claiming changes were waiting.
    const plain = ADV.find(a => !isLocked(a));
    applyPatch(plain.id, { rating: 99 });
    chk('a rating above five is refused', row(plain.id).rating === null);
    applyPatch(plain.id, { rating: 0 });
    chk('a rating of zero is refused', row(plain.id).rating === null);
    applyPatch(plain.id, { rating: 4 });
    chk('a valid rating is kept', row(plain.id).rating === 4);
    applyPatch(plain.id, { rating: null });
    applyPatch(plain.id, { memory: 'y'.repeat(9000) });
    chk('a huge note is trimmed rather than synced',
        (row(plain.id).memory || '').length === MEMORY_MAX);
    applyPatch(plain.id, { memory: null });
    chk('the outbox gives up eventually', OUTBOX_MAX_TRIES > 0 && OUTBOX_MAX_TRIES < 100);

    // A signed link that has expired must not be handed back as if it worked.
    // photoSrc used to check only that a link existed, so after two hours a
    // session left open showed broken images and never re-signed them.
    const probe = { storage_path: 'selftest/probe.jpg', pending: false };
    signedUrls.set(probe.storage_path, { url: 'https://x/fresh', expires: Date.now() + 60000 });
    chk('a live signed link is used', photoSrc(probe) === 'https://x/fresh');
    signedUrls.set(probe.storage_path, { url: 'https://x/stale', expires: Date.now() - 1000 });
    chk('an expired signed link is not', photoSrc(probe) === '');
    signedUrls.delete(probe.storage_path);

    // Ids are what saved progress is stored against.
    chk('no two adventures share an id',
        new Set(ADV.map(a => a.id)).size === ADV.length);

    // User content is escaped.
    const payload = '<img src=x onerror="window.__xssProbe=1">';
    window.__xssProbe = 0;
    recs = [{ id: 'xss', created_by: 'u', author_name: payload, title: payload,
              place: payload, admin1: payload, country: 'AU', category: payload,
              description: payload, up_votes: 0, down_votes: 0, stars_sum: 0,
              stars_count: 0, report_count: 0, hidden: false, created_at: '2026-09-01' }];
    renderRecs(); await wait(150);
    chk('user content cannot inject markup',
        window.__xssProbe === 0 && $$$('#recList img').length === 0);
    recs = []; renderRecs();
  }

  async function testMeTab() {
    $('.tab[data-tab="tab-me"]').click(); await wait(120);
    for (const id of ['#newTripBtn', '#switchWho', '#notifyBtn', '#previewNotifyBtn',
                      '#refreshBtn', '#signOutBtn', '#deleteAccountBtn', '#groupPanel', '#realtimeState'])
      chk(`Me control present: ${id}`, !!$(id));

    const stats = $$$('#usStats .stat');
    chk('stats render', stats.length >= 6, `${stats.length} tiles`);
    chk('ticked-by hidden outside a group',
        !stats.some(s => /ticked by/.test(s.textContent)));

    const ach = $$$('.ach');
    chk('achievements render', ach.length >= 15, `${ach.length}`);
    const lot = ach.find(e => /The Lot/.test(e.textContent));
    chk('The Lot counts what can be completed', lot && lot.textContent.includes(String(countableTotal())),
        lot ? lot.textContent.replace(/\s+/g, ' ') : 'missing');

    // Make the progress this assertion needs, rather than depending on another
    // suite having run first. Tests that need each other's leftovers pass and
    // fail for reasons that have nothing to do with the code.
    // Tick something that is not already ticked, then check the invariant that
    // actually holds: with progress on the board, at least one achievement is
    // unlocked and some are still to earn. Asserting the locked count *drops*
    // on every tick is wrong - most ticks cross no threshold - and it only
    // ever passed when this suite happened to run against a clean slate.
    const fresh = ADV.find(x => !isDone(x.id));
    if (fresh) toggleDone(fresh.id);
    await wait(120);
    const unlocked = $$$('.ach:not(.locked)').length;
    chk('completing something unlocks an achievement',
        doneCount() > 0 && unlocked >= 1 && unlocked < ach.length,
        `${unlocked} of ${ach.length} unlocked, ${doneCount()} done`);
  }

  // Controls that keep a small visual size on purpose and expand the touch
  // area with an invisible ::after overlay. getBoundingClientRect cannot see
  // that, so the measurement has to be told - otherwise the check reports a
  // fault that was deliberately designed and already handled.
  const HIT_AREA_EXPANDED = ['tick', 'crumb-link', 'star', 'recv', 'reclink'];

  async function testAccessibility() {
    goTo('adventures', { continent: 'Oceania', country: 'AU' }); await wait(120);

    const interactive = $$$('button, a[href], input, select, textarea')
      .filter(e => e.offsetParent !== null);
    R.metric.interactiveControls = interactive.length;

    const small = interactive.filter(e => {
      if (HIT_AREA_EXPANDED.some(c => e.classList.contains(c))) return false;
      const r = e.getBoundingClientRect();
      return r.width && r.height && (r.width < 40 || r.height < 40);
    });
    if (small.length) warn('tap targets under 44px',
      `${small.length} of ${interactive.length}: ${[...new Set(small.map(e => e.className || e.tagName))].slice(0, 5).join(', ')}`);
    else ok('all tap targets at least 40px');

    const unlabelled = interactive.filter(e =>
      !e.textContent.trim() && !e.getAttribute('aria-label') && !e.getAttribute('title') &&
      !e.labels?.length && !e.getAttribute('placeholder'));
    chk('every control has an accessible name', unlabelled.length === 0,
        unlabelled.slice(0, 4).map(e => e.id || e.className || e.tagName).join(', '));

    const imgs = $$$('img').filter(i => i.offsetParent !== null);
    chk('images carry alt attributes', imgs.every(i => i.hasAttribute('alt')), `${imgs.length} images`);

    const text = $$$('.card-title, .card-meta, .placerow-label, .muted, .fineprint, .resultcount')
      .filter(e => e.offsetParent !== null).slice(0, 60);
    const low = text.map(e => ({ e, c: contrast(e) })).filter(x => x.c && x.c < 4.5);
    R.metric.lowestContrast = text.length
      ? Math.min(...text.map(e => contrast(e) || 21)).toFixed(2) : 'n/a';
    if (low.length) warn('contrast below WCAG AA 4.5:1',
      `${low.length} of ${text.length}, lowest ${Math.min(...low.map(x => x.c)).toFixed(2)}:1 on .${low[0].e.className.split(' ')[0]}`);
    else ok('body text meets WCAG AA contrast');

    chk('page declares a language', !!document.documentElement.lang, document.documentElement.lang);
    chk('viewport meta present', !!document.querySelector('meta[name="viewport"]'));
    chk('dialogs marked up as dialogs', $$$('[role="dialog"]').length >= 3);
    chk('live regions for status', $$$('[aria-live]').length >= 2);

    const zoomBlocked = (document.querySelector('meta[name="viewport"]')?.content || '').includes('maximum-scale=1');
    if (zoomBlocked) warn('pinch zoom disabled', 'maximum-scale=1 stops users enlarging the page');
  }

  async function testPerformance() {
    const t0 = performance.now();
    goTo('adventures', { continent: 'Oceania', country: 'AU' });
    await wait(0);
    R.metric.renderAllAuMs = Math.round(performance.now() - t0);
    chk('rendering 500 cards stays responsive', R.metric.renderAllAuMs < 1200, `${R.metric.renderAllAuMs}ms`);

    const t1 = performance.now();
    filters.q = 'a'; renderList(); filters.q = '';
    R.metric.searchMs = Math.round(performance.now() - t1);
    chk('search is fast', R.metric.searchMs < 600, `${R.metric.searchMs}ms`);

    const nav0 = performance.getEntriesByType('navigation')[0];
    if (nav0) {
      R.metric.pageLoadMs = Math.round(nav0.loadEventEnd - nav0.startTime);
      R.metric.domReadyMs = Math.round(nav0.domContentLoadedEventEnd - nav0.startTime);
    }
    const res = performance.getEntriesByType('resource');
    const bytes = res.reduce((s, r) => s + (r.transferSize || 0), 0);
    R.metric.transferredKB = Math.round(bytes / 1024);
    const dataRes = res.find(r => r.name.includes('adventures.json'));
    if (dataRes) R.metric.dataKB = Math.round((dataRes.transferSize || dataRes.decodedBodySize || 0) / 1024);
  }

  async function testPersistence() {
    const a = ADV.find(x => x.country === 'FJ');
    toggleDone(a.id); await wait(80);
    const stored = JSON.parse(localStorage.getItem('oaa.progress.v1') || '[]');
    chk('progress persists to storage', stored.some(r => r.adventure_id === a.id && r.completed));
    const outbox = JSON.parse(localStorage.getItem('oaa.outbox.v1') || '[]');
    chk('unsynced change queues in the outbox', outbox.some(r => r.adventure_id === a.id));
    chk('adventure list cached for offline', !!localStorage.getItem('oaa.adventures.v1'));
  }

  async function testRegionMatching() {
    const cases = [['AU','South Australia','SA'], ['AU','Victoria','VIC'], ['AU','Atlantis',null],
                   ['GB','Kent',null], ['NZ','Otago','Otago'], ['NZ','Canterbury','Canterbury'],
                   ['US','California','California'], ['CA','Alberta','Alberta'], ['ID','Bali','Bali']];
    const wrong = cases.filter(([c, s, want]) => matchRegion(c, s) !== want);
    chk('near-me region matching', wrong.length === 0,
        wrong.map(([c, s, w]) => `${c}/${s} got ${matchRegion(c, s)} want ${w}`).join('; '));
  }

  const SUITES = {
    data: testData, navigation: testNavigation, map: testMap,
    filters: testFilters, sheet: testSheet, photos: testPhotos,
    memories: testMemoriesTab, passport: testPassport, trips: testTrips,
    me: testMeTab, store: testStore, community: testCommunity, leaks: testLeaks,
    accessibility: testAccessibility,
    performance: testPerformance, persistence: testPersistence,
    regions: testRegionMatching,
  };
  window.selftestSuites = Object.keys(SUITES);

  // Two runs at once share R and reset() each other's state mid-suite, which
  // produces failures attributed to whichever suite happened to be running.
  // They are not real, and chasing one wastes an afternoon.
  let running = false;

  window.runDiagnostics = async function (opts = {}) {
    if (running) {
      return { error: 'a diagnostic run is already in progress',
               advice: 'wait for it to finish, or reload the page to abandon it' };
    }
    running = true;
    try {
      return await runSuites(opts);
    } finally {
      running = false;
    }
  };

  async function runSuites(opts) {
    R.pass.length = 0; R.fail.length = 0; R.warn.length = 0;
    const t0 = performance.now();
    await reset();
    const only = opts.only ? opts.only : Object.keys(SUITES);
    for (const [name, fn] of only.map(n => [n, SUITES[n]])) {
      try { await fn(); }
      catch (e) { bad(`${name} suite threw`, e && e.message); console.error(name, e); }
    }
    R.metric.totalMs = Math.round(performance.now() - t0);
    if (!opts.keep) await reset();
    return {
      passed: R.pass.length, failed: R.fail.length, warnings: R.warn.length,
      FAIL: R.fail, WARN: R.warn, metrics: R.metric,
      PASS: opts.verbose ? R.pass : `${R.pass.length} assertions passed`,
    };
  }
})();
