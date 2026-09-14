# Experience availability

`availability.json` holds reversible operational status decisions for specific
existing catalogue IDs. It never removes or renumbers an adventure. An entry
has this exact shape:

```json
{
  "id": 123,
  "status": "unavailable",
  "reason": "A plain-language explanation of why this listing is paused.",
  "reviewed_at": "2026-09-14",
  "replacement_id": 456,
  "source": {
    "type": "primary",
    "publisher": "The primary source publisher",
    "url": "https://example.gov/source"
  }
}
```

Only `available` and `unavailable` are accepted. Every decision needs a current
primary source and a review date. Restoring an experience is reversible: add a
reviewed `available` decision or, after review, remove its exception. Historical
progress, memories and photos continue to use the unchanged adventure ID.

`replacement_id` is optional. It may point from a paused duplicate to a
different, current catalogue ID. The app offers “Open current listing”; it does
not merge IDs, move history, or rewrite progress. The build rejects missing or
ambiguous targets, paused targets, self-references and cycles.

The 14 September 2026 review contains 17 paused listings. These include
documented closures, uncorroborated activity or access claims, and duplicate
listings that point to a current entry. A pause caused by insufficient evidence
does not assert that the entire site or every operator is closed. Each reason
distinguishes the decision and retains its source context.
