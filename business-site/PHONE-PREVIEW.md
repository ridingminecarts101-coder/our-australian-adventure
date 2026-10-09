# Wayfinder 1.1.1 phone acceptance preview

This **temporary branch-only Cloudflare Pages preview** copies the exact PR #10
`41bda5aee81ef1f0410d1b22feaec3b515069f8b` PWA runtime into
`/review-app/`. No runtime files in the release PR, `main`, or the production
website are changed. The preview has its own install ID, service-worker scope,
browser storage and noindex policy. It uses Wayfinder's existing production
Supabase project and real account data; use dedicated test accounts and avoid
adding personal photos to the preview.

The branch copy changes only its install name/scope, cache name, noindex
metadata, and share/invite base so two-phone test links stay on the preview
host. All other runtime bytes match PR #10. `node business-site/check_phone_preview.mjs`
checks that allowlist, path references, security-header override, and local
HTTP loading. The root studio website retains its restrictive CSP and
Permissions-Policy. The preview never publishes to `rlapplications.com`.

This browser preview can test group joins, member visibility, consent, departure
history, account deletion, trips, notes, ratings, and photo-strip layout. It
cannot validate the signed iOS native build, Apple in-app purchases, native
PhotoKit camera-roll export, or that photos saved in the App Store app appear
under this separate preview origin. Email verification and password recovery
may return to the currently allowlisted public PWA; use existing test accounts.
The signed 1.1.1 build and two-iPhone TestFlight acceptance remain release gates.
