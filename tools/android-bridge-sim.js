/* A fake Capacitor Android bridge, for exercising the native code paths in a
 * browser.
 *
 * This is not a substitute for a device. It reproduces the three things about
 * an Android WebView that differ from a browser and that the app actually
 * touches, so the code paths that only run inside the shell can be run, read
 * and screenshotted without waiting on an emulator:
 *
 *   1. window.Capacitor exists, says it is native, and says android.
 *   2. The Notification constructor does NOT exist. An Android WebView has no
 *      Web Notifications API at all, which is the single most dangerous
 *      difference - a bare `Notification.permission` read is a ReferenceError,
 *      not undefined.
 *   3. navigator.share does NOT exist. The Web Share API is a Chrome browser
 *      feature; WebView does not implement it.
 *
 * Load it BEFORE config.js.
 */
(() => {
  const log = [];
  const record = (name, args) => { log.push({ name, args, at: Date.now() }); };

  // ── 2 and 3: what an Android WebView does not have ──────────────────
  try { delete window.Notification; } catch { /* non-configurable in some engines */ }
  try { Object.defineProperty(window, 'Notification', { value: undefined, configurable: true }); } catch {}
  try { Object.defineProperty(navigator, 'share', { value: undefined, configurable: true }); } catch {}

  // ── A stand-in for the notifications plugin ─────────────────────────
  let display = 'prompt';
  const LocalNotifications = {
    async checkPermissions() { record('LocalNotifications.checkPermissions'); return { display }; },
    async requestPermissions() {
      record('LocalNotifications.requestPermissions');
      display = 'granted';                       // as if the person said yes
      return { display };
    },
    async schedule(opts) { record('LocalNotifications.schedule', opts); return { notifications: [] }; },
  };

  /* A stand-in for RevenueCat, with the shape the real plugin returns.
   *
   * Prices are deliberately in AUD rather than USD: the whole point of asking
   * the store is that it answers in the buyer's currency, and a simulator that
   * echoes back the hardcoded strings would prove nothing.
   */
  const CATALOGUE = {
    'app.wayfinder.mobile.gems.all':           { priceString: 'A$14.99' },
    'app.wayfinder.mobile.gems.oceania':       { priceString: 'A$2.99' },
    'app.wayfinder.mobile.gems.europe':        { priceString: 'A$2.99' },
    'app.wayfinder.mobile.gems.north_america': { priceString: 'A$2.99' },
    'app.wayfinder.mobile.gems.asia':          { priceString: 'A$2.99' },
    // middle_east deliberately absent: nothing has been created for it in Play
  };
  let purchased = [];

  const customerInfo = () => ({
    entitlements: { active: {} },
    allPurchasedProductIdentifiers: purchased.slice(),
  });

  const Purchases = {
    async configure(o) { record('Purchases.configure', o); return {}; },
    async getCustomerInfo() { record('Purchases.getCustomerInfo'); return { customerInfo: customerInfo() }; },
    async getProducts({ productIdentifiers }) {
      record('Purchases.getProducts', productIdentifiers);
      return {
        products: productIdentifiers
          .filter(id => CATALOGUE[id])
          .map(id => ({ identifier: id, ...CATALOGUE[id] })),
      };
    },
    async purchaseStoreProduct({ product }) {
      record('Purchases.purchaseStoreProduct', product.identifier);
      if (window.__simCancelPurchase) {
        const e = new Error('Purchase was cancelled.');
        e.code = '1'; e.userCancelled = true;
        throw e;
      }
      purchased.push(product.identifier);
      return { productIdentifier: product.identifier, customerInfo: customerInfo() };
    },
    async restorePurchases() { record('Purchases.restorePurchases'); return { customerInfo: customerInfo() }; },
  };

  // The App plugin, whose listeners are the two things nothing registers yet.
  const listeners = {};
  const App = {
    async addListener(event, fn) {
      record('App.addListener', event);
      (listeners[event] = listeners[event] || []).push(fn);
      return { remove: async () => {} };
    },
    async exitApp() { record('App.exitApp'); },
  };

  // The native share sheet, and the status bar.
  const Share = {
    async share(o) {
      record('Share.share', o);
      if (window.__simCancelShare) throw new Error('Share canceled');
      return { activityType: 'com.android.messaging' };
    },
  };
  const StatusBar = { async setStyle(o) { record('StatusBar.setStyle', o); } };

  window.Capacitor = {
    isNativePlatform: () => true,
    getPlatform: () => 'android',
    Plugins: { LocalNotifications, Purchases, App, Share, StatusBar },
  };

  /* What the hardware Back button does, reproduced from
   * @capacitor/app AppPlugin.java: if nothing in JS is listening it tries
   * webview history, and does nothing at all when there is none.
   */
  window.__simBack = () => {
    if (!(listeners.backButton || []).length) {
      record('backButton', 'no JS listener; webview history length ' + history.length);
      return history.length > 1 ? 'went back in history' : 'NOTHING HAPPENED';
    }
    listeners.backButton.forEach(fn => fn({ canGoBack: history.length > 1 }));
    return 'handed to the app';
  };

  /* An incoming deep link, reproduced from Bridge.onNewIntent: the intent goes
   * to the plugins and the WebView is never navigated, so location.search does
   * not change.
   */
  window.__simDeepLink = url => {
    record('appUrlOpen', url);
    if (!(listeners.appUrlOpen || []).length) return 'NOTHING HAPPENED — no appUrlOpen listener';
    listeners.appUrlOpen.forEach(fn => fn({ url }));
    return 'handed to the app';
  };

  window.__simLog = log;
  window.__simPurchased = () => purchased.slice();
})();
