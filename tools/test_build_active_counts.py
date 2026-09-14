"""Public build counts exclude reversible unavailable catalogue rows."""

import importlib.util
import json
import os
import tempfile
from pathlib import Path


ROOT = Path(__file__).resolve().parents[1]
spec = importlib.util.spec_from_file_location("wayfinder_build_data", ROOT / "tools" / "build_data.py")
build = importlib.util.module_from_spec(spec)
spec.loader.exec_module(build)


records = [
    {"country": "AA"} for _ in range(100)
] + [
    {"country": "BB"} for _ in range(99)
] + [{
    "country": "ZZ",
    "availability": {"status": "unavailable"},
}]
available = [row for row in records if build.is_available(row)]
assert len(records) == 200
assert len(available) == 199
assert {row["country"] for row in available} == {"AA", "BB"}

with tempfile.TemporaryDirectory() as directory:
    original = os.getcwd()
    os.chdir(directory)
    try:
        Path("manifest.json").write_text(
            json.dumps({"description": "old count"}, indent=2) + "\n", encoding="utf-8"
        )
        Path("index.html").write_text(
            '<meta name="description" content="Wayfinder — old count">\n', encoding="utf-8"
        )
        Path("PLAY.md").write_text(
            "**Short description** (80 max, 73 used):\n\n"
            "> 200+ adventures across 3 countries and territories. Tick them off together.\n\n"
            "**Full description** (4,000 max):\n\n"
            "> Wayfinder is a list of places that are actually worth the trip — 200+ of\n"
            "> them, across 3 countries and territories, each one written up by hand.\n",
            encoding="utf-8",
        )

        build.stamp_counts(len(available))
        build.stamp_listing(available)

        manifest = Path("manifest.json").read_text(encoding="utf-8")
        index = Path("index.html").read_text(encoding="utf-8")
        play = Path("PLAY.md").read_text(encoding="utf-8")
        assert "100+ real places" in manifest
        assert "100+ real places" in index
        assert "100+ adventures across 2 countries and territories" in play
        assert "worth the trip — 100+ of\n> them, across 2 countries and territories" in play
        assert "200+" not in manifest + index + play
    finally:
        os.chdir(original)

print("build counts: stored history retained while public counts use available rows")
