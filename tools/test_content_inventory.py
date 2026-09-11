"""Boundary checks for the exact 20% content-planning arithmetic."""
import os
import sys
import unittest

sys.path.insert(0, os.path.dirname(os.path.abspath(__file__)))
from content_inventory import UN_STATE_CODES, additions_needed  # noqa: E402


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


if __name__ == '__main__':
    unittest.main()
