"""Merge data/src/*.jsonl into data/adventures.json, validating as it goes.

Run from the repo root:  python tools/build_data.py

Edit the per-region .jsonl files, run this, commit the result.
"""
import collections
import datetime
import glob
import io
import json
import os
import re
import sys

# Source files, in the order their entries should be numbered.
# Every .jsonl in data/src, discovered rather than listed.
#
# This used to be a hand-maintained list of names, which meant adding a source
# file did nothing at all until somebody remembered to add it here too - a
# silent no-op, the worst kind. Ordering carried no meaning once ids moved into
# data/ids.json keyed on country|place, so sorted order is as good as any and
# a new file now ships by existing.
SOURCES = sorted(
    os.path.splitext(os.path.basename(p))[0]
    for p in glob.glob(os.path.join('data', 'src', '*.jsonl'))
)

FIELDS = ['continent', 'country', 'admin1', 'region', 'title', 'place',
          'category', 'difficulty', 'cost', 'duration', 'season',
          'dog_friendly', 'hidden_gem', 'pack', 'lat', 'lon',
          'verified_at', 'description']

# Optional, defaulted at build time so existing entries need no edits.
# Tags drive cross-cutting collections: every Disney resort, every theme park,
# every Big Thing - things that span countries and don't fit a category.
OPTIONAL = {'tags': [], 'bundle_only': False}
KNOWN_TAGS = {'theme-park', 'disney', 'big-thing', 'world-heritage'}

CATEGORIES = {
    'Nature', 'Beach', 'Wildlife', 'Hiking', 'Water', 'Culture', 'History',
    'Food & Drink', 'Road Trip', 'Adrenaline', 'Island', 'Outback', 'Snow',
    'City', 'Family', 'Scenic', 'Stargazing',
}
CONTINENTS = {'Oceania', 'Europe', 'North America', 'South America', 'Asia',
              'Middle East', 'Africa', 'Antarctica'}
PACKS = {'oceania', 'europe', 'north-america', 'south-america', 'asia',
         'middle-east', 'africa', 'all'}
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


def stamp_listing(records):
    """Keep the store listing draft in PLAY.md in step with the data.

    PLAY.md holds the text to paste into the Play Console, and it quoted the
    number of adventures and countries by hand. It said 2,356 and 123 while the
    data went past 3,500 and 150 - a listing that undersells the app by a third,
    pasted in by somebody trusting the doc. Play caps the short description at
    80 characters, so the count written beside it is recomputed too rather than
    left to go wrong.
    """
    path = 'PLAY.md'
    if not os.path.exists(path):
        return
    total = len(records)
    destinations = len({r['country'] for r in records})
    places = f'{total // 100 * 100:,}+'
    text = io.open(path, encoding='utf-8').read()

    short = f'{places} adventures across {destinations} countries and territories. Tick them off together.'
    new = re.sub(r'(\*\*Short description\*\* \(80 max, )\d+( used\):\s*\n\s*> )[^\n]*',
                 lambda m: f'{m.group(1)}{len(short)}{m.group(2)}{short}', text)
    new = re.sub(r'worth the trip — [\d,]+\+? of\n> them, across \d+ countries(?: and territories)?',
                 f'worth the trip — {places} of\n> them, across {destinations} countries and territories', new)

    if new != text:
        io.open(path, 'w', encoding='utf-8', newline=chr(10)).write(new)
        print(f'  updated the store listing counts in PLAY.md ({places}, {destinations} countries and territories)')


def is_available(record):
    """Return whether a stored row belongs in discovery and public counts."""
    return record.get('availability', {}).get('status') != 'unavailable'


IDS = os.path.join('data', 'ids.json')
AVAILABILITY = os.path.join('data', 'availability.json')


def apply_availability(records, path=AVAILABILITY, ids_path=IDS):
    """Attach reviewed per-ID availability without removing catalogue rows."""
    if not os.path.exists(path):
        return [f'{path}: availability sidecar is missing']
    try:
        payload = json.load(io.open(path, encoding='utf-8'))
    except (OSError, json.JSONDecodeError) as exc:
        return [f'{path}: cannot read availability sidecar - {exc}']
    if not isinstance(payload, dict) or payload.get('version') != 1 \
            or not isinstance(payload.get('entries'), list):
        return [f'{path}: expected version 1 with an entries list']

    registry = json.load(io.open(ids_path, encoding='utf-8'))['ids']
    records_by_key = {f"{row.get('country')}|{row.get('place')}": row for row in records}
    active_keys_by_id = collections.defaultdict(list)
    for identity in records_by_key:
        if identity in registry:
            active_keys_by_id[registry[identity]].append(identity)
    seen, problems, candidates = set(), [], []
    required = {'id', 'status', 'reason', 'reviewed_at', 'source'}
    allowed = required | {'replacement_id'}
    for index, entry in enumerate(payload['entries'], 1):
        where = f'{path}:entries[{index}]'
        if not isinstance(entry, dict):
            problems.append(f'{where}: entry must be an object')
            continue
        missing = required - set(entry)
        extra = set(entry) - allowed
        if missing:
            problems.append(f'{where}: missing {", ".join(sorted(missing))}')
        if extra:
            problems.append(f'{where}: unknown {", ".join(sorted(extra))}')
        record_id = entry.get('id')
        if type(record_id) is not int:
            problems.append(f'{where}: id must be an integer')
        elif record_id in seen:
            problems.append(f'{where}: duplicate id {record_id}')
        else:
            seen.add(record_id)
        active_keys = active_keys_by_id.get(record_id, [])
        identity = active_keys[0] if len(active_keys) == 1 else None
        if not active_keys:
            problems.append(f'{where}: id {record_id!r} is not a current catalogue row')
        elif len(active_keys) != 1:
            problems.append(f'{where}: id {record_id!r} resolves to {len(active_keys)} active catalogue rows')
        if entry.get('status') not in {'available', 'unavailable'}:
            problems.append(f'{where}: status must be available or unavailable')
        if len(str(entry.get('reason') or '').strip()) < 20:
            problems.append(f'{where}: reason must explain the reviewed operational status')
        reviewed_at = str(entry.get('reviewed_at') or '')
        valid_date = bool(re.fullmatch(r'\d{4}-\d{2}-\d{2}', reviewed_at))
        if valid_date:
            try:
                datetime.date.fromisoformat(reviewed_at)
            except ValueError:
                valid_date = False
        if not valid_date:
            problems.append(f'{where}: reviewed_at must be YYYY-MM-DD')
        source = entry.get('source')
        if not isinstance(source, dict) or set(source) != {'type', 'publisher', 'url'}:
            problems.append(f'{where}: source must contain only type, publisher and url')
        elif source.get('type') != 'primary' or not str(source.get('publisher') or '').strip() \
                or not str(source.get('url') or '').startswith('https://'):
            problems.append(f'{where}: source must be a named primary publisher with an HTTPS URL')
        replacement_id = entry.get('replacement_id')
        if replacement_id is not None:
            if type(replacement_id) is not int:
                problems.append(f'{where}: replacement_id must be an integer')
            elif replacement_id == record_id:
                problems.append(f'{where}: replacement_id must name a different row')
            elif len(active_keys_by_id.get(replacement_id, [])) != 1:
                problems.append(f'{where}: replacement_id {replacement_id!r} must resolve to exactly one current row')
            if entry.get('status') != 'unavailable':
                problems.append(f'{where}: only an unavailable listing may name a replacement_id')
        if not any(problem.startswith(where) for problem in problems):
            candidates.append((where, identity, entry))

    entries_by_id = {entry.get('id'): entry for entry in payload['entries']
                     if isinstance(entry, dict) and type(entry.get('id')) is int}
    replacement_map = {}
    for where, _, entry in candidates:
        replacement_id = entry.get('replacement_id')
        if replacement_id is None:
            continue
        target = entries_by_id.get(replacement_id)
        if target and target.get('status') == 'unavailable':
            problems.append(f'{where}: replacement_id {replacement_id} is also unavailable')
        replacement_map[entry['id']] = replacement_id
    for start in replacement_map:
        visited, current = set(), start
        while current in replacement_map:
            if current in visited:
                problems.append(f'{path}: replacement_id cycle includes {current}')
                break
            visited.add(current)
            current = replacement_map[current]

    if problems:
        return problems
    for _, identity, entry in candidates:
        records_by_key[identity]['availability'] = {
            'status': entry['status'], 'reason': entry['reason'].strip(),
            'reviewed_at': entry['reviewed_at'], 'source': entry['source'],
        }
        if entry.get('replacement_id') is not None:
            records_by_key[identity]['availability']['replacement_id'] = entry['replacement_id']
    return []


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
                if not re.fullmatch(r'Check dates|Year-round|%s|%s-%s' % (MONTHS_RE, MONTHS_RE, MONTHS_RE),
                                    season):
                    problems.append(f'{where}: season {season!r} is not Check dates, a month range or Year-round')
                if rec.get('dog_friendly') not in DOG:
                    problems.append(f'{where}: dog_friendly must be yes/no/check')
                if not isinstance(rec.get('difficulty'), int) or not 1 <= rec['difficulty'] <= 5:
                    problems.append(f'{where}: difficulty must be 1-5')
                if rec.get('cost') is not None and (not isinstance(rec.get('cost'), int)
                                                    or not 0 <= rec['cost'] <= 4):
                    problems.append(f'{where}: cost must be null or 0-4')
                if not isinstance(rec.get('hidden_gem'), bool):
                    problems.append(f'{where}: hidden_gem must be true/false')
                if not isinstance(rec.get('bundle_only'), bool):
                    problems.append(f'{where}: bundle_only must be true/false')
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
                if rec.get('pack') and rec.get('pack') not in PACKS:
                    problems.append(f'{where}: unknown pack {rec.get("pack")!r}')
                if rec.get('country') == 'AQ':
                    if not rec.get('bundle_only'):
                        problems.append(f'{where}: every Antarctica entry must be bundle_only')
                    if rec.get('hidden_gem') and rec.get('pack') != 'all':
                        problems.append(f'{where}: Antarctica gems belong to the all bundle')
                elif rec.get('bundle_only'):
                    problems.append(f'{where}: bundle_only is reserved for Antarctica')

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
    problems.extend(apply_availability(records))
    if problems:
        print(f'{len(problems)} problem(s):', file=sys.stderr)
        for p in problems[:40]:
            print('  ' + p, file=sys.stderr)
        if len(problems) > 40:
            print(f'  ... and {len(problems) - 40} more', file=sys.stderr)
        return 1

    assign_ids(records)
    ordered = []
    for r in records:
        row = {k: r[k] for k in ['id'] + FIELDS + list(OPTIONAL)}
        if 'availability' in r:
            row['availability'] = r['availability']
        ordered.append(row)

    os.makedirs('data', exist_ok=True)
    with open(os.path.join('data', 'adventures.json'), 'w', encoding='utf-8') as fh:
        json.dump(ordered, fh, ensure_ascii=False, indent=1)

    by_continent = collections.Counter(r['continent'] for r in records)
    by_country = collections.Counter(r['country'] for r in records)
    dogs = collections.Counter(r['dog_friendly'] for r in records)
    gems = sum(1 for r in records if r['hidden_gem'])

    available = [r for r in records if is_available(r)]
    stamp_counts(len(available))
    stamp_listing(available)
    print(f'{len(records)} stored adventures written to data/adventures.json')
    print(f'  available in discovery: {len(available)}')
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
