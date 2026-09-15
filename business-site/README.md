# RL Applications business site

Static public website for `https://rlapplications.com`, including studio-wide support and privacy pages plus Wayfinder product, support, privacy and account-deletion pages.

## Cloudflare Pages settings

- Production branch: `main`
- Root directory: `business-site`
- Framework preset: `None`
- Build command: `exit 0`
- Build output directory: `public`
- Environment variables: none

Connect `rlapplications.com` and `www.rlapplications.com` as custom domains in the Cloudflare Pages project after the first successful deployment. The site uses root-relative links and assumes it is served from the domain root.

## Local preview

From `business-site/public`, run any static HTTP server. For example:

```powershell
python -m http.server 8080
```

Then open `http://localhost:8080/`. Do not preview by opening the HTML files directly because root-relative links require a web server.

There is no build step, client-side JavaScript, analytics, form handler or environment-specific configuration.

## Wayfinder launch links

The Wayfinder overview displays a noninteractive App Store download notice
until a verified App Store listing is live. Its support FAQ explains the same
availability, and the website does not link to the existing PWA review build.
Google Play is planned but also has no live listing or download link. The
existing PWA hosting and its origin-bound user data are unchanged by this
website update. The third-party permission texts linked from support are hosted
at `/wayfinder/notices/` rather than through the review build; keep this copy
aligned with the bundled app notices when dependencies change.

At launch, replace the inactive notice with a real link to the verified App
Store listing, update the FAQ and product status together, and add a Google Play
link only after its own listing is live. Do not insert placeholder store URLs or
claim a download is available before either listing is public.

The hero's decorative pseudo-element must keep `pointer-events: none` so it
cannot cover a future mobile launch button. When changing the shared CSS,
update its version query in all HTML pages: assets are cached for one week.

## Checks

Run the authored-site checks from the repository root:

```powershell
python business-site/check_site.py
```

Add `--live` to compare every public route and asset with the authored source across the apex, `www` and Cloudflare Pages hosts, including redirects, the custom 404 response and required security headers. Add `--external` to request the external HTTPS links referenced by the pages.

The `Cache-Control: no-transform` header prevents Cloudflare from rewriting future public email links into markup that requires an injected decoder script, which this site's `script-src 'none'` policy intentionally excludes. Keep the header when changing cache settings. Domain-wide Cloudflare security settings do not need to be disabled.

The `_headers` file commits only `https://rlapplications.com` to HSTS for one
year. It deliberately omits `includeSubDomains` and `preload`; do not add either
until every current and future subdomain is HTTPS-only and separately reviewed.
Every indexable page declares its preferred apex URL so the `www` and Pages
aliases do not compete with the canonical site in search results.

The former personal support address has been removed. The owner supplied
`help.rlapplications@gmail.com` as the working, monitored public mailbox for
studio support and Wayfinder support, privacy and deletion requests. This
implementation pass did not independently send or receive a message. The site
checker requires the exact published address and reviewed subject lines and
rejects other Gmail addresses in the public runtime. If the mailbox changes,
update the intended contact actions and checker together, then repeat the
local, live and email-link checks.
