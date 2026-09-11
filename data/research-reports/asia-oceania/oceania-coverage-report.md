# Oceania content handoff coverage

Audited 2026-09-11 against every canonical `data/src/*.jsonl` row, including the pending `research-oceania-gems.jsonl` Australia/New Zealand top-up. New additions are the 37 rows in `oceania-additions.jsonl`.

For each country, the minimum gem-only addition count is:

`x = max(0, ceil((total - 5 × existing_gems) / 4))`

This is the exact integer solution to `(existing_gems + x) / (total + x) >= 20%` when no existing row is removed or reclassified. “Final” below means canonical source plus this handoff, before deterministic IDs or generated assets are rebuilt.

| Code | Canonical rows | Canonical gems | Added gems | Final rows | Final gems | Final ratio |
| --- | ---: | ---: | ---: | ---: | ---: | ---: |
| AU | 504 | 101 | 0 | 504 | 101 | 20.04% |
| NZ | 173 | 35 | 0 | 173 | 35 | 20.23% |
| PG | 9 | 0 | 3 | 12 | 3 | 25.00% |
| FJ | 12 | 0 | 3 | 15 | 3 | 20.00% |
| SB | 5 | 0 | 2 | 7 | 2 | 28.57% |
| VU | 7 | 0 | 2 | 9 | 2 | 22.22% |
| NC | 5 | 0 | 2 | 7 | 2 | 28.57% |
| PF | 9 | 0 | 3 | 12 | 3 | 25.00% |
| WS | 6 | 0 | 2 | 8 | 2 | 25.00% |
| TO | 5 | 0 | 2 | 7 | 2 | 28.57% |
| CK | 5 | 0 | 2 | 7 | 2 | 28.57% |
| NU | 4 | 0 | 1 | 5 | 1 | 20.00% |
| PN | 2 | 0 | 1 | 3 | 1 | 33.33% |
| NF | 2 | 0 | 1 | 3 | 1 | 33.33% |
| FM | 4 | 0 | 1 | 5 | 1 | 20.00% |
| MH | 3 | 0 | 1 | 4 | 1 | 25.00% |
| KI | 3 | 0 | 1 | 4 | 1 | 25.00% |
| TV | 2 | 0 | 1 | 3 | 1 | 33.33% |
| NR | 3 | 0 | 1 | 4 | 1 | 25.00% |
| PW | 6 | 0 | 2 | 8 | 2 | 25.00% |
| GU | 5 | 0 | 2 | 7 | 2 | 28.57% |
| AS | 3 | 0 | 1 | 4 | 1 | 25.00% |
| WF | 2 | 0 | 1 | 3 | 1 | 33.33% |
| TK | 2 | 0 | 1 | 3 | 1 | 33.33% |
| MP | 4 | 0 | 1 | 5 | 1 | 20.00% |
| **Oceania pack** | **785** | **136** | **37** | **822** | **173** | **21.05%** |

## Australia and New Zealand audit

The pending canonical batch contains two new AU gems and nine new NZ gems, with matching records already present in `data/research-sources-core.jsonl`. Their exact final ratios are 20.04% and 20.23%. No AU or NZ row was added here, which avoids duplicate work and keeps the pack near the requested 20–25% range.

## Validation result

- `tools/lint_source.py` against `oceania-additions.jsonl`: 37 entries, 23 countries, 37 gems, 0 problems.
- JSON decoding: 37 additions and 37 provenance records.
- One-to-one `(country, place)` provenance match: pass.
- Required provenance fields and concrete hidden-gem rationales: pass.
- Duplicate addition keys: none.
- Duplicate provenance keys: none.
- Exact canonical `(country, place)` collisions: none.
- Exact canonical country/title collisions: none.
- Qualitative second pass: five marginal rows were replaced while preserving every country count—Millennium Cave, Falealupo Canopy Walkway, St Paul's Pool, the generic Naoero self-drive, and Talietumu. Their replacements have experience-specific lesser-known rationales rather than relying on the destination's overall low visitation.
- Bounded final QA: interim Pitcairn tennis was replaced by the destination-specific guide-only Down Rope petroglyph hike; Nanumea's unsupported and UXO-exposed wartime-remains concept was replaced by the Government of Tuvalu-documented cleared-runway community games. Net row and country-count delta: zero.
- New rows intentionally contain no `id` field.

Final integration still requires coordinator-level cross-worker deduplication, placing the files under canonical research paths, running the canonical provenance checker, deterministic ID assignment, a complete rebuild, and product/native validation.
