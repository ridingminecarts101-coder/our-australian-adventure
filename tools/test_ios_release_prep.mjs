import assert from 'node:assert/strict';
import { mkdtemp, mkdir, readFile, rm, writeFile } from 'node:fs/promises';
import { spawnSync } from 'node:child_process';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
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
  'CODE_SIGN_STYLE = Manual;',
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
const archiveIdentityStep = workflow.match(/- name: Verify archive identity and embedded billing config[\s\S]*?(?=\n      - name: )/)?.[0] || '';
assert.match(archiveIdentityStep, /APP_PATH=build\/Wayfinder\.xcarchive\/Products\/Applications\/App\.app/);
assert.match(archiveIdentityStep, /test -s notices\.html[\s\S]*test -s "\$APP_PATH\/public\/notices\.html"[\s\S]*cmp -s notices\.html "\$APP_PATH\/public\/notices\.html"/,
  'the signed archive must contain the complete third-party notices file byte-for-byte');
assert(archiveIdentityStep.indexOf('cmp -s notices.html') < archiveIdentityStep.indexOf('codesign --verify'),
  'the notices payload must be checked before accepting the archive signature');
const archiveStep = workflow.match(/- name: Archive signed Release build[\s\S]*?(?=\n      - name: )/)?.[0] || '';
const archiveArgs = archiveStep.match(/xcodebuild archive \\\n([\s\S]*?)2>&1 \| tee build\/ios-archive\.log/)?.[1] || '';
assert(archiveArgs, 'signed archive command must be present');
assert.doesNotMatch(archiveArgs, /\b(?:DEVELOPMENT_TEAM|CODE_SIGN_STYLE|CODE_SIGN_IDENTITY|PROVISIONING_PROFILE_SPECIFIER|CURRENT_PROJECT_VERSION|MARKETING_VERSION)=/,
  'archive command-line settings affect package and resource targets, so App signing must be target-scoped');
assert.match(archiveStep, /trap 'cp build\/unsigned-project\.pbxproj "\$PROJECT"' EXIT/,
  'the App-only archive override must restore the committed project even when archiving fails');

const project = await readFile('ios/App/App.xcodeproj/project.pbxproj', 'utf8');
const listing = JSON.parse(await readFile('store-release/ios-listing.json', 'utf8'));
const workflowMarketingVersion = workflow.match(
  /marketing_version:[\s\S]*?^\s+default:\s*['"]?([0-9]+\.[0-9]+\.[0-9]+)['"]?\s*$/m)?.[1];
const workflowBuildNumber = workflow.match(
  /build_number:[\s\S]*?^\s+default:\s*['"]?([1-9][0-9]*)['"]?\s*$/m)?.[1];
assert(workflowMarketingVersion, 'the signed workflow must have a semantic marketing-version default');
assert(workflowBuildNumber, 'the signed workflow must have a positive internal-build default');
const projectMarketingVersions = [...project.matchAll(/MARKETING_VERSION = ([^;]+);/g)]
  .map(match => match[1]);
const projectBuildNumbers = [...project.matchAll(/CURRENT_PROJECT_VERSION = ([^;]+);/g)]
  .map(match => match[1]);
assert.equal(projectMarketingVersions.length, 2,
  'committed iOS Debug and Release configurations must each declare a marketing version');
assert.equal(projectBuildNumbers.length, 2,
  'committed iOS Debug and Release configurations must each declare an internal build number');
assert(projectMarketingVersions.every(version => version === workflowMarketingVersion),
  'iOS Debug and Release marketing versions must match the signed-workflow default');
assert(projectBuildNumbers.every(build => build === workflowBuildNumber),
  'iOS Debug and Release build numbers must match the signed-workflow default');
assert.equal(listing.app.version, workflowMarketingVersion,
  'the prepared App Store listing must match the iOS project and workflow marketing version');
const appReleasePattern = /\t\t504EC3181FED79650016851F \/\* Release \*\/ = \{[\s\S]*?\n\t\t\};/;
const sourceAppRelease = project.match(appReleasePattern)?.[0] || '';
assert.match(sourceAppRelease, /CODE_SIGN_STYLE = Automatic;/,
  'committed App Release must retain its development default before protected archive inputs are supplied');
assert.doesNotMatch(sourceAppRelease, /PROVISIONING_PROFILE_SPECIFIER|DEVELOPMENT_TEAM/);
const pythonBody = archiveStep.match(/python3 - <<'PY'\n([\s\S]*?)\n          PY/)?.[1]
  ?.split('\n').map(line => line.replace(/^          /, '')).join('\n') || '';
assert(pythonBody, 'App-only signing configuration must be executable');
const sandbox = await mkdtemp(join(tmpdir(), 'wayfinder-ios-signing-'));
try {
  const sandboxProject = join(sandbox, 'ios', 'App', 'App.xcodeproj', 'project.pbxproj');
  await mkdir(join(sandbox, 'ios', 'App', 'App.xcodeproj'), { recursive: true });
  await writeFile(sandboxProject, project);
  const result = spawnSync(process.platform === 'win32' ? 'python' : 'python3', ['-'], {
    cwd: sandbox,
    input: pythonBody,
    encoding: 'utf8',
    env: { ...process.env, PROFILE_NAME: 'Wayfinder App Store', APPLE_TEAM_ID: 'ABCDEFGHIJ',
      RELEASE_MARKETING_VERSION: '2.3.4', RELEASE_BUILD_NUMBER: '42' },
  });
  assert.equal(result.status, 0, result.stderr || 'App-only signing injection failed');
  const configured = await readFile(sandboxProject, 'utf8');
  const appRelease = configured.match(appReleasePattern)?.[0] || '';
  assert.match(appRelease, /CODE_SIGN_STYLE = Manual;/);
  assert.match(appRelease, /CODE_SIGN_IDENTITY = "Apple Distribution";/);
  assert.match(appRelease, /DEVELOPMENT_TEAM = ABCDEFGHIJ;/);
  assert.match(appRelease, /PROVISIONING_PROFILE_SPECIFIER = "Wayfinder App Store";/);
  assert.match(appRelease, /CURRENT_PROJECT_VERSION = 42;/);
  assert.match(appRelease, /MARKETING_VERSION = 2\.3\.4;/);
  assert.equal(configured.replace(appReleasePattern, '').replace(/\r\n/g, '\n') ===
    project.replace(appReleasePattern, '').replace(/\r\n/g, '\n'), true,
    'no project, UI test, package, or resource configuration may receive signing overrides');
} finally {
  await rm(sandbox, { recursive: true, force: true });
}
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
