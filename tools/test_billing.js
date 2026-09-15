'use strict';

const assert = require('assert');
const fs = require('fs');
const vm = require('vm');

const source = fs.readFileSync('store.js', 'utf8');
const appSource = fs.readFileSync('app.js', 'utf8').replace(/\r\n?/g, '\n');

function arrowCallbackAfter(marker) {
  const markerAt = appSource.indexOf(marker);
  assert(markerAt >= 0, `missing app integration marker: ${marker}`);
  const start = appSource.indexOf('() => {', markerAt);
  assert(start >= 0, `missing callback after: ${marker}`);
  const brace = appSource.indexOf('{', start);
  let depth = 0;
  for (let i = brace; i < appSource.length; i++) {
    if (appSource[i] === '{') depth++;
    if (appSource[i] === '}' && --depth === 0) return appSource.slice(start, i + 1);
  }
  throw new Error(`unterminated callback after: ${marker}`);
}

function functionAt(marker, token) {
  const markerAt = appSource.indexOf(marker);
  assert(markerAt >= 0, `missing app integration marker: ${marker}`);
  const start = appSource.indexOf(token, markerAt);
  assert(start >= 0, `missing function after: ${marker}`);
  const brace = appSource.indexOf('{', start);
  let depth = 0;
  for (let i = brace; i < appSource.length; i++) {
    if (appSource[i] === '{') depth++;
    if (appSource[i] === '}' && --depth === 0) return appSource.slice(start, i + 1);
  }
  throw new Error(`unterminated function after: ${marker}`);
}

async function settle() {
  await new Promise(resolve => setImmediate(resolve));
}

async function testStoreFeedback(accountA, accountB) {
  const markup = fs.readFileSync('index.html', 'utf8');
  assert.match(markup, /id="storeStatus"[^>]*role="status"[^>]*aria-live="polite"/,
    'store outcome remains visible beside Restore');
  const status = { textContent: '' };
  const calls = { toasts: [], renders: 0 };
  let buyResult = { ok: false, reason: 'access_pending' };
  let restoreResult = { ok: true, restored: [] };
  const context = {
    userId: accountA, authGeneration: 3, storeStatusOwner: null,
    $: selector => selector === '#storeStatus' ? status : null,
    Billing: { buy: async () => buyResult, restore: async () => restoreResult },
    toast: message => calls.toasts.push(message),
    renderAll: () => { calls.renders++; }, openId: null,
    renderSheet() {},
  };
  vm.createContext(context);
  vm.runInContext(functionAt('function setStoreStatus(', 'function setStoreStatus('), context);
  vm.runInContext(functionAt('async function buyPack(', 'async function buyPack('), context);
  const restoreHandler = vm.runInContext(`(${functionAt("$('#restoreBtn').onclick = async () => {", 'async () => {')})`, context);

  await context.buyPack('oceania');
  assert.match(status.textContent, /access is not confirmed.*Gems remain locked/,
    'resolved store response without entitlement leaves durable diagnostic, not false unlock');
  assert.equal(calls.renders, 0);
  restoreResult = { ok: true, restored: [] };
  await restoreHandler();
  assert.match(status.textContent, /No active paid collections.*gems remain locked/,
    'empty restore is a visible account diagnostic');
  buyResult = { ok: true, slug: 'oceania' };
  await context.buyPack('oceania');
  assert.match(status.textContent, /Purchase verified.*Collection unlocked/);
  assert.equal(calls.renders, 2, 'verified restore/buy repaint the store');

  let finishOldBuy;
  buyResult = new Promise(resolve => { finishOldBuy = resolve; });
  const oldBuy = context.buyPack('africa');
  context.userId = accountB;
  context.authGeneration++;
  const beforeOldReturn = status.textContent;
  finishOldBuy({ ok: false, reason: 'access_pending' });
  await oldBuy;
  assert.equal(status.textContent, beforeOldReturn,
    'an old account response must not show a purchase result on the new account');
}

async function testAppLifecycleHooks(accountA, accountB) {
  const calls = { foreground: 0, renders: 0, warnings: 0 };
  let foregroundResult = Promise.resolve([]);
  const context = {
    Billing: {
      onChange: null,
      _appUserId: accountA,
      foreground() { calls.foreground++; return foregroundResult; },
    },
    userId: accountA,
    authGeneration: 7,
    passwordRecoveryMode: false,
    accountDeletionInProgress: false,
    document: { hidden: false },
    renderAll() { calls.renders++; },
    flushOutbox() {}, pullProgress() {},
    pullPhotos() { return new Promise(() => {}); },
    flushPhotoQueue() {}, flushTrips() {},
    sb: null, realtimeOk: true, resubscribeRealtime() {},
    console: { warn() { calls.warnings++; } },
  };
  vm.createContext(context);

  const onChange = arrowCallbackAfter('Billing.onChange =');
  vm.runInContext(`Billing.onChange = ${onChange}`, context);
  context.Billing.onChange();
  assert.equal(calls.renders, 1, 'active-account CustomerInfo changes must repaint access');
  for (const blockedState of [
    { userId: null },
    { userId: accountB },
    { userId: accountA, passwordRecoveryMode: true },
    { userId: accountA, passwordRecoveryMode: false, accountDeletionInProgress: true },
  ]) {
    Object.assign(context, { userId: accountA, passwordRecoveryMode: false,
      accountDeletionInProgress: false }, blockedState);
    context.Billing.onChange();
  }
  assert.equal(calls.renders, 1,
    'owner mismatch, signed-out, recovery and deletion states must suppress entitlement repaint');

  Object.assign(context, { userId: accountA, authGeneration: 7,
    passwordRecoveryMode: false, accountDeletionInProgress: false });
  const visible = arrowCallbackAfter("addEventListener('visibilitychange', () => {\n    if (document.hidden) return;\n    const billingOwner");
  const visibleHandler = vm.runInContext(`(${visible})`, context);
  foregroundResult = Promise.resolve([]);
  visibleHandler();
  await settle();
  assert.equal(calls.foreground, 1);
  assert.equal(calls.renders, 2, 'a current foreground refresh repaints access');

  let releaseOld;
  foregroundResult = new Promise(resolve => { releaseOld = resolve; });
  visibleHandler();
  context.userId = accountB;
  context.authGeneration++;
  releaseOld([]);
  await settle();
  assert.equal(calls.renders, 2, 'an Account A foreground result must not repaint Account B');

  context.userId = accountB;
  context.passwordRecoveryMode = true;
  foregroundResult = Promise.resolve([]);
  visibleHandler();
  await settle();
  context.passwordRecoveryMode = false;
  context.accountDeletionInProgress = true;
  visibleHandler();
  await settle();
  assert.equal(calls.renders, 2, 'recovery and deletion suppress foreground billing repaint');

  context.accountDeletionInProgress = false;
  foregroundResult = Promise.reject(new Error('offline'));
  visibleHandler();
  await settle();
  assert.equal(calls.warnings, 1, 'foreground failure is observed without repainting');
}

function harness({ native = false, platform = 'web', key = '', confirmResult = true,
                   hostname = 'localhost' } = {}) {
  const values = new Map();
  const calls = [];
  const customerInfo = {
    entitlements: { active: {} },
    allPurchasedProductIdentifiers: [],
  };
  const state = {
    customerInfo, listeners: new Map(), listenerHistory: [], nextListener: 0,
    invalidateGate: null, removeGate: null, configureGate: null,
    purchaseGate: null, restoreGate: null,
    configureFailures: 0, cancelNextPurchase: false, warnings: [],
  };
  const purchases = {
    async configure(options) {
      calls.push(['configure', options]);
      if (state.configureFailures > 0) {
        state.configureFailures--;
        throw new Error('configure failed');
      }
      if (state.configureGate) await state.configureGate;
    },
    async getCustomerInfo() { calls.push(['getCustomerInfo']); return { customerInfo: state.customerInfo }; },
    async getProducts(options) {
      assert.equal(options.type, 'NON_SUBSCRIPTION',
        'RevenueCat getProducts must use the v13 GetProductOptions type field');
      calls.push(['getProducts', options]);
      return {
        products: options.productIdentifiers.map(identifier => ({ identifier, priceString: 'local price' })),
      };
    },
    async purchaseStoreProduct({ product }) {
      calls.push(['purchase', product.identifier]);
      if (state.purchaseGate) await state.purchaseGate;
      if (state.cancelNextPurchase) {
        state.cancelNextPurchase = false;
        throw { code: 1, userCancelled: true };
      }
      const slug = product.identifier.slice('app.wayfinder.mobile.gems.'.length).replace(/_/g, '-');
      state.customerInfo.entitlements.active[slug] = { identifier: slug, isActive: true };
      return { customerInfo: state.customerInfo };
    },
    async restorePurchases() {
      calls.push(['restore']);
      if (state.restoreGate) await state.restoreGate;
      return { customerInfo: state.customerInfo };
    },
    async invalidateCustomerInfoCache() {
      calls.push(['invalidateCustomerInfoCache']);
      if (state.invalidateGate) await state.invalidateGate;
    },
    async addCustomerInfoUpdateListener(listener) {
      const id = `listener-${++state.nextListener}`;
      state.listeners.set(id, listener); state.listenerHistory.push(listener);
      calls.push(['addListener', id]); return id;
    },
    async removeCustomerInfoUpdateListener({ listenerToRemove }) {
      calls.push(['removeListener', listenerToRemove]);
      if (state.removeGate) await state.removeGate;
      return { wasRemoved: state.listeners.delete(listenerToRemove) };
    },
    async logIn({ appUserID }) { calls.push(['logIn', appUserID]); return { customerInfo: state.customerInfo }; },
    async logOut() { calls.push(['logOut']); },
  };
  const context = {
    console: { ...console, warn(...args) { state.warnings.push(args); } },
    location: { hostname },
    confirm() { calls.push(['confirm']); return confirmResult; },
    localStorage: {
      getItem(name) { return values.has(name) ? values.get(name) : null; },
      setItem(name, value) { values.set(name, String(value)); },
      removeItem(name) { values.delete(name); },
    },
    OAA_CONFIG: { revenueCat: { android: platform === 'android' ? key : '', ios: platform === 'ios' ? key : '' } },
  };
  context.window = context;
  context.Capacitor = {
    isNativePlatform: () => native,
    getPlatform: () => platform,
    Plugins: { Purchases: purchases },
  };
  vm.createContext(context);
  vm.runInContext(source, context, { filename: 'store.js' });
  return { context, calls, values, state };
}

async function main() {
  const browser = harness();
  const accountA = 'aaaaaaaa-aaaa-4aaa-8aaa-aaaaaaaaaaaa';
  const accountB = 'bbbbbbbb-bbbb-4bbb-8bbb-bbbbbbbbbbbb';
  await testAppLifecycleHooks(accountA, accountB);
  await testStoreFeedback(accountA, accountB);
  browser.values.set(`oaa.packs.v2.${accountA}`, JSON.stringify(['all']));
  await vm.runInContext(`Billing.init('${accountA}')`, browser.context);
  assert.equal(vm.runInContext("ownsPack('all')", browser.context), true);
  await vm.runInContext(`Billing.init('${accountB}')`, browser.context);
  assert.equal(vm.runInContext("ownsPack('all')", browser.context), false,
    'account B must not inherit account A cached purchases');

  assert.equal(vm.runInContext('previewAvailable()', browser.context), true);
  const simulated = await vm.runInContext("Billing.buy('oceania')", browser.context);
  assert.deepEqual({ ...simulated }, { ok: true, slug: 'oceania', simulated: true });
  assert.equal(browser.calls.filter(([name]) => name === 'confirm').length, 1);

  const publicWeb = harness({ hostname: 'wayfinder.example' });
  assert.equal(vm.runInContext('previewAvailable()', publicWeb.context), false);
  const webUnavailable = await vm.runInContext("Billing.buy('oceania')", publicWeb.context);
  assert.equal(webUnavailable.ok, false);
  assert.match(webUnavailable.reason, /mobile app/);
  assert.equal(publicWeb.calls.some(([name]) => name === 'confirm'), false);

  const noKey = harness({ native: true, platform: 'android' });
  assert.equal(vm.runInContext('previewAvailable()', noKey.context), false);
  const unavailable = await vm.runInContext("Billing.buy('oceania')", noKey.context);
  assert.equal(unavailable.ok, false);
  assert.match(unavailable.reason, /not available/);
  assert.equal(noKey.calls.some(([name]) => name === 'confirm'), false);
  const unavailableRestore = await vm.runInContext('Billing.restore()', noKey.context);
  assert.equal(unavailableRestore.ok, false);
  assert.match(unavailableRestore.reason, /not available/);
  assert.equal(noKey.calls.some(([name]) => name === 'restore'), false);

  // Exercise every exact permanent product with one isolated native customer.
  // This is a StoreKit/RevenueCat mock, not a claim that Apple settled a sale.
  const purchaseSet = harness({ native: true, platform: 'ios', key: 'appl_PUBLIC_TEST_KEY' });
  await vm.runInContext(`Billing.init('${accountA}')`, purchaseSet.context);
  purchaseSet.state.cancelNextPurchase = true;
  const cancelled = await vm.runInContext("Billing.buy('africa')", purchaseSet.context);
  assert.equal(cancelled.ok, false);
  assert.equal(cancelled.reason, 'cancelled');
  assert.equal(vm.runInContext('owned.size', purchaseSet.context), 0,
    'cancelled StoreKit sheet must grant no pack');
  const allSlugs = [...vm.runInContext('PACKS.map(p => p.slug)', purchaseSet.context)];
  assert.equal(allSlugs.length, 8);
  for (const slug of allSlugs) {
    const result = await vm.runInContext(`Billing.buy('${slug}')`, purchaseSet.context);
    assert.equal(result.ok, true, `${slug} mock purchase should return success`);
    assert.equal(result.slug, slug);
    assert.equal(vm.runInContext(`owned.has('${slug}')`, purchaseSet.context), true,
      `${slug} must have its active entitlement`);
  }
  const purchasedIds = purchaseSet.calls.filter(([name]) => name === 'purchase').map(([, id]) => id);
  assert.equal(new Set(purchasedIds).size, 8, 'eight distinct store IDs must be purchased');
  for (const slug of allSlugs) {
    assert(purchasedIds.includes(`app.wayfinder.mobile.gems.${slug.replace(/-/g, '_')}`));
  }

  const mismatch = harness({ native: true, platform: 'ios', key: 'appl_PUBLIC_TEST_KEY' });
  await vm.runInContext(`Billing.init('${accountA}')`, mismatch.context);
  mismatch.context.Capacitor.Plugins.Purchases.getProducts = async () => ({
    products: [{ identifier: 'app.wayfinder.mobile.gems.africa', priceString: 'local price' }],
  });
  const wrongProduct = await vm.runInContext("Billing.buy('oceania')", mismatch.context);
  assert.equal(wrongProduct.ok, false);
  assert.equal(mismatch.calls.some(([name]) => name === 'purchase'), false,
    'a mismatched product response must never open the wrong Apple sale');

  const overlapping = harness({ native: true, platform: 'ios', key: 'appl_PUBLIC_TEST_KEY' });
  await vm.runInContext(`Billing.init('${accountA}')`, overlapping.context);
  let releasePurchase;
  overlapping.state.purchaseGate = new Promise(resolve => { releasePurchase = resolve; });
  const activeBuy = vm.runInContext("Billing.buy('asia')", overlapping.context);
  await settle();
  assert.equal(vm.runInContext('Billing.busy', overlapping.context), true);
  const blockedRestore = await vm.runInContext('Billing.restore()', overlapping.context);
  const blockedBuy = await vm.runInContext("Billing.buy('africa')", overlapping.context);
  assert.equal(blockedRestore.reason, 'store_busy');
  assert.equal(blockedBuy.reason, 'store_busy');
  assert.equal(overlapping.calls.filter(([name]) => name === 'restore').length, 0);
  assert.equal(overlapping.calls.filter(([name]) => name === 'purchase').length, 1);
  releasePurchase();
  assert.equal((await activeBuy).ok, true);
  assert.equal(vm.runInContext('Billing.busy', overlapping.context), false);

  let releaseRestore;
  overlapping.state.restoreGate = new Promise(resolve => { releaseRestore = resolve; });
  const activeRestore = vm.runInContext('Billing.restore()', overlapping.context);
  await settle();
  assert.equal((await vm.runInContext("Billing.buy('europe')", overlapping.context)).reason, 'store_busy');
  assert.equal(overlapping.calls.filter(([name]) => name === 'purchase').length, 1);
  releaseRestore();
  assert.equal((await activeRestore).ok, true);

  const staleRead = harness({ native: true, platform: 'ios', key: 'appl_PUBLIC_TEST_KEY' });
  await vm.runInContext(`Billing.init('${accountA}')`, staleRead.context);
  let releaseOldInfo, enteredOldInfo;
  const oldInfoGate = new Promise(resolve => { releaseOldInfo = resolve; });
  const oldInfoEntered = new Promise(resolve => { enteredOldInfo = resolve; });
  staleRead.context.Capacitor.Plugins.Purchases.getCustomerInfo = async () => {
    enteredOldInfo();
    await oldInfoGate;
    return { customerInfo: { entitlements: { active: {} } } };
  };
  const foregroundBeforeBuy = vm.runInContext('Billing.foreground()', staleRead.context);
  await oldInfoEntered;
  assert.equal((await vm.runInContext("Billing.buy('oceania')", staleRead.context)).ok, true);
  releaseOldInfo();
  await foregroundBeforeBuy;
  assert.equal(vm.runInContext("ownsPack('oceania')", staleRead.context), true,
    'an older empty foreground response must not erase a later verified purchase');

  const deferredRefund = harness({ native: true, platform: 'ios', key: 'appl_PUBLIC_TEST_KEY' });
  await vm.runInContext(`Billing.init('${accountA}')`, deferredRefund.context);
  let releaseRefundBuy;
  deferredRefund.state.purchaseGate = new Promise(resolve => { releaseRefundBuy = resolve; });
  const refundBuy = vm.runInContext("Billing.buy('europe')", deferredRefund.context);
  await settle();
  deferredRefund.state.listenerHistory[0]({ entitlements: { active: {} } });
  deferredRefund.context.Capacitor.Plugins.Purchases.getCustomerInfo = async () => ({
    customerInfo: { entitlements: { active: {} }, allPurchasedProductIdentifiers: [] },
  });
  releaseRefundBuy();
  assert.equal((await refundBuy).ok, true,
    'the purchase response can temporarily show access before a concurrent refund is re-read');
  await settle();
  assert.equal(vm.runInContext("ownsPack('europe')", deferredRefund.context), false,
    'a listener received during the store sheet must trigger a fresh read and revoke refunded access');

  const backToBack = harness({ native: true, platform: 'ios', key: 'appl_PUBLIC_TEST_KEY' });
  await vm.runInContext(`Billing.init('${accountA}')`, backToBack.context);
  let releaseFirstBuy, releaseInvalidation, releaseSecondRestore;
  backToBack.state.purchaseGate = new Promise(resolve => { releaseFirstBuy = resolve; });
  backToBack.state.invalidateGate = new Promise(resolve => { releaseInvalidation = resolve; });
  const firstBuy = vm.runInContext("Billing.buy('europe')", backToBack.context);
  await settle();
  backToBack.state.listenerHistory[0]({ entitlements: { active: {} } });
  backToBack.context.Capacitor.Plugins.Purchases.getCustomerInfo = async () => ({
    customerInfo: { entitlements: { active: {} }, allPurchasedProductIdentifiers: [] },
  });
  releaseFirstBuy();
  assert.equal((await firstBuy).ok, true);
  await settle();
  assert.equal(vm.runInContext('Billing._customerInfoChangedDuringAction', backToBack.context), true);
  backToBack.state.restoreGate = new Promise(resolve => { releaseSecondRestore = resolve; });
  const secondRestore = vm.runInContext('Billing.restore()', backToBack.context);
  await settle();
  releaseInvalidation();
  await settle();
  assert.equal(vm.runInContext('Billing._customerInfoChangedDuringAction', backToBack.context), true,
    'a back-to-back store action must retain a skipped refund recheck');
  releaseSecondRestore();
  assert.equal((await secondRestore).ok, true);
  await settle();
  assert.equal(vm.runInContext('Billing._customerInfoChangedDuringAction', backToBack.context), false,
    'the pending refund recheck clears only after a current CustomerInfo read succeeds');
  assert.equal(vm.runInContext("ownsPack('europe')", backToBack.context), false,
    'a back-to-back store action cannot indefinitely retain a refunded pack');

  const offlineRefund = harness({ native: true, platform: 'ios', key: 'appl_PUBLIC_TEST_KEY' });
  await vm.runInContext(`Billing.init('${accountA}')`, offlineRefund.context);
  let releaseOfflineBuy;
  offlineRefund.state.purchaseGate = new Promise(resolve => { releaseOfflineBuy = resolve; });
  const offlineBuy = vm.runInContext("Billing.buy('asia')", offlineRefund.context);
  await settle();
  offlineRefund.state.listenerHistory[0]({ entitlements: { active: {} } });
  offlineRefund.context.Capacitor.Plugins.Purchases.getCustomerInfo = async () => {
    throw new Error('offline test');
  };
  releaseOfflineBuy();
  assert.equal((await offlineBuy).ok, true);
  await settle();
  assert.equal(vm.runInContext('Billing._customerInfoChangedDuringAction', offlineRefund.context), true,
    'an offline post-sheet read keeps the refund recheck pending without looping');
  offlineRefund.context.Capacitor.Plugins.Purchases.getCustomerInfo = async () => ({
    customerInfo: { entitlements: { active: {} }, allPurchasedProductIdentifiers: [] },
  });
  await vm.runInContext('Billing.foreground()', offlineRefund.context);
  assert.equal(vm.runInContext('Billing._customerInfoChangedDuringAction', offlineRefund.context), false);
  assert.equal(vm.runInContext("ownsPack('asia')", offlineRefund.context), false,
    'the next explicit foreground read revokes access after the offline recheck');

  const skippedForeground = harness({ native: true, platform: 'ios', key: 'appl_PUBLIC_TEST_KEY' });
  skippedForeground.state.customerInfo = { entitlements: { active: {
    europe: { identifier: 'europe', isActive: true },
  } }, allPurchasedProductIdentifiers: [] };
  await vm.runInContext(`Billing.init('${accountA}')`, skippedForeground.context);
  let releaseCancelledSheet;
  skippedForeground.state.purchaseGate = new Promise(resolve => { releaseCancelledSheet = resolve; });
  skippedForeground.state.cancelNextPurchase = true;
  const cancelledSheet = vm.runInContext("Billing.buy('asia')", skippedForeground.context);
  await settle();
  await vm.runInContext('Billing.foreground()', skippedForeground.context);
  assert.equal(vm.runInContext('Billing._customerInfoChangedDuringAction', skippedForeground.context), true,
    'a visibility refresh skipped by the store sheet must retain a post-sheet read intent');
  skippedForeground.context.Capacitor.Plugins.Purchases.getCustomerInfo = async () => ({
    customerInfo: { entitlements: { active: {} }, allPurchasedProductIdentifiers: [] },
  });
  releaseCancelledSheet();
  assert.equal((await cancelledSheet).reason, 'cancelled');
  await settle();
  assert.equal(vm.runInContext("ownsPack('europe')", skippedForeground.context), false,
    'a cancelled sheet without CustomerInfo still rechecks and revokes refunded cached access');
  assert.equal(vm.runInContext('Billing._customerInfoChangedDuringAction', skippedForeground.context), false);

  const secondPhone = harness({ native: true, platform: 'ios', key: 'appl_PUBLIC_TEST_KEY' });
  await vm.runInContext(`Billing.init('${accountA}')`, secondPhone.context);
  assert.equal(vm.runInContext('owned.size', secondPhone.context), 0,
    'a fresh phone starts with no local paid cache');
  secondPhone.state.customerInfo = purchaseSet.state.customerInfo;
  const restored = await vm.runInContext('Billing.restore()', secondPhone.context);
  assert.equal(restored.ok, true);
  assert.deepEqual([...restored.restored].sort(), allSlugs.slice().sort(),
    'restore must read all eight active entitlements from CustomerInfo');
  secondPhone.state.customerInfo = { entitlements: { active: {} }, allPurchasedProductIdentifiers: [] };
  await vm.runInContext(`Billing.init('${accountB}')`, secondPhone.context);
  assert.equal(vm.runInContext('owned.size', secondPhone.context), 0,
    'another Wayfinder identity must not inherit restored access');

  const native = harness({ native: true, platform: 'android', key: 'goog_PUBLIC_TEST_KEY' });
  assert.equal(await vm.runInContext('Billing.init()', native.context), false);
  assert.equal(native.calls.some(([name]) => name === 'configure'), false);
  await vm.runInContext('Billing.signOut()', native.context);

  const userId = '49ec8fa8-2fd7-44cd-8493-3ae565fa69a5';
  assert.equal(await vm.runInContext(`Billing.init('${userId}')`, native.context), true);
  const configured = native.calls.find(([name]) => name === 'configure');
  assert.deepEqual({ ...configured[1] }, { apiKey: 'goog_PUBLIC_TEST_KEY', appUserID: userId });
  const catalogue = native.calls.find(([name]) => name === 'getProducts')[1];
  assert.equal(catalogue.type, 'NON_SUBSCRIPTION');
  assert.equal('productCategory' in catalogue, false);
  assert.equal(catalogue.productIdentifiers.length, 8);
  assert(catalogue.productIdentifiers.includes('app.wayfinder.mobile.gems.all'));
  assert(catalogue.productIdentifiers.includes('app.wayfinder.mobile.gems.middle_east'));

  const bought = await vm.runInContext("Billing.buy('north-america')", native.context);
  assert.equal(bought.ok, true);
  assert.equal(native.calls.some(([name, id]) => name === 'purchase' && id.endsWith('north_america')), true);
  await vm.runInContext('Billing.signOut()', native.context);
  assert.equal(native.calls.some(([name]) => name === 'logOut'), false,
    'custom-ID-only billing must not create an anonymous RevenueCat customer on sign-out');
  assert.equal(vm.runInContext('owned.size', native.context), 0);
  assert.equal(native.state.listeners.size, 0, 'sign-out must remove the CustomerInfo listener');
  await vm.runInContext(`Billing.init('${accountB}')`, native.context);
  assert.equal(native.calls.filter(([name]) => name === 'configure').length, 1,
    'the RevenueCat SDK must be configured once per app process');
  assert(native.calls.some(([name, id]) => name === 'logIn' && id === accountB),
    'the next authenticated UUID must switch the configured SDK with logIn');

  const switching = harness({ native: true, platform: 'ios', key: 'appl_PUBLIC_TEST_KEY' });
  await vm.runInContext(`Billing.init('${accountA}')`, switching.context);
  let releaseRemoval;
  switching.state.removeGate = new Promise(resolve => { releaseRemoval = resolve; });
  const leavingA = vm.runInContext('Billing.signOut()', switching.context);
  await new Promise(resolve => setImmediate(resolve));
  const enteringB = vm.runInContext(`Billing.init('${accountB}')`, switching.context);
  await new Promise(resolve => setImmediate(resolve));
  assert.equal(switching.calls.some(([name, id]) => name === 'logIn' && id === accountB), false,
    'account B must wait until account A listener cleanup finishes');
  releaseRemoval();
  await Promise.all([leavingA, enteringB]);
  assert(switching.calls.some(([name, id]) => name === 'logIn' && id === accountB));
  assert.equal(switching.state.listeners.size, 1,
    'concurrent sign-out and sign-in must leave account B listener installed');

  const firstConfigureSwitch = harness({ native: true, platform: 'ios', key: 'appl_PUBLIC_TEST_KEY' });
  let releaseFirstConfigure;
  firstConfigureSwitch.state.configureGate = new Promise(resolve => { releaseFirstConfigure = resolve; });
  const configuringA = vm.runInContext(`Billing.init('${accountA}')`, firstConfigureSwitch.context);
  await new Promise(resolve => setImmediate(resolve));
  const enteringDuringConfigure = vm.runInContext(`Billing.init('${accountB}')`, firstConfigureSwitch.context);
  await new Promise(resolve => setImmediate(resolve));
  assert.equal(firstConfigureSwitch.calls.filter(([name]) => name === 'configure').length, 1);
  assert.equal(firstConfigureSwitch.calls.some(([name]) => name === 'logIn'), false,
    'account B must wait while the first SDK configuration is pending');
  releaseFirstConfigure();
  await Promise.all([configuringA, enteringDuringConfigure]);
  assert.equal(firstConfigureSwitch.calls.filter(([name]) => name === 'configure').length, 1,
    'the SDK must not be configured twice when account A finishes before B resumes');
  assert(firstConfigureSwitch.calls.some(([name, id]) => name === 'logIn' && id === accountB),
    'account B must switch with logIn after the serialized first configuration');

  const failedConfigure = harness({ native: true, platform: 'ios', key: 'appl_PUBLIC_TEST_KEY' });
  failedConfigure.state.configureFailures = 1;
  assert.equal(await vm.runInContext(`Billing.init('${accountA}')`, failedConfigure.context), false);
  assert.equal(vm.runInContext('Billing._ready', failedConfigure.context), null,
    'failed configuration must remain retryable');
  assert.equal(vm.runInContext('Billing._configuredPlugin', failedConfigure.context), null,
    'a rejected configure call must not mark the native SDK configured');
  assert.equal(await vm.runInContext(`Billing.init('${accountB}')`, failedConfigure.context), true);
  assert.equal(failedConfigure.calls.filter(([name]) => name === 'configure').length, 2,
    'the next account must retry configure rather than log in to an unconfigured SDK');
  assert.equal(failedConfigure.calls.some(([name]) => name === 'logIn'), false);
  assert.equal(failedConfigure.state.warnings.length, 1,
    'the rejected native configuration must be observable');

  const syncConfigureFailure = harness({ native: true, platform: 'ios', key: 'appl_PUBLIC_TEST_KEY' });
  syncConfigureFailure.context.Capacitor.Plugins.Purchases.configure = () => {
    throw new Error('synchronous bridge failure');
  };
  assert.equal(await vm.runInContext(`Billing.init('${accountA}')`, syncConfigureFailure.context), false);
  assert.equal(vm.runInContext('Billing._ready', syncConfigureFailure.context), null,
    'a synchronous native bridge failure must also remain retryable');

  const failClosed = harness({ native: true, platform: 'ios', key: 'appl_PUBLIC_TEST_KEY' });
  failClosed.state.configureFailures = 3;
  const failedBuy = await vm.runInContext(
    `Billing.init('${accountA}').then(() => Billing.buy('asia'))`, failClosed.context);
  assert.equal(failedBuy.ok, false);
  assert.match(failedBuy.reason, /could not connect/);
  assert.equal(failClosed.calls.some(([name]) => name === 'purchase'), false,
    'purchase must not run after RevenueCat initialization fails');
  const failedRestore = await vm.runInContext('Billing.restore()', failClosed.context);
  assert.equal(failedRestore.ok, false);
  assert.match(failedRestore.reason, /could not connect/);
  assert.equal(failClosed.calls.some(([name]) => name === 'restore'), false,
    'restore must not run after RevenueCat initialization fails');
  assert.equal(failClosed.state.warnings.length, 3);

  const inactive = harness({ native: true, platform: 'android', key: 'goog_PUBLIC_TEST_KEY' });
  inactive.state.customerInfo = {
    entitlements: { active: {} },
    allPurchasedProductIdentifiers: ['app.wayfinder.mobile.gems.oceania'],
  };
  await vm.runInContext(`Billing.init('${accountA}')`, inactive.context);
  assert.equal(vm.runInContext("ownsPack('oceania')", inactive.context), false,
    'historical or refunded product identifiers must not unlock access');

  const listener = harness({ native: true, platform: 'android', key: 'goog_PUBLIC_TEST_KEY' });
  listener.state.customerInfo = { entitlements: { active: {
    europe: { identifier: 'europe', isActive: true },
  } }, allPurchasedProductIdentifiers: [] };
  await vm.runInContext(`Billing.init('${accountA}')`, listener.context);
  assert.equal(vm.runInContext("ownsPack('europe')", listener.context), true);
  const listenerA = listener.state.listenerHistory[0];
  listenerA({ entitlements: { active: {} },
    allPurchasedProductIdentifiers: ['app.wayfinder.mobile.gems.europe'] });
  assert.equal(vm.runInContext("ownsPack('europe')", listener.context), false,
    'a current listener removes access after refund or inactivation');

  listener.state.customerInfo = { entitlements: { active: {} }, allPurchasedProductIdentifiers: [] };
  await vm.runInContext(`Billing.init('${accountB}')`, listener.context);
  assert.equal(listener.state.listeners.size, 1,
    'account switch must leave only the current CustomerInfo listener installed');
  listenerA({ entitlements: { active: { all: { identifier: 'all', isActive: true } } } });
  assert.equal(vm.runInContext("ownsPack('all')", listener.context), false,
    'a stale account A listener must not unlock account B');
  assert(listener.calls.some(([name]) => name === 'removeListener'));

  listener.state.customerInfo = { entitlements: { active: {
    asia: { identifier: 'asia', isActive: true },
  } }, allPurchasedProductIdentifiers: [] };
  await vm.runInContext('Billing.foreground()', listener.context);
  assert.equal(vm.runInContext("ownsPack('asia')", listener.context), true);
  assert(listener.calls.some(([name]) => name === 'invalidateCustomerInfoCache'));

  const staleForeground = harness({ native: true, platform: 'android', key: 'goog_PUBLIC_TEST_KEY' });
  staleForeground.state.customerInfo = { entitlements: { active: {
    europe: { identifier: 'europe', isActive: true },
  } }, allPurchasedProductIdentifiers: [] };
  await vm.runInContext(`Billing.init('${accountA}')`, staleForeground.context);
  let releaseForeground;
  staleForeground.state.invalidateGate = new Promise(resolve => { releaseForeground = resolve; });
  const oldForeground = vm.runInContext('Billing.foreground()', staleForeground.context);
  await new Promise(resolve => setImmediate(resolve));
  staleForeground.state.customerInfo = { entitlements: { active: {} }, allPurchasedProductIdentifiers: [] };
  await vm.runInContext(`Billing.init('${accountB}')`, staleForeground.context);
  releaseForeground();
  assert.deepEqual([...(await oldForeground)], [], 'an Account A foreground refresh must stop after switching to B');
  assert.equal(vm.runInContext("ownsPack('europe')", staleForeground.context), false);

  const ownerKey = `oaa.packs.v2.${accountB}`;
  const otherOwnerKey = `oaa.packs.v2.${accountA}`;
  listener.values.set(otherOwnerKey, '["oceania"]');
  assert(listener.values.has(ownerKey));
  await vm.runInContext(`Billing.deleteLocalOwner('${accountB}')`, listener.context);
  assert.equal(listener.values.has(ownerKey), false);
  assert.equal(listener.values.get(otherOwnerKey), '["oceania"]',
    'account deletion must not remove another owner cache');
  assert.equal(vm.runInContext('owned.size', listener.context), 0);
  assert.equal(vm.runInContext('Billing._appUserId', listener.context), null);
  assert.equal(listener.state.listeners.size, 0);

  // A purchase response that arrives after sign-out must not grant anything.
  const late = harness({ native: true, platform: 'android', key: 'goog_PUBLIC_TEST_KEY' });
  await vm.runInContext(`Billing.init('${accountA}')`, late.context);
  let finishPurchase;
  late.context.Capacitor.Plugins.Purchases.purchaseStoreProduct = () =>
    new Promise(resolve => { finishPurchase = resolve; });
  const buying = vm.runInContext("Billing.buy('oceania')", late.context);
  await new Promise(resolve => setImmediate(resolve));
  const signedOut = vm.runInContext('Billing.signOut()', late.context);
  finishPurchase({ customerInfo: {
    entitlements: { active: {} },
    allPurchasedProductIdentifiers: ['app.wayfinder.mobile.gems.oceania'],
  }});
  await signedOut;
  const lateResult = await buying;
  assert.equal(lateResult.ok, false);
  assert.equal(lateResult.reason, 'account changed');
  assert.equal(vm.runInContext('owned.size', late.context), 0);

  const prices = vm.runInContext('PACKS.map(({ slug, price }) => ({ slug, price }))', browser.context);
  assert.equal(prices.find(p => p.slug === 'all').price, 'AUD $14.99');
  assert(prices.filter(p => p.slug !== 'all').every(p => p.price === 'AUD $2.99'));
  console.log('  billing behaviour: 8 mock IAPs, cancelled sale, restore, identity, native guard and sign-out passed');
}

main().catch(error => { console.error(error); process.exit(1); });
