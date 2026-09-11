'use strict';

const assert = require('assert');
const fs = require('fs');
const vm = require('vm');

const source = fs.readFileSync('store.js', 'utf8');

function harness({ native = false, platform = 'web', key = '', confirmResult = true,
                   hostname = 'localhost' } = {}) {
  const values = new Map();
  const calls = [];
  const customerInfo = {
    entitlements: { active: {} },
    allPurchasedProductIdentifiers: [],
  };
  const purchases = {
    async configure(options) { calls.push(['configure', options]); },
    async getCustomerInfo() { calls.push(['getCustomerInfo']); return { customerInfo }; },
    async getProducts(options) {
      calls.push(['getProducts', options]);
      return {
        products: options.productIdentifiers.map(identifier => ({ identifier, priceString: 'local price' })),
      };
    },
    async purchaseStoreProduct({ product }) {
      calls.push(['purchase', product.identifier]);
      customerInfo.allPurchasedProductIdentifiers.push(product.identifier);
      return { customerInfo };
    },
    async restorePurchases() { calls.push(['restore']); return { customerInfo }; },
    async logOut() { calls.push(['logOut']); },
  };
  const context = {
    console,
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
  return { context, calls, values };
}

async function main() {
  const browser = harness();
  const accountA = 'aaaaaaaa-aaaa-4aaa-8aaa-aaaaaaaaaaaa';
  const accountB = 'bbbbbbbb-bbbb-4bbb-8bbb-bbbbbbbbbbbb';
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

  const native = harness({ native: true, platform: 'android', key: 'goog_PUBLIC_TEST_KEY' });
  assert.equal(await vm.runInContext('Billing.init()', native.context), false);
  assert.equal(native.calls.some(([name]) => name === 'configure'), false);
  await vm.runInContext('Billing.signOut()', native.context);

  const userId = '49ec8fa8-2fd7-44cd-8493-3ae565fa69a5';
  assert.equal(await vm.runInContext(`Billing.init('${userId}')`, native.context), true);
  const configured = native.calls.find(([name]) => name === 'configure');
  assert.deepEqual({ ...configured[1] }, { apiKey: 'goog_PUBLIC_TEST_KEY', appUserID: userId });
  const catalogue = native.calls.find(([name]) => name === 'getProducts')[1];
  assert.equal(catalogue.productCategory, 'NON_SUBSCRIPTION');
  assert.equal(catalogue.productIdentifiers.length, 8);
  assert(catalogue.productIdentifiers.includes('app.wayfinder.mobile.gems.all'));
  assert(catalogue.productIdentifiers.includes('app.wayfinder.mobile.gems.middle_east'));

  const bought = await vm.runInContext("Billing.buy('north-america')", native.context);
  assert.equal(bought.ok, true);
  assert.equal(native.calls.some(([name, id]) => name === 'purchase' && id.endsWith('north_america')), true);
  await vm.runInContext('Billing.signOut()', native.context);
  assert.equal(native.calls.some(([name]) => name === 'logOut'), true);
  assert.equal(vm.runInContext('owned.size', native.context), 0);

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
  console.log('  billing behaviour: prices, identity, native guard, purchase and sign-out passed');
}

main().catch(error => { console.error(error); process.exit(1); });
