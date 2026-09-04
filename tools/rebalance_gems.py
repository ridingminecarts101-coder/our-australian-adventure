"""Bring the hidden-gem share down to at most one in five per region.

WHY THIS IS A DEMOTION AND NOT AN ADDITION

The rule is that gems must be at most a fifth of a region. Getting there by
adding ordinary adventures would take about 2,800 new entries - North Dakota
would need thirty-five destinations worth changing your route for, and it does
not have them. Padding to hit a ratio is exactly the filler nobody wants.

The actual problem is that the flag was over-applied. Forty-one per cent of the
list was marked a hidden gem, including "eat mohinga for breakfast" in Yangon
and "swim in the Worthersee". Those are good things to do. They are not places
a local sends you that you would otherwise never find, which is what the label
is supposed to mean and what somebody is paying for.

So this demotes rather than deletes. Nothing leaves the app; entries move from
paid to free, which makes the app more generous, not less.

WHICH ONES KEEP THE LABEL

Scored on whether the description actually describes something hard to find:
no road in, capped numbers, a permit, a local tradition, a place that has to be
asked about. Anything whose own text says it is famous, ranked, or world
heritage loses the label first - a thing cannot be both world-renowned and
hidden.

    python tools/rebalance_gems.py            # report only
    python tools/rebalance_gems.py --apply    # write the changes
"""
import collections
import glob
import io
import json
import os
import re
import sys

APPLY = '--apply' in sys.argv
MAX_SHARE = 0.20

# Reasons an entry has earned the label.
HIDDEN = [
    (3, re.compile(r'no road|only by (?:boat|foot|ferry|air)|reached (?:only|by)'
                   r'|walk in|track in|four.wheel|unsealed|dirt road', re.I)),
    (3, re.compile(r'almost nobody|hardly anybody|few (?:visitors|people)|rarely visited'
                   r'|nobody (?:goes|there)|overlooked|forgotten|little known', re.I)),
    (2, re.compile(r'permit|capped|lottery|booked? (?:months|weeks|ahead|in advance)'
                   r'|by appointment|numbers are limited', re.I)),
    (2, re.compile(r'locals?|ask (?:locally|around)|unmarked|you have to know', re.I)),
    (1, re.compile(r'free|no charge|no signage', re.I)),
]

# Reasons it has not.
OBVIOUS = [
    (-4, re.compile(r'world heritage|most (?:visited|famous)|best known|renowned'
                    r'|one of the (?:great|most)|ranked|iconic', re.I)),
    (-3, re.compile(r'largest|tallest|longest|oldest|biggest|highest'
                    r'|in the world|on earth', re.I)),
    (-2, re.compile(r'queue|crowds|coaches|tour groups|sells out|busy', re.I)),
]


def score(a):
    """Higher means the label is more deserved."""
    text = f"{a['title']} {a.get('description', '')}"
    s = 0
    for weight, rx in HIDDEN:
        if rx.search(text):
            s += weight
    for weight, rx in OBVIOUS:
        if rx.search(text):
            s += weight
    # A meal in a city is a recommendation, not a discovery.
    if a['category'] == 'Food & Drink':
        s -= 2
    if a['category'] in ('City', 'Family'):
        s -= 1
    # Genuinely demanding things tend to be less trodden.
    s += (a['difficulty'] - 2) * 0.5
    return s


def main():
    paths = sorted(glob.glob(os.path.join('data', 'src', '*.jsonl')))
    rows = []
    for p in paths:
        for i, line in enumerate(io.open(p, encoding='utf-8')):
            line = line.strip()
            if line:
                r = json.loads(line)
                r['_p'], r['_i'] = p, i
                rows.append(r)

    by_region = collections.defaultdict(list)
    for r in rows:
        by_region[(r['country'], r.get('admin1'))].append(r)

    demote = []
    for key, items in sorted(by_region.items()):
        gems = [r for r in items if r.get('hidden_gem')]
        # Strictly a fifth. A region needs five entries before it may hold a
        # single gem, which is the rule as stated - letting small regions keep
        # one regardless put a three-entry region at a third.
        allowed = int(len(items) * MAX_SHARE)
        if len(gems) <= allowed:
            continue
        # Weakest claim to the label goes first.
        gems.sort(key=score)
        demote.extend(gems[:len(gems) - allowed])

    print(f'{len(rows)} adventures, '
          f'{sum(1 for r in rows if r.get("hidden_gem"))} currently flagged '
          f'({100 * sum(1 for r in rows if r.get("hidden_gem")) / len(rows):.0f}%)')
    print(f'{len(demote)} would become free, leaving '
          f'{sum(1 for r in rows if r.get("hidden_gem")) - len(demote)} paid '
          f'({100 * (sum(1 for r in rows if r.get("hidden_gem")) - len(demote)) / len(rows):.0f}%)\n')

    print('Losing the label first (weakest claim to being hidden):')
    for r in sorted(demote, key=score)[:12]:
        print(f'  {score(r):5.1f}  {r["country"]}/{r.get("admin1"):<14} {r["title"][:52]}')
    print('\nKeeping it (strongest claim):')
    kept = [r for r in rows if r.get('hidden_gem') and r not in demote]
    for r in sorted(kept, key=score, reverse=True)[:8]:
        print(f'  {score(r):5.1f}  {r["country"]}/{r.get("admin1"):<14} {r["title"][:52]}')

    if not APPLY:
        print('\nReport only. Re-run with --apply to write it.')
        return 0

    ids = {(r['_p'], r['_i']) for r in demote}
    for p in paths:
        out, changed = [], False
        for i, line in enumerate(io.open(p, encoding='utf-8')):
            line = line.strip()
            if not line:
                continue
            r = json.loads(line)
            if (p, i) in ids:
                r['hidden_gem'] = False
                r['pack'] = None
                changed = True
            out.append(r)
        if changed:
            io.open(p, 'w', encoding='utf-8', newline='\n').write(
                ''.join(json.dumps(r, ensure_ascii=False) + '\n' for r in out))
    print(f'\n{len(demote)} entries moved from paid to free.')
    return 0


if __name__ == '__main__':
    raise SystemExit(main())
