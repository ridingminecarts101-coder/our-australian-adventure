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
import sys

# Reference continent per country. Follows the standard geographic scheme:
# Central America and the Caribbean are part of North America; the Middle East
# is Asia; Indonesia and Timor-Leste are Asia, not Oceania.
REFERENCE = {
    # Oceania
    'AU': 'Oceania', 'NZ': 'Oceania', 'PG': 'Oceania', 'FJ': 'Oceania',
    'PF': 'Oceania', 'VU': 'Oceania', 'NC': 'Oceania', 'WS': 'Oceania',
    'TO': 'Oceania', 'CK': 'Oceania', 'SB': 'Oceania', 'PW': 'Oceania',
    'NU': 'Oceania', 'NF': 'Oceania', 'FM': 'Oceania', 'MH': 'Oceania',
    'KI': 'Oceania', 'TV': 'Oceania', 'NR': 'Oceania',
    # Asia
    'ID': 'Asia', 'TL': 'Asia', 'JP': 'Asia', 'KR': 'Asia', 'CN': 'Asia',
    'HK': 'Asia', 'SG': 'Asia',
    # Middle East - Western Asia, split out as its own travel region
    'AE': 'Middle East', 'OM': 'Middle East', 'JO': 'Middle East',
    'IL': 'Middle East', 'PS': 'Middle East', 'QA': 'Middle East',
    'SA': 'Middle East', 'BH': 'Middle East', 'KW': 'Middle East',
    'LB': 'Middle East', 'TR': 'Middle East',
    # Europe
    'GB': 'Europe', 'IE': 'Europe', 'FR': 'Europe', 'IT': 'Europe',
    'ES': 'Europe', 'PT': 'Europe', 'DE': 'Europe', 'CH': 'Europe',
    'AT': 'Europe', 'NL': 'Europe', 'NO': 'Europe', 'IS': 'Europe',
    'GR': 'Europe', 'CZ': 'Europe', 'HR': 'Europe', 'PL': 'Europe',
    'DK': 'Europe', 'SE': 'Europe',
    # North America - mainland
    'US': 'North America', 'CA': 'North America', 'MX': 'North America',
    # North America - Central America
    'GT': 'North America', 'BZ': 'North America', 'CR': 'North America',
    'PA': 'North America', 'NI': 'North America', 'HN': 'North America',
    'SV': 'North America',
    # North America - Caribbean
    'CU': 'North America', 'JM': 'North America', 'BS': 'North America',
    'DO': 'North America', 'PR': 'North America', 'BB': 'North America',
    'TT': 'North America', 'LC': 'North America', 'DM': 'North America',
    'KY': 'North America', 'TC': 'North America', 'AW': 'North America',
    'AG': 'North America', 'GD': 'North America', 'VG': 'North America',
    'VI': 'North America', 'HT': 'North America',
}

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
CENTROID = {
    'AU': (-25.0, 134.0), 'NZ': (-41.0, 174.0), 'PG': (-6.3, 144.0),
    'FJ': (-17.8, 178.0), 'PF': (-17.6, -149.4), 'VU': (-15.4, 167.0),
    'NC': (-21.3, 165.6), 'WS': (-13.6, -172.4), 'TO': (-21.2, -175.2),
    'CK': (-21.2, -159.8), 'SB': (-9.6, 160.2), 'PW': (7.5, 134.6),
    'NU': (-19.1, -169.9), 'NF': (-29.0, 167.9), 'FM': (7.4, 150.6),
    'MH': (7.1, 171.2), 'KI': (1.9, -157.4), 'TV': (-8.5, 179.2),
    'NR': (-0.5, 166.9),
    'ID': (-2.5, 118.0), 'TL': (-8.8, 125.7), 'JP': (36.2, 138.3),
    'KR': (36.5, 127.8), 'CN': (35.9, 104.2), 'HK': (22.3, 114.2),
    'SG': (1.35, 103.8),
    'AE': (24.0, 54.0), 'OM': (21.0, 57.0), 'JO': (31.2, 36.5),
    'IL': (31.4, 35.0), 'PS': (31.9, 35.3), 'QA': (25.3, 51.2),
    'SA': (24.0, 45.0), 'BH': (26.0, 50.5), 'KW': (29.3, 47.5),
    'LB': (33.9, 35.9), 'TR': (39.0, 35.0),
    'GB': (54.0, -2.0), 'IE': (53.4, -8.0), 'FR': (46.6, 2.5),
    'IT': (42.8, 12.6), 'ES': (40.2, -3.6), 'PT': (39.5, -8.0),
    'DE': (51.2, 10.4), 'CH': (46.8, 8.2), 'AT': (47.6, 14.1),
    'NL': (52.2, 5.4), 'NO': (61.0, 9.0), 'IS': (64.9, -19.0),
    'GR': (39.0, 22.0), 'CZ': (49.8, 15.5), 'HR': (45.1, 15.5),
    'PL': (52.0, 19.4), 'DK': (56.0, 10.0), 'SE': (60.0, 15.0),
    'US': (39.5, -98.5), 'CA': (56.0, -106.0), 'MX': (23.6, -102.5),
    'GT': (15.5, -90.3), 'BZ': (17.2, -88.7), 'CR': (9.7, -84.1),
    'PA': (8.5, -80.1), 'NI': (12.9, -85.2), 'HN': (15.2, -86.2),
    'SV': (13.8, -88.9),
    'CU': (21.5, -79.0), 'JM': (18.1, -77.3), 'BS': (24.5, -76.5),
    'DO': (18.7, -70.2), 'PR': (18.2, -66.4), 'BB': (13.2, -59.5),
    'TT': (10.5, -61.3), 'LC': (13.9, -61.0), 'DM': (15.4, -61.4),
    'KY': (19.3, -81.2), 'TC': (21.7, -71.8), 'AW': (12.5, -70.0),
    'AG': (17.1, -61.8), 'GD': (12.1, -61.7), 'VG': (18.4, -64.6),
    'VI': (18.0, -64.8), 'HT': (19.0, -72.3),
}


def load_boxes():
    """Pull CONTINENT_BOXES straight out of world.js so the two cannot drift."""
    src = io.open('world.js', encoding='utf-8').read()
    block = src[src.index('const CONTINENT_BOXES'):src.index('const COUNTRIES')]
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
