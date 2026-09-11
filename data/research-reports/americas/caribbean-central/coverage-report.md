# Caribbean and Central America coverage

Audited 2026-09-11 against every canonical `data/src/*.jsonl` file plus the primary-owned Greenland research batch. Required gem-only additions were recomputed with exact integer arithmetic: `max(0, (total - 5*gems + 3) // 4)`. No other Americas handoff batch existed when primary confirmed the baseline.

| Code | Country/territory | Baseline | Baseline gems | Added | Added gems | Final | Final gems | Gem % | Status |
|---|---|---:|---:|---:|---:|---:|---:|---:|---|
| GL | Greenland | 10 | 2 | 0 | 0 | 10 | 2 | 20.00% | meets minimum |
| GT | Guatemala | 20 | 0 | 5 | 5 | 25 | 5 | 20.00% | meets minimum |
| BZ | Belize | 14 | 0 | 4 | 4 | 18 | 4 | 22.22% | meets minimum |
| SV | El Salvador | 8 | 0 | 2 | 2 | 10 | 2 | 20.00% | meets minimum |
| HN | Honduras | 10 | 0 | 3 | 3 | 13 | 3 | 23.08% | meets minimum |
| NI | Nicaragua | 13 | 0 | 4 | 4 | 17 | 4 | 23.53% | meets minimum |
| CR | Costa Rica | 25 | 1 | 5 | 5 | 30 | 6 | 20.00% | meets minimum |
| PA | Panama | 16 | 0 | 4 | 4 | 20 | 4 | 20.00% | meets minimum |
| CU | Cuba | 20 | 0 | 5 | 5 | 25 | 5 | 20.00% | meets minimum |
| JM | Jamaica | 13 | 0 | 4 | 4 | 17 | 4 | 23.53% | meets minimum |
| HT | Haiti | 5 | 0 | 0 | 0 | 5 | 0 | 0.00% | EXCEPTION: no new travel invitations |
| DO | Dominican Republic | 12 | 0 | 3 | 3 | 15 | 3 | 20.00% | meets minimum |
| BS | Bahamas | 10 | 0 | 3 | 3 | 13 | 3 | 23.08% | meets minimum |
| PR | Puerto Rico | 13 | 1 | 2 | 2 | 15 | 3 | 20.00% | meets minimum |
| TT | Trinidad & Tobago | 8 | 0 | 2 | 2 | 10 | 2 | 20.00% | meets minimum |
| BB | Barbados | 8 | 1 | 1 | 1 | 9 | 2 | 22.22% | meets minimum |
| LC | Saint Lucia | 7 | 0 | 2 | 2 | 9 | 2 | 22.22% | meets minimum |
| GD | Grenada | 6 | 0 | 2 | 2 | 8 | 2 | 25.00% | meets minimum |
| VC | St Vincent & Grenadines | 5 | 0 | 2 | 2 | 7 | 2 | 28.57% | meets minimum |
| AG | Antigua & Barbuda | 6 | 0 | 2 | 2 | 8 | 2 | 25.00% | meets minimum |
| DM | Dominica | 7 | 0 | 2 | 2 | 9 | 2 | 22.22% | meets minimum |
| KN | St Kitts & Nevis | 5 | 0 | 2 | 2 | 7 | 2 | 28.57% | meets minimum |
| AW | Aruba | 6 | 0 | 2 | 2 | 8 | 2 | 25.00% | meets minimum |
| CW | Curacao | 6 | 0 | 2 | 2 | 8 | 2 | 25.00% | meets minimum |
| KY | Cayman Islands | 5 | 0 | 2 | 2 | 7 | 2 | 28.57% | meets minimum |
| TC | Turks & Caicos | 5 | 0 | 2 | 2 | 7 | 2 | 28.57% | meets minimum |
| VG | British Virgin Islands | 5 | 0 | 2 | 2 | 7 | 2 | 28.57% | meets minimum |
| VI | US Virgin Islands | 5 | 0 | 2 | 2 | 7 | 2 | 28.57% | meets minimum |
| BM | Bermuda | 7 | 0 | 2 | 2 | 9 | 2 | 22.22% | meets minimum |
| GP | Guadeloupe | 0 | 0 | 5 | 1 | 5 | 1 | 20.00% | meets minimum |
| MQ | Martinique | 0 | 0 | 5 | 1 | 5 | 1 | 20.00% | meets minimum |
| PM | St Pierre & Miquelon | 0 | 0 | 5 | 1 | 5 | 1 | 20.00% | meets minimum |

Greenland is intentionally untouched: its primary-owned 10-row starter already contains two gems (20%). New records have no IDs. Empty GP/MQ/PM receive balanced five-row launch sets with one gem each, rather than all-paid placeholders.

## Validation

- Exact-integer coverage recomputation found no remaining deficit outside the documented Haiti exception. This includes all exact-boundary 20.00% rows; no additions were made because of floating-point rounding.
- Canonical lint: 88 entries checked, 0 problems. The handoff has 88 unique addition keys and 88 matching unique provenance keys, with no missing provenance and no IDs on new rows.
- Automated HTTP GET audit on 2026-09-11: 68 unique provenance URLs; 66 returned HTTP 2xx/3xx, 2 returned HTTP 403, 0 returned 404/5xx and 0 timed out. The two 403 responses were INGUAT’s archaeological-parks directory and Discover Puerto Rico’s Hacienda Buena Vista page. Both were separately available to the research reader through indexed/fetched page content and were read for the cited claims; the 403 classification records automated-client restriction, not an unread source. Reachability is a transport check, not a substitute for source review.
