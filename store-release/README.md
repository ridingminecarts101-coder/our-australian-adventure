# Wayfinder iOS entry package

Originally prepared 15 September 2026; updated for the owner-authorised **1.2 (build 14)** public submission on 10 October 2026. **Wayfinder: Adventure Lists 1.1.0 (build 10)** and all eight non-consumable purchases are approved and live on the App Store. The owner uses Apple's individual/sole-trader membership, with **RL Applications** as the studio brand and **help.rlapplications@gmail.com** for support. The coordination workspace holds the current store receipts.

## iOS version rule

The owner's 10 October correction separates the public version from Apple's internal build number. This release is **1.2 (build 14)**; the former build-derived `1.1.N` formula is retired. Build 13 is already uploaded as 1.1.3, so the new public version requires a fresh archive using the next unused internal number. The signed workflow accepts only the explicitly prepared **1.2:14** pair until another release is reviewed. Public **1.1.0 (build 10)** remains unchanged until Apple approves the update. Android `versionName` and `versionCode` remain independent.

The current runtime removes Near me and makes no location or reverse-geocoding request. The retained Capacitor Geolocation SDK still requires `NSLocationWhenInUseUsageDescription` and `NSLocationAlwaysAndWhenInUseUsageDescription`, as documented in its [iOS setup](https://capacitorjs.com/docs/apis/geolocation#ios). Existing purpose declarations remain for compatibility and describe the earlier optional flow. Wayfinder does not enable background location or request Always authorization. The signed archive audit checks the purpose strings against reviewed source.

The legacy `tools/release.py` command is an Android-oriented helper that currently updates both native projects together. Do not use it for an iOS-only release or TestFlight replacement; set the iOS project and signed-workflow defaults deliberately as part of that release instead.

## Use these files in order

1. **Finish and test the exact source.** Run `npm run check`, the 100-plus scenario review, `npm run stage`, `npx cap sync ios`, the iOS release-preparation test, native parity check and unsigned Mac compile. CF, KP and SS remain intentionally empty while Australia's advice is **Do not travel**; the quality check records these three explicit safety-held exceptions and fails for any other missing country. Do not add filler. Commit staged iOS files with the reviewed source; signed delivery refuses a dirty or unstaged checkout.
2. **Preserve the verified backend.** The production group join-choice/history migrations and counts-only postflights passed on 9 October, followed by live disposable-account sharing/deletion checks and cleanup. This version-only packaging change requires no new database migration. See [GROUP-HISTORY-OPERATIONS.md](../supabase/GROUP-HISTORY-OPERATIONS.md) and the coordination receipts; do not rerun schema changes simply to rename a release.
3. **Publish and verify the aligned PWA.** Merge only after production database postflight passes, since `main` automatically deploys the PWA. Verify new and old invite codes, private and shared joins, multiple members' ratings/notes, frozen history after leave, post-leave erasure, account deletion, Realtime and phone-local photos.
4. **Test on both iPhones.** Include consent and privacy boundaries, shared-trip leave behavior, uncertain older-row confirmation, account switching, purchase and restore, offline resume, encrypted photo transfer and explicit **Save photos to camera roll**. Check permission refusal, success and that Photos/iCloud copies remain governed by the phone settings. Review [privacy, age and media guidance](IOS-PRIVACY-AGE-ASSETS.md) and refresh screenshots if the changed UI makes them inaccurate.
5. **Validate and upload the signed archive.** The manual [iOS upload workflow](../.github/workflows/ios-release-upload.yml) runs from `main` in the protected `app-store` environment. Its `upload` mode checks the signed archive, privacy and billing before sending the IPA to TestFlight; `validate-only` is available for a dry run. GitHub requires owner review for each protected run. These actions do not submit to public App Review.
6. **Finish the existing App Store record.** [ios-listing.json](ios-listing.json) holds the **1.2** What's New, description and reviewer steps, including changes since public 1.1.0. Verify review login/contact, screenshots, privacy answers, automatic release after approval, eight approved purchases and the processed **1.2 (build 14)** identity, then submit that exact build. Approval and public availability are separate states.

## Keep private

Apple payment details, identity documents, certificates, provisioning material, private `.p8` keys, mailbox passwords and test-account credentials do not belong in this package, repository or chat. A RevenueCat Apple public SDK key is intentionally public, but the release workflow can inject it into the native build without adding it to source.

## Official account routes

- [Apple programme enrolment](https://developer.apple.com/programs/enroll/)
- [Apple account conversion guidance](https://developer.apple.com/help/account/membership/updating-your-account-information/)
- [Apple membership support](https://developer.apple.com/contact/)
- [Apple developer-name rules](https://developer.apple.com/help/app-store-connect/create-an-app-record/set-your-developer-name/)
- [App Store Connect](https://appstoreconnect.apple.com/)
- [RevenueCat dashboard](https://app.revenuecat.com/)

Preparing **1.2 (build 14)** source and metadata does not itself upload a binary, enter TestFlight, submit the update for review or change the live 1.1.0 listing. The owner has authorised public submission once the exact signed build and review metadata are ready.
