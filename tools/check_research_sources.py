"""Validate row-level provenance for research adventure batches.

Every ``data/src/research-*.jsonl`` row must have exactly one matching source
record by country and place in ``data/research-sources-*.jsonl``. Paid rows
also need an editorial rationale that explains why the experience is a hidden
gem without relying on its source's marketing label.
"""
import collections
import glob
import io
import json
import os


ROOT = os.path.dirname(os.path.dirname(os.path.abspath(__file__)))


def read_jsonl(path):
    with io.open(path, encoding="utf-8") as handle:
        for number, line in enumerate(handle, 1):
            if line.strip():
                try:
                    yield json.loads(line)
                except ValueError as error:
                    raise ValueError(f"{path}:{number}: {error}") from error


def main():
    batch_files = sorted(glob.glob(os.path.join(ROOT, "data", "src", "research-*.jsonl")))
    source_files = sorted(glob.glob(os.path.join(ROOT, "data", "research-sources-*.jsonl")))
    adventures = [row for path in batch_files for row in read_jsonl(path)]
    sources = [row for path in source_files for row in read_jsonl(path)]
    by_key = collections.defaultdict(list)
    for source in sources:
        by_key[(source.get("country"), source.get("place"))].append(source)

    problems = []
    adventure_keys = {(row.get("country"), row.get("place")) for row in adventures}
    for row in adventures:
        key = (row.get("country"), row.get("place"))
        matches = by_key[key]
        if len(matches) != 1:
            problems.append(f"{key[0]}/{key[1]}: expected 1 source, found {len(matches)}")
            continue
        source = matches[0]
        for field in ("publisher", "title", "url", "accessed", "supports"):
            if not source.get(field):
                problems.append(f"{key[0]}/{key[1]}: source missing {field}")
        if source.get("accessed") != row.get("verified_at"):
            problems.append(
                f"{key[0]}/{key[1]}: verified_at {row.get('verified_at')} "
                f"does not match source access date {source.get('accessed')}")
        if row.get("hidden_gem") and not source.get("hidden_gem_rationale"):
            problems.append(f"{key[0]}/{key[1]}: gem missing editorial rationale")

    for country, place in sorted(key for key in by_key if key not in adventure_keys):
        problems.append(f"{country}/{place}: source has no corresponding research row")

    print(f"{len(adventures)} research adventures; {len(sources)} provenance records")
    for problem in problems[:40]:
        print("! " + problem)
    if len(problems) > 40:
        print(f"! ...and {len(problems) - 40} more")
    return 1 if problems else 0


if __name__ == "__main__":
    raise SystemExit(main())
