# Europe and Middle East final handoff

Final QA: 2026-09-11. This directory is an isolated content handoff; no canonical
application, generated data, native assets, registry, IDs or release files were
modified.

## Integration-ready batches

| Lane | Additions | Gems | Provenance | Status |
| --- | ---: | ---: | ---: | --- |
| North/west Europe | 96 | 96 | 96 | Accepted and copied by the primary; all 18 assigned countries reach at least 20% |
| South/east Europe | 104 | 97 | 104 | Accepted and copied by the primary; Kosovo launches at 10 rows/3 gems; safety exceptions below |
| Middle East, active | 53 | 53 | 53 | Integration-ready; pack floor met with six explicit safety exceptions below |
| Middle East, research-only holdback | 11 | 11 | 11 | Not sale candidates while current countrywide/exact-location Do Not Travel advice applies |
| Holy See/Vatican City (`VA`), separate draft | 3 | 1 | 3 | Superseded working draft; primary owns corrected ticket/postage data, registry and six Italy-row relocation |

Active main-batch totals are 253 rows, 246 gems and 253 one-to-one provenance
records. The 11 Middle East holdbacks have paired provenance but are excluded
from active counts. The local `VA` files must not be integrated as-is because
their old Via Triumphalis and Vatican Post cost claims were handed back to the
primary for correction.

After these additions and the protected 40-row/8-gem FO/GI/JE/IM starter batch,
the prospective Europe pack is 250/1,207 gems (20.71%). The active Middle East
pack is 61/303 gems (20.13%). These pack figures must be recomputed after primary
cross-team deduplication and deterministic integration.

## Explicit exceptions and compatibility notes

- Ukraine (`UA`) remains 0/8 gems and is exactly two gem additions short.
- Belarus (`BY`) remains 0/4 gems and is exactly one gem addition short.
- Russia (`RU`) remains 0/12 gems and is exactly three gem additions short.
- No additions were made for those three while current official advice is
  `Do not travel`. Their existing rows and IDs are preserved, and the detailed
  safety/superlative review is in the south/east reports.
- Yemen (`YE`), Lebanon (`LB`), Palestine (`PS`), Syria (`SY`), Iraq (`IQ`) and
  Iran (`IR`) intentionally remain below their country floors. Eleven researched
  rows are retained only in `middle-east/holdback-*.jsonl`: ten for countrywide
  Do Not Travel destinations and the Birzeit row at an exact West Bank Do Not
  Travel location. This is a safety exception, not a source cutoff or a pass.
- Israel (`IL`) is currently Reconsider overall rather than countrywide Do Not
  Travel. Its five active rows were checked against the named border/conflict
  exclusions and retained because their exact sites are outside those areas.
- Palestine remains `PS` in the existing Middle East geography; no political
  label or geography was changed.
- `VA` remains separate because it is absent from the current registry. The
  primary content lead owns the corrected three-row version, registry/map
  metadata and relocation decision for the six existing Italy-coded Vatican
  experiences. The draft retained here is reference material only.
- FO, GI, JE and IM were audit-only in this lane. The protected starter batch is
  10 rows/2 gems for each code. A cross-country semantic note about the FO Saksun
  lagoon row and an older DK row is documented in the north/west report for
  primary review; nothing was edited here.

## Validation evidence

- Canonical `tools/lint_source.py`: Middle East active 53/0 problems and
  holdback 11/0 problems; the primary separately accepted the 200 Europe rows.
- Coordinator read-only validator: 253 active additions / 253 provenance,
  0 problems. It recognises identical rows already copied into canonical source.
- Dates: all 264 active-plus-holdback adventure rows and all 264 source records
  are `2026-09-11`.
- Rationales: 257 distinct rationales for 257 active-plus-holdback gems; no
  repeated templates.
- Active-plus-holdback exact duplicates: 0 country/place and 0 country/title.
- UTF-8 replacement characters: 0.
- Workers opened/read every retained source page; inaccessible, stale and
  snippet-only candidates were removed or replaced during final QA.
- Semantic review removed flagship/token overlaps including the initial Oman and
  Qatar candidates, Al Ain crafts overlap, Georgia/Ushguli analogue, prominent
  Bulgarian sites and famous Iceland sites. Bahrain's Muharraq row was retained
  only after distinguishing its 3 km merchant-house/stores/mosque architecture
  walk from the existing pearl-diving boat/underwater activity.

The coordinator validator uses exact integer arithmetic for the 20% threshold.
The primary content lead owns the corresponding canonical planning-tool fix.

## Files

- `north-west/additions.jsonl`, `north-west/provenance.jsonl`, and its coverage,
  exception, superlative and validation reports.
- `south-east/additions.jsonl`, `south-east/provenance.jsonl`, and its coverage,
  exception, superlative and validation reports.
- `south-east/va-additions.jsonl`, `south-east/va-provenance.jsonl`, plus the
  separate VA reports are superseded reference drafts; use the primary-owned
  corrected copy instead.
- `middle-east/additions.jsonl`, `middle-east/provenance.jsonl`, and its coverage,
  exception, superlative, existing-row and validation reports.
- `middle-east/holdback-additions.jsonl` and
  `middle-east/holdback-provenance.jsonl` preserve restricted research outside
  the sale-candidate batch.
- `baseline.md` and `validate_handoff.py` contain the audited baseline and
  non-writing coordinator checks.

Primary integration must retain deterministic IDs for every existing row, add
the `VA` registry/map metadata before linting that separate batch, rerun global
semantic deduplication, and then perform the canonical rebuild. No push,
publication or external account action is part of this handoff.
