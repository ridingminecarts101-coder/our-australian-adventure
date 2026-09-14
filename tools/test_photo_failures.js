/* Isolated local-photo failure regressions. No browser profile, network,
 * Supabase project, or user data is involved.
 */
'use strict';

const assert = require('node:assert/strict');
const fs = require('node:fs');
const path = require('node:path');
const vm = require('node:vm');

const source = fs.readFileSync(path.join(__dirname, '..', 'app.js'), 'utf8');
function section(start, end) {
  const from = source.indexOf(start), to = source.indexOf(end, from);
  assert.ok(from >= 0 && to > from, `could not extract ${start}`);
  return source.slice(from, to);
}
const functions = [
  section('async function migrateLegacyPhotos()', 'async function flushPhotoQueue()'),
  section('async function deletePhoto(photoId)', '// ── Signed URLs'),
].join('\n');

function harness({ localDeleteError = null, remote = false } = {}) {
  const calls = { localDelete: [], remote: 0, close: 0, render: 0, toasts: [] };
  const photo = remote
    ? { id: 'photo-1', storage_path: 'legacy/photo.jpg', local: false }
    : { id: 'photo-1', owner_id: 'owner-1', local: true, blob: {} };
  const context = { calls, confirm: () => true, console: { warn() {}, info() {} },
    URL: { revokeObjectURL() {} } };
  vm.createContext(context);
  vm.runInContext(`
    var photos = [${JSON.stringify(photo)}];
    var objectUrls = new Map();
    var closeLightbox = () => calls.close++;
    var renderAll = () => calls.render++;
    var toast = message => calls.toasts.push(message);
    var nativePhotoFiles = () => null;
    var idbLocalPut = async item => item;
    var idbLocalDelete = async (owner, id) => {
      calls.localDelete.push([owner, id]);
      ${localDeleteError ? `throw new Error(${JSON.stringify(localDeleteError)});` : ''}
    };
    var sb = new Proxy({}, { get() { calls.remote++; throw new Error('remote mutation attempted'); } });
    ${functions}
  `, context);
  return context;
}

(async () => {
  {
    const h = harness({ localDeleteError: 'local deletion failed' });
    await h.deletePhoto('photo-1');
    assert.equal(h.photos.length, 1, 'failed local deletion remains visible and retryable');
    assert.equal(h.calls.remote, 0);
    assert.deepEqual(h.calls.toasts, ['Could not delete that photo']);
  }
  {
    const h = harness();
    await h.deletePhoto('photo-1');
    assert.equal(h.photos.length, 0);
    assert.equal(h.calls.close, 1);
    assert.equal(h.calls.render, 1);
  }
  {
    const h = harness({ remote: true });
    await h.deletePhoto('photo-1');
    assert.equal(h.photos.length, 1);
    assert.equal(h.calls.remote, 0);
    assert.deepEqual(h.calls.toasts, ['This existing cloud photo is read-only.']);
  }
  {
    const h = harness({ remote: true });
    await h.migrateLegacyPhotos();
    assert.equal(h.photos[0].storage_path, 'legacy/photo.jpg');
    assert.equal(h.calls.remote, 0);
  }
  console.log('PASS: 4 local-photo failure and remote-preservation regressions');
})().catch(error => { console.error(error); process.exitCode = 1; });
