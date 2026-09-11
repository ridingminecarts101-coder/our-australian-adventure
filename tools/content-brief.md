# Writing adventures for Wayfinder

Read this in full before writing a single line. The schema is strict and the
build rejects the file if anything is wrong.

## What an adventure is

A specific thing a traveller does in a specific place, written as an
instruction. Not a place name, not a category, not a "top 10" entry.

Good:  `Stand on the floor of the Colosseum`
Good:  `Watch the sun come up over Angkor Wat`
Good:  `Eat currywurst at a Berlin Imbiss after midnight`
Bad:   `Visit Rome` — not specific
Bad:   `Colosseum` — not a thing you do
Bad:   `Explore the vibrant local culture` — means nothing

**The single rule that matters: no filler.** It is far better to write 12 real
entries than 40 padded ones. If you find yourself writing "wander the charming
old town" for the ninth country, stop and write fewer. Every entry must be
somewhere a person could actually stand, on a day, and be glad they went.

**Every world-famous site in your countries MUST be present.** If a country has
a thing on the front of every guidebook — the Pyramids, Machu Picchu, the Holy
Sepulchre, Victoria Falls, the Serengeti migration — and your file does not
have it, the file is wrong. Start with those, then go deeper.

Research each country properly. Use the web. Cross-check what tour operators,
national tourism boards, UNESCO listings, Lonely Planet, Atlas Obscura and
flight-centre style itineraries actually sell and recommend. Prefer things that
appear in several independent sources.

## Output

One JSON object per line, UTF-8, in a file you create at
`data/src/<name>.jsonl`. Do not touch any other file. **Do not run
`tools/build_data.py`** — several agents are writing at once and it would race.

```json
{"continent": "Europe", "country": "IT", "admin1": "Lazio", "region": "Rome", "title": "Stand on the floor of the Colosseum", "place": "Colosseum", "category": "History", "difficulty": 1, "cost": 2, "duration": "Half day", "season": "Year-round", "dog_friendly": "no", "hidden_gem": false, "pack": null, "lat": null, "lon": null, "verified_at": "2026-09-09", "description": "The arena-floor and underground tickets are separate and sell out weeks ahead. Book the full experience or you only see it from the stands."}
```

Every field is required. No extras.

**Write the file with the Write tool, not a shell heredoc.** Place names carry
apostrophes - Baines' Baobabs, Ha'apai, N'Djamena - and an apostrophe inside a
bash heredoc breaks the shell's quoting in a way that fails halfway through and
leaves a truncated file. If you need several batches, Write each one to a
scratch file and `cat` them together.

**Save as you go, every two or three countries.** This work runs under a usage
limit that can end the session without warning. Research two or three
countries, write those entries to disk, then move on - never hold the whole
file in your head to write at the end. Several agents have already lost an
entire run of research because they were killed a minute before their single
final write. If the target file already exists when you start, read it first:
it is a previous attempt's saved progress, so keep it and continue from the
countries it does not yet cover.

| Field | Rule |
|---|---|
| `continent` | exactly one of: `Oceania` `Europe` `North America` `South America` `Asia` `Middle East` `Africa` `Antarctica` — and it **must be the continent `tools/countries.py` gives that country**, which is what the app builds every continent screen from. Do not use your own geography. Georgia, Armenia, Azerbaijan, Cyprus and Türkiye are all `Middle East` there; the Caribbean is `North America`. If a prompt disagrees with that file, the file wins |
| `country` | 2-letter ISO code, uppercase |
| `admin1` | the state/province/region as that country names it. Be consistent — one spelling per region, for the whole file |
| `region` | the city or district. May equal `admin1` for small countries |
| `title` | the instruction. Sentence case, no trailing full stop. Under ~70 chars |
| `place` | **must be unique within the country** — it is half the primary key. Two entries at the same site need distinct places, e.g. `Colosseum` and `Colosseum underground` |
| `category` | exactly one of: `Nature` `Beach` `Wildlife` `Hiking` `Water` `Culture` `History` `Food & Drink` `Road Trip` `Adrenaline` `Island` `Outback` `Snow` `City` `Family` `Scenic` `Stargazing` |
| `difficulty` | integer 1–5. 1 = anyone, 5 = serious undertaking |
| `cost` | integer 0–4. 0 = free, 4 = expensive |
| `duration` | free text: `1 hr`, `1-2 hrs`, `2-3 hrs`, `Half day`, `Full day`, `Multi-day` |
| `season` | `Year-round`, a month (`Oct`), or a range (`Apr-Oct`, `Nov-Mar`). **Three-letter months only.** Nothing else parses |
| `dog_friendly` | `yes` / `no` / `check` |
| `hidden_gem` | boolean — see below |
| `pack` | `null` when `hidden_gem` is false. When true, the continent slug: `oceania` `europe` `north-america` `south-america` `asia` `middle-east` `africa`. Antarctica is the exception: its gems use `all` because it has no standalone pack |
| `bundle_only` | optional boolean, default `false`. Every `AQ` row must explicitly use `true`; no other country may use it |
| `lat` / `lon` | always `null`. Do not invent coordinates |
| `verified_at` | `"2026-09-09"` |
| `description` | 1–2 sentences of something a guidebook index would not tell you: the catch, the timing, the reason it is worth it. Never marketing copy |

`verified_at` means the place and core experience were checked on that date. It
does not certify every mutable field. Record the exact source and the scope of
what it supports in a matching `data/research-sources-*.jsonl` row keyed by
`country` and `place`. Do not state a current price, schedule, access rule,
season or dog policy unless the cited page supports it; use the schema's
cautious value and explain what must be checked in the description.

Every hidden-gem source record also needs `hidden_gem_rationale`: a concrete
editorial reason the experience belongs behind the paid pack. The rationale
must not rely only on a tourism page calling something a hidden gem.

## Descriptions are where the app earns its keep

The description is not a summary of the title. It is the thing a person who has
been there would say to you. A booking catch, a timing trick, a warning, a
number that surprises.

> "The arena-floor and underground tickets are separate and sell out weeks
> ahead. Book the full experience or you only see it from the stands."

> "Twice the height of Niagara, in a canyon system reachable only by float
> plane. The first natural site ever added to the world heritage list."

Not: "A beautiful and historic landmark that visitors love."

## Hidden gems

`hidden_gem: true` marks the paid content — places a local sends you to rather
than the ones on every list. Rules:

- **At least one in five entries per country and continent pack.** Aim for
  20–25% where the evidence supports it. A small country or region may remain
  below that level when reaching it would require filler or falsely labelling a
  famous sight; record that exception for editorial review.
- Never a famous site. The Pyramids are not a hidden gem.
- A gem must still be real and reachable, not obscure for its own sake.
- `pack` must be set to the continent slug whenever `hidden_gem` is true, and
  `null` whenever it is false. The build rejects either mistake.
- Antarctica has no standalone product. Every `AQ` row has `bundle_only: true`;
  its gems use `pack: "all"` and its classic entries keep `pack: null`.

## How many

| Country | Target |
|---|---|
| Major destination (Egypt, Brazil, Turkey, Thailand) | 35–60 |
| Substantial (Morocco, Peru, Vietnam, Croatia) | 20–40 |
| Smaller but visited (Jordan, Slovenia, Uruguay) | 12–25 |
| Small island or microstate (Vatican, Palau, Dominica) | 5–12 |

These are targets, not quotas. **Under-deliver rather than pad.** A country
with 14 excellent entries beats one with 40 where half are "walk around the
market".

## Spread

Within a country, spread across `admin1` regions rather than piling everything
into the capital, and across categories. A country that is 90% History is a
country somebody stopped researching early. But do not invent a beach entry for
a landlocked country to balance a table — spread where the country actually has
things.

## Checking your own work before you finish

- Every line is valid JSON on one line
- Every `place` is unique within its country
- Every `season` matches `Year-round` or `Jan`-style months only
- Gems are at least 1/5 per country and continent pack, or a quality exception
  is recorded; every gem has a `pack`
- No entry you would be embarrassed to defend as worth a detour
