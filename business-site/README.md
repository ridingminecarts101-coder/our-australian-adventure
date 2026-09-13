# RL Applications business site

Static public website for `https://rlapplications.com`, including Wayfinder product, support, privacy and account-deletion pages.

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
