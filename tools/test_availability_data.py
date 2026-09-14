"""Focused validation for the reversible per-ID availability sidecar."""
import copy
import importlib.util
import json
import tempfile
from pathlib import Path


PATH = Path(__file__).with_name("build_data.py")
SPEC = importlib.util.spec_from_file_location("wayfinder_build_data", PATH)
BUILD = importlib.util.module_from_spec(SPEC)
SPEC.loader.exec_module(BUILD)


record = {"country": "AU", "place": "Fixture Track"}
entry = {
    "id": 42,
    "status": "unavailable",
    "reason": "The responsible land manager has closed this track.",
    "reviewed_at": "2026-09-14",
    "source": {
        "type": "primary",
        "publisher": "Fixture Parks",
        "url": "https://parks.example.test/current-notice",
    },
}

with tempfile.TemporaryDirectory() as directory:
    directory = Path(directory)
    ids = directory / "ids.json"
    sidecar = directory / "availability.json"
    # A retired alias may share the stable ID. Resolution must come from the
    # current source rows, never whichever registry key sorts last.
    ids.write_text(json.dumps({"ids": {"AU|Fixture Track": 42,
                                        "ZZ|Retired Alias": 42,
                                        "AU|Current Listing": 43}, "next": 44}), encoding="utf-8")

    rows = [copy.deepcopy(record)]
    sidecar.write_text(json.dumps({"version": 1, "entries": [entry]}), encoding="utf-8")
    assert BUILD.apply_availability(rows, sidecar, ids) == []
    assert rows[0]["availability"]["status"] == "unavailable"
    assert rows[0]["availability"]["source"]["type"] == "primary"
    old_ids_path = BUILD.IDS
    BUILD.IDS = str(ids)
    try:
        BUILD.assign_ids(rows)
    finally:
        BUILD.IDS = old_ids_path
    assert rows[0]["id"] == 42, "availability must not renumber the historical row"

    reopened = copy.deepcopy(entry)
    reopened["status"] = "available"
    reopened["reason"] = "The responsible land manager confirms the track has reopened."
    rows = [copy.deepcopy(record)]
    sidecar.write_text(json.dumps({"version": 1, "entries": [reopened]}), encoding="utf-8")
    assert BUILD.apply_availability(rows, sidecar, ids) == []
    assert rows[0]["availability"]["status"] == "available"

    linked = copy.deepcopy(entry)
    linked["replacement_id"] = 43
    rows = [copy.deepcopy(record), {"country": "AU", "place": "Current Listing"}]
    sidecar.write_text(json.dumps({"version": 1, "entries": [linked]}), encoding="utf-8")
    assert BUILD.apply_availability(rows, sidecar, ids) == []
    assert rows[0]["availability"]["replacement_id"] == 43

    bad = copy.deepcopy(entry)
    bad["id"] = 999
    bad["source"]["type"] = "secondary"
    sidecar.write_text(json.dumps({"version": 1, "entries": [bad]}), encoding="utf-8")
    errors = BUILD.apply_availability([copy.deepcopy(record)], sidecar, ids)
    assert any("not a current catalogue row" in error for error in errors)
    assert any("named primary publisher" in error for error in errors)

    sidecar.write_text(json.dumps({"version": 1, "entries": [entry, entry]}), encoding="utf-8")
    assert any("duplicate id 42" in error
               for error in BUILD.apply_availability([copy.deepcopy(record)], sidecar, ids))

    bad_bool = copy.deepcopy(entry)
    bad_bool["id"] = True
    bad_bool["reviewed_at"] = "2026-02-30"
    sidecar.write_text(json.dumps({"version": 1, "entries": [bad_bool]}), encoding="utf-8")
    errors = BUILD.apply_availability([copy.deepcopy(record)], sidecar, ids)
    assert any("id must be an integer" in error for error in errors)
    assert any("reviewed_at must be YYYY-MM-DD" in error for error in errors)

    # If two current rows somehow share an ID, fail instead of guessing which
    # live identity should receive the operational notice.
    ambiguous_ids = directory / "ambiguous-ids.json"
    ambiguous_ids.write_text(json.dumps({"ids": {"AU|Fixture Track": 42,
                                                   "NZ|Other Track": 42}, "next": 43}), encoding="utf-8")
    sidecar.write_text(json.dumps({"version": 1, "entries": [entry]}), encoding="utf-8")
    errors = BUILD.apply_availability(
        [copy.deepcopy(record), {"country": "NZ", "place": "Other Track"}],
        sidecar, ambiguous_ids)
    assert any("resolves to 2 active catalogue rows" in error for error in errors)

    self_link = copy.deepcopy(entry)
    self_link["replacement_id"] = 42
    sidecar.write_text(json.dumps({"version": 1, "entries": [self_link]}), encoding="utf-8")
    assert any("must name a different row" in error
               for error in BUILD.apply_availability([copy.deepcopy(record)], sidecar, ids))

    other = copy.deepcopy(entry)
    other.update({"id": 43, "replacement_id": 42})
    linked["replacement_id"] = 43
    sidecar.write_text(json.dumps({"version": 1, "entries": [linked, other]}), encoding="utf-8")
    errors = BUILD.apply_availability(
        [copy.deepcopy(record), {"country": "AU", "place": "Current Listing"}], sidecar, ids)
    assert any("is also unavailable" in error for error in errors)
    assert any("replacement_id cycle" in error for error in errors)

print("availability data: source schema, current ID, primary evidence and reversible status passed")
