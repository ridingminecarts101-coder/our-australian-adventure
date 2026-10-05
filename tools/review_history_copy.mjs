// Read-only consistency check for the owner's leave-group history decision.
import assert from 'node:assert/strict';
import { readFile } from 'node:fs/promises';
import { resolve } from 'node:path';
import { fileURLToPath } from 'node:url';

const repo = resolve(process.env.REVIEW_TARGET || fileURLToPath(new URL('..', import.meta.url)));
const files = [
  'app.js',
  'support.html',
  'privacy.html',
  'business-site/public/wayfinder/support/index.html',
  'business-site/public/wayfinder/privacy/index.html',
];
for (const file of files) {
  const text = await readFile(resolve(repo, file), 'utf8');
  assert.ok(/leav(?:e|ing)[\s\S]{0,380}(?:shared|share)[\s\S]{0,180}(?:remain|stay|preserv)/i.test(text),
    `${file} must explain retained group history after leaving`);
  assert.ok(/(?:last member|last-member)[\s\S]{0,120}(?:delet|dispos)/i.test(text),
    `${file} must explain last-member disposal`);
}
console.log('PASS: app and bundled/public policy copy explain retained history and last-member disposal');
