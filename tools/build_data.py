"""Merge data/src/*.jsonl into data/adventures.json, validating as it goes.

Run from the repo root:  python tools/build_data.py

Edit the per-state .jsonl files, run this, commit the result.
"""
import collections
import json
import os
import sys

ORDER = ['sa', 'vic', 'nsw', 'qld', 'wa', 'tas', 'nt', 'act', 'aus']

FIELDS = ['title', 'place', 'state', 'region', 'category',
          'difficulty', 'cost', 'duration', 'season', 'hidden_gem', 'description']

CATEGORIES = {
    'Nature', 'Beach', 'Wildlife', 'Hiking', 'Water', 'Culture', 'History',
    'Food & Drink', 'Road Trip', 'Adrenaline', 'Island', 'Outback', 'Snow',
    'City', 'Family', 'Scenic', 'Stargazing',
}
STATES = {'SA', 'VIC', 'NSW', 'QLD', 'WA', 'TAS', 'NT', 'ACT', 'AUS'}


def load():
    records, problems = [], []
    for name in ORDER:
        path = os.path.join('data', 'src', f'{name}.jsonl')
        if not os.path.exists(path):
            problems.append(f'{path}: missing')
            continue
        with open(path, encoding='utf-8') as fh:
            for lineno, line in enumerate(fh, 1):
                line = line.strip()
                if not line:
                    continue
                where = f'{path}:{lineno}'
                try:
                    rec = json.loads(line)
                except json.JSONDecodeError as exc:
                    problems.append(f'{where}: invalid JSON — {exc}')
                    continue
                for field in FIELDS:
                    if field not in rec:
                        problems.append(f'{where}: missing "{field}"')
                if rec.get('category') not in CATEGORIES:
                    problems.append(f'{where}: unknown category {rec.get("category")!r}')
                if rec.get('state') not in STATES:
                    problems.append(f'{where}: unknown state {rec.get("state")!r}')
                if not isinstance(rec.get('difficulty'), int) or not 1 <= rec['difficulty'] <= 5:
                    problems.append(f'{where}: difficulty must be 1-5')
                if not isinstance(rec.get('cost'), int) or not 0 <= rec['cost'] <= 4:
                    problems.append(f'{where}: cost must be 0-4')
                if not isinstance(rec.get('hidden_gem'), bool):
                    problems.append(f'{where}: hidden_gem must be true/false')
                records.append(rec)

    for key in ('place', 'title'):
        for value, count in collections.Counter(r.get(key) for r in records).items():
            if count > 1:
                problems.append(f'duplicate {key}: {value!r} appears {count} times')

    return records, problems


def main():
    records, problems = load()
    if problems:
        print(f'{len(problems)} problem(s):', file=sys.stderr)
        for p in problems[:40]:
            print('  ' + p, file=sys.stderr)
        if len(problems) > 40:
            print(f'  … and {len(problems) - 40} more', file=sys.stderr)
        return 1

    for i, rec in enumerate(records, 1):
        rec['id'] = i
    ordered = [{k: r[k] for k in ['id'] + FIELDS} for r in records]

    os.makedirs('data', exist_ok=True)
    with open(os.path.join('data', 'adventures.json'), 'w', encoding='utf-8') as fh:
        json.dump(ordered, fh, ensure_ascii=False, indent=1)

    by_state = collections.Counter(r['state'] for r in records)
    gems = sum(1 for r in records if r['hidden_gem'])
    print(f'{len(records)} adventures written to data/adventures.json')
    print('  by state: ' + ', '.join(f'{k} {v}' for k, v in by_state.most_common()))
    print(f'  hidden gems: {gems} ({gems * 100 // max(len(records), 1)}%)')
    print('\nRemember to bump CACHE_VERSION in sw.js so phones pick up the new data.')
    return 0


if __name__ == '__main__':
    raise SystemExit(main())
