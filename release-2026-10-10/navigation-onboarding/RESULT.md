# Wayfinder navigation and first-use update

Prepared version: **1.1.2 (build 12)**. PWA cache: **v72**.

The owner requested a tutorial step for the Me / Group progress switch, explicit parent Back navigation, a small Search action below Near me, state-level location browsing and a first-use tutorial prompt.

## Behavior

- A managed welcome dialog is offered after the first successful sign-in on this installation. Show me around starts the optional tour; No thanks dismisses it. Existing tour completion is respected on upgrade. Replay remains in Me. Invite, trip-link and location flows take priority; guidance waits until those actions settle.
- The tour points to the actual Me / Group switch when a group is available. For solo travellers it explains where that control appears after joining, without enabling a fake group view. It also teaches Near me, worldwide Search and parent Back.
- Back returns from a state's adventure list to that country's state list. Country/island/continent/world parents follow the same hierarchy on screen and through Android's Back action. Browser Back still restores prior navigation.
- Worldwide Search reuses the existing accessible search field, clears stale filters and focuses the input. An empty query does not render the entire catalogue; broad searches render up to 200 matches with the full match count and a refinement hint. Country-scoped browsing is unaffected.
- Near me asks for the existing disclosed provider lookup, then obtains a fresh, one-shot location through the native plugin or browser. A validated ISO subdivision code such as AU-SA takes priority over exact normalized names. A successful lookup clears earlier searches and filters before opening the place; cancellation and errors preserve them. Unknown subdivisions open the country; failed geocoding offers broad continent browsing with an explicit manual-browse message. It does not calculate distances, infer a state from a city, save coordinates to the account or track in the background. Late responses cannot change another account's screen.
- Support pages explain the controls. The bundled privacy page now includes the existing website's provider-retention limitation. The photo storage and sharing rules are unchanged.

## Validation and remaining gates

The whole-app matrix passed **100/100** local scenarios and the technical suite passed **68/68** categories. Focused follow-up checks cover welcome timing/focus, pending actions, native/browser permission failures, subdivision matching, session races, parent navigation and worldwide result limits. Production dependency audit found **zero** vulnerabilities. These are bounded test results, not a field-reliability percentage.

No new backend migration is required. This preparation alone does not claim a signed upload, TestFlight availability, App Review submission or public release. The exact-source unsigned native compile and protected signing/delivery remain separate gates. Device location permission/GPS accuracy, purchases/restore and Photos behavior must be accepted on a physical iPhone; local fixtures do not establish them.

## Shared-photo question

Automatic group or cross-device photo viewing is a separate feature. The straightforward implementation would require opt-in copies in private hosted storage, authenticated group access, limits/validation, consent, deletion/leave/account rules and revised privacy disclosures. Private memory photos should stay local unless the owner separately authorizes that design. Manual encrypted backup/import already transfers photos between devices for the same account; it does not publish them to a group.

References: [BigDataCloud subdivision fields and direct-client requirements](https://www.bigdatacloud.com/free-api/free-reverse-geocode-to-city-api), [Capacitor one-shot geolocation](https://capacitorjs.com/docs/apis/geolocation), [Supabase private Storage access control](https://supabase.com/docs/guides/storage/security/access-control).
