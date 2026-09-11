# Antarctica bundle-only content handoff

Research and source-access date: 2026-09-11. This is an isolated forward-schema
handoff; no canonical source, registry, generated data, map or native asset was
modified.

## Coverage and product classification

The final set contains ten distinct `AQ` experiences:

| Lane | Classics | Gems | Total |
| --- | ---: | ---: | ---: |
| Antarctic Peninsula | 3 | 2 | 5 |
| Ross Sea heritage | 2 | 0 | 2 |
| Weddell Sea specialist | 1 | 2 | 3 |
| **Antarctica total** | **6** | **4** | **10** |

Hidden-gem coverage is 4/10, or 40%. All ten rows use
`continent: "Antarctica"`, `country: "AQ"` and `bundle_only: true`. Classics
are `hidden_gem: false` with `pack: null`; the four defensible gems use
`hidden_gem: true` with `pack: "all"`. Antarctica is therefore exclusively in
the AUD 14.99 all-continents bundle and does not create a standalone product.

## Consolidation decisions

- Retained one continental Peninsula landing, one scenic ship transit and one
  staffed heritage museum as recognisable classics.
- Retained Damoy and Detaille as small, permission-controlled heritage gems;
  neither promises unrestricted building, glacier or overnight access.
- Retained only Cape Evans and geographically distant Cape Adare from six Ross
  candidates. Cape Royds and Hut Point were excluded to prevent a hut-heavy
  starter set. Wind Vane Hill was excluded as part of the Cape Evans landing,
  and Hillary's Hut was excluded because its exceptional Scott Base consent is
  too station-dependent for starter content.
- Retained the Snow Hill emperor-colony attempt as a classic, not a gem.
  Nordenskjöld's Snow Hill hut was excluded to avoid a second record centred on
  the same island and specialist operating window.
- Retained Paulet's controlled history/volcanology route and Devil Island's
  flagged south-peak trail as the Weddell gems. Generic cruise, Zodiac, kayak,
  helicopter-flightseeing and research-station variants were excluded.

## Access and safety constraints

Every row describes an expedition objective rather than guaranteed access.
Landings, passages and wildlife encounters remain subject to the operator,
permit, site rules, biosecurity, sea ice, surf, weather and wildlife welfare.
Historic huts require the applicable permission, trained guide, key and group
limit. Protected wildlife areas are not presented as recreational access.
Research stations, unscheduled aviation and independent protected-site visits
are not included.

The Snow Hill colony is explicitly a ship-and-helicopter attempt whose success
depends on safe sea ice and weather. Neko Harbour retains the official
calving-wave and crevasse constraints. Damoy prohibits venturing onto the
crevassed glacier. Detaille, Cape Evans, Cape Adare, Paulet and Devil Island all
state that conditions can narrow or cancel the experience.

## Evidence and validation

Each final row has exactly one matching provenance record. Sources were opened
and read on 2026-09-11 and include Antarctic Treaty Secretariat visitor-site
guidelines, UK Antarctic Heritage Trust, and named current expedition operators.
No claim relies only on a search snippet, generic cruise page or invented public
access.

Paulet Island and Devil Island each retain the current operator itinerary as the
main source and attach the opened, site-specific 2025 Antarctic Treaty visitor
guidance in `additional_sources`. Those records directly support the controlled
walking routes, absence of free roaming at Paulet, flagged single-track ascent
at Devil Island, wildlife limits and ice/reef hazards. Port Lockroy is filed at
Goudier Island, matching the UK Antarctic Heritage Trust source.

`antarctica_validate.py` reports ten rows, four gems (40%), ten provenance
records and zero problems. All rows use null coordinates, contain no `id`, use
the strict existing season format, and satisfy the requested classic/gem pack
rules.

## Primary integration dependency

The canonical registry and linter inspected before this handoff do not yet
recognise `AQ`, `Antarctica`, `pack: "all"` or `bundle_only`. The root content
lead owns the registry/map/schema changes and engineering owns enforcement of
the bundle-only lock. Do not run these rows through the old builder by removing
or remapping their new fields; integrate only after that explicit schema support
exists.
