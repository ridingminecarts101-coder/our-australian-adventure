"""Focused invariants for the review-only research staging adapter."""
import importlib.util
import hashlib
import json
import tempfile
from pathlib import Path


PATH = Path(__file__).with_name("stage_research_import.py")
SPEC = importlib.util.spec_from_file_location("stage_research_import", PATH)
STAGE = importlib.util.module_from_spec(SPEC)
SPEC.loader.exec_module(STAGE)


def candidate(**changes):
    row = {
        "continent": "Europe", "country": "GB", "admin1": "England",
        "region": "Suffolk", "title": "Visit a specific place", "place": "Fixture Museum",
        "category": "History", "difficulty": 1, "cost": 1, "duration": "2-3 hrs",
        "season": "Year-round", "dog_friendly": "no", "hidden_gem": True,
        "pack": "europe", "lat": None, "lon": None, "verified_at": "2026-09-14",
        "description": "A specific researched experience.", "tags": [], "bundle_only": False,
    }
    row.update(changes)
    return row


assert STAGE.action_of({"action": "retire_reserve_existing_id"}, {}) == "hold"
assert STAGE.action_of({"proposal_action": "add"}, candidate()) == "add"
assert STAGE.action_of({"target_id": 42}, candidate()) == "correct"

assert STAGE.candidate_errors(candidate()) == []
assert "hidden gem pack must be 'europe'" in STAGE.candidate_errors(candidate(pack=None))
assert "non-gem pack must be null" in STAGE.candidate_errors(candidate(hidden_gem=False))
assert "bundle_only is reserved for Antarctica" in STAGE.candidate_errors(candidate(bundle_only=True))

good_source = {
    "publisher": "Official museum", "url": "https://example.test/place",
    "supports": "The official page describes the visit.",
    "hidden_gem_rationale": "A small specialist site outside the usual visitor route.",
}
assert STAGE.source_errors([good_source], True, {"id:fixture"}) == []
assert STAGE.source_errors([{**good_source, "url": "http://example.test"}], True, {"id:fixture"})
assert STAGE.source_errors([{**good_source, "hidden_gem_rationale": "popular"}], True, {"id:fixture"})
assert STAGE.source_errors([], False, {"id:fixture"}) == ["no matching source sidecar for id:fixture"]
assert "id:PROV-1" in STAGE.proposal_keys(
    {"proposed": {"id": "PROV-1"}}, candidate(), None)

assert STAGE.additions_needed(8, 1) == 1
assert STAGE.additions_needed(12, 0) == 3
assert STAGE.additions_needed(5, 1) == 0

count_items = [
    {"technical_validation": "pass", "action": "add", "validation": "root_review_ready",
     "candidate": {"hidden_gem": True}, "canonical_before": None},
    {"technical_validation": "pass", "action": "add", "validation": "held",
     "candidate": {"hidden_gem": True}, "canonical_before": None},
    {"technical_validation": "pass", "action": "correct", "validation": "root_review_ready",
     "candidate": {"hidden_gem": False}, "canonical_before": {"hidden_gem": True}},
    {"technical_validation": "pass", "action": "suppress", "validation": "schema_support_required",
     "candidate": {}, "canonical_before": {"hidden_gem": True}},
]
assert STAGE.authoritative_count_model(count_items, {"rows": 10, "gems": 4}) == {
    "baseline": {"rows": 10, "gems": 4},
    "stored": {"rows": 12, "gems": 5},
    "active": {"rows": 11, "gems": 4},
    "conservative": {"rows": 10, "gems": 3},
}

assert STAGE.field_changes(candidate(), candidate(description="Changed")) == {
    "description": {"before": "A specific researched experience.", "after": "Changed"}
}


def digest(path):
    return hashlib.sha256(path.read_bytes()).hexdigest()


with tempfile.TemporaryDirectory() as temporary:
    base = Path(temporary)
    manifest_path = base / "READY-PROPOSAL-MANIFEST.json"
    before = {"id": 42, **candidate(place="Existing Place")}
    corrected = {**before, "description": "A corrected, sourced description."}
    addition = {"id": "PROV-1", **candidate(country="FR", place="New Place")}

    def embedded(reference, action, record, target=None, provisional=None):
        return {
            "lane": "fixture", "reference_id": reference, "action": action,
            "target_id": target, "provisional_id": provisional,
            "integration_status": "ready_with_caveat", "duplicate_of": None,
            "preserve_numeric_id": action == "correct", "rationale": "Fixture rationale",
            "record": record,
            "evidence": [{**good_source, "reference_id": reference,
                          "id": record["id"], "country": record["country"]}],
        }

    document = {"proposal_count": 2, "proposals": [
        embedded("CORR-42", "correct", corrected, target=42),
        embedded("PROV-1", "add", addition, provisional="PROV-1"),
    ]}
    manifest_path.write_text(json.dumps(document), encoding="utf-8")
    frozen_path = base / "FREEZE-MANIFEST.json"
    frozen = {
        "artifact_count": 1, "pinned_application_commit": "fixture-head",
        "authoritative_ready_manifest": manifest_path.name,
        "files": [{"path": manifest_path.name, "bytes": manifest_path.stat().st_size,
                   "sha256": digest(manifest_path)}],
    }
    frozen_path.write_text(json.dumps(frozen), encoding="utf-8")
    batch = {
        "name": "fixture-b", "research_root": str(base),
        "frozen_hashes": str(frozen_path), "ready_manifest": str(manifest_path),
        "canonical_commit": "fixture-head", "expected_manifest_rows": 2,
        "expected_actions": {"correct": 1, "add": 1},
        "expected_frozen_manifest_sha256": digest(frozen_path),
        "expected_ready_manifest_sha256": digest(manifest_path),
    }
    inputs = {}
    rows = STAGE.process_embedded_ready_manifest(
        batch, [before], {42: before}, {STAGE.record_key(before): before},
        {STAGE.record_key(before): [{"path": "fixture.jsonl", "line": 1}]},
        {}, inputs, "unused", "unused")
    assert [row["action"] for row in rows] == ["correct", "add"]
    assert rows[0]["field_changes"] == {
        "description": {"before": before["description"], "after": corrected["description"]}
    }
    assert all(row["validation"] == "root_review_ready" for row in rows)
    assert len(inputs) == 2  # Ready manifest plus its containing freeze receipt.

    manifest_path.write_text(manifest_path.read_text(encoding="utf-8") + " ", encoding="utf-8")
    try:
        STAGE.process_embedded_ready_manifest(
            batch, [before], {42: before}, {STAGE.record_key(before): before},
            {STAGE.record_key(before): [{"path": "fixture.jsonl", "line": 1}]},
            {}, {}, "unused", "unused")
    except SystemExit as error:
        assert "ready manifest" in str(error) or "frozen input" in str(error)
    else:
        raise AssertionError("mutated frozen ready manifest was accepted")

print("PASS: research actions, catalogue fields, frozen ready manifest, provenance, field diffs and exact 20% arithmetic")
