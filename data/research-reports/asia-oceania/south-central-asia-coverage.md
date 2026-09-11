# South/Central Asia coverage handoff — 2026-09-11

Equation used for each country: `x = ceil((existing_total - 5 * existing_gems) / 4)`. This is the exact gem-only addition count needed so `(existing_gems + x) / (existing_total + x) >= 20%`.

The canonical baseline was read from every `data/src/*.jsonl` file on 2026-09-11. The only current cross-team pending source batch affecting Asia/Oceania was `research-oceania-gems.jsonl`; it contains AU/NZ rows and does not overlap these country codes. No pending South/Central Asia handoff files existed when this worker began.

| Code | Existing total | Existing gems | Exact deficit | Added here | Final total | Final gems | Final ratio | Status |
|---|---:|---:|---:|---:|---:|---:|---:|---|
| IN | 51 | 2 | 11 | 11 | 62 | 13 | 20.97% | Meets minimum |
| NP | 20 | 1 | 4 | 4 | 24 | 5 | 20.83% | Meets minimum |
| BT | 10 | 0 | 3 | 3 | 13 | 3 | 23.08% | Meets minimum |
| BD | 9 | 0 | 3 | 3 | 12 | 3 | 25.00% | Meets minimum |
| LK | 20 | 0 | 5 | 5 | 25 | 5 | 20.00% | Meets minimum |
| MV | 9 | 1 | 1 | 1 | 10 | 2 | 20.00% | Meets minimum |
| PK | 14 | 1 | 3 | 3 | 17 | 4 | 23.53% | Meets arithmetic minimum; safety review required |
| AF | 4 | 0 | 1 | 0 | 4 | 0 | 0.00% | Documented safety exception; no travel content added |
| KZ | 10 | 0 | 3 | 3 | 13 | 3 | 23.08% | Meets minimum |
| UZ | 16 | 0 | 4 | 4 | 20 | 4 | 20.00% | Meets minimum |
| TM | 5 | 0 | 2 | 2 | 7 | 2 | 28.57% | Meets arithmetic minimum; access review required |
| KG | 10 | 0 | 3 | 3 | 13 | 3 | 23.08% | Meets minimum |
| TJ | 7 | 0 | 2 | 2 | 9 | 2 | 22.22% | Meets minimum |

Assigned-country aggregate: 185 existing rows and 5 existing gems (2.70%). This handoff adds 44 gem rows. The post-handoff aggregate is 229 rows and 49 gems (21.40%), with Afghanistan explicitly excepted rather than filled unsafely.

Asia pack impact for this assigned sub-pack: +44 paid `asia` rows. All additions are gem-only; existing IDs are untouched and new rows intentionally contain no `id` field.

Editorial review notes:

- PK descriptions say to reconsider travel and verify current conditions; the current Australian advice is not treated as permission to travel.
- TM descriptions require pre-arranged permission/routing; they do not imply open independent access.
- Seasonal and cost fields are conservative editorial classifications. Travellers must re-check live permits, closures, transport and operating details.
- All title/place strings were checked against canonical rows before drafting. No exact `(country, place)` collision was retained.
