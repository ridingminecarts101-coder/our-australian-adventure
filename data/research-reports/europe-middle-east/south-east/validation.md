# Validation

Validated on 2026-09-11 against the exact canonical `data/src/*.jsonl` and `data/ids.json` state, plus all visible in-flight JSONL under `content-handoff`.

## Results

- `additions.jsonl`: 104 valid JSON objects, 104 unique `(country, place)` keys, 104 unique case-folded `(country, title)` keys.
- `provenance.jsonl`: 104 valid JSON objects and 104 unique `(country, place)` keys.
- Provenance join: 0 missing records, 0 orphan records, 0 duplicate provenance keys.
- Dates: all 104 additions use `verified_at: 2026-09-11`; all 104 provenance records use `accessed: 2026-09-11`.
- IDs: 0 proposed rows contain an `id` field. Frozen IDs remain build-owned.
- Canonical collision scan: 0 place collisions and 0 case-folded title collisions.
- Visible handoff collision scan: 0 place/title collisions outside this batch, including the retained GI set.
- Gem evidence: all 97 rows marked `hidden_gem: true` have a non-empty rationale on the exact matching provenance record; all 97 rationales are distinct. Each states a specific small-settlement, specialist collection, controlled-access, named-route, local-tradition or precise natural-feature reason. None relies only on being outside a capital.
- Provenance sources: all records point to an official national/local tourism organisation, site administration or government source opened directly and read on 2026-09-11. No provenance URL is snippet-derived or guessed. JavaScript-heavy official pages were fetched directly and their relevant source text inspected; an inaccessible North Macedonia PDF and blocked Maramureș pages were replaced with directly readable official sources. Commercial booking and organiser itineraries were not used as evidence.
- Canonical linter: **104 entries checked, 0 problems**.
- Semantic duplicate review: accent/punctuation-folded place and title similarity was checked within country, followed by manual review of shared regions and likely subactivities. No addition is a token subactivity of an existing flagship. Famous-place variants were rejected; being outside a capital was not accepted as a gem rationale.

Canonical linter summary:

```text
104 entries, 23 countries, 97 gems
AD 2  AL 4  BA 2  BG 4  CZ 5  ES 10  GR 5  HR 6  HU 4  IT 13
MC 2  MD 2  ME 3  MK 3  MT 3  PL 6  PT 6  RO 3  RS 3  SI 3
SK 3  SM 2  XK 10
104 entries checked, 0 problems
```

## Coverage arithmetic

For each country, proposed share was recalculated as:

```text
(baseline gems + added gems) / (baseline rows + added rows)
```

All 23 countries receiving additions reach at least 20.0%. Kosovo launches at 10 rows / 3 gems. UA, BY and RU intentionally remain below target by exactly 2, 1 and 3 gems respectively; current Australian **Do not travel** advice makes ratio-padding inappropriate. Their evidence and release handling are recorded in `exceptions.md`.

## Reproducible checks

The schema check used canonical `tools/lint_source.py` with the absolute path to `additions.jsonl`. A separate read-only Python validation parsed every JSONL line, joined provenance on `(country, place)`, checked dates and rationales, compared titles and places against all canonical source rows, and scanned visible handoff JSONL. The canonical checkout was never written.

## Integration cautions

- Run the canonical build tool so IDs are allocated; do not add IDs manually.
- Apply any existing-row wording changes from `superlatives-review.md` as a separate reviewable patch and preserve every `(country, place)` key.
- Keep the UA/BY/RU country-level advisory treatment visible in product behaviour; content copy alone is not an adequate safety control.
- Treat Holy See support as the compatibility exception described in `exceptions.md`; do not create duplicate Vatican rows.
- The separate VA candidate set and its registry-only lint exception are documented in `va-validation.md`; it is not part of the 104-row main batch.
