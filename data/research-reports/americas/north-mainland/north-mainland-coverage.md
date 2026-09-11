# North America mainland coverage report

Accessed and prepared: 2026-09-11. Canonical checkout was read-only.

| Country | Baseline total | Baseline gems | Added gems | Result total | Result gems | Result ratio | Minimum met |
|---|---:|---:|---:|---:|---:|---:|---|
| United States (US) | 448 | 57 | 55 | 503 | 112 | 22.27% | yes |
| Canada (CA) | 88 | 13 | 9 | 97 | 22 | 22.68% | yes |
| Mexico (MX) | 52 | 4 | 9 | 61 | 13 | 21.31% | yes |

Exact non-destructive deficit formula: smallest integer `n` satisfying `(gems+n)/(total+n) >= 0.20`. The true minimum deficits are US 41, Canada 6 and Mexico 8.

This quality-led batch intentionally carries a modest buffer above the floor: US adds 55 (14 above minimum), Canada adds 9 (3 above minimum), and Mexico adds 9 (1 above minimum). These are target/buffer additions, not the exact deficits. Resulting ratios remain within the brief’s preferred 20–25% range.

All additions use no `id`, preserve canonical IDs, use `pack: north-america`, and retain null coordinates. Exact `(country, place)` pairs were compared with all current `data/src/*.jsonl` rows.

Semantic duplicate review compared normalised title/place tokens against every canonical row in the same country. The rejected Gila Cliff Dwellings subactivity was removed and replaced with Quarai Spanish Corral Trail. Two automated name-similarity flags were manually cleared: Great Kobuk Sand Dunes is an Arctic Alaska fly-in site, not Colorado’s canonical Great Sand Dunes; Florissant’s Petrified Forest Loop is a Colorado fossil-stump trail, not Arizona’s canonical Petrified Forest National Park.
