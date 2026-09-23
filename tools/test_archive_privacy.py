"""Reject undisclosed SDK collection and stale main-app manifests."""
import copy
import plistlib
import tempfile
import unittest
from pathlib import Path
from audit_archive_privacy import audit


class ArchivePrivacyTests(unittest.TestCase):
    def make_archive(self, app, declared):
        (app / 'PrivacyInfo.xcprivacy').write_bytes(declared.read_bytes())
        source_info = declared.with_name('Info.plist')
        (app / 'Info.plist').write_bytes(source_info.read_bytes())

    def test_archive_disclosures(self):
        declared = Path(__file__).resolve().parents[1] / 'ios/App/App/PrivacyInfo.xcprivacy'
        source = plistlib.loads(declared.read_bytes())
        with tempfile.TemporaryDirectory() as directory:
            app = Path(directory)
            self.make_archive(app, declared)
            sdk = app / 'Frameworks/Purchases.framework/PrivacyInfo.xcprivacy'
            sdk.parent.mkdir(parents=True)
            sdk.write_bytes(plistlib.dumps({'NSPrivacyTracking': False}))
            self.assertEqual(audit(app, declared)['issues'], [])
            sdk.write_bytes(plistlib.dumps({'NSPrivacyTracking': True}))
            self.assertTrue(any('tracking declaration' in v for v in audit(app, declared)['issues']))
            sdk.write_bytes(plistlib.dumps({'NSPrivacyCollectedDataTypes': [{
                'NSPrivacyCollectedDataType': 'NSPrivacyCollectedDataTypePhotosorVideos',
                'NSPrivacyCollectedDataTypePurposes': ['NSPrivacyCollectedDataTypePurposeAnalytics'],
            }]}))
            self.assertTrue(any('undeclared data' in v for v in audit(app, declared)['issues']))
            modified = copy.deepcopy(source)
            modified['NSPrivacyTracking'] = True
            (app / 'PrivacyInfo.xcprivacy').write_bytes(plistlib.dumps(modified))
            with self.assertRaisesRegex(ValueError, 'differs'):
                audit(app, declared)

    def test_required_purpose_strings_and_background_location(self):
        declared = Path(__file__).resolve().parents[1] / 'ios/App/App/PrivacyInfo.xcprivacy'
        source_info = plistlib.loads(declared.with_name('Info.plist').read_bytes())
        cases = (
            ('missing', 'NSLocationAlwaysAndWhenInUseUsageDescription', None,
             'missing or blank NSLocationAlwaysAndWhenInUseUsageDescription'),
            ('blank', 'NSCameraUsageDescription', '   ',
             'missing or blank NSCameraUsageDescription'),
            ('stale', 'NSLocationWhenInUseUsageDescription', 'Old purpose text',
             'differs from reviewed source for NSLocationWhenInUseUsageDescription'),
        )
        for name, key, value, expected_issue in cases:
            with self.subTest(name=name), tempfile.TemporaryDirectory() as directory:
                app = Path(directory)
                self.make_archive(app, declared)
                archived_info = copy.deepcopy(source_info)
                if value is None:
                    archived_info.pop(key, None)
                else:
                    archived_info[key] = value
                (app / 'Info.plist').write_bytes(plistlib.dumps(archived_info))
                self.assertTrue(any(expected_issue in issue
                                    for issue in audit(app, declared)['issues']))

        with tempfile.TemporaryDirectory() as directory:
            app = Path(directory)
            self.make_archive(app, declared)
            archived_info = copy.deepcopy(source_info)
            archived_info['UIBackgroundModes'] = ['location']
            (app / 'Info.plist').write_bytes(plistlib.dumps(archived_info))
            self.assertTrue(any('enables background location mode' in issue
                                for issue in audit(app, declared)['issues']))


if __name__ == '__main__':
    unittest.main()
