/* Inject the RevenueCat Apple public key into the already-staged native copy.
 * The canonical config remains blank until the owner deliberately chooses a
 * checked-in public key. Secrets are neither accepted nor printed.
 */
import { createHash } from 'node:crypto';
import { readFile, writeFile } from 'node:fs/promises';
import { dirname, relative, resolve } from 'node:path';
import { fileURLToPath } from 'node:url';

const ROOT = resolve(dirname(fileURLToPath(import.meta.url)), '..');
const NATIVE_PUBLIC = resolve(ROOT, 'ios/App/App/public');
const DEFAULT_CONFIG = resolve(NATIVE_PUBLIC, 'config.js');

export function validateApplePublicKey(key) {
  if (!/^appl_[A-Za-z0-9]{10,}$/.test(key || '')) {
    throw new Error('REVENUECAT_IOS_PUBLIC_SDK_KEY must be the Apple platform public key (appl_…).');
  }
  if (/secret|private|sk_live/i.test(key)) throw new Error('A secret key is never valid in the app bundle.');
  return key;
}

export function injectApplePublicKey(text, key) {
  validateApplePublicKey(key);
  const matches = [...text.matchAll(/\bios:\s*'([^']*)'/g)];
  if (matches.length !== 1) throw new Error(`Expected one iOS RevenueCat key slot, found ${matches.length}.`);
  return text.replace(/\bios:\s*'[^']*'/, `ios: '${key}'`);
}

export async function prepare(configPath = DEFAULT_CONFIG, key = process.env.REVENUECAT_IOS_PUBLIC_SDK_KEY) {
  const target = resolve(configPath);
  const rel = relative(NATIVE_PUBLIC, target);
  if (!rel || rel.startsWith('..') || resolve(NATIVE_PUBLIC, rel) !== target) {
    throw new Error('Release injection is limited to the staged iOS public directory.');
  }
  const before = await readFile(target, 'utf8');
  const after = injectApplePublicKey(before, key);
  await writeFile(target, after, 'utf8');
  const verified = await readFile(target, 'utf8');
  if (verified !== after) throw new Error('The staged iOS config could not be verified after writing.');
  return {
    config: rel.replaceAll('\\', '/'),
    keySha256: createHash('sha256').update(key).digest('hex'),
  };
}

if (process.argv[1] && resolve(process.argv[1]) === fileURLToPath(import.meta.url)) {
  prepare().then(result => {
    console.log(`Prepared ${result.config}; Apple public-key SHA-256 ${result.keySha256}.`);
  }).catch(error => {
    console.error(error.message);
    process.exitCode = 1;
  });
}
