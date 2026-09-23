/* Supabase connection settings.
 *
 * These three values are PUBLIC — they ship inside the app and anyone can read
 * them. That is fine and expected: the anon key grants nothing on its own,
 * because Row Level Security requires a signed-in session (see
 * supabase/schema.sql). What must NEVER go in this file is the service_role
 * key from the Supabase dashboard — that one bypasses every security rule.
 */
window.OAA_CONFIG = {
  // Supabase → Project Settings → Data API → Project URL
  supabaseUrl: 'https://ajyuozqoukigeeyhvuqc.supabase.co',

  // Supabase → Project Settings → API Keys → anon / publishable key
  supabaseAnonKey: 'sb_publishable_9wV1tV299jWR-jV3bW121A_UOa7M_R_',

  /* RevenueCat public SDK keys, one per store.
   *
   * These are publishable keys and are meant to ship in the app; the secret
   * key never leaves the dashboard. Both empty means no store is reachable.
   * Public web and native builds cannot simulate an unlock; developer preview
   * is available only on localhost.
   *
   * Fill these in from RevenueCat -> Project Settings -> API keys. The
   * Android one starts goog_, the Apple one appl_.
   *
   * Before either key is added to a release build, RevenueCat must contain an
   * entitlement for each exact pack slug in tools/ios-products.json, with its
   * matching Apple and Google products attached. The optional RevenueCat
   * Offering is not read by this client: it requests the eight permanent
   * product IDs directly and grants only active entitlements. Never ship a
   * RevenueCat Test Store key or a secret dashboard/API key.
   */
  revenueCat: {
    android: '',
    ios: '',
  },

  /* Public affiliate attribution, not a credential. Enable only after account
   * readiness and release review. partners.js requires an individually reviewed
   * product from booking-links.js; it never creates generic search links.
   * Provider scripts, API credentials and personal user identifiers are absent.
   */
  partners: {
    // Prepared separately; enable after account readiness and release review.
    viatorEnabled: false,
    viatorPartnerId: 'P00321485',
  },

  /* Where a shared link should point.
   *
   * Inside the native shell the page is served from https://localhost, so a
   * link built from location.origin is an invite nobody else can open. Every
   * link the app hands out - invites, adventures, trips - is built from this
   * instead, which works whether the person receiving it has the app, the
   * installed web app, or nothing but a browser.
   */
  shareBase: 'https://ridingminecarts101-coder.github.io/our-australian-adventure/',
  // Group invitations use a branded landing page; auth callbacks stay on shareBase.
  inviteBase: 'https://rlapplications.com/wayfinder/invite/',

  // New installs use a recoverable email/password account. Existing anonymous
  // sessions can add email/password in place without changing their user id.
  allowAnonymous: false,
};
