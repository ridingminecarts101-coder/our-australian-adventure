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

The overview's **Open Wayfinder** button and the installation FAQ both link
directly to the existing GitHub Pages PWA. Keep both destinations aligned.
The iOS/iPadOS and Android installation guides are deep-linked from the product
page; their FAQ is expanded by default so those anchors remain visible without
JavaScript. Native App Store and Google Play listings are not yet published.
Once the actual listings are live, replace the PWA launch destinations with
the verified store route appropriate to the visitor, preserving access to the
PWA and accounting for its origin-bound photos. Do not insert placeholder
store URLs or claim automatic store routing exists before implementation.

The hero's decorative pseudo-element must keep `pointer-events: none` so it
cannot cover the mobile launch button. When changing the shared CSS, update
its version query in all HTML pages: assets are cached for one week.

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

The former personal support address has been removed. The public site must show
`TO BE ASSIGNED` and contain no `mailto:` link until the new Gmail support
mailbox has been created, tested for sending, receiving and recovery, and
approved for publication. When it is ready, replace the visible placeholder
and add the verified address only to the intended contact actions, then update
the checker and repeat the local, live and email-link checks.
