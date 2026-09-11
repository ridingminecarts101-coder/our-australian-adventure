# East and Southeast Asia coverage handoff

Snapshot and research access date: 2026-09-11. Baseline is the then-current canonical `data/src/*.jsonl`, including the already-integrated Asia deep/JP/SEA batches. This handoff does not modify the canonical checkout.

For a populated country with baseline total `n` and baseline gems `g`, the minimum gem-only top-up is `max(0, ceil((n - 5g) / 4))`. This solves `(g + x) / (n + x) >= 0.20` using the final count, not the starting count.

| Code | Baseline total | Baseline gems | Exact minimum | Added here | Final total | Final gems | Final gem % | Status |
|---|---:|---:|---:|---:|---:|---:|---:|---|
| JP | 83 | 3 | 17 | 17 | 100 | 20 | 20.00% | Meets |
| CN | 47 | 2 | 10 | 10 | 57 | 12 | 21.05% | Meets |
| KR | 25 | 1 | 5 | 5 | 30 | 6 | 20.00% | Meets |
| KP | 0 | 0 | starter exception | 0 | 0 | 0 | n/a | Restricted-access exception |
| TW | 18 | 0 | 5 | 5 | 23 | 5 | 21.74% | Meets |
| HK | 13 | 0 | 4 | 4 | 17 | 4 | 23.53% | Meets |
| MO | 6 | 0 | 2 | 2 | 8 | 2 | 25.00% | Meets |
| MN | 13 | 0 | 4 | 4 | 17 | 4 | 23.53% | Meets |
| TH | 34 | 1 | 8 | 8 | 42 | 9 | 21.43% | Meets |
| VN | 29 | 0 | 8 | 8 | 37 | 8 | 21.62% | Meets |
| KH | 16 | 1 | 3 | 3 | 19 | 4 | 21.05% | Meets |
| LA | 12 | 0 | 3 | 3 | 15 | 3 | 20.00% | Meets |
| MM | 12 | 0 | 3 | 0 | 12 | 0 | 0.00% | Do-not-travel exception |
| MY | 24 | 0 | 6 | 6 | 30 | 6 | 20.00% | Meets |
| SG | 13 | 2 | 1 | 1 | 14 | 3 | 21.43% | Meets |
| BN | 5 | 0 | 2 | 2 | 7 | 2 | 28.57% | Meets |
| ID | 49 | 4 | 8 | 8 | 57 | 12 | 21.05% | Meets |
| TL | 4 | 0 | 1 | 1 | 5 | 1 | 20.00% | Meets |
| PH | 25 | 0 | 7 | 7 | 32 | 7 | 21.875% | Meets |

Assigned-country aggregate: baseline 428 adventures / 14 gems (3.27%); after this handoff 522 / 108 (20.69%). This aggregate includes the honest KP and MM exceptions.

Whole Asia compatibility pack: baseline 613 adventures / 19 gems (3.10%); with only this worker's additions 707 / 113 (15.98%). The whole pack is not yet at 20% because South/Central Asia is assigned to another worker. This report makes no claim about that worker's unmerged output.

Deliverables contain 94 source rows in 17 countries and 94 exactly matched provenance rows. Every new row is a gem in pack `asia`; no new row has an ID.
