"""One-time migration: Australian-shaped entries -> world-shaped entries.

Adds continent / country / admin1, a conservative dog_friendly rating, the
pack a premium entry belongs to, and a verified_at stamp.

Run once from the repo root:  python tools/migrate_world.py

DOG RATINGS ARE DELIBERATELY PESSIMISTIC. Getting this wrong is not a wasted
afternoon - dogs are banned from national parks across most of Australia, and
many parks and reserves run 1080 fox baiting, which is lethal to dogs and not
reliably signposted. So: rules below decide, anything uncertain becomes
"check", and only places we are confident about become "yes".
"""
import io
import json
import os
import re

STATES = ['sa', 'vic', 'nsw', 'qld', 'wa', 'tas', 'nt', 'act', 'aus']
TODAY = '2026-09-02'

# ── Dogs: hard NO ────────────────────────────────────────────────────
# Dogs are prohibited in national parks in NSW, VIC, SA, TAS, QLD and WA,
# and in the Commonwealth parks (Uluru, Kakadu, Booderee).
NO_PATTERNS = [
    r'national park', r'conservation park', r'nature reserve', r'wildlife park',
    r'wildlife sanctuary', r'sanctuary', r'\bzoo\b', r'aquarium', r'safari park',
    r'museum', r'gallery', r'\bcaves?\b', r'observatory', r'questacon',
    r'parliament', r'war memorial', r'\bmint\b', r'glassworks', r'library',
    r'marine park', r'conservation reserve', r'wilderness',
]
# Activities that rule dogs out regardless of the place name.
NO_CATEGORIES = {'Island', 'Snow'}
NO_TITLE_PATTERNS = [
    r'\bcruise', r'\bferry\b', r'\bdive\b', r'diving', r'snorkel', r'\bfly over\b',
    r'\bflight\b', r'cage-dive', r'\bskyrail\b', r'cable ?car', r'chairlift',
    r'\btour\b', r'\btrain\b', r'railway', r'steam', r'\bgondola\b',
    r'swim with', r'whale shark', r'sea ?lion', r'\bballoon\b', r'\bclimb the\b',
]

# ── Dogs: confident YES ──────────────────────────────────────────────
YES_PATTERNS = [
    r'rail trail', r'riesling trail', r'\bfore ?shore\b', r'\bjetty\b',
    r'\bmall\b', r'\bmarket\b', r'\bpub\b', r'\bhotel\b', r'brewery',
]
YES_CATEGORIES = {'Road Trip'}

# Named exceptions, checked before everything else. These are places where the
# rules would get it wrong in a way worth correcting by hand.
OVERRIDES = {
    # Off-leash / dog-tolerant beaches and foreshores
    'Semaphore': 'yes', 'Henley Beach': 'yes', 'Glenelg': 'yes',
    'Aldinga Beach': 'yes', 'Port Willunga': 'yes', 'Maslin Beach': 'yes',
    'Brighton Bathing Boxes': 'yes', 'Cottesloe Beach': 'yes',
    'Bondi Beach': 'check', 'Cable Beach': 'yes', 'Marion Bay': 'yes',
    'Emu Bay': 'check', 'Binalong Bay': 'check',
    # Towns and townships - dogs on leads are fine
    'Hahndorf': 'yes', 'Stirling': 'yes', 'Tanunda': 'yes', 'Clare': 'yes',
    'Burra': 'yes', 'Mintaro': 'yes', 'Quorn': 'yes', 'Melrose': 'yes',
    'Blinman': 'yes', 'Parachilna': 'yes', 'Robe': 'yes', 'Beachport': 'yes',
    'Wallaroo': 'yes', 'Moonta': 'yes', 'Copper Coast': 'yes',
    'Bright': 'yes', 'Beechworth': 'yes', 'Castlemaine': 'yes', 'Daylesford': 'yes',
    'Hepburn Springs': 'yes', 'Port Fairy': 'yes', 'Mallacoota': 'yes',
    'Echuca': 'yes', 'Rutherglen': 'yes', 'Wodonga': 'yes',
    'Brunswick Heads': 'yes', 'Newcastle': 'yes', 'Port Macquarie': 'yes',
    'Broken Hill': 'yes', 'Lightning Ridge': 'yes', 'Wollongong': 'yes',
    'Fremantle': 'yes', 'Esperance': 'yes',
    'Broome': 'yes', 'Stanley': 'yes', 'Deloraine': 'yes',
    'Richmond': 'yes', 'Katherine': 'yes', 'Alice Springs': 'yes',
    'Daly Waters': 'yes', 'Tennant Creek': 'yes',
    'Yeppoon': 'yes', 'Mooloolaba': 'yes',
    'Noosa Heads': 'yes', 'Surfers Paradise': 'yes',
    'Charters Towers': 'yes', 'Cooktown': 'yes',
    # Big open urban spaces that allow dogs on lead
    'Kings Park': 'yes', 'Lake Burley Griffin': 'yes', 'Mount Ainslie': 'yes',
    'Elizabeth Quay': 'yes', 'Brisbane South Bank': 'yes', 'Mount Coot-tha': 'yes',
    'Castle Hill': 'yes', 'Cataract Gorge': 'yes',
    'Adelaide Botanic Garden': 'no',   # guide dogs only
    'Royal Botanic Gardens Melbourne': 'check',
    'National Arboretum Canberra': 'yes',
    # Named traps: these read "yes" from the rules but are not
    'Adelaide Oval': 'no', 'Adelaide Central Market': 'no',
    'Queen Victoria Market': 'check', 'Salamanca Market': 'check',
    'Bus Depot Markets': 'no', 'Eat Street Northshore': 'no',
    'Busselton Jetty': 'no', 'Urangan Pier': 'check',
    # Sensitive wildlife sites - dogs are a genuine hazard to the animals
    'Penguin Parade': 'no', 'Mon Repos': 'no', 'Seal Bay': 'no',
    'Monkey Mia': 'no', 'Penneshaw': 'no', 'Kingscote': 'check',
    # 1080 baiting country - explicit no even where it is not a national park
    'Arkaroola': 'no', 'Tarkine': 'no', 'Gibb River Road': 'no',
    'El Questro': 'no', 'Cape York Peninsula': 'no',
    # Caught by the safety audit: the TOWN allows dogs, but THIS adventure is
    # a national park or a sensitive site. The adventure wins, not the town.
    'Kununurra': 'no',         # the adventure is Mirima National Park
    'Denmark WA': 'no',        # Greens Pool sits inside William Bay National Park
    'St Kilda': 'no',          # the adventure is the little penguin colony
    'Mindil Beach': 'no',      # the market itself does not admit dogs
    'Halls Gap': 'check',      # Grampians gateway, and 1080 baiting nearby
    'Perth Hills': 'check',    # heavy 1080 use across WA reserves
    'Mount Hotham': 'check',   # the drive crosses Alpine National Park
    'Snowy Mountains': 'check',# the Alpine Way crosses Kosciuszko National Park
    'Great Ocean Road': 'check',   # towns yes, the headline stops are national park
    'Atherton Tablelands': 'check',
    'Sunshine Coast': 'check',
    'Burleigh Heads': 'check', # time-restricted on the beach, park at the head
    'Agnes Water': 'check',
    'Airlie Beach': 'check',   # the lagoon does not admit dogs
    'Hyden': 'check',
    'Red Centre Way': 'check', # ends at Uluru, where dogs are not permitted

    # Nationwide challenges: not location-specific
    'All of Australia': 'check', 'Nullarbor Plain': 'yes', "Explorer's Way": 'yes',
    'The Ghan': 'no', 'Indian Pacific': 'no', 'Two coasts, one day': 'no',
    'Three oceans': 'check', 'Wild platypus': 'no', 'Wild echidna': 'no',
    'Whales both coasts': 'check', 'Australian snow': 'no', 'No reception': 'yes',
    'Milky Way core': 'check', 'Big Things': 'yes', 'World Heritage sites': 'no',
    'State high point': 'no', 'Away game': 'no',
}


def dog_rating(rec):
    """yes = confident dogs are welcome; no = confident they are not;
    check = genuinely varies, so send the user to the managing authority."""
    if rec['place'] in OVERRIDES:
        return OVERRIDES[rec['place']]

    haystack = f"{rec['place']} {rec['title']}".lower()

    for pat in NO_PATTERNS:
        if re.search(pat, haystack):
            return 'no'
    if rec['category'] in NO_CATEGORIES:
        return 'no'
    for pat in NO_TITLE_PATTERNS:
        if re.search(pat, rec['title'].lower()):
            return 'no'

    for pat in YES_PATTERNS:
        if re.search(pat, haystack):
            return 'yes'
    if rec['category'] in YES_CATEGORIES:
        return 'yes'

    return 'check'          # honest default


def main():
    counts = {'yes': 0, 'no': 0, 'check': 0}
    total = 0

    for name in STATES:
        path = os.path.join('data', 'src', f'{name}.jsonl')
        out = []
        for line in io.open(path, encoding='utf-8'):
            line = line.strip()
            if not line:
                continue
            r = json.loads(line)
            if 'continent' in r:
                # Already migrated - just re-run the dog pass so corrections
                # to the rules or overrides can be applied again safely.
                dog = dog_rating(r)
                counts[dog] += 1
                total += 1
                r['dog_friendly'] = dog
                out.append(json.dumps(r, ensure_ascii=False))
                continue

            dog = dog_rating(r)
            counts[dog] += 1
            total += 1

            new = {
                'continent':    'Oceania',
                'country':      'AU',
                'admin1':       r['state'],
                'region':       r['region'],
                'title':        r['title'],
                'place':        r['place'],
                'category':     r['category'],
                'difficulty':   r['difficulty'],
                'cost':         r['cost'],
                'duration':     r['duration'],
                'season':       r['season'],
                'dog_friendly': dog,
                'hidden_gem':   r['hidden_gem'],
                # Continent packs: hidden gems are the paid layer, free entries
                # carry no pack. Kept as its own field so the policy can change
                # without re-tagging every entry.
                'pack':         'oceania' if r['hidden_gem'] else None,
                'lat':          None,
                'lon':          None,
                'verified_at':  TODAY,
                'description':  r['description'],
            }
            out.append(json.dumps(new, ensure_ascii=False))

        io.open(path, 'w', encoding='utf-8').write('\n'.join(out) + '\n')
        print(f'  {path}: {len(out)} entries')

    print(f'\nMigrated {total} entries.')
    if total:
        print('Dog friendly: ' + ', '.join(
            f'{k} {v} ({v * 100 // total}%)' for k, v in counts.items()))


if __name__ == '__main__':
    main()
