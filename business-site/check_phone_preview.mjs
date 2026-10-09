// Guard the temporary, branch-only Wayfinder phone preview against missing
// assets and accidentally copying non-runtime material into public hosting.
import { createHash } from 'node:crypto';
import { createServer } from 'node:http';
import { readFile, readdir } from 'node:fs/promises';
import { extname, join, relative, resolve, sep } from 'node:path';
import { fileURLToPath } from 'node:url';

const site = resolve(fileURLToPath(new URL('./public/', import.meta.url)));
const root = fileURLToPath(new URL('../', import.meta.url));
const preview = join(site, 'review-app');
const changed = new Set(['index.html', 'manifest.json', 'config.js', 'sw.js']);
const expected = [
  'index.html', 'privacy.html', 'support.html', 'notices.html', 'manifest.json',
  'styles.css', 'app.js', 'frame-guard.js', 'photo-files.js',
  'photo-backup.js', 'photo-transfer.js', 'config.js', 'countries.js',
  'store.js', 'booking-links.js', 'partners.js', 'land.js', 'world.js',
  'sw.js', 'data/adventures.json', 'vendor/supabase-2.113.0.js',
  'icons/icon-180.png', 'icons/icon-192.png', 'icons/icon-512.png',
  'icons/icon-512-maskable.png',
].sort();

async function files(dir) {
  const out = [];
  for (const entry of await readdir(dir, { withFileTypes: true })) {
    if (entry.isDirectory()) out.push(...await files(join(dir, entry.name)));
    else if (entry.isFile()) out.push(join(dir, entry.name));
    else throw Error(`Unexpected filesystem entry: ${entry.name}`);
  }
  return out;
}
function assert(condition, message) { if (!condition) throw Error(message); }
function digest(bytes) { return createHash('sha256').update(bytes).digest('hex'); }

const actual = (await files(preview)).map(path => relative(preview, path).replaceAll(sep, '/')).sort();
assert(JSON.stringify(actual) === JSON.stringify(expected),
  `Preview allowlist mismatch: ${JSON.stringify(actual.filter(x => !expected.includes(x)))}`);
for (const path of expected.filter(x => !changed.has(x))) {
  const [source, staged] = await Promise.all([
    readFile(join(root, path)), readFile(join(preview, path)),
  ]);
  assert(digest(source) === digest(staged), `Preview copy differs from release source: ${path}`);
}

const [index, css, sw, config, headers, manifest] = await Promise.all([
  readFile(join(preview, 'index.html'), 'utf8'),
  readFile(join(preview, 'styles.css'), 'utf8'),
  readFile(join(preview, 'sw.js'), 'utf8'),
  readFile(join(preview, 'config.js'), 'utf8'),
  readFile(join(site, '_headers'), 'utf8'),
  readFile(join(preview, 'manifest.json'), 'utf8').then(JSON.parse),
]);
assert(manifest.id === '/review-app/' && manifest.scope === './' && manifest.start_url === './',
  'Preview install scope/id must remain isolated from the public PWA');
assert(index.includes('name="robots" content="noindex, nofollow"'), 'Preview HTML must be noindex');
assert(!/(?:src|href)="\//.test(index) && !/url\(\s*["']?\//.test(css),
  'Root-relative asset reference would escape /review-app/');
assert(config.includes("shareBase: new URL('/review-app/', location.href).href")
  && config.includes("inviteBase: new URL('/review-app/', location.href).href"),
  'Preview invitation/share links must stay on its own origin');
assert(sw.includes("const CACHE_VERSION = 'wayfinder-preview-v71'"),
  'Preview service worker needs a separate cache');
assert(index.includes('navigator.serviceWorker.register') === false
  && (await readFile(join(preview, 'app.js'), 'utf8')).includes("navigator.serviceWorker.register('sw.js')"),
  'Service worker registration must remain path-relative');

const scopedHeaders = headers.match(/^\/review-app\/\*\r?\n((?:[ \t]+[^\r\n]*\r?\n)+)/m)?.[1] || '';
assert(scopedHeaders.includes('! Content-Security-Policy')
  && scopedHeaders.includes("script-src 'self'")
  && scopedHeaders.includes('https://ajyuozqoukigeeyhvuqc.supabase.co')
  && scopedHeaders.includes('wss://ajyuozqoukigeeyhvuqc.supabase.co')
  && scopedHeaders.includes('https://api.bigdatacloud.net')
  && scopedHeaders.includes('camera=(self)')
  && scopedHeaders.includes('geolocation=(self)')
  && scopedHeaders.includes('X-Robots-Tag: noindex'),
  'Preview header override is incomplete');

const refs = [...index.matchAll(/(?:src|href)="([^"#?]+)"/g)].map(x => x[1]);
for (const ref of refs) {
  if (/^[a-z]+:/i.test(ref)) continue;
  assert(expected.includes(ref), `Missing HTML asset: ${ref}`);
}
for (const [, ref] of sw.matchAll(/'\.\/([^']+)'/g)) {
  if (!ref) continue;
  assert(expected.includes(ref), `Missing service-worker shell asset: ${ref}`);
}

const mime = { '.html': 'text/html', '.js': 'text/javascript', '.json': 'application/json', '.css': 'text/css', '.png': 'image/png' };
const server = createServer(async (req, res) => {
  try {
    const path = decodeURIComponent(new URL(req.url, 'http://localhost').pathname);
    const file = resolve(site, `.${path}`, path.endsWith('/') ? 'index.html' : '');
    if (!file.startsWith(`${site}${sep}`)) { res.writeHead(403).end(); return; }
    const bytes = await readFile(file);
    res.writeHead(200, { 'Content-Type': mime[extname(file)] || 'application/octet-stream' });
    res.end(bytes);
  } catch { res.writeHead(404).end(); }
});
await new Promise(resolveReady => server.listen(0, '127.0.0.1', resolveReady));
try {
  const base = `http://127.0.0.1:${server.address().port}`;
  for (const path of ['/review-app/', ...expected.map(x => `/review-app/${x}`), '/']) {
    const response = await fetch(`${base}${path}`);
    assert(response.ok, `HTTP ${response.status}: ${path}`);
    await response.arrayBuffer();
  }
  console.log(`PASS: ${expected.length} allowlisted files match source, links resolve, scoped headers are present, and ${expected.length + 2} local HTTP routes load.`);
} finally {
  await new Promise(resolveClosed => server.close(resolveClosed));
}
