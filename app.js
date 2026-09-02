/* Our Australian Adventure — shared checklist for Riley & Elli
 *
 * How the syncing works, in short:
 *   - Every tick/rating/memory writes to a local cache FIRST, so the app
 *     stays instant and keeps working with no signal (which matters, given
 *     half this list is in places with no reception).
 *   - Writes then go into an outbox and get pushed to Supabase when online.
 *   - A realtime subscription pulls the other phone's changes down live.
 */
'use strict';

// ── Constants ────────────────────────────────────────────────────────
const LS = {
  progress: 'oaa.progress.v1',
  outbox:   'oaa.outbox.v1',
  who:      'oaa.who.v1',
  adv:      'oaa.adventures.v1',
};

const STATE_NAMES = {
  SA: 'South Australia', VIC: 'Victoria', NSW: 'New South Wales',
  QLD: 'Queensland', WA: 'Western Australia', TAS: 'Tasmania',
  NT: 'Northern Territory', ACT: 'Australian Capital Territory',
  AUS: 'Australia-wide',
};
const TOURISM = {
  SA: 'https://southaustralia.com', VIC: 'https://www.visitvictoria.com',
  NSW: 'https://www.visitnsw.com', QLD: 'https://www.queensland.com',
  WA: 'https://www.westernaustralia.com', TAS: 'https://www.discovertasmania.com.au',
  NT: 'https://northernterritory.com', ACT: 'https://visitcanberra.com.au',
  AUS: 'https://www.australia.com',
};
const COST_LABEL = ['Free', 'Under $25pp', '$25–75pp', '$75–200pp', '$200+pp'];
const DIFF_LABEL = ['', 'Very easy', 'Easy', 'Moderate', 'Hard', 'Serious undertaking'];

// ── App state ────────────────────────────────────────────────────────
let sb = null;                 // supabase client
let ADV = [];                  // all 500 adventures
let progress = new Map();      // adventure_id -> row
let who = localStorage.getItem(LS.who) || null;
let online = navigator.onLine;
let realtimeOk = false;
let openId = null;

const filters = { quick: 'all', q: '', st: 'All', cat: 'All', diff: 5, cost: 4 };

const $  = (s, r = document) => r.querySelector(s);
const $$ = (s, r = document) => [...r.querySelectorAll(s)];

// ── Small helpers ────────────────────────────────────────────────────
function readLS(key, fallback) {
  try { const v = localStorage.getItem(key); return v ? JSON.parse(v) : fallback; }
  catch { return fallback; }
}
function writeLS(key, value) {
  try { localStorage.setItem(key, JSON.stringify(value)); } catch { /* private mode / full */ }
}
function esc(s) {
  return String(s ?? '').replace(/[&<>"']/g, c =>
    ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#39;' }[c]));
}
function toast(msg) {
  const t = $('#toast');
  t.textContent = msg;
  t.classList.add('show');
  clearTimeout(toast._t);
  toast._t = setTimeout(() => t.classList.remove('show'), 2200);
}
function fmtDate(iso) {
  if (!iso) return '';
  const d = new Date(iso);
  return isNaN(d) ? '' : d.toLocaleDateString('en-AU', { day: 'numeric', month: 'short', year: 'numeric' });
}
function row(id) {
  return progress.get(id) || { adventure_id: id, completed: false, shortlisted: false, rating: null, memory: null };
}
function isDone(id)  { return !!row(id).completed; }
function doneCount() { let n = 0; for (const r of progress.values()) if (r.completed) n++; return n; }

// ── Sync status line ─────────────────────────────────────────────────
function setSync(text, warn) {
  const bar = $('#syncBar');
  bar.textContent = text || '';
  bar.classList.toggle('show', !!text);
  bar.classList.toggle('warn', !!warn);
}
function refreshSyncBar() {
  const pending = readLS(LS.outbox, []).length;
  if (!online)      return setSync(`Offline — ${pending || 'no'} change${pending === 1 ? '' : 's'} waiting to sync`, true);
  if (pending)      return setSync(`Syncing ${pending} change${pending === 1 ? '' : 's'}…`, true);
  if (!sb)          return setSync('Offline mode — progress saved on this phone only', true);
  if (!realtimeOk)  return setSync('Connected (live updates reconnecting…)');
  setSync('');
}

// ══════════════════════════════════════════════════════════════════════
//  Data loading
// ══════════════════════════════════════════════════════════════════════
async function loadAdventures() {
  try {
    const res = await fetch('data/adventures.json', { cache: 'no-cache' });
    if (!res.ok) throw new Error(res.status);
    ADV = await res.json();
    writeLS(LS.adv, ADV);
  } catch {
    ADV = readLS(LS.adv, []);                 // fall back to last good copy
    if (!ADV.length) throw new Error('Could not load the adventure list.');
  }
}

function loadLocalProgress() {
  progress = new Map(readLS(LS.progress, []).map(r => [r.adventure_id, r]));
}
function saveLocalProgress() {
  writeLS(LS.progress, [...progress.values()]);
}

// ══════════════════════════════════════════════════════════════════════
//  Writing — local first, then outbox, then server
// ══════════════════════════════════════════════════════════════════════
function applyPatch(id, patch) {
  const merged = { ...row(id), ...patch, adventure_id: id, updated_by: who, updated_at: new Date().toISOString() };
  progress.set(id, merged);
  saveLocalProgress();

  const outbox = readLS(LS.outbox, []);
  const existing = outbox.find(o => o.adventure_id === id);
  if (existing) Object.assign(existing, merged);
  else outbox.push(merged);
  writeLS(LS.outbox, outbox);

  renderAll();
  flushOutbox();
}

async function flushOutbox() {
  if (!sb || !online) return refreshSyncBar();
  const outbox = readLS(LS.outbox, []);
  if (!outbox.length) return refreshSyncBar();

  refreshSyncBar();
  const stillPending = [];
  for (const item of outbox) {
    const payload = {
      adventure_id: item.adventure_id,
      completed:    !!item.completed,
      completed_at: item.completed ? (item.completed_at || new Date().toISOString()) : null,
      completed_by: item.completed ? (item.completed_by || who) : null,
      shortlisted:  !!item.shortlisted,
      rating:       item.rating ?? null,
      memory:       item.memory ?? null,
      updated_by:   item.updated_by || who,
    };
    const { error } = await sb.from('progress').upsert(payload, { onConflict: 'adventure_id' });
    if (error) { stillPending.push(item); console.warn('sync failed', item.adventure_id, error.message); }
  }
  writeLS(LS.outbox, stillPending);
  refreshSyncBar();
}

// ══════════════════════════════════════════════════════════════════════
//  Reading from the server
// ══════════════════════════════════════════════════════════════════════
async function pullProgress() {
  if (!sb || !online) return;
  const { data, error } = await sb.from('progress').select('*');
  if (error) { console.warn('pull failed', error.message); return; }

  // Anything sitting in the outbox is newer than the server — don't stomp it.
  const pendingIds = new Set(readLS(LS.outbox, []).map(o => o.adventure_id));
  for (const r of data) if (!pendingIds.has(r.adventure_id)) progress.set(r.adventure_id, r);
  saveLocalProgress();
  renderAll();
}

function subscribeRealtime() {
  if (!sb) return;
  sb.channel('progress-sync')
    .on('postgres_changes', { event: '*', schema: 'public', table: 'progress' }, payload => {
      const r = payload.new;
      if (payload.eventType === 'DELETE') progress.delete(payload.old.adventure_id);
      else if (r) {
        // Ignore echoes of our own unsynced edits.
        if (readLS(LS.outbox, []).some(o => o.adventure_id === r.adventure_id)) return;
        const before = row(r.adventure_id);
        progress.set(r.adventure_id, r);
        if (r.completed && !before.completed && r.completed_by && r.completed_by !== who) {
          const a = ADV.find(x => x.id === r.adventure_id);
          if (a) toast(`${r.completed_by} ticked off “${a.title}”`);
        }
      }
      saveLocalProgress();
      renderAll();
    })
    .subscribe(status => {
      realtimeOk = status === 'SUBSCRIBED';
      refreshSyncBar();
    });
}

// ══════════════════════════════════════════════════════════════════════
//  Filtering + rendering
// ══════════════════════════════════════════════════════════════════════
function filtered() {
  const q = filters.q.trim().toLowerCase();
  return ADV.filter(a => {
    const r = row(a.id);
    if (filters.quick === 'todo'  && r.completed) return false;
    if (filters.quick === 'done'  && !r.completed) return false;
    if (filters.quick === 'short' && !r.shortlisted) return false;
    if (filters.quick === 'gem'   && !a.hidden_gem) return false;
    if (filters.st  !== 'All' && a.state !== filters.st) return false;
    if (filters.cat !== 'All' && a.category !== filters.cat) return false;
    if (a.difficulty > filters.diff) return false;
    if (a.cost > filters.cost) return false;
    if (q) {
      const hay = `${a.title} ${a.place} ${a.region} ${STATE_NAMES[a.state]} ${a.category} ${a.description}`.toLowerCase();
      if (!hay.includes(q)) return false;
    }
    return true;
  });
}

function cardHTML(a) {
  const r = row(a.id);
  return `<article class="card ${r.completed ? 'done' : ''}">
    <button class="tick ${r.completed ? 'on' : ''}" data-toggle="${a.id}"
            aria-label="${r.completed ? 'Mark not done' : 'Mark done'}">✓</button>
    <div class="card-body" data-open="${a.id}">
      <div class="card-title">${esc(a.title)}</div>
      <div class="card-meta">${esc(a.place)} · ${esc(a.region)}</div>
      <div class="badges">
        <span class="badge">${esc(a.category)}</span>
        <span class="badge">${'●'.repeat(a.difficulty)}${'○'.repeat(5 - a.difficulty)}</span>
        <span class="badge">${a.cost === 0 ? 'Free' : '$'.repeat(a.cost)}</span>
        ${a.hidden_gem ? '<span class="badge gem">💎 Hidden gem</span>' : ''}
        ${r.shortlisted ? '<span class="badge star">⭐ Shortlist</span>' : ''}
      </div>
    </div>
    <div class="card-open" data-open="${a.id}">›</div>
  </article>`;
}

function renderList() {
  const arr = filtered();
  $('#resultCount').textContent =
    `${arr.length} adventure${arr.length === 1 ? '' : 's'}` +
    (arr.length !== ADV.length ? ` of ${ADV.length}` : '');
  $('#list').innerHTML = arr.length
    ? arr.map(cardHTML).join('')
    : `<div class="empty">Nothing matches that.<br>Try clearing a filter.</div>`;
}

function renderHeader() {
  const done = doneCount();
  $('#progressCount').textContent = `${done} / ${ADV.length}`;
  $('#progressFill').style.width = `${(done / Math.max(ADV.length, 1)) * 100}%`;
}

function renderStates() {
  const group = (keyFn, order) => {
    const map = new Map();
    for (const a of ADV) {
      const k = keyFn(a);
      const m = map.get(k) || { total: 0, done: 0 };
      m.total++; if (isDone(a.id)) m.done++;
      map.set(k, m);
    }
    const keys = order || [...map.keys()].sort();
    return keys.filter(k => map.has(k)).map(k => {
      const m = map.get(k);
      const pct = Math.round((m.done / m.total) * 100);
      return `<div class="staterow">
        <div class="staterow-top"><span>${esc(k)}</span><span>${m.done} / ${m.total}</span></div>
        <div class="minibar"><i style="width:${pct}%"></i></div>
      </div>`;
    }).join('');
  };
  $('#stateGrid').innerHTML = group(a => STATE_NAMES[a.state], Object.values(STATE_NAMES));
  $('#catGrid').innerHTML   = group(a => a.category);
}

function renderMemories() {
  const done = ADV
    .filter(a => isDone(a.id))
    .sort((x, y) => new Date(row(y.id).completed_at || 0) - new Date(row(x.id).completed_at || 0));
  $('#memList').innerHTML = done.length ? done.map(a => {
    const r = row(a.id);
    return `<div class="memory" data-open="${a.id}">
      <b>${esc(a.title)}</b>
      <div class="card-meta">${esc(a.place)} · ${esc(STATE_NAMES[a.state])}</div>
      <div class="badges">
        ${r.completed_by ? `<span class="badge">Ticked by ${esc(r.completed_by)}</span>` : ''}
        ${r.completed_at ? `<span class="badge">${fmtDate(r.completed_at)}</span>` : ''}
        ${r.rating ? `<span class="badge star">${'★'.repeat(r.rating)}</span>` : ''}
      </div>
      <p class="${r.memory ? '' : 'nomemory'}">${esc(r.memory || 'No memory written yet — tap to add one.')}</p>
    </div>`;
  }).join('') : `<div class="empty">No adventures ticked off yet.<br>Go and make some. ❤️</div>`;
}

const ACHIEVEMENTS = [
  ['🌱', 'First Steps',      'Complete your first adventure',                  d => d.done >= 1],
  ['🔟', 'Getting Going',    'Complete 10 adventures',                         d => d.done >= 10],
  ['🎒', 'Proper Travellers','Complete 50 adventures',                         d => d.done >= 50],
  ['💯', 'Century',          'Complete 100 adventures',                        d => d.done >= 100],
  ['🏅', 'Halfway',          'Complete 250 adventures',                        d => d.done >= 250],
  ['👑', 'The Lot',          'Complete all 500 adventures',                    d => d.done >= 500],
  ['💎', 'Gem Hunters',      'Find 25 hidden gems',                            d => d.gems >= 25],
  ['🗺️', 'State Hopper',     'An adventure in all 8 states and territories',   d => d.states >= 8],
  ['⛰️', 'Hard Yards',       'Complete 5 adventures rated 5 for effort',       d => d.hard >= 5],
  ['💸', 'Cheap Dates',      'Complete 25 free adventures',                    d => d.free >= 25],
  ['📸', 'Storytellers',     'Write 20 memories',                              d => d.memories >= 20],
  ['⭐', 'Critics',          'Rate 20 adventures',                             d => d.ratings >= 20],
];

function achievementData() {
  const d = { done: 0, gems: 0, states: 0, hard: 0, free: 0, memories: 0, ratings: 0 };
  const states = new Set();
  for (const a of ADV) {
    const r = row(a.id);
    if (r.memory) d.memories++;
    if (r.rating) d.ratings++;
    if (!r.completed) continue;
    d.done++;
    if (a.hidden_gem) d.gems++;
    if (a.difficulty === 5) d.hard++;
    if (a.cost === 0) d.free++;
    if (a.state !== 'AUS') states.add(a.state);
  }
  d.states = states.size;
  return d;
}

function renderUs() {
  const d = achievementData();
  const rated = ADV.map(a => row(a.id).rating).filter(Boolean);
  const avg = rated.length ? (rated.reduce((s, n) => s + n, 0) / rated.length).toFixed(1) : '—';
  const shortlisted = [...progress.values()].filter(r => r.shortlisted && !r.completed).length;
  const byRiley = [...progress.values()].filter(r => r.completed && r.completed_by === 'Riley').length;
  const byElli  = [...progress.values()].filter(r => r.completed && r.completed_by === 'Elli').length;

  $('#usStats').innerHTML = `
    <div class="stat"><b>${d.done}</b><span>adventures done</span></div>
    <div class="stat"><b>${ADV.length - d.done}</b><span>still to go</span></div>
    <div class="stat"><b>${d.states} / 8</b><span>states &amp; territories</span></div>
    <div class="stat"><b>${d.gems}</b><span>hidden gems found</span></div>
    <div class="stat"><b>${avg}</b><span>average rating</span></div>
    <div class="stat"><b>${shortlisted}</b><span>on the shortlist</span></div>
    <div class="stat"><b>${byRiley}</b><span>ticked by Riley</span></div>
    <div class="stat"><b>${byElli}</b><span>ticked by Elli</span></div>`;

  $('#achList').innerHTML = ACHIEVEMENTS.map(([icon, name, desc, test]) =>
    `<div class="ach ${test(d) ? '' : 'locked'}">
       <span class="ach-icon">${icon}</span>
       <div><b>${esc(name)}</b><span>${esc(desc)}</span></div>
     </div>`).join('');

  $('#whoLabel').textContent = who || 'not set';
  $('#connState').textContent = sb
    ? (online ? (realtimeOk ? 'Connected and syncing live.' : 'Connected. Live updates reconnecting.')
              : 'Offline. Changes will sync when you get signal.')
    : 'Running offline — this phone only.';
}

function renderAll() {
  renderHeader();
  renderList();
  renderStates();
  renderMemories();
  renderUs();
  if (openId !== null) renderSheet(openId);
  refreshSyncBar();
}

// ══════════════════════════════════════════════════════════════════════
//  Detail sheet
// ══════════════════════════════════════════════════════════════════════
function renderSheet(id) {
  const a = ADV.find(x => x.id === id);
  if (!a) return;
  const r = row(id);
  const maps = `https://www.google.com/maps/search/?api=1&query=${encodeURIComponent(a.place + ', ' + STATE_NAMES[a.state] + ', Australia')}`;

  $('#sheetBody').innerHTML = `
    <h2>${esc(a.title)}</h2>
    <div class="sheet-place">${esc(a.place)} · ${esc(a.region)} · ${esc(STATE_NAMES[a.state])}</div>
    ${a.hidden_gem ? '<span class="badge gem">💎 Hidden gem</span>' : ''}
    <p class="sheet-desc">${esc(a.description)}</p>

    <div class="factgrid">
      <div class="fact"><b>Category</b><span>${esc(a.category)}</span></div>
      <div class="fact"><b>Effort</b><span>${esc(DIFF_LABEL[a.difficulty])}</span></div>
      <div class="fact"><b>Rough cost</b><span>${esc(COST_LABEL[a.cost])}</span></div>
      <div class="fact"><b>Time needed</b><span>${esc(a.duration)}</span></div>
      <div class="fact"><b>Best time</b><span>${esc(a.season)}</span></div>
      <div class="fact"><b>Adventure</b><span>#${a.id} of ${ADV.length}</span></div>
    </div>

    ${r.completed && r.completed_by ? `<div class="donenote">Ticked off by ${esc(r.completed_by)}${r.completed_at ? ' on ' + fmtDate(r.completed_at) : ''}.</div>` : ''}

    <div class="sheet-actions">
      <button class="btn-primary ${r.completed ? 'doneState' : ''}" data-act="toggle">
        ${r.completed ? '✓ Completed — tap to undo' : 'Mark as completed'}
      </button>
      <div class="rowbtns">
        <button class="btn-ghost" data-act="short">${r.shortlisted ? '⭐ On shortlist' : '☆ Add to shortlist'}</button>
        <a class="btn-ghost" href="${maps}" target="_blank" rel="noopener">📍 Open in Maps</a>
      </div>
      <a class="btn-ghost" href="${TOURISM[a.state]}" target="_blank" rel="noopener">
        Check current access on ${esc(a.state === 'AUS' ? 'australia.com' : STATE_NAMES[a.state] + ' tourism')}
      </a>
    </div>

    <h3>Our rating</h3>
    <div class="stars">
      ${[1, 2, 3, 4, 5].map(n => `<button data-rate="${n}" aria-label="${n} star${n > 1 ? 's' : ''}">${n <= (r.rating || 0) ? '★' : '☆'}</button>`).join('')}
    </div>

    <h3>Our memory of it</h3>
    <textarea id="memoryBox" placeholder="What actually happened…">${esc(r.memory || '')}</textarea>
    <div class="sheet-actions"><button class="btn-primary" data-act="saveMemory">Save memory</button></div>`;
}

function openSheet(id) {
  openId = id;
  renderSheet(id);
  $('#sheet').classList.remove('hidden');
}
function closeSheet() {
  const box = $('#memoryBox');                 // don't lose an unsaved memory
  if (box && openId !== null && box.value !== (row(openId).memory || '')) {
    applyPatch(openId, { memory: box.value.trim() || null });
  }
  openId = null;
  $('#sheet').classList.add('hidden');
}

function toggleDone(id) {
  const r = row(id);
  const nowDone = !r.completed;
  applyPatch(id, {
    completed: nowDone,
    completed_at: nowDone ? new Date().toISOString() : null,
    completed_by: nowDone ? who : null,
  });
  if (nowDone) {
    const a = ADV.find(x => x.id === id);
    toast(`✓ ${a ? a.title : 'Done'}`);
  }
}

// ══════════════════════════════════════════════════════════════════════
//  Wiring
// ══════════════════════════════════════════════════════════════════════
function buildFilterOptions() {
  const opt = (v, label, sel) => `<option value="${esc(v)}"${sel ? ' selected' : ''}>${esc(label)}</option>`;
  $('#fState').innerHTML = opt('All', 'All Australia') +
    Object.entries(STATE_NAMES).map(([k, v]) => opt(k, v)).join('');
  $('#fCat').innerHTML = opt('All', 'All categories') +
    [...new Set(ADV.map(a => a.category))].sort().map(c => opt(c, c)).join('');
  $('#fDiff').innerHTML = [5, 4, 3, 2, 1].map(n => opt(n, DIFF_LABEL[n] + ' or less', n === 5)).join('');
  $('#fCost').innerHTML = [4, 3, 2, 1, 0].map(n => opt(n, COST_LABEL[n] + (n ? ' or less' : ' only'), n === 4)).join('');
}

function wireUI() {
  // Tabs
  $$('.tab').forEach(b => b.onclick = () => {
    $$('.tab').forEach(x => x.classList.remove('active'));
    b.classList.add('active');
    $$('.panel').forEach(p => p.classList.add('hidden'));
    $('#' + b.dataset.tab).classList.remove('hidden');
    window.scrollTo(0, 0);
  });

  // Quick chips
  $$('#quickChips .chip').forEach(c => c.onclick = () => {
    filters.quick = c.dataset.quick;
    $$('#quickChips .chip').forEach(x => x.classList.toggle('on', x === c));
    renderList();
  });
  $('#quickChips .chip').classList.add('on');

  // Filters
  $('#search').oninput = e => { filters.q = e.target.value; renderList(); };
  $('#fState').onchange = e => { filters.st = e.target.value; renderList(); };
  $('#fCat').onchange   = e => { filters.cat = e.target.value; renderList(); };
  $('#fDiff').onchange  = e => { filters.diff = +e.target.value; renderList(); };
  $('#fCost').onchange  = e => { filters.cost = +e.target.value; renderList(); };
  $('#clearFilters').onclick = () => {
    Object.assign(filters, { quick: 'all', q: '', st: 'All', cat: 'All', diff: 5, cost: 4 });
    $('#search').value = ''; $('#fState').value = 'All'; $('#fCat').value = 'All';
    $('#fDiff').value = '5'; $('#fCost').value = '4';
    $$('#quickChips .chip').forEach((x, i) => x.classList.toggle('on', i === 0));
    renderList();
  };

  // Card taps (delegated — the list is re-rendered constantly)
  document.body.addEventListener('click', e => {
    const tick = e.target.closest('[data-toggle]');
    if (tick) { toggleDone(+tick.dataset.toggle); return; }
    const open = e.target.closest('[data-open]');
    if (open) { openSheet(+open.dataset.open); return; }
    if (e.target.closest('[data-close]')) { closeSheet(); return; }
  });

  // Sheet actions
  $('#sheetBody').addEventListener('click', e => {
    const rate = e.target.closest('[data-rate]');
    if (rate) { applyPatch(openId, { rating: +rate.dataset.rate }); return; }
    const act = e.target.closest('[data-act]');
    if (!act) return;
    if (act.dataset.act === 'toggle') toggleDone(openId);
    if (act.dataset.act === 'short')  applyPatch(openId, { shortlisted: !row(openId).shortlisted });
    if (act.dataset.act === 'saveMemory') {
      applyPatch(openId, { memory: $('#memoryBox').value.trim() || null });
      toast('Memory saved');
    }
  });

  // Random pick
  $('#randomBtn').onclick = () => {
    const pool = filtered().filter(a => !isDone(a.id));
    if (!pool.length) return toast('Nothing left matching those filters!');
    openSheet(pool[Math.floor(Math.random() * pool.length)].id);
  };

  // Settings
  $('#switchWho').onclick = () => { $('#whoami').classList.remove('hidden'); };
  $('#refreshBtn').onclick = async () => { await pullProgress(); toast('Refreshed'); };
  $('#signOutBtn').onclick = async () => {
    if (!confirm('Sign this phone out? Your shared progress stays safe on the server.')) return;
    if (sb) await sb.auth.signOut();
    localStorage.removeItem(LS.progress);
    location.reload();
  };

  $$('.btn-who').forEach(b => b.onclick = () => {
    who = b.dataset.who;
    localStorage.setItem(LS.who, who);
    $('#whoami').classList.add('hidden');
    renderAll();
  });

  // Connectivity
  addEventListener('online',  () => { online = true;  flushOutbox(); pullProgress(); });
  addEventListener('offline', () => { online = false; refreshSyncBar(); });
  addEventListener('visibilitychange', () => { if (!document.hidden) { flushOutbox(); pullProgress(); } });
}

// ══════════════════════════════════════════════════════════════════════
//  Sign in
// ══════════════════════════════════════════════════════════════════════
async function trySignIn(passphrase) {
  const msg = $('#lockMsg');
  const btn = $('#lockBtn');
  if (!sb) { msg.textContent = 'Can’t reach the server. Check your connection.'; return false; }
  btn.disabled = true; msg.className = 'lock-msg'; msg.textContent = 'Checking…';

  const { error } = await sb.auth.signInWithPassword({
    email: window.OAA_CONFIG.sharedEmail,
    password: passphrase,
  });
  btn.disabled = false;
  if (error) { msg.textContent = 'That passphrase didn’t work.'; return false; }
  msg.className = 'lock-msg ok'; msg.textContent = 'Welcome back.';
  return true;
}

async function enterApp() {
  $('#lock').classList.add('hidden');
  $('#app').classList.remove('hidden');
  if (!who) $('#whoami').classList.remove('hidden');
  renderAll();
  await pullProgress();
  subscribeRealtime();
  flushOutbox();
}

// ══════════════════════════════════════════════════════════════════════
//  Boot
// ══════════════════════════════════════════════════════════════════════
async function boot() {
  const cfg = window.OAA_CONFIG || {};
  const configured = cfg.supabaseUrl && !/YOUR_/.test(cfg.supabaseUrl) &&
                     cfg.supabaseAnonKey && !/YOUR_/.test(cfg.supabaseAnonKey);

  if (configured && window.supabase) {
    sb = window.supabase.createClient(cfg.supabaseUrl, cfg.supabaseAnonKey, {
      auth: { persistSession: true, autoRefreshToken: true, storageKey: 'oaa.auth' },
    });
  }

  try { await loadAdventures(); }
  catch (e) { $('#lockMsg').textContent = e.message; return; }

  loadLocalProgress();
  buildFilterOptions();
  wireUI();

  if (!sb) {                                   // no Supabase configured yet — run local-only
    $('#lockMsg').className = 'lock-msg';
    $('#lockMsg').textContent = 'Not connected to the shared database yet — continuing on this phone only.';
    setTimeout(enterApp, 900);
    return;
  }

  const { data: { session } } = await sb.auth.getSession();
  if (session) return enterApp();

  $('#lockForm').onsubmit = async e => {
    e.preventDefault();
    if (await trySignIn($('#passphrase').value)) enterApp();
  };
}

addEventListener('DOMContentLoaded', boot);

if ('serviceWorker' in navigator) {
  addEventListener('load', () => navigator.serviceWorker.register('sw.js').catch(() => {}));
}
