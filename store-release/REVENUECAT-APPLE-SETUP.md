# Wayfinder: RevenueCat and Apple setup

Prepared 15 September 2026 from the actual Capacitor integration. This is a setup package, not evidence of live store configuration. No credential belongs in this file or Git history.

## Account and project

1. The owner is signed in to the email-verified RevenueCat account. Use the existing **Wayfinder** project `1bce63b8`; do not create a duplicate project or account.
2. All eight exact entitlement IDs below exist, and project restore behaviour is saved as **Keep with original App User ID**. This matches required Wayfinder accounts and individual purchase ownership. Recover the original Wayfinder account when a receipt belongs to another account. The same Apple receipt may prevent a second Wayfinder account from buying/restoring; do not silently transfer ownership or encourage a duplicate purchase. Exercise this case with sandbox accounts before release.
3. The project currently contains only RevenueCat's Test Store. Its example products and key are not Apple configuration and must not be shipped.
4. Adding the **App Store** app for bundle ID **`app.wayfinder.mobile`** was attempted but rejected because no Apple In-App Purchase `.p8`, Key ID or Issuer ID was available. No Apple products or Apple public SDK key have been created. Resume this step only after obtaining those exact Apple credentials.

The client uses the signed-in Supabase UUID as its RevenueCat App User ID. It must not use a group ID, display name, email address or a fresh anonymous ID for purchases. Leaving a group does not revoke an individual's own entitlement.

## Apple prerequisites

- The owner has placed the Apple Developer individual/sole-trader membership order and is waiting for processing and activation. App Store Connect access is not available yet. The owner accepts Apple's individual-account developer/seller identity for the initial release. Keep RL Applications as studio branding and copy the exact seller string from Apple once visible. A possible later organisation conversion is optional and pending Apple's response.
- Create the explicit App ID for **`app.wayfinder.mobile`**, then the iOS app record in App Store Connect. Check its availability under the selected team first; do not change the existing ID without a coordinated code/product migration.
- Account Holder completes Apple's Paid Apps Agreement and banking/tax information. The app download is free; the eight guide unlocks are paid non-consumables.
- Create all eight Apple products in the table below, complete localization/pricing/availability, and supply a real in-app-purchase review screenshot. For the first submission, include the in-app purchases with the app version as Apple requires.
- **Family Sharing stays off** because these purchases are individual. Do not enable it as an experiment; Apple warns it cannot be disabled after enabling a product.

## Exact products and entitlements

All products are **Non-Consumable**, purchased once. Prices below are the requested Australian storefront/base prices; other storefront prices are controlled by Apple. Confirm the available AUD price point in the console.

| Apple product ID | RevenueCat entitlement | Display name (en-AU) | AUD | Apple description (45 characters maximum) |
| --- | --- | --- | ---: | --- |
| `app.wayfinder.mobile.gems.all` | `all` | All continents | 14.99 | All hidden gems and Antarctica collection |
| `app.wayfinder.mobile.gems.oceania` | `oceania` | Oceania gems | 2.99 | Unlock Oceania's hidden-gem guide collection |
| `app.wayfinder.mobile.gems.europe` | `europe` | Europe gems | 2.99 | Unlock Europe's hidden-gem guide collection |
| `app.wayfinder.mobile.gems.north_america` | `north-america` | North America gems | 2.99 | Unlock North America's hidden-gem collection |
| `app.wayfinder.mobile.gems.asia` | `asia` | Asia gems | 2.99 | Unlock Asia's hidden-gem guide collection |
| `app.wayfinder.mobile.gems.middle_east` | `middle-east` | Middle East gems | 2.99 | Unlock Middle East's hidden-gem collection |
| `app.wayfinder.mobile.gems.south_america` | `south-america` | South America gems | 2.99 | Unlock South America's hidden-gem collection |
| `app.wayfinder.mobile.gems.africa` | `africa` | Africa gems | 2.99 | Unlock Africa's hidden-gem guide collection |

These localized display names match `tools/ios-products.json`. For Apple's separate internal Reference Name, use `Wayfinder - ` followed by the display name. Reference names are internal labels, not product identifiers.

There is no Antarctica standalone product. Attach each product to its matching entitlement. The client recognises `all` as universal access, so attaching that product to every regional entitlement is unnecessary. Do not substitute underscore entitlement IDs for the three hyphenated IDs above.

The current client fetches Apple products directly using `getProducts` and purchases by product, so **an Offering is not a runtime requirement**. If using one to organise the dashboard, create a Current offering `default`, package `$rc_lifetime` for `all`, and custom packages `oceania`, `europe`, `north-america`, `asia`, `middle-east`, `south-america`, `africa` for their products. These are proposed dashboard package identifiers, not replacements for the existing product IDs. Do not add a subscription or paywall template that changes the pricing model.

## Credentials: distinct purposes

| Item | Where it goes | Why |
| --- | --- | --- |
| RevenueCat **App Store public SDK key** (`appl_…`) | Protected workflow variable `REVENUECAT_IOS_PUBLIC_SDK_KEY`, injected into native `config.js` → `revenueCat.ios` | Client connection; intentionally public and platform-specific; the canonical source can retain its blank slot |
| Apple **In-App Purchase key** `.p8`, Key ID and Issuer ID | RevenueCat's Wayfinder iOS store configuration | Required transaction verification for the shipped Capacitor/StoreKit 2 SDK |
| Apple **App Store Connect API key** | Optional RevenueCat app configuration | Product/price imports; distinct from the required IAP key. Manual product entry avoids this optional key |
| Apple Team ID, distribution signing identity and provisioning | Private signing workflow configuration | Build and sign the iPhone archive |
| Apple upload API authentication | Private upload workflow configuration | Submit the signed binary to App Store Connect |
| RevenueCat secret server API key | Protected server-only environment, if needed | Server-side customer cleanup; never put it in the app |

Generate the IAP key under **App Store Connect → Users and Access → Integrations → In-App Purchase**. Upload the private file directly to the intended RevenueCat configuration; retain it securely because Apple permits a single download. Supply its Key ID and Issuer ID, save, and require a **Valid credentials** result. If the Issuer ID is not shown, RevenueCat documents creating an App Store Connect API key to expose it; this is not a reason to grant broader access without reviewing the key's purpose.

If optional product import is chosen, follow RevenueCat's current App Store Connect API-key guide and use the least role it requires (normally App Manager), with the required Vendor Number. Do not reuse an IAP key in the API-import field or assume a public SDK key can replace either private Apple key.

Configure Apple's production and sandbox **App Store Server Notifications V2** using the exact notification URL supplied by RevenueCat for this app. Do not invent the URL. Validate both delivery paths. Leave optional tracking of previously unseen purchases from server notifications off until the app-account-token/UUID and restore-policy tests demonstrate correct ownership. Do not enable customer-facing live purchases merely because product IDs have been entered.

## Final validation before upload/review

- Public key is the App Store `appl_` key and the eight store product IDs resolve with Apple-provided localized prices.
- Purchase, user cancellation, interrupted/pending purchase, offline failure and app resume behave correctly.
- Each regional purchase unlocks its own pack; All continents covers all seven and Antarctica.
- Same Wayfinder account restores on the second iPhone; a different Wayfinder account does not inherit the first account's receipt.
- Refund/revocation removes access after provider refresh; cached historical purchase IDs alone never unlock packs.
- Restore remains visible and a receipt/account mismatch gives useful original-account recovery guidance.
- Account deletion handles or explicitly schedules RevenueCat customer erasure through a real operator/server route, with appropriate transaction retention disclosed.
- Record Apple sandbox receipts and RevenueCat events privately, not in public repository artifacts. No real-money purchase is required for these tests.

## Official references

- [RevenueCat project setup](https://www.revenuecat.com/docs/projects/overview)
- [Connecting a store](https://www.revenuecat.com/docs/projects/connect-a-store)
- [Non-subscription purchases](https://www.revenuecat.com/docs/platform-resources/non-subscriptions)
- [Required IAP key](https://www.revenuecat.com/docs/service-credentials/itunesconnect-app-specific-shared-secret/in-app-purchase-key-configuration)
- [Optional App Store Connect import key](https://www.revenuecat.com/docs/service-credentials/itunesconnect-app-specific-shared-secret/app-store-connect-api-key-configuration)
- [Restore ownership behaviour](https://www.revenuecat.com/docs/projects/restore-behavior)
- [Apple IAP fields](https://developer.apple.com/help/app-store-connect/reference/in-app-purchases-and-subscriptions/in-app-purchase-information)
- [Apple Family Sharing](https://developer.apple.com/help/app-store-connect/configure-in-app-purchase-settings/turn-on-family-sharing-for-in-app-purchases/)
