# Proposed existing-row edits for primary review

No edit below has been applied. The suggestions remove unsupported or fragile superlatives while preserving each row's exact `country` and `place` pair.

| Country | Place | Suggested title |
|---|---|---|
| AE | Jebel Hafeet | Drive the switchbacks up Jebel Hafeet |
| AE | Jebel Jais | Ride the mountain zip line at Jebel Jais |
| AE | Al Bidyah Mosque | Visit the mudbrick Al Bidyah Mosque |
| AE | Sharjah | Explore Islamic art collections in Sharjah |
| AM | Karahunj | Count the standing stones at Karahunj |
| AM | Garni Temple | Stand among the classical columns of Garni Temple |
| AZ | Xinaliq | Climb to the high mountain village of Xinaliq |
| GE | Kutaisi | See Bagrati Cathedral above Kutaisi |
| JO | Madaba | Read the mosaic map at Madaba |
| LB | Anjar | Walk the Umayyad city ruins at Anjar |
| OM | Sultan Qaboos Grand Mosque | See the handwoven carpet at Sultan Qaboos Grand Mosque |
| PS | Taybeh | Tour the brewery in Taybeh |
| SA | Maraya | See the mirrored facade of Maraya |
| SA | Jeddah Corniche | Watch King Fahd's Fountain from Jeddah's Corniche |
| SY | Krak des Chevaliers | Explore the layered fortifications of Krak des Chevaliers |
| TR | Pergamon | Climb the hillside theatre at Pergamon |
| YE | Shibam | See Shibam's mudbrick tower skyline |

## ID-preservation analysis

Canonical source rows intentionally contain no `id`. Wayfinder's lint documentation states that `(country, place)` is the identity key used by the generated ID registry. A title-only edit therefore preserves identity **only if both key fields remain byte-for-byte unchanged**. The suggestions above retain the current country code and place string exactly; the primary integrator should verify that fact again immediately before applying any edit, avoid running concurrent builds, and let the normal build reuse the existing registry entry. Changing spelling, punctuation or spacing in `place`, or moving a row between country codes, could silently repoint saved user ticks and is out of scope here.

Before applying a suggestion, the primary integrator should also open a current primary source for the replacement's concrete claim and attach/update canonical provenance as required. Conflict-affected rows require the safety framing in `exceptions.md` independently of title cleanup.
