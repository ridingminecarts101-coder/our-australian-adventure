# South and east Europe coverage

Baseline is the exact canonical `data/src/*.jsonl` state read on 2026-09-11. Proposed counts include `additions.jsonl` but do not assign IDs.

| Code | Baseline rows | Baseline gems | Added rows | Added gems | Proposed rows | Proposed gems | Proposed share |
|---|---:|---:|---:|---:|---:|---:|---:|
| ES | 64 | 5 | 10 | 10 | 74 | 15 | 20.3% |
| PT | 27 | 1 | 6 | 6 | 33 | 7 | 21.2% |
| IT | 81 | 6 | 13 | 13 | 94 | 19 | 20.2% |
| PL | 24 | 0 | 6 | 6 | 30 | 6 | 20.0% |
| CZ | 20 | 0 | 5 | 5 | 25 | 5 | 20.0% |
| SK | 12 | 0 | 3 | 3 | 15 | 3 | 20.0% |
| HU | 20 | 1 | 4 | 4 | 24 | 5 | 20.8% |
| SI | 16 | 1 | 3 | 3 | 19 | 4 | 21.1% |
| HR | 22 | 0 | 6 | 6 | 28 | 6 | 21.4% |
| BA | 12 | 1 | 2 | 2 | 14 | 3 | 21.4% |
| RS | 12 | 0 | 3 | 3 | 15 | 3 | 20.0% |
| ME | 12 | 0 | 3 | 3 | 15 | 3 | 20.0% |
| XK | 0 | 0 | 10 | 3 | 10 | 3 | 30.0% |
| MK | 9 | 0 | 3 | 3 | 12 | 3 | 25.0% |
| AL | 14 | 0 | 4 | 4 | 18 | 4 | 22.2% |
| GR | 40 | 4 | 5 | 5 | 45 | 9 | 20.0% |
| BG | 15 | 0 | 4 | 4 | 19 | 4 | 21.1% |
| RO | 22 | 2 | 3 | 3 | 25 | 5 | 20.0% |
| MD | 6 | 0 | 2 | 2 | 8 | 2 | 25.0% |
| UA | 8 | 0 | 0 | 0 | 8 | 0 | 0.0% |
| BY | 4 | 0 | 0 | 0 | 4 | 0 | 0.0% |
| RU | 12 | 0 | 0 | 0 | 12 | 0 | 0.0% |
| MT | 11 | 0 | 3 | 3 | 14 | 3 | 21.4% |
| AD | 6 | 0 | 2 | 2 | 8 | 2 | 25.0% |
| MC | 6 | 0 | 2 | 2 | 8 | 2 | 25.0% |
| SM | 5 | 0 | 2 | 2 | 7 | 2 | 28.6% |

The 23 countries receiving additions all reach at least 20%. Kosovo deliberately has seven core entries and three genuinely less-visited entries, rather than a gem-only starter set. UA, BY and RU are documented safety exceptions in `exceptions.md`; forcing six leisure additions merely to satisfy a ratio would be irresponsible while official advice is “do not travel”.

## Thin admin-region audit

“Thin” means exactly one proposed row under the current literal `admin1` label. This is a diagnostic, not a reason to add filler.

| Code | Distinct admin1 labels | Thin labels | Notes |
|---|---:|---:|---|
| ES | 18 | 1 | Castilla-La Mancha |
| PT | 8 | 1 | Porto and North |
| IT | 21 | 3 | Aosta Valley, Calabria, Molise |
| PL | 12 | 5 | Includes a likely duplicate taxonomy: `Kuyavia-Pomerania` / `Kuyavian-Pomeranian` |
| CZ | 12 | 5 | Central Bohemia, Liberec, Moravia, Plzen, Ústí nad Labem |
| SK | 8 | 3 | Includes `Banska Bystrica` / `Banská Bystrica` normalization split |
| HU | 10 | 4 | Baranya, Borsod-Abaúj-Zemplén, Gyor-Moson-Sopron, Hajdu-Bihar |
| SI | 8 | 3 | Carinthia, Kočevje, Savinja |
| HR | 9 | 3 | Karlovac, Zagreb, Zagreb County |
| BA | 5 | 1 | Republika Srpska |
| RS | 10 | 7 | Broad national spread, mostly one entry per district |
| ME | 8 | 3 | Kolasin, Niksic, Plav |
| XK | 7 | 6 | Launch set intentionally spreads beyond Prizren; deepen after usage feedback |
| MK | 8 | 6 | Broad national spread, mostly one entry per region |
| AL | 12 | 8 | Includes likely `Kukes` / `Kukës` normalization split |
| GR | 10 | 0 | No thin label |
| BG | 12 | 8 | Broad spread, mostly one entry per province |
| RO | 10 | 6 | Brașov, Bucovina, Caraș-Severin, Constanta, Danube Delta, Gorj |
| MD | 6 | 5 | Small baseline; additions avoid duplicating Chisinau |
| UA | 5 | 4 | Safety exception; do not pad |
| BY | 3 | 2 | Safety exception; do not pad |
| RU | 9 | 7 | Safety exception; do not pad |
| MT | 3 | 1 | Comino |
| AD | 3 | 2 | La Massana, Ordino |
| MC | 1 | 0 | City-state label is appropriate |
| SM | 3 | 2 | Borgo Maggiore, City of San Marino |

Recommended taxonomy cleanup is a separate, ID-preserving normalization pass. It should not merge distinct adventures or change `(country, place)` keys.
