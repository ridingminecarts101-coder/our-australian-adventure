# 🧭 Wayfinder

Wayfinder is an adventure checklist and travel journal by **RL Applications**. Discover specific things to do around the world, plan a trip, tick off what you have done and keep a personal passport of places and memories. An account is required so progress follows the traveller across devices; joining a group and sharing completions are optional.

As of 23 September 2026, the active catalogue has **5,412 adventures**, including **1,156 paid hidden gems**, across 228 country and territory entries. Seventeen operationally paused listings remain visible for historical context but are excluded from completion targets. Some adventures have an individually reviewed link to a matching Viator experience; unmatched entries have no booking button. Those links are paid links, and RL Applications may earn a commission on eligible bookings. Wayfinder does not process tour bookings or payments.

## Current product

- Browse by world, continent, country and larger regional divisions, with maps, filters, shortlist, trips and optional Near me search.
- Record personal completions, ratings, notes, passport stamps and achievements. Group progress shows only what members choose to share; purchases and personal progress belong to individual accounts.
- Use the Community board for text-only traveller recommendations, with review and reporting controls.
- Keep new memory photos inside Wayfinder on the originating device. They are not uploaded to Supabase, GitHub or another RL Applications photo service. A user can manually transfer a password-encrypted, account-bound photo backup to another phone and import it there. Browser/OS/device-backup retention is outside the app's control.
- Read already-loaded catalogue content and device-local memories offline. Progress changes queue for sync when the account reconnects.
- Buy the optional **All continents** hidden-gem collection for AUD $14.99 once, or a standalone continent collection for AUD $2.99 once. Antarctica is bundle-only. Store availability and transaction handling depend on the native platform.

The PWA and native iOS/Android builds share the web app source, but their signing, purchases, file storage and platform releases are separate. This source prepares PWA v65 and iOS 1.0.9 (build 9) for internal TestFlight. The earlier 1.0.7 (build 7) and its eight purchases remain in App Review with manual public release. Android store distribution is separate. See the dated release records in the coordination workspace for current receipts; do not infer public store availability from a PWA or TestFlight deployment.

## Source and checks

`index.html`, `styles.css` and `app.js` contain the main interface and behavior. `world.js`, `countries.js` and `data/adventures.json` provide the catalogue; `data/src/` holds source entries. `store.js` handles purchase state. `partners.js` and `booking-links.js` gate reviewed Viator links. `config.js` holds public client configuration. `supabase/` contains the reviewed backend schema and migrations. `business-site/public/wayfinder/` contains the public help and privacy pages. Native projects are in `ios/` and `android/`.

Run `npm ci` then `npm run check` for the full source/backend/static test matrix. `npm run stage` assembles the native web payload before a platform sync. The latest full check has one existing content-quality failure: CF, KP and SS have no suitable adventures yet. Do not add filler merely to clear that check. Signed native builds, device tests, backend tests and store acceptance are separate results.

## Privacy, accuracy and ownership

The Supabase URL and publishable key in `config.js` are intentionally public client configuration; private service keys, signing material, API credentials and customer data do not belong in Git. Row Level Security protects account data. The app does not run a Viator pixel or contact Viator until the user chooses an external link. Full booking and data disclosures are in the bundled Privacy and Support pages and at [rlapplications.com/wayfinder](https://rlapplications.com/wayfinder/).

Destinations, access, weather, prices, permits and travel advice change. Wayfinder gives planning context, not a guarantee of availability or safety; users should verify current details with operators and relevant authorities before travel. Maps searches use place names rather than invented precise coordinates.

Wayfinder is maintained by Riley Nicholas Lawler, an Australian sole trader operating as **RL Applications** (ABN 92 363 169 656). Project-specific material is proprietary; see [LICENSE](LICENSE) and [OWNERSHIP.md](OWNERSHIP.md). Open-source libraries, Natural Earth map data and other third-party material remain under their own terms; see [THIRD-PARTY-NOTICES.md](THIRD-PARTY-NOTICES.md). Research citations establish factual provenance but do not transfer ownership of source websites or their protected content.
