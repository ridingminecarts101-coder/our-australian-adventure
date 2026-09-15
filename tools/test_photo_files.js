'use strict';

const assert = require('assert');
const fs = require('fs');
const vm = require('vm');

const SOURCE = fs.readFileSync('photo-files.js', 'utf8');
const OWNER = '123e4567-e89b-12d3-a456-426614174000';
const OTHER = '223e4567-e89b-12d3-a456-426614174000';
const ID = '6ba7b810-9dad-41d1-80b4-00c04fd430c8';
const PATH = `wayfinder/photos/${OWNER}/${ID}.jpg`;

function load(plugin, native = true, platform = 'android', backupPlugin = null) {
  const window = {
    Blob,
    Uint8Array,
    btoa,
    atob,
    Capacitor: {
      isNativePlatform: () => native,
      getPlatform: () => platform,
      Plugins: {
        ...(plugin ? { Filesystem: plugin } : {}),
        ...(backupPlugin ? { WayfinderPhotoBackup: backupPlugin } : {}),
      },
    },
  };
  vm.runInNewContext(SOURCE, { window }, { filename: 'photo-files.js' });
  return window.WayfinderPhotoFiles;
}

(async () => {
  const calls = [];
  const plugin = {
    async writeFile(options) { calls.push(['write', options]); },
    async readFile(options) {
      calls.push(['read', options]);
      return { data: btoa(String.fromCharCode(0xff, 0xd8, 1, 2, 0xff, 0xd9)) };
    },
    async deleteFile(options) { calls.push(['delete', options]); },
    async readdir(options) {
      calls.push(['list', options]);
      return { files: [
        { name: `${ID}.jpg`, type: 'file', size: 6, mtime: 42 },
        { name: '../escape.jpg', type: 'file', size: 1 },
        { name: 'notes.txt', type: 'file', size: 2 },
        { name: 'nested', type: 'directory', size: 0 },
      ] };
    },
  };
  const api = load(plugin);
  assert.equal(api.isNative(), true);

  const original = new Blob([Uint8Array.from([0xff, 0xd8, 1, 2, 0xff, 0xd9])],
    { type: 'image/jpeg' });
  assert.deepEqual(await api.save(OWNER.toUpperCase(), ID, original),
    { path: PATH, bytes: 6 });
  assert.equal(calls[0][0], 'write');
  assert.equal(calls[0][1].path, PATH);
  assert.equal(calls[0][1].directory, 'DATA');
  assert.equal(calls[0][1].recursive, true);
  assert.deepEqual([...Buffer.from(calls[0][1].data, 'base64')],
    [0xff, 0xd8, 1, 2, 0xff, 0xd9]);

  const restored = await api.read(OWNER, PATH);
  assert.equal(restored.type, 'image/jpeg');
  assert.deepEqual([...new Uint8Array(await restored.arrayBuffer())],
    [0xff, 0xd8, 1, 2, 0xff, 0xd9]);
  assert.deepEqual(calls[1], ['read', { path: PATH, directory: 'DATA' }]);

  assert.equal(await api.remove(OWNER, PATH), true);
  assert.deepEqual(calls[2], ['delete', { path: PATH, directory: 'DATA' }]);
  assert.deepEqual(await api.list(OWNER), [{ path: PATH, bytes: 6, mtime: 42 }]);
  assert.deepEqual(calls[3], ['list', {
    path: `wayfinder/photos/${OWNER}`, directory: 'DATA',
  }]);

  await assert.rejects(api.read(OTHER, PATH), /does not belong/);
  await assert.rejects(api.save('../../escape', ID, original), /account UUID/);
  await assert.rejects(api.save(OWNER, '../escape', original), /photo ID/);
  await assert.rejects(api.save(OWNER, ID, new Blob(['png'], { type: 'image/png' })),
    /JPEG/);
  assert.equal(calls.length, 4, 'invalid input reached the native plugin');

  const missing = load({
    async deleteFile() { throw Object.assign(new Error('missing'), { code: 'OS-PLUG-FILE-0008' }); },
    async readdir() { throw Object.assign(new Error('missing'), { code: 'OS-PLUG-FILE-0008' }); },
  });
  assert.equal(await missing.remove(OWNER, PATH), false);
  assert.deepEqual(await missing.list(OWNER), []);

  const web = load(plugin, false);
  assert.equal(web.isNative(), false);
  await assert.rejects(web.save(OWNER, ID, original), /unavailable/);

  const nativeWithoutFilesystem = load(null, true, 'ios', {
    async prepare() {},
    async exclude() {},
  });
  assert.equal(nativeWithoutFilesystem.isNative(), true);
  await assert.rejects(nativeWithoutFilesystem.prepare(OWNER), /unavailable/,
    'a native build must fail closed instead of falling back to WebView photo storage');

  const malformed = load({ async readFile() { return { data: 'not base64!' }; } });
  await assert.rejects(malformed.read(OWNER, PATH), /valid base64/);

  const iosCalls = [];
  const iosFiles = {
    async writeFile(options) { iosCalls.push(['write', options.path]); },
    async deleteFile(options) { iosCalls.push(['delete', options.path]); },
  };
  const ios = load(iosFiles, true, 'ios', {
    async prepare() { iosCalls.push(['prepare']); },
    async exclude(options) { iosCalls.push(['exclude', options.path]); },
  });
  await ios.prepare(OWNER);
  assert.deepEqual(iosCalls, [['prepare']],
    'native startup prepares iOS persistent directories before photo UI');
  iosCalls.length = 0;
  await ios.verifyExcluded(OWNER, PATH);
  assert.deepEqual(iosCalls, [['prepare'], ['exclude', PATH]],
    'an existing iOS photo gets verified per-file backup exclusion before adoption');
  iosCalls.length = 0;
  await assert.rejects(ios.verifyExcluded(OTHER, PATH), /does not belong/);
  assert.deepEqual(iosCalls, [], 'foreign-owner path never reaches backup plugin');
  await ios.save(OWNER, ID, original);
  assert.deepEqual(iosCalls.map(call => call[0]), ['prepare', 'write', 'exclude'],
    'iOS must verify WebView storage and exclude each JPEG from backup around every write');

  const missingGuardCalls = [];
  const missingGuard = load({
    async writeFile() { missingGuardCalls.push('write'); },
  }, true, 'ios');
  await assert.rejects(missingGuard.prepare(OWNER), /device-only/);
  await assert.rejects(missingGuard.save(OWNER, ID, original), /device-only/);
  assert.deepEqual(missingGuardCalls, [], 'iOS must fail before writing if backup exclusion is unavailable');

  const rollbackCalls = [];
  const failingGuard = load({
    async writeFile() { rollbackCalls.push('write'); },
    async deleteFile() { rollbackCalls.push('delete'); },
  }, true, 'ios', {
    async prepare() { rollbackCalls.push('prepare'); },
    async exclude() { rollbackCalls.push('exclude'); throw new Error('refused'); },
  });
  await assert.rejects(failingGuard.save(OWNER, ID, original), /refused/);
  assert.deepEqual(rollbackCalls, ['prepare', 'write', 'exclude', 'delete'],
    'an iOS JPEG is removed if the device-only flag cannot be applied');
  rollbackCalls.length = 0;
  await assert.rejects(failingGuard.verifyExcluded(OWNER, PATH), /refused/);
  assert.deepEqual(rollbackCalls, ['prepare', 'exclude'],
    'failed existing-file exclusion reports failure without deleting bytes');

  const prepareCalls = [];
  const failedPrepare = load({
    async writeFile() { prepareCalls.push('write'); },
  }, true, 'ios', {
    async prepare() { prepareCalls.push('prepare'); throw new Error('not device-only'); },
    async exclude() {},
  });
  await assert.rejects(failedPrepare.save(OWNER, ID, original), /not device-only/);
  assert.deepEqual(prepareCalls, ['prepare'],
    'an iOS JPEG must not be written before persistent directories are excluded');

  const androidPrepareCalls = [];
  const android = load({
    async readdir() { androidPrepareCalls.push('filesystem'); },
  });
  assert.equal(await android.prepare(OWNER), true);
  assert.deepEqual(androidPrepareCalls, [],
    'Android startup uses native backup rules without reading photo data');
  await assert.rejects(android.prepare('not-an-owner'), /account UUID/);

  const manifest = fs.readFileSync('android/app/src/main/AndroidManifest.xml', 'utf8');
  assert.match(manifest, /android:allowBackup="false"/);
  assert.match(manifest, /android:dataExtractionRules="@xml\/data_extraction_rules"/);
  assert.match(manifest, /android:fullBackupContent="@xml\/backup_rules"/);
  const modernRules = fs.readFileSync('android/app/src/main/res/xml/data_extraction_rules.xml', 'utf8');
  assert.match(modernRules, /<cloud-backup>[\s\S]*domain="file" path="\."/);
  assert.match(modernRules, /<device-transfer>[\s\S]*domain="file" path="\."/);
  const legacyRules = fs.readFileSync('android/app/src/main/res/xml/backup_rules.xml', 'utf8');
  assert.match(legacyRules, /<exclude domain="file" path="\."/);
  const iosNative = fs.readFileSync('ios/App/App/WayfinderPhotoBackupPlugin.swift', 'utf8');
  assert.match(iosNative, /isExcludedFromBackup = true/);
  assert.match(iosNative, /WayfinderBridgeViewController/);
  const scene = fs.readFileSync('ios/App/App/SceneDelegate.swift', 'utf8');
  assert.match(scene, /sceneDidEnterBackground[\s\S]*applyToPersistentDirectories/);
  assert.doesNotMatch(scene, /try\?/,
    'scene lifecycle backup exclusion failures must be recorded');
  const appDelegate = fs.readFileSync('ios/App/App/AppDelegate.swift', 'utf8');
  assert.match(appDelegate, /didFinishLaunchingWithOptions[\s\S]*excludeLocalDataFromBackup/);
  assert.doesNotMatch(appDelegate, /try\?/,
    'native launch backup exclusion failures must be recorded');

  console.log('native photo files: paths, JPEGs, failures and Android/iOS backup exclusion passed');
})().catch(error => { console.error(error); process.exitCode = 1; });
