"""Inventory actual bundled privacy manifests; never include signing or user data."""
import argparse
import hashlib
import json
import plistlib
from pathlib import Path


REQUIRED_PURPOSE_STRINGS = (
    'NSCameraUsageDescription',
    'NSPhotoLibraryUsageDescription',
    'NSLocationWhenInUseUsageDescription',
    'NSLocationAlwaysAndWhenInUseUsageDescription',
)


def audit(app_path, declared_path):
    expected = plistlib.loads(declared_path.read_bytes())
    reviewed_info_path = declared_path.with_name('Info.plist')
    archived_info_path = app_path / 'Info.plist'
    if not reviewed_info_path.is_file():
        raise ValueError('Reviewed source Info.plist is missing')
    if not archived_info_path.is_file():
        raise ValueError('Archive has no main-app Info.plist')
    reviewed_info = plistlib.loads(reviewed_info_path.read_bytes())
    archived_info = plistlib.loads(archived_info_path.read_bytes())
    declared = {row['NSPrivacyCollectedDataType']: row
                for row in expected.get('NSPrivacyCollectedDataTypes', [])}
    paths = sorted(app_path.rglob('PrivacyInfo.xcprivacy'))
    if not paths:
        raise ValueError('Archive has no privacy manifests')
    app_manifest = app_path / 'PrivacyInfo.xcprivacy'
    if not app_manifest.is_file() or plistlib.loads(app_manifest.read_bytes()) != expected:
        raise ValueError('Main archived privacy manifest differs from reviewed source')
    inventory, issues = [], []
    for key in REQUIRED_PURPOSE_STRINGS:
        archived_value = archived_info.get(key)
        reviewed_value = reviewed_info.get(key)
        if not isinstance(reviewed_value, str) or not reviewed_value.strip():
            issues.append('Reviewed source Info.plist has missing or blank ' + key)
        if not isinstance(archived_value, str) or not archived_value.strip():
            issues.append('Archived Info.plist has missing or blank ' + key)
        elif archived_value != reviewed_value:
            issues.append('Archived Info.plist differs from reviewed source for ' + key)
    background_modes = archived_info.get('UIBackgroundModes', [])
    if isinstance(background_modes, str):
        background_modes = [background_modes]
    if 'location' in background_modes:
        issues.append('Archived Info.plist enables background location mode')
    for path in paths:
        raw = path.read_bytes()
        manifest = plistlib.loads(raw)
        relative = path.relative_to(app_path).as_posix()
        inventory.append({'path': relative, 'sha256': hashlib.sha256(raw).hexdigest(),
                          'manifest': manifest})
        if manifest.get('NSPrivacyTracking') is True or manifest.get('NSPrivacyTrackingDomains'):
            issues.append(relative + ': tracking declaration needs review')
        for row in manifest.get('NSPrivacyCollectedDataTypes', []):
            kind = row.get('NSPrivacyCollectedDataType')
            app_row = declared.get(kind)
            if not app_row:
                issues.append(relative + ': undeclared data category ' + str(kind))
                continue
            if row.get('NSPrivacyCollectedDataTypeTracking') is True:
                issues.append(relative + ': tracking data category ' + kind)
            if row.get('NSPrivacyCollectedDataTypeLinked') is True and not app_row.get('NSPrivacyCollectedDataTypeLinked'):
                issues.append(relative + ': linked-data mismatch ' + kind)
            extra = set(row.get('NSPrivacyCollectedDataTypePurposes', [])) - set(app_row.get('NSPrivacyCollectedDataTypePurposes', []))
            if extra:
                issues.append(relative + ': additional purposes for ' + kind + ': ' + ', '.join(sorted(extra)))
    return {'manifests': inventory, 'issues': issues,
            'scope': 'Bundled manifest inventory, not a network audit or Apple acceptance guarantee.'}


def main():
    parser = argparse.ArgumentParser()
    parser.add_argument('--app', type=Path, required=True)
    parser.add_argument('--declared', type=Path, default=Path('ios/App/App/PrivacyInfo.xcprivacy'))
    parser.add_argument('--output', type=Path, required=True)
    args = parser.parse_args()
    result = audit(args.app, args.declared)
    args.output.parent.mkdir(parents=True, exist_ok=True)
    args.output.write_text(json.dumps(result, indent=2) + '\n', encoding='utf-8')
    print('Bundled privacy manifests:', len(result['manifests']), '; review findings:', len(result['issues']))
    for issue in result['issues']:
        print(issue)
    return 1 if result['issues'] else 0


if __name__ == '__main__':
    raise SystemExit(main())
