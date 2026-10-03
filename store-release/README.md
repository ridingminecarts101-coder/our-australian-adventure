# Wayfinder iOS entry package

Originally prepared 15 September 2026; updated for the 1.1.0 (build 10) candidate on 3 October 2026. **Wayfinder: Adventure Lists 1.0.9 (build 9)** and all eight non-consumable purchases are approved and live on the App Store. The owner uses Apple's individual/sole-trader membership, with **RL Applications** as the studio brand and **help.rlapplications@gmail.com** for support. The coordination workspace holds the current store receipts.

## iOS version rule

The owner selected **1.1.0 (build 10)** for the next iOS update, superseding the former 1.0.N/build N convention. The signed workflow accepts only that exact pair until the next release is deliberately prepared; a retry after Apple accepts build 10 must use a higher build number. The currently live binary remains **1.0.9 (build 9)** until a tested replacement passes App Review. Android `versionName` and `versionCode` remain independent and must not be changed merely to match an iOS upload.

The Capacitor Geolocation plugin requires both `NSLocationWhenInUseUsageDescription` and `NSLocationAlwaysAndWhenInUseUsageDescription`, as documented in its [iOS setup](https://capacitorjs.com/docs/apis/geolocation#ios). Both describe the existing optional Near me lookup and its BigDataCloud disclosure. Wayfinder does not enable background location or request Always authorization. The signed archive audit checks the purpose strings against reviewed source before delivery.

The legacy `tools/release.py` command is an Android-oriented helper that currently updates both native projects together. Do not use it for an iOS-only release or TestFlight replacement; set the iOS project and signed-workflow defaults deliberately as part of that release instead.

## Use these files in order

1. **Finish and test the source.** Run `npm run check`, `npm run stage`, `npx cap sync ios`, the iOS release-preparation test and native parity check. The content audit still flags CF, KP and SS as empty; this is an existing catalogue gap, not a date-editor failure. Commit the staged iOS files with the reviewed source; signed delivery refuses a dirty or unstaged checkout.
2. **Verify the date migration.** The owner reported that [schema-completion-dates.sql](../supabase/schema-completion-dates.sql) succeeded in production before the aligned PWA v67 went live. Independently confirm the `completed_on` column and expanded `group_completion_feed` before submitting the iOS update for public review. The migration preserves older ticks, keeps edited calendar dates stable across time zones and refreshes consented groups when a date changes.
3. **Review store metadata.** [ios-listing.json](ios-listing.json) holds the prepared 1.1.0 version and reference copy. Check its description, privacy details and review notes against the final group-trip, completion-date and explicit Save photos to camera roll behavior. Existing App Store record `6812170174` and all eight purchases are already live; a new app record or purchase set is not needed.
4. **Validate the signed archive.** The manual [iOS upload workflow](../.github/workflows/ios-release-upload.yml) runs from `main` in the protected `app-store` environment. Its `upload` mode checks the signed archive, privacy and billing before sending the IPA to TestFlight; `validate-only` is also available when a separate dry run is needed. GitHub requires owner review for each protected run. These actions do not submit the update for public App Review.
5. **Test on both iPhones.** Check personal versus shared trips, a second group member's realtime updates, permission boundaries, leaving a group, offline behavior, account switching, purchases/restores and phone-local photos. On an iPhone, test **Save photos to camera roll** from Me after adding photos, including count confirmation, permission refusal and a successful Photos-library copy. Check that app copies remain, no copy appears without an explicit action and account deletion does not remove Photos-library copies. On the web and Android, check the unavailable message and encrypted-backup route. Tick an adventure today, change it to a past date and back again, verify Passport and Memories, and confirm that a consented group receives only the revised date. Review [privacy, age and media guidance](IOS-PRIVACY-AGE-ASSETS.md) and refresh screenshots if the update materially changes the pictured UI.
6. **Submit only the tested build.** Select the processed 1.1.0 (build 10) binary in the existing App Store record, complete any version-specific metadata and submit it for App Review. Approval, release and public availability are separate states.

## Keep private

Apple payment details, identity documents, certificates, provisioning material, private `.p8` keys, mailbox passwords and test-account credentials do not belong in this package, repository or chat. A RevenueCat Apple public SDK key is intentionally public, but the release workflow can inject it into the native build without adding it to source.

## Official account routes

- [Apple programme enrolment](https://developer.apple.com/programs/enroll/)
- [Apple account conversion guidance](https://developer.apple.com/help/account/membership/updating-your-account-information/)
- [Apple membership support](https://developer.apple.com/contact/)
- [Apple developer-name rules](https://developer.apple.com/help/app-store-connect/create-an-app-record/set-your-developer-name/)
- [App Store Connect](https://appstoreconnect.apple.com/)
- [RevenueCat dashboard](https://app.revenuecat.com/)

Preparing 1.1.0 (build 10) source and metadata does not upload a binary, enter TestFlight, submit the update for review or change the live 1.0.9 listing.
