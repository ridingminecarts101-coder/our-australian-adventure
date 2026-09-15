'use strict';

const assert = require('assert');
const fs = require('fs');
const vm = require('vm');

const source = fs.readFileSync('store.js', 'utf8');
const appSource = fs.readFileSync('app.js', 'utf8');

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

async function settle() {
  await new Promise(resolve => setImmediate(resolve));
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
      if (state.cancelNextPurchase) {
        state.cancelNextPurchase = false;
        throw { code: 1, userCancelled: true };
      }
      const slug = product.identifier.slice('app.wayfinder.mobile.gems.'.length).replace(/_/g, '-');
      state.customerInfo.entitlements.active[slug] = { identifier: slug, isActive: true };
      return { customerInfo: state.customerInfo };
    },
    async restorePurchases() { calls.push(['restore']); return { customerInfo: state.customerInfo }; },
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
