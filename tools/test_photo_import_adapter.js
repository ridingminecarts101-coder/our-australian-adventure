import assert from 'node:assert/strict';
import { readFile } from 'node:fs/promises';
import { randomUUID } from 'node:crypto';
import vm from 'node:vm';

const source = await readFile(new URL('../app.js', import.meta.url), 'utf8');
const jpeg = new Uint8Array(await readFile(new URL('./fixtures/photo-backup.jpg', import.meta.url)));
const owner = randomUUID();
const pathFor = id => `wayfinder/photos/${owner}/${id}.jpg`;
const imported = (id = randomUUID(), bytes = jpeg) => ({
  id, adventure_id: 714, width: 240, height: 160, bytes: bytes.length,
  taken_at: '2026-09-15T05:00:00.000Z',
  blob: new Blob([bytes], { type: 'image/jpeg' }),
});
function actual(name) {
  // Only column-zero function endings delimit the function; nested blocks
  // remain the real production source, not a mirrored test implementation.
  const match = source.match(new RegExp(`^(?:async )?function ${name}\\([^\\n]*\\) \\{[\\s\\S]*?^\\}`, 'm'));
  assert(match, `missing actual app function ${name}`);
  return match[0];
}

function fixture(native = false) {
  const metadata = new Map(), nativeFiles = new Map();
  const calls = { idbWrites: 0, decoder: 0, close: 0, prepare: 0,
    exclusion: 0, nativeSave: 0, nativeRemove: 0, deletion: 0 };
  let decoderFails = false, saveFails = false, deleteFails = false, exclusionFails = false;
  const files = {
    list: async () => [...nativeFiles.keys()].map(path => ({ path })),
    read: async (_, path) => nativeFiles.get(path),
    prepare: async () => { calls.prepare++; },
    verifyExcluded: async (_, path) => {
      calls.exclusion++;
      if (exclusionFails) throw new Error('per-file backup exclusion failed');
      assert(nativeFiles.has(path), 'only an existing file can be excluded');
    },
  };
  let transferAdapter;
  const ctx = {
    Blob, Uint8Array, console, LOCAL_PHOTO_STORE: 'local-photos',
    userId: owner, authGeneration: 1, accountDeletionInProgress: false,
    photos: [], window: { WayfinderPhotoTransfer: {
      mount: options => { transferAdapter = options; },
    } },
    createImageBitmap: async () => {
      calls.decoder++;
      if (decoderFails) throw new Error('synthetic decoder failed');
      return { width: 240, height: 160, close: () => { calls.close++; } };
    },
    nativePhotoFiles: () => native ? files : null,
    idbWrite: async (_, operation) => {
      calls.idbWrites++;
      const store = { add(record) {
        if (metadata.has(record.local_key)) throw new Error('ConstraintError: photo already exists');
        metadata.set(record.local_key, record);
      } };
      operation(store);
    },
    idbLocalDelete: async (_, id) => {
      calls.deletion++;
      if (deleteFails) throw new Error('reservation cleanup failed');
      metadata.delete(`${owner}:${id}`);
    },
    saveLocalPhoto: async record => {
      calls.nativeSave++;
      if (saveFails) throw new Error('native file write failed');
      const path = pathFor(record.id);
      nativeFiles.set(path, record.blob);
      const { blob, ...rest } = record;
      const saved = { ...rest, native_path: path };
      metadata.set(saved.local_key, saved);
      return saved;
    },
    discardSavedLocalPhoto: async record => {
      calls.nativeRemove++;
      nativeFiles.delete(record.native_path);
      metadata.delete(record.local_key);
    },
    listTransferPhotos: async () => [...metadata.values()],
    idbLocalAll: async () => [...metadata.values()],
    renderAll() {}, showManagedDialog() {}, hideManagedDialog() {}, toast() {},
  };
  ctx.window.window = ctx.window;
  vm.runInNewContext([
    actual('localPhotoRecord'), actual('validateImportedPhoto'),
    actual('saveImportedPhoto'), actual('setupPhotoTransfer'),
  ].join('\n'), ctx, { filename: 'app-photo-import-functions.js' });
  ctx.setupPhotoTransfer();
  return { ctx, metadata, nativeFiles, calls, get adapter() { return transferAdapter; },
    setDecoderFail(value) { decoderFails = value; },
    setSaveFail(value) { saveFails = value; },
    setDeleteFail(value) { deleteFails = value; },
    setExclusionFail(value) { exclusionFails = value; } };
}

let passed = 0;
const pass = label => console.log(`PASS ${++passed}: ${label}`);
{
  const h = fixture();
  h.setDecoderFail(true);
  await assert.rejects(h.ctx.saveImportedPhoto(imported(), owner), /synthetic decoder failed/);
  assert.equal(h.calls.idbWrites, 0);
  assert.equal(h.metadata.size, 0);
  pass('failed image decoding cannot reserve metadata or write photo bytes');
}
{
  const h = fixture();
  const row = imported();
  const prior = { id: row.id, adventure_id: row.adventure_id,
    local_key: `${owner}:${row.id}`, blob: row.blob };
  h.metadata.set(prior.local_key, prior);
  await assert.rejects(h.ctx.saveImportedPhoto(row, owner), /ConstraintError/);
  assert.equal(h.metadata.get(prior.local_key), prior);
  assert.deepEqual(new Uint8Array(await prior.blob.arrayBuffer()), jpeg);
  pass('atomic add reservation rejects duplicate photo ID without replacing existing bytes');
}
{
  const h = fixture(true);
  const row = imported();
  const path = pathFor(row.id);
  const prior = row.blob;
  h.nativeFiles.set(path, prior);
  const recovered = await h.ctx.saveImportedPhoto(row, owner);
  assert.equal(recovered.recovered_existing_file, true);
  assert.equal(recovered.native_path, path);
  assert.equal(h.calls.nativeSave, 0);
  assert.equal(h.calls.exclusion, 1);
  assert.equal(h.calls.prepare, 0, 'directory-only exclusion is insufficient for adoption');
  assert.equal(h.metadata.get(`${owner}:${row.id}`).native_path, path);
  await h.adapter.remove(recovered);
  assert.equal(h.calls.nativeRemove, 0);
  assert.equal(h.nativeFiles.get(path), prior);
  assert.equal(h.metadata.size, 0);
  pass('byte-identical native orphan adopts metadata only; rollback never removes existing file');
}
{
  const h = fixture(true);
  const row = imported();
  const path = pathFor(row.id);
  const prior = row.blob;
  h.nativeFiles.set(path, prior);
  h.setExclusionFail(true);
  await assert.rejects(h.ctx.saveImportedPhoto(row, owner), /per-file backup exclusion failed/);
  assert.equal(h.nativeFiles.get(path), prior, 'failed flag check preserves existing bytes');
  assert.equal(h.metadata.size, 0, 'failed flag check never adopts visible metadata');
  assert.equal(h.calls.idbWrites, 0);
  pass('failed existing-file backup exclusion preserves orphan bytes and refuses adoption');
}
{
  const h = fixture(true);
  const row = imported();
  const path = pathFor(row.id);
  const altered = new Uint8Array(jpeg); altered[20] ^= 1;
  const prior = new Blob([altered], { type: 'image/jpeg' });
  h.nativeFiles.set(path, prior);
  await assert.rejects(h.ctx.saveImportedPhoto(row, owner), /original was kept/);
  assert.equal(h.nativeFiles.get(path), prior);
  assert.equal(h.calls.idbWrites, 0);
  assert.equal(h.metadata.size, 0);
  pass('mismatched native orphan is preserved, with no metadata claim or overwrite');
}
{
  const h = fixture(true);
  const row = imported();
  h.setSaveFail(true); h.setDeleteFail(true);
  await assert.rejects(h.ctx.saveImportedPhoto(row, owner), /reservation cleanup failed/);
  assert.equal(h.calls.nativeSave, 1);
  assert.equal(h.calls.deletion, 1);
  assert.equal(h.metadata.has(`${owner}:${row.id}`), true);
  assert.equal(h.nativeFiles.size, 0);
  pass('native write plus reservation-cleanup failure surfaces explicit error and leaves retry evidence');
}
console.log(`${passed} actual photo import adapter checks passed.`);
