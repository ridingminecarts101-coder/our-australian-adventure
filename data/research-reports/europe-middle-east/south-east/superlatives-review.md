# Existing-row review (no edits applied)

This file proposes mutable-copy changes only. Every listed stable ID comes from canonical `data/ids.json`; the `(country, place)` key must remain unchanged. Because ID assignment is keyed by `(country, place)`, changing a title or description while preserving both fields retains saved progress, photos and trips. No canonical file was edited.

## Immediate safety and access changes

| ID | Source row | Place | Proposed replacement | ID analysis |
|---:|---|---|---|---|
| 3752 | `europe-deep-3.jsonl:113` | `UA / Kamianets-Podilskyi` | Description: “A fortress and old town sit within a tight loop of the Smotrych canyon. Australia’s current advice is do not travel to Ukraine; do not present this as a current leisure itinerary.” | Description only; key stays `UA|Kamianets-Podilskyi`. Remove “far enough from the front line” and “largely untouched”. |
| 3754 | `europe-deep-3.jsonl:115` | `UA / Hoverla` | Description: “Ukraine’s 2,061-metre high point rises in the Carpathians. Australia’s current advice is do not travel to Ukraine; access and restrictions can change without notice.” | Description only; key stays `UA|Hoverla`. Remove “most peaceful region” and the implied current hike recommendation. |
| 3746 | `europe-deep-3.jsonl:107` | `MD / Tiraspol` | Description: “Tiraspol is the administrative centre of the breakaway Transnistrian region. Do not describe checkpoint access as straightforward; consult current official travel advice before any release.” | Description only; key stays `MD|Tiraspol`. Consider suppressing the adventure until a current official-access review. |

## Unsupported or brittle superlatives

The baseline lexical scan covered every assigned country and flagged absolute terms such as “largest”, “best”, “deepest”, “oldest”, “only” and “in the world”. The following are the highest-risk marketing, attribution or mutable claims. Replacements retain the experience while removing the unsupported comparison.

| ID | Source row | Place | Claim to remove | Conservative replacement |
|---:|---|---|---|---|
| 1201 | `europe-central.jsonl:1` | `CZ / Prazsky hrad` | “largest ancient castle complex in the world” | “A vast castle precinct containing St Vitus Cathedral and the small houses of Golden Lane.” |
| 1207 | `europe-central.jsonl:7` | `PL / Rynek Glowny` | “largest medieval square in Europe” | “Kraków’s broad medieval market square is framed by the Cloth Hall and St Mary’s Basilica, whose tower sounds an hourly trumpet call.” |
| 1219 | `europe-central.jsonl:19` | `HU / Heviz` | “largest biologically active thermal lake in the world” | “A naturally heated lake used for outdoor bathing through much of the year; confirm current water and entry conditions.” |
| 1232 | `europe-central.jsonl:32` | `HR / Motovun` | “largest white truffle ever recorded” | “Join a seasonal truffle outing in the forest below Motovun, then try the ingredient in Istrian cooking.” |
| 1233 | `europe-central.jsonl:33` | `HR / Pula Arena` | “one of the six largest” and “only one” | “A well-preserved Roman amphitheatre whose outer wall and four side towers remain visible.” |
| 1234 | `europe-central.jsonl:34` | `HR / Zadar Sea Organ` | attributed “best sunset in the world” | “Waves push air through pipes beneath the marble steps, producing changing tones beside the waterfront.” |
| 1245 | `europe-central.jsonl:45` | `ME / Tara Canyon` | “deepest river canyon in Europe” | “Raft a limestone canyon on the Tara beside Durmitor’s mountain and glacial-lake landscape.” |
| 1252 | `europe-central.jsonl:52` | `MK / Matka Canyon` | “deepest underwater cave in the Balkans” | “A reservoir gorge near Skopje with cliff paths, caves and seasonal kayak access.” |
| 1269 | `europe-central.jsonl:69` | `AD / Caldea` | “largest thermal spa in southern Europe” | “A glass-spired thermal complex using the principality’s warm mineral water.” |
| 905 | `europe-es.jsonl:12` | `ES / Setas de Sevilla` | “largest timber structure in the world” | “An elevated timber canopy and rooftop walk above the Antiquarium archaeological site.” |
| 922 | `europe-es.jsonl:29` | `ES / Monfrague` | “best raptor-watching site in Spain” | “A certified starlight destination where black vultures and other raptors can be watched around the park’s cliffs.” |
| 931 | `europe-es.jsonl:38` | `ES / Islas Cies` | “best in the world” | “A protected Atlantic-island beach reached by a capacity-controlled ferry; reserve the required authorisation and sailing in advance.” |
| 852 | `europe-it.jsonl:25` | `IT / Alpe di Siusi` | superlative appears in title | Title: “Walk the high meadows of Alpe di Siusi”. Description: “Rolling pasture around 2,000 metres beneath Sassolungo; daytime vehicle restrictions protect the plateau.” |
| 3744 | `europe-deep-3.jsonl:105` | `MD / Milestii Mici` | superlative appears in title; record can change | Title: “Tour the underground wine collection at Milestii Mici”. Description may state the specific Guinness-listed record only when a current primary/record-holder source is attached. |

Quantified national high points, official UNESCO designations, and clearly scoped facts (for example “country’s largest national park”) were not automatically rejected. They still require matching primary provenance before a future re-verification date is applied. Marketing comparisons such as “best view”, crowd predictions, and “least visited” should be removed whenever their supporting source is not measurable.

## Gibraltar copy quality

ID 4423, `GI|Camp Bay wreck dive`, should keep its place and title. Change the final sentence from “match the site to current and certification” to: “Use a local dive operator and match the site to current conditions and your certification.” This is a description-only correction and cannot alter the frozen ID.
