import assert from 'node:assert/strict';
import { readFile } from 'node:fs/promises';
import { webcrypto, randomUUID } from 'node:crypto';
import vm from 'node:vm';

const source = await readFile(new URL('../photo-backup.js', import.meta.url), 'utf8');
const context = { crypto: webcrypto, Blob, TextEncoder, TextDecoder, btoa, atob };
context.globalThis = context;
vm.runInNewContext(source, context, { filename: 'photo-backup.js' });
const core = context.WayfinderPhotoBackup;
const ownerA = randomUUID(), ownerB = randomUUID(), batch = randomUUID();
const password = 'local-only-test-passphrase';
let count = 0;
const pass = label => console.log(`PASS ${++count}: ${label}`);
// Synthetic 240x160 JPEG drawn from scratch, decoded as JPEG by System.Drawing
// during fixture preparation. This is a real image, not four JPEG magic bytes.
const image = new Uint8Array(await readFile(new URL('./fixtures/photo-backup.jpg', import.meta.url)));
assert.equal(image.length, 2162);
assert.equal(image[0], 0xff); assert.equal(image[1], 0xd8);
assert.equal(image.at(-2), 0xff); assert.equal(image.at(-1), 0xd9);
const photo = (id = randomUUID(), bytes = image) => ({
  id, adventure_id: 714, taken_at: '2026-09-15T05:00:00.000Z',
  added_at: '2026-09-15T05:05:00.000Z', width: 240, height: 160,
  bytes: bytes.length, blob: new Blob([bytes], { type: 'image/jpeg' }),
});

assert(Object.isFrozen(core));
assert.equal(core.MAX_PART_BYTES, 16 * 1024 * 1024);
assert.equal(core.MAX_FILE_BYTES, 32 * 1024 * 1024);
pass('pure module exposes immutable bounded API');

const original = photo();
const archive = await core.createPart(ownerA, [original], password,
  { exportId: batch, partIndex: 1, partCount: 2 });
assert(archive instanceof Blob);
const reopened = await core.openPart(ownerA, archive, password);
assert.equal(reopened.owner, ownerA);
assert.equal(reopened.exportId, batch);
assert.equal(reopened.partIndex, 1);
assert.equal(reopened.partCount, 2);
assert.equal(reopened.photos[0].id, original.id);
assert.equal(reopened.photos[0].adventure_id, 714);
assert.equal(reopened.photos[0].width, 240);
assert.equal(reopened.photos[0].height, 160);
assert.equal(reopened.photos[0].bytes, 2162);
assert.equal(reopened.photos[0].taken_at, original.taken_at);
assert.equal(reopened.photos[0].added_at, original.added_at);
assert.deepEqual(new Uint8Array(await reopened.photos[0].blob.arrayBuffer()), image);
assert.match(reopened.photos[0].sha256, /^[a-f0-9]{64}$/);
const raw = await archive.text();
for (const secret of [ownerA, original.id, 'native_path', 'https://'])
  assert(!raw.includes(secret), `encrypted envelope must not expose ${secret}`);
pass('real JPEG bytes and memory references round-trip; envelope exposes no owner/content');

await assert.rejects(core.openPart(ownerA, archive, 'the-wrong-passphrase'),
  /Wrong passphrase or damaged/);
await assert.rejects(core.openPart(ownerB, archive, password),
  /different account/);
pass('wrong passphrase and wrong signed-in owner fail closed');

const envelope = JSON.parse(raw);
async function reencrypt(mutator) {
  const salt = Buffer.from(envelope.salt, 'base64');
  const iv = Buffer.from(envelope.iv, 'base64');
  const material = await webcrypto.subtle.importKey('raw', new TextEncoder().encode(password),
    'PBKDF2', false, ['deriveKey']);
  const key = await webcrypto.subtle.deriveKey({ name: 'PBKDF2', salt,
    iterations: envelope.iterations, hash: 'SHA-256' }, material,
    { name: 'AES-GCM', length: 256 }, false, ['encrypt', 'decrypt']);
  const inner = JSON.parse(new TextDecoder().decode(await webcrypto.subtle.decrypt(
    { name: 'AES-GCM', iv }, key, Buffer.from(envelope.data, 'base64'))));
  mutator(inner);
  const cipher = await webcrypto.subtle.encrypt({ name: 'AES-GCM', iv }, key,
    new TextEncoder().encode(JSON.stringify(inner)));
  return new Blob([JSON.stringify({ ...envelope, data: Buffer.from(cipher).toString('base64') })]);
}
const tampered = { ...envelope, data: envelope.data.slice(0, -5) +
  (envelope.data.at(-5) === 'A' ? 'B' : 'A') + envelope.data.slice(-4) };
await assert.rejects(core.openPart(ownerA, new Blob([JSON.stringify(tampered)]), password),
  /Wrong passphrase or damaged/);
await assert.rejects(core.openPart(ownerA, new Blob([JSON.stringify({ ...envelope, version: 2 })]), password),
  /Unsupported or unsafe/);
await assert.rejects(core.openPart(ownerA, new Blob([JSON.stringify({ ...envelope, token: 'secret' })]), password),
  /Unsupported or unsafe/);
pass('tampering, unknown version and extra sensitive envelope fields reject');

await assert.rejects(core.openPart(ownerA, await reencrypt(inner => {
  inner.photos[0].native_path = 'wayfinder/photos/elsewhere.jpg';
}), password), /unsupported private fields/);
await assert.rejects(core.openPart(ownerA, await reencrypt(inner => {
  inner.photos.push({ ...inner.photos[0] });
}), password), /duplicate photo IDs/);
await assert.rejects(core.openPart(ownerA, await reencrypt(inner => {
  inner.photos[0].sha256 = '0'.repeat(64);
}), password), /checksum changed/);
await assert.rejects(core.openPart(ownerA, await reencrypt(inner => {
  const invalid = new Uint8Array(image); invalid[0] = 1;
  inner.photos[0].jpeg = Buffer.from(invalid).toString('base64');
}), password), /invalid JPEG/);
pass('validly encrypted malicious metadata, duplicate IDs, checksum and JPEG fail import validation');

const id = randomUUID();
await assert.rejects(core.createPart(ownerA, [photo(id), photo(id)], password,
  { exportId: batch, partIndex: 1, partCount: 1 }), /duplicate photo IDs/);
await assert.rejects(core.createPart(ownerA, [{ ...photo(), native_path: 'wayfinder/photos/private.jpg' }],
  password, { exportId: batch, partIndex: 1, partCount: 1 }), /path, URL or unsupported private field/);
await assert.rejects(core.createPart(ownerA, [{ ...photo(), url: 'https://example.com/private' }],
  password, { exportId: batch, partIndex: 1, partCount: 1 }), /path, URL or unsupported private field/);
await assert.rejects(core.createPart(ownerA, [photo(randomUUID(),
  new Uint8Array([0, 0, 1, 2, 3, 4]))], password,
  { exportId: batch, partIndex: 1, partCount: 1 }), /invalid JPEG/);
pass('duplicate IDs, paths, URLs and non-JPEG bytes cannot enter the archive');

await assert.rejects(core.createPart(ownerA, [photo()], 'short',
  { exportId: batch, partIndex: 1, partCount: 1 }), /at least 8/);
await assert.rejects(core.createPart(ownerA, [photo()], password,
  { exportId: batch, partIndex: 2, partCount: 1 }), /Part index exceeds/);
await assert.rejects(core.createPart(ownerA, [photo()], password,
  { exportId: batch, partIndex: 1, partCount: 1, path: '../sneak' }),
  /Unsupported backup archive option/);
pass('passphrase strength and part numbering are enforced');

const metadata = Array.from({ length: 5 }, (_, n) => ({
  id: randomUUID(), adventure_id: n + 1, bytes: 7 * 1024 * 1024,
}));
const planned = core.planParts(metadata);
assert.equal(planned.length, 3);
assert.equal(planned.flat().map(p => p.id).join(','), metadata.map(p => p.id).join(','));
assert.equal(core.planParts([], {}).length, 0);
assert.throws(() => core.planParts([{ ...metadata[0], bytes: 17 * 1024 * 1024 }]),
  /supported backup part size/);
assert.throws(() => core.planParts([metadata[0], metadata[0]]), /duplicate IDs/);
pass('all photos receive a numbered bounded part; oversize/duplicate items cannot be silently omitted');

await assert.rejects(core.openPart(ownerA, new Blob(['{}']), password), /invalid size/);
await assert.rejects(core.openPart(ownerA, new Blob([new Uint8Array(core.MAX_FILE_BYTES + 1)]), password),
  /invalid size/);
pass('input archive size is rejected before parsing or key derivation');

console.log(`${count} encrypted photo-backup core checks passed.`);
