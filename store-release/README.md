# Wayfinder iOS entry package

Prepared 15 September 2026. This folder contains reviewed preparation material, not an App Store submission or approval. The public publisher name must be **RL Applications**. The support address is **help.rlapplications@gmail.com**.

## Use these files in order

1. **Resolve Apple membership and publisher identity.** The existing individual/sole-proprietor enrolment is pending, and the account currently cannot access App Store Connect. Apple's individual-to-organisation migration page rejects this pending account; the Program Enrolment support form is the available route for an enquiry. No payment, withdrawal, conversion or message submission has been made by this preparation. Apple says sole proprietors enrol as individuals and organisations require a qualifying legal entity; D-U-N-S alone does not change that. Do not create the first app under a personal developer name as a workaround.
2. **Create the app record** using [ios-listing.json](ios-listing.json). It contains the exact bundle ID, proposed SKU, English (Australia) listing copy, URLs and review notes. Null fields remain genuinely unanswered: review phone, private review login and distribution availability. Keep reviewer credentials outside Git and provide a working disposable review account directly to Apple once the backend is ready.
3. **Connect payments** using [REVENUECAT-APPLE-SETUP.md](REVENUECAT-APPLE-SETUP.md) and [the product manifest](../tools/ios-products.json). These specify all eight non-consumables, AUD pricing and matching entitlements. The RevenueCat owner sign-in, Apple product records and credentials remain incomplete. Paid Apps agreements, banking and tax forms require the Account Holder.
4. **Complete privacy, age and media entries** using [IOS-PRIVACY-AGE-ASSETS.md](IOS-PRIVACY-AGE-ASSETS.md). The existing app icon is ready in [assets](assets/). Genuine iPhone, iPad and purchase-review screenshots still need the final running native app. Confirm the privacy labels against the final app and backend; the prepared answers are not legal certification or proof that the remaining backend gates are complete.
5. **Sign and validate** using [IOS-WINDOWS-BUILD.md](../IOS-WINDOWS-BUILD.md). The prepared manual GitHub workflow can run on a hosted Mac after the protected signing environment is configured. First use validate-only; inspect its results before choosing upload. The unsigned compile check needs no Apple credentials and is a separate check.
6. **Test on both iPhones**, including verification/recovery, device-local photos, account switching, purchases/restores, group consent and deletion. Resolve the existing backend preservation/migration and moderation gates in [STORE-SUBMISSION-DRAFT.md](../STORE-SUBMISSION-DRAFT.md). Submit the tested app and its first purchases together only after those gates pass.

## Keep private

Apple payment details, identity documents, certificates, provisioning material, private `.p8` keys, mailbox passwords and test-account credentials do not belong in this package, repository or chat. A RevenueCat Apple public SDK key is intentionally public, but the release workflow can inject it into the native build without adding it to source.

## Official account routes

- [Apple programme enrolment](https://developer.apple.com/programs/enroll/)
- [Apple account conversion guidance](https://developer.apple.com/help/account/membership/updating-your-account-information/)
- [Apple membership support](https://developer.apple.com/contact/)
- [Apple developer-name rules](https://developer.apple.com/help/app-store-connect/create-an-app-record/set-your-developer-name/)
- [App Store Connect](https://appstoreconnect.apple.com/)
- [RevenueCat dashboard](https://app.revenuecat.com/)

No signed build, TestFlight upload, store review or customer purchase has been performed by this preparation. A successful PWA deployment or simulator compile must not be reported as any of those outcomes.
