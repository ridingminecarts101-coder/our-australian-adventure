# North and west Europe validation

Final validation date: 2026-09-11.

## Machine checks

- Canonical `tools/lint_source.py`: **96 entries, 18 countries, 96 gems, 0 problems**.
- Coordination `validate_handoff.py north-west`: **96 additions, 96 provenance records, 0 problems**.
- JSONL parsing: 96 addition rows and 96 provenance rows parsed as UTF-8 JSON; no blank payloads, replacement characters, visible mojibake markers or BOM-related failure.
- Schema: every addition has the exact research schema, no `id`, valid canonical category/season/enums, `hidden_gem: true`, `pack: "europe"`, `verified_at: "2026-09-11"`, and null coordinates.
- Provenance: addition and provenance `(country, place)` key sets are identical; both contain 96 unique keys. Every source row has publisher, title, HTTPS URL, supports text, a concrete rationale and `accessed: "2026-09-11"`.
- Rationale audit: 96 non-empty rationales, 96 distinct strings, maximum reuse 1. The former generic closings were removed; each rationale now names a specific specialist, community, limited-access, small-scale or overlooked basis supported by the corresponding source.
- Exact duplicate scan across all 74 canonical and in-flight addition files (4,872 comparison rows): 0 same-country/place matches and 0 same-country/title matches.
- Normalised fuzzy same-country place scan at a 0.72 similarity threshold: 0 candidates. A manual semantic pass also checked broader destination and activity overlap.
- Coverage arithmetic: every assigned country passes exact integer `(gems / rows) >= 1/5`; results range from 20.00% to Liechtenstein's unavoidable 28.57%.

## Source-open audit

Every provenance URL in this batch was opened and its page content read on 2026-09-11. Final evidence comes from official national/regional destination organisations, public heritage or environmental bodies, municipalities, museums, parks, or the attraction's official public information. Discovery-only booking or organiser listings were not retained as provenance.

Weak or inaccessible candidates were replaced before final validation. The replacements include Heritage Ireland for Céide Fields; Visit Genk, Hoge Kempen National Park and Toerisme Heuvelland for the Belgian rows; Žemaitija National Park, Visit Biržai and Lithuania Travel for Lithuania; the Municipality of Balzers and Liechtenstein National Administration for Liechtenstein; and official West Iceland, Westfjords and Visit Austurland pages for the Iceland rows.

## Qualitative and semantic audit

- Existing title and place strings were inspected before selection. The exact and fuzzy scans were followed by a destination-level reading so that spelling changes or activity labels could not conceal duplicates.
- Famous Hraunfossar and Stuðlagil candidates were explicitly rejected during the audit. Their replacements, Stone Arch in Jafnadalur and Sænautasel turf farm, have specific official-source support and a substantially lower-profile basis.
- Rows that merely extracted a token subactivity from an existing flagship were rejected. Retained routes, workshops, museums and guided experiences are independently locatable and have their own defining access, interpretation or landscape value.
- FO, JE and IM starter sets were inspected but not added to. The only material adjacent-set concern is the semantic overlap between the in-flight FO `Saksun lagoon shore` row and the older DK `Saksun` row, recorded in `exceptions.md` for coordinator review.
- The existing-row superlative audit is isolated in `superlatives-review.md`. It proposes prose-only changes and explains how exact `country|place` preservation retains canonical IDs; no canonical row was modified.

## Deliverable completeness

Present and internally consistent: `additions.jsonl`, `provenance.jsonl`, `coverage.md`, `exceptions.md`, `superlatives-review.md`, and this `validation.md`.
