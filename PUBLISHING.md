# Publishing Wayfinder

Everything that can be done from this machine is done, including a signed
Android release. What is left needs a Mac, an Apple account, or a human
pressing a button on somebody else's website, and is listed at the bottom in
the order it has to happen.

---

## The state of things

| | |
|---|---|
| Adventures | 2,356 across 123 countries, 583 regions |
| Countries listed | 228, including every country with nothing mapped yet |
| Hidden gems | 255 (11%) — the paid content |
| Web app | live on GitHub Pages, installable, works offline |
| **Android** | **builds a signed release AAB and APK on this machine** |
| **iOS** | **project scaffolded and fully configured; needs a Mac to compile** |
| Billing | RevenueCat, one integration for both stores |
| Backend | Supabase — Postgres, Storage, Realtime |
| Account deletion | in-app, immediate, permanent (Apple requires this) |
| Privacy policy | `privacy.html`, served alongside the app |
| Support page | `support.html`, served alongside the app |

---

## Building

```bash
npm install          # once
npm run stage        # www/ — exactly the files that ship
npm run android:aab  # signed bundle for Google Play
npm run android:apk  # signed APK you can sideload onto a phone today
npm run build:icons  # regenerate every icon and splash from icons/icon-512.png
npm run check        # the five static checks
```

Output lands in `android/app/build/outputs/`. The APK is the useful one before
launch: put it on all three phones over USB or a link and the group flow can
finally be tested as a real installed app rather than three browser tabs.

`webDir` is `www`, not `.`. The project root now holds `node_modules`,
`android/` and `ios/`, and Capacitor copies `webDir` wholesale into the app
bundle — so `tools/stage.mjs` writes out the shipping files and nothing else.
If a file is not in its `SHIP` list, it is not in the app.

### What is deliberately not in the native build

The service worker. Inside a native shell every file is already on the device,
so there is no offline problem left to solve, and a worker that outlives an app
update will happily keep serving the version it cached — which is how a shipped
fix reaches nobody. `app.js` skips registration on native. The web build is
unaffected and still works offline.

### Signing

`android/keystore.properties` and `android/keystore/wayfinder-upload.jks` hold
the release key. **Neither is in git, and neither can be replaced.**

- **Back both up somewhere that is not this laptop.** Without them you can
  never ship an update to the same Play listing.
- **Enrol in Play App Signing at the first upload.** Google then holds the real
  signing key and this one becomes only an *upload* key, which they can reset
  for you if it is ever lost. Do this; it removes the single worst
  unrecoverable failure in Android publishing.
- Certificate is RSA 4096, valid to 2054, well past Play's 2033 minimum.

If `keystore.properties` is missing the release build still configures and
compiles — it just comes out unsigned, which is a much better failure than a
build script that cannot be read at all.

---

## Before anything else: the security cutover

**Both SQL files have been run and sign-ups are open.** Recorded here because
the order mattered and re-running the wrong file would undo it:

1. `supabase/schema-cutover.sql` — own-or-group Row Level Security ✅
2. `supabase/schema-recommendations.sql` — the community tables ✅
3. Authentication → Sign In / Providers → *Allow new users to sign up* → ON ✅

**Do not re-run `setup-all.sql`.** It creates the old "any signed-in account
may read everything" policies, which is exactly what the cutover replaced. It
now refuses to run if it detects the cutover, and says so, but the safe habit
is to take the single statement you need rather than running whole files twice.

### Proving it still works

```js
const s = document.createElement('script');
s.src = 'tools/multiuser-test.js';
document.head.appendChild(s);
await runMultiuserTest();
```

Four throwaway accounts, three of them through create → join → rename → tick →
leave, the fourth checking a stranger can read none of it, then all four
deleted. It touches nothing of yours. Last run: **15 passed, 0 failed.**

---

## What is sold, and what is never behind the paywall

Hidden gems are the paid content: 255 of 2,356 entries. Everything else is free
forever.

**Locked gems do not count towards anything.** A region with 71 adventures of
which 30 are unbought gems asks for 41, not 71. Progress, stamps, achievements
and "The Lot" all measure what you can actually reach. Buying a pack raises the
target and folds the gems in. Nobody who declines to pay can be stopped from
finishing — that would be hostile, and it would fail review.

Locked gems appear in the list blurred, with their region, category, difficulty
and cost visible. You can see there is something there and roughly what kind of
thing it is; what is withheld is which place and why it is worth the detour.

### Billing runs through RevenueCat

One integration, two stores. The alternative is writing StoreKit and Play
Billing separately and keeping both correct forever, where the failure mode is
telling somebody who paid that they did not.

- Free below $2,500/month of tracked revenue.
- Ownership is read from **entitlements**, falling back to the raw list of
  purchased product ids — so the app behaves correctly before anybody has
  configured a single entitlement in the RevenueCat dashboard.
- Prices shown on the buttons come from the store when it answers, in the
  buyer's own currency. The strings in `store.js` are only a fallback.
- `restorePurchases` replaces local state rather than merging, so a refund or a
  revoked family share actually takes the content away again.

Set the two keys in `config.js` → `revenueCat`. Both empty means the app stays
in its clearly-labelled simulator, which is correct in a browser.

**Preview mode is browser-only** and keyed off the platform, not off whether a
store key is present. Shipping with an empty RevenueCat key therefore costs you
a broken shop, not a free-for-all.

---

## Traveller recommendations, and what Apple requires of them

The Community tab carries public user-generated content, which brings Guideline
1.2 into play. It demands four things and all four are built:

| Requirement | How |
|---|---|
| Filter objectionable content | Three independent reports hide a post from everyone pending review |
| Report mechanism | On every post that is not your own |
| Block abusive users | Per viewer, enforced in the database so a blocked account cannot reach you by any route |
| Published contact | On the support page, linked from the Community tab itself |

Answer the review team plainly: recommendations are a **separate list** that
never joins the curated adventures, never counts towards completion, and is
labelled as unchecked on the screen it appears on.

You will need to say **Yes** to the App Store Connect question about
user-generated content, and the age rating may move to 12+ on the
"Infrequent/Mild Mature/Suggestive Themes" question that UGC usually triggers.
That is the honest answer; claiming otherwise is how apps get pulled later.

---

## App Store Connect — the answers you will be asked for

**Privacy nutrition label.**

| Question | Answer |
|---|---|
| Data used to track you | **None** |
| Data linked to you | User ID (anonymous), plus photos, and a display name if set |
| Data not linked to you | None |
| Contact info | Not collected |
| Location | Requested only on pressing *Near me*, used once, not stored |
| Identifiers | An anonymous account id. No advertising identifier |
| Analytics / diagnostics | None collected |
| Third-party SDKs | RevenueCat, for purchases only. It sees a purchase and an anonymous id, not your data |

**Age rating.** 4+ before the community tab is considered; expect 12+ with it.
Several entries mention beer, wine and distilleries as part of describing a
place — if a reviewer flags it, *Infrequent/Mild Alcohol, Tobacco, or Drug Use
or References* is the honest box.

**Account deletion.** Me → *Delete my account and all my data*. Point the
reviewer at it; it is a hard requirement and it is genuinely implemented.

**Permissions.** Already written into `ios/App/App/Info.plist`:

- `NSCameraUsageDescription`, `NSPhotoLibraryUsageDescription`,
  `NSPhotoLibraryAddUsageDescription`, `NSLocationWhenInUseUsageDescription`

Each feature is optional in use: the app works fully without any of them.

**Export compliance.** `ITSAppUsesNonExemptEncryption` is already `false` in
Info.plist, so App Store Connect stops asking on every upload. HTTPS only, no
custom cryptography.

**URLs.**
- Privacy policy: `https://ridingminecarts101-coder.github.io/our-australian-adventure/privacy.html`
- Support: `https://ridingminecarts101-coder.github.io/our-australian-adventure/support.html`

---

## Google Play — the answers you will be asked for

- **$25 one-off** registration, versus Apple's $99/year. Play is the cheaper
  and faster of the two to get onto, and the AAB is already built.
- **Data safety form** asks the same questions as the table above.
- **Permissions.** The merged manifest declares exactly: `INTERNET`,
  `ACCESS_NETWORK_STATE`, `CAMERA`, `ACCESS_COARSE_LOCATION`,
  `ACCESS_FINE_LOCATION`, `READ_MEDIA_IMAGES`, `READ_EXTERNAL_STORAGE`
  (≤ API 32), `POST_NOTIFICATIONS`, `RECEIVE_BOOT_COMPLETED`, `WAKE_LOCK`.

  `SCHEDULE_EXACT_ALARM` arrives with the notifications plugin and is
  **removed** in the manifest on purpose. Play treats exact alarms as a
  restricted permission and asks you to justify it against a list that an alarm
  clock is on and a travel checklist is not. Nothing here needs to fire at an
  exact minute.

- **Camera, location and GPS are declared `uses-feature required="false"`**, so
  the listing is not hidden from tablets that lack them.
- **Target API 36**, min API 24 — current, and comfortably inside Play's window.
- **Deep links** are declared but not verified. Verifying an App Link needs
  `.well-known/assetlinks.json` at the *root* of the domain, and the app lives
  on a path under `github.io` whose root is a different repository. Unverified,
  Android shows an "open with" chooser instead of going straight in: one extra
  tap, nothing broken. Turn `autoVerify` on the day the app has its own domain.

---

## What needs a human

In order. Nothing here can be done from code.

1. **Back up the keystore.** `android/keystore/` and
   `android/keystore.properties`, somewhere that is not this laptop. Do it
   before anything else on this list.
2. **Sideload the APK on all three phones** and run the group flow for real:
   create on one, join from the other two with the code, check each phone shows
   its own name and that all three names appear against ticks. This is the test
   that was impossible before.
3. **Google Play** — $25, create the app, upload the AAB, enrol in Play App
   Signing, fill in the Data safety form. This can be finished today.
4. **RevenueCat** — free account, add both apps, paste the two public keys into
   `config.js`.
5. **Apple Developer Program** — $99/year, and expect a few days for identity
   verification. Nothing on the iOS side can proceed without it.
6. **Register the bundle id** `app.wayfinder.mobile` and create the App Store
   Connect record.
7. **A Mac with Xcode.** `npx cap open ios`, set the team, archive, upload.
   Everything else about the iOS project is already configured.
8. **Screenshots** on a real device or simulator — 6.7" and 6.5" iPhone are
   required. The world map, a continent zoom, an adventure with a photo, the
   passport and a trip make a good five.
9. **Create the in-app purchases.** Five products, all **non-consumable**, ids
   exactly as below. Prices are the current ones; see `REVENUE.md` before you
   commit to them.

   | Product id | Shown as | Price |
   |---|---|---|
   | `app.wayfinder.mobile.gems.all` | Every hidden gem (255) | $9.99 |
   | `app.wayfinder.mobile.gems.oceania` | Oceania gems (125) | $1.99 |
   | `app.wayfinder.mobile.gems.north_america` | North America gems (74) | $1.99 |
   | `app.wayfinder.mobile.gems.europe` | Europe gems (44) | $1.99 |
   | `app.wayfinder.mobile.gems.asia` | Asia gems (12) | $1.99 |

   Turn **Family Sharing on** for all five — this is a household app and it
   costs nothing. Do **not** create Middle East, South America or Africa: they
   have no gems, and an empty pack fails review. The app hides them by itself,
   counting from the data rather than a written-down number, so a pack can
   never advertise a figure it does not contain.

10. **Apply to Viator and GetYourGuide** — free, takes days to weeks, and needs
    only the live web app you already have. See `REVENUE.md`; the code is
    written and dormant until the ids are in `config.js`.

---

## Known gaps, stated plainly

- **No coordinates.** All 2,356 entries have `lat`/`lon` set to `null`. They
  were left empty rather than invented. Pins on the map, distance sorting and
  true "nearest to me" all need a geocoding pass first. *Near me* currently
  resolves your region by name, which works, but cannot sort by distance.
- **Billing has never touched a real store.** The flow, entitlements, locking
  and restore all work and are tested against the simulator, but the first real
  purchase will happen in Apple's sandbox and Play's internal test track. Budget
  an afternoon for it.
- **iOS has never been compiled.** The project is configured correctly as far
  as text files go, and Capacitor 8 uses Swift Package Manager so there is no
  CocoaPods step to get wrong — but no Mac has built it, so treat the first
  build as an unknown.
- **The RevenueCat plugin warns about Capacitor 7** if an older version is
  installed. The pinned version is 13.5.0, which declares Capacitor 8 support.
- **Legacy photo paths.** Photos uploaded before the cutover live at
  `<adventure>/<id>.jpg` with no owner prefix. The app moves them under the
  right scope on next launch; until it has, the storage policy still allows the
  old shape, so nothing breaks and nothing is lost.
- **Photos are stored at 1,600px.** Fine for the app, a constraint on printed
  books. See `REVENUE.md` — it is the one decision with a deadline.
- **Türkiye** is filed wholly under the Middle East, including Istanbul. A
  judgement call, not an oversight.
