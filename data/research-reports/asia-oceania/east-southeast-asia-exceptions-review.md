# East and Southeast Asia exceptions and review notes

## Safety and access exceptions

### KP — North Korea

No starter rows were created. The Australian Government's advice was still current on 2026-09-11 and said **Do not travel**, citing arbitrary detention, uncertain security, severely restricted internal movement, mandatory official tours and extremely limited Australian consular support. The UK FCDO also reported that borders had not reopened to general entry and only limited tourism had restarted. Creating three or four aspirational paid “adventures” would imply a stable, open visitor product that the evidence does not support.

Sources actually opened and read:

- Australian Government Smartraveller, “North Korea (Democratic People's Republic of Korea)”, https://www.smartraveller.gov.au/destinations/asia/north-korea-democratic-peoples-republic-korea (accessed 2026-09-11).
- UK Foreign, Commonwealth & Development Office, “North Korea travel advice: Warnings and insurance”, https://www.gov.uk/foreign-travel-advice/north-korea/warnings-and-insurance (accessed 2026-09-11).

Re-review only after current official advice and actual general-entry conditions materially change.

### MM — Myanmar

No gem top-ups were created, leaving an exact deficit of three. Smartraveller remained at **Do not travel** on 2026-09-11 because of armed conflict, civil unrest, unpredictable attacks, arbitrary detention and rapidly changing movement restrictions, including at official border crossings. The existing twelve canonical rows are historical baseline content; adding newly researched paid adventures now would wrongly suggest a safe/open product. Do not solve this with quota filler.

Source actually opened and read:

- Australian Government Smartraveller, “Myanmar”, https://www.smartraveller.gov.au/destinations/asia/myanmar (accessed 2026-09-11).

Re-review after the advice level and conflict/access situation materially change. The primary integration pass should separately decide whether existing MM rows need a visible advisory treatment; this handoff does not edit them.

## Editorial review flags

- The 94 additions pass the canonical source linter and have one-to-one provenance. They do not assert that every mutable operating detail is verified. Seasons, costs, difficulty and dog fields are conservative Wayfinder editorial classifications; travellers must check live permits, closures, weather and operator status.
- The original six Malaysia candidates were removed after both Tourism Malaysia article URLs returned HTTP 403 during coordinator review. Their replacements are supported by full, directly opened pages from the official Sarawak Tourism Board: Gua Sireh, Paku Rock Maze Garden, Tanjung Datu, Bario Highlands, Julan Waterfall and Wong Akub Waterfall. No inaccessible-page or search-result-only evidence remains in the Malaysia set.
- The Tourism Authority of Thailand's official Trang destination result currently resolves through an anomalous URL containing `Provinces/Chiang-Mai/355`, while the loaded content is clearly Trang and supports Tham Le Khao Kob. Reconfirm the canonical URL before release if TAT repairs routing.
- China entries supported by UNESCO identify the heritage asset and conservation context, but current ticketing, local transport and component-level openings were intentionally not asserted. Badain Jaran, Burkhan Khaldun, Uvs Nuur, Khar Us, Calayan, Dinagat and Virachey especially require fresh local/park confirmation before travellers commit.
- `Burkhan Khaldun pilgrimage approach` is deliberately framed around permission, cultural restraint and the wider approach. The sacred summit landscape must not be marketed as unrestricted recreation.
- `Yok Don ethical elephant tour` is observation-based. Integration should reject any later copy edit that turns it into riding, bathing or performance contact.
- `Danau Kaolin Belitung` and other former quarry/mining landscapes are viewpoint experiences only unless local authorities explicitly designate water access as safe.
- `Cambugahay Falls` was removed during coordinator semantic QA because its hidden-gem rationale was too borderline and the Philippines meets its floor without it. The retained Philippines set is seven additions, producing 7 gems among 32 final rows (21.875%).
- `Chi Phat community mountain-bike route` was compared at experience level with the existing `Stay in the Cardamom Mountains`. They share the Cardamom landscape, but the existing row is a broad, multi-day nature stay in community-run camps, while the new row is a specific full-day guided mountain-bike route from Chi Phat through village, forest-track and wetland terrain. Different activity, duration and booking proposition make it substantively distinct; retain both.
- `Huinnyeoul Culture Street` was compared at experience level with the existing `Gamcheon Culture Village`. Both are Busan hillside neighbourhood walks shaped by regeneration and public art, but Gamcheon is the dense pastel inland-hillside mural and stamp-tour maze, whereas Huinnyeoul is a separate Yeongdo seafront network of 14 lanes linked to a coastal trail, tunnel and small haenyeo exhibition. The analogue is worth flagging, but the destination and route experience are substantively distinct; retain both.
- `Kulangsu historic settlement` and `Wudang Mountain pilgrimage paths` were removed during final semantic QA. UNESCO establishes both internationally famous properties, but it does not establish the worker-invented backstreet or quieter-pilgrimage-route framings as independently lesser-known visitor experiences. Kulangsu's listing instead documents significant tourism pressure and a visitor cap of 35,000 per day; Wudang's listing mentions remote heritage sites for conservation management, not an authorised hidden visitor trail. One directly supported replacement was added: `Hanxiang Water Expo Garden`, which Shanghai's official government site explicitly calls a tucked-away suburban hidden gem and documents kayaking and paddleboarding among traditional-style waterways. China now has its exact ten-row top-up and finishes at 12 gems among 57 rows (21.05%).
- `Chengjiang Fossil Site museum` remains a specialist palaeontology and interpretation stop rather than a broad claim that the whole UNESCO property is hidden. Do not widen its experience framing during integration.
- No claims of independent access were made for Laos canopy products, Cambodia community sites, cave expeditions, protected-area wildlife trips or remote island boat routes. Named operators/community bodies and permits must be checked at booking time.

## Scope and integration state

All work is confined to this worker's `east-southeast-asia-*` files. No canonical source, generated data, native asset, ID registry, billing file or release record was changed. No build, publish, push, migration, account registration or external message was performed.
