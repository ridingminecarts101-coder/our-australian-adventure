# Wayfinder iOS privacy, age rating and store assets

Prepared 15 September 2026 from the current local native source. This is entry guidance for App Store Connect, not a submission receipt or an owner declaration. Recheck it against the final signed archive, live services and the questionnaire Apple presents at submission time.

## Evidence reviewed

- `ios/App/App/PrivacyInfo.xcprivacy`: eight collected-data declarations, no tracking, no tracking domains, and required-reason entries for UserDefaults (`CA92.1`) and file timestamps (`C617.1`).
- `ios/App/App/Info.plist`: camera, photo-library and foreground precise-location purpose strings; `ITSAppUsesNonExemptEncryption` is `false`.
- `ios/App/App.xcodeproj/project.pbxproj`: deployment target iOS 15.0 and device families `1,2` (iPhone and iPad).
- `package-lock.json` and native package configuration: RevenueCat Purchases, Supabase, Capacitor Geolocation and the other listed native dependencies are present.
- Current application behavior and public policies: required email account; synced progress, notes and trips; device-local new photos; readable legacy cloud photos; optional Near me; RevenueCat-backed non-consumable plans; Community recommendations, votes, ratings, reports and blocks.
- `data/adventures.json`: 5,358 stored entries, of which 5,341 have no unavailable marker. All 5,358 have `verified_at`; the shipped records do not contain per-row `source` or `sources` fields.
- `THIRD-PARTY-NOTICES.md`: dependency licences, map provenance and the distinction between research citations and ownership of third-party sites or brands.

Apple requires app-level privacy answers to include the developer's practices and integrated third-party partners, and requires those answers to be kept current. See [Manage app privacy](https://developer.apple.com/help/app-store-connect/manage-app-information/manage-app-privacy/) and [App privacy details](https://developer.apple.com/help/app-store-connect/reference/app-privacy-details/). RevenueCat separately documents the disclosures its SDK requires in [Apple App Privacy](https://www.revenuecat.com/docs/platform-resources/apple-platform-resources/apple-app-privacy).

## App privacy entry

Choose **Yes, data is collected**. **No Data Collected is false** for the current build even though new photo files stay on the device: Wayfinder has accounts and hosted personal records, can display older hosted photos, sends optional coordinates to BigDataCloud, and integrates RevenueCat for purchases.

Use this as the draft App Store Connect inventory. “Linked” and “not used for tracking” match the current app privacy manifest. Do not downgrade a declaration without evidence from the final archive and every active provider.

| Apple data type | Draft use | Linked to identity | Tracking | Current reason |
| --- | --- | --- | --- | --- |
| Contact Info — Email Address | App Functionality | Yes | No | Supabase account, verification/recovery and account-related support. |
| Contact Info — Name | App Functionality | Yes | No | Optional display name used with account/group/Community features. |
| Identifiers — User ID | App Functionality and Analytics | Yes | No | Supabase UUID identifies hosted records and is passed as the custom RevenueCat App User ID. RevenueCat says custom App User IDs require User ID disclosure and that identifier usage must be answered like purchases. The native manifest now declares both purposes to match that guidance. |
| Purchases — Purchase History | App Functionality and Analytics | Yes | No | RevenueCat receipt validation, entitlements, customer history and charts. RevenueCat identifies both purposes as its minimum Purchase History disclosure. Purchases are account-bound, so anonymous/unlinked treatment is inappropriate. |
| Usage Data — Product Interaction | App Functionality | Yes | No | Account-linked completion, shortlist, interaction and sharing state represented by the current manifest. Confirm the exact App Store wording against the final data flows. |
| Location — Precise Location | App Functionality and Analytics | Yes | No | Near me sends coordinates to BigDataCloud only after the user selects it; the provider also receives normal network information and uses service observations to improve IP geolocation. Coordinates are not saved in the Wayfinder account. The current manifest uses the conservative linked declaration. |
| User Content — Photos or Videos | App Functionality | Yes | No | New native photos remain in app-private, backup-excluded device storage and are not uploaded. This alone would not justify an off-device collection label. The current service still stores and displays legacy cloud photos associated with accounts, so Photos or Videos remains declared. |
| User Content — Other User Content | App Functionality | Yes | No | Notes, trips, Community recommendations and associated reports/feedback are hosted and account-linked where those features operate. |

Do not select Device ID merely because RevenueCat is present. RevenueCat says Device ID is needed when an advertising identifier such as IDFA is used; no IDFA/advertising integration or `NSUserTrackingUsageDescription` was found in the reviewed source. Do not select tracking: the current manifest sets tracking false and has no tracking domains, and RevenueCat says it does not inherently track users across apps for advertising. Reassess both points after inspecting the final Xcode privacy report and every transitive SDK privacy manifest.

The current public URLs suitable for App Store Connect are:

- Privacy policy: `https://rlapplications.com/wayfinder/privacy/`
- Privacy choices / deletion: `https://rlapplications.com/wayfinder/delete-account/`
- Support: `https://rlapplications.com/wayfinder/support/`

Before publishing the label, archive the exact App Store Connect answers and compare them with the signed build's aggregated privacy report. A privacy manifest in the bundle does not replace the App Store Connect questionnaire.

## Age-rating questionnaire

Apple generates the rating from the current questionnaire. Its definitions now separately include User-Generated Content, Social Media, and “Social Media Disabled for Users Under 13.” The last item requires at least the Declared Age Range API before enabling social features; a policy sentence saying the app is not directed to children does not satisfy that control. See [Age ratings values and definitions](https://developer.apple.com/help/app-store-connect/reference/age-ratings-values-and-definitions/) and [Set an app age rating](https://developer.apple.com/help/app-store-connect/manage-app-information/set-an-app-age-rating/).

Recommended answers for the present feature set:

| Questionnaire item | Draft answer | Evidence / gate |
| --- | --- | --- |
| Parental Controls | No | No parent/guardian control was found. |
| Age Assurance | No | No declared-age API, age estimation, identity check or equivalent was found. |
| Unrestricted Web Access | No, after final build check | Wayfinder is not a general web browser. Confirm every in-app link remains a fixed destination and no arbitrary URL navigation is exposed. |
| User-Generated Content | Yes | Community distributes user-written recommendations to other users. |
| Social Media | **Yes is the conservative current answer** | The Community discovery feed lets users vote and rate broadly distributed recommendations. Apple's definition includes interaction or amplification through a social feed, with likes as an example. If the final submitted binary removes or completely disables this capability, reassess from that binary; otherwise do not answer No without written Apple guidance. |
| Social Media Disabled for Users Under 13 | No | The required age-range check/disable control is not implemented. Do not convert “not directed under 13” into a technical claim. |
| Messaging and Chat | No | No direct or group person-to-person messaging was found. Public recommendation posting is already covered by UGC/Social Media. |
| Advertising | No | No advertising feature or advertising SDK was found. |
| Alcohol, Tobacco, or Drug Use or References | At least **Infrequent**; not None | A reproducible word-boundary screen found 149 alcohol-reference entries among the 5,341 active entries; the catalogue contains 5,358 stored entries in total, including 17 marked unavailable. The 149 matches were all active and included explicit wine, beer, brewery, distillery, spirits, cider, cocktail, pub/bar or related terms. Examples include wine-region tastings, breweries and rum distilleries. This screen is evidence of presence, not a substitute for Apple's frequency judgement. Select Frequent if the final merchandising or normal navigation makes these references a regular part of the experience. |
| Remaining mature, medical, sexual, violence, weapons and chance-based descriptors | Owner/editorial review required | Do not bulk-answer None from the app's travel category. Review the final catalogue, live Community content and screenshots against Apple's exact definitions. Wayfinder has no gambling, loot-box or contest mechanic in the reviewed code, but tourism entries may mention casinos, conflict sites, wellness activities, weapons or mature history and must be classified by displayed content. |

With the conservative Social Media answer, Apple's current table indicates a 13+ global rating and a 16+ Australia-specific rating on the newer rating system; Alcohol references can also raise the generated rating. This is an expectation from the published table, not a manually selected rating. Record the rating App Store Connect actually generates, including the result shown for older supported OS versions.

Apple's UGC review guideline requires filtering objectionable material, reporting, blocking, published contact information and timely responses. The code has report/block controls and the public support mailbox, but the human moderation owner, schedule, live backend protections and actual response process remain submission gates. See [App Review Guidelines 1.2](https://developer.apple.com/app-store/review/guidelines/#user-generated-content).

## Export compliance and content rights

`Info.plist` currently declares `ITSAppUsesNonExemptEncryption = false`. The reviewed app uses HTTPS and platform/SDK transport rather than a custom cryptographic product. Keep that value only if the final dependency and archive review confirms no proprietary or non-standard encryption, VPN, secure-communications feature or other non-exempt use. Apple makes the developer responsible for the export determination and may require documentation depending on the questionnaire. See [Overview of export compliance](https://developer.apple.com/help/app-store-connect/manage-app-information/overview-of-export-compliance/).

For App Store Connect's content-rights question, the present build contains a large curated catalogue with venue/operator/place names and also exposes Community content. Treat **contains, shows or accesses third-party content** as the safer draft answer. Do not attest that all necessary rights are held until the owner has reviewed the editorial-source archive, licences, map notices, trademarks, user-content terms and the final screenshots. Public facts and links to a source do not by themselves grant a licence to copy protected expression or imagery. See [Provide content rights information](https://developer.apple.com/help/app-store-connect/manage-app-information/provide-content-rights-information/) and App Review Guidelines 5.2.

## App Review package

The current source is not by itself evidence of review readiness. Before submission:

1. Supply an active, verified demo account to App Review through the private review fields. Use fictional review data, keep the backend available for the full review, and do not put credentials in Git. Apple requires full access for account-based apps and says a demo mode in place of an account needs prior approval.
2. Add the owner's private App Review contact phone and confirm the monitored email. The phone is currently unknown in the prepared listing.
3. Remove testing/placeholder behavior from the submitted experience or explain any intentionally unavailable feature. Apple says beta builds belong in TestFlight and rejects incomplete functionality, placeholder content and inaccessible backends.
4. Explain non-obvious review paths: email verification/recovery; Near me permission; adding and deleting a device-local photo; viewing a legacy cloud photo if the demo account has one; account deletion; Community report/block; every enabled purchase and Restore purchases.
5. Make all eight intended non-consumable IAPs complete, visible and functional in Apple's sandbox/Review environment, submit them with the first app version, and attach their App Review screenshots. Explain that packs unlock digital guide content and do not buy travel or admission.
6. Keep privacy, support and deletion URLs publicly reachable throughout review. Complete the live deletion, Community moderation, group-privacy and purchase/restore checks before describing them as production behavior.
7. Ensure screenshots and review accounts contain fictional data and owned/licensed imagery. Apple places responsibility for screenshot and preview rights on the developer.

These requirements follow [App Review Guidelines 1.2, 2.1, 2.3 and 3.1.1](https://developer.apple.com/app-store/review/guidelines/) and Apple's [App Review information guidance](https://developer.apple.com/help/app-store-connect/manage-submissions-to-app-review/provide-app-review-information/).

## Icon validation and supplied asset

The Xcode asset catalog declares `AppIcon-512@2x.png` as the universal iOS 1024 × 1024 icon. Direct PNG inspection found:

- dimensions: 1024 × 1024;
- colour mode: RGB;
- alpha/transparency: none;
- byte length: 73,017;
- SHA-256: `D067A6F01B6BFF93D62F063E89C8C29E2FE6AC82E325235BADE89CA84E4BFF43`.

`store-release/assets/Wayfinder-App-Store-Icon-1024.png` is a byte-for-byte copy; its SHA-256 is identical. Xcode/App Store upload validation remains the final authority. Apple takes the app icon from the asset catalog in the uploaded build; changing it after publication requires a new version. See [Add an app icon](https://developer.apple.com/help/app-store-connect/manage-app-information/add-an-app-icon/).

## Genuine screenshots still required

No genuine native App Store screenshot or preview set exists in the reviewed repository. Launch screens, icons, browser captures and QA screenshots are not substitutes for current native product-page assets.

The target supports both iPhone and iPad, so prepare both sets from the final release candidate with fictional data:

- **iPhone:** 1–10 screenshots. Supply a 6.9-inch accepted portrait size (`1260 × 2736`, `1290 × 2796`, or `1320 × 2868`) or the landscape transpose. If no 6.9-inch set is supplied, Apple requires an accepted 6.5-inch set (`1284 × 2778` or `1242 × 2688`, or landscape transpose) and scales it.
- **iPad:** 1–10 screenshots at an accepted 13-inch size: `2064 × 2752` or `2048 × 2732` portrait, or landscape transpose. This set is required because `TARGETED_DEVICE_FAMILY` includes iPad.
- **Format:** JPEG, JPG or PNG with no alpha/transparency. Use actual current UI, and show purchase requirements wherever paid hidden-gem content is featured.
- **App previews:** optional. None has been prepared; do not add a fabricated video.
- **IAP review media:** prepare a genuine review screenshot for each of the eight non-consumables showing where that product appears in the final app. These are separate from the public product-page screenshot inventory.

A useful truthful product-page set would show the world/continent browser, country/adventure navigation, an adventure detail, shortlist/trip planning, progress/memory with a fictional device-local photo, and the hidden-gem purchase screen. Add Community only if its live moderation and backend are ready in the submitted build. Capture both iPhone and iPad layouts; do not stretch or frame a browser screenshot as native device evidence.

Apple's current specifications and upload rules are at [Screenshot specifications](https://developer.apple.com/help/app-store-connect/reference/screenshot-specifications/) and [Upload app previews and screenshots](https://developer.apple.com/help/app-store-connect/manage-app-information/upload-app-previews-and-screenshots/).

## Owner decisions and unresolved gates

- Final comparison of the resolved User ID purposes with the signed archive's aggregated privacy report and the actual App Store Connect preview.
- Final age-questionnaire frequencies for every descriptor, plus acceptance of the likely Social Media answer and resulting regional rating.
- Confirmed human Community moderator, review schedule, escalation/appeal process and live enforcement evidence.
- Content-rights attestation and archive of supporting licences/source review.
- Export-compliance determination against the final archive.
- App Review phone, private demo credentials, storefront availability and release timing.
- Genuine iPhone/iPad screenshot sets, eight IAP review screenshots, final on-device tests and accessible live backends.

Do not submit the privacy, age, content-rights or export answers merely because this draft exists. The owner must approve the actual console answers after these gates are closed.
