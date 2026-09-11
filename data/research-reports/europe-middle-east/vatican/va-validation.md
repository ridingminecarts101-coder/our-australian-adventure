# VA validation

Validated on 2026-09-11.

- 3 additions and 3 provenance records parse as JSON.
- Exact `(country, place)` provenance join: 0 missing, 0 orphan, 0 duplicates.
- Dates: every `verified_at` and `accessed` value is `2026-09-11`.
- IDs present: 0.
- Pack/geography fields: all rows use `continent: "Europe"`; the gem uses `pack: "europe"` and both core rows use `pack: null`.
- Exact and semantic collision review against canonical and main additions: no duplicate. `Necropolis of the Via Triumphalis` was manually distinguished from canonical `IT|Vatican Necropolis`; it is a different excavated cemetery and independent visit.
- All three official pages were opened directly and their relevant access/content text read on 2026-09-11. No search snippet or guessed URL is used as provenance.
- The single gem row has an experience-specific rationale based on its guarded entrance and narrow public-access window, not merely location outside a capital. At three total rows, 33.3% is the smallest attainable share above 20%.
- Canonical linter result: 3 entries / 1 gem and exactly 3 expected problems, each solely “VA is not in the country table”. There are no other schema problems. The registry lead owns resolving that temporary limitation.
