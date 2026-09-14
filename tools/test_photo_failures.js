/* Isolated photo-failure regressions. The real app functions execute against
 * deterministic mocks; no browser, network, Supabase project, or user data is
 * involved.
 */
'use strict';

const assert = require('node:assert/strict');
const fs = require('node:fs');
const path = require('node:path');
const vm = require('node:vm');

const source = fs.readFileSync(path.join(__dirname, '..', 'app.js'), 'utf8');

function section(start, end) {
  const from = source.indexOf(start);
  const to = source.indexOf(end, from);
  assert.ok(from >= 0 && to > from, `could not extract ${start}`);
  return source.slice(from, to);
}

const functions = [
  section('async function migrateLegacyPhotos()', 'async function flushPhotoQueue()'),
  section('async function deletePhoto(photoId)', '// ── Signed URLs'),
].join('\n');

function harness({ removeError = null, metadataError = null, confirmDelete = true } = {}) {
  const calls = { remove: [], metadataDelete: [], close: 0, render: 0, toasts: [], warnings: [] };
  const photo = { id: 'photo-1', storage_path: '42/legacy.jpg', user_id: 'owner-1' };
  const context = {
    calls,
    confirm: () => confirmDelete,
    console: { warn: value => calls.warnings.push(value), info: () => {} },
  };
  vm.createContext(context);
  vm.runInContext(`
    var BUCKET = 'memories';
    var photos = [${JSON.stringify(photo)}];
    var signedUrls = { delete() {} };
    var closeLightbox = () => calls.close++;
    var renderAll = () => calls.render++;
    var toast = message => calls.toasts.push(message);
    var sb = {
      storage: { from: () => ({
        remove: async paths => {
          calls.remove.push(paths);
          return { error: ${removeError ? `new Error(${JSON.stringify(removeError)})` : 'null'} };
        },
        move: async () => { throw new Error('legacy migration must not move objects'); }
      }) },
      from: () => ({
        update: () => { throw new Error('legacy migration must not update metadata'); },
        delete: () => ({ eq: async (_column, id) => {
          calls.metadataDelete.push(id);
          return { error: ${metadataError ? `new Error(${JSON.stringify(metadataError)})` : 'null'} };
        } })
      })
    };
    ${functions}
  `, context);
  return context;
}

(async () => {
  {
    const h = harness({ removeError: 'object removal failed' });
    await h.deletePhoto('photo-1');
    assert.equal(JSON.stringify(h.calls.remove), JSON.stringify([['42/legacy.jpg']]));
    assert.equal(h.calls.metadataDelete.length, 0,
      'metadata must remain when object removal fails');
    assert.equal(h.photos.length, 1, 'the visible photo must remain retryable');
    assert.deepEqual(h.calls.toasts, ['Could not delete that photo']);
  }

  {
    const h = harness({ metadataError: 'metadata deletion failed' });
    await h.deletePhoto('photo-1');
    assert.equal(h.calls.metadataDelete.length, 1);
    assert.equal(h.photos.length, 1,
      'a failed metadata deletion must remain visible and retryable');
    assert.deepEqual(h.calls.toasts, ['Could not delete that photo']);
  }

  {
    const h = harness();
    await h.deletePhoto('photo-1');
    assert.equal(h.photos.length, 0);
    assert.equal(h.calls.close, 1);
    assert.equal(h.calls.render, 1);
    assert.deepEqual(h.calls.toasts, ['Photo deleted']);
  }

  {
    const h = harness();
    await h.migrateLegacyPhotos();
    assert.equal(h.photos[0].storage_path, '42/legacy.jpg',
      'legacy metadata path must stay unchanged');
    assert.equal(h.calls.remove.length, 0,
      'legacy preservation must not mutate Storage');
    assert.equal(h.calls.metadataDelete.length, 0,
      'legacy preservation must not mutate Postgres metadata');
  }

  console.log('PASS: 4 photo failure and legacy-preservation regressions');
})().catch(error => {
  console.error(error);
  process.exitCode = 1;
});
