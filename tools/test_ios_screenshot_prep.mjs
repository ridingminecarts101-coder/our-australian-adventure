import { strict as assert } from 'node:assert';
import { readFile } from 'node:fs/promises';
import { fileURLToPath } from 'node:url';
import xcode from 'xcode';

const [projectText, scheme, workflow, testSource, listing, copy, markup, appSource] = await Promise.all([
  readFile(new URL('../ios/App/App.xcodeproj/project.pbxproj', import.meta.url), 'utf8'),
  readFile(new URL('../ios/App/App.xcodeproj/xcshareddata/xcschemes/App.xcscheme', import.meta.url), 'utf8'),
  readFile(new URL('../.github/workflows/ios-store-screenshots.yml', import.meta.url), 'utf8'),
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
assert.match(workflow, /-s format jpeg/);

assert.match(testSource, /XCUIScreen\.main\.screenshot\(\)/);
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
