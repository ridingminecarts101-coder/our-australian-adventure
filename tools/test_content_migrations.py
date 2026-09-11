"""Protect country-code corrections from moving saved adventure IDs."""
import glob
import json
import os
import unittest

ROOT = os.path.dirname(os.path.dirname(os.path.abspath(__file__)))


class CountryAliasMigrationTests(unittest.TestCase):
    @classmethod
    def setUpClass(cls):
        with open(os.path.join(ROOT, 'data', 'ids.json'), encoding='utf-8') as handle:
            cls.ids = json.load(handle)['ids']
        cls.rows = []
        for path in glob.glob(os.path.join(ROOT, 'data', 'src', '*.jsonl')):
            with open(path, encoding='utf-8') as handle:
                cls.rows.extend(json.loads(line) for line in handle if line.strip())

    def test_vatican_aliases_keep_their_italy_ids(self):
        places = ('Papal Audience', "St Peter's Basilica", "St Peter's Square",
                  'Vatican Gardens', 'Vatican Museums', 'Vatican Necropolis')
        for place in places:
            self.assertEqual(self.ids['VA|' + place], self.ids['IT|' + place])
            self.assertFalse(any(row['country'] == 'IT' and row['place'] == place
                                 for row in self.rows))

    def test_faroe_saksun_keeps_its_denmark_id(self):
        self.assertEqual(self.ids['FO|Saksun'], self.ids['DK|Saksun'])
        self.assertFalse(any(row['country'] == 'DK' and row['place'] == 'Saksun'
                             for row in self.rows))

    def test_active_rows_still_have_unique_ids(self):
        active = [self.ids[key] for row in self.rows
                  if (key := f"{row['country']}|{row['place']}") in self.ids]
        self.assertEqual(len(active), len(set(active)))


if __name__ == '__main__':
    unittest.main()
