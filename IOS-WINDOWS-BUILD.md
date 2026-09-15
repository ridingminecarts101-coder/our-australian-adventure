# iOS development from this Windows PC

The local Android app has been compiled, and the iOS project has compiled successfully on a hosted Mac. It still needs a signed archive, App Store validation, TestFlight upload and testing on the two available iPhones. No Mac is owned.

## Prepared compilation route

`.github/workflows/ios-compile.yml` is a manual GitHub Actions job using the standard `macos-26` runner and Node 24. It stages the checked-out web assets, synchronises Capacitor's Swift Package dependencies, checks the plist files and compiles an unsigned iOS Simulator build. A shared App scheme is included so the command does not depend on a developer's local Xcode UI settings.

It needs no Apple login or signing secrets. It records the exact source commit, Xcode/SDK versions, build log and result bundle as a seven-day artifact. Its token can read repository contents and is not persisted in the checkout. It has no deployment, database, store upload or signing step.

The exact-source unsigned run [34820343129](https://github.com/ridingminecarts101-coder/our-australian-adventure/actions/runs/34820343129) passed for commit `8645ce27b0b47ff566ee34a6d7eac586d38014e0` with Xcode 26.6. Later source changes require another exact-head compile after they are reviewed and pushed. A successful simulator compile does not prove that an iPhone install, purchase or App Store submission works.

When the reviewed workflow has been published to the repository's default branch, open **Actions → iOS compile check → Run workflow**, choose the reviewed source branch, and inspect the result. Publishing to this repository's main branch also publishes its GitHub Pages app, so coordinate that release rather than pushing main merely to reveal the Actions button. Check the account's Actions availability and spending settings before the first run.

The compiler job uses the committed generated catalog; run the normal data build and ID/coverage checks before preparing a release. It intentionally answers only the native-compilation question. The complete app/content/security check suite remains a separate release requirement.

## Signed archive and upload preparation

`.github/workflows/ios-release-upload.yml` is a separate, manual, fail-closed workflow. It stages the checked-out source, injects the Apple RevenueCat **public** SDK key only into the staged native copy, validates the eight-product contract, imports a temporary distribution identity, archives and verifies `app.wayfinder.mobile`, exports an IPA, and validates it with App Store Connect. Upload runs only when the operator selects `upload` and types `UPLOAD_WAYFINDER`. The IPA is deliberately not retained as a public-repository artifact, and signing material is removed in an `always()` cleanup step.

The workflow has not been run. The repository currently exposes only the `github-pages` environment; the authenticated CLI collaborator has Write access. A repository administrator must create and verify a protected GitHub environment named `app-store` with required reviewers before using the signed workflow. Referencing an environment name in YAML does not by itself create reviewer protection. Add these environment variables:

- `APPLE_TEAM_ID`
- `APP_STORE_CONNECT_KEY_ID`
- `APP_STORE_CONNECT_ISSUER_ID`
- `REVENUECAT_IOS_PUBLIC_SDK_KEY` — the Apple platform public key beginning `appl_`, never a Test Store key

Add these environment secrets:

- `APPLE_DISTRIBUTION_CERTIFICATE_P12_BASE64`
- `APPLE_DISTRIBUTION_CERTIFICATE_PASSWORD`
- `IOS_APP_STORE_PROVISIONING_PROFILE_BASE64`
- `APP_STORE_CONNECT_API_PRIVATE_KEY_P8_BASE64`

Use a distribution certificate and an App Store provisioning profile for the exact bundle ID `app.wayfinder.mobile`. Give the App Store Connect API key only the role required to validate and upload builds. Do not paste any of these values into source, issue text, workflow inputs or chat.

Before the first run, resolve the account route that lets the app appear under the owner-required public publisher name **RL Applications**. Do not proceed under a personal public seller/developer name without a new owner decision. Create the app record and the eight non-consumable products from `tools/ios-products.json`, attach each product to its matching RevenueCat entitlement, and set the RevenueCat project's restore behavior to **Keep with original App User ID**. This setting is required because Wayfinder accounts are mandatory before purchase and a purchase must not transfer from one person's Wayfinder account to another during restore. Then configure the Apple platform public SDK key. These records, settings and keys have not been verified or created by this preparation.

The current client does not call RevenueCat `getOfferings`; it fetches the eight exact product IDs. An Offering and its package identifiers therefore have no runtime contract. If an Offering is created for dashboard organisation or a future RevenueCat paywall, use one current Offering and eight custom packages, each containing the matching platform product. Do not replace the product or entitlement identifiers in `tools/ios-products.json` with package identifiers.

Run `validate-only` with `ARCHIVE_WAYFINDER` first. Review the archive, signing and App Store validation evidence. Only then use `upload` with `UPLOAD_WAYFINDER`. A successful upload still requires TestFlight processing and physical-device testing:

1. Install on both iPhones and use separate disposable Wayfinder accounts.
2. Test purchase and restore for a regional product and the all-continents product, relaunch, reinstall and account switching. Confirm purchases never cross account owners.
3. Test independent completions, group join/share/revoke/leave, offline retries, recovery and deletion. Confirm private notes and device-local photos never follow group membership.
4. Confirm device-local photos remain inside Wayfinder on their origin phone and that the native backup exclusions work on real devices.

A separate hosted-Mac provider is an alternative if GitHub's runner or signing workflow proves unsuitable. It is not another account to create before testing the existing GitHub route.

## Sources checked 15 September 2026

- [Apple upload requirements](https://developer.apple.com/news/upcoming-requirements/) require Xcode 26+ and the iOS 26 SDK for current submissions.
- [GitHub macOS 26 image manifest](https://github.com/actions/runner-images/blob/main/images/macos/macos-26-arm64-Readme.md) describes available Xcode versions; the job records the actual runner versions rather than assuming a fixed minor release.
- [GitHub hosted runners](https://docs.github.com/en/actions/reference/runners/github-hosted-runners) describes supported execution environments.
- [Apple enrolment](https://developer.apple.com/help/account/membership/program-enrollment) distinguishes individual and organisation membership.
- [Apple build uploads](https://developer.apple.com/help/app-store-connect/manage-builds/upload-builds) documents current Xcode and `altool` upload routes.
- [Apple non-consumable creation](https://developer.apple.com/help/app-store-connect/manage-in-app-purchases/create-consumable-or-non-consumable-in-app-purchases) explains the permanent product-ID constraint.
- [RevenueCat customer identity](https://www.revenuecat.com/docs/customers/identifying-customers) recommends avoiding `logOut()` in custom-ID-only apps and switching identified users with `logIn()`.
- [RevenueCat restore behavior](https://www.revenuecat.com/docs/projects/restore-behavior) documents the account-transfer consequences and the strict-account option used here.
- [RevenueCat Capacitor installation](https://www.revenuecat.com/docs/getting-started/installation/capacitor) documents configuration with an `appUserID` and platform public SDK key.

GitHub action versions are pinned to the v6 commit hashes returned by each official repository on the research date. Review updates deliberately.
