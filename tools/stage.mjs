/* Build www/ — exactly the files that ship inside the app.
 *
 * webDir used to be "." which was fine when the folder held nothing but the
 * app. It no longer does: node_modules alone is 230 packages, and Capacitor
 * copies webDir wholesale into the native bundle. A staging folder makes the
 * shipping surface explicit — if it is not in SHIP, it is not in the app.
 *
 * Deliberately absent:
 *   sw.js  — a service worker inside a native shell caches assets that the app
 *            update already replaced, so the app can serve last month's code
 *            after an update. Native has no offline problem to solve; the
 *            files are already on the device. The web build keeps it.
 *   data/src, tools, supabase, *.md — build inputs, not runtime.
 */
import { cp, mkdir, rm, stat, readdir } from 'node:fs/promises';
import { join, dirname } from 'node:path';

const ROOT = new URL('..', import.meta.url).pathname.replace(/^\/([A-Za-z]:)/, '$1');
const OUT = join(ROOT, 'www');

const SHIP = [
  'index.html', 'privacy.html', 'support.html', 'manifest.json',
  'styles.css',
  'app.js', 'config.js', 'countries.js', 'store.js', 'partners.js',
  'land.js', 'world.js',
  'data/adventures.json',
  'vendor/supabase-2.113.0.js',
  'icons',
];

await rm(OUT, { recursive: true, force: true });
await mkdir(OUT, { recursive: true });

let bytes = 0;
async function size(p) {
  const s = await stat(p);
  if (!s.isDirectory()) return s.size;
  let t = 0;
  for (const e of await readdir(p)) t += await size(join(p, e));
  return t;
}

for (const rel of SHIP) {
  const from = join(ROOT, rel), to = join(OUT, rel);
  await mkdir(dirname(to), { recursive: true });
  await cp(from, to, { recursive: true });
  bytes += await size(from);
}

console.log(`www/ staged — ${SHIP.length} entries, ${(bytes / 1048576).toFixed(1)} MB`);
