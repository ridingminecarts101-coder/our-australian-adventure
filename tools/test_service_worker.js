'use strict';

// Executes the real service worker in a VM with controlled Cache Storage and
// network primitives. No browser profile, service worker, or network is used.
const assert = require('assert');
const fs = require('fs');
const vm = require('vm');

const SOURCE = fs.readFileSync('sw.js', 'utf8');
const BASE = 'https://example.test/our-australian-adventure/';
const CURRENT_CACHE = SOURCE.match(/CACHE_VERSION\s*=\s*['"]([^'"]+)/)?.[1];
assert(CURRENT_CACHE, 'could not read CACHE_VERSION from sw.js');

function deferred() {
  let resolve, reject;
  const promise = new Promise((yes, no) => { resolve = yes; reject = no; });
  return { promise, resolve, reject };
}

function requestUrl(value) {
  const raw = typeof value === 'string' ? value : value.url;
  return new URL(raw, BASE).href;
}

class WorkerRequest {
  constructor(input, init = {}) {
    this.url = requestUrl(input);
    this.method = init.method || input?.method || 'GET';
    this.mode = init.mode || input?.mode || 'cors';
    this.cache = init.cache || input?.cache || 'default';
  }
}

function createHarness(options = {}) {
  const listeners = new Map();
  const added = [];
  const deleted = [];
  const puts = [];
  let skipWaitingCalls = 0;
  let claimCalls = 0;

  const cache = {
    async add(request) {
      added.push(request);
      if (options.add) return options.add(request);
    },
    async addAll(requests) {
      await Promise.all(requests.map(request => cache.add(request)));
    },
    async match(request) {
      return options.match ? options.match(request) : undefined;
    },
    async put(request, response) {
      puts.push({ request, response });
      if (options.put) return options.put(request, response);
    },
  };
  const caches = {
    open: async () => cache,
    keys: async () => options.cacheNames || [],
    delete: async name => { deleted.push(name); return true; },
  };
  const self = {
    location: { origin: new URL(BASE).origin },
    addEventListener(type, listener) { listeners.set(type, listener); },
    skipWaiting: async () => { skipWaitingCalls += 1; },
    clients: {
      claim: async () => { claimCalls += 1; },
      matchAll: async () => [],
      openWindow: async () => {},
    },
  };
  const context = {
    self, caches, Request: WorkerRequest, Response, URL,
    fetch: options.fetch || (async () => new Response('network')),
    console,
  };
  vm.createContext(context);
  vm.runInContext(SOURCE, context, { filename: 'sw.js' });

  function dispatch(type, fields = {}) {
    const waits = [];
    let response;
    const event = {
      ...fields,
      waitUntil(promise) { waits.push(Promise.resolve(promise)); },
      respondWith(promise) { response = Promise.resolve(promise); },
    };
    assert(listeners.has(type), `worker has no ${type} listener`);
    listeners.get(type)(event);
    return { waits, response };
  }

  return {
    dispatch, added, deleted, puts,
    get skipWaitingCalls() { return skipWaitingCalls; },
    get claimCalls() { return claimCalls; },
  };
}

async function oneTurn() {
  await new Promise(resolve => setImmediate(resolve));
}

async function testInstallBypassesHttpCache() {
  const h = createHarness();
  const event = h.dispatch('install');
  await Promise.all(event.waits);
  assert(h.added.length > 5, 'install should cache the application shell');
  assert(h.added.some(r => r.url.endsWith('/app.js')), 'application script is critical shell content');
  assert(h.added.every(r => r.cache === 'reload'), 'every install fetch must bypass the HTTP cache');
  assert.equal(h.skipWaitingCalls, 1);
}

async function testFailedInstallKeepsOldWorker() {
  const h = createHarness({
    add: request => {
      if (request.url.endsWith('/app.js')) throw new Error('critical download failed');
    },
  });
  const event = h.dispatch('install');
  await assert.rejects(Promise.all(event.waits), /critical download failed/);
  assert.equal(h.skipWaitingCalls, 0, 'partial cache must never activate');
}

async function testActivationPreservesOtherApps() {
  const h = createHarness({
    cacheNames: ['wayfinder-v1', 'other-pwa-v9', CURRENT_CACHE],
  });
  const event = h.dispatch('activate');
  await Promise.all(event.waits);
  assert.deepEqual(h.deleted, ['wayfinder-v1']);
  assert.equal(h.claimCalls, 1);
}

async function testRuntimeRefreshWaitsForCacheWrite() {
  const cached = new Response('cached app');
  const write = deferred();
  let networkInit;
  const h = createHarness({
    match: request => requestUrl(request).endsWith('/app.js') ? cached : undefined,
    fetch: async (_request, init) => {
      networkInit = init;
      return new Response('fresh app');
    },
    put: () => write.promise,
  });
  const request = { method: 'GET', mode: 'cors', url: `${BASE}app.js` };
  const event = h.dispatch('fetch', { request });
  assert.equal(await (await event.response).text(), 'cached app');
  assert.equal(networkInit.cache, 'no-cache');
  assert.equal(event.waits.length, 1, 'cached refresh must extend worker lifetime');

  let refreshFinished = false;
  event.waits[0].then(() => { refreshFinished = true; });
  await oneTurn();
  assert.equal(refreshFinished, false, 'refresh lifetime must include Cache.put');
  assert.equal(h.puts.length, 1);
  write.resolve();
  await event.waits[0];
  assert.equal(refreshFinished, true);
}

async function testCachedOfflineResponse() {
  const cached = new Response('offline app');
  const h = createHarness({
    match: request => requestUrl(request).endsWith('/app.js') ? cached : undefined,
    fetch: async () => { throw new Error('offline'); },
  });
  const event = h.dispatch('fetch', {
    request: { method: 'GET', mode: 'cors', url: `${BASE}app.js` },
  });
  assert.equal(await (await event.response).text(), 'offline app');
  await Promise.all(event.waits);
}

async function testOfflineNavigationFallbackAnd503() {
  const fallback = new Response('offline shell');
  const withShell = createHarness({
    match: request => requestUrl(request).endsWith('/index.html') ? fallback : undefined,
    fetch: async () => { throw new Error('offline'); },
  });
  let event = withShell.dispatch('fetch', {
    request: { method: 'GET', mode: 'navigate', url: `${BASE}deep/link` },
  });
  let response = await event.response;
  assert.equal(response.status, 200);
  assert.equal(await response.text(), 'offline shell');

  const withoutShell = createHarness({
    fetch: async () => { throw new Error('offline'); },
  });
  event = withoutShell.dispatch('fetch', {
    request: { method: 'GET', mode: 'navigate', url: `${BASE}deep/link` },
  });
  response = await event.response;
  assert.equal(response.status, 503);
  assert.equal(await response.text(), 'Offline');
}

async function main() {
  const tests = [
    testInstallBypassesHttpCache,
    testFailedInstallKeepsOldWorker,
    testActivationPreservesOtherApps,
    testRuntimeRefreshWaitsForCacheWrite,
    testCachedOfflineResponse,
    testOfflineNavigationFallbackAnd503,
  ];
  for (const test of tests) {
    await test();
    console.log(`PASS ${test.name}`);
  }
  console.log(`${tests.length} service worker behavior tests passed`);
}

main().catch(error => {
  console.error(error);
  process.exitCode = 1;
});
