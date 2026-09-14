# Wayfinder store submission draft

Prepared 14 September 2026 from source commit
`64be2dbb61edb953b41f658a4682a723fb8ea033`. This is paste-ready metadata and
a review checklist, not evidence that a store build has passed review.

Do not upload the existing Android bundle. It was built on 11 September, before
the current account, catalogue and release changes. Create a fresh candidate
only after every release gate below passes.

## Listing metadata

Use English (Australia) as the primary locale.

| Field | Draft |
| --- | --- |
| App name | Wayfinder |
| iOS subtitle | Real adventures worldwide |
| Google Play short description | Discover 5,100+ real adventures worldwide. Save, plan and remember your trips. |
| Primary category | Travel |
| Secondary iOS category | Lifestyle |
| Marketing URL | `https://rlapplications.com/wayfinder/` |
| Support URL | `https://rlapplications.com/wayfinder/support/` |
| Privacy policy URL | `https://rlapplications.com/wayfinder/privacy/` |
| Privacy choices / Play deletion URL | `https://rlapplications.com/wayfinder/delete-account/` |
| iOS keywords | `adventure,bucket list,trip planner,hidden gems,travel journal,passport,memories` |
| Copyright | `2026 Riley Nicholas Lawler trading as RL Applications` |

Public support mailbox: **TO BE ASSIGNED**. Email support is temporarily
unavailable. A dedicated RL Applications mailbox must be able to send, receive
and recover access before commercial release; then keep the public pages and
both store consoles in sync. The verified Resend no-reply transactional sender
is for account messages and is not a monitored support mailbox.

### Description

Wayfinder turns a world of possibilities into a personal list of places worth
going.

Browse more than 5,100 adventures across 228 countries and territories. Each
entry gives practical context such as what makes it worthwhile, the likely cost
and the best time to go. Current travel-advisory warnings remain visible, and
destinations marked “do not travel” are excluded from automatic suggestions.

Save ideas to a shortlist, organise them into trips, add personal notes and
photos, and mark experiences complete. Previously loaded catalogue content is
available offline; account changes sync after the device reconnects.

Your progress belongs to your account. Optional groups can share completion
ticks while personal notes, ratings and shortlist choices remain private. You
can stop sharing or leave a group without losing your personal history.

Classic adventures are included. Optional one-time purchases unlock researched
hidden-gem collections by geography or all continents together. Antarctica is
exclusive to the All continents collection. Travel, admission and guide fees
are separate from the in-app purchase.

Wayfinder is a discovery and planning guide. It does not book travel or replace
current advice from authorities, venues and operators.

Do not submit this description while groups are still showing maintenance, the
account email service is not operational, or purchases cannot be exercised by
store review. If a feature is deliberately omitted from the submitted build,
remove its paragraph from the listing and its screenshots.

## In-app products

Create the following as non-consumable in-app purchases on Apple and one-time
products on Google Play. Use the exact existing IDs. Configure the confirmed
Australian base prices in each store; storefront prices and tax presentation
are controlled by the store.

| Product ID | Display name | Australian base price |
| --- | --- | ---: |
| `app.wayfinder.mobile.gems.all` | All continents | AUD $14.99 |
| `app.wayfinder.mobile.gems.oceania` | Oceania hidden gems | AUD $2.99 |
| `app.wayfinder.mobile.gems.europe` | Europe hidden gems | AUD $2.99 |
| `app.wayfinder.mobile.gems.north_america` | North America hidden gems | AUD $2.99 |
| `app.wayfinder.mobile.gems.asia` | Asia hidden gems | AUD $2.99 |
| `app.wayfinder.mobile.gems.middle_east` | Middle East hidden gems | AUD $2.99 |
| `app.wayfinder.mobile.gems.south_america` | South America hidden gems | AUD $2.99 |
| `app.wayfinder.mobile.gems.africa` | Africa hidden gems | AUD $2.99 |

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

Create one disposable, verified Wayfinder review account after production email
delivery works. Use that account on both platforms and seed only harmless test
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

- Apply and verify `supabase/schema-personal-ownership.sql`, then
  `supabase/schema-community-hardening.sql`, using the dated database preflight
  and verification scripts. The current production backend still has the
  legacy group and Community authorization defects.
- Configure production transactional email and verify sign-up, verification,
  recovery and anonymous upgrade on both iPhones. A required-account app cannot
  be reviewed reliably while email delivery is unavailable.
- Complete two-account, two-device tests for ownership, optional completion
  sharing, revocation, leaving, offline edits and sign-out.
- Verify in-app deletion removes all account data and uploaded objects. Establish
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
  entitlements and offering. Run sandbox purchase, cancel, restore, refund and
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

- Enrol Riley Lawler as an individual/sole proprietor unless the legal structure
  changes. Apple says an individual/sole proprietor does not need D-U-N-S and
  lists apps under the person's legal name; it does not accept a trading name as
  an organization. The developer project currently has no Team ID.
- The existing unsigned simulator workflow passed in Xcode 26.6 at commit
  `64be2dbb61edb953b41f658a4682a723fb8ea033`; retain
  [run 34791919097](https://github.com/ridingminecarts101-coder/our-australian-adventure/actions/runs/34791919097)
  and its seven-day artifact as compile evidence. This is compilation evidence
  only.
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
