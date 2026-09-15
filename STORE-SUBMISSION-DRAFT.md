# Wayfinder store submission draft

Updated 15 September 2026 from the published `182f474` baseline and the current
reviewed preparation changes. This is entry-ready metadata and a review
checklist, not evidence that a signed build, purchase or store review has passed.

The owner requires **RL Applications** as the public developer name. An existing
individual/sole-proprietor Apple enrolment is pending payment; it is not an
approved organisation or an active distribution membership. The official
organisation-conversion link currently denies that account access. Apple's
Program Enrolment support form is prepared for the owner to clarify the correct
route. Do not pay, withdraw the enrolment, invent an organisation or accept
personal-name publication without the appropriate owner action.

Current iOS entry package:

- [`store-release/ios-listing.json`](store-release/ios-listing.json): exact listing
  text and review-contact fields; null values identify required owner input.
- [`store-release/REVENUECAT-APPLE-SETUP.md`](store-release/REVENUECAT-APPLE-SETUP.md):
  all eight non-consumables, entitlement mapping, credentials and sandbox checks.
- [`store-release/IOS-PRIVACY-AGE-ASSETS.md`](store-release/IOS-PRIVACY-AGE-ASSETS.md):
  privacy/age/export entry guidance and genuine asset requirements.

Do not upload the existing Android bundle. It was built on 11 September, before
the current account, catalogue and release changes. Create a fresh candidate
only after every release gate below passes.

## Listing metadata

Use English (Australia) as the primary locale.

| Field | Draft |
| --- | --- |
| App name | Wayfinder |
| iOS subtitle | Real adventures worldwide |
| Google Play short description | Discover 5,300+ real adventures worldwide. Save, plan and remember your trips. |
| Primary category | Travel |
| Secondary iOS category | Lifestyle |
| Marketing URL | `https://rlapplications.com/wayfinder/` |
| Support URL | `https://rlapplications.com/wayfinder/support/` |
| Privacy policy URL | `https://rlapplications.com/wayfinder/privacy/` |
| Privacy choices / Play deletion URL | `https://rlapplications.com/wayfinder/delete-account/` |
| iOS keywords | `adventure,bucket list,trip planner,hidden gems,travel journal,passport,memories` |
| Copyright | `2026 Riley Nicholas Lawler trading as RL Applications` |

Public support mailbox: **help.rlapplications@gmail.com**, supplied by the owner
on 15 September 2026. Publish it consistently across the app, website and store
contact fields. Sending, receiving and recovery of this mailbox have not been
independently exercised in this preparation pass. Assign support/moderation
responsibility before commercial release. The verified Resend no-reply sender
is for account messages and is separate from this support mailbox.

### Description

Wayfinder turns a world of possibilities into a personal list of places worth
going.

Browse more than 5,300 adventures around the world. Each
entry gives practical context such as what makes it worthwhile, the likely cost
and the best time to go. Current travel-advisory warnings remain visible, and
destinations marked “do not travel” are excluded from automatic suggestions.

Save ideas to a shortlist, organise them into trips, add personal notes and
photos, and mark experiences complete. Previously loaded catalogue content is
available offline; account changes sync after the device reconnects.

Your progress belongs to your account. New photos stay inside Wayfinder on the
device where you add them; they do not sync to another device. Keep independent
copies of important photos before uninstalling or clearing the app's data.

Classic adventures are included. Optional one-time purchases unlock researched
hidden-gem collections by geography or all continents together. Antarctica is
exclusive to the All continents collection. Travel, admission and guide fees
are separate from the in-app purchase.

Wayfinder is a discovery and planning guide. It does not book travel or replace
current advice from authorities, venues and operators.

The exact iOS description is in `store-release/ios-listing.json`. It avoids
promising currently unavailable group sharing. Account email delivery has
passed live tests, but native device and final backend checks remain. Do not
submit a listing that promises purchases until store review can exercise them.
If a feature is omitted from the submitted build, omit its claims/screenshots.

## In-app products

Create the following as non-consumable in-app purchases on Apple and one-time
products on Google Play. Use the exact existing IDs. Configure the confirmed
Australian base prices in each store; storefront prices and tax presentation
are controlled by the store.

| Product ID | Display name | Australian base price |
| --- | --- | ---: |
| `app.wayfinder.mobile.gems.all` | All continents | AUD $14.99 |
| `app.wayfinder.mobile.gems.oceania` | Oceania gems | AUD $2.99 |
| `app.wayfinder.mobile.gems.europe` | Europe gems | AUD $2.99 |
| `app.wayfinder.mobile.gems.north_america` | North America gems | AUD $2.99 |
| `app.wayfinder.mobile.gems.asia` | Asia gems | AUD $2.99 |
| `app.wayfinder.mobile.gems.middle_east` | Middle East gems | AUD $2.99 |
| `app.wayfinder.mobile.gems.south_america` | South America gems | AUD $2.99 |
| `app.wayfinder.mobile.gems.africa` | Africa gems | AUD $2.99 |

There is no standalone Antarctica product. Attach the store-required review
screenshot to every Apple in-app purchase and verify that Restore purchases
restores the same Wayfinder account on a second device.

## Screenshot plan

Capture final native builds with a disposable review account and no private
user material. Use the real UI and current catalogue; do not place prices,
rankings or claims in image artwork.

1. World discovery view with the current catalogue total.
2. Country view showing practical detail and a current advisory.
3. Personal shortlist or trip planning.
4. A completed adventure with a deliberately created test note/photo.
5. Personal versus group-completion view, only after the secure group migration
   and two-account device tests pass.
6. Hidden-gem store showing All continents first and the Restore purchases
   control, only after sandbox products work.

Apple accepts one to ten screenshots and can scale the highest-resolution
iPhone set when the interface is the same. Google Play needs at least two phone
screenshots and a 1024 by 500 feature graphic; its store icon is a 512 by 512
32-bit PNG. The repository contains the 512 icon, but no approved feature
graphic or final native screenshots.

## Reviewer access and notes

Create or select one disposable, verified Wayfinder review account and confirm
its current login works. Use that account on both platforms and seed only harmless test
content. Put its credentials in each store's private review-access field, never
in this repository, release notes or screenshots. Confirm immediately before
submission that it can sign in without a one-time link or reviewer-owned email
access.

Suggested review notes after the gates pass:

> Wayfinder requires an account so personal progress, groups and purchases stay
> with the same person across devices. Use the private review credentials
> supplied in App Review Information / App access. The Me tab contains Restore
> purchases, privacy and support links, and “Delete my account and all my data.”
> Near me requests foreground location only after the reviewer taps it and also
> offers manual browsing. Community report and block controls are available on
> user posts. All purchases unlock guide content; they do not purchase travel,
> admission or operator services.

Add exact steps for any seeded group and each in-app product. Do not state that
Community is monitored until an operator and response process are active.

## Release gates

### Shared product and backend

- Resolve the previously recorded historical-data discrepancy, then apply only
  the reviewed production migrations in their documented order, with preservation
  checks. Ownership/group administration, Community and the old-client photo
  upload block remain unverified in production. Do not silently accept that
  outstanding data decision or broaden the migration scope.
- Production Resend confirmation, recovery and same-ID account conversion passed
  live tests. Repeat the actual native app flows on both iPhones, including link
  handling and return to the app; web email success does not establish this.
- Complete two-account, two-device tests for ownership, optional completion
  sharing, revocation, leaving, offline edits and sign-out.
- Verify in-app deletion removes the current account's local photos and the
  intended hosted account data, including legacy objects where applicable. Establish
  server-side or monitored RevenueCat customer deletion before claiming complete
  provider deletion.
- Assign a Community moderator and exercise filter, report, block, takedown and
  support response. Apple requires all of these capabilities for user-generated
  content.
- Reconcile App Store privacy and Google Data safety answers against the final
  native archives and every provider. Supabase account/content data,
  BigDataCloud location/IP processing, RevenueCat user ID and purchase history,
  and Community content all need accurate treatment.

### Android / Google Play

- The manifest now omits `READ_MEDIA_IMAGES` and legacy storage permissions for
  the occasional photo-attachment flow. Confirm on physical Android devices
  that both the system picker and camera capture return only the chosen image,
  including permission denial and process-recreation cases.
- Decide whether precise location is genuinely needed for Near me. Request the
  minimum foreground scope and verify denial/manual fallback on physical
  Android devices.
- Configure the Android RevenueCat public SDK key, matching products,
  entitlements; an Offering is optional. Run sandbox purchase, cancel, restore, refund and
  A-to-B account-switch tests.
- Build a new signed AAB from the reviewed commit with a new, unused
  `versionCode`. Verify its merged manifest, signature and embedded web-asset
  hashes. Keep the upload key and recovery material backed up privately.
- Test the release build on representative Android hardware. The owner currently
  has no Android device, so physical Android behavior is unverified.
- Complete Play Console identity, app access, content rating, target audience,
  ads, Data safety, account deletion and permission declarations. API level 36
  is already configured, matching the rule effective 31 August 2026.
- If the new account is an organization account, finish D-U-N-S verification.
  If it is a new personal account, plan for at least 12 opted-in closed testers
  continuously for 14 days before applying for production access.

The missing Play service-account JSON blocks the repository's automation script,
not manual Play Console upload. Do not create that key until automation is
actually wanted; if created later, keep it out of Git.

### iOS / App Store

- Resolve an Apple organisation route compatible with **RL Applications** as
  developer name. The current legal structure remains sole trader; a business
  name and D-U-N-S alone do not create an eligible separate legal entity. The
  owner's existing individual enrolment is not permission to publish under a
  personal name. No Team ID is currently confirmed for signing.
- The unsigned simulator workflow passed in Xcode 26.6 at source `8645ce2`
  ([run 34820343129](https://github.com/ridingminecarts101-coder/our-australian-adventure/actions/runs/34820343129)).
  The following support-only change copied matching iOS assets but was not
  compiled again. Run a fresh exact-source compile after this preparation is
  integrated; this still does not establish signing or device behaviour.
- On a Mac with Xcode 26 or a managed Mac service, select the developer team,
  configure capabilities, compile Release, archive, validate and upload. No iOS
  archive or IPA currently exists.
- Configure the iOS RevenueCat public SDK key and the same eight non-consumable
  products. Test purchase, cancel, restore, refund and account switches in the
  Apple sandbox on both available iPhones.
- Inspect the final archive's aggregated privacy report and align
  `PrivacyInfo.xcprivacy` with App Store Connect. Confirm purchase-history and
  location disclosures with the shipped RevenueCat SDK and BigDataCloud terms.
- Complete the current age-rating questionnaire, export-compliance answer,
  app-privacy labels, review access and in-app-purchase review information.

Apple requires uploads made now to use Xcode 26 or later with an iOS 26 SDK.
Successful unsigned simulator compilation does not validate signing, device
permissions, purchases, an archive, TestFlight or App Review acceptance.

## Primary store references checked

- [Apple upcoming SDK requirements](https://developer.apple.com/news/upcoming-requirements/)
- [Apple App Review Guidelines](https://developer.apple.com/app-store/review/guidelines/)
- [Apple account deletion guidance](https://developer.apple.com/support/offering-account-deletion-in-your-app/)
- [Apple App Store metadata fields](https://developer.apple.com/help/app-store-connect/reference/app-information/platform-version-information)
- [Apple screenshot requirements](https://developer.apple.com/help/app-store-connect/manage-app-information/upload-app-previews-and-screenshots)
- [Apple D-U-N-S and sole-proprietor guidance](https://developer.apple.com/help/account/membership/D-U-N-S)
- [Google Play target API requirements](https://support.google.com/googleplay/android-developer/answer/11926878?hl=en)
- [Google Play listing setup](https://support.google.com/googleplay/android-developer/answer/9859152?hl=en)
- [Google Play preview assets](https://support.google.com/googleplay/android-developer/answer/9866151?hl=en-GB)
- [Google Play Data safety](https://support.google.com/googleplay/android-developer/answer/10787469?hl=en)
- [Google Play account deletion](https://support.google.com/googleplay/android-developer/answer/13327111?hl=en)
- [Google Play photo/video permission policy](https://support.google.com/googleplay/android-developer/answer/14115180?hl=en)
- [Google Play testing for new personal accounts](https://support.google.com/googleplay/android-developer/answer/14151465?hl=en-GB)
- [Google Play organization account information](https://support.google.com/googleplay/android-developer/answer/13628312?hl=en)
