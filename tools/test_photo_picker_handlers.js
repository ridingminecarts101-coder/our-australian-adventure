/* Execute the real registered photo-input change handlers against a mutable
 * FileList-shaped object. Browsers clear the live FileList when input.value is
 * reset, so handlers must snapshot the files before allowing a same-file pick.
 */
'use strict';

const assert = require('node:assert/strict');
const fs = require('node:fs');
const path = require('node:path');
const vm = require('node:vm');

const source = fs.readFileSync(path.join(__dirname, '..', 'app.js'), 'utf8');

function registeredChangeHandler(selector) {
  const escaped = selector.replace(/[.*+?^${}()|[\]\\]/g, '\\$&');
  const pattern = new RegExp(`\\$\\('${escaped}'\\)\\.addEventListener\\('change',\\s*(async e => \\{[\\s\\S]*?\\n  \\})\\);`);
  const match = source.match(pattern);
  assert.ok(match, `real ${selector} change handler was not found`);
  return match[1];
}

function mutablePicker() {
  const listeners = new Map();
  const liveFiles = { length: 0 };
  let value = '';
  const input = {
    files: liveFiles,
    addEventListener(type, fn) { listeners.set(type, fn); },
    get value() { return value; },
    set value(next) {
      value = next;
      if (next === '') {
        delete liveFiles[0];
        liveFiles.length = 0;
      }
    },
    async choose(file) {
      // A file input does not emit change for an identical selection until its
      // value has been cleared by the app.
      if (value === file.name) return false;
      value = file.name;
      liveFiles[0] = file;
      liveFiles.length = 1;
      await listeners.get('change')({ target: input });
      return true;
    },
  };
  return input;
}

async function exercise(selector) {
  const input = mutablePicker();
  const calls = [];
  const context = {
    photoTargetId: 42,
    addPhotos: async (target, files) => calls.push({ target, files }),
  };
  vm.createContext(context);
  const handler = vm.runInContext(`(${registeredChangeHandler(selector)})`, context);
  input.addEventListener('change', handler);

  const file = { name: 'same-photo.jpg', type: 'image/jpeg' };
  assert.equal(await input.choose(file), true);
  assert.equal(input.value, '', `${selector} must clear its value after capturing the selection`);
  assert.equal(await input.choose(file), true, `${selector} must allow the same file to be picked again`);

  assert.equal(calls.length, 2, `${selector} must deliver both selections to addPhotos`);
  for (const call of calls) {
    assert.equal(call.target, 42);
    assert.ok(Array.isArray(call.files), `${selector} must pass a stable array snapshot`);
    assert.equal(call.files.length, 1);
    assert.equal(call.files[0], file);
  }
}

(async () => {
  await exercise('#photoInput');
  await exercise('#cameraInput');
  console.log('PASS: library and camera handlers snapshot live FileLists and allow same-file re-picks');
})().catch(error => {
  console.error(error);
  process.exitCode = 1;
});
