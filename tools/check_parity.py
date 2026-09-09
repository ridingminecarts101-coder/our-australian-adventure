# -*- coding: utf-8 -*-
"""Are the two apps the same app?

They should be, and mostly they are for free: both shells load the identical
web build out of www/, so every screen, every rule, every price string and
every piece of behaviour is one implementation. There is no iOS branch of the
adventure list to drift from the Android one.

What CAN drift is everything outside that - the two native projects, which are
separate files edited at separate times, and the two store listings, which are
separate web forms filled in months apart. That is what this checks.

ASCII output on purpose: the Windows console is cp1252 and raises on a box
character rather than degrading, which turns a passing check into a crash.

    python tools/check_parity.py
"""
import io
import json
import os
import plistlib
import re
import sys

ROOT = os.path.dirname(os.path.dirname(os.path.abspath(__file__)))
os.chdir(ROOT)

problems, notes = [], []


def read(path):
    try:
        return io.open(path, encoding='utf-8').read()
    except OSError:
        return ''


def compare(label, android, ios, note=None):
    same = android == ios
    print('  %-26s %-22s %-22s %s' % (
        label, android or '-', ios or '-', 'ok' if same else 'DIFFERENT'))
    if not same:
        problems.append('%s: android %r, ios %r%s' % (
            label, android, ios, ' (%s)' % note if note else ''))
    return same


# ── Identity and version ─────────────────────────────────────────────
gradle = read('android/app/build.gradle')
pbx = read('ios/App/App.xcodeproj/project.pbxproj')
cap = json.loads(read('capacitor.config.json') or '{}')

a_id = (re.search(r'applicationId "([^"]+)"', gradle) or [None, None])[1]
i_id = (re.search(r'PRODUCT_BUNDLE_IDENTIFIER = ([^;]+);', pbx) or [None, None])[1]
a_name = (re.search(r'versionName "([^"]+)"', gradle) or [None, None])[1]
i_name = (re.search(r'MARKETING_VERSION = ([^;]+);', pbx) or [None, None])[1]
a_code = (re.search(r'versionCode (\d+)', gradle) or [None, None])[1]
i_code = (re.search(r'CURRENT_PROJECT_VERSION = ([^;]+);', pbx) or [None, None])[1]

print('\n  %-26s %-22s %-22s' % ('', 'ANDROID', 'iOS'))
print('  ' + '-' * 72)
compare('bundle id', a_id, i_id)
compare('version name', a_name, i_name, 'tools/release.py bumps both')
compare('build number', a_code, i_code, 'tools/release.py bumps both')
compare('app id in capacitor', cap.get('appId'), a_id)

# ── The web build, which is the app ──────────────────────────────────
and_assets = 'android/app/src/main/assets/public'
ios_assets = 'ios/App/App/public'
for label, path in (('android', and_assets), ('ios', ios_assets)):
    if not os.path.isdir(path):
        notes.append('%s has no copied web assets yet - run npm run sync' % label)

if os.path.isdir(and_assets) and os.path.isdir(ios_assets):
    def listing(root):
        out = {}
        for base, _, files in os.walk(root):
            for f in files:
                full = os.path.join(base, f)
                out[os.path.relpath(full, root).replace('\\', '/')] = os.path.getsize(full)
        return out

    a, i = listing(and_assets), listing(ios_assets)
    # Each platform gets its own generated capacitor.config.json and bridge.
    ignore = {'capacitor.config.json', 'cordova.js', 'cordova_plugins.js', 'native-bridge.js'}
    a = {k: v for k, v in a.items() if k not in ignore}
    i = {k: v for k, v in i.items() if k not in ignore}
    only_a, only_i = sorted(set(a) - set(i)), sorted(set(i) - set(a))
    differ = sorted(k for k in set(a) & set(i) if a[k] != i[k])
    print('\n  shipped web files          %-22s %-22s %s' % (
        '%d files' % len(a), '%d files' % len(i),
        'ok' if not (only_a or only_i or differ) else 'DIFFERENT'))
    for k in only_a[:5]:
        problems.append('android ships %s and ios does not' % k)
    for k in only_i[:5]:
        problems.append('ios ships %s and android does not' % k)
    for k in differ[:5]:
        problems.append('%s differs in size between the two builds' % k)

# ── Permissions, which are worded per platform but must cover the same
#    ground: nothing should be askable on one phone and not the other ──
manifest = read('android/app/src/main/AndroidManifest.xml')
try:
    plist = plistlib.load(open('ios/App/App/Info.plist', 'rb'))
except Exception:
    plist = {}

print('\n  capability                 android                ios')
print('  ' + '-' * 72)
for label, and_perm, ios_key in (
    ('camera',        'android.permission.CAMERA',                'NSCameraUsageDescription'),
    ('photo library', 'android.permission.READ_MEDIA_IMAGES',     'NSPhotoLibraryUsageDescription'),
    ('location',      'android.permission.ACCESS_COARSE_LOCATION', 'NSLocationWhenInUseUsageDescription'),
):
    a_has = and_perm in manifest
    i_has = bool(plist.get(ios_key))
    print('  %-26s %-22s %-22s %s' % (
        label, 'declared' if a_has else 'MISSING', 'declared' if i_has else 'MISSING',
        'ok' if a_has == i_has else 'DIFFERENT'))
    if a_has != i_has:
        problems.append('%s is available on one platform and not the other' % label)

# Notifications come from the plugin's own manifest on Android and need no
# plist string on iOS, so there is nothing to compare - but the JS has to be
# able to reach the plugin on both, which is one code path either way.

# ── Deep links ───────────────────────────────────────────────────────
scheme_android = 'android:scheme="wayfinder"' in manifest
scheme_ios = any('wayfinder' in (t.get('CFBundleURLSchemes') or [])
                 for t in plist.get('CFBundleURLTypes', []))
print('\n  wayfinder:// scheme        %-22s %-22s %s' % (
    'declared' if scheme_android else 'MISSING',
    'declared' if scheme_ios else 'MISSING',
    'ok' if scheme_android == scheme_ios else 'DIFFERENT'))
if scheme_android != scheme_ios:
    problems.append('the wayfinder:// scheme is declared on only one platform')

# ── Price, which is the thing most likely to drift ───────────────────
#
# There is one PACKS list in store.js and both shells load the same file, so
# the two apps cannot disagree in code. What CAN disagree is what was typed
# into App Store Connect and Play Console. This prints the ids and prices so
# there is one place to check them against both dashboards.
store = read('store.js')
prefix = (re.search(r"STORE_PREFIX = '([^']+)'", store) or [None, ''])[1]
packs = re.findall(r"\{ slug: '([^']+)',[^}]*?name: '([^']+)',\s*\n\s*price: '([^']+)'"
                   r"(?:, blurb: '[^']*')?(?:, unreleased: (true))?", store)
# How many gems each pack actually holds, counted from the data rather than
# trusted from a flag. A pack with nothing in it must not be created on either
# store: an empty product is a refund request and it fails review.
gems = {}
try:
    _d = json.load(io.open('data/adventures.json', encoding='utf-8'))
    for _a in (_d['adventures'] if isinstance(_d, dict) else _d):
        if _a.get('hidden_gem') and _a.get('pack'):
            gems[_a['pack']] = gems.get(_a['pack'], 0) + 1
except Exception as e:
    notes.append('could not count gems: %s' % e)
gems['all'] = sum(gems.values())

print('\n  In-app purchases - one list, both stores. Set these price points in')
print('  BOTH App Store Connect and Play Console, in USD:\n')
print('  %-46s %-8s %-6s %s' % ('PRODUCT ID', 'PRICE', 'GEMS', 'STATUS'))
print('  ' + '-' * 72)
for slug, name, price, unreleased in packs:
    pid = prefix + slug.replace('-', '_')
    n = gems.get(slug, 0)
    status = ('do not create - empty' if n == 0
              else 'not yet' if unreleased else 'create in both')
    print('  %-46s %-8s %-6d %s' % (pid, price, n, status))
    if n and unreleased:
        notes.append('%s now holds %d gems - clear its unreleased flag in store.js '
                     'and create the product on both stores' % (slug, n))
if not packs:
    problems.append('could not read PACKS out of store.js - has its shape changed?')

# ── Report ───────────────────────────────────────────────────────────
print('\n' + '=' * 74)
if problems:
    print('  The two apps disagree:\n')
    for p in problems:
        print('    - %s' % p)
else:
    print('  The two apps agree everywhere this can check.')
for n in notes:
    print('    note: %s' % n)
print('=' * 74 + '\n')
sys.exit(1 if problems else 0)
