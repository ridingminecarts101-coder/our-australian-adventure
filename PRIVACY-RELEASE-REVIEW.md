# Privacy and account-deletion release review

Prepared 11 September 2026. Local release draft only; neither public page nor store declaration has been published by this work.

`privacy.html` and `support.html` now describe required accounts, optional completion sharing, individual purchases, the actual location provider, and an external deletion-request route. The owner confirmed that `rambodog555@gmail.com` remains the public support address temporarily. Do not represent RL Studios as a registered business name until that is verified.

## Evidence and open release checks

| Area | Evidence and required completion |
| --- | --- |
| Identity | Supabase email/password sign-up, verification and recovery are in the client. Production SMTP, redirect allowlist and actual delivered-email flows still need testing. |
| Group privacy | The new migration keeps source progress owner-only and exposes completion facts through a group feed. It remains local. Deploy and verify it with the aligned client before publishing the new privacy claims. The old production group authorization rules were found unsafe. |
| Photos and trips | New entries are personal. Legacy explicit group projections are retained. Confirm real Storage rules, leaving/revocation behavior and signed-link expiry using disposable users. A completion-sharing toggle does not withdraw legacy photo/trip sharing. |
| Deletion | Local PostgreSQL tests verify auth/data cascades; they do not emulate Supabase Storage or RevenueCat. All owned files, including files outside the currently loaded view and orphan uploads, must be removed through the Storage API with checked results before deleting the auth user. Do not delete Storage metadata directly in SQL. |
| Provider deletion | Establish an authenticated server-side RevenueCat deletion job or a monitored operator process. The browser/native app must never contain a RevenueCat secret key. Preserve the account identifier for reliable cleanup, retry failures and confirm completion. Deleting the local auth row or logging out of the SDK does not erase RevenueCat's customer record. This remains a paid-release blocker. |
| External requests | `support.html#delete-account` is the proposed Play deletion URL. Verify that the mailbox is monitored and identity verification works without requesting passwords. Agree a response/fulfilment time and record completion of provider cleanup. Do not claim immediate deletion everywhere. |
| Retention | Confirm Supabase hosting region, backup/log retention, the selected SMTP provider and provider deletion handling before finalising public retention information and store forms. No exact retention duration has been established. |
| Location | `jumpToHere()` sends consented coordinates directly to BigDataCloud. Its free API associates requesting IP addresses and coordinates to improve geolocation. The app manifest now conservatively declares linked Precise Location for App Functionality and Analytics, with tracking false; confirm those answers against the provider's final retention terms and the archived app's Xcode privacy report. The iOS permission prompt now states that coordinates are sent to BigDataCloud. |
| Purchases | Native RevenueCat configuration uses the Wayfinder account ID. The app manifest now declares linked Purchase History for App Functionality and Analytics, with tracking false, matching RevenueCat's current Apple guidance. Complete sandbox purchase/restore/refund/account-switch tests and inspect the final archive's aggregated privacy report for the transitive RevenueCat SDK manifest before publishing App Store privacy answers. The PWA has no verified paid-entitlement backend; do not promise paid access on the web yet. |
| Community | `schema-community-hardening.sql` now prevents author changes to moderation state/counters; 23 PostgreSQL checks pass locally. It is not deployed. `COMMUNITY-MODERATION.md` provides the operator process that still needs an assigned reviewer and operating schedule. Reporting controls alone are not a verified moderation service. |
| Offline copies | Deletion/sign-out tests must include pending changes and another offline device. An old cached copy or a previously downloaded photo is not remotely erased just by deleting an auth row. |

## Primary references checked

- Google requires in-app deletion and a discoverable web request route. An email route can satisfy the web-resource format, but the actual request process must work. [Google Play account deletion](https://support.google.com/googleplay/android-developer/answer/13327111?hl=en).
- Supabase explains that owned Storage objects block auth-user deletion, and an already-issued JWT can remain valid until expiry. [Supabase user management](https://supabase.com/docs/guides/auth/managing-user-data).
- RevenueCat exposes customer deletion through its dashboard and a server API. API deletion is asynchronous; logging out is a different action. [Customer profile deletion](https://www.revenuecat.com/docs/dashboard-and-metrics/customer-profile#delete-customer), [Customer API](https://www.revenuecat.com/docs/api-v1/customers).
- RevenueCat requires purchase and identifier disclosures appropriate to the configured SDK. Review the final archive and complete app behavior when filling the forms. [RevenueCat Apple privacy guidance](https://www.revenuecat.com/docs/platform-resources/apple-platform-resources/apple-app-privacy), [Apple privacy details](https://developer.apple.com/app-store/app-privacy-details/).
- The location provider documents the additional use of client-side requests. [BigDataCloud free geocoding explanation](https://www.bigdatacloud.com/docs/article/why-is-reverse-geocoding-api-free).

This file records implementation evidence and unfinished checks. It is not a claim of store acceptance or a completed legal review.
