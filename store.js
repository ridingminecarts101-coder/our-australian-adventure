/* Hidden gem packs — what is for sale, what is owned, and how buying works.
 *
 * WHY IT IS SHAPED LIKE THIS
 *
 * The obvious structure is seven continents at one price. It does not survive
 * contact with the data:
 *
 *   - South America and Africa have no hidden gems at all yet. Selling an
 *     empty pack is not a pricing decision, it is a refund request, and Apple
 *     rejects it under the accurate-metadata rule. They are declared here so
 *     the plumbing exists, and marked unreleased until they have content.
 *   - The packs that do have content run from 34 gems to 270, an eight-fold
 *     spread. Flat pricing across that range is a deliberate trade: one price
 *     is easier to say and easier to buy, at the cost of the Middle East pack
 *     looking thin next to Oceania. If that becomes a complaint, tier it -
 *     nothing here assumes the prices are equal.
 *
 * Packs are a flat $1.99 for simplicity. The bundle at $9.99 is the headline:
 * priced against the seven continents the app will eventually hold rather than
 * the five it holds today, so it stays the better buy as content is added.
 *
 * Locked gems do not count towards any total. A region with 71 adventures of
 * which 30 are unbought gems asks for 41, not 71 - completion, stamps and
 * achievements must never be behind a paywall.
 *
 * Every product is NON-CONSUMABLE. Bought once, kept forever, restorable on a
 * new phone. Apple requires a visible Restore Purchases control for exactly
 * this kind of product, and there is one in the Me tab.
 */

const STORE_PREFIX = 'app.wayfinder.mobile.gems.';

/* price is what the buyer sees. Set the matching price point in App Store
 * Connect and Google Play Console; nothing here charges anyone by itself.
 */
const PACKS = [
  { slug: 'all',           continent: null,            name: 'Every hidden gem',
    price: '$9.99', blurb: 'Every pack, including continents added later.' },
  { slug: 'oceania',       continent: 'Oceania',       name: 'Oceania gems',
    price: '$1.99' },
  { slug: 'europe',        continent: 'Europe',        name: 'Europe gems',
    price: '$1.99' },
  { slug: 'north-america', continent: 'North America', name: 'North America gems',
    price: '$1.99' },
  { slug: 'asia',          continent: 'Asia',          name: 'Asia gems',
    price: '$1.99' },
  { slug: 'middle-east',   continent: 'Middle East',   name: 'Middle East gems',
    price: '$1.99' },
  // Declared so the code path exists, not sold until there is something in them.
  { slug: 'south-america', continent: 'South America', name: 'South America gems',
    price: '$1.99', unreleased: true },
  { slug: 'africa',        continent: 'Africa',        name: 'Africa gems',
    price: '$1.99', unreleased: true },
];

const productId = slug => STORE_PREFIX + slug.replace(/-/g, '_');

// ── What this person has bought ──────────────────────────────────────
//
// Kept on the device. The store is the authority, not us: a restore re-reads
// the receipt and overwrites whatever is here, so a wiped phone or a new one
// gets everything back without us storing purchases on our own server.
const LS_ENTITLEMENTS = 'oaa.packs.v1';
let owned = new Set();

function loadEntitlements() {
  try { owned = new Set(JSON.parse(localStorage.getItem(LS_ENTITLEMENTS) || '[]')); }
  catch { owned = new Set(); }
  return owned;
}

function saveEntitlements() {
  try { localStorage.setItem(LS_ENTITLEMENTS, JSON.stringify([...owned])); }
  catch { /* private mode; the store can still restore */ }
}

function grant(slug) { owned.add(slug); saveEntitlements(); }

function ownsPack(slug) {
  return (previewAvailable() && previewOn()) || owned.has('all') || owned.has(slug);
}

// An adventure is locked when it is a hidden gem in a pack you have not bought.
function isLocked(a) {
  return !!(a && a.hidden_gem && a.pack && !ownsPack(a.pack));
}

function packFor(continent) { return PACKS.find(p => p.continent === continent) || null; }
function packBySlug(slug) { return PACKS.find(p => p.slug === slug) || null; }

// How many gems each pack holds, counted from the data rather than written
// down, so a pack can never advertise a number it does not contain.
function packStats(adventures) {
  const n = {};
  for (const a of adventures) if (a.hidden_gem && a.pack) n[a.pack] = (n[a.pack] || 0) + 1;
  n.all = Object.values(n).reduce((s, v) => s + v, 0);
  return n;
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
 * The same six products have to be sold twice, on two stores whose receipt
 * formats, restore semantics and refund notifications have nothing in common.
 * Written by hand that is two implementations to keep correct forever, and the
 * failure mode is somebody who paid being told they did not. RevenueCat is one
 * API over both and it keeps the record of who bought what, so a person who
 * changes phone or platform is not arguing with us about it. It is free below
 * $2,500 a month of tracked revenue.
 *
 * ENTITLEMENTS, NOT PRODUCT IDS
 *
 * Ownership is read from entitlements where they exist, falling back to the
 * raw list of purchased product ids. The fallback matters: it means the app
 * behaves correctly the moment the products exist in App Store Connect, before
 * anybody has configured a single entitlement in the RevenueCat dashboard, and
 * it keeps working if that configuration is later changed.
 */

// Store prices, once the store has said what they actually are. Keyed by slug,
// empty until a device asks.
const livePrices = {};

/* What to print on the button.
 *
 * The prices in PACKS are our guess at a US price point. The store knows the
 * real one, in the buyer's own currency, including whatever regional
 * adjustment Apple or Google applied — so it wins whenever it has answered.
 * Showing a price the store then does not charge is both an unpleasant
 * surprise and a review rejection.
 */
function priceFor(slug) {
  const pack = packBySlug(slug);
  return livePrices[slug] || (pack ? pack.price : '');
}

const Billing = {
  _plugin: null,
  _ready: null,

  get native() {
    const cap = window.Capacitor;
    return !!(cap && cap.isNativePlatform && cap.isNativePlatform()
              && cap.Plugins && cap.Plugins.Purchases && this._key());
  },

  get mode() { return this.native ? 'store' : 'simulated'; },

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
  init() {
    if (this._ready) return this._ready;
    if (!this.native) { this._ready = Promise.resolve(false); return this._ready; }

    const P = window.Capacitor.Plugins.Purchases;
    this._plugin = P;
    this._ready = (async () => {
      try {
        await P.configure({ apiKey: this._key() });
        await this.refresh();
        await this.products();
        return true;
      } catch (e) {
        console.warn('billing init', e);
        return false;
      }
    })();
    return this._ready;
  },

  /* Read ownership back from the store and replace what is held locally.
   *
   * Replaces rather than merges, so a refund or a revoked family share
   * actually takes the content away again, instead of leaving it unlocked
   * forever on the strength of one old localStorage write.
   */
  async refresh() {
    if (!this.native) return [...owned];
    try {
      const { customerInfo } = await this._plugin.getCustomerInfo();
      const slugs = slugsFromCustomerInfo(customerInfo);
      owned = new Set(slugs);
      saveEntitlements();
      return slugs;
    } catch (e) { console.warn('refresh', e); return [...owned]; }
  },

  /* Real, localised prices. Also the check that the store agrees these
   * products exist — a slug missing from the answer is one that has not been
   * created in App Store Connect or Play yet.
   */
  async products() {
    if (!this.native) return null;                 // simulated: use our own prices
    try {
      const wanted = PACKS.filter(p => !p.unreleased);
      const { products } = await this._plugin.getProducts({
        productIdentifiers: wanted.map(p => productId(p.slug)),
        productCategory: 'NON_SUBSCRIPTION',
      });
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

    if (!this.native) {
      const yes = confirm(
        `Simulated purchase — no money moves.\n\n${pack.name} · ${pack.price}\n\n`
        + 'On a phone this opens the real store. Unlock it here for testing?');
      if (!yes) return { ok: false, reason: 'cancelled' };
      grant(slug);
      return { ok: true, slug, simulated: true };
    }

    await this.init();
    try {
      const { products } = await this._plugin.getProducts({
        productIdentifiers: [productId(slug)],
        productCategory: 'NON_SUBSCRIPTION',
      });
      const product = (products || [])[0];
      if (!product) return { ok: false, reason: 'the store does not have that one yet' };

      const { customerInfo } = await this._plugin.purchaseStoreProduct({ product });
      owned = new Set(slugsFromCustomerInfo(customerInfo));
      owned.add(slug);          // belt and braces, in case entitlements lag a moment
      saveEntitlements();
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
    if (!this.native) {
      return { ok: true, restored: [...owned], simulated: true };
    }
    await this.init();
    try {
      const { customerInfo } = await this._plugin.restorePurchases();
      const slugs = slugsFromCustomerInfo(customerInfo);
      owned = new Set(slugs);
      saveEntitlements();
      return { ok: true, restored: slugs };
    } catch (e) {
      console.warn('restore', e);
      return { ok: false, reason: (e && e.message) || 'could not reach the store' };
    }
  },
};

/* Which packs a RevenueCat customer record says are owned.
 *
 * Two sources, deliberately. Entitlements are the configured answer and the
 * one that survives a product id being renamed; allPurchasedProductIdentifiers
 * is the raw truth from the store and needs no dashboard setup at all. Taking
 * the union of the two means neither a missing entitlement nor a missing
 * product mapping can lock somebody out of content they have paid for.
 */
function slugsFromCustomerInfo(info) {
  if (!info) return [];
  const out = new Set();

  const active = (info.entitlements && info.entitlements.active) || {};
  for (const slug of Object.keys(active)) if (packBySlug(slug)) out.add(slug);

  const ids = info.allPurchasedProductIdentifiers || [];
  for (const pack of PACKS) if (ids.includes(productId(pack.slug))) out.add(pack.slug);

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
  const cap = window.Capacitor;
  return !(cap && cap.isNativePlatform && cap.isNativePlatform());
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

function previewOn() { return previewFlag; }

function setPreview(on) {
  previewFlag = !!on;
  try {
    if (on) localStorage.setItem(LS_PREVIEW, '1');
    else localStorage.removeItem(LS_PREVIEW);
  } catch { /* private mode */ }
}

loadEntitlements();
