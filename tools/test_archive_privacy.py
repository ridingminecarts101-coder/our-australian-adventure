"""Reject undisclosed SDK collection and stale main-app manifests."""
import copy
import plistlib
import tempfile
import unittest
from pathlib import Path
from audit_archive_privacy import audit


class ArchivePrivacyTests(unittest.TestCase):
    def test_archive_disclosures(self):
        declared = Path(__file__).resolve().parents[1] / 'ios/App/App/PrivacyInfo.xcprivacy'
        source = plistlib.loads(declared.read_bytes())
        with tempfile.TemporaryDirectory() as directory:
            app = Path(directory)
            (app / 'PrivacyInfo.xcprivacy').write_bytes(declared.read_bytes())
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


if __name__ == '__main__':
    unittest.main()
