# South America content handoff coverage

Audited 11 September 2026 (Australia/Sydney) against every current canonical `data/src/*.jsonl` row in `C:\Users\User\OneDrive\Desktop\our-australian-adventure`, including current research batches. The canonical checkout was read only.

The preservation-only lower bound for a country is `ceil((total - 5 × gems) / 4)` new gem rows. This follows from `(gems + additions) / (total + additions) >= 0.20` and does not delete or reclassify existing rows.

| Code | Baseline rows | Baseline gems | Exact lower bound | Added | Post rows | Post gems | Post gem rate | Status |
| --- | ---: | ---: | ---: | ---: | ---: | ---: | ---: | --- |
| AR | 40 | 1 | 9 | 9 | 49 | 10 | 20.41% | Meets |
| BO | 21 | 2 | 3 | 3 | 24 | 5 | 20.83% | Meets |
| BR | 43 | 2 | 9 | 9 | 52 | 11 | 21.15% | Meets |
| CL | 31 | 1 | 7 | 7 | 38 | 8 | 21.05% | Meets |
| CO | 28 | 1 | 6 | 6 | 34 | 7 | 20.59% | Meets; regional security checks retained |
| EC | 21 | 0 | 6 | 6 | 27 | 6 | 22.22% | Meets |
| PE | 42 | 2 | 8 | 8 | 50 | 10 | 20.00% | Meets |
| PY | 7 | 0 | 2 | 2 | 9 | 2 | 22.22% | Meets |
| UY | 12 | 0 | 3 | 3 | 15 | 3 | 20.00% | Meets |
| VE | 7 | 0 | 2 | 0 | 7 | 0 | 0.00% | Explicit access/safety exception |
| GY | 6 | 0 | 2 | 2 | 8 | 2 | 25.00% | Meets |
| SR | 5 | 0 | 2 | 1 | 6 | 1 | 16.67% | Explicit evidence/access exception |
| GF | 5 | 0 | 2 | 2 | 7 | 2 | 28.57% | Meets |
| FK | 5 | 0 | 2 | 2 | 7 | 2 | 28.57% | Meets |

## Pack result

The canonical South America pack baseline is 273 rows with 9 gems (3.30%). This handoff adds 60 source-backed gem rows, producing 333 rows with 69 gems (20.72%). The pack clears the 20% requirement even with the two documented country exceptions.

## Validation

- App `tools/lint_source.py`: 60 entries, 13 countries, 60 gems, 0 problems.
- Additions/provenance cardinality: 60/60.
- Internal `(country, place)` duplicate keys: 0.
- Collisions with every current canonical `(country, place)` key: 0.
- New records contain no IDs; all coordinates remain null; every gem uses `south-america`.
- No canonical, generated, native, SQL, billing or release files were edited.

Completion is honest rather than nominal: 12 of 14 owned codes reach at least 20%; Venezuela and Suriname remain documented exceptions. The continent pack reaches 20.72%.
