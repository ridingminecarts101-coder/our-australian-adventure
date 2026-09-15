/* Encrypted, account-scoped Wayfinder JPEG backup core.
 *
 * Pure data module: no network, DOM, storage, picker or share calls. The UI
 * must authenticate the current owner, load only one planned part at a time,
 * and handle local file handoff and import persistence.
 */
(function exposePhotoBackup(global) {
  'use strict';

  const FORMAT = 'wayfinder-local-photos';
  const VERSION = 1;
  const KDF_ITERATIONS = 250000;
  const MAX_PART_BYTES = 16 * 1024 * 1024;
  const MAX_FILE_BYTES = 32 * 1024 * 1024;
  const MAX_PHOTOS_PER_PART = 64;
  const MAX_PARTS = 512;
  const UUID = /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i;
  const ID = /^(?:[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}|[A-Za-z0-9_-]{1,128})$/i;
  const HEX = /^[a-f0-9]{64}$/;
  const META_KEYS = new Set(['id', 'adventure_id', 'taken_at', 'added_at', 'width',
    'height', 'bytes', 'blob']);
  const SOURCES = new Set(['exif', 'file', 'completed', 'upload']);

  function fail(message) { throw new Error(message); }
  function ownerUuid(value) {
    if (typeof value !== 'string' || !UUID.test(value)) fail('A valid Wayfinder account is required.');
    return value.toLowerCase();
  }
  function photoId(value) {
    if (typeof value !== 'string' || !ID.test(value) || value.includes('..'))
      fail('Photo ID is invalid.');
    return value;
  }
  function passphrase(value) {
    if (typeof value !== 'string' || value.length < 8 || value.length > 1024)
      fail('Use an export passphrase of at least 8 characters.');
    return value;
  }
  function iso(value, field) {
    if (value == null || value === '') return null;
    if (typeof value !== 'string' || value.length > 40
        || Number.isNaN(Date.parse(value)) || new Date(value).toISOString() !== value)
      fail(`Invalid ${field}.`);
    return value;
  }
  function sizeOf(photo) {
    const bytes = photo?.bytes ?? photo?.blob?.size;
    if (!Number.isSafeInteger(bytes) || bytes < 4 || bytes > MAX_PART_BYTES)
      fail('A photo exceeds the supported backup part size or has no byte length.');
    return bytes;
  }
  function photoMeta(photo, requireBlob) {
    if (!photo || typeof photo !== 'object' || Array.isArray(photo))
      fail('Photo record is invalid.');
    if (requireBlob && Object.keys(photo).some(key => !META_KEYS.has(key)))
      fail('Photo record contains a path, URL or unsupported private field.');
    const id = photoId(photo.id);
    const adventureId = photo.adventure_id;
    if (!Number.isSafeInteger(adventureId) || adventureId < 1 || adventureId > 1000000000)
      fail('Photo adventure reference is invalid.');
    const bytes = sizeOf(photo);
    const width = photo.width == null ? null : photo.width;
    const height = photo.height == null ? null : photo.height;
    for (const [name, value] of [['width', width], ['height', height]])
      if (value != null && (!Number.isSafeInteger(value) || value < 1 || value > 20000))
        fail(`Photo ${name} is invalid.`);
    if (requireBlob && (!(photo.blob instanceof global.Blob)
        || photo.blob.type !== 'image/jpeg' || photo.blob.size !== bytes))
      fail('A real JPEG Blob matching its byte length is required.');
    return {
      id, adventure_id: adventureId, taken_at: iso(photo.taken_at, 'taken date'),
      added_at: iso(photo.added_at, 'added date'), width, height, bytes,
    };
  }
  function partNumber(value, name) {
    if (!Number.isSafeInteger(value) || value < 1 || value > MAX_PARTS)
      fail(`Invalid ${name}.`);
    return value;
  }
  function exportId(value) {
    if (typeof value !== 'string' || !UUID.test(value))
      fail('Invalid export identifier.');
    return value.toLowerCase();
  }
  function bytesToBase64(bytes) {
    let binary = '';
    for (let i = 0; i < bytes.length; i += 32768)
      binary += String.fromCharCode(...bytes.subarray(i, i + 32768));
    return global.btoa(binary);
  }
  function base64ToBytes(value, maxBytes) {
    if (typeof value !== 'string' || value.length > Math.ceil(maxBytes / 3) * 4 + 4
        || value.length % 4 !== 0 || !/^(?:[A-Za-z0-9+/]{4})*(?:[A-Za-z0-9+/]{2}==|[A-Za-z0-9+/]{3}=)?$/.test(value))
      fail('Archive binary encoding is invalid or too large.');
    let binary;
    try { binary = global.atob(value); } catch { fail('Archive binary encoding is invalid.'); }
    if (binary.length > maxBytes) fail('Archive binary content is too large.');
    const out = new Uint8Array(binary.length);
    for (let i = 0; i < binary.length; i++) out[i] = binary.charCodeAt(i);
    return out;
  }
  function jpeg(bytes) {
    if (bytes.length < 4 || bytes[0] !== 0xff || bytes[1] !== 0xd8
        || bytes[bytes.length - 2] !== 0xff || bytes[bytes.length - 1] !== 0xd9)
      fail('Archive contains invalid JPEG bytes.');
  }
  async function sha256(bytes) {
    const hash = new Uint8Array(await global.crypto.subtle.digest('SHA-256', bytes));
    return [...hash].map(b => b.toString(16).padStart(2, '0')).join('');
  }
  async function key(password, salt) {
    const material = await global.crypto.subtle.importKey('raw',
      new TextEncoder().encode(passphrase(password)), 'PBKDF2', false, ['deriveKey']);
    return global.crypto.subtle.deriveKey(
      { name: 'PBKDF2', salt, iterations: KDF_ITERATIONS, hash: 'SHA-256' },
      material, { name: 'AES-GCM', length: 256 }, false, ['encrypt', 'decrypt']);
  }

  function planParts(photos, options = {}) {
    if (!Array.isArray(photos)) fail('Photo library must be an array.');
    if (!options || typeof options !== 'object' || Array.isArray(options)
        || Object.keys(options).some(key => key !== 'maxPartBytes'))
      fail('Unsupported backup planning option.');
    const maxPartBytes = options.maxPartBytes ?? MAX_PART_BYTES;
    if (!Number.isSafeInteger(maxPartBytes) || maxPartBytes < 4
        || maxPartBytes > MAX_PART_BYTES) fail('Invalid backup part limit.');
    const seen = new Set(), parts = [];
    let current = [], currentBytes = 0;
    for (const photo of photos) {
      const meta = photoMeta(photo, false);
      if (seen.has(meta.id)) fail('Photo library has duplicate IDs.');
      seen.add(meta.id);
      if (meta.bytes > maxPartBytes) fail('A photo exceeds the supported backup part size.');
      if (current.length && (current.length >= MAX_PHOTOS_PER_PART
          || currentBytes + meta.bytes > maxPartBytes)) {
        parts.push(current);
        current = []; currentBytes = 0;
      }
      current.push(photo);
      currentBytes += meta.bytes;
      if (parts.length + 1 > MAX_PARTS) fail('Photo library exceeds the supported number of parts.');
    }
    if (current.length) parts.push(current);
    if (parts.flat().length !== photos.length) fail('Backup planning omitted a photo.');
    return parts;
  }

  async function createPart(owner, photos, password, options = {}) {
    const scopedOwner = ownerUuid(owner);
    passphrase(password);
    if (!options || typeof options !== 'object' || Array.isArray(options)
        || Object.keys(options).some(key => !['exportId', 'partIndex', 'partCount'].includes(key)))
      fail('Unsupported backup archive option.');
    if (!Array.isArray(photos) || !photos.length || photos.length > MAX_PHOTOS_PER_PART)
      fail('A backup part needs 1-64 photos.');
    const partIndex = partNumber(options.partIndex, 'part index');
    const partCount = partNumber(options.partCount, 'part count');
    if (partIndex > partCount) fail('Part index exceeds part count.');
    const batchId = exportId(options.exportId);
    let total = 0;
    const seen = new Set(), items = [];
    for (const photo of photos) {
      const meta = photoMeta(photo, true);
      if (seen.has(meta.id)) fail('Backup part has duplicate photo IDs.');
      seen.add(meta.id);
      total += meta.bytes;
      if (total > MAX_PART_BYTES) fail('Backup part is too large.');
      const bytes = new Uint8Array(await photo.blob.arrayBuffer());
      jpeg(bytes);
      items.push({ ...meta, sha256: await sha256(bytes), jpeg: bytesToBase64(bytes) });
    }
    const plaintext = new TextEncoder().encode(JSON.stringify({
      format: FORMAT, version: VERSION, owner: scopedOwner, export_id: batchId,
      part_index: partIndex, part_count: partCount, photos: items,
    }));
    if (plaintext.length > MAX_FILE_BYTES - 1024) fail('Backup part is too large.');
    const salt = global.crypto.getRandomValues(new Uint8Array(16));
    const iv = global.crypto.getRandomValues(new Uint8Array(12));
    const cipher = new Uint8Array(await global.crypto.subtle.encrypt(
      { name: 'AES-GCM', iv }, await key(password, salt), plaintext));
    const blob = new global.Blob([JSON.stringify({
      format: FORMAT, version: VERSION, encrypted: true, kdf: 'PBKDF2-SHA256',
      iterations: KDF_ITERATIONS, cipher: 'AES-256-GCM',
      salt: bytesToBase64(salt), iv: bytesToBase64(iv),
      data: bytesToBase64(cipher),
    })], { type: 'application/vnd.wayfinder.photo-backup+json' });
    if (blob.size > MAX_FILE_BYTES) fail('Encrypted backup part is too large.');
    return blob;
  }

  async function openPart(expectedOwner, archive, password) {
    const owner = ownerUuid(expectedOwner);
    passphrase(password);
    if (!(archive instanceof global.Blob) || archive.size < 100
        || archive.size > MAX_FILE_BYTES) fail('Encrypted archive has an invalid size.');
    let envelope;
    try { envelope = JSON.parse(await archive.text()); }
    catch { fail('Encrypted archive is not valid JSON.'); }
    if (!envelope || typeof envelope !== 'object' || Array.isArray(envelope)
        || envelope.format !== FORMAT || envelope.version !== VERSION
        || envelope.encrypted !== true || envelope.kdf !== 'PBKDF2-SHA256'
        || envelope.iterations !== KDF_ITERATIONS || envelope.cipher !== 'AES-256-GCM'
        || Object.keys(envelope).sort().join(',') !==
          'cipher,data,encrypted,format,iterations,iv,kdf,salt,version')
      fail('Unsupported or unsafe backup archive.');
    const salt = base64ToBytes(envelope.salt, 16);
    const iv = base64ToBytes(envelope.iv, 12);
    if (salt.length !== 16 || iv.length !== 12) fail('Invalid archive encryption parameters.');
    const ciphertext = base64ToBytes(envelope.data, MAX_FILE_BYTES);
    let plaintext;
    try {
      plaintext = await global.crypto.subtle.decrypt(
        { name: 'AES-GCM', iv }, await key(password, salt), ciphertext);
    } catch { fail('Wrong passphrase or damaged backup archive.'); }
    let inner;
    try { inner = JSON.parse(new TextDecoder('utf-8', { fatal: true }).decode(plaintext)); }
    catch { fail('Decrypted archive is not valid UTF-8 JSON.'); }
    if (!inner || typeof inner !== 'object' || Array.isArray(inner)
        || Object.keys(inner).sort().join(',') !==
          'export_id,format,owner,part_count,part_index,photos,version'
        || inner.format !== FORMAT || inner.version !== VERSION
        || ownerUuid(inner.owner) !== owner)
      fail('Archive belongs to a different account or has unsafe metadata.');
    const batchId = exportId(inner.export_id);
    const partIndex = partNumber(inner.part_index, 'part index');
    const partCount = partNumber(inner.part_count, 'part count');
    if (partIndex > partCount || !Array.isArray(inner.photos)
        || !inner.photos.length || inner.photos.length > MAX_PHOTOS_PER_PART)
      fail('Archive part numbering or count is invalid.');
    let total = 0;
    const seen = new Set(), photos = [];
    for (const item of inner.photos) {
      if (!item || typeof item !== 'object' || Array.isArray(item)
          || Object.keys(item).sort().join(',') !==
            'added_at,adventure_id,bytes,height,id,jpeg,sha256,taken_at,width')
        fail('Archive photo metadata contains unsupported private fields.');
      const meta = photoMeta(item, false);
      if (seen.has(meta.id)) fail('Archive has duplicate photo IDs.');
      seen.add(meta.id);
      total += meta.bytes;
      if (total > MAX_PART_BYTES || !HEX.test(item.sha256))
        fail('Archive photo data is too large or has no checksum.');
      const bytes = base64ToBytes(item.jpeg, meta.bytes);
      if (bytes.length !== meta.bytes) fail('Archive photo byte length changed.');
      jpeg(bytes);
      if (await sha256(bytes) !== item.sha256) fail('Archive JPEG checksum changed.');
      photos.push({ ...meta, blob: new global.Blob([bytes], { type: 'image/jpeg' }),
        sha256: item.sha256 });
    }
    return { owner, exportId: batchId, partIndex, partCount, photos };
  }

  global.WayfinderPhotoBackup = Object.freeze({
    planParts, createPart, openPart,
    MAX_PART_BYTES, MAX_FILE_BYTES, MAX_PHOTOS_PER_PART, MAX_PARTS,
  });
})(globalThis);
