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
   */
  revenueCat: {
    android: '',
    ios: '',
  },

  /* Affiliate ids for the booking links. See partners.js for the rules
   * this operates under - they matter more than the ids do.
   *
   * Empty means no booking button appears anywhere and no disclosure is
   * shown, which is the correct state until the affiliate applications come
   * back approved. Filling in either one turns the feature on.
   *
   *   viatorPartnerId       Viator/Tripadvisor partner id, from
   *                         partnerresources.viator.com. Usually 8-12% .
   *   getYourGuidePartnerId GetYourGuide, via Awin or Travelpayouts. ~8%.
   *
   * Viator wins where both are set: wider catalogue outside Europe.
   */
  partners: {
    viatorPartnerId: '',
    viatorCampaignId: '',
    getYourGuidePartnerId: '',
    getYourGuideCampaign: 'wayfinder',
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

  // New installs use a recoverable email/password account. Existing anonymous
  // sessions can add email/password in place without changing their user id.
  allowAnonymous: false,
};
