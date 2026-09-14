/* Wayfinder — a shared list of real places worth going
 *
 * How the syncing works, in short:
 *   - Every tick/rating/memory writes to a local cache FIRST, so the app
 *     stays instant and keeps working with no signal (which matters, given
 *     half this list is in places with no reception).
 *   - Writes then go into an outbox and get pushed to Supabase when online.
 *   - A realtime subscription pulls the other phone's changes down live.
 */
'use strict';

// GitHub Pages cannot attach CSP frame-ancestors or X-Frame-Options response
// headers. frame-guard.js paints a refusal; this aborts before any account or
// device-local state is read. It is defense in depth, not a header substitute.
if (window.__WAYFINDER_FRAMED__) {
  throw new Error('Wayfinder refused to start inside a frame');
}

// ── Constants ────────────────────────────────────────────────────────
const LS = {
  progress: 'oaa.progress.v1',
  personalProgress: 'oaa.personal-progress.v1',
  outbox:   'oaa.outbox.v1',
  who:      'oaa.who.v1',
  adv:      'oaa.adventures.v1',
  trips:    'oaa.trips.v1',
  group:    'oaa.group.v1',
  notify:   'oaa.notify.v1',
  notifyLast: 'oaa.notifylast.v1',
  tripOutbox: 'oaa.tripoutbox.v1',
  view:     'oaa.view.v1',
  owner:    'oaa.local-owner.v1',
  accountUpgrade: 'oaa.account-upgrade.v1',
  accountDeletion: 'oaa.account-deletion.v1',
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
function costLabel(cost) {
  return Number.isInteger(cost) && cost >= 0 && cost < COST_LABEL.length
    ? COST_LABEL[cost] : 'Check pricing';
}
function seasonShareLabel(season) {
  return season === 'Check dates' ? 'dates: check before visiting' : `best ${season}`;
}
const DIFF_LABEL = ['', 'Very easy', 'Easy', 'Moderate', 'Hard', 'Serious undertaking'];

// ── App state ────────────────────────────────────────────────────────
let sb = null;                 // supabase client
let ADV = [];                  // all 500 adventures
let progress = new Map();      // adventure_id -> row
let personalProgress = new Map(); // canonical rows used when editing a group aggregate
let personalCacheReady = false;
let who = localStorage.getItem(LS.who) || null;
let online = navigator.onLine;
let realtimeOk = false;
let realtimeStatus = 'not started';
let openId = null;
let accountUser = null;
let accountIsAnonymous = false;
let passwordRecoveryMode = false;
let passwordRecoveryBusy = false;
let passwordRecoveryOwnerId = null;
let passwordRecoveryAttempt = 0;
let accountUiReady = false;
let accountBootReady = false;
let pendingPasswordRecovery = null;
let recoveryRequestBusy = false;
let recoveryRequestAttempt = 0;
let accountUpgradeBusy = false;
let verificationRefreshBusy = false;
let verificationResendBusy = false;
let authGeneration = 0;
let signOutHandling = false;
let signOutWork = null;
let accountDeletionInProgress = false;

const filters = { quick: 'all', q: '', st: 'All', cat: 'All', diff: 5, cost: 'All', dog: 'All' };

// Where we are in world -> continent -> country -> region -> adventures.
let nav = { level: 'world', continent: null, country: null, admin1: null };
let browserNavigationWired = false;
let pendingTripDeepLink = null;

const DOG_LABEL = {
  yes:   'Dogs welcome',
  no:    'No dogs',
  check: 'Check first',
};

const $  = (s, r = document) => r.querySelector(s);
const $$ = (s, r = document) => [...r.querySelectorAll(s)];
let queueRevisionCounter = 0;

function nextQueueRevision() {
  if (crypto.randomUUID) return crypto.randomUUID();
  queueRevisionCounter++;
  return `${Date.now().toString(36)}-${queueRevisionCounter}-${Math.random().toString(36).slice(2)}`;
}

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
// Australian entries store a state code; everywhere else admin1 is already a name.
// STATE_NAMES holds Australian abbreviations, so it is only consulted for
// Australian entries. Applying it globally would rename a US "WA" to Western
// Australia the day one is added - not broken today, but one entry away.
function regionName(a) {
  return (a.country === 'AU' && STATE_NAMES[a.admin1]) || a.admin1;
}
// Apple Maps on iOS, Google everywhere else. Searching by name rather than by
// coordinate, because the coordinates are honestly not in the data yet.
const IS_IOS = /iPad|iPhone|iPod/.test(navigator.userAgent)
            || (navigator.platform === 'MacIntel' && navigator.maxTouchPoints > 1);
function mapsUrl(a) {
  const q = encodeURIComponent(`${a.place}, ${regionName(a)}, ${countryName(a.country)}`);
  return IS_IOS ? `https://maps.apple.com/?q=${q}` : `https://www.google.com/maps/search/?api=1&query=${q}`;
}
// Place · region · country, skipping any part that just repeats the one before it.
function metaLine(a) {
  const parts = [a.place];
  if (a.region && a.region !== a.place) parts.push(a.region);
  if (!nav.country) parts.push(countryName(a.country));
  return parts.join(' · ');
}
/* Counting deliberately ignores locked gems.
 *
 * If a region has 71 adventures and 30 of them are gems you have not bought,
 * the target is 41, not 71. Otherwise nobody who declines to pay could ever
 * finish a region, earn its stamp, or unlock an achievement - the app would
 * hold completion hostage, which is a rotten thing to do and would fail
 * review besides. Buying a pack raises the target and the gems join in.
 *
 * Display is separate: locked gems still appear in the list, blurred.
 */
function isUnavailable(a) {
  return !!(a && a.availability && a.availability.status === 'unavailable');
}
function countable(a)  { return !isUnavailable(a) && !isLocked(a); }
function countableTotal() { return ADV.reduce((n, a) => n + (countable(a) ? 1 : 0), 0); }
function countOf(pred) { return ADV.filter(a => countable(a) && pred(a)).length; }
function doneOf(pred)  { return ADV.filter(a => countable(a) && pred(a) && isDone(a.id)).length; }
function unavailableOf(pred) { return ADV.filter(a => isUnavailable(a) && pred(a)).length; }
function catalogueHas(pred) { return ADV.some(pred); }
function doneCount() {
  let n = 0;
  for (const a of ADV) if (countable(a) && isDone(a.id)) n++;
  return n;
}

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
  const usable = rows => Array.isArray(rows) && rows.length > 0
    && rows.every(a => a && Number.isInteger(a.id) && typeof a.title === 'string');
  try {
    const res = await fetch('data/adventures.json', { cache: 'no-cache' });
    if (!res.ok) throw new Error(res.status);
    const incoming = await res.json();
    if (!usable(incoming)) throw new Error('Invalid adventure list');
    ADV = incoming;
    writeLS(LS.adv, ADV);
  } catch {
    ADV = readLS(LS.adv, []);                 // fall back to last good copy
    if (!usable(ADV)) throw new Error('Could not load the adventure list.');
  }
}

function loadLocalProgress() {
  progress = new Map(readLS(LS.progress, []).map(r => [r.adventure_id, r]));
  const cachedPersonal = readLS(LS.personalProgress, null);
  if (Array.isArray(cachedPersonal)) {
    personalProgress = new Map(cachedPersonal.map(r => [r.adventure_id, r]));
    personalCacheReady = true;
  } else if (progressView !== 'group') {
    personalProgress = new Map(progress);
    personalCacheReady = true;
  } else {
    personalProgress = new Map();
    personalCacheReady = false;
  }
}
function saveLocalProgress() {
  writeLS(LS.progress, [...progress.values()]);
  if (personalCacheReady) writeLS(LS.personalProgress, [...personalProgress.values()]);
}

async function bindLocalDataToUser() {
  if (!userId) return;
  const previous = localStorage.getItem(LS.owner);
  const privateKeys = [LS.progress, LS.personalProgress, LS.outbox, LS.trips,
    LS.tripOutbox, LS.group, LS.who, LS.view, LS.accountUpgrade];
  if (previous && previous !== userId) {
    for (const key of privateKeys) localStorage.removeItem(key);
    progress = new Map(); personalProgress = new Map(); personalCacheReady = false;
    trips = []; who = null; activeGroupId = null; progressView = 'personal';
    // Keep queued photos for their account across a direct A -> B session
    // replacement. Old queue rows predate owner_id, so attach them to the
    // previous account when that stored Supabase owner is valid.
    if (validAccountOwner(previous)) await idbAttributeLegacyQueueOwner(previous);
  } else {
    const outbox = readLS(LS.outbox, []).map(x => ({ ...x, owner_id: x.owner_id || userId,
      queue_rev: x.queue_rev || nextQueueRevision() }));
    const tripOutbox = readLS(LS.tripOutbox, []).map(x => ({ ...x, owner_id: x.owner_id || userId,
      queue_rev: x.queue_rev || nextQueueRevision() }));
    writeLS(LS.outbox, outbox); writeLS(LS.tripOutbox, tripOutbox);
  }
  localStorage.setItem(LS.owner, userId);
  loadLocalProgress(); loadLocalTrips();
}

function validAccountOwner(ownerId) {
  return /^[0-9a-f]{8}-[0-9a-f]{4}-[1-8][0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$/i.test(ownerId || '');
}

async function idbAttributeLegacyQueueOwner(ownerId) {
  if (!validAccountOwner(ownerId)) return false;
  const db = await idb();
  await new Promise((resolve, reject) => {
    const tx = db.transaction('queue', 'readwrite');
    const request = tx.objectStore('queue').openCursor();
    request.onsuccess = () => {
      const cursor = request.result;
      if (!cursor) return;
      if (!cursor.value.owner_id) cursor.update({ ...cursor.value, owner_id: ownerId });
      cursor.continue();
    };
    request.onerror = () => tx.abort();
    tx.oncomplete = () => resolve();
    tx.onerror = () => reject(tx.error || request.error);
    tx.onabort = () => reject(tx.error || request.error || new Error('Could not scope queued photos.'));
  });
  return true;
}

// ══════════════════════════════════════════════════════════════════════
//  Writing — local first, then outbox, then server
// ══════════════════════════════════════════════════════════════════════
const MEMORY_MAX = 2000;
// Enough to ride out a bad connection, few enough that a permanently
// rejected row does not retry for the life of the install.
const OUTBOX_MAX_TRIES = 12;

/* Keep what goes in matching what the database will accept.
 *
 * rating has a `between 1 and 5` check on the server. A value outside that is
 * accepted locally, then rejected on every sync attempt for ever - the row
 * sits in the outbox, the sync bar says changes are waiting, and nothing ever
 * clears it. Better to refuse it here, where it can be explained.
 */
function cleanPatch(patch) {
  const out = { ...patch };
  if ('rating' in out && out.rating != null) {
    const n = Math.round(Number(out.rating));
    out.rating = Number.isFinite(n) && n >= 1 && n <= 5 ? n : null;
  }
  if ('memory' in out && typeof out.memory === 'string' && out.memory.length > MEMORY_MAX) {
    out.memory = out.memory.slice(0, MEMORY_MAX);
    toast(`Note trimmed to ${MEMORY_MAX} characters`);
  }
  return out;
}

function applyPatch(id, patch) {
  if (accountDeletionInProgress) return false;
  if (progressView === 'group' && !personalCacheReady) {
    toast('Reconnect before editing your personal progress from the group view');
    return false;
  }
  patch = cleanPatch(patch);
  const base = progressView === 'group'
    ? (personalProgress.get(id) || { adventure_id: id, completed: false, shortlisted: false, rating: null, memory: null })
    : row(id);
  const merged = { ...base, ...patch, adventure_id: id, owner_id: userId,
    queue_rev: nextQueueRevision(),
    updated_by: who, updated_at: new Date().toISOString() };
  progress.set(id, merged);
  personalProgress.set(id, merged);
  personalCacheReady = true;
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
  if (!sb || !online || accountDeletionInProgress) return refreshSyncBar();
  if (flushOutbox.busy) { flushOutbox.requested = true; return; }
  flushOutbox.busy = true;
  const runOwner = userId, runGeneration = authGeneration;
  const outbox = readLS(LS.outbox, []);
  if (!outbox.length) { flushOutbox.busy = false; return refreshSyncBar(); }

  refreshSyncBar();
  try {
    for (const item of outbox) {
      if (runGeneration !== authGeneration || runOwner !== userId || item.owner_id !== runOwner) break;
      const payload = {
        adventure_id: item.adventure_id,
        completed:    !!item.completed,
        completed_at: item.completed ? (item.completed_at || new Date().toISOString()) : null,
        completed_by: item.completed ? who : null,
        completed_by_id: item.completed ? runOwner : null,
        shortlisted:  !!item.shortlisted,
        rating:       item.rating ?? null,
        memory:       item.memory ?? null,
        updated_by:   item.updated_by || who,
        user_id: runOwner, group_id: null,
      };
      let { error } = await sb.from('progress')
        .upsert(payload, { onConflict: 'adventure_id,scope_id' });
      if (runGeneration !== authGeneration || runOwner !== userId) break;
      if (error && /no unique|constraint matching|scope_id/i.test(error.message || '')) {
        ({ error } = await sb.from('progress').upsert(payload, { onConflict: 'adventure_id' }));
        if (runGeneration !== authGeneration || runOwner !== userId) break;
      }

      // Mutate only the exact version sent. A newer edit with the same
      // adventure id may have arrived while the request was in flight.
      const current = readLS(LS.outbox, []);
      const index = current.findIndex(x => x.adventure_id === item.adventure_id
        && x.owner_id === item.owner_id && x.queue_rev === item.queue_rev);
      if (index < 0) continue;
      if (!error) current.splice(index, 1);
      else {
        current[index].tries = (current[index].tries || 0) + 1;
        console.warn('sync failed', item.adventure_id, error.message, `(attempt ${current[index].tries})`);
        if (current[index].tries >= OUTBOX_MAX_TRIES) {
          console.error('giving up on', item.adventure_id, error.message);
          current.splice(index, 1);
          toast('One change could not be saved to the server');
        }
      }
      writeLS(LS.outbox, current);
    }
  } finally {
    flushOutbox.busy = false;
    refreshSyncBar();
    if (flushOutbox.requested && runGeneration === authGeneration && runOwner === userId) {
      flushOutbox.requested = false;
      queueMicrotask(flushOutbox);
    }
  }
}

// ══════════════════════════════════════════════════════════════════════
//  Reading from the server
// ══════════════════════════════════════════════════════════════════════
const PROGRESS_PAGE_SIZE = 500;

async function fetchAllPersonalProgress(ownerId) {
  const rows = [];
  for (let from = 0; ; from += PROGRESS_PAGE_SIZE) {
    const { data, error } = await sb.from('progress').select('*').eq('user_id', ownerId)
      .order('id').range(from, from + PROGRESS_PAGE_SIZE - 1);
    if (error) return { data: null, error };
    const page = data || [];
    rows.push(...page);
    if (page.length < PROGRESS_PAGE_SIZE) return { data: rows, error: null };
  }
}

async function fetchAllGroupCompletions(groupId) {
  const rows = [];
  for (let from = 0; ; from += PROGRESS_PAGE_SIZE) {
    const { data, error } = await sb.rpc('group_completion_feed', { p_group_id: groupId })
      .order('adventure_id').order('completed_by_id').range(from, from + PROGRESS_PAGE_SIZE - 1);
    if (error) return { data: null, error };
    const page = data || [];
    rows.push(...page);
    if (page.length < PROGRESS_PAGE_SIZE) return { data: rows, error: null };
  }
}

function canonicalPersonalProgress(rows) {
  const best = new Map();
  for (const row of rows || []) {
    const prior = best.get(row.adventure_id);
    if (!prior) { best.set(row.adventure_id, row); continue; }
    const rowIsPersonal = row.group_id == null, priorIsPersonal = prior.group_id == null;
    if (rowIsPersonal !== priorIsPersonal) {
      if (rowIsPersonal) best.set(row.adventure_id, row);
      continue;
    }
    const rowKey = `${row.updated_at || ''}|${row.id || ''}`;
    const priorKey = `${prior.updated_at || ''}|${prior.id || ''}`;
    if (rowKey > priorKey) best.set(row.adventure_id, row);
  }
  return best;
}

async function pullProgress() {
  if (!sb || !online) return;
  const runOwner = userId, runGeneration = authGeneration;
  const runView = progressView, runGroup = activeGroupId;
  const stillCurrent = () => runGeneration === authGeneration && runOwner === userId
    && runView === progressView && runGroup === activeGroupId;
  let data, error;
  if (runView === 'group' && runGroup) {
    ({ data, error } = await fetchAllGroupCompletions(runGroup));
    if (!stillCurrent()) return;
    const own = await fetchAllPersonalProgress(runOwner);
    if (!stillCurrent()) return;
    if (!own.error) {
      const ownRows = canonicalPersonalProgress(own.data);
      for (const pending of readLS(LS.outbox, [])) {
        if (pending.owner_id === runOwner) ownRows.set(pending.adventure_id, pending);
      }
      personalProgress = ownRows;
      personalCacheReady = true;
    }
  } else {
    ({ data, error } = await fetchAllPersonalProgress(runOwner));
  }
  if (!stillCurrent()) return;
  if (error) { console.warn('pull failed', error.message); return; }
  if (runView === 'personal') data = [...canonicalPersonalProgress(data).values()];

  // Anything sitting in the outbox is newer than the server — don't stomp it.
  const pendingRows = readLS(LS.outbox, []).filter(o => o.owner_id === runOwner);
  const pendingIds = new Set(pendingRows.map(o => o.adventure_id));
  // A group can contain one canonical row per person for the same adventure.
  // Completed wins, then the latest edit supplies the attribution/details.
  const best = new Map();
  for (const r of data) {
    if (pendingIds.has(r.adventure_id)) continue;
    const prev = best.get(r.adventure_id);
    if (!prev) { best.set(r.adventure_id, r); continue; }
    if (r.completed && !prev.completed) best.set(r.adventure_id, r);
    else if (!!r.completed === !!prev.completed && (r.updated_at || '') > (prev.updated_at || '')) best.set(r.adventure_id, r);
  }
  for (const item of pendingRows) best.set(item.adventure_id, item);
  if (!stillCurrent()) return;
  progress = best;
  if (progressView === 'personal') {
    personalProgress = new Map(best);
    personalCacheReady = true;
  }
  saveLocalProgress();
  renderAll();
}

async function resubscribeRealtime() {
  if (!sb) return;
  try { await sb.removeAllChannels(); } catch { /* subscribeRealtime clears up */ }
  realtimeOk = false;
  realtimeStatus = 'reconnecting';
  try {
    subscribeRealtime();
  } catch (e) {
    // Never let a failed reconnect take the caller down with it. The status
    // line is what tells somebody sync is not running.
    console.warn('resubscribe', e);
    realtimeStatus = 'reconnect failed: ' + (e && e.message);
    refreshSyncBar();
  }
}

const RT_CHANNELS = ['progress-sync', 'group-progress-sync', 'group-sync', 'member-sync', 'photo-sync', 'trip-sync'];

function subscribeRealtime() {
  if (!sb) return;
  const subscriptionOwner = userId, subscriptionGeneration = authGeneration;
  const subscriptionCurrent = () => subscriptionOwner === userId
    && subscriptionGeneration === authGeneration;
  // Supabase hands back the EXISTING channel for a topic, and refuses new
  // listeners on one that has already subscribed - it throws. So calling this
  // twice used to kill the caller, and a reconnect where removeAllChannels()
  // had not fully settled would throw here and leave realtime dead with
  // nothing on screen to say so. That is exactly what "the two phones stopped
  // agreeing" looks like. Clearing first makes it safe to call at any time.
  for (const ch of sb.getChannels()) {
    if (RT_CHANNELS.includes(ch.topic.replace(/^realtime:/, ''))) {
      try { sb.removeChannel(ch); } catch { /* already gone */ }
    }
  }

  sb.channel('progress-sync')
    .on('postgres_changes', { event: '*', schema: 'public', table: 'progress' }, payload => {
      if (!subscriptionCurrent()) return;
      const r = payload.new;
      if (progressView === 'group') { pullProgress(); return; }
      const changed = payload.new || payload.old;
      if (changed && changed.user_id !== userId) return;
      if (payload.eventType === 'DELETE') progress.delete(payload.old.adventure_id);
      else if (r) {
        // Ignore echoes of our own unsynced edits.
        if (readLS(LS.outbox, []).some(o => o.adventure_id === r.adventure_id)) return;
        const before = row(r.adventure_id);
        progress.set(r.adventure_id, r);
        if (r.completed && !before.completed && r.completed_by_id !== userId) {
          const a = ADV.find(x => x.id === r.adventure_id);
          if (a) toast(`${nameOf(r.completed_by_id, r.completed_by)} ticked off “${safeTitle(a)}”`);
        }
      }
      saveLocalProgress();
      renderAll();
    })
    .subscribe((status, err) => {
      if (!subscriptionCurrent()) return;
      realtimeOk = status === 'SUBSCRIBED';
      realtimeStatus = status + (err ? ` (${err.message})` : '');
      if (err) console.warn('realtime', status, err);
      refreshSyncBar();
      renderMe();
    });

  sb.channel('group-progress-sync')
    .on('postgres_changes', { event: '*', schema: 'public', table: 'group_progress' }, () => {
      if (!subscriptionCurrent()) return;
      if (progressView === 'group') pullProgress();
    })
    .subscribe();

  // Invite state and ownership are account-visible group fields. Refresh the
  // aligned membership model when an owner rotates/revokes an invite,
  // transfers ownership or disposes of the group on another device.
  sb.channel('group-sync')
    .on('postgres_changes', { event: '*', schema: 'public', table: 'groups' }, async () => {
      if (!subscriptionCurrent()) return;
      await loadGroups();
      if (!subscriptionCurrent()) return;
      renderAll();
    })
    .subscribe();

  // Someone renaming themselves has to reach the other phones straight away,
  // or "ticked by" goes stale again in a different way.
  sb.channel('member-sync')
    .on('postgres_changes', { event: '*', schema: 'public', table: 'group_members' }, async () => {
      if (!subscriptionCurrent()) return;
      await loadGroups();
      if (!subscriptionCurrent()) return;
      renderAll();
    })
    .subscribe();

  sb.channel('photo-sync')
    .on('postgres_changes', { event: '*', schema: 'public', table: 'photos' }, payload => {
      if (!subscriptionCurrent()) return;
      if (payload.eventType === 'DELETE') {
        photos = photos.filter(p => p.id !== payload.old.id);
      } else if (payload.new) {
        const i = photos.findIndex(p => p.id === payload.new.id);
        if (i >= 0) photos[i] = payload.new; else photos.push(payload.new);
      }
      renderMemories();
      if (openId !== null) renderSheet(openId);
    })
    .subscribe();

  sb.channel('trip-sync')
    .on('postgres_changes', { event: '*', schema: 'public', table: 'trips' }, payload => {
      if (!subscriptionCurrent()) return;
      if (readLS(LS.tripOutbox, []).some(t => t.id === (payload.new || payload.old).id)) return;
      if (payload.eventType === 'DELETE') trips = trips.filter(t => t.id !== payload.old.id);
      else if (payload.new) {
        const i = trips.findIndex(t => t.id === payload.new.id);
        if (i >= 0) trips[i] = payload.new; else trips.push(payload.new);
      }
      saveLocalTrips();
      renderTrips();
      if (openTripId) renderTripSheet(openTripId);
    })
    .subscribe();
}

/* ══════════════════════════════════════════════════════════════════════
 *  Keeping up to date
 * ══════════════════════════════════════════════════════════════════════
 *
 * Realtime carries ticks, photos and trips the moment they change, and it is
 * the right mechanism for those. It is not the whole story:
 *
 *   - a websocket that dropped while the phone was asleep reconnects, but
 *     everything that happened in between arrived nowhere;
 *   - postgres_changes only fires for tables in the publication, so a group
 *     being renamed or somebody joining can be missed entirely;
 *   - a phone that has been in a pocket for an hour has no idea.
 *
 * So there is also a plain poll, and a gesture. Neither replaces realtime -
 * they catch what it drops.
 */

const SYNC_EVERY = 45000;        // while the app is actually on screen
let syncTimer = null;
let syncing = false;

/* Everything, from the server, now.
 *
 * Groups first: members and the active group decide what the other pulls are
 * even allowed to see, so pulling progress before knowing the group would ask
 * the wrong question. Quiet by default because it runs on a timer - only a
 * refresh somebody asked for says anything.
 */
async function syncNow({ loud = false } = {}) {
  if (!sb || !online || syncing) return false;
  syncing = true;
  try {
    await loadGroups();
    await pullProgress();
    await pullPhotos();
    await pullTrips();
    if ($('.tab.active') && $('.tab.active').dataset.tab === 'tab-community') {
      await pullRecommendations();
    }
    renderAll();
    if (loud) toast('Up to date');
    return true;
  } catch (e) {
    console.warn('sync', e);
    if (loud) toast('Could not reach the server');
    return false;
  } finally {
    syncing = false;
  }
}

/* Poll only while somebody is looking.
 *
 * A timer that keeps firing in a backgrounded tab spends battery to update a
 * screen nobody can see, and browsers throttle it to roughly a minute anyway,
 * so the honest thing is to stop and catch up on the way back in.
 */
function startSyncTicker() {
  const stop = () => { clearInterval(syncTimer); syncTimer = null; };
  const start = () => { if (!syncTimer) syncTimer = setInterval(() => syncNow(), SYNC_EVERY); };

  addEventListener('visibilitychange', () => {
    if (document.hidden) { stop(); return; }
    // Coming back is the moment most likely to be out of date, so do not wait
    // for the next tick - and re-establish realtime, which a sleeping phone
    // will usually have lost.
    start();
    syncNow();
    if (!realtimeOk) resubscribeRealtime();
  });

  if (!document.hidden) start();
}

/* Pull down to refresh.
 *
 * Only from the very top of the page, so it can never fight a normal scroll.
 * The drag is damped - you move the indicator a third as far as your finger -
 * which is what makes it feel like resistance rather than a stuck element.
 */
function wirePullToRefresh() {
  const el = $('#pull');
  if (!el) return;
  const TRIGGER = 70;
  let startY = 0, pulling = false, distance = 0;

  const atTop = () => (document.scrollingElement || document.documentElement).scrollTop <= 0;
  const show = (y, cls) => {
    el.classList.toggle('dragging', cls === 'dragging');
    el.classList.toggle('settling', cls !== 'dragging');
    el.classList.toggle('busy', cls === 'busy');
    el.style.transform = `translateY(${y}px)`;
    el.style.opacity = Math.min(1, Math.max(0, (y + 40) / 70));
  };
  const hide = () => { show(-60, 'settling'); };

  addEventListener('touchstart', e => {
    if (!atTop() || e.touches.length !== 1) return;
    // A sheet or the lightbox scrolls inside itself; pulling the page behind
    // one is never what was meant.
    if ($$('.sheet:not(.hidden), .lightbox:not(.hidden)').length) return;
    startY = e.touches[0].clientY;
    pulling = true;
    distance = 0;
  }, { passive: true });

  addEventListener('touchmove', e => {
    if (!pulling) return;
    distance = e.touches[0].clientY - startY;
    if (distance <= 0 || !atTop()) { pulling = false; hide(); return; }
    show(Math.min(distance / 3, 90) - 40, 'dragging');
  }, { passive: true });

  addEventListener('touchend', async () => {
    if (!pulling) return;
    pulling = false;
    // The finger has to travel three times the indicator, because the drag is
    // damped by three. Anything shorter is somebody scrolling up.
    if (distance < TRIGGER * 3) { hide(); return; }
    show(24, 'busy');
    await syncNow({ loud: true });
    hide();
  });
}


// ══════════════════════════════════════════════════════════════════════
//  Photos
// ══════════════════════════════════════════════════════════════════════
//  Pipeline for each picked photo:
//    1. read the real "date taken" out of the file's EXIF before we touch it
//    2. resize to something sane for the phone's app-private storage
//    3. persist the blob and metadata in IndexedDB under the signed-in account
//  New photos never leave this device. Existing cloud photos remain readable.

const BUCKET = 'memories';
const MAX_EDGE = 1600;
const JPEG_QUALITY = 0.82;
const SIGNED_TTL = 7200;                       // 2 hours

let photos = [];                               // device-local records + legacy cloud rows
let pendingPhotos = [];                        // old upload queue, converted locally on sight
const signedUrls = new Map();                  // storage_path -> { url, expires }
let uploading = 0;
let photoTargetId = null;                      // which adventure the picker is for
let lightbox = { list: [], index: 0 };

// ── App-private photo storage ────────────────────────────────────────
const LOCAL_PHOTO_STORE = 'local-photos';
function idb() {
  return new Promise((resolve, reject) => {
    const req = indexedDB.open('oaa-photos', 2);
    req.onupgradeneeded = () => {
      if (!req.result.objectStoreNames.contains('queue')) {
        req.result.createObjectStore('queue', { keyPath: 'id' });
      }
      if (!req.result.objectStoreNames.contains(LOCAL_PHOTO_STORE)) {
        req.result.createObjectStore(LOCAL_PHOTO_STORE, { keyPath: 'local_key' });
      }
    };
    req.onsuccess = () => resolve(req.result);
    req.onerror = () => reject(req.error);
    req.onblocked = () => reject(new Error('Close other Wayfinder tabs before saving photos.'));
  });
}
async function idbAll() {
  try {
    const db = await idb();
    const queued = await new Promise((res, rej) => {
      const r = db.transaction('queue').objectStore('queue').getAll();
      r.onsuccess = () => res(r.result || []);
      r.onerror = () => rej(r.error);
    });
    const mine = [], remaining = [];
    for (const item of queued) {
      if (item.owner_id && item.owner_id !== userId) continue;
      if (!item.owner_id && localStorage.getItem(LS.owner) !== userId) continue;
      const owned = { ...item, owner_id: item.owner_id || userId };
      try {
        await saveLocalPhoto(owned);
        await idbDelete(item.id);
      } catch {
        try { await idbPut(owned); } catch { /* original queue row remains */ }
        remaining.push(owned);
      }
    }
    photos = await idbLocalAll(userId);
    return remaining;
  } catch { return []; }
}
async function idbPut(item) {
  await idbWrite('queue', store => store.put(item));
}
async function idbDelete(id) {
  await idbWrite('queue', store => store.delete(id));
}

async function idbWrite(storeName, operation) {
  const db = await idb();
  await new Promise((resolve, reject) => {
    const tx = db.transaction(storeName, 'readwrite');
    let request;
    const failed = () => reject(tx.error || (request && request.error)
      || new Error('Local photo storage transaction failed.'));
    tx.oncomplete = () => resolve();
    tx.onerror = failed;
    tx.onabort = failed;
    try {
      request = operation(tx.objectStore(storeName));
      request.onerror = failed;
    } catch (error) {
      try { tx.abort(); } catch { /* transaction may already be inactive */ }
      reject(error);
    }
  });
}

async function idbClear() {
  // Sign-out calls this legacy helper. Account-scoped photos and old queued
  // items must survive sign-out so their owner gets them back after sign-in.
}

function localPhotoRecord(item) {
  const owner = item.owner_id || item.user_id;
  if (!owner) throw new Error('A signed-in account is required to save this photo.');
  return {
    ...item,
    owner_id: owner,
    user_id: owner,
    group_id: null,
    local: true,
    local_key: `${owner}:${item.id}`,
  };
}

async function idbLocalPut(item) {
  const record = localPhotoRecord(item);
  await idbWrite(LOCAL_PHOTO_STORE, store => store.put(record));
  return record;
}

async function idbLocalRows() {
  const db = await idb();
  return new Promise((resolve, reject) => {
    const req = db.transaction(LOCAL_PHOTO_STORE).objectStore(LOCAL_PHOTO_STORE).getAll();
    req.onsuccess = () => resolve(req.result || []);
    req.onerror = () => reject(req.error);
  });
}

async function idbLocalAll(ownerId) {
  if (!ownerId) return [];
  const rows = (await idbLocalRows()).filter(row => row.owner_id === ownerId);
  const visible = [];
  for (const row of rows) {
    if (!row.deleting) { visible.push(localPhotoRecord(row)); continue; }
    try {
      const files = nativePhotoFiles();
      if (files && row.native_path) await files.remove(ownerId, row.native_path);
      await idbLocalDelete(ownerId, row.id);
    } catch { /* keep the deletion marker and retry after the next sign-in */ }
  }
  return visible;
}

async function idbLocalDelete(ownerId, id) {
  if (!ownerId || !id) return;
  await idbWrite(LOCAL_PHOTO_STORE, store => store.delete(`${ownerId}:${id}`));
}

async function idbDeleteQueueOwner(ownerId) {
  const db = await idb();
  const includeUnowned = localStorage.getItem(LS.owner) === ownerId;
  const queued = await new Promise((resolve, reject) => {
    const req = db.transaction('queue').objectStore('queue').getAll();
    req.onsuccess = () => resolve(req.result || []);
    req.onerror = () => reject(req.error);
  });
  for (const item of queued) {
    if (item.owner_id === ownerId || (includeUnowned && !item.owner_id)) {
      await idbWrite('queue', store => store.delete(item.id));
    }
  }
}

async function idbDeleteLocalOwner(ownerId) {
  const rows = (await idbLocalRows()).filter(row => row.owner_id === ownerId);
  const files = nativePhotoFiles();
  if (files) {
    for (const file of await files.list(ownerId)) await files.remove(ownerId, file.path);
  }
  for (const row of rows) await idbLocalDelete(ownerId, row.id);
  const db = await idb();
  const queued = await new Promise((resolve, reject) => {
    const req = db.transaction('queue').objectStore('queue').getAll();
    req.onsuccess = () => resolve(req.result || []);
    req.onerror = () => reject(req.error);
  });
  for (const item of queued) {
    if (item.owner_id === ownerId) await idbDelete(item.id);
  }
}

function nativePhotoFiles() {
  const files = window.WayfinderPhotoFiles;
  return files && files.isNative() ? files : null;
}

async function saveLocalPhoto(item) {
  const record = localPhotoRecord(item);
  const files = nativePhotoFiles();
  if (!files) return idbLocalPut(record);

  const stored = await files.save(record.owner_id, record.id, record.blob);
  const { blob, ...metadata } = record;
  const nativeRecord = {
    ...metadata,
    native_path: stored.path,
    bytes: stored.bytes == null ? record.bytes : stored.bytes,
  };
  try {
    return await idbLocalPut(nativeRecord);
  } catch (error) {
    try { await files.remove(record.owner_id, stored.path); } catch { /* durable queue retries */ }
    throw error;
  }
}

async function discardSavedLocalPhoto(record) {
  const files = nativePhotoFiles();
  if (files && record.native_path) {
    await idbLocalPut({ ...record, deleting: true });
    await files.remove(record.owner_id, record.native_path);
  }
  await idbLocalDelete(record.owner_id, record.id);
}

let localPersistenceRequested = false;
async function requestLocalPhotoPersistence() {
  if (localPersistenceRequested || nativePhotoFiles()) return;
  localPersistenceRequested = true;
  try { await navigator.storage?.persist?.(); } catch { /* browser decides */ }
}

function releaseLocalPhotoUrls() {
  for (const url of objectUrls.values()) URL.revokeObjectURL(url);
  objectUrls.clear();
}

// ── EXIF: the camera's own timestamp ─────────────────────────────────
// The file's lastModified date is the filesystem's, and it changes whenever
// a photo is copied or synced. EXIF DateTimeOriginal is what the camera
// actually recorded, so we read that first and only fall back if it's absent.
async function readExifDate(file) {
  try {
    const buf = await file.slice(0, 262144).arrayBuffer();
    const view = new DataView(buf);
    if (view.byteLength < 4 || view.getUint16(0) !== 0xFFD8) return null;   // not a JPEG

    let offset = 2;
    while (offset + 4 < view.byteLength) {
      if (view.getUint8(offset) !== 0xFF) { offset++; continue; }
      const marker = view.getUint8(offset + 1);
      const size = view.getUint16(offset + 2);
      if (marker === 0xE1) {                                               // APP1
        const tiff = offset + 10;                                          // skip "Exif\0\0"
        if (tiff + 8 > view.byteLength) return null;
        const little = view.getUint16(tiff) === 0x4949;
        const readShort = o => view.getUint16(o, little);
        const readLong  = o => view.getUint32(o, little);

        const findTag = (dirStart, tag) => {
          if (dirStart + 2 > view.byteLength) return null;
          const count = readShort(dirStart);
          for (let i = 0; i < count; i++) {
            const entry = dirStart + 2 + i * 12;
            if (entry + 12 > view.byteLength) break;
            if (readShort(entry) === tag) return entry;
          }
          return null;
        };

        const ifd0 = tiff + readLong(tiff + 4);
        const exifPtr = findTag(ifd0, 0x8769);
        if (!exifPtr) return null;
        const exifDir = tiff + readLong(exifPtr + 8);

        // 0x9003 DateTimeOriginal, falling back to 0x9004 DateTimeDigitized
        const dateEntry = findTag(exifDir, 0x9003) || findTag(exifDir, 0x9004);
        if (!dateEntry) return null;
        const strOffset = tiff + readLong(dateEntry + 8);
        let str = '';
        for (let i = 0; i < 19 && strOffset + i < view.byteLength; i++) {
          str += String.fromCharCode(view.getUint8(strOffset + i));
        }
        // EXIF format: "YYYY:MM:DD HH:MM:SS"
        const m = str.match(/^(\d{4}):(\d{2}):(\d{2})[ T](\d{2}):(\d{2}):(\d{2})/);
        if (!m) return null;
        const d = new Date(+m[1], +m[2] - 1, +m[3], +m[4], +m[5], +m[6]);
        return isNaN(d) ? null : d;
      }
      if (marker === 0xD8 || marker === 0x01 || (marker >= 0xD0 && marker <= 0xD7)) offset += 2;
      else if (marker === 0xDA) break;                                     // image data starts
      else offset += 2 + size;
    }
  } catch { /* fall through */ }
  return null;
}

// ── Resize ───────────────────────────────────────────────────────────
// iPhones set to "High Efficiency" hand over HEIC, which createImageBitmap
// cannot decode - but Safari renders it happily in an <img>, because the OS
// does the decoding. So fall back to that rather than losing the photo.
async function decodeImage(file) {
  try {
    // from-image applies the EXIF orientation flag, so photos aren't sideways
    return await createImageBitmap(file, { imageOrientation: 'from-image' });
  } catch { /* older Safari ignores the options object */ }
  try {
    return await createImageBitmap(file);
  } catch { /* almost certainly HEIC */ }

  return await new Promise((resolve, reject) => {
    const url = URL.createObjectURL(file);
    const img = new Image();
    img.onload  = () => { URL.revokeObjectURL(url); resolve(img); };
    img.onerror = () => { URL.revokeObjectURL(url); reject(new Error(`Could not read ${file.type || 'that file'}`)); };
    img.src = url;
  });
}

async function downscale(file) {
  const bitmap = await decodeImage(file);
  const srcW = bitmap.width || bitmap.naturalWidth;
  const srcH = bitmap.height || bitmap.naturalHeight;
  if (!srcW || !srcH) throw new Error('That image had no readable dimensions.');
  const scale = Math.min(1, MAX_EDGE / Math.max(srcW, srcH));
  const w = Math.round(srcW * scale);
  const h = Math.round(srcH * scale);

  const canvas = document.createElement('canvas');
  canvas.width = w; canvas.height = h;
  canvas.getContext('2d').drawImage(bitmap, 0, 0, w, h);
  bitmap.close?.();

  const blob = await new Promise(res => canvas.toBlob(res, 'image/jpeg', JPEG_QUALITY));
  if (!blob) throw new Error('Could not process that image.');
  return { blob, width: w, height: h };
}

// ── Adding photos ────────────────────────────────────────────────────
async function addPhotos(adventureId, files) {
  if (accountDeletionInProgress) return;
  const runOwner = userId, runGeneration = authGeneration;
  const stillCurrent = () => !accountDeletionInProgress
    && runOwner === userId && runGeneration === authGeneration;
  const list = [...files].filter(f => f.type.startsWith('image/'));
  if (!list.length) { toast('No images in that selection'); return; }

  uploading += list.length;
  renderPhotoStatus();
  await requestLocalPhotoPersistence();
  let accepted = 0;

  for (const file of list) {
    try {
      if (!stillCurrent()) continue;
      const exif = await readExifDate(file);
      if (!stillCurrent()) continue;
      const r = row(adventureId);
      let takenAt, source;
      if (exif)                       { takenAt = exif;                          source = 'exif'; }
      else if (file.lastModified)     { takenAt = new Date(file.lastModified);   source = 'file'; }
      else if (r.completed_at)        { takenAt = new Date(r.completed_at);      source = 'completed'; }
      else                            { takenAt = new Date();                    source = 'upload'; }

      const { blob, width, height } = await downscale(file);
      if (!stillCurrent()) continue;
      const item = {
        id: (crypto.randomUUID ? crypto.randomUUID()
          : `photo_${Date.now().toString(36)}_${Math.random().toString(36).slice(2)}`),
        adventure_id: adventureId,
        blob, width, height, bytes: blob.size,
        taken_at: takenAt.toISOString(),
        taken_at_source: source,
        uploaded_by: who,
        owner_id: runOwner,
      };
      if (nativePhotoFiles()) {
        const saved = await saveLocalPhoto(item);
        if (!stillCurrent()) {
          await discardSavedLocalPhoto(saved);
          continue;
        }
        if (!photos.some(photo => photo.local_key === saved.local_key)) photos.push(saved);
      } else {
        await idbPut(item);
        if (!stillCurrent()) { await idbDelete(item.id); continue; }
        pendingPhotos.push(item);
      }
      accepted++;
      renderAll();
    } catch (err) {
      if (!stillCurrent()) continue;
      console.warn('photo failed', file.name, file.type, err);
      toast(err && err.message ? err.message : 'Could not read that photo');
    } finally {
      uploading--;
      renderPhotoStatus();
    }
  }
  if (stillCurrent()) await flushPhotoQueue();
  if (stillCurrent() && accepted && !pendingPhotos.length) {
    toast(nativePhotoFiles()
      ? 'Saved inside Wayfinder on this phone. Clearing app data or uninstalling removes it.'
      : 'Saved in this browser’s site storage on this device. Browser storage is best effort; clearing site data removes it.');
  }
}

/* Keep photo objects uploaded before paths carried a scope where they are.
 *
 * Storage moves and Postgres metadata updates are separate operations. Moving
 * first can strand the row at the old path if its update fails; updating first
 * can point the row at a file that never moves. The hardened policy resolves a
 * legacy path through its photo metadata, so leaving both unchanged preserves
 * the file and applies the same owner and explicit-sharing checks.
 */
async function migrateLegacyPhotos() {
  return;
}

async function flushPhotoQueue() {
  if (accountDeletionInProgress) { renderPhotoStatus(); return; }
  if (flushPhotoQueue.busy) { flushPhotoQueue.requested = true; renderPhotoStatus(); return; }
  if (!pendingPhotos.length) { renderPhotoStatus(); return; }
  flushPhotoQueue.busy = true;
  const runOwner = userId, runGeneration = authGeneration;

  try {
    for (const item of [...pendingPhotos]) {
      if (runGeneration !== authGeneration || runOwner !== userId || item.owner_id !== runOwner) break;
      try {
      const saved = await saveLocalPhoto(item);
      if (runGeneration !== authGeneration || runOwner !== userId) break;
      if (!photos.some(photo => photo.local_key === saved.local_key)) photos.push(saved);
      pendingPhotos = pendingPhotos.filter(p => p.id !== item.id);
      await idbDelete(item.id);
      if (runGeneration !== authGeneration || runOwner !== userId) break;
      renderAll();
      } catch (err) {
        console.warn('local photo save failed, will retry', err.message || err);
        break;                                  // stop on first failure; try again later
      }
    }
  } finally {
    flushPhotoQueue.busy = false;
    renderPhotoStatus();
    if (flushPhotoQueue.requested && runGeneration === authGeneration && runOwner === userId) {
      flushPhotoQueue.requested = false;
      queueMicrotask(flushPhotoQueue);
    }
  }
}

async function pullPhotos() {
  const runOwner = userId, runGeneration = authGeneration;
  const local = await idbLocalAll(runOwner);
  if (runGeneration !== authGeneration || runOwner !== userId) return;
  if (!sb || !online) { photos = local; return; }
  const { data, error } = await sb.from('photos').select('*').order('taken_at', { ascending: false });
  if (runGeneration !== authGeneration || runOwner !== userId) return;
  if (error) { console.warn('photo pull failed', error.message); photos = local; return; }
  photos = [...local, ...(data || []).map(row => ({ ...row, local: false }))];
}

async function deletePhoto(photoId) {
  const p = photos.find(x => x.id === photoId);
  if (!p) return;
  if (!p.local) {
    toast('This existing cloud photo is read-only.');
    return;
  }
  if (!confirm('Delete this photo from Wayfinder on this phone?')) return;
  try {
    const files = nativePhotoFiles();
    if (files && p.native_path) {
      await idbLocalPut({ ...p, deleting: true });
      await files.remove(p.owner_id, p.native_path);
    }
    await idbLocalDelete(p.owner_id, p.id);
    photos = photos.filter(x => x.id !== photoId);
    const objectUrl = objectUrls.get(p.id);
    if (objectUrl) URL.revokeObjectURL(objectUrl);
    objectUrls.delete(p.id);
    closeLightbox();
    renderAll();
    toast('Photo deleted');
  } catch (err) {
    toast('Could not delete that photo');
    console.warn(err);
  }
}

// ── Signed URLs (the bucket is private, so links are minted on demand) ─
async function ensureSignedUrls(paths) {
  if (!sb || !online) return;
  const runOwner = userId, runGeneration = authGeneration;
  const now = Date.now();
  const needed = [...new Set(paths)].filter(p => {
    const hit = signedUrls.get(p);
    return !hit || hit.expires < now + 60000;
  });
  if (!needed.length) return;

  const { data, error } = await sb.storage.from(BUCKET).createSignedUrls(needed, SIGNED_TTL);
  if (runOwner !== userId || runGeneration !== authGeneration) return;
  if (error) { console.warn('signing failed', error.message); return; }
  for (const d of data || []) {
    if (d.signedUrl) signedUrls.set(d.path, { url: d.signedUrl, expires: now + SIGNED_TTL * 1000 });
  }
}

function photoSrc(p) {
  if (p.local) return p.blob ? objectUrlFor(p) : (objectUrls.get(p.id) || '');
  if (p.pending) return p.objectUrl;
  const hit = signedUrls.get(p.storage_path);
  // Expiry matters here, not just presence. Returning a stale link made
  // hydrateThumbs think the photo was fine and never re-sign it, so after two
  // hours a session that had been left open showed broken images until reload.
  if (!hit || hit.expires <= Date.now()) return '';
  return hit.url;
}

// All photos for an adventure: uploaded ones plus anything still queued.
function photosFor(adventureId) {
  const queued = pendingPhotos
    .filter(p => p.adventure_id === adventureId)
    .map(p => ({ ...p, pending: true, objectUrl: objectUrlFor(p) }));
  return [...photos.filter(p => p.adventure_id === adventureId), ...queued]
    .sort((a, b) => new Date(a.taken_at || 0) - new Date(b.taken_at || 0));
}

const objectUrls = new Map();
function objectUrlFor(item) {
  if (!item.blob) return objectUrls.get(item.id) || '';
  if (!objectUrls.has(item.id)) objectUrls.set(item.id, URL.createObjectURL(item.blob));
  return objectUrls.get(item.id);
}

async function ensureLocalPhotoUrls(items) {
  const files = nativePhotoFiles();
  if (!files) return;
  const runOwner = userId, runGeneration = authGeneration;
  for (const item of items) {
    if (item.owner_id !== runOwner || !item.native_path || objectUrls.has(item.id)) continue;
    try {
      const blob = await files.read(item.owner_id, item.native_path);
      if (runGeneration !== authGeneration || runOwner !== userId || item.owner_id !== userId) return;
      objectUrls.set(item.id, URL.createObjectURL(blob));
    } catch (error) {
      console.warn('local photo read', error.message || error);
    }
  }
}

function renderPhotoStatus() {
  const el = $('#photoStatus');
  if (!el) return;
  const queued = pendingPhotos.length;
  const s = queued === 1 ? '' : 's';
  let msg = '';
  if (uploading)              msg = `Processing ${uploading} photo${uploading === 1 ? '' : 's'}…`;
  else if (queued)            msg = `Saving ${queued} earlier photo${s} on this phone…`;
  el.textContent = msg;
  el.classList.toggle('show', !!msg);
}

// ══════════════════════════════════════════════════════════════════════
//  Device capabilities
// ══════════════════════════════════════════════════════════════════════
//  These are the things a website cannot do, and the reason this is worth
//  shipping as an app rather than a bookmark. Each one degrades quietly if
//  the permission is refused - nothing here is load-bearing.

// ── Where am I? ──────────────────────────────────────────────────────
// Per-adventure coordinates do not exist yet, so distance sorting is not
// possible. What IS possible today is working out which continent and country
// you are standing in, and jumping straight there - which is most of the value
// of "near me" for an app you open while travelling.
let lastFix = null;

function locate() {
  return new Promise((resolve, reject) => {
    if (!navigator.geolocation) return reject(new Error('This device has no location services.'));
    navigator.geolocation.getCurrentPosition(
      pos => resolve({ lat: pos.coords.latitude, lon: pos.coords.longitude, accuracy: pos.coords.accuracy }),
      err => reject(new Error(
        err.code === err.PERMISSION_DENIED
          ? 'Location is turned off for Wayfinder.'
          : 'Could not get a fix. Try again outside.')),
      { enableHighAccuracy: false, timeout: 12000, maximumAge: 300000 });
  });
}

// Reverse geocode to a real region rather than just a continent. The service
// is keyless and free; if it is unreachable we fall back to the map's own
// boxes, which can still tell you the continent from the coordinates alone.
async function whereAmI(lat, lon) {
  const fallback = { continent: continentAt(lat, lon) };
  try {
    const res = await fetch(
      `https://api.bigdatacloud.net/data/reverse-geocode-client?latitude=${lat}&longitude=${lon}&localityLanguage=en`,
      { signal: AbortSignal.timeout ? AbortSignal.timeout(8000) : undefined });
    if (!res.ok) return fallback;
    const j = await res.json();
    return {
      // The country the geocoder names decides the continent, not the map's
      // tap zones. The zones are crude rectangles tried in a fixed order, and
      // Georgia and Armenia sat inside the Europe box, which is tried before
      // Asia - so Near me opened the wrong continent even with a perfect fix
      // and a working geocoder. The zones are now only the offline fallback.
      continent: (j.countryCode && typeof COUNTRY_CONT !== 'undefined'
                  && COUNTRY_CONT[j.countryCode]) || continentAt(lat, lon),
      country: j.countryCode || null,
      region: j.principalSubdivision || null,
      locality: j.locality || j.city || null,
    };
  } catch {
    return fallback;
  }
}

// What the geocoder calls a subdivision and what the data calls admin1 are
// usually the same string. These are the ones that are not.
const REGION_ALIAS = {
  AU: {
    'South Australia': 'SA', 'Victoria': 'VIC', 'New South Wales': 'NSW',
    'Queensland': 'QLD', 'Western Australia': 'WA', 'Tasmania': 'TAS',
    'Northern Territory': 'NT', 'Australian Capital Territory': 'ACT',
  },
};

// New Zealand's admin1 values are its sixteen council regions, which is what
// the geocoder returns too - so an exact match usually lands. Where it does
// not, fall back to a country-level view rather than guessing wrongly.
function matchRegion(country, subdivision) {
  if (!country || !subdivision) return null;
  const alias = (REGION_ALIAS[country] || {})[subdivision];
  if (alias) return alias;

  const inCountry = [...new Set(ADV.filter(a => a.country === country).map(a => a.admin1))];
  const norm = x => x.toLowerCase().replace(/[^a-z]/g, '');
  const want = norm(subdivision);

  const exact = inCountry.find(c => norm(c) === want);
  if (exact) return exact;

  // Substring matching only between names long enough for it to mean
  // something. Without the length floor, "Atlantis" contains "nt" and matches
  // the Northern Territory, and someone in Kent gets sent to Australia.
  const MIN = 5;
  if (want.length < MIN) return null;
  return inCountry.find(c => {
    const n = norm(c);
    return n.length >= MIN && (n.includes(want) || want.includes(n));
  }) || null;
}

async function jumpToHere() {
  const btn = $('#hereBtn');
  btn.disabled = true;
  btn.textContent = 'Finding you…';
  try {
    lastFix = await locate();
    const here = await whereAmI(lastFix.lat, lastFix.lon);

    if (!here.continent) { toast('You appear to be at sea. Impressive.'); return; }
    if (!countOf(a => a.continent === here.continent)) {
      toast(`Nothing mapped in ${here.continent} yet`);
      return;
    }

    const country = here.country && countOf(a => a.country === here.country) ? here.country : null;
    const admin1 = country ? matchRegion(country, here.region) : null;

    if (country && admin1) {
      goTo('adventures', { continent: here.continent, country, admin1 });
      const sample = ADV.find(a => a.admin1 === admin1 && a.country === country);
      toast(`You're in ${regionName(sample)}`);
    } else if (country) {
      goTo('country', { continent: here.continent, country });
      toast(here.region ? `${here.region} isn't mapped yet — here's ${countryName(country)}`
                        : `You're in ${countryName(country)}`);
    } else {
      goTo('continent', { continent: here.continent });
      toast(here.country ? `Nothing in ${here.country} yet — here's ${here.continent}`
                         : `You're in ${here.continent}`);
    }
  } catch (err) {
    toast(err.message);
  } finally {
    btn.disabled = false;
    btn.textContent = '📍 Near me';
  }
}

// ── Sharing ──────────────────────────────────────────────────────────
// A link back into the app, so what arrives is a tappable thing rather than
// a wall of text someone has to read and then go looking for.
function linkTo(params) {
  // Falls back to wherever we are when shareBase is unset, which keeps a
  // local copy of the app producing links to itself during development.
  const base = (window.OAA_CONFIG && OAA_CONFIG.shareBase)
    || `${location.origin}${location.pathname}`;
  return `${base}${base.includes('?') ? '&' : '?'}${new URLSearchParams(params)}`;
}

/* One plugin lookup, used by everything below.
 *
 * There is no bundler here, so plugins are reached through the object the
 * native bridge hangs on window rather than through an import. Returns null
 * in a browser and null for a plugin that is not installed, so every caller
 * has to have a web path anyway - which it should, because the web build is
 * the one most people will use.
 */
function cap(name) {
  const c = window.Capacitor;
  const native = c && c.isNativePlatform && c.isNativePlatform();
  return native && c.Plugins && c.Plugins[name] ? c.Plugins[name] : null;
}

async function share(payload, fallbackText) {
  /* Three routes, in descending order of how good it feels.
   *
   * An Android WebView has no navigator.share at all - the Web Share API is a
   * browser feature, not a WebView one - so without this the packaged app
   * silently degraded to a clipboard copy, and "Send an invite link" put a URL
   * on the clipboard and said so in a toast rather than opening the share
   * sheet the person expected. The plugin was already installed; nothing was
   * calling it.
   */
  const Share = cap('Share');
  try {
    if (Share) {
      await Share.share({ title: payload.title, text: payload.text,
                          url: payload.url, dialogTitle: 'Share' });
    } else if (navigator.share) {
      // url is passed as its own field rather than pasted into the body, so
      // iOS renders a link preview instead of a bare address mid-sentence.
      await navigator.share(payload);
    } else {
      await navigator.clipboard.writeText(fallbackText);
      toast('Copied to the clipboard');
    }
  } catch (err) {
    // Backing out of a share sheet is not a failure. Android reports it as a
    // plain error rather than an AbortError, so the message has to be read.
    const name = (err && err.name) || '';
    const msg = String((err && err.message) || '');
    if (name === 'AbortError' || /cancel/i.test(msg)) return;
    toast('Could not share that');
  }
}

async function shareAdventure(id) {
  const a = ADV.find(x => x.id === id);
  if (!a) return;
  if (isUnavailable(a)) return toast('That listing is paused');
  // Sharing a gem you cannot read would put the paid description into a
  // message. The sheet for a locked one has no share button, but a deep link
  // or a stale trip can still reach here.
  if (isLocked(a)) return toast('That one is locked');
  const url = linkTo({ a: id });
  const lines = [
    a.title,
    `${a.place} · ${regionName(a)} · ${countryName(a.country)}`,
    '',
    a.description,
    '',
    `${a.category} · ${DIFF_LABEL[a.difficulty]} · ${costLabel(a.cost)} · ${seasonShareLabel(a.season)}`,
  ];
  const text = lines.join('\n');
  await share({ title: `${a.title} — Wayfinder`, text, url }, `${text}\n\n${url}`);
}

async function shareTrip(tripId) {
  const t = trips.find(x => x.id === tripId);
  if (!t) return;
  const items = tripAdventures(t);
  const when = t.starts_on
    ? fmtDate(t.starts_on) + (t.ends_on ? ' – ' + fmtDate(t.ends_on) : '')
    : null;
  const lines = [t.name];
  if (when) lines.push(when);
  lines.push('');
  items.forEach((a, i) => {
    lines.push(`${i + 1}. ${safeTitle(a)}`);
    lines.push(`   ${a.place} · ${countryName(a.country)}`);
  });
  const text = lines.join('\n');
  const url = linkTo({ trip: t.id });
  await share({ title: `${t.name} — Wayfinder`, text, url }, `${text}\n\n${url}`);
}

// ── Reminders ────────────────────────────────────────────────────────
// Deliberately modest: one opt-in, one seasonal nudge. An app that pesters
// gets its notifications switched off within a week.
/* Two ways to put a notification on a screen, because there is no one way.
 *
 * A browser has the Notification API. An Android WebView does not - the
 * object simply is not there - so the packaged app would have gone to the
 * store with a Reminders switch that turned nothing on. Inside the native
 * shell the LocalNotifications plugin does the same job, and it is reached
 * through Capacitor.Plugins rather than an import because this app has no
 * bundler; the native bridge exposes every registered plugin on that object
 * at runtime.
 */
/* The last known permission state, kept because two callers cannot await.
 *
 * renderMe() draws a button label and seasonalNudge() runs on launch; both are
 * synchronous. On the web they read Notification.permission directly, which is
 * a plain property. In an Android WebView there is no Notification object at
 * all, so that read is a ReferenceError that takes the whole Me tab down with
 * it - the reason this cache exists rather than a tidier await.
 */
let notifyPerm = typeof Notification !== 'undefined' ? Notification.permission : 'default';

function nativeNotifier() { return cap('LocalNotifications'); }

function notificationsSupported() {
  return !!nativeNotifier() || typeof Notification !== 'undefined';
}

/* 'granted' | 'denied' | 'default', matching the web API so the callers do
 * not have to know which of the two they are talking to.
 */
async function notificationPermission() {
  const n = nativeNotifier();
  if (n) {
    try {
      const { display } = await n.checkPermissions();
      notifyPerm = display === 'prompt' || display === 'prompt-with-rationale'
        ? 'default' : display;                    // 'granted' | 'denied'
    } catch { notifyPerm = 'denied'; }
  } else {
    notifyPerm = typeof Notification !== 'undefined' ? Notification.permission : 'denied';
  }
  return notifyPerm;
}

async function askNotificationPermission() {
  const n = nativeNotifier();
  if (n) {
    try { notifyPerm = (await n.requestPermissions()).display; }
    catch { notifyPerm = 'denied'; }
  } else {
    notifyPerm = await Notification.requestPermission();
  }
  return notifyPerm;
}

async function showNotification(title, body, tag) {
  const n = nativeNotifier();
  if (n) {
    try {
      // The id has to be a 32-bit int and has to differ between notifications
      // that should both be visible, so the tag is hashed rather than counted.
      let id = 0;
      for (const ch of String(tag || title)) id = (id * 31 + ch.charCodeAt(0)) | 0;
      await n.schedule({ notifications: [{ id: Math.abs(id) || 1, title, body,
                                           smallIcon: 'ic_stat_icon' }] });
      return true;
    } catch (e) { console.warn('notify', e); return false; }
  }

  const opts = { body, icon: 'icons/icon-192.png', badge: 'icons/icon-192.png', tag };
  try {
    const reg = await navigator.serviceWorker?.getRegistration();
    if (reg && reg.showNotification) { await reg.showNotification(title, opts); return true; }
  } catch { /* fall through */ }
  try { new Notification(title, opts); return true; } catch { return false; }
}

/* Automatic discovery must never suggest a destination whose saved advisory is
 * "do not travel". Those adventures stay in the catalogue for history and
 * explicit browsing, and "take care" destinations remain eligible.
 */
function automaticDiscoveryAllowed(a) {
  if (isUnavailable(a)) return false;
  const adv = a && advisoryFor(a.country);
  return !adv || adv.level !== 'avoid';
}

// The real nudge can be months away, so make it possible to see one now.
async function previewReminder() {
  if (!notificationsSupported() || await notificationPermission() !== 'granted') {
    return toast('Turn reminders on first');
  }
  // The sample used to be drawn from hidden gems, which put paid text into a
  // notification. Anything unlocked and in season makes a better example
  // anyway, because it shows what a real one will look like.
  const pool = ADV.filter(a => automaticDiscoveryAllowed(a) &&
    row(a.id).shortlisted && !isDone(a.id) && !isLocked(a));
  const sample = ADV.filter(a => automaticDiscoveryAllowed(a) &&
    !isLocked(a) && inSeason(a.season));
  const from = pool.length ? pool : sample;
  const pick = from[Math.floor(Math.random() * from.length)];
  if (!pick) return toast('Nothing to preview');
  const ok = await showNotification('In season now',
    `${safeTitle(pick)} — ${pick.place}. Best ${pick.season}.`, 'wayfinder-preview');
  toast(ok ? (pool.length ? 'Sent' : 'Sent — that was a sample, shortlist things for real ones')
           : 'This device would not show it');
}

async function toggleNotifications() {
  if (!notificationsSupported()) return toast('This device does not support reminders');
  if (await notificationPermission() === 'granted') {
    writeLS(LS.notify, !readLS(LS.notify, false));
    renderMe();
    toast(readLS(LS.notify, false) ? 'Reminders on' : 'Reminders off');
    return;
  }
  const res = await askNotificationPermission();
  if (res !== 'granted') { toast('Reminders stay off'); return; }
  writeLS(LS.notify, true);
  renderMe();
  const shortlisted = [...progress.values()].filter(r => r.shortlisted && !r.completed).length;
  const shown = await showNotification('Reminders are on',
    shortlisted
      ? `We'll nudge you when one of your ${shortlisted} shortlisted adventures comes into season.`
      : "Shortlist a few adventures and we'll nudge you when they come into season.",
    'wayfinder-hello');
  if (!shown) toast('Reminders are on, but this device would not show a test one');
}

// Runs on launch. Looks for shortlisted adventures whose season includes this
// month and tells you once a week at most.
const MONTHS = ['Jan', 'Feb', 'Mar', 'Apr', 'May', 'Jun',
                'Jul', 'Aug', 'Sep', 'Oct', 'Nov', 'Dec'];

/* Is this adventure in season in the given month?
 *
 * The old test was `a.season.includes(thisMonth)`, which reads a RANGE as a
 * list. "Apr-Oct".includes("Jun") is false, so June never matched anything
 * that ran April to October, and "Year-round" matched no month at all. In
 * January it found 20 adventures in season out of 1,367 that actually were.
 *
 * Ranges wrap: "Nov-Mar" is November, December, January, February, March.
 */
function inSeason(season, month = new Date().getMonth()) {
  if (!season) return true;
  if (String(season).trim().toLowerCase() === 'check dates') return false;
  if (/year.?round/i.test(season)) return true;
  const parts = String(season).split('-').map(x => x.trim());
  if (parts.length !== 2) return MONTHS[month] === parts[0];
  const from = MONTHS.indexOf(parts[0]);
  const to = MONTHS.indexOf(parts[1]);
  if (from < 0 || to < 0) return true;          // unrecognised, do not hide it
  return from <= to ? (month >= from && month <= to)
                    : (month >= from || month <= to);
}

async function seasonalNudge() {
  if (!readLS(LS.notify, false) || !notificationsSupported()) return;
  if (await notificationPermission() !== 'granted') return;
  const last = readLS(LS.notifyLast, 0);
  if (Date.now() - last < 7 * 24 * 3600 * 1000) return;

  // Locked gems are excluded: a notification is no place to put paid text,
  // and it would be a strange thing to be nudged about.
  const due = ADV.filter(a => automaticDiscoveryAllowed(a) &&
    row(a.id).shortlisted && !isDone(a.id) && !isLocked(a) && inSeason(a.season));
  if (!due.length) return;

  const pick = due[Math.floor(Math.random() * due.length)];
  showNotification('In season now',
    `${safeTitle(pick)} — ${pick.place}. Best ${pick.season}.`, 'wayfinder-season');
  writeLS(LS.notifyLast, Date.now());
}

// ══════════════════════════════════════════════════════════════════════
//  Identity and sharing
// ══════════════════════════════════════════════════════════════════════
//  Every row belongs to one user. It may ALSO carry a group id, which is how
//  two phones share one list without sharing an account. Row Level Security
//  does the actual enforcing; these fields are what it reads.

let userId = null;             // auth.users.id for this session
let myGroups = [];             // groups this user belongs to
let activeGroupId = null;      // the group new rows are written into
let members = new Map();       // user_id -> display name, for everyone in the group
let pushedName = null;         // the display name last written to the server
let groupSchemaReady = true;
let groupLifecycleBusy = null;
let progressView = localStorage.getItem(LS.view) === 'group' ? 'group' : 'personal';

/* Names used to be frozen into completed_by at the moment of ticking, so
 * renaming yourself never changed anything you had already done, and a new
 * phone showed whatever the old ones had typed. Names now live in
 * group_members and are resolved at render time, so a rename is immediate
 * and applies to everything that person has ever ticked.
 */
function nameOf(id, fallback) {
  if (id && members.has(id)) return members.get(id);
  if (id && id === userId) return who || 'You';
  return fallback || 'Someone';
}

/* Ask for a name, but only when it will actually be seen.
 *
 * On your own the app needs no name - your list is yours and "You" is a fine
 * label. The moment a group is involved somebody else reads it, and a group of
 * three people all showing as "Someone" is useless. So the prompt happens at
 * the point of joining or creating, not on first launch, where it would be
 * friction for a person who may never share anything.
 *
 * Returns false if they cancelled, in which case the caller stops.
 */
async function requireName(reason) {
  if (who && who.trim()) return true;
  const name = prompt(`${reason}\n\nWhat should the others see against the `
                    + 'things you tick?', '');
  if (name === null) return false;
  const clean = name.trim().slice(0, 40);
  if (!clean) {
    toast('A name is needed so the others know who ticked what');
    return false;
  }
  who = clean;
  localStorage.setItem(LS.who, who);
  renderAll();
  return true;
}

async function loadGroups() {
  if (!sb || !online || !userId) return;
  const owner = userId, generation = authGeneration;
  const { data, error } = await sb
    .from('group_members')
    .select('group_id, display_name, share_completions, groups(id, name, join_code, owner_id, invite_enabled)')
    .eq('user_id', owner);
  if (owner !== userId || generation !== authGeneration) return;
  if (error) {
    // The tables may simply not exist yet - that is a valid state, not a fault.
    if (!/does not exist|schema cache/i.test(error.message)) console.warn('groups', error.message);
    groupSchemaReady = false;
    myGroups = [];
    activeGroupId = null;
    members = new Map();
    localStorage.removeItem(LS.group);
    if (progressView === 'group') {
      progressView = 'personal';
      localStorage.setItem(LS.view, progressView);
      // Never leave a cached group aggregate mounted as personal data. The
      // next pull refreshes this from the owner rows; until then show only the
      // separate personal cache (or nothing if this older install lacks one).
      progress = personalCacheReady ? new Map(personalProgress) : new Map();
      saveLocalProgress();
    }
    return;
  }
  groupSchemaReady = true;
  myGroups = (data || []).map(r => r.groups
    ? { ...r.groups, share_completions: !!r.share_completions }
    : null).filter(Boolean);
  const saved = localStorage.getItem(LS.group);
  activeGroupId = myGroups.some(g => g.id === saved) ? saved
                : (myGroups[0] ? myGroups[0].id : null);
  if (activeGroupId) localStorage.setItem(LS.group, activeGroupId);
  else if (progressView === 'group') {
    progressView = 'personal';
    localStorage.setItem(LS.view, progressView);
  }
  await loadMembers();
}

// Everyone in the active group, so ticks can be attributed to a person
// rather than to a string that was copied at the time.
async function loadMembers() {
  members = new Map();
  if (!sb || !activeGroupId) return;
  const owner = userId, generation = authGeneration, groupId = activeGroupId;
  const { data, error } = await sb.from('group_members')
    .select('user_id, display_name').eq('group_id', groupId);
  if (owner !== userId || generation !== authGeneration || groupId !== activeGroupId) return;
  if (error) {
    // Before the cutover you can only read your own membership. Not fatal:
    // names simply fall back to whatever was stored on the row.
    if (!/does not exist|schema cache/i.test(error.message)) console.warn('members', error.message);
    return;
  }
  for (const m of data || []) members.set(m.user_id,
    m.display_name || (m.user_id === userId ? who || 'You' : 'Group member'));
  await pushMyName();
}

/* Keep this phone's name on the server so the others can see it.
 *
 * Every group, not just the active one. Somebody in two groups who renamed
 * themselves used to update one and stay stale in the other, which looks
 * exactly like the app having forgotten.
 */
async function pushMyName() {
  if (!sb || !userId || !who) return;
  /* Nothing to say if the name has not moved since we last wrote it.
   *
   * This runs from loadMembers(), which now runs from the 45-second poll. A
   * write every 45 seconds would be pointless traffic, and worse: every write
   * echoes back through the member-sync channel, which calls loadMembers,
   * which calls this. The guard is what stops that being a loop.
   *
   * Guarding on members.get(userId) instead would look right and be wrong -
   * members only ever holds the ACTIVE group, so somebody in two groups whose
   * name was current in one and stale in the other would return early here
   * and stay stale forever, which is the bug this function was fixed for.
   */
  if (pushedName === who) return;
  const owner = userId, generation = authGeneration, name = who;
  const ids = myGroups.map(g => g.id);
  if (!ids.length) return;
  const { error } = await sb.from('group_members')
    .update({ display_name: name }).in('group_id', ids).eq('user_id', owner);
  if (owner !== userId || generation !== authGeneration || name !== who) return;
  if (error) { console.warn('name', error.message); return; }
  pushedName = name;
  members.set(owner, name);
}

function rpcRow(data) { return Array.isArray(data) ? data[0] : data; }

function claimGroupLifecycle() {
  if (groupLifecycleBusy && groupLifecycleBusy.owner === userId
      && groupLifecycleBusy.generation === authGeneration) return null;
  const token = { owner: userId, generation: authGeneration };
  groupLifecycleBusy = token;
  return token;
}

function releaseGroupLifecycle(token) {
  if (groupLifecycleBusy === token) groupLifecycleBusy = null;
}

async function setCompletionSharing(groupId, enabled) {
  if (!sb || !userId || !groupId) return false;
  const owner = userId, generation = authGeneration;
  const { error } = await sb.rpc('set_group_completion_sharing', {
    p_group_id: groupId, p_enabled: !!enabled,
  });
  if (owner !== userId || generation !== authGeneration) return null;
  if (error) { console.warn('completion sharing', error.message); return false; }
  const group = myGroups.find(g => g.id === groupId);
  if (group) group.share_completions = !!enabled;
  return true;
}

async function setProgressView(view) {
  const owner = userId, generation = authGeneration, groupId = activeGroupId;
  const next = view === 'group' && activeGroupId ? 'group' : 'personal';
  if (!online && next !== progressView) {
    if (next !== 'personal' || !personalCacheReady) return toast('Reconnect to change progress view');
    progressView = 'personal';
    progress = new Map(personalProgress);
    localStorage.setItem(LS.view, progressView);
    saveLocalProgress();
    renderAll();
    return;
  }
  progressView = next;
  localStorage.setItem(LS.view, progressView);
  await pullProgress();
  if (owner !== userId || generation !== authGeneration || groupId !== activeGroupId) return;
  renderAll();
}

async function createGroup(name) {
  if (!sb || !userId) return toast('Not connected');
  const lifecycle = claimGroupLifecycle();
  if (!lifecycle) return toast('A group change is already in progress');
  try {
  const owner = userId, generation = authGeneration;
  const current = () => owner === userId && generation === authGeneration;
  if (!await requireName('You are about to share a list.')) return;
  if (!current()) return;
  const sharePast = confirm('Share your past and future completion ticks with this group?\n\nNotes, ratings and shortlist stay private. Choose Cancel to join privately and share later. Your personal list stays yours either way.');
  const result = await sb.rpc('create_group', { p_name: name, p_display_name: who });
  if (!current()) return;
  const data = rpcRow(result.data);
  if (result.error || !data) {
    toast('Groups need the current database update'); console.warn(result.error); return;
  }
  activeGroupId = data.group_id;
  localStorage.setItem(LS.group, activeGroupId);
  await loadGroups();
  if (!current()) return;
  const sharingChanged = await setCompletionSharing(data.group_id, sharePast);
  if (!current() || sharingChanged === null) return;
  if (!sharingChanged) return toast('Group created, but could not apply your sharing choice. Check sharing in Me.');
  if (activeGroupId !== data.group_id) return;
  await setProgressView('group');
  if (!current() || activeGroupId !== data.group_id) return;
  renderMe();
  toast(`Share the code ${data.join_code}`);
  } finally {
    releaseGroupLifecycle(lifecycle);
  }
}

async function joinGroup(code) {
  if (!sb || !userId) return toast('Not connected');
  const lifecycle = claimGroupLifecycle();
  if (!lifecycle) return toast('A group change is already in progress');
  try {
  const owner = userId, generation = authGeneration;
  const current = () => owner === userId && generation === authGeneration;
  if (!await requireName('You are about to join a shared list.')) return;
  if (!current()) return;
  const clean = code.trim().toUpperCase();
  if (!/^[A-Z0-9]{6,32}$/.test(clean)) return toast('That join code is not valid');
  const sharePast = confirm('Share your past and future completion ticks with this group?\n\nNotes, ratings and shortlist stay private. Choose Cancel to join privately and share later.');
  const result = await sb.rpc('join_group_by_code', {
    p_join_code: clean, p_display_name: who,
  });
  if (!current()) return;
  const data = rpcRow(result.data);
  if (result.error || !data) { toast('No group with that code'); console.warn(result.error); return; }
  activeGroupId = data.group_id;
  localStorage.setItem(LS.group, activeGroupId);
  await loadGroups();
  if (!current()) return;
  // A repeated invite must honour "join privately" even if this membership
  // previously shared completions. Target this invite, not a later selection.
  const sharingChanged = await setCompletionSharing(data.group_id, sharePast);
  if (!current() || sharingChanged === null) return;
  if (!sharingChanged) return toast('Joined, but could not apply your sharing choice. Check sharing in Me.');
  if (activeGroupId !== data.group_id) return;
  await setProgressView('group');
  if (!current() || activeGroupId !== data.group_id) return;
  await pullPhotos();
  if (!current()) return;
  await pullTrips();
  if (!current()) return;
  renderAll();
  toast(`Joined ${data.group_name}`);
  } finally {
    releaseGroupLifecycle(lifecycle);
  }
}

/* Leaving removes only the consent projections and membership. The canonical
 * rows stay owned by the person throughout, so no data has to be moved and a
 * partially failed client sequence cannot strand it behind group access.
 */
async function leaveGroup(id) {
  if (!sb || !userId) return;
  const lifecycle = claimGroupLifecycle();
  if (!lifecycle) return toast('A group change is already in progress');
  try {
  const owner = userId, generation = authGeneration;
  const current = () => owner === userId && generation === authGeneration;
  const g = myGroups.find(x => x.id === id);
  if (!confirm(`Leave ${g ? g.name : 'this group'}?\n\nEverything you ticked comes with you `
             + 'and stops showing on their list. Theirs stops showing on yours.')) return;

  toast('Leaving…');
  const { error } = await sb.rpc('leave_group', { p_group_id: id });
  if (!current()) return;
  if (error) { toast('Could not leave — try again'); console.warn(error); return; }

  if (activeGroupId === id) { activeGroupId = null; localStorage.removeItem(LS.group); }
  await loadGroups();
  if (!current()) return;
  await setProgressView('personal');
  if (!current()) return;
  await pullPhotos();
  if (!current()) return;
  await pullTrips();
  if (!current()) return;
  renderAll();
  toast('Left the group. Your personal data is still yours.');
  } finally {
    releaseGroupLifecycle(lifecycle);
  }
}

function currentGroupLifecycle(token, groupId) {
  return token === groupLifecycleBusy
    && token.owner === userId
    && token.generation === authGeneration
    && (!groupId || activeGroupId === groupId);
}

async function rotateGroupInvite(groupId) {
  if (!sb || !userId || !groupId) return;
  const lifecycle = claimGroupLifecycle();
  if (!lifecycle) return toast('A group change is already in progress');
  try {
    const result = await sb.rpc('rotate_group_invite', { p_group_id: groupId });
    if (!currentGroupLifecycle(lifecycle, groupId)) return;
    if (result.error) { toast('Could not create a new invite'); console.warn(result.error); return; }
    await loadGroups();
    if (!currentGroupLifecycle(lifecycle, groupId)) return;
    renderMe();
    toast('New invite ready. Earlier links no longer work.');
  } finally {
    releaseGroupLifecycle(lifecycle);
  }
}

async function revokeGroupInvite(groupId) {
  if (!sb || !userId || !groupId) return;
  const lifecycle = claimGroupLifecycle();
  if (!lifecycle) return toast('A group change is already in progress');
  try {
    const { error } = await sb.rpc('revoke_group_invite', { p_group_id: groupId });
    if (!currentGroupLifecycle(lifecycle, groupId)) return;
    if (error) { toast('Could not pause invitations'); console.warn(error); return; }
    await loadGroups();
    if (!currentGroupLifecycle(lifecycle, groupId)) return;
    renderMe();
    toast('Invitations paused. Existing members are unchanged.');
  } finally {
    releaseGroupLifecycle(lifecycle);
  }
}

async function removeGroupMember(groupId, memberId) {
  if (!sb || !userId || !groupId || !memberId || memberId === userId) return;
  const lifecycle = claimGroupLifecycle();
  if (!lifecycle) return toast('A group change is already in progress');
  try {
    const label = nameOf(memberId, 'this member');
    if (!confirm(`Remove ${label} from this group?\n\nTheir personal progress, trips and photos remain theirs. Their shared completion view is removed from this group.`)) return;
    const { error } = await sb.rpc('remove_group_member', {
      p_group_id: groupId, p_user_id: memberId,
    });
    if (!currentGroupLifecycle(lifecycle, groupId)) return;
    if (error) { toast('Could not remove that member'); console.warn(error); return; }
    await loadMembers();
    if (!currentGroupLifecycle(lifecycle, groupId)) return;
    await pullProgress();
    if (!currentGroupLifecycle(lifecycle, groupId)) return;
    await pullPhotos();
    if (!currentGroupLifecycle(lifecycle, groupId)) return;
    await pullTrips();
    if (!currentGroupLifecycle(lifecycle, groupId)) return;
    renderAll();
    toast(`${label} was removed. Their personal data was not deleted.`);
  } finally {
    releaseGroupLifecycle(lifecycle);
  }
}

async function transferGroupOwnership(groupId, memberId) {
  if (!sb || !userId || !groupId || !memberId || memberId === userId) return;
  const lifecycle = claimGroupLifecycle();
  if (!lifecycle) return toast('A group change is already in progress');
  try {
    const label = nameOf(memberId, 'this member');
    if (!confirm(`Make ${label} the group owner?\n\nThey will control invitations, members and group disposal.`)) return;
    const { error } = await sb.rpc('transfer_group_ownership', {
      p_group_id: groupId, p_user_id: memberId,
    });
    if (!currentGroupLifecycle(lifecycle, groupId)) return;
    if (error) { toast('Could not transfer ownership'); console.warn(error); return; }
    await loadGroups();
    if (!currentGroupLifecycle(lifecycle, groupId)) return;
    renderMe();
    toast(`${label} is now the group owner.`);
  } finally {
    releaseGroupLifecycle(lifecycle);
  }
}

async function deleteOwnedGroup(groupId) {
  if (!sb || !userId || !groupId) return;
  const lifecycle = claimGroupLifecycle();
  if (!lifecycle) return toast('A group change is already in progress');
  try {
    const group = myGroups.find(g => g.id === groupId);
    const expected = group ? group.name : 'DELETE';
    const entered = prompt(`Delete ${expected}?\n\nThis removes the shared group and memberships. Everyone keeps their personal progress, trips, photos and purchases.\n\nType the group name to confirm.`, '');
    if (entered !== expected) {
      if (entered !== null) toast('Group name did not match');
      return;
    }
    const { error } = await sb.rpc('delete_group', { p_group_id: groupId });
    if (!currentGroupLifecycle(lifecycle, groupId)) return;
    if (error) { toast('Could not delete the group'); console.warn(error); return; }
    activeGroupId = null;
    localStorage.removeItem(LS.group);
    await loadGroups();
    if (!currentGroupLifecycle(lifecycle)) return;
    await setProgressView('personal');
    if (!currentGroupLifecycle(lifecycle)) return;
    await pullPhotos();
    if (!currentGroupLifecycle(lifecycle)) return;
    await pullTrips();
    if (!currentGroupLifecycle(lifecycle)) return;
    renderAll();
    toast('Group deleted. Everyone’s personal data is unchanged.');
  } finally {
    releaseGroupLifecycle(lifecycle);
  }
}

/* The shop, such as it is. Counts come from the data, so a pack can never
 * claim more than it holds, and an owned pack stops advertising itself.
 */
function renderStore() {
  const el = $('#storePanel');
  if (!el) return;
  const row = $('#previewRow');
  if (row) {
    row.classList.toggle('hidden', !previewAvailable());
    $('#previewBtn').textContent = previewOn()
      ? 'Turn preview off' : 'Preview paid adventures';
  }
  const counts = packStats(ADV);
  const bundleOnly = bundleOnlyStats(ADV);
  const packs = sellablePacks(ADV);
  const hasAll = ownsPack('all');

  el.innerHTML = packs.map(p => {
    const n = counts[p.slug] || 0;
    const got = ownsPack(p.slug);
    const sub = p.slug === 'all'
      ? `${n} hidden gems${bundleOnly ? ` · ${bundleOnly} bundle-only Antarctica adventures included` : ''}${p.blurb ? ' · ' + p.blurb : ''}`
      : `${n} gems`;
    return `<div class="packrow${p.slug === 'all' ? ' bundle' : ''}${got ? ' owned' : ''}">
      <div>
        <b>${esc(p.name)}</b>
        <span>${esc(sub)}</span>
      </div>
      ${got ? '<span class="packowned">Unlocked</span>'
            : Billing.mode === 'unavailable'
              ? '<span class="packowned">Mobile app</span>'
              : `<button class="btn-buy" data-buy="${esc(p.slug)}">${esc(priceFor(p.slug))}</button>`}
    </div>`;
  }).join('') + (hasAll ? '' :
    '<p class="fineprint">One payment for your account, with no subscription. ' +
    'The all-continents bundle includes every hidden gem, Antarctica and future additions. ' +
    'Travel, admission and guide fees are separate.</p>');
}

// Buying, from wherever the button was pressed.
async function buyPack(slug) {
  const res = await Billing.buy(slug);
  if (!res.ok) {
    if (res.reason !== 'cancelled') toast(`Purchase failed — ${res.reason}`);
    return;
  }
  toast(res.simulated ? 'Unlocked (simulated)' : 'Unlocked. Enjoy.');
  renderAll();
  if (openId !== null) renderSheet(openId);
}

function renderMe_groups() {
  const el = $('#groupPanel');
  if (!el) return;
  if (!sb) { el.innerHTML = '<p class="muted">Not connected, so sharing is unavailable.</p>'; return; }
  if (!groupSchemaReady) {
    el.innerHTML = '<p class="muted warn">Group sharing is temporarily unavailable while the privacy update is applied. Your existing data has not been changed.</p>';
    return;
  }

  const active = myGroups.find(g => g.id === activeGroupId);
  const isOwner = !!active && active.owner_id === userId;
  const otherMembers = [...members.entries()].filter(([id]) => id !== userId);
  el.innerHTML = `
    ${active ? `
      <p>Group: <strong>${esc(active.name)}</strong>.</p>
      <div class="view-switch" role="group" aria-label="Progress view">
        <button class="btn-ghost${progressView === 'personal' ? ' on' : ''}" data-groupact="view" data-view="personal">My progress</button>
        <button class="btn-ghost${progressView === 'group' ? ' on' : ''}" data-groupact="view" data-view="group">Group progress</button>
      </div>
      <p class="fineprint">${active.share_completions
        ? 'Your existing and future completion ticks are visible to this group. Notes, ratings and shortlist stay private.'
        : 'Your personal completions are private from this group.'}</p>
      <button class="btn-ghost" data-groupact="sharing" data-enabled="${active.share_completions ? 'false' : 'true'}">
        ${active.share_completions ? 'Stop sharing my completion ticks' : 'Share my completion ticks'}
      </button>
      ${active.invite_enabled ? `
        <p class="fineprint">Join code <code class="joincode">${esc(active.join_code)}</code> — read it
           out, or send the link below and they will be asked to confirm.</p>
        <button class="btn-ghost" data-groupact="invite">↗ Send an invite link</button>
      ` : '<p class="fineprint">Invitations are paused. Existing members can still use the group.</p>'}
      ${isOwner ? `
        <p class="fineprint"><strong>You manage this group.</strong> A new invite immediately invalidates every earlier link.</p>
        <button class="btn-ghost" data-groupact="rotate-invite">${active.invite_enabled ? 'Rotate invite code' : 'Create a new invite'}</button>
        ${active.invite_enabled ? '<button class="btn-ghost" data-groupact="revoke-invite">Pause invitations</button>' : ''}
        ${otherMembers.length ? `<div class="group-list"><p class="fineprint">Members:</p>${otherMembers.map(([id, name]) => `
          <div class="group-member"><span>${esc(name)}</span>
            <button class="btn-ghost" data-groupact="transfer-owner" data-member="${esc(id)}">Make owner</button>
            <button class="btn-ghost danger" data-groupact="remove-member" data-member="${esc(id)}">Remove</button>
          </div>`).join('')}</div>` : '<p class="fineprint">You are the only member.</p>'}
        ${otherMembers.length
          ? '<p class="fineprint">Transfer ownership before leaving this group.</p>'
          : `<button class="btn-ghost danger" data-groupact="leave" data-id="${esc(active.id)}">Leave and dispose of this group</button>`}
        <button class="btn-ghost danger" data-groupact="delete-group">Delete this group</button>
      ` : `<button class="btn-ghost danger" data-groupact="leave" data-id="${esc(active.id)}">Leave this group</button>`}
    ` : `
      <p class="muted">This list is yours alone at the moment.</p>
      <button class="btn-ghost" data-groupact="create">Create a group</button>
      <button class="btn-ghost" data-groupact="join">Join with a code</button>
    `}
    ${myGroups.length > 1 ? `<div class="group-list"><p class="fineprint">Switch group:</p>${myGroups
      .map(g => `<button class="btn-ghost${g.id === activeGroupId ? ' on' : ''}" data-groupact="switch" data-id="${esc(g.id)}">${esc(g.name)}</button>`).join('')}</div>` : ''}`;
}

function renderAccountPanel() {
  const el = $('#accountPanel');
  if (!el) return;
  if (!sb) {
    el.innerHTML = '<b>Account</b><p class="muted">Offline on this phone. Sign in when a connection is available to sync and recover your data.</p>';
    return;
  }
  if (passwordRecoveryMode) {
    el.innerHTML = `
      <b>Choose a new password</b>
      <p class="muted">This recovery link has signed you in. Set the password you want to use next time.</p>
      <input id="recoveryPassword" type="password" autocomplete="new-password" minlength="6" placeholder="New password (at least 6 characters)">
      <button class="btn-primary" data-authact="new-password">Save new password</button>`;
    return;
  }
  if (accountIsAnonymous) {
    const upgrade = accountUpgradeFor(accountUser);
    el.innerHTML = `
      <b>Protect this account</b>
      <p class="muted">${upgrade
        ? 'Check your email and open the verification link. Your progress stays with this account.'
        : 'Add a verified email first, then choose a password without changing your identity or moving any data.'}</p>
      ${upgrade ? '' : `<input id="upgradeEmail" type="email" autocomplete="email" placeholder="Email">
      <button class="btn-primary" data-authact="upgrade">Send verification email</button>`}`;
    return;
  }
  const email = accountUser && accountUser.email ? accountUser.email : 'Signed-in account';
  const verified = !!(accountUser && accountUser.email_confirmed_at);
  el.innerHTML = `
    <b>Account</b>
    <p class="account-email">${esc(email)}</p>
    <p class="fineprint">${verified ? 'Email verified. Progress and purchases use this personal identity.'
      : 'Check your inbox to verify this email.'}</p>
    <button class="btn-ghost" data-authact="recovery">Send password recovery email</button>`;
}

// ── Deleting the account, which Apple requires to be possible in-app ──
async function allOwnedPhotoPaths(ownerId, pageSize = 500) {
  const paths = new Set();
  for (let from = 0; ; from += pageSize) {
    const { data, error } = await sb.from('photos').select('storage_path')
      .eq('user_id', ownerId).range(from, from + pageSize - 1);
    if (error) throw error;
    const page = data || [];
    for (const row of page) if (row.storage_path) paths.add(row.storage_path);
    if (page.length < pageSize) break;
  }

  // Include orphaned objects that have no metadata row. Supabase list() is
  // one directory at a time, so walk every folder below the account prefix.
  const folders = [ownerId];
  while (folders.length) {
    const prefix = folders.pop();
    for (let offset = 0; ; offset += 100) {
      const { data, error } = await sb.storage.from(BUCKET).list(prefix, {
        limit: 100, offset, sortBy: { column: 'name', order: 'asc' },
      });
      if (error) throw error;
      const page = data || [];
      for (const item of page) {
        const path = `${prefix}/${item.name}`;
        if (item.id == null && item.metadata == null) folders.push(path); else paths.add(path);
      }
      if (page.length < 100) break;
    }
  }
  return [...paths];
}

async function removeOwnedStorage(ownerId) {
  const paths = await allOwnedPhotoPaths(ownerId);
  for (let i = 0; i < paths.length; i += 100) {
    const { error } = await sb.storage.from(BUCKET).remove(paths.slice(i, i + 100));
    if (error) throw error;
  }
  return paths.length;
}

async function retryConfirmedLocalAccountCleanup() {
  const pending = readLS(LS.accountDeletion, null);
  if (!pending || pending.stage !== 'confirmed' || !validAccountOwner(pending.owner_id)) return true;
  try {
    await Billing.deleteLocalOwner(pending.owner_id);
    clearAccountUpgrade(pending.owner_id);
    localStorage.removeItem(`oaa.block-labels.${pending.owner_id}`);
    await idbDeleteLocalOwner(pending.owner_id);
    await idbDeleteQueueOwner(pending.owner_id);
    if (sb && sb.auth && typeof sb.auth.getSession === 'function') {
      const { data, error } = await sb.auth.getSession();
      if (error) throw error;
      const sessionOwner = data && data.session && data.session.user
        ? data.session.user.id : null;
      if (sessionOwner === pending.owner_id) {
        const result = await sb.auth.signOut({ scope: 'local' });
        if (result && result.error) throw result.error;
        await handleSignedOut('Account deleted.');
      }
    }
    localStorage.removeItem(LS.accountDeletion);
    return true;
  } catch (error) {
    console.warn('pending local account cleanup', error);
    return false;
  }
}

async function deleteAccount() {
  if (!sb || !userId || accountDeletionInProgress) return;
  if (!online) return toast('Reconnect before deleting your account');
  const typed = prompt('This deletes your account, every tick, every photo and every trip. '
                     + 'It cannot be undone.\n\nType DELETE to confirm.');
  if (typed !== 'DELETE') { toast('Cancelled'); return; }

  const deletingOwner = userId;
  let identityDeleted = false;
  accountDeletionInProgress = true;
  authGeneration++; // invalidate every read/write already in flight
  toast('Deleting…');
  try {
    writeLS(LS.accountDeletion, { owner_id: deletingOwner, stage: 'starting' });
    // Let an upload already inside the Storage request observe the generation
    // change, then enumerate. That ordering catches an object created at the
    // same moment deletion began.
    while (uploading || flushPhotoQueue.busy) await new Promise(resolve => setTimeout(resolve, 25));
    await Promise.allSettled([...communityWrites.values()]);
    if (userId !== deletingOwner) throw new Error('account changed during deletion');
    await removeOwnedStorage(deletingOwner);
    if (userId !== deletingOwner) throw new Error('account changed during deletion');

    const { error } = await sb.rpc('delete_my_account');
    if (error) throw error;
    identityDeleted = true;
    writeLS(LS.accountDeletion, { owner_id: deletingOwner, stage: 'confirmed' });
    clearAccountUpgrade(deletingOwner);
    localStorage.removeItem(`oaa.block-labels.${deletingOwner}`);
    await Billing.deleteLocalOwner(deletingOwner);

    let localCleanupComplete = false;
    try {
      await idbDeleteLocalOwner(deletingOwner);
      await idbDeleteQueueOwner(deletingOwner);
      localStorage.removeItem(LS.accountDeletion);
      localCleanupComplete = true;
    } catch (error) {
      console.warn('local account cleanup', error);
    }

    try { await sb.auth.signOut(); } catch { /* identity has already been deleted */ }
    await handleSignedOut('Account deleted.');
    if (!localCleanupComplete) {
      toast('Account deleted. Some device-only photo cleanup will retry next time Wayfinder opens.');
    }
  } catch (err) {
    accountDeletionInProgress = false;
    console.warn(err);
    if (!identityDeleted) {
      writeLS(LS.accountDeletion, { owner_id: deletingOwner, stage: 'server-failed' });
      toast('Account deletion did not complete. Device-only photos were kept. Historical cloud photos may already have been removed; retry or ask for help.');
    } else {
      toast('Account deleted. Some device-only cleanup could not finish and will retry next time Wayfinder opens.');
    }
  }
}

// ══════════════════════════════════════════════════════════════════════
//  Navigation: world -> continent -> country -> optional subdivision -> adventures
// ══════════════════════════════════════════════════════════════════════
const SUBDIVISION_NAV_MIN = 6;
const COUNTRY_WIDE_ADMIN1 = Object.freeze({ AU: Object.freeze(['AUS']) });

// Saved browser-history states and old bookmarks can outlive a reviewed
// geographic correction. These aliases are the unambiguous old->current
// subdivision pairs from geographic-correction-overlay.json. They affect only
// navigation: adventure IDs, progress and catalogue rows are never rewritten.
// Barbados|Barbados is deliberately absent because it split across six
// parishes; placeholderAdmin1() safely opens Everything in Barbados instead.
const ADMIN1_NAV_ALIASES = Object.freeze({
  'AL|Gjirokaster': ['AL', 'Gjirokastër'],
  'AL|Kukes': ['AL', 'Kukës'],
  'AL|Sarande': ['AL', 'Vlorë'],
  'AL|Shkoder': ['AL', 'Shkodër'],
  'AL|Tirane': ['AL', 'Tirana'],
  'AL|Vlore': ['AL', 'Vlorë'],
  'AR|Rio Negro': ['AR', 'Río Negro'],
  'AU|Victoria': ['AU', 'VIC'],
  'CL|Araucania': ['CL', 'Araucanía'],
  'CL|Aysen': ['CL', 'Aysén'],
  'CL|Valparaiso': ['CL', 'Valparaíso'],
  'CU|Guantanamo': ['CU', 'Guantánamo'],
  'CZ|Usti nad Labem': ['CZ', 'Ústí nad Labem'],
  'DK|Faroe Islands': ['FO', 'Vágar'],
  'ES|Castile and Leon': ['ES', 'Castile and León'],
  'GT|Peten': ['GT', 'Petén'],
  'HN|Atlantida': ['HN', 'Atlántida'],
  'HU|Veszprem': ['HU', 'Veszprém'],
  'IE|Antrim': ['GB', 'Northern Ireland'],
  'NZ|Manawatu-Whanganui': ['NZ', 'Manawatū-Whanganui'],
  'PA|Chiriqui': ['PA', 'Chiriquí'],
  'PY|Boqueron': ['PY', 'Boquerón'],
  'SK|Banska Bystrica': ['SK', 'Banská Bystrica'],
  'SK|Zilina': ['SK', 'Žilina'],
});

function countryUsesSubdivisionStep(code) {
  const counts = typeof COUNTRY_SUBDIVISION_COUNT === 'object'
    ? COUNTRY_SUBDIVISION_COUNT : {};
  return (counts[code] || 0) >= SUBDIVISION_NAV_MIN;
}

function countryDestination(continent, country) {
  return countryUsesSubdivisionStep(country)
    ? { level: 'country', continent, country, admin1: null }
    : { level: 'adventures', continent, country, admin1: null };
}

function placeholderAdmin1(country, admin1) {
  if (!countryUsesSubdivisionStep(country) || !admin1) return false;
  if ((COUNTRY_WIDE_ADMIN1[country] || []).includes(admin1)) return true;
  const normalized = value => foldSearch(value).replace(/[^a-z0-9]/g, '');
  return normalized(admin1) === normalized(countryName(country));
}

function resolveAdmin1NavigationAlias(continent, country, admin1) {
  if (!admin1) return { continent, country, admin1 };
  if (ADV.some(a => a.continent === continent && a.country === country && a.admin1 === admin1)) {
    return { continent, country, admin1 };
  }
  const target = ADMIN1_NAV_ALIASES[`${country}|${admin1}`];
  if (!target) return null;
  const [targetCountry, targetAdmin1] = target;
  const targetContinent = COUNTRY_CONT[targetCountry] || continent;
  return ADV.some(a => a.continent === targetContinent && a.country === targetCountry && a.admin1 === targetAdmin1)
    ? { continent: targetContinent, country: targetCountry, admin1: targetAdmin1 }
    : null;
}

function safeNavigationState(value) {
  if (!value || typeof value !== 'object') return null;
  const level = value.level;
  if (level === 'world') return { level, continent: null, country: null, admin1: null };
  if (!['continent', 'islands', 'country', 'adventures'].includes(level)) return null;
  let continent = typeof value.continent === 'string' ? value.continent : null;
  if (!continent || !CONTINENT_ORDER.includes(continent)) return null;
  if (level === 'continent' || level === 'islands') {
    return { level, continent, country: null, admin1: null };
  }
  let country = typeof value.country === 'string' ? value.country : null;
  if (!country || !ADV.some(a => a.continent === continent && a.country === country)) return null;
  if (level === 'country') return countryDestination(continent, country);
  let admin1 = typeof value.admin1 === 'string' && value.admin1 ? value.admin1 : null;
  if (placeholderAdmin1(country, admin1)) {
    return { level, continent, country, admin1: null };
  }
  if (admin1) {
    const resolved = resolveAdmin1NavigationAlias(continent, country, admin1);
    if (!resolved) return null;
    ({ continent, country, admin1 } = resolved);
  }
  return { level, continent, country, admin1 };
}

function browserNavigationEnabled() {
  const native = window.Capacitor && window.Capacitor.isNativePlatform
    && window.Capacitor.isNativePlatform();
  return !native && history && typeof history.pushState === 'function';
}

function goTo(level, opts = {}, historyMode = 'push') {
  const next = safeNavigationState({ level, ...opts });
  if (!next) return false;
  nav = next;
  // Region filters belong to the place you drilled into, not to the place itself.
  filters.st = 'All';
  if (browserNavigationEnabled() && historyMode !== 'none') {
    const state = { wayfinderNav: nav };
    if (historyMode === 'replace') history.replaceState(state, '');
    else history.pushState(state, '');
  }
  window.scrollTo(0, 0);
  buildFilterOptions();
  renderPlaces();
  renderList();
  return true;
}

function wireBrowserNavigation() {
  if (!browserNavigationEnabled() || browserNavigationWired) return;
  browserNavigationWired = true;
  const restored = safeNavigationState(history.state && history.state.wayfinderNav);
  if (restored) nav = restored;
  history.replaceState({ wayfinderNav: nav }, '');
  addEventListener('popstate', event => {
    const target = safeNavigationState(event.state && event.state.wayfinderNav)
      || { level: 'world', continent: null, country: null, admin1: null };
    goTo(target.level, target, 'none');
  });
}

/* The travel advisory panel shown at the top of a country.
 *
 * Deliberately not dismissible and deliberately not the last word: conditions
 * change faster than an app gets updated, so it points at the government
 * advice rather than pretending to be it.
 */
const ADVISORY_SOURCE_URL = 'https://www.smartraveller.gov.au/destinations';

function advisoryContents(code) {
  const adv = advisoryFor(code);
  if (!adv) return '';
  return `
    <div class="advisory-head">${adv.level === 'avoid' ? '⛔ Do not travel' : '⚠️ Take care'}</div>
    <p>${esc(adv.note)}</p>
    <p class="fineprint">Conditions change faster than this app does.
      <a href="${ADVISORY_SOURCE_URL}" target="_blank" rel="noopener">Check current advice on Smartraveller</a>
      before you book anything.</p>`;
}

function advisoryPanelHTML(code) {
  const adv = advisoryFor(code);
  return adv ? `<div class="advisory-box ${adv.level}">${advisoryContents(code)}</div>` : '';
}

function renderAdvisory(code) {
  const box = $('#advisory');
  const adv = advisoryFor(code);
  if (!adv) { box.className = 'advisory-box hidden'; box.innerHTML = ''; return; }
  box.className = 'advisory-box ' + adv.level;
  box.innerHTML = advisoryContents(code);
}

/* A locked gem is still listed, still counted, and still says where it is -
 * hiding it entirely would mean nobody knows what they are missing, and
 * quietly dropping it from the totals would make the numbers lie. What is
 * withheld is the specifics: which place, and why it is worth the detour.
 */
/* The title as this device is allowed to see it.
 *
 * Cards use this through lockedTitle(); everything else - trips, toasts, share
 * text, the lightbox - has to use it too. An entitlement can go away after a
 * row referring to a gem already exists, so every read is checked rather than
 * trusting whatever was true when it was written.
 */
function safeTitle(a) {
  if (!a) return '';
  // A paused operational listing is public status information, not paid teaser
  // content. Keep the real title visible in explicit history and detail views.
  if (isUnavailable(a)) return a.title;
  return isLocked(a) ? lockedTitle(a) : a.title;
}

function availabilityPanelHTML(a) {
  if (!isUnavailable(a)) return '';
  const info = a.availability;
  const source = info.source || {};
  const replacement = Number.isInteger(info.replacement_id)
    ? ADV.find(item => item.id === info.replacement_id && !isUnavailable(item)) : null;
  return `<div class="advisory-box care availability-box">
    <div class="advisory-head">Listing paused</div>
    <p>${esc(info.reason)}</p>
    <p class="fineprint">Status reviewed ${esc(fmtDate(info.reviewed_at) || info.reviewed_at)}.
      <a href="${esc(source.url)}" target="_blank" rel="noopener">Read the source from ${esc(source.publisher)}</a>
      before making plans.</p>
    ${replacement ? `<button type="button" class="btn-ghost" data-open="${replacement.id}">Open current listing</button>` : ''}
  </div>`;
}

function lockedTitle(a) {
  return a.bundle_only ? 'Antarctica adventure' : `Hidden gem in ${regionName(a)}`;
}

function lockNote(a) {
  const pack = packFor(a.continent);
  if (!pack) return 'Locked.';
  return `Locked. Part of ${pack.name} — ${pack.price}.`;
}

function placeRow({ label, sub, count, total = count, unavailable = 0, done, flag, swatch, advisory, onClick }) {
  const pct = count ? Math.round((done / count) * 100) : 0;
  const interactive = !!onClick;
  const mark = advisory === 'avoid' ? '<span class="advisory avoid">Do not travel</span>'
             : advisory === 'care' ? '<span class="advisory care">Check advice</span>'
             : '';
  return `<button class="placerow${advisory ? ' has-advisory' : ''}" type="button"${interactive
    ? ` data-go='${esc(JSON.stringify(onClick))}'`
    : ' disabled aria-disabled="true"'}>
    <div class="placerow-main">
      <div class="placerow-top">
        <span class="placerow-label">${swatch ? `<i class="swatch" style="background:${esc(swatch)}"></i>` : ''}${flag ? flag + ' ' : ''}${esc(label)}</span>
        <span class="placerow-count">${count ? `${done} / ${count}` : (total
          ? (unavailable === total ? 'Paused listings' : (unavailable ? 'Paused or locked listings' : 'Locked adventures'))
          : (advisory ? '' : 'Coming soon'))}</span>
      </div>
      ${mark}
      ${sub ? `<div class="placerow-sub">${esc(sub)}</div>` : ''}
      ${count ? `<div class="minibar"><i style="width:${pct}%"></i></div>` : ''}
    </div>
    ${interactive ? '<span class="placerow-chev">›</span>' : ''}
  </button>`;
}

function crumbHTML() {
  const parts = [{ label: '🌏 World', go: { level: 'world' } }];
  if (nav.continent) parts.push({ label: nav.continent, go: { level: 'continent', continent: nav.continent } });
  if (nav.level === 'islands' || (nav.country && ISLAND_GROUP.has(nav.country))) {
    parts.push({ label: '🏝️ Island nations', go: { level: 'islands', continent: nav.continent } });
  }
  if (nav.country) parts.push({ label: countryName(nav.country), go: { level: 'country', continent: nav.continent, country: nav.country } });
  if (nav.admin1) {
    const a = ADV.find(x => x.country === nav.country && x.admin1 === nav.admin1);
    parts.push({ label: a ? regionName(a) : nav.admin1, go: null });
  }
  return parts.map((p, i) => {
    const last = i === parts.length - 1;
    return (last
      ? `<span class="crumb-here">${esc(p.label)}</span>`
      : `<button class="crumb-link" data-go='${esc(JSON.stringify(p.go))}'>${esc(p.label)}</button>`)
      + (last ? '' : '<span class="crumb-sep">›</span>');
  }).join('');
}

function renderPlaces() {
  const world = $('#worldView'), place = $('#placeView'), list = $('#listView');
  world.classList.toggle('hidden', nav.level !== 'world');
  place.classList.toggle('hidden',
    !['continent', 'country', 'islands'].includes(nav.level));
  list.classList.toggle('hidden', nav.level !== 'adventures');

  // The map follows you down: the whole world, then the continent, then the
  // country on its own. Regions have no outline of their own in the data, so
  // the country view is as far in as the map can honestly go.
  if (!place.classList.contains('hidden')) {
    drawWorldMap($('#placeMap'), null, null,
      nav.level === 'country' ? { country: nav.country }
                              : { continent: nav.continent });
  }

  if (nav.level === 'world') {
    const counts = {}, mapPresence = {};
    for (const name of CONTINENT_ORDER) {
      counts[name] = countOf(a => a.continent === name);
      // Map colour means the catalogue contains somewhere to explore. Access
      // still controls the row count, completion target and detail paywall.
      // Otherwise bundle-only Antarctica looks like an empty continent.
      mapPresence[name] = ADV.some(a => a.continent === name) ? 1 : 0;
    }
    drawWorldMap($('#worldMap'), mapPresence, null, null);

    // Most content first, so the list reorders itself as regions fill in.
    // Empty continents fall to the bottom in their declared order.
    const ordered = [...CONTINENT_ORDER].sort((a, b) => (counts[b] || 0) - (counts[a] || 0));

    $('#continentList').innerHTML = ordered.map(name => {
      const count = counts[name];
      const entries = ADV.filter(a => a.continent === name);
      const countries = new Set(entries.map(a => a.country)).size;
      return placeRow({
        label: name,
        swatch: entries.length ? CONTINENT_COLOUR[name] : null,
        sub: entries.length ? (name === 'Antarctica' && !count ? 'Included with All Continents'
                     : `${countries} ${countries === 1 ? 'country' : 'countries'}`)
                   : `${countriesIn(name, () => 0).length} countries, none mapped yet`,
        count, total: entries.length, unavailable: entries.filter(isUnavailable).length,
        done: doneOf(a => a.continent === name),
        // Openable either way: an empty continent still lists its countries,
        // which is more use than a dead row.
        onClick: { level: 'continent', continent: name },
      });
    }).join('');
    return;
  }

  if (nav.level !== 'country') renderAdvisory(null);

  if (nav.level === 'continent' || nav.level === 'islands') {
    const islandsOnly = nav.level === 'islands';
    const inCont = a => a.continent === nav.continent;

    // Tally the whole continent in one pass. Asking countOf() per country
    // walks all 2,300 adventures each time, and this list wants three numbers
    // for each of fifty countries - which was sixty milliseconds of scanning
    // to draw one screen.
    const tally = new Map();
    for (const a of ADV) {
      if (a.continent !== nav.continent) continue;
      let t = tally.get(a.country);
      if (!t) tally.set(a.country, t = { n: 0, total: 0, unavailable: 0, done: 0, regions: new Set() });
      t.total++;
      if (countryUsesSubdivisionStep(a.country) && a.admin1 && !placeholderAdmin1(a.country, a.admin1)) {
        t.regions.add(a.admin1);
      }
      if (isUnavailable(a)) t.unavailable++;
      if (!countable(a)) continue;
      t.n++;
      if (isDone(a.id)) t.done++;
    }
    const countIn = c => (tally.get(c) || { n: 0 }).n;

    // Every country in the continent, whether or not it holds adventures yet.
    // Leaving the empty ones out made the app look like they did not exist.
    const all = countriesIn(nav.continent, countIn);
    const withContent = all.filter(c => countIn(c) > 0);
    const mainland = all.filter(c => !ISLAND_GROUP.has(c));
    const islands = all.filter(c => ISLAND_GROUP.has(c));
    const codes = islandsOnly ? islands : mainland;

    const countryRow = code => {
      const t = tally.get(code) || { n: 0, total: 0, unavailable: 0, done: 0, regions: new Set() };
      const n = t.n;
      const regions = t.regions.size;
      const adv = advisoryFor(code);
      // The advisory outranks the region count: if the honest answer is "not
      // right now", that is the first thing worth saying about the place.
      const sub = adv ? adv.note
                      : (t.total ? `${regions} ${regions === 1 ? 'region' : 'regions'}`
                           : 'Not mapped yet');
      return placeRow({
        label: countryName(code), flag: countryFlag(code),
        sub, count: n, total: t.total, unavailable: t.unavailable,
        done: t.done, advisory: adv ? adv.level : null,
        onClick: t.total ? countryDestination(nav.continent, code) : null,
      });
    };

    $('#crumb').innerHTML = crumbHTML();
    if (islandsOnly) {
      const inIslands = a => inCont(a) && ISLAND_GROUP.has(a.country);
      $('#placeTitle').textContent = '🏝️ Island nations';
      $('#placeSub').textContent =
        `${countOf(inIslands)} adventures across ${islands.filter(c => countOf(a => a.country === c)).length}` +
        ` of ${islands.length} nations and territories`;
      $('#placeList').innerHTML = codes.map(countryRow).join('');
      return;
    }

    const inIslands = a => inCont(a) && ISLAND_GROUP.has(a.country);
    const islandCount = countOf(inIslands);
    $('#placeTitle').textContent = nav.continent;
    $('#placeSub').textContent = countOf(inCont)
      ? `${countOf(inCont)} adventures across ${withContent.length} of ${all.length} countries`
      : (ADV.some(inCont) ? 'Browse locked adventures included with All Continents'
                         : `${all.length} countries, none mapped yet`);
    // Group the island nations whenever there are enough of them, not only when
    // they hold adventures - otherwise an unmapped continent silently drops
    // them and the country count stops adding up.
    $('#placeList').innerHTML = codes.map(countryRow).join('') +
      (islands.length >= ISLAND_GROUP_MIN ? placeRow({
        label: 'Island nations', flag: '🏝️',
        sub: islands.map(countryName).slice(0, 4).join(', ') +
             (islands.length > 4 ? ` and ${islands.length - 4} more` : ''),
        count: islandCount, total: ADV.filter(inIslands).length,
        unavailable: unavailableOf(inIslands), done: doneOf(inIslands),
        onClick: { level: 'islands', continent: nav.continent },
      }) : islands.map(countryRow).join(''));
    return;
  }

  if (nav.level === 'country') {
    const inC = a => a.country === nav.country;
    // A country-name placeholder means the row's first-level subdivision has
    // not been researched. It stays under Everything, but must not masquerade
    // as a state/parish tile beside real first-level areas.
    const regions = [...new Set(ADV.filter(inC)
      .map(a => a.admin1)
      .filter(admin1 => !placeholderAdmin1(nav.country, admin1)))];
    $('#crumb').innerHTML = crumbHTML();
    $('#placeTitle').textContent = countryFlag(nav.country) + ' ' + countryName(nav.country);
    const countryCount = countOf(inC);
    const countryTotal = ADV.filter(inC).length;
    const countryUnavailable = unavailableOf(inC);
    $('#placeSub').textContent = countryCount ? `${countryCount} adventures`
      : (countryUnavailable === countryTotal
        ? `${countryUnavailable} unavailable ${countryUnavailable === 1 ? 'experience' : 'experiences'}`
        : `${countryTotal} locked adventures`);
    renderAdvisory(nav.country);

    const rows = regions.map(code => {
      const inR = a => inC(a) && a.admin1 === code;
      const sample = ADV.find(inR);
      return {
        label: regionName(sample), code,
        count: countOf(inR), total: ADV.filter(inR).length,
        unavailable: unavailableOf(inR), done: doneOf(inR),
      };
    }).sort((a, b) => a.label.localeCompare(b.label));

    $('#placeList').innerHTML =
      placeRow({
        label: `Everything in ${countryName(nav.country)}`,
        sub: 'Skip the regions and see the lot',
        count: countOf(inC), total: ADV.filter(inC).length,
        unavailable: unavailableOf(inC), done: doneOf(inC),
        onClick: { level: 'adventures', continent: nav.continent, country: nav.country },
      }) +
      rows.map(r => placeRow({
        label: r.label, count: r.count, total: r.total, unavailable: r.unavailable, done: r.done,
        onClick: { level: 'adventures', continent: nav.continent, country: nav.country, admin1: r.code },
      })).join('');
    return;
  }

  $('#crumbList').innerHTML = crumbHTML();
}

// ══════════════════════════════════════════════════════════════════════
//  Filtering + rendering
// ══════════════════════════════════════════════════════════════════════
function inNavigationScope(a) {
  return (!nav.continent || a.continent === nav.continent)
    && (!nav.country || a.country === nav.country)
    && (!nav.admin1 || a.admin1 === nav.admin1);
}

function foldSearch(value) {
  return String(value || '').normalize('NFD').replace(/\p{M}/gu, '').toLowerCase();
}

function filtered() {
  const q = foldSearch(filters.q.trim());
  return ADV.filter(a => {
    const r = row(a.id);
    if (filters.quick === 'todo'  && r.completed) return false;
    if (filters.quick === 'done'  && !r.completed) return false;
    if (filters.quick === 'short' && !r.shortlisted) return false;
    if (filters.quick === 'gem'   && !a.hidden_gem) return false;
    if (!inNavigationScope(a)) return false;
    if (filters.st  !== 'All' && a.admin1 !== filters.st) return false;
    if (filters.cat !== 'All' && a.category !== filters.cat) return false;
    if (filters.dog !== 'All' && a.dog_friendly !== filters.dog) return false;
    if (a.difficulty > filters.diff) return false;
    // Unknown prices belong in the default catalogue, but cannot honestly
    // satisfy a user-selected maximum-price filter.
    if (filters.cost !== 'All' && (!Number.isInteger(a.cost) || a.cost > filters.cost)) return false;
    if (q) {
      // A locked gem is searchable only on what is actually visible on its
      // card. Matching the blurred title meant you could confirm a guess at
      // paid content, and worse, it was inconsistent: a card would appear for
      // a word the reader had no way of knowing was there.
      const hay = (isLocked(a) && !isUnavailable(a)
        ? `${a.region} ${regionName(a)} ${countryName(a.country)} ${a.category}`
        : `${a.title} ${a.place} ${a.region} ${regionName(a)} ${countryName(a.country)} ${a.category} ${a.description}`
      );
      const searchable = foldSearch(hay);
      if (!searchable.includes(q)) return false;
    }
    return true;
  });
}

function cardHTML(a) {
  const r = row(a.id);
  const personal = progressView === 'group'
    ? (personalProgress.get(a.id) || { completed: false }) : r;
  const locked = isLocked(a);
  const unavailable = isUnavailable(a);
  const canUntick = unavailable && !!personal.completed;
  const blocked = unavailable ? !canUntick : locked;
  const title = unavailable ? a.title : (locked ? lockedTitle(a) : a.title);
  const meta = unavailable ? metaLine(a) : (locked ? lockNote(a) : metaLine(a));
  return `<article class="card ${r.completed ? 'done' : ''}${locked && !unavailable ? ' locked' : ''}${unavailable ? ' unavailable' : ''}">
    <button class="tick ${r.completed ? 'on' : ''}" data-toggle="${a.id}"
            aria-label="${canUntick || (!unavailable && r.completed) ? 'Mark not done' : (unavailable ? 'Paused listing' : 'Mark done')}"${blocked ? ' disabled' : ''}>✓</button>
    <button type="button" class="card-body card-detail" data-open="${a.id}"
            aria-label="Open details for ${esc(title)}">
      <div class="card-title">${esc(title)}</div>
      <div class="card-meta">${esc(meta)}</div>
      <div class="badges">
        <span class="badge">${esc(a.category)}</span>
        <span class="badge">${'●'.repeat(a.difficulty)}${'○'.repeat(5 - a.difficulty)}</span>
        <span class="badge">${a.cost === null ? 'Check pricing' : (a.cost === 0 ? 'Free' : '$'.repeat(a.cost))}</span>
        ${a.dog_friendly === 'yes' ? '<span class="badge dog">🐾 Dogs</span>' : ''}
        ${a.hidden_gem ? `<span class="badge gem">💎 Hidden gem${locked && !unavailable ? ' · locked' : ''}</span>` : ''}
        ${a.bundle_only ? `<span class="badge">🔒 Bundle exclusive${locked && !unavailable ? ' · locked' : ''}</span>` : ''}
        ${unavailable ? '<span class="badge">Listing paused</span>' : ''}
        ${r.shortlisted ? '<span class="badge star">⭐ Shortlist</span>' : ''}
      </div>
      <span class="card-open" aria-hidden="true">›</span>
    </button>
  </article>`;
}

function renderList() {
  // The list pane is only on screen at the adventures level. Building a few
  // hundred cards of markup for a hidden element cost 400ms of every render
  // at continent level, which is most of them - a tick, a filter change, a
  // sync arriving. Nothing is lost by waiting: drilling in calls this again.
  if (nav.level !== 'adventures') return;
  const arr = filtered();
  const scopedTotal = ADV.reduce((n, a) => n + (inNavigationScope(a) ? 1 : 0), 0);
  // This line counts rows on screen, which includes locked gems - they are
  // visible, just blurred. The completion target in the header is a different
  // number on purpose, so say how many of these do not count towards it.
  const unavailable = arr.reduce((n, a) => n + (isUnavailable(a) ? 1 : 0), 0);
  const locked = arr.reduce((n, a) => n + (isLocked(a) && !isUnavailable(a) ? 1 : 0), 0);
  $('#resultCount').textContent =
    `${arr.length} adventure${arr.length === 1 ? '' : 's'}` +
    (arr.length !== scopedTotal ? ` of ${scopedTotal}` : '') +
    (locked ? ` · ${locked} locked` : '') +
    (unavailable ? ` · ${unavailable} paused` : '');
  $('#list').innerHTML = arr.length
    ? arr.map(cardHTML).join('')
    : `<div class="empty">Nothing matches that.<br>Try clearing a filter.</div>`;
}

function renderHeader() {
  const done = doneCount();
  const total = countableTotal();
  $('#progressCount').textContent = `${done} / ${total}`;
  $('#progressFill').style.width = `${(done / Math.max(total, 1)) * 100}%`;
  const view = $('#progressViewBtn');
  view.classList.toggle('hidden', !activeGroupId);
  view.textContent = progressView === 'group' ? 'Group' : 'Me';
  view.setAttribute('aria-label', progressView === 'group'
    ? 'Showing group progress. Switch to my progress'
    : 'Showing my progress. Switch to group progress');
}

// ══════════════════════════════════════════════════════════════════════
//  Passport
// ══════════════════════════════════════════════════════════════════════
function renderPassport() {
  const owned = progressView === 'group' ? personalProgress : progress;
  const personalRow = id => owned.get(id) || { completed: false };
  const personalDone = a => countable(a) && !!personalRow(a.id).completed;
  const visited = new Set();
  const continents = new Set();
  for (const a of ADV) {
    if (!personalDone(a)) continue;
    visited.add(a.country);
    continents.add(a.continent);
  }

  // The eyebrow already says ADVENTURE PASSPORT, so this line is the holder,
  // the way a real passport carries a name.
  $('#passportName').textContent = who || 'Traveller';

  $('#passportTotals').innerHTML = `
    <div class="ptotal"><b>${visited.size}</b><span>stamps</span></div>
    <div class="ptotal"><b>${continents.size}</b><span>continents</span></div>
    <div class="ptotal"><b>${ADV.filter(personalDone).length}</b><span>adventures</span></div>`;

  // A country is stamped once, on the first thing you tick there. The date is
  // derived from the earliest completion rather than stored separately, so
  // un-ticking that one simply moves the stamp to the next earliest.
  // One pass over the list rather than four per country. With 123 countries
  // the old shape was half a million comparisons to draw one screen.
  const tally = new Map();
  for (const a of ADV) {
    let t = tally.get(a.country);
    if (!t) tally.set(a.country, t = { total: 0, done: 0, first: null });
    if (isLocked(a)) continue;               // locked gems count for nothing
    t.total++;
    if (!personalDone(a)) continue;
    t.done++;
    const when = personalRow(a.id).completed_at;
    if (!when) continue;
    const d = new Date(when);
    if (!isNaN(d) && (!t.first || d < t.first)) t.first = d;
  }

  const rows = [...tally.entries()].map(([code, t]) => ({
    code,
    total: t.total,
    done: t.done,
    stampedAt: t.first,
    // Completed the country outright - a real passport would not mark this,
    // but it is the thing people actually want to see.
    complete: t.total > 0 && t.done === t.total,
  }));

  // Earned stamps first, in the order they were collected, like a real passport.
  const earned = rows.filter(r => r.stampedAt).sort((a, b) => a.stampedAt - b.stampedAt);
  const blank = rows.filter(r => !r.stampedAt)
    .sort((a, b) => countryName(a.code).localeCompare(countryName(b.code)));

  // Fixed three-letter months rather than the locale's, which gives "Sept"
  // and "July" and makes the stamps different widths.
  const MON = ['Jan','Feb','Mar','Apr','May','Jun','Jul','Aug','Sep','Oct','Nov','Dec'];
  const stampDate = d =>
    `${String(d.getDate()).padStart(2, '0')} ${MON[d.getMonth()]} ${String(d.getFullYear()).slice(-2)}`;
  const stampTime = d => d.toLocaleTimeString('en-AU',
    { hour: '2-digit', minute: '2-digit', hour12: false });

  const html = r => {
    const go = JSON.stringify({ level: 'country', continent: ADV.find(a => a.country === r.code).continent, country: r.code });
    // A fixed wobble per country, so stamps sit at slightly different angles
    // like they were banged on by hand, but never move between renders.
    const tilt = ((r.code.charCodeAt(0) * 7 + r.code.charCodeAt(1) * 13) % 9) - 4;
    return `<button class="stamp ${r.stampedAt ? 'earned' : ''} ${r.complete ? 'complete' : ''}"
              style="--tilt:${r.stampedAt ? tilt : 0}deg" data-go='${esc(go)}'>
      <span class="stamp-flag">${countryFlag(r.code)}</span>
      <span class="stamp-name">${esc(countryName(r.code))}</span>
      <span class="stamp-count">${r.done} / ${r.total}</span>
      ${r.stampedAt
        ? `<span class="stamp-date">${stampDate(r.stampedAt)}</span>
           <span class="stamp-time">${stampTime(r.stampedAt)}</span>`
        : '<span class="stamp-blank">Not stamped</span>'}
      ${r.complete ? '<span class="stamp-seal">✓</span>' : ''}
    </button>`;
  };

  $('#stampGrid').innerHTML = earned.length
    ? earned.map(html).join('') +
      `<div class="stamp-divider"><span>${blank.length} still to collect</span></div>` +
      blank.map(html).join('')
    : `<div class="empty">No stamps yet.<br>Tick anything off and the country gets its stamp.</div>` +
      blank.map(html).join('');

  const contRows = CONTINENT_ORDER.filter(c => countOf(a => a.continent === c)).map(c => {
    const inC = a => a.continent === c;
    const total = countOf(inC), done = ADV.filter(a => inC(a) && personalDone(a)).length;
    const pct = total ? Math.round((done / total) * 100) : 0;
    return `<div class="staterow">
      <div class="staterow-top"><span>${esc(c)}</span><span>${done} / ${total}</span></div>
      <div class="minibar"><i style="width:${pct}%"></i></div>
    </div>`;
  }).join('');
  $('#continentProgress').innerHTML = contRows;
}

// ══════════════════════════════════════════════════════════════════════
//  Trips
// ══════════════════════════════════════════════════════════════════════
let trips = [];
let openTripId = null;
let tripMutationRevision = 0;

function loadLocalTrips() { trips = readLS(LS.trips, []); }
function saveLocalTrips() { writeLS(LS.trips, trips); }

function newTripId() {
  return crypto.randomUUID ? crypto.randomUUID()
                           : 'local-' + Date.now() + '-' + Math.random().toString(16).slice(2);
}

function upsertTrip(trip) {
  const i = trips.findIndex(t => t.id === trip.id);
  trip.updated_at = new Date().toISOString();
  if (i >= 0) trips[i] = trip; else trips.push(trip);
  saveLocalTrips();
  queueTripSync(trip);
  renderTrips();
  if (openTripId === trip.id) renderTripSheet(trip.id);
}

function removeTrip(id) {
  if (!userId || accountDeletionInProgress) return;
  // Keep a durable deletion request before removing the visible row.
  if (!queueTripSync({ id, deleted: true })) {
    toast('Could not queue this trip deletion. Free some device storage and try again.');
    return;
  }
  trips = trips.filter(t => t.id !== id);
  saveLocalTrips();
  closeTripSheet();
  renderTrips();
}

function queueTripSync(trip) {
  if (accountDeletionInProgress) return false;
  const q = readLS(LS.tripOutbox, []).filter(t => t.id !== trip.id);
  q.push({ ...trip, owner_id: userId, queue_rev: nextQueueRevision() });
  try {
    localStorage.setItem(LS.tripOutbox, JSON.stringify(q));
  } catch (error) {
    console.warn('trip queue could not be saved', error);
    return false;
  }
  tripMutationRevision++;
  flushTrips();
  return true;
}

async function flushTrips() {
  if (!sb || !online || accountDeletionInProgress) return;
  if (flushTrips.busy) { flushTrips.requested = true; return; }
  flushTrips.busy = true;
  const runOwner = userId, runGeneration = authGeneration;
  const q = readLS(LS.tripOutbox, []);
  if (!q.length) { flushTrips.busy = false; return; }
  try {
    for (const t of q) {
      if (runGeneration !== authGeneration || runOwner !== userId || t.owner_id !== runOwner) break;
      const { error } = t.deleted
        ? await sb.from('trips').delete().eq('id', t.id).eq('user_id', runOwner)
        : await sb.from('trips').upsert({
        id: t.id, name: t.name, starts_on: t.starts_on || null, ends_on: t.ends_on || null,
        adventure_ids: t.adventure_ids || [], notes: t.notes || null,
        created_by: t.created_by || who,
        user_id: runOwner, group_id: null,
      }, { onConflict: 'id' });
      if (runGeneration !== authGeneration || runOwner !== userId) break;

      const current = readLS(LS.tripOutbox, []);
      const index = current.findIndex(x => x.id === t.id && x.owner_id === t.owner_id
        && x.queue_rev === t.queue_rev);
      if (index < 0) continue;
      if (!error) {
        current.splice(index, 1);
        tripMutationRevision++; // discard pulls begun before the server acknowledgement
      }
      else {
        current[index].tries = (current[index].tries || 0) + 1;
        console.warn('trip sync failed', error.message, `(attempt ${current[index].tries})`);
        if (t.deleted) {
          // Never discard a rejected tombstone: doing so resurrects the trip.
          if (current[index].tries === OUTBOX_MAX_TRIES) toast('A trip deletion is still waiting to sync');
        } else if (current[index].tries >= OUTBOX_MAX_TRIES) {
          console.error('giving up on trip', t.id, error.message);
          current.splice(index, 1);
          toast('A trip could not be saved to the server');
        }
      }
      writeLS(LS.tripOutbox, current);
    }
  } finally {
    flushTrips.busy = false;
    if (flushTrips.requested && runGeneration === authGeneration && runOwner === userId) {
      flushTrips.requested = false;
      queueMicrotask(flushTrips);
    }
  }
}

async function pullTrips() {
  if (!sb || !online || !userId) return;
  const runOwner = userId, runGeneration = authGeneration, revision = tripMutationRevision;
  const current = () => runGeneration === authGeneration && runOwner === userId
    && revision === tripMutationRevision;
  const data = [], pageSize = 500;
  let lastId = null;
  for (;;) {
    let query = sb.from('trips').select('*').eq('user_id', runOwner).order('id').limit(pageSize);
    if (lastId !== null) query = query.gt('id', lastId);
    const result = await query;
    if (!current()) return;
    if (result.error) { console.warn('trip pull failed', result.error.message); return; }
    const page = result.data || [];
    data.push(...page);
    if (page.length < pageSize) break;
    const nextLastId = page[page.length - 1] && page[page.length - 1].id;
    if (!nextLastId || nextLastId === lastId) {
      console.warn('trip pull stopped at an invalid page boundary');
      return;
    }
    lastId = nextLastId;
  }
  const queued = readLS(LS.tripOutbox, []).filter(t => t.owner_id === runOwner);
  const pending = new Set(queued.map(t => t.id));
  const deleted = new Set(queued.filter(t => t.deleted).map(t => t.id));
  // Replace confirmed rows, including deletions from another device, while
  // preserving this account's pending local edits and hiding pending deletes.
  const byId = new Map(trips.filter(t => pending.has(t.id) && !deleted.has(t.id)).map(t => [t.id, t]));
  for (const t of data) if (!pending.has(t.id)) byId.set(t.id, t);
  trips = [...byId.values()];
  saveLocalTrips();
  resolvePendingTripDeepLink(true);
}

function tripAdventures(trip) {
  return (trip.adventure_ids || []).map(id => ADV.find(a => a.id === id)).filter(Boolean);
}

function tripInsideAdventure(id) {
  return trips.filter(t => (t.adventure_ids || []).includes(id));
}

function toggleTripMember(tripId, adventureId) {
  const trip = trips.find(t => t.id === tripId);
  if (!trip) return;
  // Planning around something you cannot read would put a blurred line in the
  // itinerary. Removing one that is already there stays allowed.
  const already = (trip.adventure_ids || []).includes(adventureId);
  if (!already && isUnavailable(ADV.find(a => a.id === adventureId))) {
    toast('That listing is paused');
    return;
  }
  if (!already && isLocked(ADV.find(a => a.id === adventureId))) {
    toast('That one is locked');
    return;
  }
  const ids = trip.adventure_ids || [];
  trip.adventure_ids = ids.includes(adventureId)
    ? ids.filter(x => x !== adventureId)
    : [...ids, adventureId];
  upsertTrip(trip);
}

function renderTrips() {
  const el = $('#tripList');
  if (!el) return;
  if (!trips.length) {
    el.innerHTML = `<div class="empty">No trips yet.<br>Make one, then add adventures to it from their page.</div>`;
    return;
  }
  el.innerHTML = trips.map(t => {
    const items = tripAdventures(t);
    const done = items.filter(a => isDone(a.id)).length;
    const countries = [...new Set(items.map(a => a.country))];
    const when = t.starts_on
      ? fmtDate(t.starts_on) + (t.ends_on ? ' – ' + fmtDate(t.ends_on) : '')
      : 'No dates set';
    return `<button class="trip" data-trip="${esc(t.id)}">
      <div class="trip-top">
        <b>${esc(t.name)}</b>
        <span>${done} / ${items.length}</span>
      </div>
      <div class="card-meta">${esc(when)}</div>
      <div class="badges">
        ${countries.slice(0, 6).map(c => `<span class="badge">${countryFlag(c)} ${esc(countryName(c))}</span>`).join('')}
        ${countries.length > 6 ? `<span class="badge">+${countries.length - 6}</span>` : ''}
      </div>
      ${items.length ? `<div class="minibar"><i style="width:${Math.round((done / items.length) * 100)}%"></i></div>` : ''}
    </button>`;
  }).join('');
}

function openTripSheet(id) {
  openTripId = id;
  renderTripSheet(id);
  showManagedDialog('#tripSheet');
}
function closeTripSheet() {
  openTripId = null;
  hideManagedDialog('#tripSheet');
}

function renderTripSheet(id) {
  const t = trips.find(x => x.id === id);
  if (!t) return closeTripSheet();
  const items = tripAdventures(t);
  const done = items.filter(a => isDone(a.id)).length;

  // Group the itinerary by country so a multi-country trip reads sensibly.
  const groups = new Map();
  for (const a of items) {
    if (!groups.has(a.country)) groups.set(a.country, []);
    groups.get(a.country).push(a);
  }

  $('#tripBody').innerHTML = `
    <h2>${esc(t.name)}</h2>
    <p class="sheet-place">${items.length} adventure${items.length === 1 ? '' : 's'} · ${done} done</p>

    <h3>Dates</h3>
    <div class="daterow">
      <label>From<input type="date" id="tripStart" value="${esc(t.starts_on || '')}"></label>
      <label>To<input type="date" id="tripEnd" value="${esc(t.ends_on || '')}"></label>
    </div>

    <h3>Itinerary</h3>
    ${items.length ? [...groups.entries()].map(([code, list]) => `
      <div class="tripgroup">
        <div class="tripgroup-head">${countryFlag(code)} ${esc(countryName(code))}</div>
        ${list.map(a => `<div class="tripitem ${isDone(a.id) ? 'done' : ''}">
          <button class="tick ${isDone(a.id) ? 'on' : ''}" data-toggle="${a.id}" aria-label="Mark done">✓</button>
          <div class="tripitem-body" data-open="${a.id}">
            <div class="card-title">${esc(safeTitle(a))}</div>
            <div class="card-meta">${esc(a.place)} · ${esc(a.region)}</div>
          </div>
          <button class="tripitem-remove" data-tripremove="${a.id}" aria-label="Remove from trip">✕</button>
        </div>`).join('')}
      </div>`).join('')
      : `<p class="muted">Nothing added yet. Open any adventure and use <b>Add to a trip</b>.</p>`}

    <h3>Notes</h3>
    <textarea id="tripNotes" placeholder="Ferry times, who's booking what…">${esc(t.notes || '')}</textarea>

    <div class="sheet-actions">
      <button class="btn-primary" data-tripact="save">Save trip</button>
      <button class="btn-ghost" data-tripact="share">↗ Share this trip</button>
      <button class="btn-ghost danger" data-tripact="delete">Delete trip</button>
    </div>`;
}

function saveOpenTrip() {
  const t = trips.find(x => x.id === openTripId);
  if (!t) return;
  const starts = $('#tripStart').value || null;
  const ends = $('#tripEnd').value || null;
  // A trip that finishes before it starts was accepted and then displayed as
  // a nonsense range. Say so rather than storing it - the person has almost
  // certainly typed one of the two into the wrong box.
  if (starts && ends && ends < starts) {
    return toast('That trip ends before it starts');
  }
  t.starts_on = starts;
  t.ends_on = ends;
  t.notes = $('#tripNotes').value.trim() || null;
  upsertTrip(t);
  toast('Trip saved');
}

// The picker shown from an adventure's own page.
function renderTripPicker(adventureId) {
  const inTrips = new Set(tripInsideAdventure(adventureId).map(t => t.id));
  return `<div class="trippicker">
    ${trips.length ? trips.map(t => `
      <button class="trippick ${inTrips.has(t.id) ? 'on' : ''}" data-tripadd="${esc(t.id)}">
        <span>${inTrips.has(t.id) ? '✓' : '＋'}</span> ${esc(t.name)}
      </button>`).join('')
      : '<p class="muted">No trips yet.</p>'}
    <button class="trippick new" data-tripnew="${adventureId}"><span>＋</span> New trip…</button>
  </div>`;
}

let memoryGrouping = 'adventure';

function thumbHTML(p) {
  const src = photoSrc(p);
  return `<button class="thumb${p.pending ? ' pending' : ''}" data-photo="${esc(p.id)}"
            aria-label="View photo">
    ${src ? `<img src="${esc(src)}" alt="" loading="lazy">` : '<span class="thumb-wait"></span>'}
    ${p.pending ? '<span class="thumb-badge">&uarr;</span>' : ''}
  </button>`;
}

function renderMemories() {
  const el = $('#memList');

  if (memoryGrouping === 'adventure') {
    // Anything ticked off, plus anything that has photos on it.
    const withPhotos = new Set(photos.concat(pendingPhotos).map(p => p.adventure_id));
    const list = ADV
      .filter(a => isDone(a.id) || withPhotos.has(a.id))
      .sort((x, y) => new Date(row(y.id).completed_at || 0) - new Date(row(x.id).completed_at || 0));

    el.innerHTML = list.length ? list.map(a => {
      const r = row(a.id);
      const ph = photosFor(a.id);
      return `<div class="memory">
        <div data-open="${a.id}">
          <b>${esc(safeTitle(a))}</b>
          <div class="card-meta">${esc(a.place)} · ${esc(regionName(a))}</div>
          <div class="badges">
            ${r.completed_by || r.completed_by_id ? `<span class="badge">Ticked by ${esc(nameOf(r.completed_by_id, r.completed_by))}</span>` : ''}
            ${r.completed_at ? `<span class="badge">${fmtDate(r.completed_at)}</span>` : ''}
            ${r.rating ? `<span class="badge star">${'★'.repeat(r.rating)}</span>` : ''}
            ${ph.length ? `<span class="badge">📷 ${ph.length}</span>` : ''}
          </div>
          <p class="${r.memory ? '' : 'nomemory'}">${esc(r.memory || 'No memory written yet — tap to add one.')}</p>
        </div>
        ${ph.length ? `<div class="strip" data-group-key="adv-${a.id}">${ph.map(p => thumbHTML(p)).join('')}</div>` : ''}
      </div>`;
    }).join('') : `<div class="empty">No adventures ticked off yet.<br>Go and make some. ❤️</div>`;
    hydrateThumbs();
    return;
  }

  // Photo-led groupings.
  const all = [
    ...photos,
    ...pendingPhotos.map(p => ({ ...p, pending: true, objectUrl: objectUrlFor(p) })),
  ];
  if (!all.length) {
    el.innerHTML = `<div class="empty">No photos yet.<br>Open an adventure and add some under <b>Your memory</b>.</div>`;
    return;
  }

  const MONTHS = ['January', 'February', 'March', 'April', 'May', 'June',
                  'July', 'August', 'September', 'October', 'November', 'December'];
  const keyOf = p => {
    const d = p.taken_at ? new Date(p.taken_at) : null;
    const ok = d && !isNaN(d);
    if (memoryGrouping === 'year')  return ok ? String(d.getFullYear()) : 'Date unknown';
    if (memoryGrouping === 'month') return ok ? `${MONTHS[d.getMonth()]} ${d.getFullYear()}` : 'Date unknown';
    const a = ADV.find(x => x.id === p.adventure_id);
    return a ? a.category : 'Uncategorised';
  };
  const sortVal = p => {
    const d = p.taken_at ? new Date(p.taken_at) : null;
    return d && !isNaN(d) ? d.getTime() : 0;
  };

  const groups = new Map();
  for (const p of all) {
    const k = keyOf(p);
    if (!groups.has(k)) groups.set(k, []);
    groups.get(k).push(p);
  }

  const keys = [...groups.keys()];
  if (memoryGrouping === 'category') keys.sort();
  else keys.sort((a, b) => {                          // newest period first
    if (a === 'Date unknown') return 1;
    if (b === 'Date unknown') return -1;
    return Math.max(...groups.get(b).map(sortVal)) - Math.max(...groups.get(a).map(sortVal));
  });

  el.innerHTML = keys.map(k => {
    const items = groups.get(k).sort((a, b) => sortVal(b) - sortVal(a));
    return `<section class="photogroup">
      <div class="photogroup-head">
        <h3>${esc(k)}</h3>
        <span>${items.length} photo${items.length === 1 ? '' : 's'}</span>
      </div>
      <div class="grid" data-group-key="${esc(k)}">
        ${items.map(p => thumbHTML(p)).join('')}
      </div>
    </section>`;
  }).join('');
  hydrateThumbs();
}

// Thumbnails render straight away using whatever signed links we already hold,
// then we mint the missing ones and fill the gaps in place - no full re-render,
// so scroll position and any open sheet survive.
async function hydrateThumbs() {
  const missing = [];
  const localMissing = [];
  $$('.thumb').forEach(btn => {
    const p = findPhoto(btn.dataset.photo);
    if (p && p.local && !photoSrc(p)) localMissing.push(p);
    else if (p && !p.pending && !photoSrc(p)) missing.push(p.storage_path);
  });
  if (!missing.length && !localMissing.length) return;
  await ensureLocalPhotoUrls(localMissing);
  if (missing.length) await ensureSignedUrls(missing);
  $$('.thumb').forEach(btn => {
    const p = findPhoto(btn.dataset.photo);
    if (!p) return;
    const src = photoSrc(p);
    if (!src) return;
    const img = btn.querySelector('img');
    if (!img) {
      btn.innerHTML = `<img src="${esc(src)}" alt="" loading="lazy">`;
    } else if (img.getAttribute('src') !== src) {
      // A re-signed link has to replace the expired one already on the page,
      // or the freshly minted URL sits in the map behind a broken image.
      img.setAttribute('src', src);
    }
  });
}

function findPhoto(id) {
  const up = photos.find(p => p.id === id);
  if (up) return up;
  const q = pendingPhotos.find(p => p.id === id);
  return q ? { ...q, pending: true, objectUrl: objectUrlFor(q) } : null;
}

// -- Lightbox --------------------------------------------------------
const DIALOG_CONTROLS = 'button:not([disabled]), a[href], input:not([disabled]), select:not([disabled]), textarea:not([disabled]), [tabindex]:not([tabindex="-1"])';
let dialogFocusStack = [];

function dialogReturnKey(element) {
  if (!element) return null;
  if (element.id) return { attribute: 'id', value: element.id };
  for (const attribute of ['data-open', 'data-trip', 'data-recedit', 'data-photo']) {
    if (element.hasAttribute && element.hasAttribute(attribute)) {
      return { attribute, value: element.getAttribute(attribute) };
    }
  }
  return null;
}

function returnFocusTarget(entry) {
  if (entry.opener && (!document.contains || document.contains(entry.opener))) return entry.opener;
  if (!entry.key) return null;
  if (entry.key.attribute === 'id') return document.getElementById(entry.key.value);
  return document.querySelector(`[${entry.key.attribute}="${CSS.escape(entry.key.value)}"]`);
}

function dialogControls(dialog) {
  if (!dialog || !dialog.querySelectorAll) return [];
  return [...dialog.querySelectorAll(DIALOG_CONTROLS)]
    .filter(control => !control.disabled && control.getAttribute('aria-hidden') !== 'true'
      && !control.classList.contains('hidden'));
}

function showManagedDialog(selector) {
  const dialog = $(selector);
  if (!dialog) return;
  const opener = document.activeElement;
  dialog.classList.remove('hidden');
  dialogFocusStack = dialogFocusStack.filter(entry => entry.dialog !== dialog);
  dialogFocusStack.push({ dialog, opener, key: dialogReturnKey(opener) });
  queueMicrotask(() => {
    if (dialog.classList.contains('hidden')) return;
    const target = dialogControls(dialog)[0] || dialog;
    if (target && typeof target.focus === 'function') target.focus();
  });
}

function hideManagedDialog(selector, restore = true) {
  const dialog = $(selector);
  if (!dialog) return;
  dialog.classList.add('hidden');
  const index = dialogFocusStack.findIndex(entry => entry.dialog === dialog);
  const entry = index >= 0 ? dialogFocusStack.splice(index, 1)[0] : null;
  if (!restore || !entry) return;
  queueMicrotask(() => {
    const target = returnFocusTarget(entry);
    if (target && typeof target.focus === 'function') target.focus();
  });
}

function discardManagedDialogFocus() {
  dialogFocusStack = [];
  const active = document.activeElement;
  if (active && active.closest && active.closest('.sheet, .lightbox') && typeof active.blur === 'function') {
    active.blur();
  }
}

function activeManagedDialog() {
  for (let i = dialogFocusStack.length - 1; i >= 0; i--) {
    if (!dialogFocusStack[i].dialog.classList.contains('hidden')) return dialogFocusStack[i].dialog;
  }
  return null;
}

function handleDialogKeydown(event) {
  const dialog = activeManagedDialog();
  if (!dialog) return false;
  if (event.key === 'Escape') {
    event.preventDefault();
    if (dialog.id === 'lightbox') closeLightbox();
    else if (dialog.id === 'recSheet') closeRecSheet();
    else if (dialog.id === 'tripSheet') closeTripSheet();
    else closeSheet();
    return true;
  }
  if (dialog.id === 'lightbox' && (event.key === 'ArrowRight' || event.key === 'ArrowLeft')) {
    const n = lightbox.list.length;
    if (n) {
      event.preventDefault();
      lightbox.index = event.key === 'ArrowRight'
        ? (lightbox.index + 1) % n : (lightbox.index - 1 + n) % n;
      showLightbox();
    }
    return true;
  }
  if (event.key !== 'Tab') return false;
  const controls = dialogControls(dialog);
  event.preventDefault();
  if (!controls.length) {
    if (typeof dialog.focus === 'function') dialog.focus();
    return true;
  }
  const current = document.activeElement;
  const index = controls.indexOf(current);
  const next = event.shiftKey
    ? (index <= 0 ? controls.length - 1 : index - 1)
    : (index < 0 || index === controls.length - 1 ? 0 : index + 1);
  controls[next].focus();
  return true;
}

async function openLightbox(photoId, groupKey) {
  const container = groupKey
    ? document.querySelector(`[data-group-key="${CSS.escape(groupKey)}"]`)
    : null;
  const ids = container ? $$('.thumb', container).map(b => b.dataset.photo) : [photoId];
  lightbox.list = ids.map(findPhoto).filter(Boolean);
  lightbox.index = Math.max(0, lightbox.list.findIndex(p => p.id === photoId));
  showManagedDialog('#lightbox');
  await showLightbox();
}

async function showLightbox() {
  const p = lightbox.list[lightbox.index];
  if (!p) return closeLightbox();
  const lightboxOwner = userId, lightboxGeneration = authGeneration;
  if (!p.pending && !photoSrc(p)) {
    if (p.local) await ensureLocalPhotoUrls([p]);
    else if (p.storage_path) await ensureSignedUrls([p.storage_path]);
  }
  // A native file read or cloud signing request can finish after the lightbox
  // was closed or the account changed. Never remount that stale photo.
  if (lightboxOwner !== userId || lightboxGeneration !== authGeneration
      || lightbox.list[lightbox.index] !== p) return;

  const a = ADV.find(x => x.id === p.adventure_id);
  const d = p.taken_at ? new Date(p.taken_at) : null;
  const when = d && !isNaN(d)
    ? d.toLocaleDateString('en-AU', { day: 'numeric', month: 'long', year: 'numeric' })
    : 'Date unknown';
  const SOURCE_NOTE = {
    exif: '',
    file: ' (from the file date)',
    completed: ' (the date you ticked it off)',
    upload: ' (date added)',
  };

  $('#lbImg').src = photoSrc(p) || '';
  $('#lbTitle').textContent = a ? safeTitle(a) : 'Photo';
  $('#lbSub').textContent =
    `${when}${SOURCE_NOTE[p.taken_at_source] || ''}` +
    (a ? ` · ${a.place}` : '') +
    (p.uploaded_by ? ` · added by ${p.uploaded_by}` : '') +
    (p.pending ? ' · waiting to save on this device' : '');
  // New local photos can be removed here. Historical cloud originals are
  // preserved read-only and should not advertise an unavailable action.
  const canDelete = !!p.local && !p.pending;
  $('#lbDelete').classList.toggle('hidden', !canDelete);
  $('#lbDelete').dataset.photo = canDelete ? p.id : '';
  const many = lightbox.list.length > 1;
  $$('.lb-nav').forEach(b => b.classList.toggle('hidden', !many));
}

function closeLightbox() {
  hideManagedDialog('#lightbox');
  $('#lbImg').src = '';
  lightbox = { list: [], index: 0 };
}

// How many gems this person could find at all. Twenty-five is the intent,
// but there is no point asking for more than they own.
function gemTarget() {
  const reachable = ADV.reduce((n, a) => n + (a.hidden_gem && countable(a) ? 1 : 0), 0);
  return Math.min(25, reachable);
}

const ACHIEVEMENTS = [
  ['🌱', 'First Steps',      'Complete your first adventure',                  d => d.done >= 1],
  ['🔟', 'Getting Going',    'Complete 10 adventures',                         d => d.done >= 10],
  ['🎒', 'Proper Travellers','Complete 50 adventures',                         d => d.done >= 50],
  ['💯', 'Century',          'Complete 100 adventures',                        d => d.done >= 100],
  ['🏅', 'Serious About It', 'Complete 250 adventures',                        d => d.done >= 250],
  ['🌐', 'Half the World',   () => `Complete half of all ${countableTotal()}`,  d => d.done >= countableTotal() / 2],
  ['👑', 'The Lot',          () => `Complete all ${countableTotal()} adventures`, d => d.done >= countableTotal()],
  // Scaled to what you can actually reach. d.gems only counts unlocked gems,
  // so a fixed target of 25 was impossible for anybody who had bought nothing -
  // an achievement behind a paywall, which is exactly what was ruled out.
  // With no pack owned it is not offered at all rather than sitting there
  // permanently locked.
  ['💎', 'Gem Hunters', () => `Find ${gemTarget()} hidden gems`,
   d => gemTarget() > 0 && d.gems >= gemTarget(), () => gemTarget() > 0],
  ['🗺️', 'State Hopper',     'An adventure in all 8 Australian states and territories', d => d.states >= 8],
  ['🌏', 'Continent Hopper','An adventure on three different continents',     d => d.continents >= 3],
  ['🐾', 'Good Dog',        'Complete 15 dog-friendly adventures',            d => d.dogs >= 15],
  ['🎢', 'Coaster Credit',  'Visit 5 theme parks',                            d => d.parks >= 5],
  ['🎡', 'Season Pass',     'Visit 15 theme parks',                           d => d.parks >= 15],
  ['🏰', 'The Mouse Tour',  'Every Disney resort on earth - three continents',  d => d.disneyTotal > 0 && d.disney >= d.disneyTotal],
  ['⛰️', 'Hard Yards',       'Complete 5 adventures rated 5 for effort',       d => d.hard >= 5],
  ['💸', 'Cheap Dates',      'Complete 25 free adventures',                    d => d.free >= 25],
  ['📸', 'Storytellers',     'Write 20 memories',                              d => d.memories >= 20],
  ['⭐', 'Critics',          'Rate 20 adventures',                             d => d.ratings >= 20],
];

function achievementData() {
  const d = { done: 0, gems: 0, states: 0, countries: 0, hard: 0, free: 0, memories: 0, ratings: 0, dogs: 0, tags: new Map() };
  const states = new Set();
  const countries = new Set();
  const continents = new Set();
  for (const a of ADV) {
    if (!countable(a)) continue;
    const r = row(a.id);
    if (r.memory) d.memories++;
    if (r.rating) d.ratings++;
    if (!r.completed) continue;
    d.done++;
    if (a.hidden_gem) d.gems++;
    if (a.difficulty === 5) d.hard++;
    if (a.cost === 0) d.free++;
    if (a.dog_friendly === 'yes') d.dogs++;
    for (const t of (a.tags || [])) d.tags.set(t, (d.tags.get(t) || 0) + 1);
    if (a.admin1 !== 'AUS') states.add(a.admin1);
    countries.add(a.country);
    continents.add(a.continent);
  }
  d.states = states.size;
  d.countries = countries.size;
  d.continents = continents.size;
  d.disney = d.tags.get('disney') || 0;
  d.parks = d.tags.get('theme-park') || 0;
  // How many Disney resorts exist at all, so the achievement text stays right
  // if a seventh ever opens.
  d.disneyTotal = ADV.filter(a => countable(a) && (a.tags || []).includes('disney')).length;
  return d;
}

function renderMe() {
  const d = achievementData();
  const rated = ADV.map(a => row(a.id).rating).filter(Boolean);
  const avg = rated.length ? (rated.reduce((s, n) => s + n, 0) / rated.length).toFixed(1) : '—';
  const shortlisted = [...progress.values()].filter(r => r.shortlisted && !r.completed).length;
  // Whoever has actually ticked things, rather than two hardcoded names.
  /* Counted by account id, never by name.
   *
   * This used to key on the display name, so renaming yourself produced two
   * people: you, and a ghost holding everything you had ticked under the old
   * name. Rows from before completed_by_id existed have no id at all - those
   * are grouped under whatever name was frozen onto them, which is the only
   * honest thing left to do with them, but they can no longer split a person
   * who does have an id in two.
   */
  const byPerson = new Map();
  for (const r of progress.values()) {
    if (!r.completed) continue;
    const key = r.completed_by_id || ('name:' + (r.completed_by || who || 'You'));
    byPerson.set(key, (byPerson.get(key) || 0) + 1);
  }
  const people = [...byPerson.entries()]
    .map(([key, n]) => [key.startsWith('name:') ? key.slice(5) : nameOf(key), n])
    .sort((a, b) => b[1] - a[1]).slice(0, 4);

  $('#usStats').innerHTML = `
    <div class="stat"><b>${d.done}</b><span>adventures done</span></div>
    <div class="stat"><b>${countableTotal() - d.done}</b><span>still to go</span></div>
    <div class="stat"><b>${d.countries}</b><span>countries visited</span></div>
    <div class="stat"><b>${d.gems}</b><span>hidden gems found</span></div>
    <div class="stat"><b>${avg}</b><span>average rating</span></div>
    <div class="stat"><b>${shortlisted}</b><span>on the shortlist</span></div>
    ${activeGroupId && people.length > 1
      ? people.map(([name, n]) =>
          `<div class="stat"><b>${n}</b><span>ticked by ${esc(name)}</span></div>`).join('')
      : ''}`;

  // An achievement nobody can reach is not an achievement, it is a nag. The
  // optional fifth element says whether it applies at all right now.
  $('#achList').innerHTML = ACHIEVEMENTS
    .filter(([, , , , available]) => !available || available(d))
    .map(([icon, name, desc, test]) =>
      `<div class="ach ${test(d) ? '' : 'locked'}">
         <span class="ach-icon">${icon}</span>
         <div><b>${esc(name)}</b><span>${esc(typeof desc === 'function' ? desc() : desc)}</span></div>
       </div>`).join('');

  renderStore();
  renderAccountPanel();
  $('#whoLabel').textContent = who || 'You';
  const nb = $('#notifyBtn');
  if (nb) {
    nb.textContent = readLS(LS.notify, false) && notificationsSupported()
      && notifyPerm === 'granted'
      ? 'Reminders are on — turn off' : 'Turn on seasonal reminders';
  }
  renderMe_groups();
  const rt = $('#realtimeState');
  if (rt) {
    rt.textContent = !sb ? 'Live updates: off (no connection)'
      : realtimeOk ? 'Live updates: connected'
      : `Live updates: ${realtimeStatus}`;
    rt.className = 'muted' + (sb && !realtimeOk ? ' warn' : '');
  }
  $('#connState').textContent = sb
    ? (online ? (realtimeOk ? 'Connected and syncing live.' : 'Connected. Live updates reconnecting.')
              : 'Offline. Changes will sync when you get signal.')
    : 'Running offline — this phone only.';
}

function renderAll() {
  renderHeader();
  renderPlaces();
  renderList();
  renderPassport();
  renderTrips();
  renderMemories();
  renderMe();
  if (openId !== null) renderSheet(openId);
  renderPhotoStatus();
  refreshSyncBar();
}

// ══════════════════════════════════════════════════════════════════════
//  Detail sheet
// ══════════════════════════════════════════════════════════════════════
function renderSheet(id) {
  const a = ADV.find(x => x.id === id);
  if (!a) return;
  const r = row(id);
  const ph = photosFor(id);
  const maps = mapsUrl(a);
  const photoHint = nativePhotoFiles()
    ? (ph.length
      ? 'Tap a photo to see it full size. New photos stay inside Wayfinder on this phone.'
      : 'Photos are resized and saved inside Wayfinder on this phone. They are not copied to your Photos gallery or synced to other devices.')
    : (ph.length
      ? 'Tap a photo to see it full size. New photos use this browser’s site storage on this device; browser retention is best effort.'
      : 'Photos are resized and saved in this browser’s site storage on this device. Browser retention is best effort, and clearing site data removes them. They are not synced to other devices.');
  // null unless an affiliate id is configured and this is the kind of thing
  // anybody books. See partners.js.
  const book = bookingLink(a);

  // Site-specific operational holds remain explicitly browseable so an old tick,
  // memory or photo never disappears. The current status appears before any
  // purchase gate, and stale operational/booking actions are not offered.
  if (isUnavailable(a)) {
    const personal = progressView === 'group'
      ? (personalProgress.get(id) || { completed: false }) : r;
    const hasHistory = !!(personal.completed || personal.rating || personal.memory || ph.length);
    $('#sheetBody').innerHTML = `
      <h2>${esc(a.title)}</h2>
      <div class="sheet-place">${esc([a.place, a.region, regionName(a)].filter((v, i, arr) => v && arr.indexOf(v) === i).join(' · '))} · ${countryFlag(a.country)} ${esc(countryName(a.country))}</div>
      <span class="badge">Listing paused</span>
      ${availabilityPanelHTML(a)}
      ${advisoryPanelHTML(a.country)}
      ${hasHistory ? `
        ${personal.completed ? `<div class="donenote">Your past completion is preserved${personal.completed_at ? ' from ' + fmtDate(personal.completed_at) : ''}.</div>
        <div class="sheet-actions"><button class="btn-ghost" data-act="toggle">Remove mistaken completion tick</button></div>` : ''}
        <h3>Your rating</h3>
        <div class="stars">
          ${[1, 2, 3, 4, 5].map(n => `<button data-rate="${n}" aria-label="${n} star${n > 1 ? 's' : ''}">${n <= (personal.rating || 0) ? '★' : '☆'}</button>`).join('')}
        </div>
        <h3>Your memory</h3>
        <textarea id="memoryBox" placeholder="What actually happened…">${esc(personal.memory || '')}</textarea>
        <div class="sheet-actions"><button class="btn-primary" data-act="saveMemory">Save memory</button></div>
        <h3>Photos${ph.length ? ` <span class="count">${ph.length}</span>` : ''}</h3>
        <div class="strip sheet-strip" data-group-key="adv-${a.id}">
          ${ph.map(p => thumbHTML(p)).join('')}
          <button class="thumb add" data-act="takePhoto" aria-label="Take a photo">
            <span>📷</span><small>Camera</small>
          </button>
          <button class="thumb add" data-act="addPhoto" aria-label="Add from library">
            <span>+</span><small>Library</small>
          </button>
        </div>
        <p class="photohint">${photoHint}</p>`
        : '<p>This listing is paused and cannot be marked complete or added to a trip.</p>'}`;
    hydrateThumbs();
    return;
  }

  // A locked gem gets its own sheet: what it is, roughly where, and the one
  // button that changes that. No teaser copy pretending to be a description.
  if (isLocked(a)) {
    const pack = packFor(a.continent);
    const bundleOnly = !!a.bundle_only;
    const n = bundleOnly ? bundleOnlyStats(ADV) : (packStats(ADV)[a.pack] || 0);
    $('#sheetBody').innerHTML = `
      <h2>${bundleOnly ? '🔒' : '💎'} ${esc(lockedTitle(a))}</h2>
      <div class="sheet-place">${esc(a.category)} · ${esc(a.continent)}</div>
      ${advisoryPanelHTML(a.country)}
      <p>${bundleOnly
        ? `Bundle exclusive. Explore the complete Antarctica collection. This is one of ${n} adventures available with All continents.`
        : `Discover quieter places, small local experiences and unusual adventures. This is one of ${n} hidden gems in ${esc(a.continent)}.`}</p>
      ${pack ? (Billing.mode === 'unavailable'
        ? `<p class="fineprint">${bundleOnly ? 'All continents' : 'Hidden-gem packs'} are available in the mobile app.</p>`
        : `<button class="btn-primary" data-buy="all">Unlock every continent · ${esc(priceFor('all'))}</button>
      ${bundleOnly ? '' : `<button class="btn-ghost" data-buy="${esc(pack.slug)}">Only ${esc(pack.name)} · ${esc(priceFor(pack.slug))}</button>`}
      <p class="fineprint">One payment for your account. No subscription. ${bundleOnly
        ? 'Includes the Antarctica collection and future bundle additions.'
        : 'Includes future gems in your chosen packs.'} Travel, admission and guide fees are separate.</p>`) : ''}`;
    return;
  }

  $('#sheetBody').innerHTML = `
    <h2>${esc(a.title)}</h2>
    <div class="sheet-place">${esc([a.place, a.region, regionName(a)].filter((v, i, arr) => v && arr.indexOf(v) === i).join(' · '))} · ${countryFlag(a.country)} ${esc(countryName(a.country))}</div>
    ${a.hidden_gem ? '<span class="badge gem">💎 Hidden gem</span>' : ''}
    ${advisoryPanelHTML(a.country)}
    <p class="sheet-desc">${esc(a.description)}</p>

    <div class="factgrid">
      <div class="fact"><b>Category</b><span>${esc(a.category)}</span></div>
      <div class="fact"><b>Effort</b><span>${esc(DIFF_LABEL[a.difficulty])}</span></div>
      <div class="fact"><b>Rough cost</b><span>${esc(costLabel(a.cost))}</span></div>
      <div class="fact"><b>Time needed</b><span>${esc(a.duration)}</span></div>
      <div class="fact"><b>Best time</b><span>${esc(a.season)}</span></div>
      <div class="fact"><b>Dogs</b><span>${esc(DOG_LABEL[a.dog_friendly])}</span></div>
    </div>

    ${r.completed && (r.completed_by || r.completed_by_id) ? `<div class="donenote">Ticked off by ${esc(nameOf(r.completed_by_id, r.completed_by))}${r.completed_at ? ' on ' + fmtDate(r.completed_at) : ''}.</div>` : ''}

    <div class="sheet-actions">
      <button class="btn-primary ${r.completed ? 'doneState' : ''}" data-act="toggle">
        ${r.completed ? '✓ Completed — tap to undo' : 'Mark as completed'}
      </button>
      <div class="rowbtns">
        <button class="btn-ghost" data-act="short">${r.shortlisted ? '⭐ On shortlist' : '☆ Add to shortlist'}</button>
        <a class="btn-ghost" href="${maps}" target="_blank" rel="noopener">📍 ${IS_IOS ? 'Apple Maps' : 'Open in Maps'}</a>
      </div>
      <button class="btn-ghost" data-act="share">↗ Share this adventure</button>
      ${TOURISM[a.admin1] ? `<a class="btn-ghost" href="${TOURISM[a.admin1]}" target="_blank" rel="noopener">
        Check current access on ${esc(a.admin1 === 'AUS' ? 'australia.com' : regionName(a) + ' tourism')}
      </a>` : ''}
      ${book ? `<a class="btn-ghost booking" href="${esc(book.url)}" target="_blank" rel="noopener nofollow sponsored">
        ↗ Find a tour or ticket on ${esc(book.site)}
      </a>
      <p class="fineprint disclosure">${esc(BOOKING_DISCLOSURE)}</p>` : ''}
    </div>

    <h3>Add to a trip</h3>
    ${renderTripPicker(a.id)}

    <h3>Your rating</h3>
    <div class="stars">
      ${[1, 2, 3, 4, 5].map(n => `<button data-rate="${n}" aria-label="${n} star${n > 1 ? 's' : ''}">${n <= (r.rating || 0) ? '★' : '☆'}</button>`).join('')}
    </div>

    <h3>Your memory</h3>
    <textarea id="memoryBox" placeholder="What actually happened…">${esc(r.memory || '')}</textarea>
    <div class="sheet-actions"><button class="btn-primary" data-act="saveMemory">Save memory</button></div>

    <h3>Photos${ph.length ? ` <span class="count">${ph.length}</span>` : ''}</h3>
    <div class="strip sheet-strip" data-group-key="adv-${a.id}">
      ${ph.map(p => thumbHTML(p)).join('')}
      <button class="thumb add" data-act="takePhoto" aria-label="Take a photo">
        <span>📷</span><small>Camera</small>
      </button>
      <button class="thumb add" data-act="addPhoto" aria-label="Add from library">
        <span>+</span><small>Library</small>
      </button>
    </div>
    <p class="photohint">${photoHint}</p>`;

  hydrateThumbs();
}

function openSheet(id) {
  openId = id;
  renderSheet(id);
  showManagedDialog('#sheet');
}
function closeSheet() {
  const box = $('#memoryBox');                 // don't lose an unsaved memory
  const editable = progressView === 'group'
    ? (personalProgress.get(openId) || { memory: null }) : row(openId);
  if (box && openId !== null && box.value !== (editable.memory || '')) {
    applyPatch(openId, { memory: box.value.trim() || null });
  }
  openId = null;
  hideManagedDialog('#sheet');
}

function toggleDone(id) {
  const adventure = ADV.find(a => a.id === id);
  const r = progressView === 'group'
    ? (personalProgress.get(id) || { completed: false })
    : row(id);
  if (isUnavailable(adventure) && !r.completed) return toast('That listing is paused');
  const nowDone = !r.completed;
  applyPatch(id, {
    completed: nowDone,
    completed_at: nowDone ? new Date().toISOString() : null,
    completed_by: nowDone ? who : null,
    completed_by_id: nowDone ? userId : null,
  });
  if (nowDone) {
    toast(`✓ ${adventure ? safeTitle(adventure) : 'Done'}`);
  }
}

// ══════════════════════════════════════════════════════════════════════
//  Wiring
// ══════════════════════════════════════════════════════════════════════
function buildFilterOptions() {
  const opt = (v, label, sel) => `<option value="${esc(v)}"${sel ? ' selected' : ''}>${esc(label)}</option>`;
  // One pass. The old shape scanned the whole list again for every region to
  // find a sample to name it by, which at world level is 583 scans of 2,300
  // entries - and it could pick a sample from a different country, since two
  // countries can share a region name.
  const seen = new Map();
  for (const a of ADV) {
    if (nav.continent && a.continent !== nav.continent) continue;
    if (nav.country && a.country !== nav.country) continue;
    if (!seen.has(a.admin1)) seen.set(a.admin1, regionName(a));
  }
  $('#fState').innerHTML = opt('All', 'All regions') +
    [...seen.entries()].sort((a, b) => a[1].localeCompare(b[1]))
                       .map(([k, v]) => opt(k, v)).join('');
  $('#fDog').innerHTML = opt('All', 'Any') +
    ['yes', 'check', 'no'].map(k => opt(k, DOG_LABEL[k])).join('');
  $('#fCat').innerHTML = opt('All', 'All categories') +
    [...new Set(ADV.map(a => a.category))].sort().map(c => opt(c, c)).join('');
  $('#fDiff').innerHTML = [5, 4, 3, 2, 1].map(n => opt(n, DIFF_LABEL[n] + ' or less', n === 5)).join('');
  $('#fCost').innerHTML = opt('All', 'Any price', true) +
    [4, 3, 2, 1, 0].map(n => opt(n, COST_LABEL[n] + (n ? ' or less' : ' only'))).join('');
}

/* Android's back button and its incoming links.
 *
 * WHY THIS IS NOT OPTIONAL
 *
 * Capacitor's App plugin registers an OnBackPressedCallback that is enabled
 * whether or not anything is listening. With no listener it tries the WebView
 * history, and this app has none - it never pushes a history entry, tabs just
 * toggle visibility. So the callback consumed every back press and did
 * nothing at all: a sheet could not be dismissed with Back, and the app could
 * not be left with Back. On Android that reads as a frozen app, and it is the
 * kind of thing Play reviewers check.
 *
 * The order below is the order things are stacked on screen, so Back always
 * undoes the most recent thing.
 */
function wireNative() {
  const App = cap('App');
  if (!App) return;                              // web: the browser's own back works

  App.addListener('backButton', () => {
    if (!$('#lightbox').classList.contains('hidden')) return closeLightbox();
    if (!$('#recSheet').classList.contains('hidden')) return closeRecSheet();
    if (!$('#tripSheet').classList.contains('hidden')) return closeTripSheet();
    if (!$('#sheet').classList.contains('hidden')) return closeSheet();

    // Off the Adventures tab, Back returns to it rather than leaving - the
    // same thing the phone's own apps do with a bottom bar.
    const tab = $('.tab.active');
    if (tab && tab.dataset.tab !== 'tab-list') {
      $('.tab[data-tab="tab-list"]').click();
      return;
    }

    // Then back up the map, one level at a time.
    if (nav.level === 'adventures' && nav.admin1) {
      return goTo('country', { continent: nav.continent, country: nav.country });
    }
    if (nav.level === 'adventures' && ISLAND_GROUP.has(nav.country)) {
      return goTo('islands', { continent: nav.continent });
    }
    if (nav.level === 'adventures') return goTo('continent', { continent: nav.continent });
    if (nav.level === 'country' && ISLAND_GROUP.has(nav.country)) {
      return goTo('islands', { continent: nav.continent });
    }
    if (nav.level === 'country')    return goTo('continent', { continent: nav.continent });
    if (nav.level === 'islands')    return goTo('continent', { continent: nav.continent });
    if (nav.level === 'continent')  return goTo('world');

    App.exitApp();                               // at the top: leave, as expected
  });

  /* An invite or shared link opened from outside.
   *
   * Capacitor retains this event until something listens, so a link that
   * launched the app cold is still delivered once this runs.
   */
  App.addListener('appUrlOpen', ({ url }) => {
    try { openDeepLink(new URL(url).search); }
    catch { /* a URL we cannot parse is not a link we can act on */ }
  });
  App.addListener('appStateChange', ({ isActive }) => {
    if (isActive) void refreshPendingEmailVerification();
  });

  /* Light icons in the status bar, because the header behind it is rust.
   * Style.Dark means "dark background", which is the opposite of what it
   * sounds like and is worth writing down.
   */
  const StatusBar = cap('StatusBar');
  if (StatusBar) StatusBar.setStyle({ style: 'DARK' }).catch(() => {});
}

function setPressedSelection(controls, selected) {
  controls.forEach(control => control.setAttribute('aria-pressed', control === selected ? 'true' : 'false'));
}

function setCurrentTab(tabs, selected) {
  tabs.forEach(tab => tab.setAttribute('aria-current', tab === selected ? 'page' : 'false'));
}

function openRandomAdventure() {
  const remaining = filtered().filter(a => !isDone(a.id));
  const pool = remaining.filter(a => automaticDiscoveryAllowed(a) && !isLocked(a));
  if (!pool.length) {
    if (remaining.some(a => !isLocked(a) && !automaticDiscoveryAllowed(a))) {
      return toast('No automatic picks are available here. Check current notices or travel advice, or adjust your filters.');
    }
    return toast(remaining.some(isLocked)
      ? 'Only locked adventures are left here'
      : 'Nothing left matching those filters!');
  }
  openSheet(pool[Math.floor(Math.random() * pool.length)].id);
}

function wireUI() {
  wireNative();
  wireBrowserNavigation();
  Billing.onChange = () => {
    if (userId && Billing._appUserId === userId && !passwordRecoveryMode && !accountDeletionInProgress) renderAll();
  };

  // Tabs
  $$('.tab').forEach(b => b.onclick = () => {
    // Tapping the tab you are already on takes you back to the top of it.
    // For Adventures that means the world map, however deep you had drilled -
    // otherwise the only way out of a region is to walk back up the crumbs.
    const already = b.classList.contains('active');
    if (already && b.dataset.tab === 'tab-list' && nav.level !== 'world') {
      goTo('world');
      return;
    }
    $$('.tab').forEach(x => x.classList.remove('active'));
    b.classList.add('active');
    setCurrentTab($$('.tab'), b);
    $$('.panel').forEach(p => p.classList.add('hidden'));
    $('#' + b.dataset.tab).classList.remove('hidden');
    window.scrollTo(0, 0);
    // Fetched on opening rather than at launch: it is a separate list and
    // most sessions never look at it.
    if (b.dataset.tab === 'tab-community') pullRecommendations();
  });
  setCurrentTab($$('.tab'), $('.tab.active'));

  // Quick chips
  $$('#quickChips .chip').forEach(c => c.onclick = () => {
    filters.quick = c.dataset.quick;
    $$('#quickChips .chip').forEach(x => x.classList.toggle('on', x === c));
    setPressedSelection($$('#quickChips .chip'), c);
    renderList();
  });
  $('#quickChips .chip').classList.add('on');
  setPressedSelection($$('#quickChips .chip'), $('#quickChips .chip'));

  // Filters
  $('#search').oninput = e => { filters.q = e.target.value; renderList(); };
  $('#fState').onchange = e => { filters.st = e.target.value; renderList(); };
  $('#fCat').onchange   = e => { filters.cat = e.target.value; renderList(); };
  $('#fDiff').onchange  = e => { filters.diff = +e.target.value; renderList(); };
  $('#fCost').onchange  = e => { filters.cost = e.target.value === 'All' ? 'All' : +e.target.value; renderList(); };
  $('#fDog').onchange   = e => { filters.dog = e.target.value; renderList(); };
  $('#clearFilters').onclick = () => {
    Object.assign(filters, { quick: 'all', q: '', st: 'All', cat: 'All', diff: 5, cost: 'All', dog: 'All' });
    $('#search').value = ''; $('#fState').value = 'All'; $('#fCat').value = 'All';
    $('#fDiff').value = '5'; $('#fCost').value = 'All'; $('#fDog').value = 'All';
    $$('#quickChips .chip').forEach((x, i) => x.classList.toggle('on', i === 0));
    setPressedSelection($$('#quickChips .chip'), $('#quickChips .chip'));
    renderList();
  };

  // Memories grouping
  $$('#groupChips .chip').forEach(c => c.onclick = () => {
    memoryGrouping = c.dataset.group;
    $$('#groupChips .chip').forEach(x => x.classList.toggle('on', x === c));
    setPressedSelection($$('#groupChips .chip'), c);
    renderMemories();
  });
  setPressedSelection($$('#groupChips .chip'), $('#groupChips .chip.on'));

  // Place rows and breadcrumbs
  document.body.addEventListener('click', e => {
    const go = e.target.closest('[data-go]');
    if (!go) return;
    let target;
    try { target = JSON.parse(go.dataset.go); } catch { return; }
    if (go.disabled || (go.getAttribute && go.getAttribute('aria-disabled') === 'true')) return;
    if (target) goTo(target.level, target);
  });

  // The world map
  const map = $('#worldMap');
  map.addEventListener('click', e => {
    const hit = continentFromPoint(map, e.clientX, e.clientY);
    if (!hit) return;
    if (catalogueHas(a => a.continent === hit)) goTo('continent', { continent: hit });
    else toast(`No ${hit} adventures yet`);
  });
  // Traveller recommendations
  $('#newRecBtn').onclick = () => openRecSheet(null);
  $('#blockedPeopleBtn').onclick = () => {
    recSort = 'blocked';
    $$('#recSort .chip').forEach(c => c.classList.remove('on'));
    setPressedSelection($$('#recSort .chip'), null);
    $('#blockedPeopleBtn').setAttribute('aria-pressed', 'true');
    pullRecommendations();
  };
  $$('#recSort .chip').forEach(c => c.onclick = () => {
    recSort = c.dataset.recsort;
    $$('#recSort .chip').forEach(x => x.classList.toggle('on', x === c));
    setPressedSelection($$('#recSort .chip'), c);
    $('#blockedPeopleBtn').setAttribute('aria-pressed', 'false');
    pullRecommendations();
  });
  setPressedSelection($$('#recSort .chip'), $('#recSort .chip.on'));
  $('#blockedPeopleBtn').setAttribute('aria-pressed', recSort === 'blocked' ? 'true' : 'false');
  $$('#recSheet [data-recclose]').forEach(b => b.onclick = closeRecSheet);

  document.body.addEventListener('click', e => {
    const t = e.target;
    const hit = sel => t.closest(`[${sel}]`);
    let el;
    if ((el = hit('data-recvote'))) return voteRec(el.dataset.recid, +el.dataset.recvote);
    if ((el = hit('data-recstar'))) return starRec(el.dataset.recid, +el.dataset.recstar);
    if ((el = hit('data-recreport'))) return reportRec(el.dataset.recreport);
    if ((el = hit('data-recblock'))) return blockAuthor(el.dataset.recblock);
    if ((el = hit('data-recunblock'))) return unblockAuthor(el.dataset.recunblock);
    if ((el = hit('data-recedit'))) return openRecSheet(el.dataset.recedit);
    if ((el = hit('data-recdelete'))) return deleteRec(el.dataset.recdelete);
    if ((el = hit('data-recsave'))) return saveRec(el.dataset.recsave || null);
  });

  $('#privacyBtn').onclick = () => window.location.assign('privacy.html');
  $('#supportBtn').onclick = () => window.location.assign('support.html');

  // Only offered while there is no real store to buy from.
  $('#previewBtn').onclick = () => {
    setPreview(!previewOn());
    renderAll();
    toast(previewOn() ? 'Hidden gems unlocked for preview' : 'Preview off');
  };

  $('#restoreBtn').onclick = async () => {
    toast('Checking with the store…');
    const res = await Billing.restore();
    if (!res.ok) return toast(`Could not restore — ${res.reason}`);
    renderAll();
    toast(res.restored.length
      ? `Restored ${res.restored.length} pack${res.restored.length === 1 ? '' : 's'}`
      : 'Nothing to restore on this account');
  };

  // Buy buttons live in re-rendered markup, so the tap is caught on the way up.
  document.body.addEventListener('click', e => {
    const b = e.target.closest('[data-buy]');
    if (!b) return;
    e.preventDefault();
    buyPack(b.dataset.buy);
  });

  // The zoomed map, which knows which country you tapped rather than only
  // which continent. Tapping a country you are already inside does nothing.
  const placeMap = $('#placeMap');
  placeMap.addEventListener('click', e => {
    const hit = mapHit(placeMap, e.clientX, e.clientY);
    if (!hit || !hit.country || hit.country === nav.country) return;
    if (nav.level === 'country' && hit.country !== nav.country) return;
    const n = catalogueHas(a => a.country === hit.country);
    if (!n) return toast(`Nothing in ${countryName(hit.country)} yet`);
    goTo('country', { continent: hit.continent, country: hit.country });
  });

  // The canvas is sized from its container, so a rotate or a resize has to
  // redraw whichever map is currently on screen.
  addEventListener('resize', () => {
    if (nav.level !== 'adventures') renderPlaces();
  });

  // Card taps (delegated — the list is re-rendered constantly)
  document.body.addEventListener('click', e => {
    // Photo thumbnails come first: they sit inside cards that would otherwise
    // swallow the tap and open the adventure sheet instead.
    const thumb = e.target.closest('.thumb');
    if (thumb && !thumb.classList.contains('add')) {
      const holder = thumb.closest('[data-group-key]');
      openLightbox(thumb.dataset.photo, holder && holder.dataset.groupKey);
      return;
    }
    if (e.target.closest('[data-lbclose]')) { closeLightbox(); return; }
    const step = e.target.closest('[data-lbstep]');
    if (step) {
      const n = lightbox.list.length;
      if (n) { lightbox.index = (lightbox.index + +step.dataset.lbstep + n) % n; showLightbox(); }
      return;
    }
    if (e.target.id === 'lbDelete') { deletePhoto(e.target.dataset.photo); return; }

    const tick = e.target.closest('[data-toggle]');
    if (tick) { toggleDone(+tick.dataset.toggle); return; }
    const open = e.target.closest('[data-open]');
    if (open) { openSheet(+open.dataset.open); return; }
    if (e.target.closest('[data-close]')) { closeSheet(); return; }
  });

  // Trips
  $('#newTripBtn').onclick = () => {
    const name = prompt('Name this trip', 'New trip');
    if (!name || !name.trim()) return;
    const trip = { id: newTripId(), name: name.trim(), starts_on: null, ends_on: null,
                   adventure_ids: [], notes: null, created_by: who };
    upsertTrip(trip);
    openTripSheet(trip.id);
  };

  document.body.addEventListener('click', e => {
    const open = e.target.closest('[data-trip]');
    if (open) { openTripSheet(open.dataset.trip); return; }
    if (e.target.closest('[data-tripclose]')) { closeTripSheet(); return; }

    const rm = e.target.closest('[data-tripremove]');
    if (rm && openTripId) { toggleTripMember(openTripId, +rm.dataset.tripremove); return; }

    const add = e.target.closest('[data-tripadd]');
    if (add && openId !== null) {
      toggleTripMember(add.dataset.tripadd, openId);
      const t = trips.find(x => x.id === add.dataset.tripadd);
      toast(tripInsideAdventure(openId).some(x => x.id === add.dataset.tripadd)
        ? `Added to ${t.name}` : `Removed from ${t.name}`);
      return;
    }

    const mk = e.target.closest('[data-tripnew]');
    if (mk) {
      const name = prompt('Name this trip', 'New trip');
      if (!name || !name.trim()) return;
      const trip = { id: newTripId(), name: name.trim(), starts_on: null, ends_on: null,
                     adventure_ids: [+mk.dataset.tripnew], notes: null, created_by: who };
      upsertTrip(trip);
      toast(`Added to ${trip.name}`);
      return;
    }

    const act = e.target.closest('[data-tripact]');
    if (!act) return;
    if (act.dataset.tripact === 'save') saveOpenTrip();
    if (act.dataset.tripact === 'share') shareTrip(openTripId);
    if (act.dataset.tripact === 'delete') {
      const t = trips.find(x => x.id === openTripId);
      if (t && confirm(`Delete "${t.name}"? The adventures themselves stay put.`)) removeTrip(t.id);
    }
  });

  // Photo picker
  $('#photoInput').addEventListener('change', async e => {
    const files = Array.from(e.target.files || []);
    const target = photoTargetId;
    e.target.value = '';                        // so re-picking the same file fires again
    if (target != null && files && files.length) await addPhotos(target, files);
  });

  // Keep keyboard focus inside the visible dialog. Escape closes every sheet;
  // photo arrows remain available while the lightbox is foremost.
  addEventListener('keydown', e => {
    handleDialogKeydown(e);
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
    if (act.dataset.act === 'share') shareAdventure(openId);
    if (act.dataset.act === 'addPhoto') {
      photoTargetId = openId;
      $('#photoInput').click();
    }
    if (act.dataset.act === 'takePhoto') {
      photoTargetId = openId;
      // capture= asks iOS for the camera rather than the picker
      $('#cameraInput').click();
    }
  });

  // Random pick
  // openRandomAdventure builds its pool with automaticDiscoveryAllowed(a), so
  // countrywide do-not-travel entries remain browseable but are never suggested.
  $('#randomBtn').onclick = openRandomAdventure;
  $('#progressViewBtn').onclick = () => setProgressView(progressView === 'group' ? 'personal' : 'group');

  // Settings
  $('#switchWho').onclick = () => {
    const name = prompt('What should your ticks be labelled as?', who || '');
    if (name === null) return;
    who = name.trim() || null;
    if (who) localStorage.setItem(LS.who, who); else localStorage.removeItem(LS.who);
    pushMyName().then(renderAll);
    renderAll();
  };
  $('#hereBtn').onclick = jumpToHere;
  $('#notifyBtn').onclick = toggleNotifications;
  $('#previewNotifyBtn').onclick = previewReminder;
  $('#deleteAccountBtn').onclick = deleteAccount;
  $('#accountPanel').addEventListener('click', async e => {
    const b = e.target.closest('[data-authact]');
    if (!b) return;
    if (b.dataset.authact === 'upgrade') {
      const panel = $('#accountPanel');
      await startAnonymousUpgrade(panel.querySelector('[type="email"]').value.trim());
    }
    if (b.dataset.authact === 'recovery') {
      await sendPasswordReset(accountUser && accountUser.email, 'app', b);
    }
    if (b.dataset.authact === 'new-password') {
      const password = $('#accountPanel').querySelector('[type="password"]').value;
      await finishPasswordRecovery(password);
    }
  });

  $('#cameraInput').addEventListener('change', async e => {
    const files = Array.from(e.target.files || []), target = photoTargetId;
    e.target.value = '';
    if (target != null && files && files.length) await addPhotos(target, files);
  });

  $('#groupPanel').addEventListener('click', async e => {
    const b = e.target.closest('[data-groupact]');
    if (!b) return;
    if (b.dataset.groupact === 'invite') {
      const g = myGroups.find(x => x.id === activeGroupId);
      if (!g || !g.invite_enabled) return toast('Invitations are paused');
      const url = linkTo({ join: g.join_code });
      const text = `Join "${g.name}" on Wayfinder. Open this and it will ask you to confirm.`;
      return share({ title: 'Wayfinder', text, url }, `${text}

${url}`);
    }
    if (b.dataset.groupact === 'create') {
      const name = prompt('Name this group', 'Our list');
      if (name && name.trim()) await createGroup(name.trim());
    }
    if (b.dataset.groupact === 'join') {
      const code = prompt('Enter the join code');
      if (code && code.trim()) await joinGroup(code);
    }
    if (b.dataset.groupact === 'view') await setProgressView(b.dataset.view);
    if (b.dataset.groupact === 'switch') {
      activeGroupId = b.dataset.id;
      localStorage.setItem(LS.group, activeGroupId);
      await loadMembers();
      await setProgressView(progressView);
    }
    if (b.dataset.groupact === 'sharing') {
      const owner = userId, generation = authGeneration, groupId = activeGroupId;
      const enabled = b.dataset.enabled === 'true';
      const changed = await setCompletionSharing(groupId, enabled);
      if (changed === null || owner !== userId || generation !== authGeneration || groupId !== activeGroupId) return;
      if (!changed) return toast('Could not change sharing');
      await pullProgress();
      if (owner !== userId || generation !== authGeneration || groupId !== activeGroupId) return;
      renderAll();
      toast(enabled ? 'Your progress is shared with this group' : 'Your progress is private again');
    }
    if (b.dataset.groupact === 'rotate-invite') await rotateGroupInvite(activeGroupId);
    if (b.dataset.groupact === 'revoke-invite') await revokeGroupInvite(activeGroupId);
    if (b.dataset.groupact === 'remove-member') await removeGroupMember(activeGroupId, b.dataset.member);
    if (b.dataset.groupact === 'transfer-owner') await transferGroupOwnership(activeGroupId, b.dataset.member);
    if (b.dataset.groupact === 'delete-group') await deleteOwnedGroup(activeGroupId);
    if (b.dataset.groupact === 'leave') await leaveGroup(b.dataset.id);
  });

  $('#refreshBtn').onclick = async () => {
    // Signed photo URLs are dropped as well, which the timer does not do -
    // this is the button for when a picture will not load, and re-signing is
    // the thing that fixes that.
    signedUrls.clear();
    await syncNow({ loud: true });
  };
  $('#signOutBtn').onclick = async () => {
    if (!confirm('Sign this phone out? Synced progress stays safe in your account. Unsynced changes on this phone will be removed.')) return;
    await Billing.signOut();
    if (sb) await sb.auth.signOut();
    await handleSignedOut();
  };

  // Connectivity
  addEventListener('online',  () => {
    online = true;
    flushOutbox(); flushPhotoQueue(); flushTrips();
    syncNow();
    if (!realtimeOk) resubscribeRealtime();
  });
  addEventListener('offline', () => { online = false; refreshSyncBar(); });
  addEventListener('visibilitychange', () => {
    if (document.hidden) return;
    const billingOwner = userId, billingGeneration = authGeneration;
    Billing.foreground().then(() => {
      if (billingOwner && userId === billingOwner && authGeneration === billingGeneration
          && !passwordRecoveryMode && !accountDeletionInProgress) renderAll();
    }).catch(error => console.warn('billing foreground refresh', error));
    flushOutbox();
    pullProgress();
    pullPhotos().then(renderAll);
    flushPhotoQueue();
    flushTrips();
    // iOS tears down websockets when an app is backgrounded, and the channel
    // does not reliably come back on its own - which is why two phones stop
    // agreeing after one has been in a pocket. Rebuild it if it is not live.
    if (sb && !realtimeOk) resubscribeRealtime();
  });
}


// ══════════════════════════════════════════════════════════════════════
//  Traveller recommendations
//
//  A separate list, and it stays separate. The curated adventures are
//  checked and somebody stands behind each one; these are what other people
//  using the app say is worth going to, ranked by whoever votes. There is no
//  promotion path between the two on purpose - mixing them would quietly
//  spend the credibility of the checked list on content nobody checked.
//
//  Everything public needs moderation to exist at all, so: report, which
//  hides a post for everyone at three, and block, which hides an author from
//  you immediately and is enforced by the database rather than the interface.
// ══════════════════════════════════════════════════════════════════════
let recs = [];                 // what is on screen
let myVotes = new Map();       // rec id -> { vote, stars }
let recSort = 'top';
let recBusy = false;
let recError = '';
let communityReadRevision = 0;
let blockedPeople = [], blockedPeopleOwner = null;
const communityWrites = new Map();

async function communityWrite(key, request) {
  if (!sb || !userId || accountDeletionInProgress) return null;
  const owner = userId, generation = authGeneration;
  const token = `${owner}:${generation}:${key}`;
  if (communityWrites.has(token)) { toast('Still saving that change'); return null; }
  const pending = Promise.resolve().then(() => {
    if (owner !== userId || generation !== authGeneration || accountDeletionInProgress) return null;
    return request();
  });
  communityWrites.set(token, pending);
  let result;
  try { result = await pending; }
  catch (error) { result = { error }; }
  finally { communityWrites.delete(token); }
  if (owner !== userId || generation !== authGeneration || accountDeletionInProgress) return null;
  return result;
}

async function pullBlockedPeople() {
  const owner = userId, generation = authGeneration;
  const revision = ++communityReadRevision;
  const current = () => owner === userId && generation === authGeneration && recSort === 'blocked'
    && revision === communityReadRevision;
  if (!sb || !owner || !online) {
    recBusy = false; recError = 'Reconnect to load blocked people.';
    renderRecStatus(); renderBlockedPeople(); return;
  }
  recBusy = true; recError = ''; renderRecStatus();
  try {
    const { data, error } = await sb.from('blocked_authors').select('blocked_id, blocked_at')
      .eq('user_id', owner).order('blocked_at');
    if (!current()) return;
    if (error) throw error;
    blockedPeople = data || []; blockedPeopleOwner = owner;
  } catch (error) {
    if (current()) recError = 'Could not load blocked people. Tap Blocked people to retry.';
  } finally {
    if (current()) { recBusy = false; renderRecStatus(); renderBlockedPeople(); }
  }
}

function renderBlockedPeople() {
  const people = blockedPeopleOwner === userId ? blockedPeople : [];
  const names = readLS(`oaa.block-labels.${userId}`, {});
  $('#recList').innerHTML = people.length ? people.map(person => `<article class="reccard"><div class="recmain">
        <div class="rectitle">${esc(names[person.blocked_id] || 'Blocked traveller')}</div>
        <p class="muted">Blocked ${esc(new Date(person.blocked_at).toLocaleDateString())}</p>
        <button class="btn-ghost" data-recunblock="${esc(person.blocked_id)}">Unblock</button>
      </div></article>`).join('') : '<div class="empty">You have not blocked anyone.</div>';
}

const REC_CATEGORIES = ['Nature', 'Beach', 'Wildlife', 'Hiking', 'Water', 'Culture',
  'History', 'Food & Drink', 'Road Trip', 'Adrenaline', 'Island', 'Snow', 'City',
  'Family', 'Scenic', 'Stargazing'];

function recScore(r) { return (r.up_votes || 0) - (r.down_votes || 0); }
function recStars(r) {
  return r.stars_count ? (r.stars_sum / r.stars_count) : 0;
}

async function pullRecommendations() {
  if (recSort === 'blocked') return pullBlockedPeople();
  const owner = userId, generation = authGeneration, sort = recSort;
  const revision = ++communityReadRevision;
  if (!sb || !online) {
    recBusy = false; recError = 'Reconnect to refresh recommendations.'; renderRecs(); return;
  }
  const current = () => owner === userId && generation === authGeneration && sort === recSort
    && revision === communityReadRevision;
  recBusy = true; recError = ''; renderRecStatus();
  try {
    let q = sb.from('recommendations').select('*');
    if (sort === 'mine' && owner) q = q.eq('created_by', owner);
    const { data, error } = await q.limit(300);
    if (!current()) return;
    if (error) throw error;
    let nextVotes = new Map();
    if (owner && (data || []).length) {
      const result = await sb.from('recommendation_votes')
        .select('rec_id, vote, stars').eq('user_id', owner);
      if (!current()) return;
      if (result.error) throw result.error;
      nextVotes = new Map((result.data || []).map(v => [v.rec_id, v]));
    }
    recs = data || []; myVotes = nextVotes;
  } catch (error) {
    if (current()) recError = 'Could not refresh recommendations. Tap a sort option to retry.';
  } finally {
    if (current()) { recBusy = false; renderRecs(); }
  }
}

function sortedRecs() {
  const list = [...recs];
  if (recSort === 'stars') {
    list.sort((a, b) => recStars(b) - recStars(a)
      || (b.stars_count || 0) - (a.stars_count || 0));
  } else if (recSort === 'new' || recSort === 'mine') {
    list.sort((a, b) => (b.created_at || '').localeCompare(a.created_at || ''));
  } else {
    list.sort((a, b) => recScore(b) - recScore(a)
      || (b.created_at || '').localeCompare(a.created_at || ''));
  }
  return list;
}

function renderRecStatus() {
  const el = $('#recStatus');
  if (!el) return;
  if (!sb) { el.textContent = 'Not connected, so recommendations are unavailable.'; return; }
  el.textContent = recBusy ? 'Loading…' : recError;
}

function starRow(r) {
  const mine = myVotes.get(r.id);
  const avg = recStars(r);
  const shown = mine && mine.stars ? mine.stars : Math.round(avg);
  return `<span class="recstars" data-recid="${esc(r.id)}">${
    [1, 2, 3, 4, 5].map(n =>
      `<button class="star${n <= shown ? ' on' : ''}${mine && mine.stars ? ' mine' : ''}"
               data-recstar="${n}" data-recid="${esc(r.id)}"
               aria-label="Rate ${n} out of 5">★</button>`).join('')
  }<span class="recavg">${r.stars_count
    ? `${avg.toFixed(1)} · ${r.stars_count}` : 'unrated'}</span></span>`;
}

function recCard(r) {
  const mine = myVotes.get(r.id);
  const v = mine ? mine.vote : 0;
  const own = userId && r.created_by === userId;
  return `<article class="reccard${r.hidden ? ' hidden-post' : ''}">
    <div class="recvote">
      <button class="recv${v === 1 ? ' on' : ''}" data-recvote="1" data-recid="${esc(r.id)}"
              aria-label="Vote up">▲</button>
      <b>${recScore(r)}</b>
      <button class="recv${v === -1 ? ' on' : ''}" data-recvote="-1" data-recid="${esc(r.id)}"
              aria-label="Vote down">▼</button>
    </div>
    <div class="recmain">
      <div class="rectitle">${esc(r.title)}</div>
      <div class="recmeta">${esc(r.place)}${r.admin1 ? ' · ' + esc(r.admin1) : ''} · ${
        esc(countryName(r.country))} ${countryFlag(r.country)}${
        r.category ? ' · ' + esc(r.category) : ''}</div>
      ${r.description ? `<p class="recdesc">${esc(r.description)}</p>` : ''}
      ${starRow(r)}
      <div class="recfoot">
        <span>${esc(r.author_name || 'Someone')}</span>
        ${own
          ? `<button class="reclink" data-recedit="${esc(r.id)}">Edit</button>
             <button class="reclink danger" data-recdelete="${esc(r.id)}">Delete</button>`
          : `<button class="reclink" data-recreport="${esc(r.id)}">Report</button>
             <button class="reclink" data-recblock="${esc(r.created_by)}">Block</button>`}
      </div>
      ${r.hidden ? '<div class="recnote">Hidden after reports. Only you can see it.</div>' : ''}
    </div>
  </article>`;
}

function renderRecs() {
  const el = $('#recList');
  if (!el) return;
  renderRecStatus();
  if (recSort === 'blocked') { renderBlockedPeople(); return; }
  const list = sortedRecs();
  el.innerHTML = list.length
    ? list.map(recCard).join('')
    : `<div class="empty">${sb
        ? 'Nothing recommended yet.<br>Be the first.'
        : 'Recommendations need a connection.'}</div>`;
}

async function voteRec(id, vote) {
  if (accountDeletionInProgress) return;
  if (!sb || !userId) return toast('Not connected');
  const mine = myVotes.get(id) || {};
  const next = mine.vote === vote ? 0 : vote;      // pressing again withdraws it
  const row = { rec_id: id, user_id: userId, vote: next, stars: mine.stars ?? null };
  const result = await communityWrite(`feedback:${id}`, () => sb.from('recommendation_votes')
    .upsert(row, { onConflict: 'rec_id,user_id' }));
  if (!result) return;
  const { error } = result;
  if (error) { console.warn(error); return toast('Could not vote'); }
  myVotes.set(id, { vote: next, stars: mine.stars ?? null });
  const r = recs.find(x => x.id === id);
  if (r) {
    // Optimistic, then corrected by the pull that follows.
    const was = mine.vote || 0;
    if (was === 1) r.up_votes--;
    if (was === -1) r.down_votes--;
    if (next === 1) r.up_votes++;
    if (next === -1) r.down_votes++;
  }
  renderRecs();
  pullRecommendations();
}

async function starRec(id, stars) {
  if (accountDeletionInProgress) return;
  if (!sb || !userId) return toast('Not connected');
  const mine = myVotes.get(id) || {};
  const next = mine.stars === stars ? null : stars;
  const owner = userId;
  const result = await communityWrite(`feedback:${id}`, () => sb.from('recommendation_votes')
    .upsert({ rec_id: id, user_id: owner, vote: mine.vote ?? 0, stars: next },
            { onConflict: 'rec_id,user_id' }));
  if (!result) return;
  const { error } = result;
  if (error) { console.warn(error); return toast('Could not rate'); }
  myVotes.set(id, { vote: mine.vote ?? 0, stars: next });
  renderRecs();
  pullRecommendations();
}

async function reportRec(id) {
  if (accountDeletionInProgress) return;
  if (!sb || !userId) return toast('Not connected');
  const reason = prompt('What is wrong with this post?\n\n'
    + 'Three reports hide it for everyone while it is looked at.');
  if (reason === null) return;
  const owner = userId;
  const result = await communityWrite(`report:${id}`, () => sb.from('recommendation_reports')
    .upsert({ rec_id: id, user_id: owner, reason: reason.slice(0, 300) },
            { onConflict: 'rec_id,user_id' }));
  if (!result) return;
  const { error } = result;
  if (error) { console.warn(error); return toast('Could not report'); }
  toast('Reported. Thank you.');
  pullRecommendations();
}

async function blockAuthor(authorId) {
  if (accountDeletionInProgress) return;
  if (!sb || !userId || !authorId) return;
  if (authorId === userId) return toast('That is you');
  if (!confirm('Block this person? Everything they have posted disappears from '
             + 'your list, now and in future.')) return;
  const owner = userId;
  const label = (recs.find(r => r.created_by === authorId) || {}).author_name;
  const result = await communityWrite(`block:${authorId}`, () => sb.from('blocked_authors')
    .upsert({ user_id: owner, blocked_id: authorId }, { onConflict: 'user_id,blocked_id' }));
  if (!result) return;
  const { error } = result;
  if (error) { console.warn(error); return toast('Could not block'); }
  if (label) {
    const names = readLS(`oaa.block-labels.${owner}`, {});
    names[authorId] = label;
    writeLS(`oaa.block-labels.${owner}`, names);
  }
  toast('Blocked');
  pullRecommendations();
}

async function unblockAuthor(authorId) {
  if (!sb || !userId || !authorId || accountDeletionInProgress) return;
  const owner = userId;
  const result = await communityWrite(`block:${authorId}`, () => sb.from('blocked_authors')
    .delete().eq('user_id', owner).eq('blocked_id', authorId));
  if (!result) return;
  if (result.error) return toast('Could not unblock. Try again.');
  const names = readLS(`oaa.block-labels.${owner}`, {});
  delete names[authorId]; writeLS(`oaa.block-labels.${owner}`, names);
  toast('Unblocked. Their recommendations can appear again.');
  pullRecommendations();
}

async function deleteRec(id) {
  if (!sb || !userId || accountDeletionInProgress) return;
  if (!confirm('Delete your recommendation? This cannot be undone.')) return;
  const owner = userId;
  const result = await communityWrite(`post:${id}`, () => sb.from('recommendations').delete()
    .eq('id', id).eq('created_by', owner));
  if (!result) return;
  const { error } = result;
  if (error) { console.warn(error); return toast('Could not delete'); }
  toast('Deleted');
  pullRecommendations();
}

// ── Writing one ───────────────────────────────────────────────────────
function openRecSheet(id) {
  if (!userId || accountDeletionInProgress) return;
  const r = id ? recs.find(x => x.id === id) : null;
  const countries = Object.keys(COUNTRY_NAME)
    .sort((a, b) => COUNTRY_NAME[a].localeCompare(COUNTRY_NAME[b]));
  $('#recBody').innerHTML = `
    <h2>${r ? 'Edit your recommendation' : 'Recommend a place'}</h2>
    <p class="muted">This goes on the traveller list, not the main adventure
       list. Say what somebody would actually do there.</p>
    <label>What to do<input id="recTitle" maxlength="90" placeholder="Walk the old tramway to the point"
      value="${r ? esc(r.title) : ''}"></label>
    <label>Where<input id="recPlace" maxlength="90" placeholder="Name of the place"
      value="${r ? esc(r.place) : ''}"></label>
    <label>Region or state<input id="recAdmin" maxlength="60" placeholder="Optional"
      value="${r && r.admin1 ? esc(r.admin1) : ''}"></label>
    <label>Country<select id="recCountry">${countries.map(c =>
      `<option value="${c}"${r && r.country === c ? ' selected' : ''}>${
        COUNTRY_FLAG[c]} ${esc(COUNTRY_NAME[c])}</option>`).join('')}</select></label>
    <label>Category<select id="recCategory"><option value="">—</option>${
      REC_CATEGORIES.map(c => `<option${r && r.category === c ? ' selected' : ''}>${c}</option>`).join('')
    }</select></label>
    <label>Why it is worth it<textarea id="recDesc" maxlength="600" rows="4"
      placeholder="What makes it worth the detour, and anything someone should know before going.">${
        r && r.description ? esc(r.description) : ''}</textarea></label>
    <p class="fineprint">Posting puts your display name on it. Do not post
       anything unsafe, abusive, or advertising a business you are part of.
       Posts can be reported and removed.</p>
    <button class="btn-primary" data-recsave="${r ? esc(r.id) : ''}">${
      r ? 'Save changes' : 'Post it'}</button>`;
  showManagedDialog('#recSheet');
}

function closeRecSheet() { hideManagedDialog('#recSheet'); }

async function saveRec(id) {
  if (accountDeletionInProgress) return;
  if (!sb || !userId) return toast('Not connected');
  const title = $('#recTitle').value.trim();
  const place = $('#recPlace').value.trim();
  if (title.length < 4) return toast('Say what somebody would do there');
  if (place.length < 2) return toast('Where is it?');

  const row = {
    title, place,
    admin1: $('#recAdmin').value.trim() || null,
    country: $('#recCountry').value,
    category: $('#recCategory').value || null,
    description: $('#recDesc').value.trim() || null,
    author_name: who || 'Someone',
  };
  const owner = userId;
  const res = await communityWrite(`post:${id || 'new'}`, () => id
    ? sb.from('recommendations').update(row).eq('id', id).eq('created_by', owner)
    : sb.from('recommendations').insert({ ...row, created_by: owner }));
  if (!res) return;
  if (res.error) { console.warn(res.error); return toast('Could not post it'); }
  closeRecSheet();
  toast(id ? 'Updated' : 'Posted');
  recSort = 'new';
  $$('#recSort .chip').forEach(c => c.classList.toggle('on', c.dataset.recsort === 'new'));
  setPressedSelection($$('#recSort .chip'), $('#recSort .chip[data-recsort="new"]'));
  $('#blockedPeopleBtn').setAttribute('aria-pressed', 'false');
  pullRecommendations();
}

// ══════════════════════════════════════════════════════════════════════
//  Sign in
// ══════════════════════════════════════════════════════════════════════
function authRedirectUrl() {
  const configured = window.OAA_CONFIG && OAA_CONFIG.shareBase;
  return configured || `${location.origin}${location.pathname}`;
}

// Expired links must reach a usable screen without displaying arbitrary URL text.
function consumeAuthLinkError() {
  const query = new URLSearchParams(location.search || '');
  const fragment = new URLSearchParams(String(location.hash || '').replace(/^#/, ''));
  if (!query.has('error') && !query.has('error_code')
      && !fragment.has('error') && !fragment.has('error_code')) return '';
  for (const key of ['error', 'error_code', 'error_description', 'error_uri']) {
    query.delete(key); fragment.delete(key);
  }
  const search = query.toString(), hash = fragment.toString();
  history.replaceState(history.state || null, '', location.pathname
    + (search ? '?' + search : '') + (hash ? '#' + hash : ''));
  return 'That email link is invalid, expired or already used. Sign in if you have verified your email, or request a fresh verification or recovery email below.';
}

async function resendVerificationEmail(email) {
  if (!sb || signOutHandling || accountDeletionInProgress || verificationResendBusy) return false;
  const clean = String(email || '').trim();
  if (!clean || !clean.includes('@')) { setAuthMessage('Enter your email first.'); return false; }
  const generation = authGeneration, owner = userId;
  const button = $('#resendVerificationBtn');
  verificationResendBusy = true;
  if (button) button.disabled = true;
  try {
    const { error } = await sb.auth.resend({ type: 'signup', email: clean,
      options: { emailRedirectTo: authRedirectUrl() } });
    if (generation !== authGeneration || owner !== userId) return false;
    setAuthMessage(error ? (error.message || 'Could not resend verification. Try again shortly.')
      : 'If this account is waiting for verification, a new email is on its way. Use the newest link.', !error);
    return !error;
  } catch {
    if (generation === authGeneration && owner === userId) {
      setAuthMessage('Could not resend verification. Check your connection and try again.');
    }
    return false;
  } finally {
    verificationResendBusy = false;
    if (generation === authGeneration && owner === userId && button) button.disabled = false;
  }
}

async function refreshPendingEmailVerification() {
  const marker = readAccountUpgrade();
  if (!sb || !accountUiReady || !marker || marker.stage !== 'awaiting-email'
      || marker.owner_id !== userId || verificationRefreshBusy || accountUpgradeBusy
      || signOutHandling || accountDeletionInProgress || passwordRecoveryMode) return false;
  const owner = userId, generation = authGeneration;
  const button = $('#checkVerificationBtn');
  verificationRefreshBusy = true;
  if (button) button.disabled = true;
  try {
    // Safari and the native WebView have separate storage. Verify the original
    // session on the server; never import another browser's account or photos.
    const { data, error } = await sb.auth.getUser();
    if (generation !== authGeneration || owner !== userId || signOutHandling
        || accountDeletionInProgress || passwordRecoveryMode) return false;
    const currentMarker = readAccountUpgrade();
    if (!currentMarker || currentMarker.owner_id !== owner || currentMarker.stage !== 'awaiting-email') return false;
    if (error || !data || !data.user || data.user.id !== owner) {
      setAuthMessage('Could not check verification. Reconnect and try again. Your progress stays on this account.');
      return false;
    }
    if (isAnonymousUser(data.user) || !hasVerifiedEmail(data.user)) {
      setAuthMessage('Email is not verified yet. Open the latest link, then check again.');
      return false;
    }
    accountUser = data.user;
    accountIsAnonymous = false;
    writeAccountUpgrade(owner, 'set-password');
    showAnonymousUpgradeScreen('set-password');
    return true;
  } catch {
    if (generation === authGeneration && owner === userId) {
      setAuthMessage('Could not check verification. Reconnect and try again.');
    }
    return false;
  } finally {
    verificationRefreshBusy = false;
    if (generation === authGeneration && owner === userId && button) button.disabled = false;
  }
}

function setAuthMessage(text, ok = false) {
  const msg = $('#lockMsg');
  msg.className = 'lock-msg' + (ok ? ' ok' : '');
  msg.textContent = text || '';
}

const ACCOUNT_UPGRADE_STAGES = new Set(['awaiting-email', 'set-password']);

function readAccountUpgrade() {
  const value = readLS(LS.accountUpgrade, null);
  if (!value || typeof value.owner_id !== 'string' || !ACCOUNT_UPGRADE_STAGES.has(value.stage)) {
    localStorage.removeItem(LS.accountUpgrade);
    return null;
  }
  return { owner_id: value.owner_id, stage: value.stage };
}

function writeAccountUpgrade(ownerId, stage) {
  if (!ownerId || !ACCOUNT_UPGRADE_STAGES.has(stage)) return false;
  // Intentionally persist only the owner and stage. Email comes back from the
  // verified Supabase user; passwords never touch localStorage.
  writeLS(LS.accountUpgrade, { owner_id: ownerId, stage });
  return true;
}

function clearAccountUpgrade(ownerId = null) {
  const current = readAccountUpgrade();
  if (!ownerId || !current || current.owner_id === ownerId) {
    localStorage.removeItem(LS.accountUpgrade);
  }
}

function isAnonymousUser(user) {
  return !!(user && (user.is_anonymous
    || (user.app_metadata && user.app_metadata.provider === 'anonymous')));
}

function hasVerifiedEmail(user) {
  return !!(user && user.email && (user.email_confirmed_at || user.confirmed_at));
}

function accountUpgradeFor(user) {
  const upgrade = readAccountUpgrade();
  if (!upgrade) return null;
  if (!user || upgrade.owner_id !== user.id) {
    clearAccountUpgrade();
    return null;
  }
  if (upgrade.stage === 'awaiting-email' && !isAnonymousUser(user) && hasVerifiedEmail(user)) {
    writeAccountUpgrade(user.id, 'set-password');
    return { owner_id: user.id, stage: 'set-password' };
  }
  if (upgrade.stage === 'set-password' && (isAnonymousUser(user) || !hasVerifiedEmail(user))) {
    // A stale or manually altered marker cannot skip email verification.
    if (isAnonymousUser(user)) { clearAccountUpgrade(user.id); return null; }
    writeAccountUpgrade(user.id, 'awaiting-email');
    return { owner_id: user.id, stage: 'awaiting-email' };
  }
  return upgrade;
}

function configureAccountLock({ email, password, form = true }) {
  $('#lockForm').classList.toggle('hidden', !form);
  $('#accountEmailLabel').classList.toggle('hidden', !email);
  $('#accountEmail').classList.toggle('hidden', !email);
  $('#accountEmail').required = !!email;
  $('#accountPasswordLabel').classList.toggle('hidden', !password);
  $('#accountPassword').classList.toggle('hidden', !password);
  $('#accountPassword').required = !!password;
  $('#resendVerificationBtn').classList.toggle('hidden', !email || !password);
  $('#checkVerificationBtn').classList.add('hidden');
}

async function trySignIn(email, password) {
  const btn = $('#lockBtn');
  if (!sb) { setAuthMessage('Can’t reach the server. Check your connection.'); return false; }
  if (signOutHandling) { setAuthMessage('Finishing sign-out. Try again in a moment.'); return false; }
  if (btn.disabled) return false;
  btn.disabled = true; setAuthMessage('Signing in…');
  try {
    const { error } = await sb.auth.signInWithPassword({ email: email.trim(), password });
    if (error) { setAuthMessage(error.message || 'That email or password didn’t work.'); return false; }
    setAuthMessage('Welcome back.', true);
    return true;
  } catch {
    setAuthMessage('Could not sign in. Check your connection and try again.');
    return false;
  } finally { btn.disabled = false; }
}

function wireAccountLock() {
  $('#lockForm').onsubmit = async e => {
    e.preventDefault();
    if (await trySignIn($('#accountEmail').value, $('#accountPassword').value)) enterApp();
  };
  $('#createAccountBtn').onclick = () => createAccount(
    $('#accountEmail').value, $('#accountPassword').value);
  $('#forgotPasswordBtn').onclick = () => sendPasswordReset(
    $('#accountEmail').value, 'lock', $('#forgotPasswordBtn'));
  $('#resendVerificationBtn').onclick = () => resendVerificationEmail($('#accountEmail').value);
  $('#checkVerificationBtn').onclick = () => refreshPendingEmailVerification();
}

function showAccountLock(message = '') {
  hideAndClearPrivateOverlays();
  $('#app').classList.add('hidden');
  $('#lock').classList.remove('hidden');
  $('.lock-sub').textContent = 'Keep your places, purchases and groups when you change devices.';
  $('#lockBtn').textContent = 'Sign in';
  $('#createAccountBtn').classList.remove('hidden');
  $('#createAccountBtn').disabled = false;
  $('#forgotPasswordBtn').classList.remove('hidden');
  $('#forgotPasswordBtn').disabled = false;
  $('#resendVerificationBtn').disabled = false;
  configureAccountLock({ email: true, password: true });
  $('#accountPassword').autocomplete = 'current-password';
  wireAccountLock();
  setAuthMessage(message);
}

function hideAndClearPrivateOverlays() {
  for (const id of ['#sheet', '#tripSheet', '#recSheet', '#lightbox']) {
    const overlay = $(id);
    if (overlay) overlay.classList.add('hidden');
  }
  for (const id of ['#sheetBody', '#tripBody', '#recBody']) {
    const body = $(id);
    if (body) body.innerHTML = '';
  }
  const image = $('#lbImg');
  if (image) image.src = '';
  for (const id of ['#lbTitle', '#lbSub']) {
    const text = $(id);
    if (text) text.textContent = '';
  }
  for (const id of ['#photoInput', '#cameraInput']) {
    const input = $(id);
    if (input) input.value = '';
  }
  openId = null; openTripId = null;
  photoTargetId = null;
  lightbox = { list: [], index: 0 };
  discardManagedDialogFocus();
}

function clearPrivateMemoryForAccountTransition() {
  progress = new Map(); personalProgress = new Map(); personalCacheReady = false;
  releaseLocalPhotoUrls();
  photos = []; pendingPhotos = []; trips = []; myGroups = []; members = new Map();
  activeGroupId = null; who = null; progressView = 'personal'; signedUrls.clear();
  recs = []; myVotes = new Map(); recBusy = false; pushedName = null;
  blockedPeople = []; blockedPeopleOwner = null; recError = '';
  hideAndClearPrivateOverlays();
}

function receivePasswordRecovery(session) {
  if (signOutHandling) {
    if (accountUiReady) showAccountLock('Finishing sign-out. Open the recovery link again in a moment.');
    return false;
  }
  hideAndClearPrivateOverlays();
  const recoveryUser = session && session.user;
  if (!recoveryUser || !recoveryUser.id) {
    passwordRecoveryMode = false;
    passwordRecoveryOwnerId = null;
    passwordRecoveryBusy = false;
    passwordRecoveryAttempt++;
    pendingPasswordRecovery = { error: true };
    if (accountUiReady) showAccountLock('That recovery link is invalid or expired. Request a new one.');
    return false;
  }
  const ownerChanged = !!userId && userId !== recoveryUser.id;
  authGeneration++;
  passwordRecoveryMode = true;
  passwordRecoveryOwnerId = recoveryUser.id;
  passwordRecoveryBusy = false;
  passwordRecoveryAttempt++;
  const recoveryAttempt = passwordRecoveryAttempt;
  pendingPasswordRecovery = { ownerId: recoveryUser.id, attempt: recoveryAttempt };
  $('#app').classList.add('hidden');
  if (sb) {
    try {
      const removing = sb.removeAllChannels();
      if (removing && typeof removing.catch === 'function') removing.catch(() => {});
    } catch { /* already disconnected */ }
  }
  realtimeOk = false;
  if (ownerChanged) {
    clearPrivateMemoryForAccountTransition();
  }
  userId = recoveryUser.id;
  accountUser = recoveryUser;
  accountIsAnonymous = isAnonymousUser(accountUser);
  if (accountUiReady && accountBootReady) {
    const ownerId = recoveryUser.id;
    pendingPasswordRecovery = null;
    setTimeout(() => {
      if (accountUiReady && accountBootReady && passwordRecoveryMode && passwordRecoveryOwnerId === ownerId) {
        void enterApp({ recoveryOwnerId: ownerId, recoveryAttempt });
      }
    }, 0);
  }
  return true;
}

async function handleSignedOut(message = 'Signed out. Sign in to continue.') {
  if (signOutWork) return signOutWork;
  signOutHandling = true;
  const outgoingOwner = userId;
  signOutWork = (async () => {
    try {
      authGeneration++;
      userId = null; accountUser = null; accountIsAnonymous = false;
      passwordRecoveryMode = false; passwordRecoveryBusy = false; passwordRecoveryOwnerId = null;
      passwordRecoveryAttempt++;
      recoveryRequestBusy = false; recoveryRequestAttempt++;
      pendingPasswordRecovery = null;
      progress = new Map(); personalProgress = new Map(); personalCacheReady = false;
      releaseLocalPhotoUrls();
      photos = []; pendingPhotos = []; trips = []; myGroups = []; members = new Map();
      activeGroupId = null; signedUrls.clear();
      recs = []; myVotes = new Map(); recBusy = false; pushedName = null;
      flushOutbox.requested = false; flushPhotoQueue.requested = false; flushTrips.requested = false;
      showAccountLock(message); // remove private UI before asynchronous cleanup
      let legacyQueueScoped = true;
      if (validAccountOwner(outgoingOwner) && localStorage.getItem(LS.owner) === outgoingOwner) {
        try { await idbAttributeLegacyQueueOwner(outgoingOwner); }
        catch (error) { legacyQueueScoped = false; console.warn('legacy photo ownership', error); }
      }
      for (const key of [LS.progress, LS.personalProgress, LS.outbox, LS.trips,
        LS.tripOutbox, LS.group, LS.who, LS.view]) localStorage.removeItem(key);
      if (legacyQueueScoped) localStorage.removeItem(LS.owner);
      try { if (sb) await sb.removeAllChannels(); } catch { /* already disconnected */ }
      try { await idbClear(); } catch { /* nothing queued */ }
      try { await Billing.signOut(); } catch { /* store SDK unavailable */ }
    } finally {
      accountDeletionInProgress = false;
      signOutHandling = false;
      signOutWork = null;
    }
  })();
  return signOutWork;
}

async function createAccount(email, password) {
  if (!sb) return setAuthMessage('Can’t reach the server. Check your connection.');
  if (signOutHandling) return setAuthMessage('Finishing sign-out. Try again in a moment.');
  if (password.length < 6) return setAuthMessage('Use at least 6 characters for your password.');
  const btn = $('#createAccountBtn');
  if (btn.disabled) return;
  btn.disabled = true;
  setAuthMessage('Creating your account…');
  try {
    const { data, error } = await sb.auth.signUp({
      email: email.trim(), password,
      options: { emailRedirectTo: authRedirectUrl() },
    });
    if (error) return setAuthMessage(error.message || 'Could not create the account.');
    if (data && data.session) { setAuthMessage('Account created.', true); return enterApp(); }
    setAuthMessage('Check your email to verify the account, then sign in.', true);
  } catch {
    setAuthMessage('Could not create the account. Check your connection and try again.');
  } finally { btn.disabled = false; }
}

async function sendPasswordReset(email, target = 'lock', control = null) {
  const report = (message, ok = false) => target === 'lock' ? setAuthMessage(message, ok) : toast(message);
  if (!sb) return report('Can’t reach the server. Check your connection.');
  if (signOutHandling) { report('Finishing sign-out. Try again in a moment.'); return false; }
  const clean = String(email || '').trim();
  if (!clean || !clean.includes('@')) {
    if (target === 'lock') setAuthMessage('Enter your email first.'); else toast('Enter your email first');
    return false;
  }
  if (recoveryRequestBusy) return false;
  const owner = userId, generation = authGeneration, attempt = ++recoveryRequestAttempt;
  const button = control || (target === 'lock' ? $('#forgotPasswordBtn') : null);
  recoveryRequestBusy = true;
  if (button) button.disabled = true;
  try {
    const { error } = await sb.auth.resetPasswordForEmail(clean, { redirectTo: authRedirectUrl() });
    if (attempt !== recoveryRequestAttempt || owner !== userId || generation !== authGeneration) return false;
    report(error ? (error.message || 'Could not send the recovery email.')
      : 'Recovery email sent. Check your inbox.', !error);
    return !error;
  } catch {
    if (attempt === recoveryRequestAttempt && owner === userId && generation === authGeneration) {
      report('Could not send the recovery email. Check your connection and try again.');
    }
    return false;
  } finally {
    if (attempt === recoveryRequestAttempt) {
      recoveryRequestBusy = false;
      if (button) button.disabled = false;
    }
  }
}

function showPasswordRecoveryScreen(message = '') {
  hideAndClearPrivateOverlays();
  if (!passwordRecoveryMode || !passwordRecoveryOwnerId || passwordRecoveryOwnerId !== userId) {
    showAccountLock('Open a fresh recovery link, then try again.');
    return false;
  }
  passwordRecoveryAttempt++;
  passwordRecoveryBusy = false;
  $('#app').classList.add('hidden');
  $('#lock').classList.remove('hidden');
  $('#createAccountBtn').classList.add('hidden');
  $('#forgotPasswordBtn').classList.add('hidden');
  $('.lock-sub').textContent = 'Choose a new password for this account.';
  configureAccountLock({ email: false, password: true });
  $('#accountPassword').autocomplete = 'new-password';
  $('#accountPassword').value = '';
  $('#lockBtn').textContent = 'Save new password';
  $('#lockBtn').disabled = false;
  const formOwner = passwordRecoveryOwnerId, formAttempt = passwordRecoveryAttempt;
  $('#lockForm').onsubmit = async event => {
    event.preventDefault();
    await finishPasswordRecovery($('#accountPassword').value, formOwner, formAttempt);
  };
  setAuthMessage(message);
  return true;
}

async function finishPasswordRecovery(password, expectedOwner = passwordRecoveryOwnerId,
                                        expectedAttempt = passwordRecoveryAttempt) {
  if (signOutHandling) {
    setAuthMessage('Finishing sign-out. Open the recovery link again in a moment.');
    return false;
  }
  if (expectedAttempt !== passwordRecoveryAttempt
      || (expectedOwner && passwordRecoveryOwnerId && expectedOwner !== passwordRecoveryOwnerId)) return false;
  if (!sb || !passwordRecoveryMode || !expectedOwner || passwordRecoveryOwnerId !== expectedOwner
      || userId !== expectedOwner || !accountUser || accountUser.id !== expectedOwner) {
    showAccountLock('Open a fresh recovery link, then try again.');
    return false;
  }
  if (String(password || '').length < 6) {
    setAuthMessage('Use at least 6 characters for your password.');
    return false;
  }
  if (passwordRecoveryBusy) return false;
  const before = userId, generation = authGeneration, attempt = expectedAttempt;
  const button = $('#lockBtn');
  passwordRecoveryBusy = true;
  button.disabled = true;
  setAuthMessage('Saving password…');
  try {
    const { data, error } = await sb.auth.updateUser({ password });
    if (attempt !== passwordRecoveryAttempt || generation !== authGeneration
        || before !== userId || passwordRecoveryOwnerId !== before) return false;
    if (error || !data || !data.user || data.user.id !== before) {
      setAuthMessage((error && error.message) || 'Could not update the password. Try a fresh recovery link.');
      return false;
    }
    accountUser = data.user;
    passwordRecoveryMode = false;
    passwordRecoveryOwnerId = null;
    passwordRecoveryBusy = false;
    button.disabled = false;
    setAuthMessage('Password updated.', true);
    await enterApp();
    return true;
  } catch {
    if (attempt === passwordRecoveryAttempt && generation === authGeneration
        && before === userId && passwordRecoveryOwnerId === before) {
      setAuthMessage('Could not update the password. Check your connection and try again.');
    }
    return false;
  } finally {
    if (attempt === passwordRecoveryAttempt && passwordRecoveryOwnerId === before) {
      passwordRecoveryBusy = false;
      button.disabled = false;
    }
  }
}

async function startAnonymousUpgrade(email) {
  const clean = String(email || '').trim();
  if (!sb || !accountIsAnonymous || !userId || !accountUser || accountUser.id !== userId) return false;
  if (!clean || !clean.includes('@')) {
    toast('Enter the email you want to use for recovery');
    return false;
  }
  if (accountUpgradeBusy) return false;
  const before = userId, generation = authGeneration;
  accountUpgradeBusy = true;
  setAuthMessage('Sending verification email…');
  try {
    const { data, error } = await sb.auth.updateUser({ email: clean }, {
      emailRedirectTo: authRedirectUrl(),
    });
    if (generation !== authGeneration || userId !== before) return false;
    if (error) {
      toast(error.message || 'Could not send the verification email');
      showAnonymousUpgradeScreen();
      return false;
    }
    if (!data || !data.user || data.user.id !== before) {
      console.error('Anonymous email link changed identity; refusing to continue');
      toast('Account upgrade could not be verified');
      return false;
    }
    accountUser = data.user;
    accountIsAnonymous = isAnonymousUser(data.user);
    writeAccountUpgrade(before, 'awaiting-email');
    showAnonymousUpgradeScreen('awaiting-email');
    return true;
  } catch {
    if (generation === authGeneration && userId === before) {
      showAnonymousUpgradeScreen();
      setAuthMessage('Could not send verification. Check your connection and try again.');
    }
    return false;
  } finally {
    accountUpgradeBusy = false;
  }
}

async function finishAnonymousUpgrade(password) {
  const upgrade = accountUpgradeFor(accountUser);
  if (!sb || !upgrade || upgrade.owner_id !== userId || upgrade.stage !== 'set-password'
      || !hasVerifiedEmail(accountUser) || isAnonymousUser(accountUser)) {
    toast('Verify the email before choosing a password');
    return false;
  }
  if (String(password || '').length < 6) {
    toast('Use at least 6 characters for your password');
    return false;
  }
  if (accountUpgradeBusy) return false;
  const before = userId, generation = authGeneration;
  accountUpgradeBusy = true;
  setAuthMessage('Saving password…');
  try {
    const { data, error } = await sb.auth.updateUser({ password });
    if (generation !== authGeneration || userId !== before) return false;
    if (error) {
      toast(error.message || 'Could not save the password');
      showAnonymousUpgradeScreen('set-password');
      return false;
    }
    if (!data || !data.user || data.user.id !== before) {
      console.error('Anonymous password setup changed identity; refusing to continue');
      toast('Account upgrade could not be verified');
      return false;
    }
    accountUser = data.user;
    accountIsAnonymous = isAnonymousUser(data.user);
    clearAccountUpgrade(before);
    await enterApp();
    return true;
  } catch {
    if (generation === authGeneration && userId === before) {
      showAnonymousUpgradeScreen('set-password');
      setAuthMessage('Could not finish account setup. Check your connection and try again.');
    }
    return false;
  } finally {
    accountUpgradeBusy = false;
  }
}

function showAnonymousUpgradeScreen(requestedStage = null) {
  hideAndClearPrivateOverlays();
  $('#lock').classList.remove('hidden');
  $('#app').classList.add('hidden');
  $('#createAccountBtn').classList.add('hidden');
  $('#forgotPasswordBtn').classList.add('hidden');
  const upgrade = accountUpgradeFor(accountUser);
  const stage = requestedStage || (upgrade && upgrade.stage) || 'email';
  if (stage === 'awaiting-email') {
    $('.lock-sub').textContent = 'Open the verification link we sent. Your existing progress stays on this account.';
    configureAccountLock({ email: false, password: false, form: false });
    $('#checkVerificationBtn').classList.remove('hidden');
    $('#checkVerificationBtn').disabled = verificationRefreshBusy;
    setAuthMessage('Waiting for email verification. Return here after opening the link.', true);
    return;
  }
  if (stage === 'set-password') {
    $('.lock-sub').textContent = 'Email verified. Choose a password to finish protecting this account.';
    configureAccountLock({ email: false, password: true });
    $('#accountPassword').autocomplete = 'new-password';
    $('#accountPassword').value = '';
    $('#lockBtn').textContent = 'Save password';
    $('#lockForm').onsubmit = async e => {
      e.preventDefault();
      await finishAnonymousUpgrade($('#accountPassword').value);
    };
    return;
  }
  $('.lock-sub').textContent = 'Protect the progress already on this account without moving or replacing it.';
  configureAccountLock({ email: true, password: false });
  $('#lockBtn').textContent = 'Send verification email';
  $('#lockForm').onsubmit = async e => {
    e.preventDefault();
    await startAnonymousUpgrade($('#accountEmail').value);
  };
}

async function enterApp({ recoveryOwnerId = passwordRecoveryMode ? passwordRecoveryOwnerId : null,
                          recoveryAttempt = recoveryOwnerId ? passwordRecoveryAttempt : null } = {}) {
  const openingGeneration = authGeneration;
  if (sb) {
    // getSession reads the persisted session locally. getUser validates over
    // the network and would lock a previously signed-in traveller out offline.
    let data;
    try {
      const sessionResult = await sb.auth.getSession();
      if (sessionResult.error) throw sessionResult.error;
      data = sessionResult.data;
    } catch {
      if (openingGeneration !== authGeneration) return false;
      showStartupError();
      return false;
    }
    if (openingGeneration !== authGeneration) return false;
    if (recoveryAttempt !== null && recoveryAttempt !== passwordRecoveryAttempt) return false;
    accountUser = data && data.session ? data.session.user : null;
    if (!accountUser) {
      if (recoveryOwnerId) {
        passwordRecoveryMode = false; passwordRecoveryOwnerId = null;
        passwordRecoveryAttempt++;
      }
      showAccountLock(recoveryOwnerId
        ? 'That recovery session is missing or expired. Request a new recovery email.'
        : 'Sign in to continue.');
      return false;
    }
    if (recoveryOwnerId && (!passwordRecoveryMode || passwordRecoveryOwnerId !== recoveryOwnerId
        || accountUser.id !== recoveryOwnerId)) {
      passwordRecoveryMode = false; passwordRecoveryOwnerId = null;
      passwordRecoveryAttempt++;
      showAccountLock('That recovery session does not match this link. Request a new recovery email.');
      return false;
    }
    userId = accountUser ? accountUser.id : null;
    accountIsAnonymous = isAnonymousUser(accountUser);
    await bindLocalDataToUser();
    if (recoveryAttempt !== null && (recoveryAttempt !== passwordRecoveryAttempt
        || recoveryOwnerId !== passwordRecoveryOwnerId || recoveryOwnerId !== userId)) return false;
    if (!userId || userId !== accountUser.id) return false;
    if (recoveryOwnerId) return showPasswordRecoveryScreen();
    await loadGroups();
    if (!userId || userId !== accountUser.id) return false;
  }
  if (passwordRecoveryMode) return showPasswordRecoveryScreen();
  const upgrade = accountUpgradeFor(accountUser);
  if (upgrade) return showAnonymousUpgradeScreen(upgrade.stage);
  if (accountIsAnonymous) return showAnonymousUpgradeScreen();
  const enteringOwner = userId, enteringGeneration = authGeneration;
  $('#app').classList.add('hidden');
  try {
    const photoFiles = nativePhotoFiles();
    if (photoFiles && typeof photoFiles.prepare === 'function') await photoFiles.prepare(enteringOwner);
  } catch (error) {
    if (enteringOwner !== userId || enteringGeneration !== authGeneration) return false;
    console.warn('private photo storage preparation', error);
    showStartupError();
    return false;
  }
  if (enteringOwner !== userId || enteringGeneration !== authGeneration) return false;
  loadLocalTrips();
  const loadedPendingPhotos = await idbAll();
  if (enteringOwner !== userId || enteringGeneration !== authGeneration) return false;
  pendingPhotos = loadedPendingPhotos;
  for (const item of loadedPendingPhotos) {
    if (!item.owner_id) { item.owner_id = userId; await idbPut(item); }
  }
  if (enteringOwner !== userId || enteringGeneration !== authGeneration) return false;
  // Asked for before the first paint so the Reminders button in Me shows the
  // right label straight away rather than correcting itself a moment later.
  await notificationPermission();
  if (enteringOwner !== userId || enteringGeneration !== authGeneration) return false;
  /* Deliberately not awaited. Talking to the store means a network round trip
   * on a cold app, and none of the first screen depends on the answer - the
   * gems are locked until it says otherwise, which is the safe default. It
   * repaints when it lands.
   */
  Billing.init(userId).then(ok => {
    if (ok && enteringOwner === userId && enteringGeneration === authGeneration) renderAll();
  });
  renderAll();
  if (enteringOwner !== userId || enteringGeneration !== authGeneration) return false;
  $('#lock').classList.add('hidden');
  $('#app').classList.remove('hidden');
  openDeepLink();
  await pullProgress();
  if (enteringOwner !== userId || enteringGeneration !== authGeneration) return false;
  await pullPhotos();
  if (enteringOwner !== userId || enteringGeneration !== authGeneration) return false;
  await pullTrips();
  if (enteringOwner !== userId || enteringGeneration !== authGeneration) return false;
  renderAll();
  subscribeRealtime();
  startSyncTicker();
  wirePullToRefresh();
  flushOutbox();
  flushPhotoQueue();
  flushTrips();
  seasonalNudge();
  migrateLegacyPhotos();
  return true;
}

// A shared link lands directly on the adventure or trip it names.
/* Everything a link can ask the app to do.
 *
 * Takes the query rather than reading location.search, because on Android the
 * link never reaches location at all. Capacitor hands an incoming intent to
 * its plugins and does not navigate the WebView, so the address bar the app
 * does not have still says https://localhost/ and location.search is empty.
 * Web calls this with its own query; native calls it from appUrlOpen.
 */
function resolvePendingTripDeepLink(listComplete = false) {
  const pending = pendingTripDeepLink;
  if (!pending || !userId) return false;
  if (pending.owner && (pending.owner !== userId || pending.generation !== authGeneration)) {
    pendingTripDeepLink = null;
    return false;
  }
  if (!pending.owner) {
    pending.owner = userId;
    pending.generation = authGeneration;
  }
  if (trips.some(t => t.id === pending.id)) {
    pendingTripDeepLink = null;
    openTripSheet(pending.id);
    return true;
  }
  if (listComplete) pendingTripDeepLink = null;
  return false;
}

function tidyDeepLinkQuery() {
  if (!location.search) return;
  const state = browserNavigationEnabled() ? { wayfinderNav: nav } : null;
  history.replaceState(state, '', location.pathname);
}

function openDeepLink(search = location.search) {
  const q = new URLSearchParams(search);
  // An invite link. Never joined silently - a link can be forwarded, and
  // nobody should end up sharing their list with a stranger because they
  // tapped something in a group chat.
  const join = q.get('join');
  if (join && !sb) {
    // Tapping an invite and getting silence is indistinguishable from a
    // broken link. Say which it is.
    toast('Joining needs a connection — open this link again when you have one');
    return;
  }
  if (join) {
    (async () => {
      const clean = join.trim().toUpperCase();
      if (!/^[A-Z0-9]{6,32}$/.test(clean)) return toast('That invite link is not valid');
      if (confirm('Join the Wayfinder group from this invite?\n\nYour personal list stays yours. You will choose whether to share past completions.')) {
        await joinGroup(clean);
      }
    })();
    return;
  }

  // Long-press shortcuts from the home screen icon.
  const shortcut = q.get('shortcut');
  if (shortcut === 'random') { $('#randomBtn').click(); return; }
  if (shortcut === 'near')   { $('#hereBtn').click(); return; }
  if (shortcut === 'passport') {
    $('.tab[data-tab="tab-passport"]').click();
    return;
  }

  const a = q.get('a'), t = q.get('trip');
  if (a && ADV.some(x => x.id === +a)) openSheet(+a);
  else if (t && validAccountOwner(t)) {
    if (trips.some(x => x.id === t)) openTripSheet(t);
    else pendingTripDeepLink = {
      id: t, owner: userId || null, generation: userId ? authGeneration : null,
    };
  } else return;
  // Tidy the address so a refresh does not reopen it. Meaningless on native,
  // where there was never a query in the address to begin with.
  tidyDeepLinkQuery();
}

// ══════════════════════════════════════════════════════════════════════
//  Boot
// ══════════════════════════════════════════════════════════════════════
async function boot() {
  try {
    const authLinkMessage = consumeAuthLinkError();
    $('#lock').classList.add('hidden');
    const cfg = window.OAA_CONFIG || {};
    const configured = cfg.supabaseUrl && !/YOUR_/.test(cfg.supabaseUrl) &&
                       cfg.supabaseAnonKey && !/YOUR_/.test(cfg.supabaseAnonKey);

    if (configured && window.supabase) {
      sb = window.supabase.createClient(cfg.supabaseUrl, cfg.supabaseAnonKey, {
        auth: { persistSession: true, autoRefreshToken: true, storageKey: 'oaa.auth' },
      });
      sb.auth.onAuthStateChange((event, session) => {
        if (event === 'SIGNED_OUT') {
          void handleSignedOut();
          return;
        }
        if (event === 'PASSWORD_RECOVERY') {
          receivePasswordRecovery(session);
          return;
        } else if (userId && session && session.user && session.user.id !== userId) {
          authGeneration++;
          $('#app').classList.add('hidden');
          clearPrivateMemoryForAccountTransition();
          userId = session.user.id;
          location.reload();
          return;
        }
        if (event !== 'SIGNED_IN' && event !== 'USER_UPDATED') return;
        const upgrade = session && session.user ? accountUpgradeFor(session.user) : null;
        if (!upgrade || accountUpgradeBusy) return;
        // Run outside the auth callback: Supabase warns against awaiting another
        // auth method from inside it, and enterApp() asks auth.getSession().
        setTimeout(() => {
          if (upgrade || $('#app').classList.contains('hidden')) enterApp();
          else renderMe();
        }, 0);
      });
    }

    await loadAdventures();

    loadLocalProgress();
    buildFilterOptions();
    wireUI();
    wireAccountLock();
    accountUiReady = true;
    if (!await retryConfirmedLocalAccountCleanup()) {
      showStartupError();
      return false;
    }

    if (pendingPasswordRecovery) {
      const pending = pendingPasswordRecovery;
      pendingPasswordRecovery = null;
      if (pending.error || !pending.ownerId || pending.ownerId !== passwordRecoveryOwnerId) {
        showAccountLock('That recovery link is invalid or expired. Request a new one.');
        return false;
      }
      accountBootReady = true;
      return await enterApp({ recoveryOwnerId: pending.ownerId, recoveryAttempt: pending.attempt });
    }

    if (!sb) {
      showAccountLock('Account service is not configured. Wayfinder cannot create a recoverable account.');
      return;
    }

    const { data, error: sessionError } = await sb.auth.getSession();
    if (sessionError) throw sessionError;
    if (pendingPasswordRecovery) {
      const pending = pendingPasswordRecovery;
      pendingPasswordRecovery = null;
      accountBootReady = true;
      if (!pending.error && pending.ownerId === passwordRecoveryOwnerId) {
        return await enterApp({ recoveryOwnerId: pending.ownerId, recoveryAttempt: pending.attempt });
      }
      showAccountLock('That recovery link is invalid or expired. Request a new one.');
      return false;
    }
    accountBootReady = true;
    if (data && data.session) return await enterApp();

    // Anonymous sign-in remains available only as an explicitly enabled
    // compatibility path. New installs require a recoverable email/password
    // account; an existing persisted anonymous session is upgraded in place
    // from the Me tab so its user id and rows stay intact.
    if (cfg.allowAnonymous === true) {
      const { error } = await sb.auth.signInAnonymously();
      if (!error) return await enterApp();

      // An existing deployment may temporarily retain this compatibility mode,
      // but it must still show the recoverable-account screen if the server
      // cannot create the anonymous session. It never opens a fresh local-only
      // identity that cannot be recovered on another device.
      const offline = !navigator.onLine || !error.status
        || error.name === 'AuthRetryableFetchError';
      if (offline) {
        console.info('no connection at launch; account sign-in required:', error.message);
      }
      else console.info('anonymous sign-in unavailable; showing account sign-in:', error.message);
    }

    showAccountLock(authLinkMessage);
  } catch (error) {
    console.warn('Wayfinder startup failed:', error);
    showStartupError();
  }
}

function showStartupError() {
  $('#app').classList.add('hidden');
  $('#lock').classList.remove('hidden');
  $('.lock-sub').textContent = 'Wayfinder could not finish opening.';
  configureAccountLock({ email: false, password: false });
  $('#createAccountBtn').classList.add('hidden');
  $('#forgotPasswordBtn').classList.add('hidden');
  $('#lockBtn').disabled = false;
  $('#lockBtn').textContent = 'Try again';
  $('#lockForm').onsubmit = e => { e.preventDefault(); location.reload(); };
  setAuthMessage('Check your connection, then try again. Your saved progress has not been removed.');
}

addEventListener('DOMContentLoaded', boot);

/* The service worker is for the web build only.
 *
 * Inside the native shell every file is already on the device, so there is no
 * offline problem left to solve - and a worker that outlives an app update
 * will happily keep serving the version it cached, which is how a shipped fix
 * fails to reach anyone. Native is excluded on purpose.
 */
if ('serviceWorker' in navigator && !(window.Capacitor && window.Capacitor.isNativePlatform
                                      && window.Capacitor.isNativePlatform())) {
  addEventListener('load', () => navigator.serviceWorker.register('sw.js').catch(() => {}));
}
