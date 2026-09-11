# Validation record

Validated 2026-09-11 against the current canonical checkout and all visible `content-handoff/**/additions.jsonl` files. Validation was read-only outside this owned directory.

## Results

- Canonical `tools/lint_source.py` run directly against `additions.jsonl`: **53 entries, 13 countries, 53 gems, 0 problems**. Separate run against `holdback-additions.jsonl`: **11 entries, 6 countries, 11 gems, 0 problems**.
- JSONL parsing: **PASS** for 53 active additions / 53 active provenance records and 11 holdback additions / 11 holdback provenance records.
- Addition schema: **PASS**. Exact required field set/order, allowed enums, integer ranges, valid seasons, null coordinates, `hidden_gem: true`, `pack: middle-east`, `continent: Middle East`, and `verified_at: 2026-09-11`.
- No-ID requirement: **PASS**. No proposed addition contains an `id` field.
- Provenance schema and completeness: **PASS**. Exactly one non-empty source record per `(country, place)` within each paired active or holdback set; 53/53 active and 11/11 holdback, with no orphan or duplicate source record.
- Canonical provenance uniqueness: **PASS**, 0 collisions against existing `data/research-sources*.jsonl` keys.
- Primary-source requirement: **PASS by editorial inspection**. Every active and holdback provenance URL was directly opened and its page, PDF, or first-party application data read on 2026-09-11; none is retained from a search snippet or guessed URL. The final set contains no known 404. The seven top-up sources were directly read from Experience Oman, GoTurkiye, the Georgian National Tourism Administration, Armenia Travel and the Cyprus Deputy Ministry of Tourism.
- Canonical exact-key uniqueness: **PASS**, 0 collisions on `(country, place)`.
- Visible in-flight exact-key uniqueness: **PASS**, 0 collisions against other handoff additions.
- Normalized place uniqueness against canonical rows: **PASS**, 0 case/punctuation/spacing collisions.
- Near-duplicate scan within the same country: **PASS**, 0 candidate pairs at place similarity >=0.72 or title similarity >=0.78; candidates were also reviewed by title/place before drafting.
- Semantic flagship/subactivity review: **PASS after corrections**. Bu Maher boat access was removed as a Pearling Path component; Al Ain Women's Handicraft Centre was removed as too close to House of Artisans; Dartlo was removed as too close to the canonical Ushguli tower-village experience. Misfat and Al Hoota were removed as prominent Oman-circuit attractions, Majlis Al Jinn was removed because current legal/operational leisure access was not established, and Al Zubarah plus its field-program subactivity were removed from Qatar. Their replacements have independent experience units and concrete rationales based on archaeology, material culture, maker access, fragility or advance booking—not merely being outside a capital.
- Retained concept-overlap audit: **PASS by editorial inspection**. Dhee Ayn is a separate pale-slate settlement, not a token activity within canonical Rijal Almaa's stone tower village; Shaumari is a reserve-led species-restoration drive, not a subactivity of canonical Dana's walking experience; and Basgal's active silk workshops are distinct from walking canonical Baku Old City. Muharraq Pearling Path is a land-based urban architecture route through merchant houses, stores and a mosque, not a token segment of a pearl-diving boat or underwater trail. Top-up rows were also compared against canonical and active titles: Kula and Igneada add distinct volcanic-geology and floodplain-birding units; Armaziskhevi and Ceramilia are independent archaeology and making sessions; Trchkan and Teisia are separately documented trail units; and the twin aflaj are a small-scale water-engineering comparison rather than another oasis swim.
- Advisory scope and holdback: **PASS by exact location**. Official Smartraveller pages directly read on 2026-09-11 show countrywide Do Not Travel advice for YE, SY, IQ, IR and LB; all 10 rows are held back. Birzeit is within the West Bank Do Not Travel scope, so the PS row is held back. Israel is Reconsider overall with Do Not Travel border areas; all five IL sites are outside the named Gaza, Lebanon and Syria border areas and remain active with conservative framing.
- Coverage calculation: **PASS at pack level with six explicit safety exceptions**. After holdback the active pre-top-up total was 296/54. Exact integer arithmetic required seven additions; projected active pack is 303/61 = 20.13%. YE, LB, PS, SY, IQ and IR remain below the country floor because their researched rows are not active sale candidates under current advice.
- Palestine completeness: **PASS**. `PS` remains explicit in coverage and the paired holdback research, while its canonical label and West Bank geography remain unchanged.
- Cost-zero audit: **PASS**. All 12 original `cost: 0` rows were checked against their paired primary evidence. Ten were changed to `cost: 1` because the paired source did not explicitly establish free access: Al Ayn, Ras Brouq, Abu Dhulauf, Dhee Ayn, Zabid, Bosra, Ashur, Orbelian Caravanserai, Lori Berd and Artemis Trail. Only Al Wathba and Amricani remain `cost: 0`; their directly read primary pages explicitly state free-attraction/free-admission status. All seven top-up rows use conservative non-zero costs, and the holdback set contains no zero-cost rows.
- Superlative scan: **PASS for additions**. New copy contains no unsupported comparative ranking. The sole new ranking—Trchkan as Armenia's tallest waterfall—is directly supported by the read Armenia Travel primary page and is flagged for future rechecking in `superlatives-review.md`; existing fragile claims are isolated there and are not modified.

## Reproducible commands

From PowerShell, with `$app` set to the canonical checkout and `$owned` set to this directory:

```powershell
python "$app\tools\lint_source.py" "$owned\additions.jsonl"
```

The one-to-one and collision audit parsed canonical `data/src/*.jsonl`, every visible handoff `additions.jsonl`, this `additions.jsonl`, and `provenance.jsonl`; it compared exact and normalized `(country, place)` keys and recomputed each country percentage from integer counts. Summary output:

```text
active_additions=53 active_provenance=53 one_to_one=True
holdback_additions=11 holdback_provenance=11 one_to_one=True
canonical_collisions=0 inflight_collisions=0 normalized_collisions=0
before=250/8 active_after=303/61 share=20.13%
cost_zero_active=2 cost_zero_holdback=0
result=PASS_WITH_6_DOCUMENTED_DNT_FLOOR_EXCEPTIONS
```

## Integration guardrails

Do not run a concurrent canonical build while merging research batches because the generated ID registry is writable. Re-run canonical lint and the repository provenance checker after the primary integrator copies the paired files into their final `data/src/research-*.jsonl` and `data/research-sources-*.jsonl` locations. Recalculate ratios if any canonical or in-flight row changes before merge.
