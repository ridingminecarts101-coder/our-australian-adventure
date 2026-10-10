'use strict';

// Regression coverage for retiring the unreliable location action. The native
// SDK remains installed for binary compatibility, but current app code must not
// expose or invoke it.
const assert = require('node:assert/strict');
const fs = require('node:fs');

const app = fs.readFileSync('app.js', 'utf8');
const html = fs.readFileSync('index.html', 'utf8');
const manifest = fs.readFileSync('manifest.json', 'utf8');
const tour = app.slice(
  app.indexOf("const TOUR_DEVICE_SEEN_KEY = 'oaa.tour.v1.device-dismissed';"),
  app.indexOf('function wireUI() {'),
);
const support = fs.readFileSync('support.html', 'utf8');
const privacy = fs.readFileSync('privacy.html', 'utf8');

assert.doesNotMatch(html, /id="hereBtn"|>[^<]*Near me[^<]*<\/button>/i,
  'the world screen has no location action');
assert.match(html, /id="worldSearchBtn"[^>]*class="btn-ghost wide"[^>]*>[^<]*Search all adventures/,
  'world search occupies the former full-width action space');
assert.doesNotMatch(tour, /Near me|hereBtn|location lookup/i,
  'the guided tour does not teach an unavailable action');

for (const [label, pattern] of [
  ['public location handler', /\bjumpToHere\b/],
  ['browser geolocation request', /navigator\.geolocation/],
  ['native geolocation request', /cap\(['"]Geolocation['"]\)/],
  ['reverse geocoder', /api\.bigdatacloud\.net/],
  ['location resolver', /\bwhereAmI\b/],
  ['region matcher', /\bmatchRegion\b/],
]) {
  assert.doesNotMatch(app, pattern, `${label} is absent from current app code`);
}
assert.doesNotMatch(html, /api\.bigdatacloud\.net/,
  'the current content security policy no longer permits the retired provider');

assert.match(manifest, /"url"\s*:\s*"\.\/\?shortcut=near"/,
  'older installed PWA manifests can still launch their saved shortcut');
assert.match(app, /if \(shortcut === 'near'\)\s*\{ openWorldSearch\(\); return; \}/,
  'the saved shortcut falls back to global search without requesting location');

assert.match(support, /full-width <strong>Search all adventures<\/strong>/,
  'bundled help describes the current world action');
assert.doesNotMatch(support, /asks before using your current location|current-location lookup/i);
assert.match(privacy, /current version of Wayfinder does not request your location/i);
assert.match(privacy, /Earlier released\s+versions included an optional <em>Near me<\/em> action/i,
  'bundled privacy copy preserves accurate legacy disclosure');

console.log('PASS: Near me has no current UI or location request, and legacy shortcuts fall back to global search');
