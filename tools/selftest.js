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
    progress = new Map();
    trips = [];
    pendingPhotos = [];
    photos = [];
    goTo('world');
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
    chk('country list populated', total === countOf(a => a.country === 'AU'), `${total}`);

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

  async function testPhotos() {
    const a = ADV.find(x => x.country === 'NZ');
    // Sized and textured like a real phone photo. A small flat-colour image
    // would already be under the 1600px cap and would re-encode to the same
    // number of bytes, so the shrink assertion would be meaningless.
    const c = document.createElement('canvas'); c.width = 3000; c.height = 2000;
    const x = c.getContext('2d');
    for (let i = 0; i < 1500; i++) {
      x.fillStyle = `hsl(${(i * 37) % 360},${40 + (i % 40)}%,${25 + (i % 50)}%)`;
      x.fillRect((i * 97) % 3000, (i * 53) % 2000, 60, 60);
    }
    const blob = await new Promise(r => c.toBlob(r, 'image/jpeg', 0.9));

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

    const thumb = $('.thumb:not(.add)');
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
    chk('The Lot counts the real list', lot && lot.textContent.includes(String(ADV.length)),
        lot ? lot.textContent.replace(/\s+/g, ' ') : 'missing');

    // Make the progress this assertion needs, rather than depending on another
    // suite having run first. Tests that need each other's leftovers pass and
    // fail for reasons that have nothing to do with the code.
    const lockedBefore = $$$('.ach.locked').length;
    if (!doneCount()) toggleDone(ADV[0].id);
    await wait(120);
    chk('completing something unlocks an achievement',
        $$$('.ach:not(.locked)').length >= 1 && $$$('.ach.locked').length < lockedBefore,
        `${$$$('.ach:not(.locked)').length} unlocked`);
  }

  async function testAccessibility() {
    goTo('adventures', { continent: 'Oceania', country: 'AU' }); await wait(120);

    const interactive = $$$('button, a[href], input, select, textarea')
      .filter(e => e.offsetParent !== null);
    R.metric.interactiveControls = interactive.length;

    const small = interactive.filter(e => {
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
    me: testMeTab, accessibility: testAccessibility,
    performance: testPerformance, persistence: testPersistence,
    regions: testRegionMatching,
  };
  window.selftestSuites = Object.keys(SUITES);

  window.runDiagnostics = async function (opts = {}) {
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
  };
})();
