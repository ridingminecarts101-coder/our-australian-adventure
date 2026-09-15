import { strict as assert } from 'node:assert';
import { readFile } from 'node:fs/promises';
import { fileURLToPath } from 'node:url';
import xcode from 'xcode';

const [projectText, scheme, workflow, startupWorkflow, testSource, listing, copy, markup, appSource] = await Promise.all([
  readFile(new URL('../ios/App/App.xcodeproj/project.pbxproj', import.meta.url), 'utf8'),
  readFile(new URL('../ios/App/App.xcodeproj/xcshareddata/xcschemes/App.xcscheme', import.meta.url), 'utf8'),
  readFile(new URL('../.github/workflows/ios-store-screenshots.yml', import.meta.url), 'utf8'),
  readFile(new URL('../.github/workflows/ios-startup-diagnostic.yml', import.meta.url), 'utf8'),
  readFile(new URL('../ios/App/WayfinderStoreScreenshotsUITests/WayfinderStoreScreenshots.swift', import.meta.url), 'utf8'),
  readFile(new URL('../store-release/ios-listing.json', import.meta.url), 'utf8').then(JSON.parse),
  readFile(new URL('../store-release/APP-STORE-COPY-AND-REVIEW.md', import.meta.url), 'utf8'),
  readFile(new URL('../index.html', import.meta.url), 'utf8'),
  readFile(new URL('../app.js', import.meta.url), 'utf8'),
]);

const projectPath = fileURLToPath(new URL('../ios/App/App.xcodeproj/project.pbxproj', import.meta.url));
const project = xcode.project(projectPath);
project.parseSync();
const targetNames = Object.values(project.pbxNativeTargetSection()).filter(x => x?.name).map(x => x.name);
assert(targetNames.includes('WayfinderStoreScreenshotsUITests'));
assert.match(projectText, /WayfinderStoreScreenshots\.swift in Sources/);
assert.match(scheme, /BlueprintName="WayfinderStoreScreenshotsUITests"/);

assert.match(workflow, /workflow_dispatch:/);
assert.doesNotMatch(workflow, /app-store-connect|altool|notarytool|upload-app|deliver/i);
assert.match(workflow, /if: github\.ref == 'refs\/heads\/main'/);
assert.match(workflow, /environment: app-store/);
assert.match(workflow, /secrets\.WAYFINDER_REVIEW_EMAIL/);
assert.match(workflow, /secrets\.WAYFINDER_REVIEW_PASSWORD/);
assert.match(workflow, /vars\.REVENUECAT_IOS_PUBLIC_SDK_KEY/);
assert.match(workflow, /\[\[ "\$REVENUECAT_IOS_PUBLIC_SDK_KEY" =~ \^appl_/);
assert.match(workflow, /node tools\/prepare_ios_store_release\.mjs/);
assert.match(workflow, /check_billing\.py --store-release --platform ios/);
assert.match(workflow, /grep -Fq "android: ''" ios\/App\/App\/public\/config\.js/);
assert(workflow.indexOf('git diff --exit-code') < workflow.indexOf('node tools/prepare_ios_store_release.mjs'),
  'tracked native drift must fail before per-run key injection');
assert(workflow.indexOf('node tools/prepare_ios_store_release.mjs') < workflow.indexOf('xcodebuild test'),
  'simulator build must receive the prepared Apple SDK key');
assert.equal((workflow.match(/export TEST_RUNNER_WAYFINDER_REVIEW_EMAIL=/g) || []).length, 2);
assert.equal((workflow.match(/export TEST_RUNNER_WAYFINDER_REVIEW_PASSWORD=/g) || []).length, 2);
for (const log of ['iphone', 'ipad']) {
  const tee = workflow.indexOf(`tee build/store-screenshots-${log}.log`);
  assert(tee >= 0 && workflow.lastIndexOf('mkdir -p build', tee) >= 0,
    `${log} log directory must exist before xcodebuild starts`);
}
assert.match(workflow, /iPhone 17 Pro Max/);
assert.match(workflow, /iPad Pro 13-inch \(M5\)/);
assert.match(workflow, /Available iPhone Pro Max and 13-inch iPad Pro simulators/);
assert.match(workflow, /1320 2868/);
assert.match(workflow, /2064 2752/);
assert.match(workflow, /xcresulttool export attachments/);
assert.match(workflow, /- name: Export screenshots and failure attachments\n\s+if: always\(\)/);
assert(workflow.indexOf('Export screenshots and failure attachments') < workflow.indexOf('Save screenshots and test evidence'),
  'failure attachments must be exported before artifact upload');
assert.match(workflow, /-s format jpeg/);

assert.match(startupWorkflow, /workflow_dispatch:/);
assert.match(startupWorkflow, /CODE_SIGNING_ALLOWED=NO/);
assert.match(startupWorkflow, /-only-testing:WayfinderStoreScreenshotsUITests\/WayfinderStoreScreenshots\/testStartupDiagnostic/);
assert.match(startupWorkflow, /- name: Export startup screen and accessibility evidence\n\s+if: always\(\)/);
assert(startupWorkflow.indexOf('Export startup screen and accessibility evidence') < startupWorkflow.indexOf('Retain startup test evidence'),
  'startup failure evidence must be exported before upload');
assert.doesNotMatch(startupWorkflow, /environment: app-store|secrets\.|TEST_RUNNER_|REVENUECAT_IOS_PUBLIC_SDK_KEY|APP_STORE_CONNECT_API_/);

assert.match(testSource, /XCUIScreen\.main\.screenshot\(\)/);
assert.match(testSource, /func testStartupDiagnostic\(\)/);
const diagnostic = testSource.slice(testSource.indexOf('func testStartupDiagnostic()'), testSource.indexOf('func testCaptureStoreSubmissionScreens()'));
assert(diagnostic.indexOf('attachStartupEvidence()') < diagnostic.indexOf('XCTAssertTrue(webViewFound'),
  'diagnostic screen and accessibility tree must be attached before failure assertion');
assert.doesNotMatch(diagnostic, /reviewEmail|reviewPassword|WAYFINDER_REVIEW_/);
assert.match(testSource, /let accountGateFound = signIn\.waitForExistence\(timeout: 45\)/);
assert.match(testSource, /if !accountGateFound \{ attachStartupEvidence\(\) \}/);
assert(testSource.indexOf('if !accountGateFound { attachStartupEvidence() }') < testSource.indexOf('emailField.tap(); emailField.typeText(email)'),
  'a failed pre-login gate must attach evidence before typing credentials');
assert.match(testSource, /screenshot\.name = "startup-actual-screen"/);
assert.match(testSource, /tree\.name = "startup-accessibility-tree"/);
assert.match(testSource, /WAYFINDER_REVIEW_EMAIL/);
assert.match(testSource, /WAYFINDER_REVIEW_PASSWORD/);
assert.match(testSource, /throw XCTSkip\("A private, verified review account/);
assert.match(testSource, /button\(containing: "Oceania"\)\.waitForExistence/);
assert.match(testSource, /app\.staticTexts\.matching\(NSPredicate\(format: "label == %@", "Mobile app"\)\)\.count/);
assert.match(testSource, /app\.staticTexts\.matching\(NSPredicate\(format: "label == %@", "Unlocked"\)\)\.count/);
assert.doesNotMatch(testSource, /@example\.|fixture-service|password\s*=\s*"[^"\n]+"/i);
for (const label of ['Email', 'Password', 'Sign in', 'Stamps', 'Your memories',
  'Traveller recommendations', 'Trips', 'Paid collections']) {
  assert(markup.includes(label), `native WebView selector changed: ${label}`);
}
for (const label of ['All continents', 'Oceania gems', 'Europe gems', 'North America gems',
  'Asia gems', 'Middle East gems', 'South America gems', 'Africa gems']) {
  assert(appSource.includes('p.name') && testSource.includes(`"${label}"`),
    `IAP screenshot row selector changed: ${label}`);
}
assert.match(appSource, /<button class="placerow/);
assert.match(markup, /data-tab="tab-list"[^>]*>.*Adventures/);
for (const name of [
  '01-adventures-world', '02-passport', '03-memories', '04-community',
  '05-trips-achievements', '06-paid-collections', '07-oceania', '08-australia',
]) assert(testSource.includes(`"${name}"`), `missing screenshot ${name}`);
assert.equal((testSource.match(/\("iap-/g) || []).length, 1,
  'IAP captures are generated from the reviewed eight-product loop');

assert(listing.app.name.length <= 30);
assert(listing.app.subtitle.length <= 30);
assert(listing.localization.promotional_text.length <= 170);
assert(Buffer.byteLength(listing.localization.keywords, 'utf8') <= 100);
assert(listing.localization.description.length <= 4000);
assert.match(copy, /No screenshot has been produced yet/);
assert.match(copy, /does not certify/);
assert.match(copy, /protected `app-store`/);

console.log('PASS: iOS screenshot target, manual workflow and draft copy are structurally consistent');
