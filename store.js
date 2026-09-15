/* Hidden gem packs — what is for sale, what is owned, and how buying works.
 *
 * WHY IT IS SHAPED LIKE THIS
 *
 * The obvious structure is seven continents at one price, and it is the one
 * used - with one rule that the data enforces rather than a flag:
 *
 *   - A pack with no gems in it is never offered. Selling an empty pack is
 *     not a pricing decision, it is a refund request, and Apple rejects it
 *     under the accurate-metadata rule. sellablePacks() counts each pack from
 *     the adventures themselves, so a continent's pack appears the day its
 *     first gem is added and cannot appear a day before.
 *   - Pack sizes vary a great deal between continents. Flat pricing across
 *     that spread is a deliberate trade: one price is easier to say and easier
 *     to buy, at the cost of a thin pack looking thin next to a full one. If
 *     that becomes a complaint, tier it - nothing here assumes the prices are
 *     equal.
 *
 * Packs are a flat AUD $2.99. The bundle at AUD $14.99 is the headline:
 * priced against the seven continents the app will eventually hold rather than
 * the five it holds today, so it stays the better buy as content is added.
 *
 * Locked gems do not count towards any total. A region with 71 adventures of
 * which 30 are unbought gems asks for 41, not 71 - completion, stamps and
 * achievements must never be behind a paywall.
 *
 * Every product is NON-CONSUMABLE. Access remains while the store-backed
 * RevenueCat entitlement is active and is restorable on a new phone. Apple
 * requires a visible Restore Purchases control for exactly this kind of
 * product, and there is one in the Me tab.
 */

const STORE_PREFIX = 'app.wayfinder.mobile.gems.';

/* price is what the buyer sees. Set the matching price point in App Store
 * Connect and Google Play Console; nothing here charges anyone by itself.
 */
const PACKS = [
  { slug: 'all',           continent: null,            name: 'All continents',
    price: 'AUD $14.99', blurb: 'Every hidden gem, the Antarctica collection and future additions.' },
  { slug: 'oceania',       continent: 'Oceania',       name: 'Oceania gems',
    price: 'AUD $2.99' },
  { slug: 'europe',        continent: 'Europe',        name: 'Europe gems',
    price: 'AUD $2.99' },
  { slug: 'north-america', continent: 'North America', name: 'North America gems',
    price: 'AUD $2.99' },
  { slug: 'asia',          continent: 'Asia',          name: 'Asia gems',
    price: 'AUD $2.99' },
  { slug: 'middle-east',   continent: 'Middle East',   name: 'Middle East gems',
    price: 'AUD $2.99' },
  { slug: 'south-america', continent: 'South America', name: 'South America gems',
    price: 'AUD $2.99' },
  { slug: 'africa',        continent: 'Africa',        name: 'Africa gems',
    price: 'AUD $2.99' },
];

const productId = slug => STORE_PREFIX + slug.replace(/-/g, '_');

// ── What this person has bought ──────────────────────────────────────
//
// Kept on the device. The store is the authority, not us: a restore re-reads
// the receipt and overwrites whatever is here, so a wiped phone or a new one
// gets everything back without us storing purchases on our own server.
const LS_ENTITLEMENTS = 'oaa.packs.v2';
let owned = new Set();
let entitlementOwner = null;

function entitlementKey(ownerId = entitlementOwner) {
  return ownerId ? `${LS_ENTITLEMENTS}.${ownerId}` : null;
}

function loadEntitlements(ownerId) {
  entitlementOwner = ownerId || null;
  const key = entitlementKey();
  if (!key) { owned = new Set(); return owned; }
  try { owned = new Set(JSON.parse(localStorage.getItem(key) || '[]')); }
  catch { owned = new Set(); }
  return owned;
}

function saveEntitlements() {
  const key = entitlementKey();
  if (!key) return;
  try { localStorage.setItem(key, JSON.stringify([...owned])); }
  catch { /* private mode; the store can still restore */ }
}

function grant(slug) { owned.add(slug); saveEntitlements(); }

function ownsPack(slug) {
  return (previewAvailable() && previewOn()) || owned.has('all') || owned.has(slug);
}

// Antarctica classics belong only to the all-continents bundle. They are kept
// distinct from hidden gems so catalogue and achievement counts stay honest.
// For older cached data, a missing bundle_only field means false.
function isLocked(a) {
  if (!a) return false;
  if (a.bundle_only) return !ownsPack('all');
  return !!(a.hidden_gem && a.pack && !ownsPack(a.pack));
}

function packFor(continent) {
  return continent === 'Antarctica'
    ? packBySlug('all')
    : PACKS.find(p => p.continent === continent) || null;
}
function packBySlug(slug) { return PACKS.find(p => p.slug === slug) || null; }

// How many gems each pack holds, counted from the data rather than written
// down, so a pack can never advertise a number it does not contain.
function packStats(adventures) {
  const n = {};
  let total = 0;
  for (const a of adventures) {
    if (a.availability?.status === 'unavailable' || !a.hidden_gem || !a.pack) continue;
    total++;
    if (a.pack !== 'all') n[a.pack] = (n[a.pack] || 0) + 1;
  }
  n.all = total;
  return n;
}

function bundleOnlyStats(adventures) {
  return adventures.reduce((n, a) => n + (a.bundle_only
    && a.availability?.status !== 'unavailable' ? 1 : 0), 0);
}

// Packs worth showing: everything with something in it, plus the bundle.
function sellablePacks(adventures) {
  const n = packStats(adventures);
  return PACKS.filter(p => !p.unreleased && (p.slug === 'all' || (n[p.slug] || 0) > 0));
}


/* ── Billing ──────────────────────────────────────────
 *
 * One interface, two implementations. On a phone this talks to StoreKit or
 * Play Billing through RevenueCat. In a browser there is no store, so it runs
 * a simulator that is clearly labelled as one and never pretends a real
 * purchase happened — the whole flow can be exercised before an Apple account
 * exists, which is the point.
 *
 * WHY REVENUECAT AND NOT STOREKIT DIRECTLY
 *
 * The same eight products have to be sold twice, on two stores whose receipt
 * formats, restore semantics and refund notifications have nothing in common.
 * Written by hand that is two implementations to keep correct forever, and the
 * failure mode is somebody who paid being told they did not. RevenueCat is one
 * API over both and it keeps the record of who bought what, so a person who
 * changes phone or platform is not arguing with us about it. It is free below
 * $2,500 a month of tracked revenue.
 *
 * ACTIVE ENTITLEMENTS ONLY
 *
 * RevenueCat's active entitlement map is the authority for access. Historical
 * product identifiers include inactive and refunded purchases, so they must
 * never unlock content. Every product therefore needs its matching entitlement
 * configured in RevenueCat before either store can be released.
 */

// Store prices, once the store has said what they actually are. Keyed by slug,
// empty until a device asks.
const livePrices = {};

/* What to print on the button.
 *
 * PACKS records the confirmed Australian base prices. The store knows the
 * real one, in the buyer's own currency, including whatever regional
 * adjustment Apple or Google applied — so it wins whenever it has answered.
 * Showing a price the store then does not charge is both an unpleasant
 * surprise and a review rejection.
 */
function priceFor(slug) {
  const pack = packBySlug(slug);
  return livePrices[slug] || (pack ? pack.price : '');
}

/* Running inside a native shell, whatever else may be true.
 *
 * Kept separate from Billing.native on purpose. Billing.native asks "can I
 * reach a store", which is false on a phone with no key configured; this asks
 * "am I on a phone", which decides whether test affordances are allowed to
 * exist at all. Conflating the two is how a build ships giving content away.
 */
function onNativePlatform() {
  const c = window.Capacitor;
  return !!(c && c.isNativePlatform && c.isNativePlatform());
}

const Billing = {
  _plugin: null,
  _configuredPlugin: null,
  _ready: null,
  _appUserId: null,
  _generation: 0,
  _cleanupReady: null,
  _customerInfoListener: null,
  _listenerPlugin: null,
  onChange: null,

  get native() {
    const cap = window.Capacitor;
    return !!(cap && cap.isNativePlatform && cap.isNativePlatform()
              && cap.Plugins && cap.Plugins.Purchases && this._key());
  },

  get mode() { return this.native ? 'store' : previewAvailable() ? 'simulated' : 'unavailable'; },

  _key() {
    const cfg = (window.OAA_CONFIG && OAA_CONFIG.revenueCat) || {};
    const p = window.Capacitor && window.Capacitor.getPlatform
      ? window.Capacitor.getPlatform() : 'web';
    return (p === 'ios' ? cfg.ios : p === 'android' ? cfg.android : '') || '';
  },

  /* Configure once, and only once even if two callers race.
   *
   * It also pulls entitlements down on the way through, which is what makes a
   * reinstall find its purchases without anybody pressing Restore. Failure
   * here is not fatal: the app carries on with whatever is cached locally,
   * rather than locking content somebody has already paid for.
   */
  init(appUserId = null) {
    const requestedId = appUserId || this._appUserId;
    const previousReady = this._ready;
    const previousCleanup = this._cleanupReady;
    if (requestedId !== this._appUserId) {
      this._generation++;
      this._ready = null;
      this._appUserId = requestedId;
      loadEntitlements(requestedId);
    }
    if (this._ready) return this._ready;
    if (!this.native) { this._ready = Promise.resolve(false); return this._ready; }
    if (!this._appUserId) { this._ready = Promise.resolve(false); return this._ready; }

    const P = window.Capacitor.Plugins.Purchases;
    const runId = this._appUserId, runGeneration = this._generation;
    this._plugin = P;
    let attempt;
    attempt = (async () => {
      try {
        if (previousCleanup) await previousCleanup;
        if (previousReady) await previousReady;
        if (runGeneration !== this._generation || runId !== this._appUserId) return false;
        await this._removeCustomerInfoListener();
        const alreadyConfigured = this._configuredPlugin === P;
        if (alreadyConfigured && P.logIn) {
          await P.logIn({ appUserID: runId });
        } else {
          await P.configure({ apiKey: this._key(), appUserID: runId });
          this._configuredPlugin = P;
        }
        if (runGeneration !== this._generation || runId !== this._appUserId) return false;
        await this._addCustomerInfoListener(P, runGeneration, runId);
        if (runGeneration !== this._generation || runId !== this._appUserId) return false;
        await this.refresh(runGeneration, runId);
        if (runGeneration !== this._generation || runId !== this._appUserId) return false;
        await this.products(runGeneration, runId);
        return runGeneration === this._generation && runId === this._appUserId;
      } catch (e) {
        console.warn('billing init', e);
        return false;
      }
    })();
    this._ready = attempt;
    attempt.then(ok => {
      if (!ok && this._ready === attempt) this._ready = null;
    });
    return attempt;
  },

  _acceptCustomerInfo(customerInfo, expectedGeneration, expectedId) {
    if (expectedGeneration !== this._generation || expectedId !== this._appUserId) return [];
    const slugs = slugsFromCustomerInfo(customerInfo);
    const before = [...owned].sort().join('|');
    owned = new Set(slugs);
    saveEntitlements();
    if (before !== [...owned].sort().join('|') && typeof this.onChange === 'function') {
      try { this.onChange([...owned]); } catch (e) { console.warn('billing change callback', e); }
    }
    return slugs;
  },

  async _addCustomerInfoListener(P, expectedGeneration, expectedId) {
    if (!P || !P.addCustomerInfoUpdateListener) return;
    const listener = customerInfo => {
      this._acceptCustomerInfo(customerInfo, expectedGeneration, expectedId);
    };
    const listenerId = await P.addCustomerInfoUpdateListener(listener);
    if (expectedGeneration !== this._generation || expectedId !== this._appUserId) {
      if (P.removeCustomerInfoUpdateListener) {
        await P.removeCustomerInfoUpdateListener({ listenerToRemove: listenerId });
      }
      return;
    }
    this._customerInfoListener = listenerId;
    this._listenerPlugin = P;
  },

  async _removeCustomerInfoListener() {
    const listenerId = this._customerInfoListener;
    const P = this._listenerPlugin;
    this._customerInfoListener = null;
    this._listenerPlugin = null;
    if (listenerId != null && P && P.removeCustomerInfoUpdateListener) {
      await P.removeCustomerInfoUpdateListener({ listenerToRemove: listenerId });
    }
  },

  /* Read ownership back from the store and replace what is held locally.
   *
   * Replaces rather than merges, so a refund or a revoked family share
   * actually takes the content away again, instead of leaving it unlocked
   * forever on the strength of one old localStorage write.
   */
  async refresh(expectedGeneration = this._generation, expectedId = this._appUserId) {
    if (!this.native) return [...owned];
    try {
      const { customerInfo } = await this._plugin.getCustomerInfo();
      if (expectedGeneration !== this._generation || expectedId !== this._appUserId) return [];
      return this._acceptCustomerInfo(customerInfo, expectedGeneration, expectedId);
    } catch (e) { console.warn('refresh', e); return [...owned]; }
  },

  /* Real, localised prices. Also the check that the store agrees these
   * products exist — a slug missing from the answer is one that has not been
   * created in App Store Connect or Play yet.
   */
  async products(expectedGeneration = this._generation, expectedId = this._appUserId) {
    if (!this.native) return null;                 // simulated: use our own prices
    try {
      const wanted = PACKS.filter(p => !p.unreleased);
      const { products } = await this._plugin.getProducts({
        productIdentifiers: wanted.map(p => productId(p.slug)),
        type: 'NON_SUBSCRIPTION',
      });
      if (expectedGeneration !== this._generation || expectedId !== this._appUserId) return null;
      for (const pack of wanted) {
        const found = (products || []).find(x => x.identifier === productId(pack.slug));
        if (found && found.priceString) livePrices[pack.slug] = found.priceString;
      }
      return products || null;
    } catch (e) { console.warn('products', e); return null; }
  },

  /* Returns { ok, slug } or { ok:false, reason }. A cancelled purchase is not
   * an error and must not be reported as one.
   */
  async buy(slug) {
    const pack = packBySlug(slug);
    if (!pack || pack.unreleased) return { ok: false, reason: 'not for sale' };

    /* The simulator is a browser tool and must never run on a phone.
      *
      * Billing.native is false when the RevenueCat key is missing, so without
      * this a shipped build with a blank key would offer every buyer a
      * confirm() that unlocks the pack for nothing. Checking the platform
      * separately means that mistake costs a shop that says it is unavailable,
      * rather than the entire paid catalogue.
      */
    if (onNativePlatform()) {
      if (!this._key()) return { ok: false, reason: 'the shop is not available in this build' };
    } else {
      if (!previewAvailable()) {
        return { ok: false, reason: 'purchases are available in the mobile app' };
      }
      const yes = confirm(
        `Simulated purchase — no money moves.\n\n${pack.name} · ${pack.price}\n\n`
        + 'On a phone this opens the real store. Unlock it here for testing?');
      if (!yes) return { ok: false, reason: 'cancelled' };
      grant(slug);
      return { ok: true, slug, simulated: true };
    }

    if (!await this.init()) {
      return { ok: false, reason: 'the shop could not connect; try again' };
    }
    const runId = this._appUserId, runGeneration = this._generation;
    try {
      const { products } = await this._plugin.getProducts({
        productIdentifiers: [productId(slug)],
        type: 'NON_SUBSCRIPTION',
      });
      if (runGeneration !== this._generation || runId !== this._appUserId) {
        return { ok: false, reason: 'account changed' };
      }
      const product = (products || [])[0];
      if (!product) return { ok: false, reason: 'the store does not have that one yet' };

      const { customerInfo } = await this._plugin.purchaseStoreProduct({ product });
      if (runGeneration !== this._generation || runId !== this._appUserId) {
        return { ok: false, reason: 'account changed' };
      }
      this._acceptCustomerInfo(customerInfo, runGeneration, runId);
      if (!owned.has(slug) && !owned.has('all')) {
        return { ok: false, reason: 'purchase completed but access is not configured; try Restore Purchases' };
      }
      return { ok: true, slug };
    } catch (e) {
      // PURCHASE_CANCELLED_ERROR is code 1. Backing out of a payment sheet is
      // a normal thing to do and must never surface as an error message.
      if (e && (e.userCancelled || String(e.code) === '1')) {
        return { ok: false, reason: 'cancelled' };
      }
      console.warn('purchase', e);
      return { ok: false, reason: (e && e.message) || 'the store refused' };
    }
  },

  /* Apple requires this to exist and to work without signing in to anything
   * of ours. It replaces local state entirely rather than merging, so a
   * refunded or family-revoked purchase actually goes away.
   */
  async restore() {
    if (onNativePlatform() && !this.native) {
      return { ok: false, reason: 'the shop is not available in this build' };
    }
    if (!this.native) {
      return { ok: true, restored: [...owned], simulated: true };
    }
    if (!await this.init()) {
      return { ok: false, reason: 'the shop could not connect; try again' };
    }
    const runId = this._appUserId, runGeneration = this._generation;
    try {
      const { customerInfo } = await this._plugin.restorePurchases();
      if (runGeneration !== this._generation || runId !== this._appUserId) {
        return { ok: false, reason: 'account changed' };
      }
      const slugs = this._acceptCustomerInfo(customerInfo, runGeneration, runId);
      return { ok: true, restored: slugs };
    } catch (e) {
      console.warn('restore', e);
      return { ok: false, reason: (e && e.message) || 'could not reach the store' };
    }
  },

  async foreground() {
    if (!this.native || !this._appUserId) return [...owned];
    const requestedId = this._appUserId, requestedGeneration = this._generation;
    if (!await this.init()) return [...owned];
    if (requestedGeneration !== this._generation || requestedId !== this._appUserId) return [];
    const P = this._plugin;
    try {
      if (P && P.invalidateCustomerInfoCache) await P.invalidateCustomerInfoCache();
      if (requestedGeneration !== this._generation || requestedId !== this._appUserId) return [];
      return await this.refresh(requestedGeneration, requestedId);
    } catch (e) {
      console.warn('billing foreground', e);
      return [...owned];
    }
  },

  async deleteLocalOwner(ownerId) {
    if (!ownerId) return false;
    try { localStorage.removeItem(`${LS_ENTITLEMENTS}.${ownerId}`); } catch { /* private mode */ }
    if (ownerId !== this._appUserId && ownerId !== entitlementOwner) return true;
    const previousReady = this._ready;
    this._generation++;
    this._ready = null;
    this._appUserId = null;
    entitlementOwner = null;
    owned = new Set();
    const cleanup = (async () => {
      if (previousReady) await previousReady;
      await this._removeCustomerInfoListener();
    })().catch(e => { console.warn('billing account cleanup', e); });
    this._cleanupReady = cleanup;
    await cleanup;
    if (this._cleanupReady === cleanup) this._cleanupReady = null;
    return true;
  },

  async signOut() {
    const previousReady = this._ready;
    this._generation++;
    this._ready = null;
    this._appUserId = null;
    entitlementOwner = null;
    owned = new Set();
    const cleanup = (async () => {
      if (previousReady) await previousReady;
      await this._removeCustomerInfoListener();
    })().catch(e => { console.warn('billing logout', e); });
    this._cleanupReady = cleanup;
    await cleanup;
    if (this._cleanupReady === cleanup) this._cleanupReady = null;

    /* Wayfinder always configures RevenueCat with the authenticated Supabase
     * UUID. RevenueCat recommends that custom-ID-only apps do not call logOut:
     * logOut creates an anonymous customer which can later be aliased during a
     * restore or login. Keep the SDK configured but make all local access
     * ownerless; the next signed-in UUID is selected with logIn(), which
     * switches between two identified customers without merging them.
     */
  },
};

/* Only currently active, mapped RevenueCat entitlements authorize access. */
function slugsFromCustomerInfo(info) {
  if (!info) return [];
  const out = new Set();

  const active = (info.entitlements && info.entitlements.active) || {};
  for (const [slug, entitlement] of Object.entries(active)) {
    if (packBySlug(slug) && entitlement && entitlement.isActive !== false) out.add(slug);
  }

  return [...out];
}


/* Preview mode — see the paid content without a store.
 *
 * There is no way to buy your own pack until the app is on a store, which
 * makes the locked half impossible to review. This unlocks everything on this
 * device only. It is not a purchase: it writes to its own key, is never
 * restored, and disappears the moment a real store is present, so it cannot
 * ship as a way around paying.
 */
const LS_PREVIEW = 'oaa.preview.v1';

function previewAvailable() {
  /* Browser only, and deliberately not "no store key configured".
   *
   * Keying it off Billing.native would mean that shipping a build with the
   * RevenueCat key left blank hands every buyer a button that unlocks the paid
   * content for nothing. Tying it to the platform instead makes that mistake
   * cost a broken shop rather than the whole shop.
   */
  if (onNativePlatform()) return false;
  return /^(localhost|127(?:\.\d+){3}|\[::1\])$/i.test(location.hostname);
}

/* Held in a variable, not read from storage each time.
 *
 * ownsPack() is called from isLocked(), which runs once per adventure inside
 * several render loops - so reading localStorage here meant thousands of
 * synchronous storage reads to draw one screen, and cost about 200ms a render.
 * The flag only changes when somebody presses the button.
 */
let previewFlag = false;
try { previewFlag = localStorage.getItem(LS_PREVIEW) === '1'; } catch { /* private mode */ }
if (!previewAvailable()) previewFlag = false;

function previewOn() { return previewFlag; }

function setPreview(on) {
  previewFlag = !!on;
  try {
    if (on) localStorage.setItem(LS_PREVIEW, '1');
    else localStorage.removeItem(LS_PREVIEW);
  } catch { /* private mode */ }
}
