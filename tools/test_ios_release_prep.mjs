import assert from 'node:assert/strict';
import { readFile } from 'node:fs/promises';
import { injectApplePublicKey, validateApplePublicKey } from './prepare_ios_store_release.mjs';

const source = await readFile('config.js', 'utf8');
const key = 'appl_PUBLICKEY12345';
assert.equal(validateApplePublicKey(key), key);
for (const bad of ['', 'goog_PUBLICKEY12345', 'appl_short', 'sk_live_not_public']) {
  assert.throws(() => validateApplePublicKey(bad));
}
const injected = injectApplePublicKey(source, key);
assert.match(injected, /ios: 'appl_PUBLICKEY12345'/);
assert.equal((injected.match(/appl_PUBLICKEY12345/g) || []).length, 1);
assert.equal(injected.replace("ios: 'appl_PUBLICKEY12345'", "ios: ''"), source,
  'release preparation may change only the staged Apple public-key slot');
assert.throws(() => injectApplePublicKey("ios: ''\nios: ''", key));

const workflow = await readFile('.github/workflows/ios-release-upload.yml', 'utf8');
for (const required of [
  'APPLE_DISTRIBUTION_CERTIFICATE_P12_BASE64',
  'APPLE_DISTRIBUTION_CERTIFICATE_PASSWORD',
  'IOS_APP_STORE_PROVISIONING_PROFILE_BASE64',
  'APP_STORE_CONNECT_API_PRIVATE_KEY_P8_BASE64',
  'REVENUECAT_IOS_PUBLIC_SDK_KEY',
  'UPLOAD_WAYFINDER',
  'CODE_SIGN_STYLE=Manual',
  'xcrun altool --validate-app',
  'xcrun altool --upload-app',
]) assert.match(workflow, new RegExp(required));
assert.doesNotMatch(workflow, /upload-artifact[\s\S]*\.ipa/,
  'a distribution IPA must not be published as a public-repository artifact');
assert.match(workflow, /environment:\s*app-store/);
const jobEnv = workflow.match(/\n    env:\n([\s\S]*?)\n    defaults:/)?.[1] || '';
assert.doesNotMatch(jobEnv, /secrets\./,
  'signing secrets must be scoped to the shell steps that need them, not every action');
assert.match(workflow, /PROFILE_APP_ID[\s\S]*app\.wayfinder\.mobile/,
  'the provisioning profile must be checked against the fixed bundle identifier');
assert.match(workflow, /ProvisionedDevices/,
  'development and ad hoc profiles must be rejected');
assert.match(workflow, /ProvisionsAllDevices/,
  'enterprise profiles must be rejected');
assert.match(workflow, /Export App Store IPA[\s\S]*set -euo pipefail/,
  'archive export must propagate pipeline failures');
assert.match(workflow, /npx cap sync ios[\s\S]*git diff --exit-code[\s\S]*prepare_ios_store_release/,
  'release staging must match committed native files before the public key is injected');
assert.match(workflow, /test -f ios\/App\/App\.xcodeproj\/project\.xcworkspace\/xcshareddata\/swiftpm\/Package\.resolved/,
  'signed delivery must require a reviewed Swift package resolution');
assert.match(workflow, /-disableAutomaticPackageResolution/,
  'signed delivery must not resolve different Swift dependency revisions');
assert.doesNotMatch(workflow, /security import[^\n]*[\s\S]{0,200}\s-A(?:\s|$)/,
  'the imported distribution identity must not be available to every runner process');
assert(workflow.indexOf('- name: Remove signing material') < workflow.indexOf('- name: Save non-binary delivery evidence'),
  'signing material must be removed before a third-party artifact action runs');

const unsignedWorkflow = await readFile('.github/workflows/ios-compile.yml', 'utf8');
assert.match(unsignedWorkflow, /npx cap sync ios[\s\S]*git diff --exit-code[\s\S]*xcodebuild/,
  'unsigned compilation must not silently build generated changes outside its recorded commit');
assert.match(unsignedWorkflow, /cp "\$RESOLVED" build\/Package\.resolved/,
  'the bootstrap compile must export its generated Swift package resolution for review');
assert.match(unsignedWorkflow, /build\/Package\.resolved/,
  'the unsigned evidence artifact must retain the generated Swift package resolution');

console.log('  iOS release preparation: public-key injection and guarded delivery workflow passed');
