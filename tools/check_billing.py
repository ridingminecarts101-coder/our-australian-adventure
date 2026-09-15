# -*- coding: utf-8 -*-
"""Check billing/auth invariants and the native store-release prerequisites."""
import argparse
import io
import os
import plistlib
import re
import subprocess
import sys

ROOT = os.path.dirname(os.path.dirname(os.path.abspath(__file__)))


def read(path):
    with io.open(os.path.join(ROOT, path), encoding='utf-8') as handle:
        return handle.read()


def main():
    parser = argparse.ArgumentParser()
    parser.add_argument('--store-release', action='store_true',
                        help='also require live public SDK keys and sale-safe preview guards')
    parser.add_argument('--platform', choices=('android', 'ios', 'all'), default='all',
                        help='platform key required by --store-release (default: all)')
    parser.add_argument('--config-path', default='config.js',
                        help='config to validate, relative to the repository root')
    args = parser.parse_args()
    problems = []

    store = read('store.js')
    app = read('app.js')
    config_path = os.path.realpath(os.path.join(ROOT, args.config_path))
    if os.path.commonpath((os.path.realpath(ROOT), config_path)) != os.path.realpath(ROOT):
        parser.error('--config-path must remain inside the repository')
    with io.open(config_path, encoding='utf-8') as handle:
        config = handle.read()
    project = read(os.path.join('ios', 'App', 'App.xcodeproj', 'project.pbxproj'))
    privacy_path = os.path.join(ROOT, 'ios', 'App', 'App', 'PrivacyInfo.xcprivacy')

    expected = {'all': 'AUD $14.99'}
    expected.update({slug: 'AUD $2.99' for slug in (
        'oceania', 'europe', 'north-america', 'asia', 'middle-east', 'south-america', 'africa')})
    prices = dict(re.findall(r"slug: '([^']+)'[\s\S]*?price: '([^']+)'", store))
    if prices != expected:
        problems.append('the one-time product catalogue is not the confirmed AUD 14.99 / AUD 2.99 set')
    if store.count("type: 'NON_SUBSCRIPTION'") != 2 or 'productCategory:' in store:
        problems.append('RevenueCat products are not requested as one-time purchases')
    if 'appUserID: runId' not in store or 'Billing.init(userId)' not in app:
        problems.append('RevenueCat is not tied to the authenticated Supabase user id')
    if ('Billing.signOut()' not in app or 'async signOut()' not in store
            or 'await P.logOut()' in store
            or 'alreadyConfigured && P.logIn' not in store):
        problems.append('custom-ID billing does not clear local access and switch identified customers without anonymous logout')
    if '`${LS_ENTITLEMENTS}.${ownerId}`' not in store or '_generation' not in store:
        problems.append('billing cache and asynchronous results are not account-scoped')
    if 'allPurchasedProductIdentifiers' in store:
        problems.append('historical/inactive product identifiers can influence billing access')
    if ('info.entitlements && info.entitlements.active' not in store
            or '_acceptCustomerInfo' not in store):
        problems.append('billing access is not derived from active RevenueCat entitlements')
    if ('addCustomerInfoUpdateListener' not in store
            or 'removeCustomerInfoUpdateListener' not in store):
        problems.append('RevenueCat CustomerInfo listener lifecycle is missing')
    if ('async foreground()' not in store
            or 'invalidateCustomerInfoCache' not in store):
        problems.append('foreground billing refresh is missing')
    if 'async deleteLocalOwner(ownerId)' not in store:
        problems.append('successful account deletion cannot clear only that owner billing cache')
    if ('if (onNativePlatform()) return false;' not in store
            or 'location.hostname' not in store):
        problems.append('developer preview is not restricted to local browser development')
    if (store.count('if (onNativePlatform()') < 3
            or "if (!this._key()) return { ok: false" not in store
            or 'if (onNativePlatform() && !this.native)' not in store):
        problems.append('native buy/restore with a missing SDK key does not fail closed')

    try:
        with open(privacy_path, 'rb') as handle:
            privacy = plistlib.load(handle)
        accessed = privacy.get('NSPrivacyAccessedAPITypes', [])
        reasons = [item for item in accessed
                   if item.get('NSPrivacyAccessedAPIType') == 'NSPrivacyAccessedAPICategoryUserDefaults']
        if not reasons or 'CA92.1' not in reasons[0].get('NSPrivacyAccessedAPITypeReasons', []):
            problems.append('iOS privacy manifest lacks the Preferences/UserDefaults CA92.1 reason')
        if privacy.get('NSPrivacyTracking') is not False:
            problems.append('iOS privacy manifest does not declare tracking false')
        collected = {item.get('NSPrivacyCollectedDataType')
                     for item in privacy.get('NSPrivacyCollectedDataTypes', [])}
        collected_rows = {item.get('NSPrivacyCollectedDataType'): item
                          for item in privacy.get('NSPrivacyCollectedDataTypes', [])}
        required_data = {
            'NSPrivacyCollectedDataTypeEmailAddress',
            'NSPrivacyCollectedDataTypeUserID',
            'NSPrivacyCollectedDataTypeName',
            'NSPrivacyCollectedDataTypeProductInteraction',
            'NSPrivacyCollectedDataTypeOtherUserContent',
            'NSPrivacyCollectedDataTypePurchaseHistory',
            'NSPrivacyCollectedDataTypePreciseLocation',
        }
        if not required_data.issubset(collected):
            problems.append('iOS privacy manifest omits account or user-content collection')
        if 'NSPrivacyCollectedDataTypePhotosorVideos' in collected:
            problems.append('iOS privacy manifest still declares photo collection despite device-local-only current capture and zero production photo rows')
        for data_type in ('NSPrivacyCollectedDataTypeUserID',
                          'NSPrivacyCollectedDataTypePurchaseHistory',
                          'NSPrivacyCollectedDataTypePreciseLocation'):
            item = collected_rows.get(data_type, {})
            purposes = set(item.get('NSPrivacyCollectedDataTypePurposes', []))
            provider_purpose = ('NSPrivacyCollectedDataTypePurposeOther'
                                if data_type == 'NSPrivacyCollectedDataTypePreciseLocation'
                                else 'NSPrivacyCollectedDataTypePurposeAnalytics')
            if (item.get('NSPrivacyCollectedDataTypeLinked') is not True
                    or item.get('NSPrivacyCollectedDataTypeTracking') is not False
                    or not {'NSPrivacyCollectedDataTypePurposeAppFunctionality',
                            provider_purpose}.issubset(purposes)):
                problems.append('%s disclosure lacks linked app-functionality/provider-purpose, non-tracking settings'
                                % data_type)
    except (OSError, plistlib.InvalidFileException) as error:
        problems.append('iOS privacy manifest is missing or invalid: %s' % error)
    if project.count('PrivacyInfo.xcprivacy in Resources') != 2:
        problems.append('iOS privacy manifest is not wired exactly once into the app resources')

    # Public RevenueCat SDK keys may ship. Secret/service credentials may not.
    secret_markers = re.findall(r'(?i)(?:sk_live_|rc_secret_|private[_-]?key\s*[:=])', config)
    if secret_markers:
        problems.append('config.js appears to contain a private or secret key')

    if args.store_release:
        android = re.search(r"android:\s*'([^']*)'", config)
        ios = re.search(r"ios:\s*'([^']*)'", config)
        if args.platform in ('android', 'all') and (not android or not re.fullmatch(r'goog_[A-Za-z0-9]{10,}', android.group(1))):
            problems.append('Android RevenueCat public SDK key is not configured')
        if args.platform in ('ios', 'all') and (not ios or not re.fullmatch(r'appl_[A-Za-z0-9]{10,}', ios.group(1))):
            problems.append('iOS RevenueCat public SDK key is not configured')

    node = subprocess.run(['node', os.path.join(ROOT, 'tools', 'test_billing.js')], cwd=ROOT)
    if node.returncode:
        problems.append('mocked billing behaviour tests failed')

    if problems:
        print('\n  Billing/release guard found:')
        for problem in problems:
            print('    - ' + problem)
        print()
        return 1
    print('  billing/release guard: static and mocked checks passed')
    return 0


if __name__ == '__main__':
    sys.exit(main())
