"""Boundary checks for the exact 20% content-planning arithmetic."""
import os
import sys
import unittest

sys.path.insert(0, os.path.dirname(os.path.abspath(__file__)))
import check_quality  # noqa: E402
from content_inventory import (UN_STATE_CODES, additions_needed,  # noqa: E402
                               inventory_for)


class AdditionsNeededTests(unittest.TestCase):
    def test_zero_gems_uses_exact_integer_boundary(self):
        self.assertEqual(additions_needed(12, 0), 3)
        self.assertEqual(additions_needed(13, 0), 4)

    def test_existing_gems_count_toward_target(self):
        self.assertEqual(additions_needed(12, 2), 1)
        self.assertEqual(additions_needed(12, 3), 0)

    def test_empty_and_exact_twenty_percent_need_nothing(self):
        self.assertEqual(additions_needed(0, 0), 0)
        self.assertEqual(additions_needed(50, 10), 0)

    def test_sovereign_denominator_is_un_193_plus_two_observers(self):
        self.assertEqual(len(UN_STATE_CODES), 195)
        self.assertIn('PS', UN_STATE_CODES)
        self.assertIn('VA', UN_STATE_CODES)
        self.assertNotIn('XK', UN_STATE_CODES)

    def test_inventory_excludes_paused_rows_from_value_and_ratio(self):
        countries = {'AA': ('Alpha', 'Europe', 0, 0)}
        rows = [
            {'country': 'AA', 'admin1': 'North', 'hidden_gem': False},
            {'country': 'AA', 'admin1': 'South', 'hidden_gem': True},
            {'country': 'AA', 'admin1': 'South', 'hidden_gem': True,
             'availability': {'status': 'unavailable'}},
        ]
        item = inventory_for(rows, countries, {})[0]
        self.assertEqual(item['entries'], 2)
        self.assertEqual(item['stored_entries'], 3)
        self.assertEqual(item['paused_entries'], 1)
        self.assertEqual(item['gems'], 1)
        self.assertEqual(item['gem_percent'], 50)
        self.assertEqual(item['minimum_gem_additions'], 0)

    def test_quality_scopes_match_visible_navigation(self):
        # Fiji has five sourced subdivisions, so the UI routes straight to the
        # country catalogue and its internal labels form one quality scope.
        self.assertEqual(check_quality.quality_scope(
            {'country': 'FJ', 'admin1': 'Central Division'}), ('FJ', None))
        # Barbados has a subdivision screen, but its old country-name value is
        # an Everything-only placeholder rather than a parish tile.
        self.assertIsNone(check_quality.quality_scope(
            {'country': 'BB', 'admin1': 'Barbados'}))
        self.assertEqual(check_quality.quality_scope(
            {'country': 'BB', 'admin1': 'Saint Andrew'}), ('BB', 'Saint Andrew'))
        self.assertIsNone(check_quality.quality_scope(
            {'country': 'AU', 'admin1': 'AUS'}))
        self.assertEqual(check_quality.quality_scope(
            {'country': 'AU', 'admin1': 'ACT'}), ('AU', 'ACT'))

    def test_thin_visible_subdivision_is_planning_note_not_release_failure(self):
        sample = []
        for index in range(25):
            sample.append({'country': 'BB', 'admin1': 'Saint Andrew' if index < 2 else 'Saint Michael'})
        check_quality.findings.clear()
        check_quality.check_region_parity(sample)
        thin = [finding for finding in check_quality.findings
                if finding[1] == 'thin visible subdivisions']
        self.assertEqual(len(thin), 1)
        self.assertEqual(thin[0][0], 'note')
        self.assertIn('BB/Saint Andrew: 2', thin[0][3])

    def test_do_not_travel_gem_shortfall_stays_visible_without_becoming_filler_quota(self):
        check_quality.findings.clear()
        check_quality.check_gem_coverage([
            {'country': 'AF', 'continent': 'Asia', 'hidden_gem': False},
            {'country': 'FJ', 'continent': 'Oceania', 'hidden_gem': False},
        ])
        held = [f for f in check_quality.findings
                if f[1] == 'safety-held country gem coverage']
        ordinary = [f for f in check_quality.findings
                    if f[1] == 'country gem coverage']
        self.assertEqual(held[0][0], 'note')
        self.assertTrue(any(line.startswith('AF:') for line in held[0][3]))
        self.assertTrue(any(line.startswith('FJ:') for line in ordinary[0][3]))

    def test_quality_ratio_uses_active_rows_only(self):
        check_quality.findings.clear()
        check_quality.check_gem_coverage([
            {'country': 'FJ', 'continent': 'Oceania', 'hidden_gem': False},
            {'country': 'FJ', 'continent': 'Oceania', 'hidden_gem': True,
             'availability': {'status': 'unavailable'}},
        ])
        ordinary = next(f for f in check_quality.findings
                        if f[1] == 'country gem coverage')
        self.assertTrue(any(line.startswith('FJ: 0/1;') for line in ordinary[3]))

    def test_unknown_cost_is_neither_cheap_nor_proven_expensive(self):
        rows = [{'country': 'FJ', 'admin1': 'Central Division',
                 'difficulty': 1, 'cost': None} for _ in range(6)]
        check_quality.findings.clear()
        check_quality.check_accessibility(rows)
        self.assertFalse(any(f[1] == 'nothing cheap' for f in check_quality.findings))
        unknown = next(f for f in check_quality.findings if f[1] == 'unknown access cost')
        self.assertIn('FJ/Everything: 6/6 prices unknown', unknown[3])


if __name__ == '__main__':
    unittest.main()
