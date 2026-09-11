# Americas coordinator coverage report

Audited 11 September 2026 (Australia/Sydney) against every current canonical
`data/src/*.jsonl` row, including the primary-owned Greenland starter batch.
The canonical checkout was read only.

## Delivery summary

| Worker scope | Added rows | Added gems | Countries/codes | Result |
|---|---:|---:|---:|---|
| United States, Canada, Mexico | 73 | 73 | 3 | All three above 20% |
| Central America, Caribbean and North American territories | 88 | 76 | 32 | 31 meet; Haiti is a safety exception |
| South America | 60 | 60 | 14 | 12 meet; Suriname and Venezuela are documented exceptions |
| **Total** | **221** | **209** | **49** | **46 meet; 3 explicit exceptions** |

The exact preservation-only country deficit is
`max(0, (rows - 5 * gems + 3) // 4)`. This integer expression avoids the
floating-point ceiling bug found in the canonical inventory helper.

- North America pack after these additions: 1,029 rows / 228 gems = **22.16%**.
- South America pack after these additions: 333 rows / 69 gems = **20.72%**.
- Combined assigned Americas: 1,362 rows / 297 gems = **21.81%**.
- Remaining exact deficits: Haiti 2, Suriname 1, Venezuela 2. Every other
  assigned registry code has an exact remaining deficit of zero.

Guadeloupe, Martinique and Saint Pierre and Miquelon were empty. Each now has
a balanced five-row starter set containing one gem, rather than a paid-only
launch set. Greenland was not duplicated because its existing ten-row starter
already contains two gems.

## Coordinator validation

- 221 additions and 221 one-to-one provenance records.
- No new row contains an ID; all coordinates are null.
- No ownership leaks, cross-batch key collisions or canonical
  `(country, place)` collisions.
- Every retained `verified_at` and `accessed` value is the actual session date,
  `2026-09-11`.
- App source lint passed independently within all three worker batches.
- Exact arithmetic confirms both existing continent packs and 46 of 49 codes
  meet the quality-led 20% floor.
- Normalised title/place comparison against the canonical catalogue found one
  genuine duplicate, Gila Cliff Dwellings. It was removed and replaced with
  Quarai Spanish Corral Trail. The remaining seven low-threshold similarity
  candidates were manually checked; they are different parks, countries,
  landforms, routes or museum-versus-island experiences.
- All originally generic/template hidden-gem rationales were rejected and
  rewritten. Mainland and South America now have 73/73 and 60/60 unique,
  place-specific rationales; the Caribbean/Central batch has a distinct
  rationale for every one of its 76 gems.
- Coordinator source spot-checks re-opened primary pages for a sample spanning
  Canada, Mexico, Guadeloupe, Saint Pierre and Miquelon, Argentina, Brazil and
  Suriname. The checks caught and removed a closed museum, narrowed a closed
  Guadeloupe plantation row to the valley the authority says remains open, and
  confirmed current museum season, trail details and supported experience
  claims. Worker URL audits and exact-page details are recorded in each
  exception report.

## Integration paths

- `north-mainland/north-mainland-additions.jsonl`
- `north-mainland/north-mainland-provenance.jsonl`
- `caribbean-central/additions.jsonl`
- `caribbean-central/provenance.jsonl`
- `south-america/south-america-additions.jsonl`
- `south-america/south-america-provenance.jsonl`

Run `python content-handoff/americas/validate_americas.py` from this coordination
worktree for the read-only aggregate key/date/ownership/ratio and semantic
candidate audit. Final integration still belongs to the primary task, including
deterministic ID assignment and a full rebuild.
