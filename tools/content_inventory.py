"""Report Wayfinder country and continent coverage from generated content.

This is an editorial planning check. It never rewrites source rows or ids. The
``minimum_gem_additions`` figure assumes every added row is a genuine hidden
gem and solves (gems + x) / (entries + x) >= 20%.

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


ROOT = os.path.dirname(os.path.dirname(os.path.abspath(__file__)))
DATA = os.path.join(ROOT, "data", "adventures.json")
COUNTRIES_FILE = os.path.join(ROOT, "tools", "countries.py")
CONTINENTS = ("Oceania", "Asia", "Middle East", "Europe",
              "North America", "South America", "Africa", "Antarctica")

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
    """Minimum gem-only rows needed for an exact one-in-five share.

    Integer arithmetic avoids floating-point overstatement at exact boundaries.
    Solving 5(g + x) >= n + x gives x >= (n - 5g) / 4.
    """
    return max(0, (entries - 5 * gems + 3) // 4)


def rows():
    countries, advisories = load_countries()
    adventures = json.load(io.open(DATA, encoding="utf-8"))
    counts = collections.Counter(a["country"] for a in adventures)
    gems = collections.Counter(a["country"] for a in adventures if a["hidden_gem"])
    regions = collections.defaultdict(set)
    for adventure in adventures:
        regions[adventure["country"]].add(adventure.get("admin1"))

    out = []
    for code, (name, continent, _lat, _lon) in countries.items():
        n, g = counts[code], gems[code]
        out.append({
            "continent": continent,
            "code": code,
            "country_or_territory": name,
            "un_member_or_observer_state": code in UN_STATE_CODES,
            "entries": n,
            "regions": len(regions[code]),
            "gems": g,
            "gem_percent": round(100 * g / n, 2) if n else 0,
            "minimum_gem_additions": additions_needed(n, g),
            "advisory": advisories.get(code, ("", ""))[0],
            "coverage": "missing" if not n else "thin" if n < 5 else "present",
        })
    return out


def print_summary(inventory):
    registry_codes = {r['code'] for r in inventory}
    populated_codes = {r['code'] for r in inventory if r['entries']}
    print("Wayfinder content inventory")
    print(f"registry codes: {len(inventory)}")
    print(f"populated codes: {sum(r['entries'] > 0 for r in inventory)}")
    print(f"missing codes: {sum(r['entries'] == 0 for r in inventory)}")
    print(f"entries: {sum(r['entries'] for r in inventory)}")
    print(f"gems: {sum(r['gems'] for r in inventory)}")
    print(f"UN member/observer states represented in registry: "
          f"{len(UN_STATE_CODES & registry_codes)}/{len(UN_STATE_CODES)}")
    print(f"UN member/observer states populated: "
          f"{len(UN_STATE_CODES & populated_codes)}/{len(UN_STATE_CODES)}")
    print("UN member/observer states absent from registry: " +
          " ".join(sorted(UN_STATE_CODES - registry_codes)))
    print("minimum new gem-only rows for populated countries to reach 20%: "
          f"{sum(r['minimum_gem_additions'] for r in inventory if r['entries'])}")
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
