'use strict';
const assert = require('node:assert/strict');
const fs = require('node:fs');
const vm = require('node:vm');

const owner = '123e4567-e89b-12d3-a456-426614174000';
const other = '223e4567-e89b-12d3-a456-426614174000';
const path = id => `wayfinder/photos/${owner}/${id}.jpg`;
const row = id => ({ id, owner_id: owner, native_path: path(id), taken_at: '2026-09-01T03:04:05.000Z' });

function harness() {
  const elements = new Map();
  const element = selector => {
    if (!elements.has(selector)) elements.set(selector, {
      textContent: '', disabled: false, value: '', files: [],
      classList: { toggle() {} },
    });
    return elements.get(selector);
  };
  const context = { crypto: require('node:crypto').webcrypto, Blob, console };
  context.window = context;
  context.document = { querySelector: element };
  context.confirm = () => true;
  context.WayfinderPhotoFiles = { canSaveToGallery: () => true, requestGalleryAccess: async () => {} };
  vm.createContext(context);
  vm.runInContext(fs.readFileSync('photo-transfer.js', 'utf8'), context);
  let current = { owner, generation: 1, deleting: false };
  let photos = [], calls = [];
  const adapter = {
    session: () => current,
    list: async () => photos,
    saveToGallery: async (who, photo) => { calls.push([who, photo.id]); },
    show() {}, hide() {}, toast() {},
  };
  context.WayfinderPhotoTransfer.mount(adapter);
  return {
    context, adapter, element,
    click: () => element('#savePhotosBtn').onclick(),
    status: () => element('#savePhotosStatus').textContent,
    setPhotos: value => { photos = value; },
    calls: () => calls,
    changeAccount: value => { current = value; },
  };
}

async function main() {
  {
    const h = harness();
    await h.click();
    assert.match(h.status(), /no photos stored/i);
    assert.deepEqual(h.calls(), []);
  }
  {
    const h = harness();
    h.setPhotos([row('one'), row('two')]);
    let approved = 0, permission = 0;
    h.context.confirm = text => { approved++; assert.match(text, /2 photos/); assert.match(text, /duplicates/); return true; };
    h.context.WayfinderPhotoFiles.requestGalleryAccess = async () => { permission++; };
    await h.click();
    assert.equal(approved, 1);
    assert.equal(permission, 1);
    assert.deepEqual(h.calls(), [[owner, 'one'], [owner, 'two']]);
    assert.match(h.status(), /Saved 2 photos to Photos/);
    h.context.WayfinderPhotoTransfer.sessionChanged();
    assert.match(h.status(), /Saved 2 photos to Photos/, 'normal redraw preserves the result');
    assert.equal(h.element('#savePhotosBtn').disabled, false);
  }
  {
    const h = harness();
    h.setPhotos([row('one')]);
    h.context.confirm = () => false;
    h.context.WayfinderPhotoFiles.requestGalleryAccess = async () => {
      throw Error('Permission must follow consent');
    };
    await h.click();
    assert.match(h.status(), /No photos were copied/);
    assert.deepEqual(h.calls(), []);
  }
  {
    const h = harness();
    h.setPhotos([row('one'), { id: 'queued', owner_id: owner, blob: {} }]);
    h.context.confirm = () => { throw Error('Must not offer incomplete set'); };
    await h.click();
    assert.match(h.status(), /still being saved/);
    assert.deepEqual(h.calls(), []);
  }
  {
    const h = harness();
    h.setPhotos([row('one'), row('two')]);
    h.context.WayfinderPhotoFiles.requestGalleryAccess = async () => {
      throw Object.assign(Error('denied'), { code: 'PHOTO_LIBRARY_DENIED' });
    };
    await h.click();
    assert.match(h.status(), /device Settings/);
    assert.deepEqual(h.calls(), []);
  }
  {
    const h = harness();
    h.setPhotos([row('one'), row('missing')]);
    h.adapter.saveToGallery = async (who, photo) => {
      h.calls().push([who, photo.id]);
      if (photo.id === 'missing') throw Object.assign(Error('missing'), { code: 'PHOTO_FILE_MISSING' });
    };
    await h.click();
    assert.deepEqual(h.calls(), [[owner, 'one'], [owner, 'missing']]);
    assert.match(h.status(), /Saved 1 of 2 photos/);
    assert.match(h.status(), /Repeating the action may duplicate/);
  }
  {
    const h = harness();
    h.setPhotos([row('one'), row('two')]);
    h.adapter.saveToGallery = async (who, photo) => {
      h.calls().push([who, photo.id]);
      h.changeAccount({ owner: other, generation: 2, deleting: false });
    };
    await h.click();
    h.context.WayfinderPhotoTransfer.sessionChanged();
    assert.deepEqual(h.calls(), [[owner, 'one']], 'no second native save after account switch');
    assert.equal(h.status(), '', 'old account progress is cleared');
  }
  {
    const h = harness();
    h.setPhotos([row('one')]);
    h.context.WayfinderPhotoFiles.canSaveToGallery = () => false;
    await h.click();
    assert.match(h.status(), /available in the iPhone and iPad app/);
    assert.deepEqual(h.calls(), []);
  }
  console.log('PASS: Photos export zero, batch, queued, denial, partial, account switch and unsupported platform');
}
main().catch(error => { console.error(error); process.exitCode = 1; });
