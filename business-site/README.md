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

The `Cache-Control: no-transform` header preserves the public support mailto links on the custom domain. Cloudflare's automatic email obfuscation otherwise requires an injected decoder script that this site's `script-src 'none'` policy intentionally excludes. Keep the header when changing cache settings. Domain-wide Cloudflare security settings do not need to be disabled.

The current public contact is `rambodog555@gmail.com`. Do not replace it with `help@rlapplications.com` until that mailbox is confirmed working. When it is ready, find every authored occurrence with `rg -n "rambodog555@gmail.com" business-site/public`, replace both visible addresses and `mailto:` targets, then repeat the local link and deployed email-link checks.
