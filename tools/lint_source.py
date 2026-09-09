# -*- coding: utf-8 -*-
"""Check one or more data/src/*.jsonl files without building anything.

build_data.py validates too, but it validates everything at once and writes
data/ids.json on the way through, so it cannot be run while other work is
still producing source files - two builds racing on the id registry is how ids
move, and moving an id silently repoints somebody's saved tick at a different
place.

This reads. It writes nothing and takes nothing else's lock, so a file can be
checked the moment it appears.

    python tools/lint_source.py                     every source file
    python tools/lint_source.py data/src/new.jsonl  just this one

ASCII output: the Windows console is cp1252 and raises on a box character
rather than degrading.
"""
import collections
import glob
import io
import json
import os
import re
import sys

ROOT = os.path.dirname(os.path.dirname(os.path.abspath(__file__)))
os.chdir(ROOT)

FIELDS = ['continent', 'country', 'admin1', 'region', 'title', 'place',
          'category', 'difficulty', 'cost', 'duration', 'season',
          'dog_friendly', 'hidden_gem', 'pack', 'lat', 'lon',
          'verified_at', 'description']
OPTIONAL = {'tags'}
CATEGORIES = {
    'Nature', 'Beach', 'Wildlife', 'Hiking', 'Water', 'Culture', 'History',
    'Food & Drink', 'Road Trip', 'Adrenaline', 'Island', 'Outback', 'Snow',
    'City', 'Family', 'Scenic', 'Stargazing',
}
CONTINENTS = {'Oceania', 'Europe', 'North America',
              'South America', 'Asia', 'Middle East', 'Africa'}
PACKS = {'oceania', 'europe', 'north-america', 'south-america',
         'asia', 'middle-east', 'africa'}
DOG = {'yes', 'no', 'check'}
M = '(?:Jan|Feb|Mar|Apr|May|Jun|Jul|Aug|Sep|Oct|Nov|Dec)'
SEASON = re.compile(r'Year-round|%s|%s-%s' % (M, M, M))

# Which pack a continent's gems belong in. A gem filed under the wrong pack is
# content somebody paid for and cannot see.
PACK_FOR = {
    'Oceania': 'oceania', 'Europe': 'europe', 'North America': 'north-america',
    'South America': 'south-america', 'Asia': 'asia',
    'Middle East': 'middle-east', 'Africa': 'africa',
}


def load_all_places():
    """Every (country, place) already claimed, across every source file.

    place is half the id key, so a duplicate does not merely look untidy - the
    second entry takes the first one's id and one of them disappears.
    """
    seen = {}
    for path in sorted(glob.glob(os.path.join('data', 'src', '*.jsonl'))):
        for i, line in enumerate(io.open(path, encoding='utf-8'), 1):
            line = line.strip()
            if not line or line.startswith('//'):
                continue
            try:
                r = json.loads(line)
            except ValueError:
                continue
            key = (r.get('country'), r.get('place'))
            seen.setdefault(key, []).append('%s:%d' % (os.path.basename(path), i))
    return seen


def check(path, all_places):
    problems, records = [], []
    for i, raw in enumerate(io.open(path, encoding='utf-8'), 1):
        line = raw.strip()
        if not line or line.startswith('//'):
            continue
        where = '%s:%d' % (os.path.basename(path), i)
        try:
            r = json.loads(line)
        except ValueError as e:
            problems.append('%s: not valid JSON - %s' % (where, e))
            continue

        for f in FIELDS:
            if f not in r:
                problems.append('%s: missing "%s"' % (where, f))
        for f in r:
            if f not in FIELDS and f not in OPTIONAL:
                problems.append('%s: unexpected field "%s"' % (where, f))

        if r.get('continent') not in CONTINENTS:
            problems.append('%s: continent %r' % (where, r.get('continent')))
        if not isinstance(r.get('country'), str) or len(r.get('country', '')) != 2 \
                or not r['country'].isupper():
            problems.append('%s: country %r must be a 2-letter uppercase code'
                            % (where, r.get('country')))
        if r.get('category') not in CATEGORIES:
            problems.append('%s: category %r' % (where, r.get('category')))
        if not SEASON.fullmatch(str(r.get('season', ''))):
            problems.append('%s: season %r is not a month or range' % (where, r.get('season')))
        if r.get('dog_friendly') not in DOG:
            problems.append('%s: dog_friendly %r' % (where, r.get('dog_friendly')))
        if not isinstance(r.get('difficulty'), int) or not 1 <= r['difficulty'] <= 5:
            problems.append('%s: difficulty %r' % (where, r.get('difficulty')))
        if not isinstance(r.get('cost'), int) or not 0 <= r['cost'] <= 4:
            problems.append('%s: cost %r' % (where, r.get('cost')))
        if not isinstance(r.get('hidden_gem'), bool):
            problems.append('%s: hidden_gem %r' % (where, r.get('hidden_gem')))
        if r.get('hidden_gem') and not r.get('pack'):
            problems.append('%s: a gem with no pack' % where)
        if r.get('pack') and not r.get('hidden_gem'):
            problems.append('%s: a pack on a free entry' % where)
        if r.get('pack') and r['pack'] not in PACKS:
            problems.append('%s: pack %r' % (where, r.get('pack')))
        want = PACK_FOR.get(r.get('continent'))
        if r.get('hidden_gem') and want and r.get('pack') != want:
            problems.append('%s: gem in %s belongs in pack %r, not %r'
                            % (where, r['continent'], want, r.get('pack')))
        for c in ('lat', 'lon'):
            if r.get(c) is not None:
                problems.append('%s: %s must be null' % (where, c))
        if not str(r.get('description', '')).strip():
            problems.append('%s: empty description' % where)
        if len(str(r.get('title', ''))) > 90:
            problems.append('%s: title is %d chars' % (where, len(r['title'])))

        dupes = all_places.get((r.get('country'), r.get('place')), [])
        if len(dupes) > 1:
            problems.append('%s: place %r is used %d times in %s - it is half '
                            'the id key and one of them will vanish'
                            % (where, r.get('place'), len(dupes), r.get('country')))

        records.append(r)

    return records, problems


def gem_ratios(records):
    """Gems must stay under a fifth of each region.

    Counted across every source file at once, never per file. A region's
    entries are routinely spread over several - a US state appears in
    us-fill, us-fill2 and us-fill3 - so a single file holding one gem and one
    Wisconsin entry looks like a total paywall and is nothing of the kind.
    Scoping this check to a file gets it wrong every time.
    """
    out = []
    by_region = collections.defaultdict(list)
    for r in records:
        by_region[(r.get('country'), r.get('admin1'))].append(r)
    for (country, admin1), rows in sorted(by_region.items()):
        gems = sum(1 for r in rows if r.get('hidden_gem'))
        if gems and gems * 5 > len(rows):
            out.append('%s/%s: %d gems of %d - over one in five'
                       % (country, admin1, gems, len(rows)))
    return out


def main():
    targets = sys.argv[1:] or sorted(glob.glob(os.path.join('data', 'src', '*.jsonl')))
    all_places = load_all_places()
    total, bad, everything = 0, 0, []

    for path in targets:
        records, problems = check(path, all_places)
        everything.extend(records)
        total += len(records)
        bad += len(problems)
        by_country = collections.Counter(r.get('country') for r in records)
        print('\n  %s' % path)
        print('    %d entries, %d countries, %d gems' % (
            len(records), len(by_country),
            sum(1 for r in records if r.get('hidden_gem'))))
        print('    ' + '  '.join('%s %d' % (c, n) for c, n in sorted(by_country.items())))
        for p in problems[:25]:
            print('    ! %s' % p)
        if len(problems) > 25:
            print('    ! ...and %d more' % (len(problems) - 25))

    # Ratios last, and only when the whole set was checked - looking at one
    # file tells you nothing true about a region that spans four.
    ratio = gem_ratios(everything) if len(targets) > 1 else []
    if ratio:
        print('\n  Regions that are more than a fifth paid:')
        for r in ratio[:25]:
            print('    ! %s' % r)
        if len(ratio) > 25:
            print('    ! ...and %d more' % (len(ratio) - 25))
        bad += len(ratio)

    print('\n  %d entries checked, %d problems\n' % (total, bad))
    sys.exit(1 if bad else 0)


if __name__ == '__main__':
    main()
