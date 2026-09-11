# Access, safety and quality exceptions

Reviewed 2026-09-11. These notes are part of the editorial handoff and must remain attached during review.

## Advisory holdbacks and retained scope

- **Countrywide holdback:** Smartraveller pages directly read on 2026-09-11 advise Do Not Travel overall for Yemen, Syria, Iraq, Iran and Lebanon. All 10 proposed rows for those countries were removed from active sale candidates and preserved in the paired holdback files. Sources: [Yemen](https://www.smartraveller.gov.au/destinations/middle-east/yemen), [Syria](https://www.smartraveller.gov.au/destinations/middle-east/syria), [Iraq](https://www.smartraveller.gov.au/destinations/middle-east/iraq), [Iran](https://www.smartraveller.gov.au/destinations/middle-east/iran), [Lebanon](https://www.smartraveller.gov.au/destinations/middle-east/lebanon).
- **Palestine exact-location holdback:** Birzeit is in the West Bank, which is under Do Not Travel advice. Its single row is preserved in holdback; Jerusalem's lower Reconsider level does not apply to this location. The app's existing `PS` / Palestine / West Bank labels remain unchanged. Source: [Palestine travel advice](https://www.smartraveller.gov.au/destinations/middle-east/palestine).
- **Israel retained by exact scope:** Smartraveller advises Reconsider Your Need to Travel overall and Do Not Travel only to border areas with Gaza, Lebanon and Syria. Hai-Bar Yotvata, Nahal Me'arot, Tel Arad, En Avdat and Bet She'arim are outside those named border areas. They remain active with explicit future-planning language and live-status checks; this is not a claim that travel is low-risk. Source: [Israel travel advice](https://www.smartraveller.gov.au/destinations/middle-east/israel).
- **Top-up scope:** the seven pack-floor rows are in OM, TR, GE, AM and CY. Their Smartraveller scopes were directly checked on 2026-09-11; none of the exact sites falls in a Do Not Travel subregion. Oman is Reconsider overall, Türkiye is Exercise a High Degree of Caution overall with higher levels at the Syrian border/Hakkari/Sirnak, and the chosen Kula and Igneada sites are outside those areas.

## Controlled or uncertain access

- **OM — Al Ayn:** the dry-stone burial towers are fragile archaeological fabric. View from established ground, do not climb the masonry and confirm local access before setting out.
- **OM — Bait Al Darwaza:** a private museum within an inhabited heritage quarter. Confirm opening directly and do not enter private or unrestored buildings.
- **QA — Ras Brouq:** remote archaeological landscape with limited facilities. Use existing tracks, carry out all waste and never collect flint or other material.
- **QA — Abu Dhulauf Mosque:** a working mosque open to visitors subject to mosque guidance. Visit outside prayer activity and follow current dress and access rules.
- **IL — Bet She'arim Menorah Caves:** guided, reservation-dependent access; the general park ticket is not evidence that this particular chamber tour runs.
- **GE — Vashlovani:** border-zone permit, ranger registration and suitable four-wheel-drive arrangements are material access conditions.
- **GE — Edena:** the maker session requires advance arrangement; the primary listing requests booking one week ahead, so it must not be presented as a walk-in workshop.
- **GE — Ceramilia:** the primary listing describes a one-day visitor session but publishes no price; advance arrangement is required and `cost: 2` avoids implying free participation.
- **TR — Kula Volcanic Park / Igneada:** official pages establish the routes and habitats but not free entry; both use conservative `cost: 1` and require current protected-area checks.
- **AM — Trchkan / CY — Teisia tis Madaris / OM — twin aflaj:** primary pages establish the experience but not free entry. Each uses conservative `cost: 1`; route, weather and local-access checks remain necessary.
- **TR — Mount Ida:** guide or access controls can apply to protected sections. Visitors must confirm the precise route.
- **IR — Hyrcanian Forests (holdback):** a serial World Heritage property, not one visitor attraction. Any later activation requires selection of an authorised component, current protected-area guidance and an improved countrywide advisory.

## Editorial threshold exceptions

- YE, LB, PS, SY, IQ and IR remain below 20% because their candidate rows are held back under current official advice. They must not be filled with unsafe sale candidates or low-quality substitutes.
- Seven genuine additions are the exact integer minimum required to restore the active pack floor after holdback; no additional quota rows were added.
- Mutable fields are deliberately conservative: coordinates are null; dog status is `check` unless clearly unsuitable; seasons are broad; descriptions direct readers to live permits, schedules, weather and advisory checks where material.
