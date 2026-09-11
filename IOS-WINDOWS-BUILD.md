# iOS development from this Windows PC

The local Android app has been compiled. The iOS project still needs its first macOS compilation, followed by signing and iPhone testing. Two iPhones are available; no Mac is owned.

## Prepared compilation route

`.github/workflows/ios-compile.yml` is a manual GitHub Actions job using the standard `macos-26` runner and Node 24. It stages the checked-out web assets, synchronises Capacitor's Swift Package dependencies, checks the plist files and compiles an unsigned iOS Simulator build. A shared App scheme is included so the command does not depend on a developer's local Xcode UI settings.

It needs no Apple login or signing secrets. It records the exact source commit, Xcode/SDK versions, build log and result bundle as a seven-day artifact. Its token can read repository contents and is not persisted in the checkout. It has no deployment, database, store upload or signing step.

The workflow is **prepared locally and has not run**. XML/YAML validation on Windows is not a native compile result. A successful simulator compile will also not prove that an iPhone install, purchase or App Store submission works.

When the reviewed workflow has been published to the repository's default branch, open **Actions → iOS compile check → Run workflow**, choose the reviewed source branch, and inspect the result. Publishing to this repository's main branch also publishes its GitHub Pages app, so coordinate that release rather than pushing main merely to reveal the Actions button. Check the account's Actions availability and spending settings before the first run.

The compiler job uses the committed generated catalog; run the normal data build and ID/coverage checks before preparing a release. It intentionally answers only the native-compilation question. The complete app/content/security check suite remains a separate release requirement.

## From compilation to the two iPhones

1. Complete Apple Developer enrolment for the correct identity. Apple's sole-trader route is individual enrolment. Establish the `app.wayfinder.mobile` app record, agreements and relevant in-app purchase products in App Store Connect.
2. Configure reviewed distribution signing on a macOS runner: team ID, certificate/provisioning route, and limited App Store Connect upload credentials. This step has not been configured. Do not paste private keys or passwords into source or chat.
3. Archive for a generic iOS device, export the signed distribution build and upload to TestFlight. The unsigned simulator job does not produce a TestFlight-installable IPA.
4. Use separate disposable Wayfinder accounts on the two iPhones. Test independent completions, joining with historical sharing declined/accepted, later sharing, revocation across devices, leaving, offline retries, recovery, deletion, purchase and restore. Confirm that another person's entitlements and private notes never follow a group membership.

A separate hosted-Mac provider is an alternative if GitHub's runner or signing workflow proves unsuitable. It is not another account to create before testing the existing GitHub route.

## Sources checked 11 September 2026

- [Apple upload requirements](https://developer.apple.com/news/upcoming-requirements/) require Xcode 26+ and the iOS 26 SDK for current submissions.
- [GitHub macOS 26 image manifest](https://github.com/actions/runner-images/blob/main/images/macos/macos-26-arm64-Readme.md) describes available Xcode versions; the job records the actual runner versions rather than assuming a fixed minor release.
- [GitHub hosted runners](https://docs.github.com/en/actions/reference/runners/github-hosted-runners) describes supported execution environments.
- [Apple enrolment](https://developer.apple.com/help/account/membership/program-enrollment) distinguishes individual and organisation membership.

GitHub action versions are pinned to the v6 commit hashes returned by each official repository on the research date. Review updates deliberately.
