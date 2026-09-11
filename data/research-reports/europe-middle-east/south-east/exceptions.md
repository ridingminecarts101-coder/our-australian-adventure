# Exceptions and compatibility notes

## Current conflict and access reporting

### Ukraine (`UA`)

Smartraveller’s 2026-09-11 advice is **Do not travel** because of the volatile security environment and military conflict. Martial law, air attacks, unexploded ordnance, damaged infrastructure and abrupt local restrictions make leisure-adventure verification unsuitable even in western regions. No new UA rows are proposed. The baseline remains 8 rows / 0 gems, below the target by 2 gems. Source read: [Smartraveller — Ukraine](https://www.smartraveller.gov.au/destinations/europe/ukraine).

Two existing descriptions require immediate review: ID 3752 (`Kamianets-Podilskyi`) says it is far enough from the front line and largely untouched; ID 3754 (`Hoverla`) calls its region Ukraine’s most peaceful. Both are mutable safety claims that conflict with countrywide do-not-travel advice. Replacement wording is in `superlatives-review.md`.

### Belarus (`BY`)

Smartraveller’s 2026-09-11 advice is **Do not travel**. It cites the volatile security environment, risk of arbitrary enforcement and arrest, and limited consular assistance. No new BY rows are proposed. The baseline remains 4 rows / 0 gems, below target by 1 gem. Source read: [Smartraveller — Belarus](https://www.smartraveller.gov.au/destinations/europe/belarus).

### Russia (`RU`)

Smartraveller’s 2026-09-11 advice is **Do not travel**. It cites the security situation arising from the invasion of Ukraine, risk of arbitrary detention or arrest, and limited consular ability to assist. No new RU rows are proposed. The baseline remains 12 rows / 0 gems, below target by 3 gems. Source read: [Smartraveller — Russia](https://www.smartraveller.gov.au/destinations/europe/russia).

### Moldova / Transnistria

ID 3746 (`Tiraspol`) currently says checkpoint crossing is straightforward. That is an access claim too mutable for evergreen content near the war in Ukraine. Keep the ID but suppress or rewrite the row pending current official Moldova/Transnistria advice; see `superlatives-review.md`.

## Holy See / Vatican City completeness

The canonical country registry has no `VA` code. The Holy See is nevertheless represented by six experiences stored under `IT`, all with `admin1: "Vatican City"`: Vatican Museums (ID 831), St Peter’s Basilica (889), St Peter’s Square (890), Vatican Necropolis (891), Vatican Gardens (892), and Papal Audience (893).

Compatibility recommendation: retain these rows and IDs under `IT` unless the canonical lead explicitly approves a registry migration. A separate, non-duplicating three-row VA proposal now exists in `va-additions.jsonl`; it does not assume the six IT rows will be reclassified. If product requirements later demand sovereign-country filtering, make it an explicit registry-and-migration decision with an alias/compatibility layer so saved ticks, photos and trips remain attached to IDs 831 and 889–893.

## Gibraltar in-flight review

The retained GI starter set contains 10 rows and exactly 2 gems (20%): `Camp Bay wreck dive` and `Moorish Baths at Gibraltar National Museum`. Both have exact core provenance and genuine rationales. No GI additions are proposed and no collision was found with this batch.

One copy edit is recommended for ID 4423: “match the site to current and certification” is incomplete. The ID-preserving replacement appears in `superlatives-review.md`.
