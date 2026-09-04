# Publishing Wayfinder

Everything that can be done in code is done. What is left needs a human, an
Apple account, or a physical device, and is listed at the bottom in order.

---

## The state of things

| | |
|---|---|
| Adventures | 2,015 across 123 countries, 576 regions |
| Countries listed | 228, including every country with nothing mapped yet |
| Web app | live on GitHub Pages, installable, works offline |
| Native shell | Capacitor configured, `app.wayfinder.mobile`, not yet built |
| Backend | Supabase — Postgres, Storage, Realtime |
| Account deletion | in-app, immediate, permanent (Apple requires this) |
| Privacy policy | `privacy.html`, served alongside the app |
| Support page | `support.html`, served alongside the app |

---

## Before anything else: the security cutover

**Do this first and do not skip it.** Until now every phone signed in as the
same account, because anonymous sign-ups were switched off and the app fell
back to a shared passphrase. That is why a third phone broke the group.

Row Level Security is currently `to authenticated using (true)` — any signed-in
account can read every row. That was acceptable for two trusted phones. The
moment sign-ups open to the public it is a data breach.

1. Supabase → SQL Editor → paste and run **`supabase/schema-cutover.sql`**.
2. Read the notices it prints at the end. It reports the number of accounts,
   groups and rows, and warns about anything left without an owner.
3. **Then** Supabase → Authentication → Sign In / Providers → turn ON
   *Allow new users to sign up*.

In that order. Opening sign-ups before the policies exist would expose
everything to anyone who installs the app.

### Prove it worked

Open the app, then in the browser console:

```js
const s = document.createElement('script');
s.src = 'tools/multiuser-test.js';
document.head.appendChild(s);
await runMultiuserTest();
```

It creates four throwaway accounts, runs three of them through create → join →
rename → tick → leave, checks the fourth (a stranger) can read none of it, and
deletes them all again. It touches nothing of yours. `failed: 0` means sharing
genuinely works for three people and outsiders see nothing.

If it comes back `blocked`, it tells you which setting is still off.

---

## What is sold, and what is never behind the paywall

Hidden gems are the paid content: 806 of the 2,015 entries. Everything else is
free forever.

**Locked gems do not count towards anything.** A region with 71 adventures of
which 30 are unbought gems asks for 41, not 71. Progress, stamps, achievements
and "The Lot" all measure what you can actually reach. Buying a pack raises the
target and folds the gems in. Nobody who declines to pay can ever be stopped
from finishing — that would be a hostile design and it would fail review.

Locked gems still appear in the list, blurred, with their region, category,
difficulty and cost visible. You can see there is something there and roughly
what kind of thing it is; what is withheld is which place and why it is worth
the detour.

## App Store Connect — the answers you will be asked for

**Privacy nutrition label.** The honest answers:

| Question | Answer |
|---|---|
| Data used to track you | **None** |
| Data linked to you | User ID (anonymous), plus photos, and a display name if set |
| Data not linked to you | None |
| Contact info | Not collected |
| Location | Requested only on pressing *Near me*, used once, not stored |
| Identifiers | An anonymous account id. No advertising identifier |
| Analytics / diagnostics | None collected |
| Third-party SDKs | None. Supabase is infrastructure, not an SDK partner |

**Age rating.** 4+. No user-generated content is shared publicly, no ads, no
gambling. One caveat to consider: several entries mention beer, wine and
distilleries as part of describing a place. If the reviewer flags it,
*Infrequent/Mild Alcohol, Tobacco, or Drug Use or References* is the honest box.

**Account deletion.** Me → *Delete my account and all my data*. Point the
reviewer at it; it is a hard requirement and it is genuinely implemented.

**Permissions, and why.** These strings need to be in `Info.plist`:

- `NSPhotoLibraryUsageDescription` — "To attach your own photos to the places
  you have been."
- `NSCameraUsageDescription` — "To take a photo for an adventure you have just
  finished."
- `NSLocationWhenInUseUsageDescription` — "To find adventures near where you
  are. Only used when you press Near me."

Each one is optional in use: the app works fully without any of them.

**URLs.**
- Privacy policy: `https://<your-pages-domain>/privacy.html`
- Support: `https://<your-pages-domain>/support.html`

**Export compliance.** The app uses HTTPS only, no custom cryptography.
The usual answer is "uses standard encryption, exempt".

---

## Build the native shell

Node is required for this and is not installed yet.

```bash
npm install
npx cap add ios
npx cap add android
npx cap sync
npx cap open ios
```

`capacitor.config.json` already carries the app id, name, splash and
notification icon settings. `webDir` is `.` because there is no build step —
the app ships as it is written.

---

## What needs a human

In order. Nothing here can be done from code.

1. **Run `supabase/schema-cutover.sql`** in the Supabase SQL Editor, and read
   the notices it prints.
2. **Turn on "Allow new users to sign up"** in Supabase — after step 1, not
   before.
3. **Run the multi-user test** from the console (above) and check `failed: 0`.
   This is the answer to "how do I test sharing without three phones".
4. **Re-add the third phone.** Delete and reinstall on all three so each gets a
   fresh identity, then create the group on one and join from the other two
   with the code. Check each phone shows its own name under *Change name* and
   that all three names appear against ticks.
5. **Install Node.js** (LTS), then run the Capacitor commands above.
6. **Enrol in the Apple Developer Program** — 99 USD/year, and expect a few days
   for identity verification. Nothing else can proceed without it.
7. **Register the bundle id** `app.wayfinder.mobile` and create the App Store
   Connect record.
8. **Take screenshots** on a real device or simulator — 6.7" and 6.5" iPhone are
   required, iPad if you ship for iPad. The world map, a continent zoom, an
   adventure with a photo, the passport and a trip make a good five.
9. **Add the `Info.plist` permission strings** listed above.
10. **Create the in-app purchases** in App Store Connect and Google Play.
    Six products, all **non-consumable**, ids exactly as below:

    | Product id | Shown as | Price |
    |---|---|---|
    | `app.wayfinder.mobile.gems.all` | Every hidden gem | $9.99 |
    | `app.wayfinder.mobile.gems.oceania` | Oceania gems (270) | $1.99 |
    | `app.wayfinder.mobile.gems.europe` | Europe gems (225) | $1.99 |
    | `app.wayfinder.mobile.gems.north_america` | North America gems (171) | $1.99 |
    | `app.wayfinder.mobile.gems.asia` | Asia gems (106) | $1.99 |
    | `app.wayfinder.mobile.gems.middle_east` | Middle East gems (34) | $1.99 |

    Turn **Family Sharing on** for all six — this is a household app and it
    costs nothing to allow. Do not create South America or Africa yet; they
    have no gems and an empty pack fails review.

11. **Install a purchases plugin** and the code will use it automatically —
    `store.js` looks for `Capacitor.Plugins.Purchases` and falls back to the
    simulator when it is absent. Any plugin exposing `getProducts`,
    `purchase` and `restorePurchases` will do; adjust the three call sites in
    `Billing` if the shape differs.
12. **Set the support and privacy URLs** in App Store Connect to the two pages
    above, once you know the final domain.
13. **Google Play**, if you want it: a separate 25 USD one-off, its own console,
    and a Data Safety form that asks the same questions as the table above.

---

## Known gaps, stated plainly

- **No coordinates.** All 2,015 entries have `lat`/`lon` set to `null`. They were
  left empty rather than invented. Pins on the map, distance sorting and
  "nearest to me" all need a geocoding pass first. *Near me* currently resolves
  your region by name, which works, but cannot sort by distance.
- **Billing is not wired to a real store.** The purchase flow, entitlements,
  locking and restore all work and are tested, but on a phone they need a
  Capacitor purchases plugin (see below). In a browser it runs a clearly
  labelled simulator.
- **Legacy photo paths.** Photos uploaded before this release live at
  `<adventure>/<id>.jpg` with no owner prefix. The app moves them under the
  right scope by itself on next launch; until it has, the storage policy still
  allows the old shape, so nothing breaks and nothing is lost.
- **Turkiye** is filed wholly under the Middle East, including Istanbul. That is
  a judgement call, not an oversight.
