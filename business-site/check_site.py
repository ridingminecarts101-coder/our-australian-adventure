#!/usr/bin/env python3
"""Validate the authored RL Applications site and, optionally, its live hosts."""

from __future__ import annotations

import argparse
import re
import sys
import urllib.error
import urllib.request
import xml.etree.ElementTree as ET
from dataclasses import dataclass
from html.parser import HTMLParser
from pathlib import Path
from urllib.parse import unquote, urljoin, urlparse


ROOT = Path(__file__).resolve().parent / "public"
APP_ROOT = ROOT.parent.parent
CONTACT = "rambodog555@gmail.com"
ABN = "RL Applications · ABN 92 363 169 656"
USER_AGENT = "Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 Chrome/140 Safari/537.36"

ROUTES = {
    "/": "index.html",
    "/support/": "support/index.html",
    "/privacy/": "privacy/index.html",
    "/wayfinder/": "wayfinder/index.html",
    "/wayfinder/support/": "wayfinder/support/index.html",
    "/wayfinder/privacy/": "wayfinder/privacy/index.html",
    "/wayfinder/delete-account/": "wayfinder/delete-account/index.html",
}
ASSETS = {
    "/assets/site.css": "assets/site.css",
    "/assets/brand-mark.svg": "assets/brand-mark.svg",
    "/assets/wayfinder-mark.svg": "assets/wayfinder-mark.svg",
    "/robots.txt": "robots.txt",
    "/sitemap.xml": "sitemap.xml",
}
REDIRECTS = {
    "/privacy.html": "/privacy/",
    "/support.html": "/support/",
    "/delete-account.html": "/wayfinder/delete-account/",
    "/wayfinder/privacy.html": "/wayfinder/privacy/",
    "/wayfinder/support.html": "/wayfinder/support/",
    "/wayfinder/delete-account.html": "/wayfinder/delete-account/",
}
LIVE_HOSTS = (
    "https://rlapplications.com",
    "https://www.rlapplications.com",
    "https://our-australian-adventure.pages.dev",
)
REQUIRED_HEADERS = {
    "content-security-policy": ("default-src 'self'", "script-src 'none'", "frame-ancestors 'none'"),
    "permissions-policy": ("camera=()", "geolocation=()", "microphone=()", "payment=()"),
    "referrer-policy": ("strict-origin-when-cross-origin",),
    "x-content-type-options": ("nosniff",),
    "x-frame-options": ("DENY",),
    "cross-origin-opener-policy": ("same-origin",),
    "cross-origin-resource-policy": ("same-origin",),
}


@dataclass
class Document:
    tags: list[str]
    ids: list[str]
    links: list[str]
    images: list[dict[str, str | None]]
    h1_count: int
    lang: str | None
    title: str
    viewport: bool
    canonicals: list[str]
    csp: str | None
    inline_scripts: int
    event_handlers: list[str]


class DocumentParser(HTMLParser):
    def __init__(self) -> None:
        super().__init__(convert_charrefs=True)
        self.tags: list[str] = []
        self.ids: list[str] = []
        self.links: list[str] = []
        self.images: list[dict[str, str | None]] = []
        self.h1_count = 0
        self.lang: str | None = None
        self.title_parts: list[str] = []
        self.in_title = False
        self.viewport = False
        self.canonicals: list[str] = []
        self.csp: str | None = None
        self.inline_scripts = 0
        self.event_handlers: list[str] = []

    def handle_starttag(self, tag: str, attrs: list[tuple[str, str | None]]) -> None:
        values = dict(attrs)
        self.tags.append(tag)
        if tag == "html":
            self.lang = values.get("lang")
        if values.get("id"):
            self.ids.append(values["id"] or "")
        rels = set((values.get("rel") or "").lower().split())
        if tag == "link" and "canonical" in rels and values.get("href"):
            self.canonicals.append(values["href"] or "")
        elif tag in {"a", "link"} and values.get("href"):
            self.links.append(values["href"] or "")
        if tag in {"img", "script"} and values.get("src"):
            self.links.append(values["src"] or "")
        if tag == "img":
            self.images.append(values)
        if tag == "h1":
            self.h1_count += 1
        if tag == "title":
            self.in_title = True
        if tag == "script" and not values.get("src"):
            self.inline_scripts += 1
        if tag == "meta" and values.get("name", "").lower() == "viewport":
            self.viewport = "width=device-width" in (values.get("content") or "").lower()
        if tag == "meta" and values.get("http-equiv", "").lower() == "content-security-policy":
            self.csp = values.get("content")
        self.event_handlers.extend(name for name, _ in attrs if name.lower().startswith("on"))

    def handle_endtag(self, tag: str) -> None:
        if tag == "title":
            self.in_title = False

    def handle_data(self, data: str) -> None:
        if self.in_title:
            self.title_parts.append(data)

    def document(self) -> Document:
        return Document(
            tags=self.tags,
            ids=self.ids,
            links=self.links,
            images=self.images,
            h1_count=self.h1_count,
            lang=self.lang,
            title="".join(self.title_parts).strip(),
            viewport=self.viewport,
            canonicals=self.canonicals,
            csp=self.csp,
            inline_scripts=self.inline_scripts,
            event_handlers=self.event_handlers,
        )


class NoRedirect(urllib.request.HTTPRedirectHandler):
    def redirect_request(self, req, fp, code, msg, headers, newurl):  # type: ignore[no-untyped-def]
        return None


def parse_document(text: str) -> Document:
    parser = DocumentParser()
    parser.feed(text)
    return parser.document()


def target_for(path: str) -> Path:
    parsed = urlparse(path)
    decoded = unquote(parsed.path)
    target = ROOT / decoded.lstrip("/")
    return target / "index.html" if decoded.endswith("/") else target


def normalise(data: bytes) -> bytes:
    return data.replace(b"\r\n", b"\n")


def local_checks() -> tuple[list[str], set[str]]:
    errors: list[str] = []
    external: set[str] = set()
    html_files = sorted(ROOT.rglob("*.html"))
    if len(html_files) != 8:
        errors.append(f"expected 8 HTML pages, found {len(html_files)}")

    for path in html_files:
        rel = path.relative_to(ROOT).as_posix()
        text = path.read_text(encoding="utf-8")
        doc = parse_document(text)
        if doc.lang != "en-AU":
            errors.append(f"{rel}: expected lang=en-AU")
        if not doc.title:
            errors.append(f"{rel}: missing title")
        if not doc.viewport:
            errors.append(f"{rel}: missing responsive viewport")
        if doc.h1_count != 1:
            errors.append(f"{rel}: expected one h1, found {doc.h1_count}")
        for landmark in ("nav", "main", "footer"):
            if landmark not in doc.tags:
                errors.append(f"{rel}: missing {landmark} landmark")
        for forbidden in ("script", "form", "iframe"):
            if forbidden in doc.tags:
                errors.append(f"{rel}: forbidden <{forbidden}> present")
        if len(doc.ids) != len(set(doc.ids)):
            errors.append(f"{rel}: duplicate id present")
        if ABN not in text:
            errors.append(f"{rel}: ABN footer missing")
        if "help@rlapplications.com" in text:
            errors.append(f"{rel}: uncreated support address published")
        if "/cdn-cgi/l/email-protection" in text or "data-cfemail" in text:
            errors.append(f"{rel}: Cloudflare email rewriting markup present")
        for image in doc.images:
            if "alt" not in image:
                errors.append(f"{rel}: image lacks alt attribute")
        for link in doc.links:
            parsed = urlparse(link)
            if parsed.scheme in {"http", "https"}:
                external.add(link)
            elif parsed.scheme == "mailto":
                if parsed.path != CONTACT:
                    errors.append(f"{rel}: unexpected mail recipient {parsed.path}")
            elif parsed.scheme or link.startswith("//"):
                errors.append(f"{rel}: unsupported link scheme {link}")
            elif link.startswith("/"):
                target = target_for(link)
                if not target.is_file():
                    errors.append(f"{rel}: unresolved local reference {link}")
                if parsed.fragment and target.suffix == ".html":
                    linked = parse_document(target.read_text(encoding="utf-8"))
                    if parsed.fragment not in linked.ids:
                        errors.append(f"{rel}: unresolved fragment {link}")

        expected_route = next((route for route, filename in ROUTES.items() if filename == rel), None)
        expected_canonical = f"https://rlapplications.com{expected_route}" if expected_route else None
        if expected_canonical and doc.canonicals != [expected_canonical]:
            errors.append(f"{rel}: canonical URL is {doc.canonicals!r}, expected {[expected_canonical]!r}")
        if not expected_canonical and doc.canonicals:
            errors.append(f"{rel}: non-content page must not declare a canonical URL")

    try:
        for svg in ROOT.glob("assets/*.svg"):
            ET.parse(svg)
        sitemap = ET.parse(ROOT / "sitemap.xml")
        ns = {"sm": "http://www.sitemaps.org/schemas/sitemap/0.9"}
        sitemap_urls = {node.text for node in sitemap.findall("sm:url/sm:loc", ns)}
        expected_urls = {f"https://rlapplications.com{route}" for route in ROUTES}
        if sitemap_urls != expected_urls:
            errors.append("sitemap routes differ from public content routes")
    except ET.ParseError as exc:
        errors.append(f"XML parse error: {exc}")

    redirects: dict[str, str] = {}
    for line in (ROOT / "_redirects").read_text(encoding="utf-8").splitlines():
        fields = line.split()
        if fields:
            if len(fields) != 3 or fields[2] != "301":
                errors.append(f"invalid redirect rule: {line}")
            else:
                redirects[fields[0]] = fields[1]
    if redirects != REDIRECTS:
        errors.append("_redirects does not match the expected legacy route map")

    headers = (ROOT / "_headers").read_text(encoding="utf-8")
    for required in ("script-src 'none'", "frame-ancestors 'none'", "no-transform"):
        if required not in headers:
            errors.append(f"_headers missing {required}")
    apex_hsts = re.search(
        r"(?m)^https://rlapplications\.com/\*\s*$\n(?:^[ \t]+.*\n?)*?^[ \t]+Strict-Transport-Security:\s*([^\r\n]+)",
        headers,
    )
    if not apex_hsts or apex_hsts.group(1).strip().lower() != "max-age=31536000":
        errors.append("_headers must set apex-only HSTS to exactly max-age=31536000")
    if re.search(r"(?i)strict-transport-security:[^\r\n]*(includesubdomains|preload)", headers):
        errors.append("_headers HSTS must not opt subdomains into HSTS or preload")

    pwa = parse_document((APP_ROOT / "index.html").read_text(encoding="utf-8"))
    csp = pwa.csp or ""
    required_pwa_csp = {
        "default-src": {"'self'"},
        "script-src": {"'self'"},
        "style-src": {"'self'", "'unsafe-inline'"},
        "img-src": {"'self'", "data:", "blob:", "https://ajyuozqoukigeeyhvuqc.supabase.co"},
        "connect-src": {"'self'", "https://ajyuozqoukigeeyhvuqc.supabase.co",
                        "wss://ajyuozqoukigeeyhvuqc.supabase.co", "https://api.bigdatacloud.net"},
        "font-src": {"'self'"},
        "manifest-src": {"'self'"},
        "worker-src": {"'self'"},
        "object-src": {"'none'"},
        "base-uri": {"'self'"},
        "form-action": {"'self'"},
        "frame-src": {"'none'"},
    }
    directives: dict[str, set[str]] = {}
    for raw in csp.split(";"):
        fields = raw.split()
        if fields:
            directives[fields[0].lower()] = set(fields[1:])
    if directives != required_pwa_csp:
        errors.append("index.html PWA CSP differs from the reviewed application-specific policy")
    if "frame-ancestors" in directives:
        errors.append("index.html must not imply meta CSP can enforce frame-ancestors")
    if pwa.inline_scripts:
        errors.append("index.html has inline script that the PWA CSP would block")
    if pwa.event_handlers:
        errors.append(f"index.html has inline event handlers blocked by CSP: {sorted(set(pwa.event_handlers))}")
    app_config = (APP_ROOT / "config.js").read_text(encoding="utf-8")
    app_source = (APP_ROOT / "app.js").read_text(encoding="utf-8")
    for required_origin in ("https://ajyuozqoukigeeyhvuqc.supabase.co", "https://api.bigdatacloud.net"):
        if required_origin not in csp or required_origin not in app_config + app_source:
            errors.append(f"PWA CSP/runtime origin inventory is missing {required_origin}")

    css = (ROOT / "assets/site.css").read_text(encoding="utf-8")
    for required in (
        "@media (max-width: 760px)",
        ".nav-links { width: 100%;",
        ".hero-grid, .grid, .grid.two, .footer-grid { grid-template-columns: 1fr; }",
        "a:focus-visible, summary:focus-visible",
    ):
        if required not in css:
            errors.append(f"site.css missing responsive/accessibility rule: {required}")

    robots = (ROOT / "robots.txt").read_text(encoding="utf-8")
    if "Sitemap: https://rlapplications.com/sitemap.xml" not in robots:
        errors.append("robots.txt does not identify the canonical sitemap")
    return errors, external


def fetch(url: str, *, follow: bool = True) -> tuple[int, dict[str, str], bytes]:
    request = urllib.request.Request(url, headers={"User-Agent": USER_AGENT, "Accept": "*/*"})
    opener = urllib.request.build_opener() if follow else urllib.request.build_opener(NoRedirect)
    try:
        with opener.open(request, timeout=25) as response:
            return response.status, {k.lower(): v for k, v in response.headers.items()}, response.read()
    except urllib.error.HTTPError as exc:
        return exc.code, {k.lower(): v for k, v in exc.headers.items()}, exc.read()


def check_headers(label: str, headers: dict[str, str], errors: list[str]) -> None:
    for name, fragments in REQUIRED_HEADERS.items():
        value = headers.get(name, "")
        for fragment in fragments:
            if fragment not in value:
                errors.append(f"{label}: {name} missing {fragment}")


def check_apex_hsts(label: str, headers: dict[str, str], errors: list[str]) -> None:
    value = headers.get("strict-transport-security", "").strip().lower()
    if value != "max-age=31536000":
        errors.append(f"{label}: strict-transport-security must be apex-only max-age=31536000")


def live_checks() -> list[str]:
    errors: list[str] = []
    for host in LIVE_HOSTS:
        for route, relative in {**ROUTES, **ASSETS}.items():
            status, headers, body = fetch(host + route)
            label = host + route
            if status != 200:
                errors.append(f"{label}: expected 200, received {status}")
                continue
            authored = (ROOT / relative).read_bytes()
            if normalise(body) != normalise(authored):
                errors.append(f"{label}: live payload differs from authored source")
            check_headers(label, headers, errors)
            if host == "https://rlapplications.com":
                check_apex_hsts(label, headers, errors)
            if route in ROUTES:
                if "no-transform" not in headers.get("cache-control", ""):
                    errors.append(f"{label}: cache-control missing no-transform")
                text = body.decode("utf-8", errors="replace")
                if CONTACT not in text and route in {"/", "/support/", "/privacy/", "/wayfinder/support/", "/wayfinder/privacy/", "/wayfinder/delete-account/"}:
                    errors.append(f"{label}: expected contact address missing")
                if "data-cfemail" in text or "/cdn-cgi/l/email-protection" in text:
                    errors.append(f"{label}: email rewriting detected")
                if "<script" in text.lower():
                    errors.append(f"{label}: unexpected script detected")

        for old, destination in REDIRECTS.items():
            status, headers, _ = fetch(host + old, follow=False)
            location = headers.get("location", "")
            expected_location = urljoin(host + old, destination)
            if status != 301:
                errors.append(f"{host + old}: expected 301, received {status}")
            if urljoin(host + old, location) != expected_location:
                errors.append(f"{host + old}: redirects to {location!r}, expected {expected_location!r}")
            check_headers(host + old, headers, errors)

        missing = "/diagnostic-page-that-does-not-exist-20260914"
        status, headers, body = fetch(host + missing, follow=False)
        if status != 404:
            errors.append(f"{host + missing}: expected 404, received {status}")
        if normalise(body) != normalise((ROOT / "404.html").read_bytes()):
            errors.append(f"{host + missing}: 404 payload differs from authored source")
        check_headers(host + missing, headers, errors)
    return errors


def external_checks(urls: set[str]) -> list[str]:
    errors: list[str] = []
    for url in sorted(urls):
        status, _, _ = fetch(url)
        if not 200 <= status < 400:
            errors.append(f"external link {url}: received {status}")
    return errors


def main() -> int:
    parser = argparse.ArgumentParser()
    parser.add_argument("--live", action="store_true", help="also verify all production hosts")
    parser.add_argument("--external", action="store_true", help="also request external HTTPS links")
    args = parser.parse_args()

    errors, external = local_checks()
    scopes = ["local"]
    if args.live:
        errors.extend(live_checks())
        scopes.append("live")
    if args.external:
        errors.extend(external_checks(external))
        scopes.append("external")

    if errors:
        print(f"Website checks failed ({', '.join(scopes)}):")
        for error in errors:
            print(f"- {error}")
        return 1
    print(f"Website checks passed ({', '.join(scopes)}).")
    print(f"Checked {len(ROUTES) + 1} HTML pages, {len(ASSETS)} assets, {len(REDIRECTS)} redirects and {len(external)} external links.")
    if args.live:
        requests = len(LIVE_HOSTS) * (len(ROUTES) + len(ASSETS) + len(REDIRECTS) + 1)
        print(f"Verified {requests} live responses across {len(LIVE_HOSTS)} hosts.")
    return 0


if __name__ == "__main__":
    sys.exit(main())
