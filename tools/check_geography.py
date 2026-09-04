"""Check that every country sits in the continent it claims, two ways over.

  1. Against a reference table of ISO 3166-1 alpha-2 -> continent.
  2. Against the lat/lon boxes in world.js that draw the map and decide which
     continent a tap lands on - because if those disagree with the data, the
     map sends people to the wrong place.

Run from the repo root:  python tools/check_geography.py
"""
import io
import json
import re
import os
import sys

sys.path.insert(0, os.path.dirname(os.path.abspath(__file__)))
from countries import COUNTRIES as REGISTRY          # noqa: E402

# Reference continent per country. Follows the standard geographic scheme:
# Central America and the Caribbean are part of North America; the Middle East
# is Asia; Indonesia and Timor-Leste are Asia, not Oceania.
# Both tables come from tools/countries.py so there is one list of countries
# in the project rather than three that drift apart.
REFERENCE = {code: v[1] for code, v in REGISTRY.items()}

# Judgement calls worth stating out loud rather than burying.
NOTES = {
    'TT': 'Trinidad sits on the South American shelf but is grouped with the '
          'Caribbean, and so with North America. Standard, but a choice.',
    'AW': 'Aruba likewise sits off the South American coast; Caribbean grouping.',
    'ID': 'Transcontinental - mostly Asia, with Papua in Oceania. Filed under Asia.',
    'TR': 'Transcontinental. Istanbul west of the Bosphorus resolves to Europe '
          'on the map; the rest of Anatolia to the Middle East.',
    'IL': 'Jerusalem Old City sits in East Jerusalem, which most of the world '
          'regards as occupied. The entry says so rather than skirting it.',
    'HK': 'Listed separately from China because it has its own ISO code and its '
          'own entry requirements.',
}

# Rough centroid per country, only used to test the map boxes.
CENTROID = {code: (v[2], v[3]) for code, v in REGISTRY.items()}


def load_boxes():
    """Pull CONTINENT_BOXES straight out of world.js so the two cannot drift."""
    src = io.open('world.js', encoding='utf-8').read()
    block = src[src.index('const CONTINENT_BOXES'):src.index('const ISLAND_GROUP')]
    boxes = {}
    for name, body in re.findall(r"'([^']+)': \[(.*?)\n  \]", block, re.S):
        boxes[name] = [tuple(float(n) for n in row)
                       for row in re.findall(r'\[\s*(-?[\d.]+),\s*(-?[\d.]+),\s*'
                                             r'(-?[\d.]+),\s*(-?[\d.]+)\s*\]', body)]
    return boxes


def continent_at(boxes, lat, lon):
    for name, rows in boxes.items():
        for s, n, w, e in rows:
            if s <= lat <= n and w <= lon <= e:
                return name
    return None


def main():
    data = json.load(io.open('data/adventures.json', encoding='utf-8'))
    boxes = load_boxes()

    assigned = {}
    for a in data:
        assigned.setdefault(a['country'], set()).add(a['continent'])

    problems, warnings = [], []

    # 1. Every country consistent with itself
    for code, conts in sorted(assigned.items()):
        if len(conts) > 1:
            problems.append(f'{code} is filed under more than one continent: {sorted(conts)}')

    # 2. Every country matches the reference table
    for code, conts in sorted(assigned.items()):
        want = REFERENCE.get(code)
        if want is None:
            problems.append(f'{code} has no entry in the reference table - add one')
        elif want not in conts:
            problems.append(f'{code} filed under {sorted(conts)[0]}, should be {want}')

    # 3. The map boxes agree with the data
    for code, conts in sorted(assigned.items()):
        if code not in CENTROID:
            warnings.append(f'{code} has no centroid, so the map box was not checked')
            continue
        lat, lon = CENTROID[code]
        hit = continent_at(boxes, lat, lon)
        want = sorted(conts)[0]
        if hit is None:
            problems.append(f'{code} ({want}) falls in NO map box - tapping its '
                            f'region on the map will not find it')
        elif hit != want:
            problems.append(f'{code} is filed as {want} but its coordinates land '
                            f'in the {hit} box on the map')

    print(f'{len(data)} adventures across {len(assigned)} countries\n')
    if warnings:
        print('Warnings:')
        for w in warnings:
            print('  ! ' + w)
        print()
    if problems:
        print('PROBLEMS:')
        for p in problems:
            print('  x ' + p)
        return 1

    print('All countries sit in the right continent, and every one of them')
    print('lands inside its own continent box on the map.\n')
    print('Judgement calls, stated deliberately:')
    for code, note in sorted(NOTES.items()):
        if code in assigned:
            print(f'  {code}  {note}')
    return 0


if __name__ == '__main__':
    raise SystemExit(main())
