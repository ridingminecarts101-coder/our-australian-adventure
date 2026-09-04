"""Ten quality checks over the adventure data.

Not "does it parse" - build_data.py already does that. These ask whether an
entry is worth someone's afternoon, and whether a person living in one place
is served as well as a person living in another.

The app began as a way to get the most out of where you already live. That
only works if South Australia is covered as carefully as Tokyo, and if the
entries in both are specific enough to act on. Several of these checks exist
to catch the failure mode of a generated list: plausible sentences that do not
actually tell you anything.

Not everything flagged is wrong. An adventure does not have to suit everyone -
a five-day trek is a real answer for some people. What each region does need is
a spread, so that whoever opens it finds something they can actually do.

    python tools/check_quality.py            # summary
    python tools/check_quality.py --verbose  # every instance
"""
import collections
import io
import json
import os
import re
import sys

DATA = os.path.join('data', 'adventures.json')
VERBOSE = '--verbose' in sys.argv or '-v' in sys.argv

findings = []          # (severity, check, message, examples)


def report(sev, check, msg, examples=()):
    findings.append((sev, check, msg, list(examples)))


def load():
    d = json.load(io.open(DATA, encoding='utf-8'))
    return d['adventures'] if isinstance(d, dict) else d


def label(a):
    return f'{a["country"]}/{a.get("admin1", "?")}: {a["title"]}'


# ── 1. Filler titles ─────────────────────────────────────────────────
# "Visit the museum" is not an adventure, it is a category. A title should say
# what you actually do, and the verb is where that shows.
WEAK_OPENERS = ('visit ', 'see ', 'explore ', 'experience ', 'discover ',
                'check out ', 'enjoy ', 'take in ')


def check_titles(rows):
    weak = [a for a in rows if a['title'].lower().startswith(WEAK_OPENERS)]
    # "See" is fine when it names a specific thing to look at, so only flag the
    # ones that pair a weak verb with a vague object.
    vague = [a for a in weak if len(a['title'].split()) <= 5]
    if vague:
        report('note', 'filler titles',
               f'{len(vague)} titles open with a weak verb and say little else',
               [label(a) for a in vague[:8]])
    if len(weak) > len(rows) * 0.12:
        report('problem', 'filler titles',
               f'{len(weak)} of {len(rows)} titles ({100*len(weak)//len(rows)}%) '
               'open with visit/see/explore', [label(a) for a in weak[:8]])


# ── 2. Descriptions that carry no information ────────────────────────
# The first version of this check demanded a proper noun and flagged sixty
# perfectly good entries, because a description sensibly does not repeat the
# place name that is already in the title. What actually matters is whether it
# tells you something the title did not: a reason, a constraint, a detail you
# could not have guessed. Restating the title is the failure mode.
STOP = set('a an the and or of in on at to for with from by is are was were '
           'that this it its you your we our they their as but if into over '
           'under between through where when what which who'.split())


def words(text):
    return {w for w in re.findall(r'[a-z]+', (text or '').lower())
            if w not in STOP and len(w) > 2}


def check_descriptions(rows):
    short, echo = [], []
    for a in rows:
        d = (a.get('description') or '').strip()
        if len(d) < 60:
            short.append(a)
            continue
        t, dw = words(a['title']), words(d)
        if not dw:
            echo.append(a)
            continue
        # Nearly everything the description says was already in the title.
        overlap = len(t & dw) / len(dw)
        if overlap > 0.55:
            echo.append(a)
    if short:
        report('problem', 'thin descriptions',
               f'{len(short)} descriptions are under 60 characters',
               [label(a) for a in short[:8]])
    if echo:
        report('problem', 'descriptions that only restate the title',
               f'{len(echo)} add little the title did not already say',
               [f'{label(a)}  «{a[chr(34)]}»' for a in echo[:6]])


# ── 3. Depth parity between regions ──────────────────────────────────
# The point of the app. A region with three entries is a stub next to one with
# forty, and whoever lives there is badly served.
def check_region_parity(rows):
    by_region = collections.Counter((a['country'], a.get('admin1')) for a in rows)
    by_country = collections.Counter(a['country'] for a in rows)

    # Only judge regions inside countries we have actually built out, or every
    # one-entry country reads as a failure when it is simply not started.
    built = {c for c, n in by_country.items() if n >= 25}
    thin = sorted((n, c, r) for (c, r), n in by_region.items()
                  if c in built and n <= 2)
    if thin:
        report('problem', 'thin regions',
               f'{len(thin)} regions inside well-covered countries have 2 or fewer',
               [f'{c}/{r}: {n}' for n, c, r in thin[:12]])

    # Spread within a country: one region hogging everything.
    for country in sorted(built):
        regions = collections.Counter(a.get('admin1') for a in rows
                                      if a['country'] == country)
        if len(regions) < 3:
            continue
        top, n = regions.most_common(1)[0]
        if n > by_country[country] * 0.45:
            report('note', 'lopsided country',
                   f'{country}: {n} of {by_country[country]} sit in {top!r}')


# ── 4. Category spread ───────────────────────────────────────────────
# A region that is all hiking serves hikers. Somebody who cannot walk far, or
# who has two hours and a pram, needs the region to hold something else.
def check_category_spread(rows):
    by_region = collections.defaultdict(list)
    for a in rows:
        by_region[(a['country'], a.get('admin1'))].append(a)

    narrow = []
    for (c, r), items in by_region.items():
        if len(items) < 8:
            continue
        cats = collections.Counter(a['category'] for a in items)
        top, n = cats.most_common(1)[0]
        if n > len(items) * 0.55:
            narrow.append(f'{c}/{r}: {n}/{len(items)} are {top}')
    if narrow:
        report('note', 'narrow categories',
               f'{len(narrow)} sizeable regions lean heavily on one category',
               narrow[:10])


# ── 5. Something for everyone, in every region ───────────────────────
# Not every adventure must suit everyone. Every region should hold at least one
# that is easy and one that is free, or it excludes people by accident.
def check_accessibility(rows):
    by_region = collections.defaultdict(list)
    for a in rows:
        by_region[(a['country'], a.get('admin1'))].append(a)

    no_easy, no_cheap = [], []
    for (c, r), items in by_region.items():
        if len(items) < 6:
            continue
        if not any(a['difficulty'] <= 2 for a in items):
            no_easy.append(f'{c}/{r} ({len(items)})')
        if not any(a['cost'] <= 1 for a in items):
            no_cheap.append(f'{c}/{r} ({len(items)})')
    if no_easy:
        report('problem', 'nothing easy', f'{len(no_easy)} regions have nothing '
               'at difficulty 1-2', no_easy[:10])
    if no_cheap:
        report('problem', 'nothing cheap', f'{len(no_cheap)} regions have nothing '
               'free or nearly free', no_cheap[:10])


# ── 6. Seasons that make sense for the hemisphere ────────────────────
SOUTHERN = {'AU', 'NZ', 'AR', 'CL', 'ZA', 'UY', 'PY', 'BO', 'PE', 'BR', 'NA',
            'BW', 'ZW', 'MZ', 'MG', 'FJ', 'PF', 'VU', 'NC', 'WS', 'TO', 'CK',
            'PG', 'SB', 'TL', 'ID', 'NF', 'NU', 'TV'}
# July and August only. Spring snow is normal at altitude - the Tateyama
# corridor is open April to June precisely because the snow is still there.
NORTH_SUMMER = {'Jul', 'Aug'}
NORTH_WINTER = {'Dec', 'Jan', 'Feb'}


def months(season):
    return set(re.findall(r'[A-Z][a-z]{2}', season or ''))


def check_seasons(rows):
    wrong = []
    for a in rows:
        m = months(a.get('season'))
        if not m:
            continue
        snow = a['category'] == 'Snow' or re.search(r'\bski|snow|ice climb',
                                                    a['title'], re.I)
        if a['country'] in SOUTHERN and snow and m & NORTH_WINTER and not m & NORTH_SUMMER:
            wrong.append(label(a) + f'  [{a["season"]}]')
        if a['country'] not in SOUTHERN and snow and m & NORTH_SUMMER and not m & NORTH_WINTER:
            wrong.append(label(a) + f'  [{a["season"]}]')
    if wrong:
        report('problem', 'season vs hemisphere',
               f'{len(wrong)} snow entries are in the wrong half of the year', wrong[:8])

    tropical_snow = [label(a) for a in rows
                     if a['category'] == 'Snow' and a['country'] in
                     {'SG', 'MY', 'ID', 'TH', 'PH', 'BN', 'MV', 'FJ', 'WS', 'TO'}]
    if tropical_snow:
        report('note', 'snow in the tropics',
               f'{len(tropical_snow)} snow entries in tropical countries',
               tropical_snow[:6])


# ── 7. Dogs where dogs are not allowed ───────────────────────────────
# Australian national parks almost universally bar dogs, and world heritage
# sites and temples usually do. A wrong "yes" here gets somebody turned away
# at a gate after a long drive.
# Only the words that actually govern access, and only where they name the
# destination rather than appear in passing. "World heritage" is a listing, not
# a rule - Amsterdam's canals are world heritage and full of dogs. A check that
# flags forty things where fifteen are real teaches you to ignore it.
DOG_UNLIKELY = re.compile(
    r'national park|nature reserve|marine park|'
    r'temple|shrine|monastery|basilica|mosque|'
    r'sanctuary|zoo|aquarium', re.I)


# Verified by hand as genuinely dog-friendly despite the name. Kept short and
# visible: an allowlist that grows without argument is how a check dies.
DOG_OK = {
    'Congaree National Park',      # leashed dogs on all trails, boardwalk included
}


def check_dogs(rows):
    bad = [a for a in rows if a.get('dog_friendly') == 'yes'
           and a['place'] not in DOG_OK
           and DOG_UNLIKELY.search(f'{a["title"]} {a["place"]}')]
    if bad:
        report('problem', 'dogs where dogs are barred',
               f'{len(bad)} say dogs are welcome at a place that usually bars them',
               [label(a) for a in bad[:10]])


# ── 8. The same place twice ──────────────────────────────────────────
def check_duplicates(rows):
    seen = collections.defaultdict(list)
    for a in rows:
        key = (a['country'], re.sub(r'[^a-z]', '', a['place'].lower()))
        seen[key].append(a)
    dupes = {k: v for k, v in seen.items() if len(v) > 1}
    if dupes:
        report('problem', 'duplicate places',
               f'{len(dupes)} places appear more than once in the same country',
               [f'{k[0]}/{k[1]}: ' + ' | '.join(x['title'] for x in v)
                for k, v in list(dupes.items())[:6]])

    # Near-duplicate titles across the whole set, which usually means the same
    # idea written twice for two different places.
    norm = collections.Counter(re.sub(r'[^a-z ]', '', a['title'].lower())
                               for a in rows)
    same = [t for t, n in norm.items() if n > 1]
    if same:
        report('problem', 'repeated titles', f'{len(same)} titles repeat', same[:6])


# ── 9. Claims that can be checked, and should be ─────────────────────
# Superlatives are where a generated list goes wrong most confidently. This
# does not verify them - it lists them so a person can.
# Only unhedged claims. "The second largest atoll in the world" and "one of
# the oldest working Ferris wheels" are already careful; flagging those buries
# the handful that actually assert a record and should be checked.
HEDGE = re.compile(r'\b(?:one of|among|second|third|nearly|almost|about|'
                   r'reckoned|arguably|said to be|claims? to be)\b', re.I)
SUPERLATIVE = re.compile(
    r'\b(?:largest|biggest|tallest|highest|longest|deepest|oldest|first|'
    r'only|fastest|most)\b[^.]{0,70}\b(?:in the world|on earth|anywhere|'
    r'in europe|in asia|in africa|in australia|ever built)\b', re.I)


def check_claims(rows):
    claims = []
    for a in rows:
        d = a.get('description', '')
        m = SUPERLATIVE.search(d)
        if not m:
            continue
        # Judge the sentence the claim sits in, not the whole description.
        start = d.rfind('.', 0, m.start()) + 1
        if HEDGE.search(d[start:m.end()]):
            continue
        claims.append((a, m))
    if claims:
        report('note', 'checkable claims',
               f'{len(claims)} entries make a world-superlative claim worth verifying',
               [f'{label(a)}  «{m.group(0)[:60]}»' for a, m in claims[:30]])


# ── 10. Fields that were filled in without thinking ──────────────────
def check_field_health(rows):
    by_region = collections.defaultdict(list)
    for a in rows:
        by_region[(a['country'], a.get('admin1'))].append(a)

    flat = []
    for (c, r), items in by_region.items():
        if len(items) < 8:
            continue
        if len({a['difficulty'] for a in items}) == 1:
            flat.append(f'{c}/{r}: every entry is difficulty {items[0]["difficulty"]}')
        if len({a['duration'] for a in items}) == 1:
            flat.append(f'{c}/{r}: every entry is {items[0]["duration"]}')
    if flat:
        report('problem', 'unconsidered fields',
               f'{len(flat)} regions have a field with no variation', flat[:8])

    # Ids are what progress, photos and trips are stored against. If one moves,
    # somebody's ticks quietly point at a different place. This used to happen
    # on most deploys; data/ids.json now freezes them, and this proves it.
    reg = json.load(io.open(os.path.join('data', 'ids.json'), encoding='utf-8'))
    ids = reg['ids']
    drifted = [f'{a["id"]} != {ids.get(a["country"] + "|" + a["place"])}  {a["title"][:40]}'
               for a in rows
               if ids.get(f'{a["country"]}|{a["place"]}') != a['id']]
    if drifted:
        report('problem', 'ids have moved',
               f'{len(drifted)} adventures no longer match the frozen id registry',
               drifted[:6])
    dupe_ids = [i for i, n in collections.Counter(a['id'] for a in rows).items() if n > 1]
    if dupe_ids:
        report('problem', 'duplicate ids', f'{len(dupe_ids)}', [str(i) for i in dupe_ids[:6]])

    undated = [a for a in rows if not a.get('verified_at')]
    if undated:
        report('problem', 'no verification date', f'{len(undated)} entries', [])

    # Every gem must belong to a pack, or it can never be sold or unlocked.
    orphan = [label(a) for a in rows if a.get('hidden_gem') and not a.get('pack')]
    if orphan:
        report('problem', 'gems with no pack', f'{len(orphan)}', orphan[:6])


def main():
    rows = load()
    print(f'{len(rows)} adventures · {len({a["country"] for a in rows})} countries · '
          f'{len({(a["country"], a.get("admin1")) for a in rows})} regions\n')

    for fn in (check_titles, check_descriptions, check_region_parity,
               check_category_spread, check_accessibility, check_seasons,
               check_dogs, check_duplicates, check_claims, check_field_health):
        fn(rows)

    problems = [f for f in findings if f[0] == 'problem']
    notes = [f for f in findings if f[0] == 'note']

    for sev, group in (('PROBLEM', problems), ('note', notes)):
        for _s, check, msg, ex in group:
            print(f'{sev} — {check}: {msg}')
            for e in (ex if VERBOSE else ex[:4]):
                print(f'    · {e}')
            if not VERBOSE and len(ex) > 4:
                print(f'    … {len(ex) - 4} more (run with --verbose)')
            print()

    if not findings:
        print('Nothing to answer for.')
    print(f'{len(problems)} problems, {len(notes)} notes')
    return 1 if problems else 0


if __name__ == '__main__':
    raise SystemExit(main())
