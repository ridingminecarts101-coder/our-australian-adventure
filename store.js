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

function ownsPack(slug) { return owned.has('all') || owned.has(slug); }

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


/* ── Billing ──────────────────────────────────────────────────────────
 *
 * One interface, two implementations. On a phone this talks to StoreKit or
 * Play Billing through a Capacitor plugin. In a browser there is no store, so
 * it runs a simulator that is clearly labelled as one and never pretends a
 * real purchase happened — the whole flow can be exercised before an Apple
 * account exists, which is the point.
 */
const Billing = {
  get native() {
    const cap = window.Capacitor;
    return !!(cap && cap.Plugins && cap.Plugins.Purchases);
  },

  get mode() { return this.native ? 'store' : 'simulated'; },

  async products() {
    if (!this.native) return null;                 // simulated: use our own prices
    try {
      const { products } = await window.Capacitor.Plugins.Purchases.getProducts({
        productIdentifiers: PACKS.filter(p => !p.unreleased).map(p => productId(p.slug)),
      });
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

    try {
      const res = await window.Capacitor.Plugins.Purchases.purchase({
        productIdentifier: productId(slug),
      });
      if (res && res.cancelled) return { ok: false, reason: 'cancelled' };
      grant(slug);
      return { ok: true, slug };
    } catch (e) {
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
    try {
      const res = await window.Capacitor.Plugins.Purchases.restorePurchases();
      const ids = (res && res.productIdentifiers) || [];
      const slugs = PACKS.map(p => p.slug).filter(s => ids.includes(productId(s)));
      owned = new Set(slugs);
      saveEntitlements();
      return { ok: true, restored: slugs };
    } catch (e) {
      console.warn('restore', e);
      return { ok: false, reason: (e && e.message) || 'could not reach the store' };
    }
  },
};

loadEntitlements();
