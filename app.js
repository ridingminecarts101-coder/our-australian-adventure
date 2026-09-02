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

  sb.channel('photo-sync')
    .on('postgres_changes', { event: '*', schema: 'public', table: 'photos' }, payload => {
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
}

// ══════════════════════════════════════════════════════════════════════
//  Photos
// ══════════════════════════════════════════════════════════════════════
//  Pipeline for each picked photo:
//    1. read the real "date taken" out of the file's EXIF before we touch it
//    2. resize to something sane (phone originals are 3-5 MB; the free tier
//       gives us 1 GB, so full-size uploads would fill it in ~250 photos)
//    3. upload to private Storage, then record the row
//  If there's no signal, steps 2-3 go into an IndexedDB queue and run later.

const BUCKET = 'memories';
const MAX_EDGE = 1600;
const JPEG_QUALITY = 0.82;
const SIGNED_TTL = 7200;                       // 2 hours

let photos = [];                               // rows from public.photos
let pendingPhotos = [];                        // queued locally, not yet uploaded
const signedUrls = new Map();                  // storage_path -> { url, expires }
let uploading = 0;
let photoTargetId = null;                      // which adventure the picker is for
let lightbox = { list: [], index: 0 };

// ── Tiny IndexedDB wrapper for the upload queue ──────────────────────
function idb() {
  return new Promise((resolve, reject) => {
    const req = indexedDB.open('oaa-photos', 1);
    req.onupgradeneeded = () => {
      if (!req.result.objectStoreNames.contains('queue')) {
        req.result.createObjectStore('queue', { keyPath: 'id' });
      }
    };
    req.onsuccess = () => resolve(req.result);
    req.onerror = () => reject(req.error);
  });
}
async function idbAll() {
  try {
    const db = await idb();
    return await new Promise((res, rej) => {
      const r = db.transaction('queue').objectStore('queue').getAll();
      r.onsuccess = () => res(r.result || []);
      r.onerror = () => rej(r.error);
    });
  } catch { return []; }
}
async function idbPut(item) {
  try {
    const db = await idb();
    await new Promise((res, rej) => {
      const r = db.transaction('queue', 'readwrite').objectStore('queue').put(item);
      r.onsuccess = res; r.onerror = () => rej(r.error);
    });
  } catch { /* storage unavailable — the photo stays in memory only */ }
}
async function idbDelete(id) {
  try {
    const db = await idb();
    await new Promise((res, rej) => {
      const r = db.transaction('queue', 'readwrite').objectStore('queue').delete(id);
      r.onsuccess = res; r.onerror = () => rej(r.error);
    });
  } catch { /* nothing to do */ }
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
async function downscale(file) {
  let bitmap;
  try {
    // from-image applies the EXIF orientation flag, so photos aren't sideways
    bitmap = await createImageBitmap(file, { imageOrientation: 'from-image' });
  } catch {
    bitmap = await createImageBitmap(file);
  }
  const scale = Math.min(1, MAX_EDGE / Math.max(bitmap.width, bitmap.height));
  const w = Math.round(bitmap.width * scale);
  const h = Math.round(bitmap.height * scale);

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
  const list = [...files].filter(f => f.type.startsWith('image/'));
  if (!list.length) { toast('No images in that selection'); return; }

  uploading += list.length;
  renderPhotoStatus();

  for (const file of list) {
    try {
      const exif = await readExifDate(file);
      const r = row(adventureId);
      let takenAt, source;
      if (exif)                       { takenAt = exif;                          source = 'exif'; }
      else if (file.lastModified)     { takenAt = new Date(file.lastModified);   source = 'file'; }
      else if (r.completed_at)        { takenAt = new Date(r.completed_at);      source = 'completed'; }
      else                            { takenAt = new Date();                    source = 'upload'; }

      const { blob, width, height } = await downscale(file);
      const item = {
        id: (crypto.randomUUID ? crypto.randomUUID() : String(Date.now() + Math.random())),
        adventure_id: adventureId,
        blob, width, height, bytes: blob.size,
        taken_at: takenAt.toISOString(),
        taken_at_source: source,
        uploaded_by: who,
      };
      pendingPhotos.push(item);
      await idbPut(item);
      renderAll();
    } catch (err) {
      console.warn('photo failed', err);
      toast('Could not read that photo');
    } finally {
      uploading--;
      renderPhotoStatus();
    }
  }
  flushPhotoQueue();
}

async function flushPhotoQueue() {
  if (!sb || !online || flushPhotoQueue.busy) { renderPhotoStatus(); return; }
  if (!pendingPhotos.length) { renderPhotoStatus(); return; }
  flushPhotoQueue.busy = true;

  for (const item of [...pendingPhotos]) {
    try {
      const path = `${item.adventure_id}/${item.id}.jpg`;
      const up = await sb.storage.from(BUCKET)
        .upload(path, item.blob, { contentType: 'image/jpeg', upsert: true });
      if (up.error) throw up.error;

      const ins = await sb.from('photos').insert({
        adventure_id: item.adventure_id,
        storage_path: path,
        taken_at: item.taken_at,
        taken_at_source: item.taken_at_source,
        width: item.width, height: item.height, bytes: item.bytes,
        uploaded_by: item.uploaded_by || who,
      }).select().single();
      if (ins.error) throw ins.error;

      photos.push(ins.data);
      pendingPhotos = pendingPhotos.filter(p => p.id !== item.id);
      await idbDelete(item.id);
      renderAll();
    } catch (err) {
      console.warn('upload failed, will retry', err.message || err);
      break;                                    // stop on first failure; try again later
    }
  }
  flushPhotoQueue.busy = false;
  renderPhotoStatus();
}

async function pullPhotos() {
  if (!sb || !online) return;
  const { data, error } = await sb.from('photos').select('*').order('taken_at', { ascending: false });
  if (error) { console.warn('photo pull failed', error.message); return; }
  photos = data || [];
}

async function deletePhoto(photoId) {
  const p = photos.find(x => x.id === photoId);
  if (!p) return;
  if (!confirm('Delete this photo? It will disappear from both phones.')) return;
  try {
    await sb.storage.from(BUCKET).remove([p.storage_path]);
    const { error } = await sb.from('photos').delete().eq('id', photoId);
    if (error) throw error;
    photos = photos.filter(x => x.id !== photoId);
    signedUrls.delete(p.storage_path);
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
  const now = Date.now();
  const needed = [...new Set(paths)].filter(p => {
    const hit = signedUrls.get(p);
    return !hit || hit.expires < now + 60000;
  });
  if (!needed.length) return;

  const { data, error } = await sb.storage.from(BUCKET).createSignedUrls(needed, SIGNED_TTL);
  if (error) { console.warn('signing failed', error.message); return; }
  for (const d of data || []) {
    if (d.signedUrl) signedUrls.set(d.path, { url: d.signedUrl, expires: now + SIGNED_TTL * 1000 });
  }
}

function photoSrc(p) {
  if (p.pending) return p.objectUrl;
  const hit = signedUrls.get(p.storage_path);
  return hit ? hit.url : '';
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
  if (!objectUrls.has(item.id)) objectUrls.set(item.id, URL.createObjectURL(item.blob));
  return objectUrls.get(item.id);
}

function renderPhotoStatus() {
  const el = $('#photoStatus');
  if (!el) return;
  const queued = pendingPhotos.length;
  const s = queued === 1 ? '' : 's';
  let msg = '';
  if (uploading)              msg = `Processing ${uploading} photo${uploading === 1 ? '' : 's'}…`;
  else if (queued && !sb)     msg = `${queued} photo${s} saved on this phone — not connected to the shared album.`;
  else if (queued && !online) msg = `${queued} photo${s} saved on this phone — they'll upload when you have signal.`;
  else if (queued)            msg = `Uploading ${queued} photo${s}…`;
  el.textContent = msg;
  el.classList.toggle('show', !!msg);
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

let memoryGrouping = 'adventure';

function thumbHTML(p, i) {
  const src = photoSrc(p);
  return `<button class="thumb${p.pending ? ' pending' : ''}" data-photo="${esc(p.id)}" data-idx="${i}"
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
          <b>${esc(a.title)}</b>
          <div class="card-meta">${esc(a.place)} · ${esc(STATE_NAMES[a.state])}</div>
          <div class="badges">
            ${r.completed_by ? `<span class="badge">Ticked by ${esc(r.completed_by)}</span>` : ''}
            ${r.completed_at ? `<span class="badge">${fmtDate(r.completed_at)}</span>` : ''}
            ${r.rating ? `<span class="badge star">${'★'.repeat(r.rating)}</span>` : ''}
            ${ph.length ? `<span class="badge">📷 ${ph.length}</span>` : ''}
          </div>
          <p class="${r.memory ? '' : 'nomemory'}">${esc(r.memory || 'No memory written yet — tap to add one.')}</p>
        </div>
        ${ph.length ? `<div class="strip" data-group-key="adv-${a.id}">${ph.map((p, i) => thumbHTML(p, i)).join('')}</div>` : ''}
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
    el.innerHTML = `<div class="empty">No photos yet.<br>Open an adventure and add some under <b>Our memory of it</b>.</div>`;
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
        ${items.map((p, i) => thumbHTML(p, i)).join('')}
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
  $$('.thumb').forEach(btn => {
    const p = findPhoto(btn.dataset.photo);
    if (p && !p.pending && !photoSrc(p)) missing.push(p.storage_path);
  });
  if (!missing.length) return;
  await ensureSignedUrls(missing);
  $$('.thumb').forEach(btn => {
    const p = findPhoto(btn.dataset.photo);
    if (!p) return;
    const src = photoSrc(p);
    if (src && !btn.querySelector('img')) {
      btn.innerHTML = `<img src="${esc(src)}" alt="" loading="lazy">`;
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
async function openLightbox(photoId, groupKey) {
  const container = groupKey
    ? document.querySelector(`[data-group-key="${CSS.escape(groupKey)}"]`)
    : null;
  const ids = container ? $$('.thumb', container).map(b => b.dataset.photo) : [photoId];
  lightbox.list = ids.map(findPhoto).filter(Boolean);
  lightbox.index = Math.max(0, lightbox.list.findIndex(p => p.id === photoId));
  $('#lightbox').classList.remove('hidden');
  await showLightbox();
}

async function showLightbox() {
  const p = lightbox.list[lightbox.index];
  if (!p) return closeLightbox();
  if (!p.pending && !photoSrc(p)) await ensureSignedUrls([p.storage_path]);

  const a = ADV.find(x => x.id === p.adventure_id);
  const d = p.taken_at ? new Date(p.taken_at) : null;
  const when = d && !isNaN(d)
    ? d.toLocaleDateString('en-AU', { day: 'numeric', month: 'long', year: 'numeric' })
    : 'Date unknown';
  const SOURCE_NOTE = {
    exif: '',
    file: ' (from the file date)',
    completed: ' (the date you ticked it off)',
    upload: ' (upload date)',
  };

  $('#lbImg').src = photoSrc(p) || '';
  $('#lbTitle').textContent = a ? a.title : 'Photo';
  $('#lbSub').textContent =
    `${when}${SOURCE_NOTE[p.taken_at_source] || ''}` +
    (a ? ` · ${a.place}` : '') +
    (p.uploaded_by ? ` · added by ${p.uploaded_by}` : '') +
    (p.pending ? ' · waiting to upload' : '');
  $('#lbDelete').classList.toggle('hidden', !!p.pending);
  $('#lbDelete').dataset.photo = p.id;
  const many = lightbox.list.length > 1;
  $$('.lb-nav').forEach(b => b.classList.toggle('hidden', !many));
}

function closeLightbox() {
  $('#lightbox').classList.add('hidden');
  $('#lbImg').src = '';
  lightbox = { list: [], index: 0 };
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
    <div class="sheet-actions"><button class="btn-primary" data-act="saveMemory">Save memory</button></div>

    <h3>Photos${ph.length ? ` <span class="count">${ph.length}</span>` : ''}</h3>
    <div class="strip sheet-strip" data-group-key="adv-${a.id}">
      ${ph.map((p, i) => thumbHTML(p, i)).join('')}
      <button class="thumb add" data-act="addPhoto" aria-label="Add photos">
        <span>+</span><small>Add</small>
      </button>
    </div>
    <p class="photohint">${ph.length
      ? 'Tap a photo to see it full size.'
      : 'Photos are resized before uploading, and dated from the camera’s own timestamp.'}</p>`;

  hydrateThumbs();
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

  // Memories grouping
  $$('#groupChips .chip').forEach(c => c.onclick = () => {
    memoryGrouping = c.dataset.group;
    $$('#groupChips .chip').forEach(x => x.classList.toggle('on', x === c));
    renderMemories();
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

  // Photo picker
  $('#photoInput').addEventListener('change', async e => {
    const files = e.target.files;
    const target = photoTargetId;
    e.target.value = '';                        // so re-picking the same file fires again
    if (target != null && files && files.length) await addPhotos(target, files);
  });

  // Keyboard support for the lightbox
  addEventListener('keydown', e => {
    if ($('#lightbox').classList.contains('hidden')) return;
    const n = lightbox.list.length;
    if (e.key === 'Escape') closeLightbox();
    if (e.key === 'ArrowRight' && n) { lightbox.index = (lightbox.index + 1) % n; showLightbox(); }
    if (e.key === 'ArrowLeft'  && n) { lightbox.index = (lightbox.index - 1 + n) % n; showLightbox(); }
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
    if (act.dataset.act === 'addPhoto') {
      photoTargetId = openId;
      $('#photoInput').click();
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
  $('#refreshBtn').onclick = async () => {
    await pullProgress(); await pullPhotos(); signedUrls.clear(); renderAll(); toast('Refreshed');
  };
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
  addEventListener('online',  () => { online = true;  flushOutbox(); pullProgress(); pullPhotos().then(renderAll); flushPhotoQueue(); });
  addEventListener('offline', () => { online = false; refreshSyncBar(); });
  addEventListener('visibilitychange', () => {
    if (!document.hidden) { flushOutbox(); pullProgress(); pullPhotos().then(renderAll); flushPhotoQueue(); }
  });
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
  pendingPhotos = await idbAll();
  renderAll();
  await pullProgress();
  await pullPhotos();
  renderAll();
  subscribeRealtime();
  flushOutbox();
  flushPhotoQueue();
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
