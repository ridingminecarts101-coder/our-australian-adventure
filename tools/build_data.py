"""Merge data/src/*.jsonl into data/adventures.json, validating as it goes.

Run from the repo root:  python tools/build_data.py

Edit the per-region .jsonl files, run this, commit the result.
"""
import collections
import io
import json
import os
import re
import sys

# Source files, in the order their entries should be numbered.
SOURCES = [
    # Oceania
    'sa', 'vic', 'nsw', 'qld', 'wa', 'tas', 'nt', 'act', 'aus',
    'nz', 'nz-north', 'nz-south', 'oceania-islands',
    # Europe
    'europe',
    'europe-fr',
    'europe-it',
    'europe-es',
    'europe-gb',
    'europe-de',
    'europe-gr',
    'europe-west2',
    'europe-nordic',
    'europe-central',
    # North America
    'us-west', 'us-southwest', 'us-east',
    'canada', 'mexico',
    'central-america', 'caribbean',
    # Asia
    'asia', 'indonesia',
    'asia-jp',
    'asia-sea',
    'asia-south-east',
    # Middle East
    'middle-east',
    # Cross-cutting collections
    'theme-parks',
    'food',
    'us-fill', 'us-fill2', 'us-fill3', 'us-fill4', 'world-fill',
]

FIELDS = ['continent', 'country', 'admin1', 'region', 'title', 'place',
          'category', 'difficulty', 'cost', 'duration', 'season',
          'dog_friendly', 'hidden_gem', 'pack', 'lat', 'lon',
          'verified_at', 'description']

# Optional, defaulted at build time so existing entries need no edits.
# Tags drive cross-cutting collections: every Disney resort, every theme park,
# every Big Thing - things that span countries and don't fit a category.
OPTIONAL = {'tags': []}
KNOWN_TAGS = {'theme-park', 'disney', 'big-thing', 'world-heritage'}

CATEGORIES = {
    'Nature', 'Beach', 'Wildlife', 'Hiking', 'Water', 'Culture', 'History',
    'Food & Drink', 'Road Trip', 'Adrenaline', 'Island', 'Outback', 'Snow',
    'City', 'Family', 'Scenic', 'Stargazing',
}
CONTINENTS = {'Oceania', 'Europe', 'North America',
              'South America', 'Asia', 'Middle East', 'Africa'}
DOG = {'yes', 'no', 'check'}
MONTHS_RE = '(?:Jan|Feb|Mar|Apr|May|Jun|Jul|Aug|Sep|Oct|Nov|Dec)'


def stamp_counts(total):
    """Keep the human-facing counts in step with the data.

    The manifest and the page description both quote a number of adventures.
    Written by hand they go stale the moment a country is added, and a store
    listing that undersells the app by eight hundred entries is a poor look.
    """
    phrase = f'{total // 100 * 100:,}+ real places worth going, ticked off together.'
    m = io.open('manifest.json', encoding='utf-8').read()
    m2 = re.sub(r'"description": "[^"]*"', f'"description": "{phrase}"', m)
    if m2 != m:
        io.open('manifest.json', 'w', encoding='utf-8', newline=chr(10)).write(m2)
        print('  updated the count in manifest.json')

    h = io.open('index.html', encoding='utf-8').read()
    h2 = re.sub(r'(name="description" content="Wayfinder — )[^"]*',
                lambda mo: mo.group(1) + phrase, h)
    if h2 != h:
        io.open('index.html', 'w', encoding='utf-8', newline=chr(10)).write(h2)
        print('  updated the count in index.html')


IDS = os.path.join('data', 'ids.json')


def assign_ids(records):
    """Hand each record the id it has always had.

    Ids used to be the position in the merged list, so adding a source file
    renumbered everything after it and silently repointed people's saved ticks
    at different adventures. They now come from data/ids.json, keyed on
    country|place, which is already unique. New entries take the next number;
    nothing that exists ever moves.
    """
    reg = json.load(io.open(IDS, encoding='utf-8'))
    ids, nxt = reg['ids'], reg['next']

    fresh, moved = [], []
    for rec in records:
        key = f"{rec['country']}|{rec['place']}"
        if key in ids:
            rec['id'] = ids[key]
        else:
            rec['id'] = nxt
            ids[key] = nxt
            fresh.append(key)
            nxt += 1

    # An entry that disappears keeps its number reserved, so a later entry
    # cannot inherit somebody's tick on a place that no longer exists.
    gone = sorted(set(ids) - {f"{r['country']}|{r['place']}" for r in records})

    reg['ids'] = dict(sorted(ids.items()))
    reg['next'] = nxt
    io.open(IDS, 'w', encoding='utf-8', newline='\n').write(
        json.dumps(reg, ensure_ascii=False, indent=1) + '\n')

    if fresh:
        print(f'  {len(fresh)} new id(s) issued, now up to {nxt - 1}')
    if gone:
        print(f'  {len(gone)} id(s) retired and reserved: '
              + ', '.join(gone[:4]) + ('…' if len(gone) > 4 else ''))
    return records


def load():
    records, problems = [], []
    for name in SOURCES:
        path = os.path.join('data', 'src', f'{name}.jsonl')
        if not os.path.exists(path):
            continue                      # a continent with no content yet is fine
        with open(path, encoding='utf-8') as fh:
            for lineno, line in enumerate(fh, 1):
                line = line.strip()
                if not line:
                    continue
                where = f'{path}:{lineno}'
                try:
                    rec = json.loads(line)
                except json.JSONDecodeError as exc:
                    problems.append(f'{where}: invalid JSON - {exc}')
                    continue

                for field in FIELDS:
                    if field not in rec:
                        problems.append(f'{where}: missing "{field}"')
                for field, default in OPTIONAL.items():
                    rec.setdefault(field, default if not isinstance(default, list) else list(default))
                if not isinstance(rec['tags'], list):
                    problems.append(f'{where}: tags must be a list')
                else:
                    for t in rec['tags']:
                        if t not in KNOWN_TAGS:
                            problems.append(f'{where}: unknown tag {t!r}')
                if rec.get('continent') not in CONTINENTS:
                    problems.append(f'{where}: unknown continent {rec.get("continent")!r}')
                if not isinstance(rec.get('country'), str) or len(rec.get('country', '')) != 2:
                    problems.append(f'{where}: country must be a 2-letter ISO code')
                if rec.get('category') not in CATEGORIES:
                    problems.append(f'{where}: unknown category {rec.get("category")!r}')
                # A season has to be a month, a month range, or year-round.
                # Opening days were being written here, which made an entry
                # invisible to the seasonal reminder or matched every month.
                season = str(rec.get('season', ''))
                if not re.fullmatch(r'Year-round|%s|%s-%s' % (MONTHS_RE, MONTHS_RE, MONTHS_RE),
                                    season):
                    problems.append(f'{where}: season {season!r} is not a month range')
                if rec.get('dog_friendly') not in DOG:
                    problems.append(f'{where}: dog_friendly must be yes/no/check')
                if not isinstance(rec.get('difficulty'), int) or not 1 <= rec['difficulty'] <= 5:
                    problems.append(f'{where}: difficulty must be 1-5')
                if not isinstance(rec.get('cost'), int) or not 0 <= rec['cost'] <= 4:
                    problems.append(f'{where}: cost must be 0-4')
                if not isinstance(rec.get('hidden_gem'), bool):
                    problems.append(f'{where}: hidden_gem must be true/false')
                for coord in ('lat', 'lon'):
                    v = rec.get(coord)
                    if v is not None and not isinstance(v, (int, float)):
                        problems.append(f'{where}: {coord} must be a number or null')
                # A paid entry with no pack, or a pack on a free entry, is a
                # pricing bug waiting to happen - catch it here.
                if rec.get('hidden_gem') and not rec.get('pack'):
                    problems.append(f'{where}: hidden_gem entries need a pack')
                if rec.get('pack') and not rec.get('hidden_gem'):
                    problems.append(f'{where}: only hidden_gem entries belong to a pack')

                records.append(rec)

    # A region written two ways is two regions as far as the app is concerned,
    # and whoever lives in the smaller half sees a stub. Catch the forms that
    # differ only by case or punctuation before they reach anyone.
    import re as _re
    seen_admin = collections.defaultdict(dict)
    for r in records:
        key = _re.sub(r'[^a-z]', '', str(r.get('admin1', '')).lower())
        seen_admin[r.get('country')].setdefault(key, set()).add(r.get('admin1'))
    for country, groups in seen_admin.items():
        for key, forms in groups.items():
            if len(forms) > 1:
                problems.append(f'{country}: region written {len(forms)} ways: '
                                + ', '.join(sorted(map(repr, forms))))

    # Place names repeat legitimately across countries - there is a Kingston in
    # Tasmania and another on Norfolk Island - so scope that check per country.
    for (country, place), count in collections.Counter(
            (r.get('country'), r.get('place')) for r in records).items():
        if count > 1:
            problems.append(f'duplicate place in {country}: {place!r} appears {count} times')
    # Titles are descriptive, so a global collision usually means duplicated work.
    for title, count in collections.Counter(r.get('title') for r in records).items():
        if count > 1:
            problems.append(f'duplicate title: {title!r} appears {count} times')

    return records, problems


def main():
    records, problems = load()
    if problems:
        print(f'{len(problems)} problem(s):', file=sys.stderr)
        for p in problems[:40]:
            print('  ' + p, file=sys.stderr)
        if len(problems) > 40:
            print(f'  ... and {len(problems) - 40} more', file=sys.stderr)
        return 1

    assign_ids(records)
    ordered = [{k: r[k] for k in ['id'] + FIELDS + list(OPTIONAL)} for r in records]

    os.makedirs('data', exist_ok=True)
    with open(os.path.join('data', 'adventures.json'), 'w', encoding='utf-8') as fh:
        json.dump(ordered, fh, ensure_ascii=False, indent=1)

    by_continent = collections.Counter(r['continent'] for r in records)
    by_country = collections.Counter(r['country'] for r in records)
    dogs = collections.Counter(r['dog_friendly'] for r in records)
    gems = sum(1 for r in records if r['hidden_gem'])

    stamp_counts(len(records))
    print(f'{len(records)} adventures written to data/adventures.json')
    print('  continents: ' + ', '.join(f'{k} {v}' for k, v in by_continent.most_common()))
    print('  countries:  ' + ', '.join(f'{k} {v}' for k, v in by_country.most_common()))
    print(f'  hidden gems (paid): {gems}')
    print('  dog friendly: ' + ', '.join(f'{k} {v}' for k, v in dogs.most_common()))
    tagged = collections.Counter(t for r in records for t in r['tags'])
    if tagged:
        print('  tags: ' + ', '.join(f'{k} {v}' for k, v in tagged.most_common()))
    print('\nRemember to bump CACHE_VERSION in sw.js so phones pick up the new data.')
    return 0


if __name__ == '__main__':
    raise SystemExit(main())
