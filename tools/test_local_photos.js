/* Device-local photo regressions using the real app functions and deterministic
 * mocks. No IndexedDB profile, network, Supabase project, or user data is used.
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
  section('async function addPhotos(adventureId, files)', '/* Keep photo objects'),
  section('async function flushPhotoQueue()', 'async function pullPhotos()'),
  section('async function pullPhotos()', 'async function deletePhoto(photoId)'),
  section('async function deletePhoto(photoId)', '// ── Signed URLs'),
].join('\n');
const nativeSaveFunctions = section('function nativePhotoFiles()', 'let localPersistenceRequested');
const persistenceFunctions = section('let localPersistenceRequested', '// ── EXIF:');
const localUrlFunction = section('async function ensureLocalPhotoUrls(items)', 'function renderPhotoStatus()');
const signedUrlFunction = section('async function ensureSignedUrls(paths)', 'function photoSrc(p)');
const lightboxFunction = section('async function showLightbox()', 'function closeLightbox()');
const queueDeleteFunction = section('async function idbDeleteQueueOwner(ownerId)', 'async function idbDeleteLocalOwner(ownerId)');
const idbWriteFunctions = section('async function idbPut(item)', 'async function idbClear()');
const idbAllFunction = section('async function idbAll()', 'async function idbPut(item)');
const idbLocalPutFunction = section('async function idbLocalPut(item)', 'async function idbLocalRows()');
const deleteAccountFunction = section('async function retryConfirmedLocalAccountCleanup()', '// ══');
const signedOutFunction = section('async function handleSignedOut(', 'async function createAccount(');
const bindFunction = section('async function bindLocalDataToUser()', '//  Writing — local first');
const ownerQueueFunctions = section('function validAccountOwner(ownerId)', '//  Writing — local first');

function harness() {
  const calls = { localPut: [], queuePut: [], queueDelete: [], localDelete: [], remote: 0, egress: 0,
    renders: 0, toasts: [], revoked: [] };
  const context = {
    calls,
    Blob,
    Date,
    Promise,
    crypto: { randomUUID: () => 'local-photo-1' },
    console: { warn() {}, info() {} },
    confirm: () => true,
    queueMicrotask,
    URL: { revokeObjectURL: url => calls.revoked.push(url) },
    fetch: async () => { calls.egress++; throw new Error('unexpected fetch'); },
    WebSocket: function () { calls.egress++; throw new Error('unexpected websocket'); },
    navigator: { sendBeacon() { calls.egress++; return false; } },
  };
  vm.createContext(context);
  vm.runInContext(`
    var accountDeletionInProgress = false;
    var communityWrites = new Map();
    var uploading = 0;
    var userId = 'owner-a';
    var authGeneration = 4;
    var online = true;
    var who = 'Test owner';
    var photos = [];
    var pendingPhotos = [];
    var objectUrls = new Map();
    var readExifDate = async () => null;
    var downscale = async () => ({ blob: { size: 123 }, width: 800, height: 600 });
    var row = () => ({ completed_at: null });
    var renderAll = () => calls.renders++;
    var renderPhotoStatus = () => {};
    var closeLightbox = () => {};
    var toast = message => calls.toasts.push(message);
    var idbLocalPut = async item => {
      const saved = { ...item, local: true, user_id: item.owner_id,
        local_key: item.owner_id + ':' + item.id };
      calls.localPut.push(saved);
      return saved;
    };
    var saveLocalPhoto = idbLocalPut;
    var discardSavedLocalPhoto = async saved => calls.localDelete.push([saved.owner_id, saved.id]);
    var requestLocalPhotoPersistence = async () => {};
    var nativePhotoFiles = () => null;
    var idbPut = async item => calls.queuePut.push(item.id);
    var idbDelete = async id => calls.queueDelete.push(id);
    var idbLocalDelete = async (owner, id) => calls.localDelete.push([owner, id]);
    var idbLocalAll = async owner => [{ id: 'local-existing', adventure_id: 7,
      owner_id: owner, user_id: owner, local: true, local_key: owner + ':local-existing', blob: {} }];
    var sb = new Proxy({}, { get() { calls.remote++; throw new Error('unexpected remote photo write'); } });
    ${functions}
  `, context);
  return context;
}

(async () => {
  {
    const h = harness();
    await h.addPhotos(7, [{ type: 'image/jpeg', lastModified: 0, name: 'camera.jpg' }]);
    assert.equal(h.calls.localPut.length, 1);
    assert.deepEqual(h.calls.queuePut, ['local-photo-1']);
    assert.equal(h.calls.remote, 0, 'new photos must not call Supabase');
    assert.equal(h.calls.egress, 0, 'new photo bytes and metadata must not use network APIs');
    assert.equal(h.pendingPhotos.length, 0);
    assert.equal(h.photos.length, 1);
    assert.equal(h.photos[0].owner_id, 'owner-a');
    assert.equal(h.photos[0].local, true);
  }

  {
    const h = harness();
    h.nativePhotoFiles = () => ({ isNative: () => true });
    await h.addPhotos(7, [{ type: 'image/jpeg', lastModified: 0, name: 'native-camera.jpg' }]);
    assert.equal(h.calls.queuePut.length, 0,
      'a fresh native photo blob must never be staged in IndexedDB queue storage');
    assert.equal(h.calls.localPut.length, 1, 'native save commits only local metadata after its file write');
    assert.equal(h.photos.length, 1);
    assert.equal(h.photos[0].owner_id, 'owner-a');
  }

  {
    const h = harness();
    h.pendingPhotos = [{ id: 'old-queued', adventure_id: 8, owner_id: 'owner-a', blob: {} }];
    await h.flushPhotoQueue();
    assert.equal(h.calls.localPut.length, 1);
    assert.equal(h.calls.queueDelete[0], 'old-queued');
    assert.equal(h.calls.remote, 0, 'an old queue item must become local without upload');
    assert.equal(h.pendingPhotos.length, 0);
    assert.equal(h.photos[0].local, true);
  }

  {
    const h = harness();
    h.sb = { from: table => {
      assert.equal(table, 'photos');
      return { select: () => ({ order: async () => ({
        data: [{ id: 'remote-existing', adventure_id: 9, storage_path: 'old/path.jpg' }],
        error: null,
      }) }) };
    } };
    await h.pullPhotos();
    assert.equal(h.photos.length, 2);
    assert.equal(h.photos.find(p => p.id === 'local-existing').owner_id, 'owner-a');
    assert.equal(h.photos.find(p => p.id === 'remote-existing').local, false);
  }

  {
    const h = harness();
    h.photos = [{ id: 'local-delete', owner_id: 'owner-a', local: true, blob: {} }];
    h.objectUrls.set('local-delete', 'blob:local-delete');
    await h.deletePhoto('local-delete');
    assert.equal(JSON.stringify(h.calls.localDelete), JSON.stringify([['owner-a', 'local-delete']]));
    assert.equal(h.calls.remote, 0);
    assert.equal(h.photos.length, 0);
    assert.deepEqual(h.calls.revoked, ['blob:local-delete']);
  }

  {
    const h = harness();
    h.photos = [{ id: 'remote-readonly', storage_path: 'remote/photo.jpg', local: false }];
    await h.deletePhoto('remote-readonly');
    assert.equal(h.photos.length, 1);
    assert.equal(h.calls.remote, 0, 'existing cloud photos must remain untouched');
    assert.deepEqual(h.calls.toasts, ['This existing cloud photo is read-only.']);
  }

  {
    const order = [], storedMetadata = [];
    const h = { order, storedMetadata, window: { WayfinderPhotoFiles: {
      isNative: () => true,
      save: async () => { order.push('file'); return { path: 'wayfinder/photos/owner-a/p.jpg', bytes: 77 }; },
      remove: async () => order.push('rollback'),
    } } };
    vm.createContext(h);
    vm.runInContext(`
      var localPhotoRecord = item => ({ ...item, local: true, local_key: item.owner_id + ':' + item.id });
      var idbLocalPut = async item => { order.push('metadata'); storedMetadata.push(item); return item; };
      ${nativeSaveFunctions}
    `, h);
    const saved = await h.saveLocalPhoto({ id: 'p.jpg', owner_id: 'owner-a', blob: {}, bytes: 10 });
    assert.deepEqual(order, ['file', 'metadata']);
    assert.equal('blob' in storedMetadata[0], false, 'native metadata must omit image bytes');
    assert.equal(saved.native_path, 'wayfinder/photos/owner-a/p.jpg');
    assert.equal(saved.bytes, 77);
  }

  {
    const order = [];
    const h = { order, window: { WayfinderPhotoFiles: {
      isNative: () => true,
      save: async () => { order.push('file'); return { path: 'wayfinder/photos/owner-a/p.jpg', bytes: 20 }; },
      remove: async () => order.push('rollback'),
    } } };
    vm.createContext(h);
    vm.runInContext(`
      var localPhotoRecord = item => ({ ...item, local: true, local_key: item.owner_id + ':' + item.id });
      var idbLocalPut = async () => { order.push('metadata'); throw new Error('idb failed'); };
      ${nativeSaveFunctions}
    `, h);
    await assert.rejects(h.saveLocalPhoto({ id: 'p.jpg', owner_id: 'owner-a', blob: {} }), /idb failed/);
    assert.deepEqual(order, ['file', 'metadata', 'rollback']);
  }

  {
    const h = { persistCalls: 0, navigator: { storage: { persist: async () => { h.persistCalls++; } } },
      nativePhotoFiles: () => null, objectUrls: new Map(), URL: { revokeObjectURL() {} } };
    vm.createContext(h);
    vm.runInContext(persistenceFunctions, h);
    await h.requestLocalPhotoPersistence();
    await h.requestLocalPhotoPersistence();
    assert.equal(h.persistCalls, 1, 'PWA persistence is requested once from an add-photo action');
  }

  {
    let resolveRead;
    const read = new Promise(resolve => { resolveRead = resolve; });
    const h = { userId: 'owner-a', authGeneration: 10, objectUrls: new Map(),
      nativePhotoFiles: () => ({ read: async () => read }),
      URL: { createObjectURL: () => 'blob:private-a' }, console: { warn() {} } };
    vm.createContext(h);
    vm.runInContext(localUrlFunction, h);
    const loading = h.ensureLocalPhotoUrls([{ id: 'same-id', owner_id: 'owner-a', native_path: 'a.jpg' }]);
    h.userId = 'owner-b'; h.authGeneration = 11;
    resolveRead({});
    await loading;
    assert.equal(h.objectUrls.size, 0, 'a late native read must not cross an account switch');
  }

  {
    const order = [];
    const owner = '11111111-1111-4111-8111-111111111111';
    const values = new Map([
      ['upgrade', JSON.stringify({ owner_id: owner, stage: 'awaiting-email' })],
      [`oaa.packs.v2.${owner}`, '["all"]'],
      ['oaa.packs.v2.22222222-2222-4222-8222-222222222222', '["europe"]'],
    ]);
    const h = { order, userId: owner, online: true, accountDeletionInProgress: false, uploading: 0,
      communityWrites: new Map(),
      authGeneration: 2, prompt: () => 'DELETE', toast() {}, console: { warn() {} },
      removeOwnedStorage: async () => order.push('remote-storage'),
      idbDeleteLocalOwner: async () => order.push('local-owner'),
      idbDeleteQueueOwner: async () => order.push('queued-owner'),
      handleSignedOut: async () => order.push('signed-out'),
      LS: { accountDeletion: 'deletion', accountUpgrade: 'upgrade' },
      readLS: (key, fallback) => values.has(key) ? JSON.parse(values.get(key)) : fallback,
      writeLS: (key, value) => values.set(key, JSON.stringify(value)),
      localStorage: { removeItem: key => values.delete(key) },
      clearAccountUpgrade: deletingOwner => {
        const marker = values.has('upgrade') ? JSON.parse(values.get('upgrade')) : null;
        if (marker && marker.owner_id === deletingOwner) values.delete('upgrade');
      },
      Billing: { deleteLocalOwner: async deletingOwner => {
        order.push('billing-owner'); values.delete(`oaa.packs.v2.${deletingOwner}`);
      } },
      setTimeout,
      sb: { rpc: async () => { order.push('rpc'); return { error: null }; }, auth: { signOut: async () => {} } } };
    h.flushPhotoQueue = () => {}; h.flushPhotoQueue.busy = false;
    vm.createContext(h);
    vm.runInContext(ownerQueueFunctions + deleteAccountFunction, h);
    await h.deleteAccount();
    assert.deepEqual(order.slice(0, 5), ['remote-storage', 'rpc', 'billing-owner', 'local-owner', 'queued-owner']);
    assert.equal(values.has('upgrade'), false, 'successful deletion clears that owner upgrade marker');
    assert.equal(values.has(`oaa.packs.v2.${owner}`), false, 'successful deletion clears that owner purchase cache');
    assert.equal(values.has('oaa.packs.v2.22222222-2222-4222-8222-222222222222'), true,
      'successful deletion leaves another owner purchase cache alone');
    assert.equal(values.has('deletion'), false, 'completed local cleanup clears retry evidence');
  }

  {
    const owner = '11111111-1111-4111-8111-111111111111', order = [], values = new Map();
    const h = { owner, order, userId: owner, online: true, accountDeletionInProgress: false, uploading: 0,
      communityWrites: new Map(),
      authGeneration: 1, prompt: () => 'DELETE', toast() {}, console: { warn() {} }, setTimeout,
      removeOwnedStorage: async () => order.push('remote-storage'),
      idbDeleteLocalOwner: async () => order.push('local-owner'),
      idbDeleteQueueOwner: async () => order.push('queued-owner'),
      handleSignedOut: async () => order.push('signed-out'), clearAccountUpgrade() {},
      LS: { accountDeletion: 'deletion' },
      readLS: (key, fallback) => values.has(key) ? JSON.parse(values.get(key)) : fallback,
      writeLS: (key, value) => values.set(key, JSON.stringify(value)),
      localStorage: { removeItem: key => values.delete(key) },
      Billing: { deleteLocalOwner: async () => {} },
      sb: { rpc: async () => { order.push('rpc-failed'); return {error:new Error('database unavailable')}; },
        auth: {signOut: async () => order.push('auth-signout')} } };
    h.flushPhotoQueue = () => {}; h.flushPhotoQueue.busy = false;
    vm.createContext(h); vm.runInContext(ownerQueueFunctions + deleteAccountFunction, h);
    await h.deleteAccount();
    assert.deepEqual(order, ['remote-storage', 'rpc-failed'],
      'failed identity deletion preserves every device-local and queued photo');
    assert.equal(JSON.parse(values.get('deletion')).stage, 'server-failed');
    assert.equal(h.userId, owner);
  }

  {
    const owner = '11111111-1111-4111-8111-111111111111', values = new Map(), messages = [];
    const h = { userId: owner, online: true, accountDeletionInProgress: false, uploading: 0,
      communityWrites: new Map(),
      authGeneration: 1, prompt: () => 'DELETE', toast: message => messages.push(message),
      console: { warn() {} }, setTimeout, removeOwnedStorage: async () => {},
      idbDeleteLocalOwner: async () => { throw new Error('device busy'); },
      idbDeleteQueueOwner: async () => { throw new Error('queue must wait'); },
      handleSignedOut: async () => {}, clearAccountUpgrade() {},
      LS: { accountDeletion: 'deletion' },
      readLS: (key, fallback) => values.has(key) ? JSON.parse(values.get(key)) : fallback,
      writeLS: (key, value) => values.set(key, JSON.stringify(value)),
      localStorage: { removeItem: key => values.delete(key) },
      Billing: { deleteLocalOwner: async () => {} },
      sb: { rpc: async () => ({error:null}), auth: {signOut:async()=>{}} } };
    h.flushPhotoQueue = () => {}; h.flushPhotoQueue.busy = false;
    vm.createContext(h); vm.runInContext(ownerQueueFunctions + deleteAccountFunction, h);
    await h.deleteAccount();
    assert.equal(JSON.parse(values.get('deletion')).stage, 'confirmed',
      'post-RPC local failure retains owner-scoped retry evidence');
    assert(messages.some(message => /will retry/.test(message)));
    h.idbDeleteLocalOwner = async deletingOwner => assert.equal(deletingOwner, owner);
    h.idbDeleteQueueOwner = async deletingOwner => assert.equal(deletingOwner, owner);
    assert.equal(await h.retryConfirmedLocalAccountCleanup(), true);
    assert.equal(values.has('deletion'), false, 'later startup retry clears completed cleanup evidence');
  }

  {
    const h = { signOutHandling: false, signOutWork: null, authGeneration: 1, userId: 'owner-a', accountUser: {},
      passwordRecoveryMode: true, passwordRecoveryBusy: true, passwordRecoveryOwnerId: 'owner-a',
      passwordRecoveryAttempt: 0, pendingPasswordRecovery: { ownerId: 'owner-a', attempt: 0 },
      recoveryRequestBusy: true, recoveryRequestAttempt: 0,
      accountIsAnonymous: false, progress: new Map(), personalProgress: new Map(), personalCacheReady: true,
      photos: [{}], pendingPhotos: [], trips: [], myGroups: [], members: new Map(), activeGroupId: null,
      signedUrls: new Map(), releaseCalls: 0, releaseLocalPhotoUrls() { h.releaseCalls++; },
      flushOutbox() {}, flushPhotoQueue() {}, flushTrips() {}, showAccountLock() {},
      LS: { progress:'a',personalProgress:'b',outbox:'c',trips:'d',tripOutbox:'e',group:'f',who:'g',view:'h',owner:'i' },
      localStorage: { removeItem() {} }, sb: null, idbClear: async () => {},
      Billing: { signOut: async () => {} }, accountDeletionInProgress: false };
    h.flushOutbox.requested = h.flushPhotoQueue.requested = h.flushTrips.requested = false;
    vm.createContext(h);
    vm.runInContext(ownerQueueFunctions + signedOutFunction, h);
    await h.handleSignedOut();
    assert.equal(h.releaseCalls, 1, 'sign-out must revoke private local-photo URLs');
    assert.equal(h.photos.length, 0);
    assert.equal(h.passwordRecoveryMode, false);
    assert.equal(h.passwordRecoveryBusy, false);
    assert.equal(h.passwordRecoveryOwnerId, null);
    assert.equal(h.passwordRecoveryAttempt, 1);
    assert.equal(h.pendingPasswordRecovery, null);
    assert.equal(h.recoveryRequestBusy, false);
    assert.equal(h.recoveryRequestAttempt, 1);
  }

  {
    const ownerA = '11111111-1111-4111-8111-111111111111';
    const ownerB = '22222222-2222-4222-8222-222222222222';
    const values = new Map([
      ['deletion', JSON.stringify({ owner_id: ownerA, stage: 'confirmed' })],
      ['upgrade', JSON.stringify({ owner_id: ownerA, stage: 'set-password' })],
      [`oaa.block-labels.${ownerA}`, '["blocked-a"]'],
      [`oaa.block-labels.${ownerB}`, '["blocked-b"]'],
      [`oaa.packs.v2.${ownerA}`, '["all"]'],
      [`oaa.packs.v2.${ownerB}`, '["europe"]'],
    ]);
    const calls = [];
    const h = {
      LS: { accountDeletion: 'deletion', accountUpgrade: 'upgrade' },
      readLS: (key, fallback) => values.has(key) ? JSON.parse(values.get(key)) : fallback,
      localStorage: { removeItem: key => values.delete(key) },
      validAccountOwner: owner => owner === ownerA || owner === ownerB,
      clearAccountUpgrade: owner => {
        const marker = values.has('upgrade') ? JSON.parse(values.get('upgrade')) : null;
        if (marker && marker.owner_id === owner) values.delete('upgrade');
      },
      Billing: { deleteLocalOwner: async owner => {
        calls.push(['billing', owner]); values.delete(`oaa.packs.v2.${owner}`);
      } },
      idbDeleteLocalOwner: async owner => calls.push(['local', owner]),
      idbDeleteQueueOwner: async owner => calls.push(['queue', owner]),
      handleSignedOut: async () => calls.push(['locked']),
      sb: { auth: {
        getSession: async () => ({ data: { session: { user: { id: ownerB } } }, error: null }),
        signOut: async () => { calls.push(['signout']); return { error: null }; },
      } },
      console: { warn() {} },
    };
    vm.createContext(h); vm.runInContext(deleteAccountFunction, h);
    assert.equal(await h.retryConfirmedLocalAccountCleanup(), true);
    assert.deepEqual(calls, [['billing', ownerA], ['local', ownerA], ['queue', ownerA]],
      'confirmed cleanup must not sign out a different persisted account');
    assert.equal(values.has(`oaa.packs.v2.${ownerA}`), false);
    assert.equal(values.has(`oaa.packs.v2.${ownerB}`), true, 'another owner purchase cache remains');
    assert.equal(values.has(`oaa.block-labels.${ownerA}`), false);
    assert.equal(values.has(`oaa.block-labels.${ownerB}`), true, 'another owner block labels remain');
    assert.equal(values.has('upgrade'), false);
    assert.equal(values.has('deletion'), false);

    values.set('deletion', JSON.stringify({ owner_id: ownerA, stage: 'confirmed' }));
    h.sb.auth.getSession = async () => ({ data: { session: { user: { id: ownerA } } }, error: null });
    assert.equal(await h.retryConfirmedLocalAccountCleanup(), true);
    assert(calls.some(call => call[0] === 'signout'), 'the deleted owner persisted session is cleared locally');
    assert(calls.some(call => call[0] === 'locked'), 'the deleted owner cannot reopen the app after cleanup');
  }

  {
    const owner = '11111111-1111-4111-8111-111111111111';
    const queue = [{id:'legacy-unowned',blob:{}}], values = new Map([['owner', owner]]);
    const h = { signOutHandling:false, signOutWork:null, authGeneration:1, userId:owner, accountUser:{}, accountIsAnonymous:false,
      passwordRecoveryMode:false,passwordRecoveryBusy:false,passwordRecoveryOwnerId:null,passwordRecoveryAttempt:0,
      pendingPasswordRecovery:null,recoveryRequestBusy:false,recoveryRequestAttempt:0,
      progress:new Map(),personalProgress:new Map(),personalCacheReady:true,
      photos:[],pendingPhotos:[],trips:[],myGroups:[],members:new Map(),activeGroupId:null,signedUrls:new Map(),
      recs:[],myVotes:new Map(),recBusy:false,pushedName:null,releaseLocalPhotoUrls(){},
      flushOutbox(){},flushPhotoQueue(){},flushTrips(){},showAccountLock(){},accountDeletionInProgress:false,
      LS:{progress:'p',personalProgress:'pp',outbox:'o',trips:'t',tripOutbox:'to',group:'g',who:'w',view:'v',owner:'owner'},
      localStorage:{getItem:key=>values.get(key)||null,removeItem:key=>values.delete(key)},
      idb:async()=>({transaction:()=>{const tx={error:null};tx.objectStore=()=>({openCursor:()=>{
        const req={};let i=0;const advance=()=>queueMicrotask(()=>{if(i>=queue.length){req.result=null;req.onsuccess();
          queueMicrotask(()=>tx.oncomplete());return;}const at=i++;req.result={value:queue[at],update:value=>{queue[at]=value;},continue:advance};req.onsuccess();});
        advance();return req;}});return tx;}}),queueMicrotask,idbClear:async()=>{},Billing:{signOut:async()=>{}},sb:null,
      console:{warn(){}}};
    h.flushOutbox.requested=h.flushPhotoQueue.requested=h.flushTrips.requested=false;
    vm.createContext(h);vm.runInContext(ownerQueueFunctions+signedOutFunction,h);
    await h.handleSignedOut();
    assert.equal(queue[0].owner_id,owner,'explicit sign-out stamps legacy queue rows to the outgoing owner');
    assert.equal(values.has('owner'),false,'owner marker is removed only after queue attribution commits');
  }

  {
    const rows = [{id:'legacy-unowned',blob:{}}], saved = [];
    const h = {userId:'22222222-2222-4222-8222-222222222222',LS:{owner:'owner'},
      localStorage:{getItem:()=>null},saveLocalPhoto:async item=>saved.push(item),idbDelete:async()=>{},
      idbPut:async()=>{},idbLocalAll:async()=>[],idb:async()=>({transaction:()=>({objectStore:()=>({
        getAll:()=>{const req={};queueMicrotask(()=>{req.result=rows;req.onsuccess();});return req;},
      })})}),queueMicrotask};
    vm.createContext(h);vm.runInContext(idbAllFunction,h);
    assert.equal(JSON.stringify(await h.idbAll()),'[]');
    assert.deepEqual(saved,[],'a new account cannot claim an unowned row without the matching legacy owner marker');
  }

  {
    const ownerA = '11111111-1111-4111-8111-111111111111';
    const ownerB = '22222222-2222-4222-8222-222222222222';
    const queued = [{ id: 'legacy-a' }, { id: 'owned-a', owner_id: ownerA }];
    const h = { userId: ownerB, queued, progress: new Map(), personalProgress: new Map(),
      personalCacheReady: true, trips: [], who: 'A', activeGroupId: null, progressView: 'personal',
      LS: { owner: 'owner', progress: 'p', personalProgress: 'pp', outbox: 'o', trips: 't',
        tripOutbox: 'to', group: 'g', who: 'w', view: 'v', accountUpgrade: 'u' },
      localStorage: { value: ownerA, getItem() { return this.value; }, setItem(_k, v) { this.value = v; }, removeItem() {} },
      idb: async () => ({ transaction: () => {
        const tx = { error: null, abort() { tx.onabort(); } };
        tx.objectStore = () => ({ openCursor: () => {
          const req = {}; let index = 0;
          const advance = () => queueMicrotask(() => {
            if (index >= queued.length) { req.result = null; req.onsuccess(); queueMicrotask(() => tx.oncomplete()); return; }
            const current = index++;
            req.result = { value: queued[current], update: value => { queued[current] = value; }, continue: advance };
            req.onsuccess();
          });
          advance(); return req;
        } });
        return tx;
      } }),
      readLS: (_key, fallback) => fallback, writeLS() {}, nextQueueRevision: () => 1,
      loadLocalProgress() {}, loadLocalTrips() {}, queueMicrotask };
    vm.createContext(h); vm.runInContext(bindFunction, h);
    await h.bindLocalDataToUser();
    assert.deepEqual(queued.map(x => x.owner_id), [ownerA, ownerA],
      'A queue rows must survive and legacy rows must be stamped to A during A to B');
    h.userId = ownerA;
    await h.bindLocalDataToUser();
    assert.deepEqual(queued.filter(x => x.owner_id === ownerA).map(x => x.id), ['legacy-a', 'owned-a'],
      'A queue rows must still be recoverable after B to A');
  }

  {
    let resolveDownscale;
    const h = harness();
    const owner = '11111111-1111-4111-8111-111111111111', values = new Map();
    h.downscale = async () => new Promise(resolve => { resolveDownscale = resolve; });
    Object.assign(h, {
      userId: owner,
      prompt: () => 'DELETE', setTimeout, removeOwnedStorage: async () => {},
      idbDeleteLocalOwner: async () => h.calls.localDelete.push(['owner-a', 'all']),
      idbDeleteQueueOwner: async () => h.calls.localDelete.push(['owner-a', 'queue']),
      handleSignedOut: async () => {},
      LS: { accountDeletion: 'deletion' },
      readLS: (key, fallback) => values.has(key) ? JSON.parse(values.get(key)) : fallback,
      writeLS: (key, value) => values.set(key, JSON.stringify(value)),
      localStorage: { removeItem: key => values.delete(key) }, clearAccountUpgrade() {},
      Billing: { deleteLocalOwner: async () => {} },
      sb: { rpc: async () => ({ error: null }), auth: { signOut: async () => {} } },
    });
    vm.runInContext(ownerQueueFunctions + deleteAccountFunction, h);
    const adding = h.addPhotos(7, [{ type: 'image/jpeg', name: 'slow.jpg', lastModified: 0 }]);
    await new Promise(resolve => setImmediate(resolve));
    const deleting = h.deleteAccount();
    resolveDownscale({ blob: { size: 12 }, width: 2, height: 2 });
    await Promise.all([adding, deleting]);
    assert.deepEqual(h.calls.queuePut, [], 'a decode invalidated by deletion must never enqueue');
    assert.deepEqual(h.calls.localDelete, [['owner-a', 'all'], ['owner-a', 'queue']],
      'deletion cleanup runs after add work quiesces and removes queued blobs');
  }

  {
    let resolveSigned;
    const response = new Promise(resolve => { resolveSigned = resolve; });
    const h = { userId: 'owner-a', authGeneration: 3, online: true, BUCKET: 'memories',
      SIGNED_TTL: 7200, signedUrls: new Map(), Date,
      console: { warn() {} }, sb: { storage: { from: () => ({ createSignedUrls: async () => response }) } } };
    vm.createContext(h); vm.runInContext(signedUrlFunction, h);
    const loading = h.ensureSignedUrls(['owner-a/legacy.jpg']);
    h.userId = 'owner-b'; h.authGeneration = 4;
    resolveSigned({ data: [{ path: 'owner-a/legacy.jpg', signedUrl: 'private-a' }], error: null });
    await loading;
    assert.equal(h.signedUrls.size, 0, 'a late cloud signing response must not cross an account switch');
  }

  {
    const local = { id: 'native-local', local: true, owner_id: 'owner-a',
      native_path: 'wayfinder/photos/owner-a/native-local.jpg', adventure_id: 7 };
    const calls = { local: 0, signed: [] };
    const nodes = {
      '#lbImg': { src: '' },
      '#lbTitle': { textContent: '' },
      '#lbSub': { textContent: '' },
      '#lbDelete': { dataset: {}, classList: {
        hidden: null, toggle(_name, value) { this.hidden = value; },
      } },
    };
    const h = {
      userId: 'owner-a', authGeneration: 3,
      lightbox: { list: [local], index: 0 },
      ADV: [{ id: 7, title: 'Local memory', place: 'Fixture place' }],
      Date,
      safeTitle: adventure => adventure.title,
      $: selector => nodes[selector],
      $$: () => [],
      closeLightbox() {},
      photoSrc: photo => photo.src || '',
      ensureLocalPhotoUrls: async items => {
        calls.local++;
        items[0].src = 'blob:native-local';
      },
      ensureSignedUrls: async paths => calls.signed.push(paths),
    };
    vm.createContext(h);
    vm.runInContext(lightboxFunction, h);
    await h.showLightbox();
    assert.equal(calls.local, 1, 'a reloaded native photo is read from app-private storage');
    assert.deepEqual(calls.signed, [], 'a native path is never sent to the cloud signer');
    assert.equal(nodes['#lbImg'].src, 'blob:native-local');
    assert.equal(nodes['#lbDelete'].classList.hidden, false, 'a local photo remains deletable');

    const cloud = { id: 'historical-cloud', local: false, storage_path: 'legacy/cloud.jpg',
      adventure_id: 7 };
    h.lightbox = { list: [cloud], index: 0 };
    h.ensureSignedUrls = async paths => {
      calls.signed.push(paths);
      cloud.src = 'https://signed.example/cloud.jpg';
    };
    await h.showLightbox();
    assert.equal(JSON.stringify(calls.signed), JSON.stringify([['legacy/cloud.jpg']]));
    assert.equal(nodes['#lbDelete'].classList.hidden, true,
      'a preserved historical cloud original does not show an unavailable Delete action');

    calls.signed = [];
    const unavailableCloud = { id: 'unavailable-cloud', local: false, adventure_id: 7 };
    h.lightbox = { list: [unavailableCloud], index: 0 };
    await h.showLightbox();
    assert.deepEqual(calls.signed, [], 'an absent cloud path is never sent to the signer');
  }

  {
    let finishRead;
    const read = new Promise(resolve => { finishRead = resolve; });
    const local = { id: 'late-local', local: true, owner_id: 'owner-a',
      native_path: 'wayfinder/photos/owner-a/late-local.jpg', adventure_id: 7 };
    const nodes = {
      '#lbImg': { src: 'cleared' },
      '#lbTitle': { textContent: 'cleared' },
      '#lbSub': { textContent: 'cleared' },
      '#lbDelete': { dataset: { photo: '' }, classList: { toggle() {
        throw new Error('stale delete UI remounted');
      } } },
    };
    const h = {
      userId: 'owner-a', authGeneration: 4,
      lightbox: { list: [local], index: 0 },
      ADV: [{ id: 7, title: 'Private title', place: 'Private place' }],
      Date,
      safeTitle: adventure => adventure.title,
      $: selector => nodes[selector],
      $$: () => [],
      closeLightbox() {},
      photoSrc: () => '',
      ensureLocalPhotoUrls: async () => read,
      ensureSignedUrls: async () => {},
    };
    vm.createContext(h);
    vm.runInContext(lightboxFunction, h);
    const opening = h.showLightbox();
    h.userId = 'owner-b';
    h.authGeneration = 5;
    finishRead();
    await opening;
    assert.equal(nodes['#lbImg'].src, 'cleared');
    assert.equal(nodes['#lbTitle'].textContent, 'cleared');
    assert.equal(nodes['#lbSub'].textContent, 'cleared');
    assert.equal(nodes['#lbDelete'].dataset.photo, '',
      'a late native read cannot remount lightbox UI after an account switch');
  }

  {
    const h = harness();
    h.crypto.randomUUID = undefined;
    await h.addPhotos(7, [{ type: 'image/jpeg', name: 'fallback.jpg', lastModified: 0 }]);
    assert.match(h.calls.queuePut[0], /^photo_[a-z0-9]+_[a-z0-9]+$/,
      'fallback photo IDs must be safe for the native adapter path');
  }

  {
    const rows = [{ id: 'owned-a', owner_id: 'owner-a', blob: {} },
      { id: 'legacy-a', blob: {} }, { id: 'owned-b', owner_id: 'owner-b', blob: {} }];
    const h = { rows, LS: { owner: 'owner' }, localStorage: { getItem: () => 'owner-a' },
      idbWrite: async (_store, operation) => new Promise((resolve, reject) => {
        const req = operation({ delete: id => {
          const request = {};
          queueMicrotask(() => {
            const at = rows.findIndex(x => x.id === id); if (at >= 0) rows.splice(at, 1);
            request.onsuccess?.(); resolve();
          });
          return request;
        } });
        req.onerror = () => reject(req.error);
      }),
      idb: async () => ({ transaction: (_store, mode) => ({ objectStore: () => ({
        getAll: () => { const req = {}; queueMicrotask(() => { req.result = [...rows]; req.onsuccess(); }); return req; },
        delete: id => { const req = {}; queueMicrotask(() => {
          const at = rows.findIndex(x => x.id === id); if (at >= 0) rows.splice(at, 1); req.onsuccess();
        }); return req; },
      }) }) }), queueMicrotask };
    vm.createContext(h); vm.runInContext(queueDeleteFunction, h);
    await h.idbDeleteQueueOwner('owner-a');
    assert.deepEqual(rows.map(x => x.id), ['owned-b'],
      'account deletion removes owner-stamped and attributable legacy queue blobs only');
  }

  {
    const ownerA = '11111111-1111-4111-8111-111111111111';
    const ownerB = '22222222-2222-4222-8222-222222222222';
    const h = { userId: ownerB, progress: new Map(), personalProgress: new Map(), personalCacheReady: true,
      trips: [], who: 'A', activeGroupId: null, progressView: 'personal',
      LS: { owner: 'owner', progress: 'p', personalProgress: 'pp', outbox: 'o', trips: 't',
        tripOutbox: 'to', group: 'g', who: 'w', view: 'v', accountUpgrade: 'u' },
      localStorage: { value: ownerA, getItem() { return this.value; },
        setItem(_k, v) { this.value = v; }, removeItem() {} },
      idb: async () => ({ transaction: () => {
        const tx = { error: new Error('write failed'), abort() { queueMicrotask(() => tx.onabort()); } };
        tx.objectStore = () => ({ openCursor: () => {
          const req = {}; queueMicrotask(() => { req.error = tx.error; req.onerror(); }); return req;
        } }); return tx;
      } }), readLS: (_key, fallback) => fallback, writeLS() {}, nextQueueRevision: () => 1,
      loadLocalProgress() {}, loadLocalTrips() {}, queueMicrotask };
    vm.createContext(h); vm.runInContext(bindFunction, h);
    await assert.rejects(h.bindLocalDataToUser(), /write failed/);
    assert.equal(h.localStorage.value, ownerA,
      'failed legacy queue migration must not bind its uncertain rows to B');
  }

  {
    function abortingDb() {
      return { transaction: () => {
        const tx = { error: null, abort() {} };
        const request = { error: null };
        const operation = () => {
          queueMicrotask(() => {
            if (request.onsuccess) request.onsuccess();
            tx.error = new Error('late transaction abort');
            tx.onabort();
          });
          return request;
        };
        tx.objectStore = () => ({ put: operation, delete: operation });
        return tx;
      } };
    }
    const h = { LOCAL_PHOTO_STORE: 'local-photos', idb: async () => abortingDb(), queueMicrotask,
      localPhotoRecord: item => ({ ...item, owner_id: item.owner_id, user_id: item.owner_id,
        local: true, local_key: `${item.owner_id}:${item.id}` }) };
    const localDeleteFunction = section('async function idbLocalDelete(ownerId, id)', 'async function idbDeleteQueueOwner(ownerId)');
    vm.createContext(h);
    vm.runInContext(`${idbWriteFunctions}\n${idbLocalPutFunction}\n${localDeleteFunction}`, h);
    await assert.rejects(h.idbPut({ id: 'queued' }), /late transaction abort/);
    await assert.rejects(h.idbDelete('queued'), /late transaction abort/);
    await assert.rejects(h.idbLocalPut({ id: 'local', owner_id: 'owner-a' }), /late transaction abort/);
    await assert.rejects(h.idbLocalDelete('owner-a', 'local'), /late transaction abort/);
  }

  assert.match(source, /indexedDB\.open\('oaa-photos', 2\)/);
  assert.match(source, /filter\(row => row\.owner_id === ownerId\)/);
  assert.match(source, /Browser storage is best effort; clearing site data removes it/);
  assert.match(source, /browser retention is best effort/i);
  console.log('PASS: 27 device-local photo, deletion, native transaction, privacy and account-scope checks');
})().catch(error => {
  console.error(error);
  process.exitCode = 1;
});
