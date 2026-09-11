# East and Southeast Asia validation

Validated 2026-09-11 against the then-current canonical checkout at `C:\Users\User\OneDrive\Desktop\our-australian-adventure`.

Malaysia source remediation was completed the same day: all six rows tied to two HTTP-403 Tourism Malaysia pages were replaced with six rows supported by full official Sarawak Tourism Board pages that were directly opened and read. The checks below were rerun after replacement.

Final China semantic QA was also completed the same day: Kulangsu and Wudang were removed because their UNESCO pages did not support the narrowed experiences as independently lesser-known. One directly opened official Shanghai-government source supports their replacement, Hanxiang Water Expo Garden. The checks below were rerun on the resulting 94-row set.

## Canonical schema lint

Command equivalent:

`python tools/lint_source.py <absolute path to east-southeast-asia-additions.jsonl>`

Result:

- 94 entries
- 17 countries
- 94 hidden gems
- 0 problems
- Country counts: BN 2, CN 10, HK 4, ID 8, JP 17, KH 3, KR 5, LA 3, MN 4, MO 2, MY 6, PH 7, SG 1, TH 8, TL 1, TW 5, VN 8

## Provenance and duplicate check

An independent read-only JSONL check loaded all additions, all provenance rows and every canonical `data/src/*.jsonl` row. It verified:

- 94 valid addition JSON objects and 94 valid provenance JSON objects.
- 94 unique `(country, place)` addition keys and 94 unique provenance keys.
- Exactly one provenance record for every addition; no missing or orphan provenance.
- Every provenance row contains non-empty `publisher`, `title`, `url`, `accessed`, `supports` and `hidden_gem_rationale` fields.
- Every URL is an absolute HTTPS URL and every access date is `2026-09-11`.
- No exact or normalized `(country, place)` duplicate against the current canonical source.
- No exact or normalized `(country, title)` duplicate against the current canonical source.
- No new row contains an `id`; all preserve the research-batch no-ID convention.

Result: 0 provenance, key or exact-normalized duplicate problems.

This is source-level validation only. The primary task still owns final cross-team semantic deduplication, deterministic ID assignment, full-data rebuild and release QA.
