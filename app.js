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

// ── Constants ────────────────────────────────────────────────────────
const LS = {
  progress: 'oaa.progress.v1',
  outbox:   'oaa.outbox.v1',
  who:      'oaa.who.v1',
  adv:      'oaa.adventures.v1',
  trips:    'oaa.trips.v1',
  group:    'oaa.group.v1',
  notify:   'oaa.notify.v1',
  notifyLast: 'oaa.notifylast.v1',
  tripOutbox: 'oaa.tripoutbox.v1',
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
let realtimeStatus = 'not started';
let openId = null;

const filters = { quick: 'all', q: '', st: 'All', cat: 'All', diff: 5, cost: 4, dog: 'All' };

// Where we are in world -> continent -> country -> region -> adventures.
let nav = { level: 'world', continent: null, country: null, admin1: null };

const DOG_LABEL = {
  yes:   'Dogs welcome',
  no:    'No dogs',
  check: 'Check first',
};

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
// Australian entries store a state code; everywhere else admin1 is already a name.
function regionName(a) { return STATE_NAMES[a.admin1] || a.admin1; }
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
function countOf(pred) { return ADV.filter(pred).length; }
function doneOf(pred)  { return ADV.filter(a => pred(a) && isDone(a.id)).length; }
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
      ...ownership(),
    };
    const { error } = await sb.from('progress')
      .upsert(payload, { onConflict: userId ? 'adventure_id,user_id' : 'adventure_id' });
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

async function resubscribeRealtime() {
  if (!sb) return;
  try { await sb.removeAllChannels(); } catch { /* nothing to remove */ }
  realtimeOk = false;
  realtimeStatus = 'reconnecting';
  subscribeRealtime();
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
    .subscribe((status, err) => {
      realtimeOk = status === 'SUBSCRIBED';
      realtimeStatus = status + (err ? ` (${err.message})` : '');
      if (err) console.warn('realtime', status, err);
      refreshSyncBar();
      renderMe();
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

  sb.channel('trip-sync')
    .on('postgres_changes', { event: '*', schema: 'public', table: 'trips' }, payload => {
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
      console.warn('photo failed', file.name, file.type, err);
      toast(err && err.message ? err.message : 'Could not read that photo');
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
        ...ownership(),
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
      continent: continentAt(lat, lon),
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
  return `${location.origin}${location.pathname}?${new URLSearchParams(params)}`;
}

async function share(payload, fallbackText) {
  try {
    if (navigator.share) {
      // url is passed as its own field rather than pasted into the body, so
      // iOS renders a link preview instead of a bare address mid-sentence.
      await navigator.share(payload);
    } else {
      await navigator.clipboard.writeText(fallbackText);
      toast('Copied to the clipboard');
    }
  } catch (err) {
    if (err && err.name !== 'AbortError') toast('Could not share that');
  }
}

async function shareAdventure(id) {
  const a = ADV.find(x => x.id === id);
  if (!a) return;
  const url = linkTo({ a: id });
  const lines = [
    a.title,
    `${a.place} · ${regionName(a)} · ${countryName(a.country)}`,
    '',
    a.description,
    '',
    `${a.category} · ${DIFF_LABEL[a.difficulty]} · ${COST_LABEL[a.cost]} · best ${a.season}`,
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
    lines.push(`${i + 1}. ${a.title}`);
    lines.push(`   ${a.place} · ${countryName(a.country)}`);
  });
  const text = lines.join('\n');
  const url = linkTo({ trip: t.id });
  await share({ title: `${t.name} — Wayfinder`, text, url }, `${text}\n\n${url}`);
}

// ── Reminders ────────────────────────────────────────────────────────
// Deliberately modest: one opt-in, one seasonal nudge. An app that pesters
// gets its notifications switched off within a week.
function notificationsSupported() {
  return typeof Notification !== 'undefined';
}

async function showNotification(title, body, tag) {
  const opts = { body, icon: 'icons/icon-192.png', badge: 'icons/icon-192.png', tag };
  try {
    const reg = await navigator.serviceWorker?.getRegistration();
    if (reg && reg.showNotification) { await reg.showNotification(title, opts); return true; }
  } catch { /* fall through */ }
  try { new Notification(title, opts); return true; } catch { return false; }
}

// The real nudge can be months away, so make it possible to see one now.
async function previewReminder() {
  if (!notificationsSupported() || Notification.permission !== 'granted') {
    return toast('Turn reminders on first');
  }
  const pool = ADV.filter(a => row(a.id).shortlisted && !isDone(a.id));
  const pick = (pool.length ? pool : ADV.filter(a => a.hidden_gem))
    [Math.floor(Math.random() * (pool.length || ADV.filter(a => a.hidden_gem).length))];
  if (!pick) return toast('Nothing to preview');
  const ok = await showNotification('In season now',
    `${pick.title} — ${pick.place}. Best ${pick.season}.`, 'wayfinder-preview');
  toast(ok ? (pool.length ? 'Sent' : 'Sent — that was a sample, shortlist things for real ones')
           : 'This device would not show it');
}

async function toggleNotifications() {
  if (!notificationsSupported()) return toast('This device does not support reminders');
  if (Notification.permission === 'granted') {
    writeLS(LS.notify, !readLS(LS.notify, false));
    renderMe();
    toast(readLS(LS.notify, false) ? 'Reminders on' : 'Reminders off');
    return;
  }
  const res = await Notification.requestPermission();
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
function seasonalNudge() {
  if (!readLS(LS.notify, false) || !notificationsSupported()) return;
  if (Notification.permission !== 'granted') return;
  const last = readLS(LS.notifyLast, 0);
  if (Date.now() - last < 7 * 24 * 3600 * 1000) return;

  const MON = ['Jan','Feb','Mar','Apr','May','Jun','Jul','Aug','Sep','Oct','Nov','Dec'];
  const now = MON[new Date().getMonth()];
  const due = ADV.filter(a =>
    row(a.id).shortlisted && !isDone(a.id) && a.season && a.season.includes(now));
  if (!due.length) return;

  const pick = due[Math.floor(Math.random() * due.length)];
  showNotification('In season now',
    `${pick.title} — ${pick.place}. Best ${pick.season}.`, 'wayfinder-season');
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

const CODE_ALPHABET = 'ABCDEFGHJKLMNPQRSTUVWXYZ23456789';   // no I/O/0/1

function makeJoinCode() {
  let out = '';
  const buf = new Uint8Array(6);
  (crypto.getRandomValues ? crypto : { getRandomValues: a => a.forEach((_, i) => a[i] = Math.random() * 256) })
    .getRandomValues(buf);
  for (const b of buf) out += CODE_ALPHABET[b % CODE_ALPHABET.length];
  return out;
}

// Stamped onto every row we write, so RLS can decide who may see it.
function ownership() {
  return { user_id: userId, group_id: activeGroupId };
}

async function loadGroups() {
  if (!sb || !online || !userId) return;
  const { data, error } = await sb
    .from('group_members')
    .select('group_id, display_name, groups(id, name, join_code)')
    .eq('user_id', userId);
  if (error) {
    // The tables may simply not exist yet - that is a valid state, not a fault.
    if (!/does not exist|schema cache/i.test(error.message)) console.warn('groups', error.message);
    myGroups = [];
    return;
  }
  myGroups = (data || []).map(r => r.groups).filter(Boolean);
  const saved = localStorage.getItem(LS.group);
  activeGroupId = myGroups.some(g => g.id === saved) ? saved
                : (myGroups[0] ? myGroups[0].id : null);
  if (activeGroupId) localStorage.setItem(LS.group, activeGroupId);
}

async function createGroup(name) {
  if (!sb || !userId) return toast('Not connected');
  const code = makeJoinCode();
  const { data, error } = await sb.from('groups')
    .insert({ name, join_code: code, created_by: userId }).select().single();
  if (error) { toast('Could not create the group'); console.warn(error); return; }
  const join = await sb.from('group_members')
    .insert({ group_id: data.id, user_id: userId, display_name: who });
  if (join.error) { toast('Group made, but joining it failed'); console.warn(join.error); return; }

  activeGroupId = data.id;
  localStorage.setItem(LS.group, activeGroupId);
  await loadGroups();
  // Everything already on this phone joins the group, otherwise the other
  // person sees an empty list on day one.
  await adoptExistingRowsIntoGroup();
  renderMe();
  toast(`Share the code ${code}`);
}

async function joinGroup(code) {
  if (!sb || !userId) return toast('Not connected');
  const clean = code.trim().toUpperCase();
  const { data, error } = await sb.from('groups')
    .select('id, name').eq('join_code', clean).maybeSingle();
  if (error || !data) { toast('No group with that code'); return; }

  const join = await sb.from('group_members')
    .insert({ group_id: data.id, user_id: userId, display_name: who });
  if (join.error && !/duplicate|unique/i.test(join.error.message)) {
    toast('Could not join'); console.warn(join.error); return;
  }
  activeGroupId = data.id;
  localStorage.setItem(LS.group, activeGroupId);
  await loadGroups();
  await pullProgress(); await pullPhotos(); await pullTrips();
  renderAll();
  toast(`Joined ${data.name}`);
}

async function leaveGroup(id) {
  if (!sb || !userId) return;
  const g = myGroups.find(x => x.id === id);
  if (!confirm(`Leave ${g ? g.name : 'this group'}? Your own ticks stay with you; theirs stop showing.`)) return;
  await sb.from('group_members').delete().eq('group_id', id).eq('user_id', userId);
  if (activeGroupId === id) { activeGroupId = null; localStorage.removeItem(LS.group); }
  await loadGroups();
  await pullProgress(); await pullPhotos(); await pullTrips();
  renderAll();
}

// Puts rows this user already owns into the active group.
async function adoptExistingRowsIntoGroup() {
  if (!sb || !userId || !activeGroupId) return;
  for (const table of ['progress', 'photos', 'trips']) {
    const { error } = await sb.from(table)
      .update({ group_id: activeGroupId })
      .eq('user_id', userId)
      .is('group_id', null);
    if (error) console.warn(`adopting ${table}`, error.message);
  }
}

function renderMe_groups() {
  const el = $('#groupPanel');
  if (!el) return;
  if (!sb) { el.innerHTML = '<p class="muted">Not connected, so sharing is unavailable.</p>'; return; }

  const active = myGroups.find(g => g.id === activeGroupId);
  el.innerHTML = `
    ${active ? `
      <p>Sharing with <strong>${esc(active.name)}</strong>.</p>
      <p class="fineprint">Join code <code class="joincode">${esc(active.join_code)}</code> — read this
         out to whoever should see the same list.</p>
      <button class="btn-ghost danger" data-groupact="leave" data-id="${esc(active.id)}">Leave this group</button>
    ` : `
      <p class="muted">This list is yours alone at the moment.</p>
      <button class="btn-ghost" data-groupact="create">Create a group</button>
      <button class="btn-ghost" data-groupact="join">Join with a code</button>
    `}
    ${myGroups.length > 1 ? `<p class="fineprint">You belong to ${myGroups.length} groups; new ticks go into the one above.</p>` : ''}`;
}

// ── Deleting the account, which Apple requires to be possible in-app ──
async function deleteAccount() {
  if (!sb || !userId) return;
  const typed = prompt('This deletes your account, every tick, every photo and every trip. '
                     + 'It cannot be undone.\n\nType DELETE to confirm.');
  if (typed !== 'DELETE') { toast('Cancelled'); return; }

  toast('Deleting…');
  try {
    // Storage objects are not covered by the database cascade, so clear them first.
    const mine = photos.filter(p => p.user_id === userId).map(p => p.storage_path);
    if (mine.length) await sb.storage.from(BUCKET).remove(mine);

    const { error } = await sb.rpc('delete_my_account');
    if (error) throw error;

    localStorage.clear();
    try {
      const db = await idb();
      db.transaction('queue', 'readwrite').objectStore('queue').clear();
    } catch { /* nothing queued */ }
    await sb.auth.signOut();
    location.reload();
  } catch (err) {
    console.warn(err);
    toast('Could not delete the account — try again, or ask for help');
  }
}

// ══════════════════════════════════════════════════════════════════════
//  Navigation: world -> continent -> country -> region -> adventures
// ══════════════════════════════════════════════════════════════════════
function goTo(level, opts = {}) {
  nav = { level, continent: null, country: null, admin1: null, ...opts };
  // Region filters belong to the place you drilled into, not to the place itself.
  filters.st = 'All';
  window.scrollTo(0, 0);
  buildFilterOptions();
  renderPlaces();
  renderList();
}

function placeRow({ label, sub, count, done, flag, swatch, onClick }) {
  const pct = count ? Math.round((done / count) * 100) : 0;
  return `<button class="placerow" data-go='${esc(JSON.stringify(onClick))}'>
    <div class="placerow-main">
      <div class="placerow-top">
        <span class="placerow-label">${swatch ? `<i class="swatch" style="background:${esc(swatch)}"></i>` : ''}${flag ? flag + ' ' : ''}${esc(label)}</span>
        <span class="placerow-count">${count ? `${done} / ${count}` : 'Coming soon'}</span>
      </div>
      ${sub ? `<div class="placerow-sub">${esc(sub)}</div>` : ''}
      ${count ? `<div class="minibar"><i style="width:${pct}%"></i></div>` : ''}
    </div>
    ${count ? '<span class="placerow-chev">›</span>' : ''}
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
    const a = ADV.find(x => x.admin1 === nav.admin1);
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

  if (nav.level === 'world') {
    const counts = {};
    for (const name of CONTINENT_ORDER) counts[name] = countOf(a => a.continent === name);
    drawWorldMap($('#worldMap'), counts, null);

    // Most content first, so the list reorders itself as regions fill in.
    // Empty continents fall to the bottom in their declared order.
    const ordered = [...CONTINENT_ORDER].sort((a, b) => (counts[b] || 0) - (counts[a] || 0));

    $('#continentList').innerHTML = ordered.map(name => {
      const count = counts[name];
      const countries = new Set(ADV.filter(a => a.continent === name).map(a => a.country)).size;
      return placeRow({
        label: name,
        swatch: count ? CONTINENT_COLOUR[name] : null,
        sub: count ? `${countries} ${countries === 1 ? 'country' : 'countries'}` : 'Not mapped yet — tell us where to go next',
        count, done: doneOf(a => a.continent === name),
        onClick: count ? { level: 'continent', continent: name } : null,
      });
    }).join('');
    return;
  }

  if (nav.level === 'continent' || nav.level === 'islands') {
    const islandsOnly = nav.level === 'islands';
    const inCont = a => a.continent === nav.continent;
    const all = [...new Set(ADV.filter(inCont).map(a => a.country))];
    const mainland = all.filter(c => !ISLAND_GROUP.has(c))
      .sort((x, y) => countryName(x).localeCompare(countryName(y)));
    const islands = all.filter(c => ISLAND_GROUP.has(c))
      .sort((x, y) => countryName(x).localeCompare(countryName(y)));
    const codes = islandsOnly ? islands : mainland;

    const countryRow = code => {
      const inC = a => inCont(a) && a.country === code;
      const regions = new Set(ADV.filter(inC).map(a => a.admin1)).size;
      return placeRow({
        label: countryName(code), flag: countryFlag(code),
        sub: `${regions} ${regions === 1 ? 'region' : 'regions'}`,
        count: countOf(inC), done: doneOf(inC),
        onClick: { level: 'country', continent: nav.continent, country: code },
      });
    };

    $('#crumb').innerHTML = crumbHTML();
    if (islandsOnly) {
      const inIslands = a => inCont(a) && ISLAND_GROUP.has(a.country);
      $('#placeTitle').textContent = '🏝️ Island nations';
      $('#placeSub').textContent =
        `${countOf(inIslands)} adventures across ${islands.length} nations and territories`;
      $('#placeList').innerHTML = codes.map(countryRow).join('');
      return;
    }

    const inIslands = a => inCont(a) && ISLAND_GROUP.has(a.country);
    const islandCount = countOf(inIslands);
    $('#placeTitle').textContent = nav.continent;
    $('#placeSub').textContent =
      `${countOf(inCont)} adventures across ${all.length} ${all.length === 1 ? 'country' : 'countries'}`;
    $('#placeList').innerHTML = codes.map(countryRow).join('') +
      (islandCount ? placeRow({
        label: 'Island nations', flag: '🏝️',
        sub: islands.map(countryName).slice(0, 4).join(', ') +
             (islands.length > 4 ? ` and ${islands.length - 4} more` : ''),
        count: islandCount, done: doneOf(inIslands),
        onClick: { level: 'islands', continent: nav.continent },
      }) : '');
    return;
  }

  if (nav.level === 'country') {
    const inC = a => a.country === nav.country;
    const regions = [...new Set(ADV.filter(inC).map(a => a.admin1))];
    $('#crumb').innerHTML = crumbHTML();
    $('#placeTitle').textContent = countryFlag(nav.country) + ' ' + countryName(nav.country);
    $('#placeSub').textContent = `${countOf(inC)} adventures`;

    const rows = regions.map(code => {
      const inR = a => inC(a) && a.admin1 === code;
      const sample = ADV.find(inR);
      return {
        label: regionName(sample), code,
        count: countOf(inR), done: doneOf(inR),
      };
    }).sort((a, b) => a.label.localeCompare(b.label));

    $('#placeList').innerHTML =
      placeRow({
        label: `Everything in ${countryName(nav.country)}`,
        sub: 'Skip the regions and see the lot',
        count: countOf(inC), done: doneOf(inC),
        onClick: { level: 'adventures', continent: nav.continent, country: nav.country },
      }) +
      rows.map(r => placeRow({
        label: r.label, count: r.count, done: r.done,
        onClick: { level: 'adventures', continent: nav.continent, country: nav.country, admin1: r.code },
      })).join('');
    return;
  }

  $('#crumbList').innerHTML = crumbHTML();
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
    if (nav.continent && a.continent !== nav.continent) return false;
    if (nav.country   && a.country   !== nav.country) return false;
    if (nav.admin1    && a.admin1    !== nav.admin1) return false;
    if (filters.st  !== 'All' && a.admin1 !== filters.st) return false;
    if (filters.cat !== 'All' && a.category !== filters.cat) return false;
    if (filters.dog !== 'All' && a.dog_friendly !== filters.dog) return false;
    if (a.difficulty > filters.diff) return false;
    if (a.cost > filters.cost) return false;
    if (q) {
      const hay = `${a.title} ${a.place} ${a.region} ${regionName(a)} ${countryName(a.country)} ${a.category} ${a.description}`.toLowerCase();
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
      <div class="card-meta">${esc(metaLine(a))}</div>
      <div class="badges">
        <span class="badge">${esc(a.category)}</span>
        <span class="badge">${'●'.repeat(a.difficulty)}${'○'.repeat(5 - a.difficulty)}</span>
        <span class="badge">${a.cost === 0 ? 'Free' : '$'.repeat(a.cost)}</span>
        ${a.dog_friendly === 'yes' ? '<span class="badge dog">🐾 Dogs</span>' : ''}
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

// ══════════════════════════════════════════════════════════════════════
//  Passport
// ══════════════════════════════════════════════════════════════════════
function renderPassport() {
  const visited = new Set();
  const continents = new Set();
  for (const a of ADV) {
    if (!isDone(a.id)) continue;
    visited.add(a.country);
    continents.add(a.continent);
  }

  // The eyebrow already says ADVENTURE PASSPORT, so this line is the holder,
  // the way a real passport carries a name.
  $('#passportName').textContent = who || 'Traveller';

  $('#passportTotals').innerHTML = `
    <div class="ptotal"><b>${visited.size}</b><span>stamps</span></div>
    <div class="ptotal"><b>${continents.size}</b><span>continents</span></div>
    <div class="ptotal"><b>${doneCount()}</b><span>adventures</span></div>`;

  // A country is stamped once, on the first thing you tick there. The date is
  // derived from the earliest completion rather than stored separately, so
  // un-ticking that one simply moves the stamp to the next earliest.
  const rows = [...new Set(ADV.map(a => a.country))].map(code => {
    const inC = a => a.country === code;
    const times = ADV.filter(a => inC(a) && isDone(a.id))
      .map(a => row(a.id).completed_at)
      .filter(Boolean)
      .map(t => new Date(t))
      .filter(d => !isNaN(d));
    const stampedAt = times.length ? new Date(Math.min(...times)) : null;
    return {
      code,
      total: countOf(inC),
      done: doneOf(inC),
      stampedAt,
      // Completed the country outright - a real passport would not mark this,
      // but it is the thing people actually want to see.
      complete: countOf(inC) > 0 && doneOf(inC) === countOf(inC),
    };
  });

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
    const total = countOf(inC), done = doneOf(inC);
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
  trips = trips.filter(t => t.id !== id);
  saveLocalTrips();
  if (sb && online) sb.from('trips').delete().eq('id', id).then(({ error }) => {
    if (error) console.warn('trip delete failed', error.message);
  });
  closeTripSheet();
  renderTrips();
}

function queueTripSync(trip) {
  const q = readLS(LS.tripOutbox, []).filter(t => t.id !== trip.id);
  q.push(trip);
  writeLS(LS.tripOutbox, q);
  flushTrips();
}

async function flushTrips() {
  if (!sb || !online) return;
  const q = readLS(LS.tripOutbox, []);
  if (!q.length) return;
  const left = [];
  for (const t of q) {
    const { error } = await sb.from('trips').upsert({
      id: t.id, name: t.name, starts_on: t.starts_on || null, ends_on: t.ends_on || null,
      adventure_ids: t.adventure_ids || [], notes: t.notes || null,
      created_by: t.created_by || who,
      ...ownership(),
    }, { onConflict: 'id' });
    if (error) { left.push(t); console.warn('trip sync failed', error.message); }
  }
  writeLS(LS.tripOutbox, left);
}

async function pullTrips() {
  if (!sb || !online) return;
  const { data, error } = await sb.from('trips').select('*').order('created_at');
  if (error) { console.warn('trip pull failed', error.message); return; }
  const pending = new Set(readLS(LS.tripOutbox, []).map(t => t.id));
  const byId = new Map(trips.map(t => [t.id, t]));
  for (const t of data || []) if (!pending.has(t.id)) byId.set(t.id, t);
  trips = [...byId.values()];
  saveLocalTrips();
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
  $('#tripSheet').classList.remove('hidden');
}
function closeTripSheet() {
  openTripId = null;
  $('#tripSheet').classList.add('hidden');
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
            <div class="card-title">${esc(a.title)}</div>
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
  t.starts_on = $('#tripStart').value || null;
  t.ends_on = $('#tripEnd').value || null;
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
          <div class="card-meta">${esc(a.place)} · ${esc(regionName(a))}</div>
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
  ['🏅', 'Serious About It', 'Complete 250 adventures',                        d => d.done >= 250],
  ['🌐', 'Half the World',   () => `Complete half of all ${ADV.length}`,        d => d.done >= ADV.length / 2],
  ['👑', 'The Lot',          () => `Complete all ${ADV.length} adventures`,     d => d.done >= ADV.length],
  ['💎', 'Gem Hunters',      'Find 25 hidden gems',                            d => d.gems >= 25],
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
  d.disneyTotal = ADV.filter(a => (a.tags || []).includes('disney')).length;
  return d;
}

function renderMe() {
  const d = achievementData();
  const rated = ADV.map(a => row(a.id).rating).filter(Boolean);
  const avg = rated.length ? (rated.reduce((s, n) => s + n, 0) / rated.length).toFixed(1) : '—';
  const shortlisted = [...progress.values()].filter(r => r.shortlisted && !r.completed).length;
  // Whoever has actually ticked things, rather than two hardcoded names.
  const byPerson = new Map();
  for (const r of progress.values()) {
    if (!r.completed) continue;
    const name = r.completed_by || who || 'You';
    byPerson.set(name, (byPerson.get(name) || 0) + 1);
  }
  const people = [...byPerson.entries()].sort((a, b) => b[1] - a[1]).slice(0, 4);

  $('#usStats').innerHTML = `
    <div class="stat"><b>${d.done}</b><span>adventures done</span></div>
    <div class="stat"><b>${ADV.length - d.done}</b><span>still to go</span></div>
    <div class="stat"><b>${d.countries}</b><span>countries visited</span></div>
    <div class="stat"><b>${d.gems}</b><span>hidden gems found</span></div>
    <div class="stat"><b>${avg}</b><span>average rating</span></div>
    <div class="stat"><b>${shortlisted}</b><span>on the shortlist</span></div>
    ${activeGroupId && people.length > 1
      ? people.map(([name, n]) =>
          `<div class="stat"><b>${n}</b><span>ticked by ${esc(name)}</span></div>`).join('')
      : ''}`;

  $('#achList').innerHTML = ACHIEVEMENTS.map(([icon, name, desc, test]) =>
    `<div class="ach ${test(d) ? '' : 'locked'}">
       <span class="ach-icon">${icon}</span>
       <div><b>${esc(name)}</b><span>${esc(typeof desc === 'function' ? desc() : desc)}</span></div>
     </div>`).join('');

  $('#whoLabel').textContent = who || 'You';
  const nb = $('#notifyBtn');
  if (nb) {
    nb.textContent = readLS(LS.notify, false) && notificationsSupported()
      && Notification.permission === 'granted'
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

  $('#sheetBody').innerHTML = `
    <h2>${esc(a.title)}</h2>
    <div class="sheet-place">${esc([a.place, a.region, regionName(a)].filter((v, i, arr) => v && arr.indexOf(v) === i).join(' · '))} · ${countryFlag(a.country)} ${esc(countryName(a.country))}</div>
    ${a.hidden_gem ? '<span class="badge gem">💎 Hidden gem</span>' : ''}
    <p class="sheet-desc">${esc(a.description)}</p>

    <div class="factgrid">
      <div class="fact"><b>Category</b><span>${esc(a.category)}</span></div>
      <div class="fact"><b>Effort</b><span>${esc(DIFF_LABEL[a.difficulty])}</span></div>
      <div class="fact"><b>Rough cost</b><span>${esc(COST_LABEL[a.cost])}</span></div>
      <div class="fact"><b>Time needed</b><span>${esc(a.duration)}</span></div>
      <div class="fact"><b>Best time</b><span>${esc(a.season)}</span></div>
      <div class="fact"><b>Dogs</b><span>${esc(DOG_LABEL[a.dog_friendly])}</span></div>
    </div>

    ${r.completed && r.completed_by ? `<div class="donenote">Ticked off by ${esc(r.completed_by)}${r.completed_at ? ' on ' + fmtDate(r.completed_at) : ''}.</div>` : ''}

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
    </div>

    <h3>Add to a trip</h3>
    ${renderTripPicker(a.id)}

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
      <button class="thumb add" data-act="takePhoto" aria-label="Take a photo">
        <span>📷</span><small>Camera</small>
      </button>
      <button class="thumb add" data-act="addPhoto" aria-label="Add from library">
        <span>+</span><small>Library</small>
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
  const regions = [...new Set(ADV.filter(a =>
      (!nav.continent || a.continent === nav.continent) &&
      (!nav.country   || a.country   === nav.country)).map(a => a.admin1))];
  $('#fState').innerHTML = opt('All', 'All regions') +
    regions.map(code => [code, regionName(ADV.find(a => a.admin1 === code))])
           .sort((a, b) => a[1].localeCompare(b[1]))
           .map(([k, v]) => opt(k, v)).join('');
  $('#fDog').innerHTML = opt('All', 'Any') +
    ['yes', 'check', 'no'].map(k => opt(k, DOG_LABEL[k])).join('');
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
  $('#fDog').onchange   = e => { filters.dog = e.target.value; renderList(); };
  $('#clearFilters').onclick = () => {
    Object.assign(filters, { quick: 'all', q: '', st: 'All', cat: 'All', diff: 5, cost: 4, dog: 'All' });
    $('#search').value = ''; $('#fState').value = 'All'; $('#fCat').value = 'All';
    $('#fDiff').value = '5'; $('#fCost').value = '4'; $('#fDog').value = 'All';
    $$('#quickChips .chip').forEach((x, i) => x.classList.toggle('on', i === 0));
    renderList();
  };

  // Memories grouping
  $$('#groupChips .chip').forEach(c => c.onclick = () => {
    memoryGrouping = c.dataset.group;
    $$('#groupChips .chip').forEach(x => x.classList.toggle('on', x === c));
    renderMemories();
  });

  // Place rows and breadcrumbs
  document.body.addEventListener('click', e => {
    const go = e.target.closest('[data-go]');
    if (!go) return;
    let target;
    try { target = JSON.parse(go.dataset.go); } catch { return; }
    if (target) goTo(target.level, target);
    else toast('Nothing here yet — that continent is on the list');
  });

  // The world map
  const map = $('#worldMap');
  map.addEventListener('click', e => {
    const hit = continentFromPoint(map, e.clientX, e.clientY);
    if (!hit) return;
    if (countOf(a => a.continent === hit)) goTo('continent', { continent: hit });
    else toast(`No ${hit} adventures yet`);
  });
  addEventListener('resize', () => { if (nav.level === 'world') renderPlaces(); });

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
  $('#randomBtn').onclick = () => {
    const pool = filtered().filter(a => !isDone(a.id));
    if (!pool.length) return toast('Nothing left matching those filters!');
    openSheet(pool[Math.floor(Math.random() * pool.length)].id);
  };

  // Settings
  $('#switchWho').onclick = () => {
    const name = prompt('What should your ticks be labelled as?', who || '');
    if (name === null) return;
    who = name.trim() || null;
    if (who) localStorage.setItem(LS.who, who); else localStorage.removeItem(LS.who);
    renderAll();
  };
  $('#hereBtn').onclick = jumpToHere;
  $('#notifyBtn').onclick = toggleNotifications;
  $('#previewNotifyBtn').onclick = previewReminder;
  $('#deleteAccountBtn').onclick = deleteAccount;

  $('#cameraInput').addEventListener('change', async e => {
    const files = e.target.files, target = photoTargetId;
    e.target.value = '';
    if (target != null && files && files.length) await addPhotos(target, files);
  });

  $('#groupPanel').addEventListener('click', async e => {
    const b = e.target.closest('[data-groupact]');
    if (!b) return;
    if (b.dataset.groupact === 'create') {
      const name = prompt('Name this group', 'Our list');
      if (name && name.trim()) await createGroup(name.trim());
    }
    if (b.dataset.groupact === 'join') {
      const code = prompt('Enter the six-character join code');
      if (code && code.trim()) await joinGroup(code);
    }
    if (b.dataset.groupact === 'leave') await leaveGroup(b.dataset.id);
  });

  $('#refreshBtn').onclick = async () => {
    await pullProgress(); await pullPhotos(); signedUrls.clear(); renderAll(); toast('Refreshed');
  };
  $('#signOutBtn').onclick = async () => {
    if (!confirm('Sign this phone out? Your shared progress stays safe on the server.')) return;
    if (sb) await sb.auth.signOut();
    localStorage.removeItem(LS.progress);
    location.reload();
  };

  // Connectivity
  addEventListener('online',  () => { online = true;  flushOutbox(); pullProgress(); pullPhotos().then(renderAll); flushPhotoQueue(); flushTrips(); });
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
  if (sb) {
    const { data } = await sb.auth.getUser();
    userId = data && data.user ? data.user.id : null;
    await loadGroups();
  }
  loadLocalTrips();
  pendingPhotos = await idbAll();
  renderAll();
  openDeepLink();
  await pullProgress();
  await pullPhotos();
  await pullTrips();
  renderAll();
  subscribeRealtime();
  flushOutbox();
  flushPhotoQueue();
  flushTrips();
  seasonalNudge();
}

// A shared link lands directly on the adventure or trip it names.
function openDeepLink() {
  const q = new URLSearchParams(location.search);
  const a = q.get('a'), t = q.get('trip');
  if (a && ADV.some(x => x.id === +a)) openSheet(+a);
  else if (t && trips.some(x => x.id === t)) openTripSheet(t);
  else return;
  history.replaceState(null, '', location.pathname);
}

// ══════════════════════════════════════════════════════════════════════
//  Boot
// ══════════════════════════════════════════════════════════════════════
async function boot() {
  $('#lock').classList.add('hidden');
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

  if (!sb) return enterApp();                  // no backend configured — local only

  const { data: { session } } = await sb.auth.getSession();
  if (session) return enterApp();

  // Anonymous first: if the project allows anonymous sign-ins, nobody has to
  // type anything. The passphrase form is only shown when that is unavailable,
  // which keeps existing shared-passphrase installs working.
  if (cfg.allowAnonymous !== false) {
    const { error } = await sb.auth.signInAnonymously();
    if (!error) return enterApp();
    console.info('anonymous sign-in unavailable, falling back to passphrase:', error.message);
  }

  $('#lock').classList.remove('hidden');
  $('#lockForm').onsubmit = async e => {
    e.preventDefault();
    if (await trySignIn($('#passphrase').value)) enterApp();
  };
}

addEventListener('DOMContentLoaded', boot);

if ('serviceWorker' in navigator) {
  addEventListener('load', () => navigator.serviceWorker.register('sw.js').catch(() => {}));
}
