"""Report Wayfinder country and continent coverage from generated content.

This is an editorial planning check. It never rewrites source rows or ids. The
``minimum_gem_additions`` field preserves an optional historical planning
benchmark: it assumes every added row is a genuine hidden gem and solves
(gems + x) / (entries + x) >= 20%. It is not a content or release requirement.

    python tools/content_inventory.py
    python tools/content_inventory.py --csv
"""
import argparse
import collections
import csv
import importlib.util
import io
import json
import os
import sys
import unicodedata

from subdivisions import NAVIGATION_SUBDIVISION_COUNTS


ROOT = os.path.dirname(os.path.dirname(os.path.abspath(__file__)))
DATA = os.path.join(ROOT, "data", "adventures.json")
COUNTRIES_FILE = os.path.join(ROOT, "tools", "countries.py")
CONTINENTS = ("Oceania", "Asia", "Middle East", "Europe",
              "North America", "South America", "Africa", "Antarctica")
COUNTRY_WIDE_ADMIN1 = {"AU": frozenset({"AUS"})}

# 193 UN members plus the Holy See (VA) and State of Palestine (PS), the two
# non-member observer states. This is deliberately separate from the product
# registry, which also surfaces territories and other ISO-coded areas.
# Sources: https://www.un.org/about-us/member-states and
# https://www.un.org/en/about-us/non-member-states
UN_STATE_CODES = frozenset("""
AF AL DZ AD AO AG AR AM AU AT AZ BS BH BD BB BY BE BZ BJ BT BO BA BW BR BN
BG BF BI CV KH CM CA CF TD CL CN CO KM CG CD CR CI HR CU CY CZ DK DJ DM DO
EC EG SV GQ ER EE SZ ET FJ FI FR GA GM GE DE GH GR GD GT GN GW GY HT HN HU
IS IN ID IR IQ IE IL IT JM JP JO KZ KE KI KP KR KW KG LA LV LB LS LR LY LI
LT LU MG MW MY MV ML MT MH MR MU MX FM MD MC MN ME MA MZ MM NA NR NP NL NZ
NI NE NG MK NO OM PK PW PA PG PY PE PH PL PT QA RO RU RW KN LC VC WS SM ST
SA SN RS SC SL SG SK SI SB SO ZA SS ES LK SD SR SE CH SY TJ TZ TH TL TG TO
TT TN TR TM TV UG UA AE GB US UY UZ VU VE VN YE ZM ZW PS VA
""".split())


def load_countries():
    spec = importlib.util.spec_from_file_location("wayfinder_countries", COUNTRIES_FILE)
    module = importlib.util.module_from_spec(spec)
    spec.loader.exec_module(module)
    return module.COUNTRIES, module.ADVISORIES


def additions_needed(entries, gems):
    """Gem-only rows needed for the optional historical one-in-five benchmark.

    Integer arithmetic avoids floating-point overstatement at exact boundaries.
    Solving 5(g + x) >= n + x gives x >= (n - 5g) / 4.
    """
    return max(0, (entries - 5 * gems + 3) // 4)


def is_active(adventure):
    return (adventure.get("availability") or {}).get("status") != "unavailable"


def normalized(value):
    folded = unicodedata.normalize("NFD", str(value or ""))
    return "".join(char for char in folded if not unicodedata.combining(char) and char.isalnum()).casefold()


def inventory_for(adventures, countries, advisories):
    active = [a for a in adventures if is_active(a)]
    counts = collections.Counter(a["country"] for a in active)
    stored = collections.Counter(a["country"] for a in adventures)
    paused = collections.Counter(a["country"] for a in adventures if not is_active(a))
    gems = collections.Counter(a["country"] for a in active if a["hidden_gem"])
    visible_regions = collections.defaultdict(set)
    raw_regions = collections.defaultdict(set)
    for adventure in adventures:
        raw_regions[adventure["country"]].add(adventure.get("admin1"))
    for adventure in active:
        code = adventure["country"]
        if NAVIGATION_SUBDIVISION_COUNTS.get(code, 0) >= 6:
            admin1 = adventure.get("admin1")
            country_name = countries[code][0]
            if (admin1 and admin1 not in COUNTRY_WIDE_ADMIN1.get(code, ())
                    and normalized(admin1) != normalized(country_name)):
                visible_regions[code].add(admin1)

    out = []
    for code, (name, continent, _lat, _lon) in countries.items():
        n, g = counts[code], gems[code]
        out.append({
            "continent": continent,
            "code": code,
            "country_or_territory": name,
            "un_member_or_observer_state": code in UN_STATE_CODES,
            "entries": n,
            "stored_entries": stored[code],
            "paused_entries": paused[code],
            "regions": len(visible_regions[code]),
            "raw_admin1_bins": len(raw_regions[code]),
            "gems": g,
            "gem_percent": round(100 * g / n, 2) if n else 0,
            "minimum_gem_additions": additions_needed(n, g),
            "advisory": advisories.get(code, ("", ""))[0],
            "coverage": "missing" if not n else "thin" if n < 5 else "present",
        })
    return out


def rows():
    countries, advisories = load_countries()
    adventures = json.load(io.open(DATA, encoding="utf-8"))
    return inventory_for(adventures, countries, advisories)


def print_summary(inventory):
    registry_codes = {r['code'] for r in inventory}
    populated_codes = {r['code'] for r in inventory if r['entries']}
    print("Wayfinder content inventory")
    print(f"registry codes: {len(inventory)}")
    print(f"populated codes: {sum(r['entries'] > 0 for r in inventory)}")
    print(f"missing codes: {sum(r['entries'] == 0 for r in inventory)}")
    print(f"entries: {sum(r['entries'] for r in inventory)}")
    print(f"paused historical entries: {sum(r['paused_entries'] for r in inventory)}")
    print(f"gems: {sum(r['gems'] for r in inventory)}")
    print(f"UN member/observer states represented in registry: "
          f"{len(UN_STATE_CODES & registry_codes)}/{len(UN_STATE_CODES)}")
    print(f"UN member/observer states populated: "
          f"{len(UN_STATE_CODES & populated_codes)}/{len(UN_STATE_CODES)}")
    print("UN member/observer states absent from registry: " +
          " ".join(sorted(UN_STATE_CODES - registry_codes)))
    print("optional historical 20% planning benchmark, gem-only rows for populated countries: "
          f"{sum(r['minimum_gem_additions'] for r in inventory if r['entries'] and r['advisory'] != 'avoid')} "
          "outside countrywide do-not-travel holds; not a requirement")
    held = [r for r in inventory
            if r['entries'] and r['advisory'] == 'avoid' and r['minimum_gem_additions']]
    print("optional historical benchmark in safety-held countries: "
          f"{sum(r['minimum_gem_additions'] for r in held)} rows across {len(held)} countries; informational only")
    print()
    for continent in CONTINENTS:
        subset = [r for r in inventory if r["continent"] == continent]
        n = sum(r["entries"] for r in subset)
        g = sum(r["gems"] for r in subset)
        print(f"{continent}: {n} entries, {g} gems "
              f"({100*g/n:.2f}% if entries exist), "
              f"{sum(r['entries'] == 0 for r in subset)} missing codes")
    print()
    missing = [r["code"] for r in inventory if not r["entries"]]
    print("missing: " + " ".join(missing))


def main():
    parser = argparse.ArgumentParser()
    parser.add_argument("--csv", action="store_true", help="emit the full matrix as CSV")
    args = parser.parse_args()
    inventory = rows()
    if args.csv:
        writer = csv.DictWriter(sys.stdout, fieldnames=inventory[0].keys(), lineterminator="\n")
        writer.writeheader()
        writer.writerows(inventory)
    else:
        print_summary(inventory)


if __name__ == "__main__":
    main()
