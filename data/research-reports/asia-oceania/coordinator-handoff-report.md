# Asia/Oceania coordinator handoff

Audited 2026-09-11 against the current canonical `data/src/*.jsonl`, including
the pending Australia/New Zealand rows in `research-oceania-gems.jsonl`.
Canonical application files were read only. This handoff contains no generated
IDs and does not modify source, native assets, billing, SQL or release state.

## Combined result

| Pack | Canonical rows | Canonical gems | Added gems | Final rows | Final gems | Final ratio |
| --- | ---: | ---: | ---: | ---: | ---: | ---: |
| Asia | 613 | 19 | 138 | 751 | 157 | 20.91% |
| Oceania | 785 | 136 | 37 | 822 | 173 | 21.05% |
| **Combined** | **1,398** | **155** | **175** | **1,573** | **330** | **20.98%** |

Every populated assigned code reaches at least 20% except Afghanistan and
Myanmar, which retain explicit current do-not-travel exceptions. North Korea
has no canonical rows and retains a restricted-entry/do-not-travel starter-set
exception. No quota filler was added for those countries.

Exact per-country arithmetic and editorial notes are in the three worker
coverage and exception reports. Australia and New Zealand were audited after
the existing pending top-up and received no duplicate additions.

## Batch manifest

- `east-southeast-asia-additions.jsonl`: 94 additions in 17 countries.
- `east-southeast-asia-provenance.jsonl`: 94 matching evidence rows.
- `south-central-asia-additions.jsonl`: 44 additions in 12 countries.
- `south-central-asia-provenance.jsonl`: 44 matching evidence rows.
- `oceania-additions.jsonl`: 37 additions in 23 countries/territories.
- `oceania-provenance.jsonl`: 37 matching evidence rows.

Each worker also supplies a country coverage report and exception/editorial
review report. East/Southeast Asia additionally supplies a validation report.

## Coordinator validation

- Canonical `tools/lint_source.py`: 175 entries, 52 populated codes, 175 gems,
  zero problems.
- Combined handoff audit: 175 unique adventure keys and 175 one-to-one
  provenance records; no exact or normalized canonical place-key collisions;
  no internal or cross-worker place-key collisions.
- All additions use the existing country-table geography and correct `asia` or
  `oceania` paid pack, with null coordinates and no `id` field.
- Exact post-addition ratios: Asia 20.91%; Oceania 21.05%.

Qualitative QA removed the borderline Cambugahay Falls row even though it had
passed structural checks. It also replaced an unreadable Pakistan source, six
Malaysia rows backed by blocked pages, and five marginal Oceania candidates
(including flagship Millennium Cave) with directly read primary-source
alternatives. Chi Phat's specific community bike route versus the existing
broad Cardamom Mountains stay, and Huinnyeoul's seafront lane walk versus
Gamcheon Culture Village, are retained as substantively different experiences
but explicitly flagged for the primary editorial pass.

Bounded final QA also removed the famous Kulangsu and Wudang UNESCO properties;
one directly supported Shanghai suburban-water-garden experience replaced them,
for a net reduction of one China row while China remains at 21.05%. Pitcairn's
ordinary tennis activity was replaced by the official guide-only Down Rope
petroglyph descent. Nanumea wartime remains were removed because no official
visitor route exists amid documented unexploded-ordnance risk; the replacement
is the Government of Tuvalu's explicitly invited, runway-cleared community games.

The read-only audit implementation is `coordinator_validate.py`. Primary
integration must still repeat semantic review, copy the accepted rows into the
canonical research files, run the canonical provenance checker, assign IDs
deterministically, rebuild all data, and validate PWA/Android/iOS artifacts
separately.

## Required primary review

- Afghanistan, Myanmar and North Korea: preserve the current exception and
  visible safety/access treatment; do not treat the ratio lint as permission to
  invent paid adventures.
- Pakistan and Turkmenistan: recheck current advice, permits and local movement
  restrictions immediately before integration or release.
- Fragile/limited-access Pacific destinations: retain the explicit Tokelau,
  Pitcairn, Tuvalu and related caveats in the Oceania review report.
- Review the worker-flagged borderline hidden-gem rationales before acceptance;
  the extra China and Philippines candidates allow the weakest optional row in
  either country to be dropped without falling below 20%.
