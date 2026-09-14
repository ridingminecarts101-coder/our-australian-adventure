"""Focused source-schema regression for an explicitly unknown price."""
import io
import json
import os
import tempfile

import lint_source
import build_data


BASE = {
    "continent": "Oceania", "country": "AU", "admin1": "NSW", "region": "Fixture",
    "title": "Inspect an unknown-price fixture", "place": "Unknown price fixture",
    "category": "History", "difficulty": 1, "cost": None, "duration": "Check duration",
    "season": "Check dates", "dog_friendly": "check", "hidden_gem": False,
    "pack": None, "lat": None, "lon": None, "verified_at": "2026-09-14",
    "description": "A local-only schema fixture with a price that has not been verified."
}


def problems_for(record):
    fd, path = tempfile.mkstemp(suffix='.jsonl')
    os.close(fd)
    try:
        with io.open(path, 'w', encoding='utf-8', newline='\n') as handle:
            handle.write(json.dumps(record) + '\n')
        records, problems = lint_source.check(path, {})
        return problems, records
    finally:
        os.unlink(path)


problems, records = problems_for(BASE)
assert not problems, problems
assert records[0]['cost'] is None
assert records[0]['season'] == 'Check dates'
assert records[0]['duration'] == 'Check duration'

bad = dict(BASE, cost='unknown')
problems, _ = problems_for(bad)
assert any('cost' in problem for problem in problems), problems

for valid in range(5):
    problems, _ = problems_for(dict(BASE, cost=valid))
    assert not problems, (valid, problems)

problems, _ = problems_for(dict(BASE, season='Someday'))
assert any('season' in problem for problem in problems), problems

# Exercise build_data.load itself in an isolated source tree. It must preserve
# null into the built record and still reject a non-numeric string.
original_cwd = os.getcwd()
original_sources = build_data.SOURCES
try:
    temporary = tempfile.TemporaryDirectory()
    try:
        root = temporary.name
        os.makedirs(os.path.join(root, 'data', 'src'))
        source = os.path.join(root, 'data', 'src', 'fixture.jsonl')
        with io.open(source, 'w', encoding='utf-8', newline='\n') as handle:
            handle.write(json.dumps(BASE) + '\n')
        os.chdir(root)
        build_data.SOURCES = ['fixture']
        records, problems = build_data.load()
        assert not problems, problems
        assert records[0]['cost'] is None
        with io.open(source, 'w', encoding='utf-8', newline='\n') as handle:
            handle.write(json.dumps(dict(BASE, cost='unknown')) + '\n')
        _, problems = build_data.load()
        assert any('cost must be null or 0-4' in problem for problem in problems), problems
    finally:
        os.chdir(original_cwd)
        temporary.cleanup()
finally:
    build_data.SOURCES = original_sources
    os.chdir(original_cwd)

print('unknown cost and schedule schema: 14 passed')
