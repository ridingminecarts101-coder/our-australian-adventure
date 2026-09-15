# Wayfinder App Store copy and review material

Prepared 15 September 2026 from the current native source and the existing
`ios-listing.json`. This is copy for owner review. It has not been entered in
App Store Connect or submitted to Apple.

## Product-page copy

**Name (30-character limit):** `Wayfinder: Adventure Lists`

**Subtitle (30-character limit):** `Real adventures worldwide`

**Promotional text (170-character limit):**

> Find memorable places, build your adventure list and keep your travel notes together. Explore classic experiences and optional one-time hidden-gem collections.

**Keywords (100-byte limit, no spaces after commas):**

`adventure,bucket list,trip planner,hidden gems,travel journal,passport,memories`

Apple already searches the app name and developer/company name, so the keywords
do not repeat Wayfinder or RL Applications. Do not add another app or company
name. Recheck byte counts in App Store Connect if this text changes. Apple’s
current field definitions and limits are in [Platform version information](https://developer.apple.com/help/app-store-connect/reference/app-information/platform-version-information)
and [App information](https://developer.apple.com/help/app-store-connect/reference/app-information/app-information).

**Description:** use the current `localization.description` in
`store-release/ios-listing.json`. It is under Apple’s 4,000-character limit and
accurately describes account-based progress, device-local new photos, optional
location, separate travel costs, and paid hidden-gem collections. Immediately
before submission, recheck its “more than 5,300” count against the shipped
catalogue and remove any feature that is not reachable in the selected build.

**URLs:**

- Marketing: `https://rlapplications.com/wayfinder/`
- Support: `https://rlapplications.com/wayfinder/support/`
- Privacy: `https://rlapplications.com/wayfinder/privacy/`
- Privacy choices/account deletion: `https://rlapplications.com/wayfinder/delete-account/`

## Content-rights answer

Draft **Yes** to “contains, shows, or accesses third-party content.” Wayfinder
contains a curated travel catalogue with place, venue and operator references,
map data, source links, and a Community feed. Apple requires the developer to
hold the necessary rights or otherwise be legally permitted to use that content
in every selected storefront. This draft does not certify that the requirement
has been met. Complete the licence/editorial, trademark, map-attribution,
Community-terms and screenshot-rights review first. See Apple’s
[Content Rights field](https://developer.apple.com/help/app-store-connect/reference/app-information/app-information)
and [App Review Guidelines section 5.2](https://developer.apple.com/app-store/review/guidelines/#intellectual-property).

Use only fictional review-account text and owner-created or licensed images in
screenshots. Do not use the backed-up historical customer photos.

## App Review information

Enter the owner’s current phone number privately in App Store Connect. Put the
stable verified review account in Apple’s username/password fields; never paste
its password into this repository or the notes below.

Draft Notes for Review:

> Wayfinder is an account-based travel checklist and guide. The supplied review account is verified and uses fictional test data. Keep the backend available throughout review.
>
> Adventures: the opening screen shows the world. Select a continent, then a country. Countries with six or more first-level subdivisions show a subdivision step; smaller countries go directly to their adventure list. Open an adventure to shortlist or complete it and add a note or rating.
>
> Purchases: open Me, then Paid collections. The eight non-consumable products unlock digital hidden-gem guide entries. Seven continent packs are AUD 2.99 each. All continents is AUD 14.99 and includes all seven geographic packs plus the Antarctica collection and future additions. Travel, admission, permits, accommodation and guide services are not included. Restore purchases is directly below the products. Purchases are associated with the signed-in Wayfinder account through RevenueCat’s App User ID.
>
> Near me: return to Adventures and select Near me. Location is requested only then. Coordinates are sent to BigDataCloud to identify the area and are not stored in the Wayfinder account. Manual browsing remains available if permission is declined.
>
> Memories: new photos added by the submitted native build remain in app-private device storage and do not sync to another device. Notes, ratings, completion status and trips sync to the account. Removing the app can remove device-local photos.
>
> Community: open Community to view separately labelled user recommendations. A signed-in, verified account can recommend a place, vote, rate, report and block. Three reports hide a recommendation pending moderation. Community content never enters the curated adventure catalogue.
>
> Account deletion: open Me, then Settings, then Delete my account and all my data. The app confirms before starting deletion. The current backend deletes the Wayfinder account data and queues deletion of the account identifier from RevenueCat. Device-local data is also cleared for that owner.
>
> Privacy, Support and account-deletion information are available from Me and at the URLs supplied with this version.

Before using those notes, verify the final live system and review fixture match
every step. In particular, confirm the RevenueCat deletion worker schedule,
Community moderation process and all eight sandbox purchase/restore paths. The
15 historical Storage objects and 11 active photo records were removed from
production on 15 September with all checked non-photo fingerprints unchanged.
Apple requires a working demo account or approved
demo mode, live backend services and specific explanations of non-obvious
features and purchases; see [App Review Guidelines 2.1](https://developer.apple.com/app-store/review/guidelines/#performance)
and [App Review information](https://developer.apple.com/app-store/review/).

The first non-consumable products must be included with the first app version.
Each product needs its own review screenshot clearly showing the item being
offered. See [Submit an In-App Purchase](https://developer.apple.com/help/app-store-connect/manage-submissions-to-app-review/submit-an-in-app-purchase)
and [In-App Purchase information](https://developer.apple.com/help/app-store-connect/reference/in-app-purchases-and-subscriptions/in-app-purchase-information).

## Privacy and export answers to carry forward

- Choose **data is collected**. Account details, synced records, Community
  content, RevenueCat purchase/identifier data and optional precise location
  processing prevent a No Data Collected answer.
- Keep **tracking: No** unless the final archive or provider configuration adds
  cross-app advertising/tracking behavior.
- Do not select Photos or Videos for the current submitted build if the final
  archive confirms that images and photo metadata remain device-local and the
  live service remains at zero photo rows and Storage objects. RL Applications
  retains an owner-preserved Desktop backup of 15 historical originals and the
  associated snapshots for migration/rollback evidence; disclose and govern
  that retained copy, but do not describe it as a current app upload path.
- Retain the User ID and Purchase History functionality/analytics disclosures
  required by the current RevenueCat integration.
- `ITSAppUsesNonExemptEncryption` is currently false because the app uses
  platform HTTPS/standard encryption. Recheck the signed archive and Apple’s
  export questions; this source observation is not export-law certification.
- The conservative age-rating draft remains User-Generated Content: Yes,
  Social Media: Yes, and Social Media Disabled for Users Under 13: No. The app
  has no declared-age enforcement. Record the rating Apple actually generates.

Apple requires the privacy answers to include third-party partners and remain
current; see [Manage app privacy](https://developer.apple.com/help/app-store-connect/manage-app-information/manage-app-privacy)
and [App privacy](https://developer.apple.com/help/app-store-connect/reference/app-privacy/).

## Genuine screenshot set

The new manual workflow `.github/workflows/ios-store-screenshots.yml` uses
XCUITest against the installed native app on Apple simulators. It signs in with
private GitHub Actions secrets, navigates the real WebView UI, attaches genuine
screenshots to the test result, exports them, converts them to flattened JPEG,
and rejects unexpected dimensions. It performs no App Store upload.

Required values in the protected `app-store` GitHub Actions environment before
dispatch from `main`:

- `WAYFINDER_REVIEW_EMAIL`
- `WAYFINDER_REVIEW_PASSWORD`
- `REVENUECAT_IOS_PUBLIC_SDK_KEY` (environment variable, Apple `appl_` public key)

The review account must be stable, verified, contain fictional text only, have
all packs unowned so purchase rows remain visible, and be safe for repeated
progress/navigation reads. The workflow stops before building when these values
are absent. It validates tracked native staging first, then injects the Apple
public key only into that run's staged iOS assets; the Android key stays blank.
The test runner receives the review credentials through Xcode's `TEST_RUNNER_`
environment mechanism. It never creates a review account.

Captured public-product candidates for both iPhone and iPad:

1. World adventure browser
2. Passport
3. Device-local Memories view
4. Community feed
5. Trips and achievements
6. Paid collections
7. Oceania navigation
8. Australia navigation

It also captures one review-only image while each of the eight IAP rows is
visible. An operator must inspect every exported image for fixture privacy,
correct state, readable copy, safe-area/layout issues, purchase labels and
rights before uploading it. Empty, error, loading, already-owned, stale-price
or duplicated screens must be discarded.

Apple currently permits 1–10 screenshots per supported device family and no
alpha channel. The workflow targets accepted portrait sizes `1320 × 2868`
(6.9-inch iPhone) and `2064 × 2752` (13-inch iPad), then converts to JPEG.
Because the target supports iPhone and iPad, retain at least one accepted set
for each. See Apple’s current [Screenshot specifications](https://developer.apple.com/help/app-store-connect/reference/app-information/screenshot-specifications)
and [upload instructions](https://developer.apple.com/help/app-store-connect/manage-app-information/upload-app-previews-and-screenshots/).

No screenshot has been produced yet. A passing hosted run establishes simulator
capture, not physical-device testing, sandbox purchase success, signed archive
validation or App Store acceptance.
