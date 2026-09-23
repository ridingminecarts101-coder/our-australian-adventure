"""Normalize external catalogue research into a review-only staging bundle.

This command never edits data/src, data/ids.json or data/adventures.json. It
accepts a JSON plan that names proposal/source JSONL files and writes a
manifest, ready-for-review JSONL files, holds, and a complete count report.

    python tools/stage_research_import.py PLAN.json --output REVIEW_DIR

Only after a human reviews the generated manifest should a separate change
copy approved rows into data/src and run tools/build_data.py. IDs remain the
build tool's responsibility; this staging command never allocates them.
"""
from __future__ import annotations

import argparse
import collections
import hashlib
import io
import importlib.util
import json
import os
import re
import subprocess
import tempfile
from pathlib import Path


ROOT = Path(__file__).resolve().parents[1]
DATA = ROOT / "data" / "adventures.json"
IDS = ROOT / "data" / "ids.json"
SRC = ROOT / "data" / "src"
FIELDS = (
    "continent", "country", "admin1", "region", "title", "place",
    "category", "difficulty", "cost", "duration", "season",
    "dog_friendly", "hidden_gem", "pack", "lat", "lon",
    "verified_at", "description",
)
OPTIONAL = ("tags", "bundle_only")
CONTINENTS = (
    "Oceania", "Asia", "Middle East", "Europe", "North America",
    "South America", "Africa", "Antarctica",
)
PACK_BY_CONTINENT = {
    "Oceania": "oceania", "Asia": "asia", "Middle East": "middle-east",
    "Europe": "europe", "North America": "north-america",
    "South America": "south-america", "Africa": "africa",
    "Antarctica": "all",
}
DESTRUCTIVE = re.compile(r"retire|remove|suppress|reserve|retain_legacy", re.I)
CONDITION = re.compile(r"clos(?:ed|ure)|unsafe|harm|danger|suspend|defer", re.I)
READY_STATES = {"review_ready", "root_review_ready", "schema_support_required"}


def jsonl(path: Path):
    with io.open(path, encoding="utf-8") as handle:
        for line_no, line in enumerate(handle, 1):
            if line.strip():
                try:
                    yield line_no, json.loads(line)
                except json.JSONDecodeError as error:
                    raise SystemExit(f"{path}:{line_no}: invalid JSON: {error}") from error


def sha(path: Path) -> str:
    return hashlib.sha256(path.read_bytes()).hexdigest()


def atomic_text(path: Path, text: str):
    path.parent.mkdir(parents=True, exist_ok=True)
    with tempfile.NamedTemporaryFile("w", encoding="utf-8", newline="\n",
                                     dir=path.parent, delete=False) as handle:
        handle.write(text)
        temp = Path(handle.name)
    temp.replace(path)


def record_key(record):
    return f"{record.get('country', '')}|{record.get('place', '')}"


def clean_candidate(raw):
    nested = raw.get("proposed") or raw.get("record")
    source = nested if isinstance(nested, dict) else raw
    return {key: source.get(key) for key in FIELDS + OPTIONAL if key in source}


def action_of(raw, candidate):
    action = str(raw.get("proposal_action") or raw.get("action") or "").lower()
    if DESTRUCTIVE.search(action):
        return "hold"
    if "replace" in action:
        return "hold"
    if "add" in action or raw.get("provisional_id"):
        return "add"
    if "correct" in action or "update" in action:
        return "correct"
    return "correct" if (raw.get("target_id") or raw.get("existing_id") or raw.get("id") or candidate.get("id")) else "hold"


def target_id_of(raw, candidate):
    return raw.get("target_id") or raw.get("existing_id") or raw.get("id") or candidate.get("id")


def source_keys(source):
    out = set()
    for field in ("id", "record_id", "target_id", "existing_id", "provisional_id", "proposal_id"):
        value = source.get(field)
        if value is not None:
            out.add(f"id:{value}")
    if source.get("country") and source.get("place"):
        out.add(f"key:{record_key(source)}")
    return out


def proposal_keys(raw, candidate, target_id):
    out = {f"key:{record_key(candidate)}"}
    nested = raw.get("proposed") or raw.get("record") or {}
    for value in (target_id, raw.get("provisional_id"), raw.get("proposal_id"),
                  nested.get("id") if isinstance(nested, dict) else None):
        if value is not None:
            out.add(f"id:{value}")
    return out


def raw_identifiers(raw):
    nested = raw.get("proposed") or raw.get("record") or {}
    values = []
    for field in ("id", "target_id", "existing_id", "provisional_id", "proposal_id"):
        if raw.get(field) is not None:
            values.append(str(raw[field]))
    if isinstance(nested, dict) and nested.get("id") is not None:
        values.append(str(nested["id"]))
    return set(values)


def field_changes(before, candidate):
    """Return every catalogue field changed by a correction."""
    return {
        field: {"before": before.get(field), "after": candidate.get(field)}
        for field in FIELDS + OPTIONAL
        if before.get(field) != candidate.get(field)
    }


def verify_frozen_file_manifest(base, frozen_path, expected_manifest_sha=None):
    """Verify a B-style exhaustive JSON freeze receipt and return its files."""
    if expected_manifest_sha and sha(frozen_path).lower() != expected_manifest_sha.lower():
        raise SystemExit("frozen manifest hash mismatch")
    frozen = json.loads(frozen_path.read_text(encoding="utf-8"))
    files = frozen.get("files")
    if not isinstance(files, list) or frozen.get("artifact_count") != len(files):
        raise SystemExit("frozen manifest artifact count does not match its file list")
    seen = set()
    for entry in files:
        relative = entry.get("path")
        if not isinstance(relative, str) or not relative or relative in seen:
            raise SystemExit("frozen manifest has a missing or duplicate file path")
        seen.add(relative)
        path = base / relative
        if not path.is_file():
            raise SystemExit(f"frozen input is missing: {relative}")
        if path.stat().st_size != entry.get("bytes"):
            raise SystemExit(f"frozen input byte count mismatch: {relative}")
        if sha(path).lower() != str(entry.get("sha256", "")).lower():
            raise SystemExit(f"frozen input hash mismatch: {relative}")
    return frozen, files


def process_embedded_ready_manifest(batch, canonical, by_id, by_key, locations,
                                    ids, input_hashes, canonical_hash, ids_hash):
    """Load B's sole authoritative ready-only JSON manifest with embedded evidence."""
    base = Path(batch["research_root"])
    frozen_path = Path(batch["frozen_hashes"])
    manifest_path = Path(batch["ready_manifest"])
    frozen, files = verify_frozen_file_manifest(
        base, frozen_path, batch.get("expected_frozen_manifest_sha256"))
    if frozen.get("pinned_application_commit") != batch.get("canonical_commit"):
        raise SystemExit("B frozen manifest targets a different application commit")
    authoritative = frozen.get("authoritative_ready_manifest")
    if authoritative != manifest_path.name:
        raise SystemExit("B frozen manifest names a different authoritative ready manifest")
    frozen_ready = next((entry for entry in files if entry.get("path") == authoritative), None)
    if frozen_ready is None:
        raise SystemExit("B ready manifest is absent from the frozen artifact set")
    expected_ready_sha = batch.get("expected_ready_manifest_sha256")
    if expected_ready_sha and sha(manifest_path).lower() != expected_ready_sha.lower():
        raise SystemExit("B ready manifest hash mismatch")
    if sha(manifest_path).lower() != str(frozen_ready.get("sha256", "")).lower():
        raise SystemExit("B ready manifest differs from its frozen file entry")
    for entry in files:
        input_hashes[str(base / entry["path"])] = str(entry["sha256"]).lower()
    input_hashes[str(frozen_path)] = sha(frozen_path)

    document = json.loads(manifest_path.read_text(encoding="utf-8"))
    rows = document.get("proposals")
    if not isinstance(rows, list) or document.get("proposal_count") != len(rows):
        raise SystemExit("B ready manifest proposal count does not match its rows")
    expected_rows = batch.get("expected_manifest_rows")
    if expected_rows is not None and len(rows) != expected_rows:
        raise SystemExit(f"B ready manifest has {len(rows)} rows, expected {expected_rows}")

    staged = []
    seen_references, seen_targets, seen_additions = set(), set(), set()
    action_counts = collections.Counter()
    for line_no, raw in enumerate(rows, 1):
        issues = []
        action = raw.get("action")
        action_counts[action] += 1
        reference = str(raw.get("reference_id") or "")
        if not reference or reference in seen_references:
            issues.append("reference_id is missing or duplicated")
        seen_references.add(reference)
        if raw.get("integration_status") not in {"ready", "ready_with_caveat"}:
            issues.append("ready-only manifest contains a non-ready integration status")
        if raw.get("duplicate_of") is not None:
            issues.append("ready-only manifest contains a duplicate/retirement row")

        record = raw.get("record")
        if not isinstance(record, dict):
            record = {}
            issues.append("record must be an embedded object")
        candidate = clean_candidate({"record": record})
        issues.extend(candidate_errors(candidate))
        evidence = raw.get("evidence")
        if not isinstance(evidence, list):
            evidence = []
        issues.extend(source_errors(evidence, candidate.get("hidden_gem") is True,
                                    {f"id:{reference}"}))
        for source in evidence:
            source_ref = source.get("reference_id")
            source_id = source.get("id")
            allowed_source_ids = {reference, str(record.get("id") or "")}
            if (str(source_ref or "") != reference
                    or (source_id is not None and str(source_id) not in allowed_source_ids)):
                issues.append("embedded evidence does not match proposal reference_id")
            if source.get("country") != candidate.get("country"):
                issues.append("embedded evidence country does not match candidate")

        target_id, provisional_id = raw.get("target_id"), raw.get("provisional_id")
        before = None
        if action == "correct":
            if not isinstance(target_id, int) or target_id in seen_targets:
                issues.append("correction target_id is invalid or duplicated")
            seen_targets.add(target_id)
            before = by_id.get(target_id)
            if before is None:
                issues.append(f"target id {target_id!r} is absent from canonical data")
            else:
                if record.get("id") != target_id:
                    issues.append("correction record does not preserve target_id")
                if raw.get("preserve_numeric_id") is not True or provisional_id is not None:
                    issues.append("correction must preserve its numeric ID and have no provisional ID")
                if record_key(before) != record_key(candidate):
                    issues.append(f"target identity changed from {record_key(before)}")
                if len(locations.get(record_key(candidate), [])) != 1:
                    issues.append("canonical country|place must resolve to exactly one data/src row")
                if not field_changes(before, candidate):
                    issues.append("correction does not change any catalogue field")
        elif action == "add":
            if target_id is not None or not isinstance(provisional_id, str):
                issues.append("addition must have only a provisional ID")
            if reference != str(provisional_id or "") or record.get("id") != provisional_id:
                issues.append("addition record/reference does not match provisional ID")
            if raw.get("preserve_numeric_id") is not False:
                issues.append("addition must defer numeric ID allocation")
            identity = record_key(candidate)
            if identity in seen_additions:
                issues.append("addition duplicates another ready proposal identity")
            seen_additions.add(identity)
            if identity in by_key or identity in ids:
                issues.append("addition duplicates a current or reserved country|place identity")
        else:
            issues.append("ready-only manifest action must be add or correct")

        changes = field_changes(before, candidate) if before else {}
        staged.append({
            "batch": batch["name"], "manifest_file": str(manifest_path),
            "line": line_no, "action": action, "identity": record_key(candidate),
            "target_id": target_id, "provisional_id": provisional_id,
            "candidate": candidate, "canonical_before": before,
            "canonical_source": locations.get(record_key(candidate), []),
            "sources": evidence, "manifest": raw, "field_changes": changes,
            "issues": sorted(set(issues)), "review_flags": [],
            "technical_validation": "pass" if not issues else "fail",
            "validation": "root_review_ready" if not issues else "hold",
        })

    expected_actions = batch.get("expected_actions", {})
    if expected_actions and dict(action_counts) != expected_actions:
        raise SystemExit(f"B ready manifest action counts mismatch: {dict(action_counts)}")
    if any(item["issues"] for item in staged):
        failures = [f"line {item['line']}: {'; '.join(item['issues'])}"
                    for item in staged if item["issues"]]
        raise SystemExit("B ready manifest failed validation: " + " | ".join(failures))
    return staged


def process_authoritative_manifest(batch, canonical, by_id, by_key, locations,
                                   input_hashes, canonical_hash, ids_hash):
    """Load a frozen, integration-facing manifest instead of discovering rows."""
    base = Path(batch["research_root"])
    frozen_path = Path(batch["frozen_hashes"])
    manifest_path = Path(batch["integration_manifest"])
    verification = subprocess.run(
        ["node", "freeze-inputs.mjs", "--verify"], cwd=base,
        text=True, capture_output=True)
    if verification.returncode:
        raise SystemExit("frozen input verification failed: " + verification.stdout + verification.stderr)
    frozen = json.loads(frozen_path.read_text(encoding="utf-8"))
    if frozen.get("canonical", {}).get("adventures_sha256") != canonical_hash \
            or frozen.get("canonical", {}).get("ids_sha256") != ids_hash:
        raise SystemExit("frozen manifest canonical hashes do not match this checkout")
    for relative, digest in frozen["input_sha256"].items():
        path = base / relative
        if sha(path) != digest:
            raise SystemExit(f"frozen input hash mismatch: {relative}")
        input_hashes[str(path)] = digest
    input_hashes[str(frozen_path)] = sha(frozen_path)
    input_hashes[str(manifest_path)] = sha(manifest_path)

    all_sources = []
    source_index = collections.defaultdict(list)
    for relative in frozen["input_sha256"]:
        if "source" not in Path(relative).name.lower() or not relative.endswith(".jsonl"):
            continue
        for _, source in jsonl(base / relative):
            all_sources.append(source)
            for key in source_keys(source):
                source_index[key].append(source)

    raw_cache = {}
    staged = []
    manifest_rows = [row for _, row in jsonl(manifest_path)]
    expected_rows = batch.get("expected_manifest_rows")
    if expected_rows is not None and len(manifest_rows) != expected_rows:
        raise SystemExit(f"authoritative manifest has {len(manifest_rows)} rows, expected {expected_rows}")

    for line_no, entry in enumerate(manifest_rows, 1):
        source_path = base / entry["source_file"]
        if sha(source_path) != entry["source_file_sha256"]:
            raise SystemExit(f"manifest source hash mismatch at line {line_no}")
        if source_path not in raw_cache:
            raw_cache[source_path] = [row for _, row in jsonl(source_path)]
        wanted = {str(x) for x in (entry.get("existing_id"), entry.get("provisional_id"), entry.get("action_id")) if x is not None}
        matches_raw = [raw for raw in raw_cache[source_path] if raw_identifiers(raw) & wanted]
        if len(matches_raw) > 1:
            exact_action = [raw for raw in matches_raw
                            if str(raw.get("proposal_action") or raw.get("action") or raw.get("decision") or "")
                            == str(entry.get("source_action") or "")]
            if exact_action:
                matches_raw = exact_action
        issues = []
        if len(matches_raw) != 1:
            issues.append(f"source action resolves to {len(matches_raw)} rows, expected one")
            raw = {}
        else:
            raw = matches_raw[0]
        candidate = clean_candidate(raw)
        operation = entry["operation"]
        if operation == "add_after_central_numeric_id_allocation":
            action = "add"
        elif operation == "update_existing_by_id":
            action = "correct"
        elif operation == "reversible_site_specific_suppression_by_existing_id":
            action = "suppress"
        else:
            action = "no_action"

        existing_id = entry.get("existing_id")
        before = by_id.get(existing_id) if existing_id is not None else None
        if existing_id is not None:
            if before is None:
                issues.append(f"existing id {existing_id} is absent from canonical data")
            else:
                if before["country"] != entry.get("country"):
                    issues.append(f"manifest country differs from canonical {before['country']}")
                if before["place"] != entry.get("place"):
                    issues.append(f"manifest place differs from canonical {before['place']}")

        source_matches = []
        attempted = proposal_keys(raw, candidate, existing_id)
        attempted |= {f"id:{x}" for x in wanted}
        for key in attempted:
            source_matches.extend(source_index.get(key, []))
        source_matches = list({json.dumps(x, sort_keys=True): x for x in source_matches}.values())

        if action in {"add", "correct", "suppress"}:
            issues.extend(candidate_errors(candidate))
            if action == "add":
                key = record_key(candidate)
                if key in by_key:
                    issues.append("addition duplicates current country|place identity")
            elif before is not None and record_key(candidate) != record_key(before):
                issues.append(f"candidate identity changed from {record_key(before)}")
            issues.extend(source_errors(source_matches, candidate.get("hidden_gem") is True, attempted))

        if entry.get("ingest_approved") is not False:
            issues.append("authoritative manifest must remain ingest_approved=false before root review")
        technical = "pass" if not issues else "fail"
        review_flags = []
        if action == "suppress":
            review_flags.append("requires a reversible suppression field and client filtering; deleting the source row is not acceptable")
        if CONDITION.search(json.dumps({"entry": entry, "raw": raw, "sources": source_matches}, ensure_ascii=False)):
            review_flags.append("contains closure, safety, harm or deferral context; inspect the specific evidence")

        if issues:
            validation = "hold"
        elif entry.get("held") or not entry.get("ready_for_root_review"):
            validation = "held_no_action" if action == "no_action" else "held"
            issues.append(str(entry.get("hold_reason") or "authoritative manifest holds this row"))
        elif action == "suppress":
            validation = "schema_support_required"
        else:
            validation = "root_review_ready"

        staged.append({
            "batch": batch["name"], "manifest_file": str(manifest_path), "line": line_no,
            "action": action, "identity": f"{entry.get('country')}|{entry.get('place')}",
            "target_id": existing_id, "provisional_id": entry.get("provisional_id"),
            "candidate": candidate, "canonical_before": before,
            "canonical_source": locations.get(record_key(before), []) if before else [],
            "sources": source_matches, "manifest": entry, "issues": sorted(set(issues)),
            "review_flags": sorted(set(review_flags)), "technical_validation": technical,
            "validation": validation,
        })
    return staged


def rationale(source):
    return str(source.get("hidden_gem_rationale") or source.get("gem_rationale") or "").strip()


def support_text(source):
    return str(source.get("supports") or source.get("claim_supported") or source.get("claim") or "").strip()


def candidate_errors(candidate):
    errors = []
    missing = [field for field in FIELDS if field not in candidate]
    if missing:
        errors.append("missing fields: " + ", ".join(missing))
        return errors
    if not candidate.get("country") or not candidate.get("place"):
        errors.append("country and place are required")
    if not re.fullmatch(r"\d{4}-\d{2}-\d{2}", str(candidate.get("verified_at", ""))):
        errors.append("verified_at must be YYYY-MM-DD")
    hidden = candidate.get("hidden_gem") is True
    expected = PACK_BY_CONTINENT.get(candidate.get("continent"))
    if hidden and candidate.get("pack") != expected:
        errors.append(f"hidden gem pack must be {expected!r}")
    if not hidden and candidate.get("pack") is not None:
        errors.append("non-gem pack must be null")
    if candidate.get("bundle_only") and candidate.get("continent") != "Antarctica":
        errors.append("bundle_only is reserved for Antarctica")
    return errors


def source_errors(matches, hidden, attempted):
    if not matches:
        return ["no matching source sidecar for " + ", ".join(sorted(attempted))]
    errors = []
    usable = []
    for source in matches:
        url = str(source.get("url", ""))
        publisher = str(source.get("publisher", "")).strip()
        support = support_text(source)
        if url.startswith("https://") and publisher and support:
            usable.append(source)
    if not usable:
        missing = []
        if not any(str(s.get("url", "")).startswith("https://") for s in matches):
            missing.append("HTTPS url")
        if not any(str(s.get("publisher", "")).strip() for s in matches):
            missing.append("publisher")
        if not any(support_text(s) for s in matches):
            missing.append("supported claim")
        errors.append("matched source missing " + ", ".join(missing))
    if hidden and not any(len(rationale(source)) >= 30 for source in usable):
        errors.append("hidden gem needs a substantive source-sidecar rationale")
    return errors


def canonical_sources():
    locations = collections.defaultdict(list)
    for path in sorted(SRC.glob("*.jsonl")):
        for line_no, row in jsonl(path):
            locations[record_key(row)].append({"path": str(path.relative_to(ROOT)), "line": line_no})
    return locations


def additions_needed(total, gems):
    return max(0, (total - 5 * gems + 3) // 4)


def authoritative_count_model(items, baseline):
    """Apply a frozen manifest's staged, active and conservative arithmetic."""
    rows = baseline["rows"]
    gems = baseline["gems"]
    for item in items:
        if item["technical_validation"] != "pass":
            continue
        if item["action"] == "add":
            rows += 1
            gems += int(item["candidate"]["hidden_gem"])
        elif item["action"] == "correct":
            gems += (int(item["candidate"]["hidden_gem"])
                     - int(item["canonical_before"]["hidden_gem"]))
    stored = {"rows": rows, "gems": gems}

    suppressed = [item for item in items
                  if item["technical_validation"] == "pass"
                  and item["action"] == "suppress"]
    active = {
        "rows": stored["rows"] - len(suppressed),
        "gems": stored["gems"] - sum(int(item["canonical_before"]["hidden_gem"])
                                      for item in suppressed),
    }
    held_additions = [item for item in items
                      if item["technical_validation"] == "pass"
                      and item["action"] == "add"
                      and item["validation"] not in READY_STATES]
    conservative = {
        "rows": active["rows"] - len(held_additions),
        "gems": active["gems"] - sum(int(item["candidate"]["hidden_gem"])
                                      for item in held_additions),
    }
    return {"baseline": dict(baseline), "stored": stored,
            "active": active, "conservative": conservative}


def load_registry():
    path = ROOT / "tools" / "countries.py"
    spec = importlib.util.spec_from_file_location("wayfinder_staging_countries", path)
    module = importlib.util.module_from_spec(spec)
    spec.loader.exec_module(module)
    return module.COUNTRIES, module.ADVISORIES


def render_report(canonical, staged, batches, canonical_hash, ids_hash,
                  count_models):
    registry, advisories = load_registry()
    by_country = collections.defaultdict(lambda: [0, 0])
    country_continent = {}
    for row in canonical:
        by_country[row["country"]][0] += 1
        by_country[row["country"]][1] += int(bool(row["hidden_gem"]))
        country_continent[row["country"]] = row["continent"]

    technically_valid = [r for r in staged if r["technical_validation"] == "pass"]
    review_ready = [r for r in staged if r["validation"] in READY_STATES]
    projected = {code: values[:] for code, values in by_country.items()}
    for item in technically_valid:
        candidate = item["candidate"]
        code = candidate["country"]
        if item["action"] == "add":
            projected.setdefault(code, [0, 0])[0] += 1
            projected[code][1] += int(candidate["hidden_gem"])
            country_continent.setdefault(code, candidate["continent"])
        elif item["action"] == "correct":
            before = item["canonical_before"]
            projected[code][1] += int(candidate["hidden_gem"]) - int(before["hidden_gem"])

    lines = [
        "# Catalogue research staging report — 14 September 2026", "",
        "This report separates the currently built catalogue from unapproved research proposals. No canonical source row or ID was changed.", "",
        f"- Canonical `data/adventures.json`: {len(canonical):,} rows; SHA-256 `{canonical_hash}`",
        f"- Canonical `data/ids.json`: SHA-256 `{ids_hash}`",
        f"- Proposal rows inspected: {len(staged):,}",
        f"- Technically valid proposals (including unfinished batches): {len(technically_valid):,}",
        f"- Ready after batch-completeness gate: {len(review_ready):,}",
        f"- Held/rejected: {len(staged) - len(review_ready):,}", "",
        "## Research package state", "",
        "| Batch | Declared state | Proposals | Technically valid | Ready | Held |", "|---|---:|---:|---:|---:|---:|",
    ]
    for batch in batches:
        subset = [x for x in staged if x["batch"] == batch["name"]]
        valid = sum(x["technical_validation"] == "pass" for x in subset)
        ready = sum(x["validation"] in READY_STATES for x in subset)
        lines.append(f"| {batch['name']} | {batch['state']} | {len(subset)} | {valid} | {ready} | {len(subset)-ready} |")
    lines += ["", "## Review-ready change totals", "",
              f"- Additions: **{sum(x['validation'] in READY_STATES and x['action'] == 'add' for x in staged):,}**",
              f"- Corrections: **{sum(x['validation'] in READY_STATES and x['action'] == 'correct' for x in staged):,}**",
              f"- Reversible suppression schema holds: **{sum(x['validation'] == 'schema_support_required' for x in staged):,}**"]
    for batch in batches:
        if batch.get("excluded_note"):
            lines += ["", f"**Excluded from {batch['name']}:** {batch['excluded_note']}"]

    if count_models:
        lines += ["", "## Frozen manifest count models", "",
                  "Stored includes every technically valid manifest addition and correction. Active also applies reversible suppressions. Conservative further excludes held additions. These are review arithmetic, not canonical changes.", "",
                  "| Batch | Baseline | Stored | Active | Conservative |", "|---|---:|---:|---:|---:|"]
        for name, model in count_models.items():
            cells = [f"{model[key]['gems']} gems / {model[key]['rows']} rows"
                     for key in ("baseline", "stored", "active", "conservative")]
            lines.append(f"| {name} | {' | '.join(cells)} |")
        for batch in batches:
            if batch.get("count_model_discrepancy"):
                lines += ["", f"**Frozen-source discrepancy — {batch['name']}:** "
                          + batch["count_model_discrepancy"]]

    lines += ["", "## Technically valid research proposals", "",
              "These rows passed identity, field and provenance checks. A row may still be held because its research batch is unfinished. Every row remains unapproved.", "",
              "### Meaningful sourced additions", "",
              "| Batch | Country | Place | Proposed experience | Evidence publisher | Gem rationale |",
              "|---|---|---|---|---|---|"]
    ready_additions = [x for x in technically_valid if x["action"] == "add"]
    for item in ready_additions:
        candidate = item["candidate"]
        source = item["sources"][0]
        why = rationale(source).replace("|", "\\|")
        place = str(candidate["place"]).replace("|", "\\|")
        title = str(candidate["title"]).replace("|", "\\|")
        publisher = str(source.get("publisher", "")).replace("|", "\\|")
        lines.append(f"| {item['batch']} | {candidate['country']} | {place} | {title} | {publisher} | {why} |")
    if not ready_additions:
        lines.append("| — | — | — | — | — | — |")

    lines += ["", "### Existing-row corrections", "",
              "| Batch | ID | Identity | Changed fields | Evidence publisher |",
              "|---|---:|---|---|---|"]
    ready_corrections = [x for x in technically_valid if x["action"] == "correct"]
    for item in ready_corrections:
        candidate, before = item["candidate"], item["canonical_before"]
        changes = item.get("field_changes") or field_changes(before, candidate)
        change = ", ".join(sorted(changes))
        publishers = ", ".join(sorted({str(s.get("publisher", "")) for s in item["sources"] if s.get("publisher")}))
        escaped_place = str(candidate["place"]).replace("|", "\\|")
        identity = f"{candidate['country']}\\|{escaped_place}"
        lines.append(f"| {item['batch']} | {item['target_id']} | {identity} | {change} | {publishers} |")
    if not ready_corrections:
        lines.append("| — | — | — | — | — |")

    suppressions = [x for x in staged if x["action"] == "suppress"]
    lines += ["", "### Site-specific suppression proposals", "",
              "These keep their existing IDs and rows. They require a reversible suppression field and client behavior before integration; removing their source rows would break historical browse/progress access.", "",
              "| ID | Identity | Review state | Evidence flag |", "|---:|---|---|---|"]
    for item in suppressions:
        identity = str(item["identity"]).replace("|", "\\|")
        flags = "; ".join(item["review_flags"]).replace("|", "\\|")
        lines.append(f"| {item['target_id']} | {identity} | {item['validation']} | {flags} |")
    if not suppressions:
        lines.append("| — | — | — | — |")

    lines += ["", "## Final built catalogue (authoritative)", ""]
    for continent in CONTINENTS:
        codes = sorted(code for code in by_country if country_continent.get(code) == continent)
        total = sum(by_country[c][0] for c in codes)
        gems = sum(by_country[c][1] for c in codes)
        lines += [f"### {continent} — {total:,} adventures / {gems:,} gems", ""]
        for code in codes:
            total, gems = by_country[code]
            name = registry.get(code, (code,))[0]
            lines += [f"#### {name} ({code})", "",
                      f"{total} adventures; {gems} gems; {100*gems/total:.1f}% gem share.", ""]
        lines.append("")

    lines += ["## Optional historical planning benchmark after strict reclassifications", "",
              "These figures apply every structurally valid addition/correction to the former 20% planning benchmark for arithmetic and backwards-compatible reporting only. The benchmark is not a catalogue requirement, quality gate or recommendation to add activities. The figures do not mean the proposals are approved or recommend adding activities in countries under an `avoid` advisory. Wayfinder retains existing historical browse rows with warnings unless a site-specific closure or harm decision is approved.", ""]
    short = []
    for code in sorted(projected):
        total, gems = projected[code]
        need = additions_needed(total, gems)
        if total and need:
            short.append((country_continent.get(code, "Unknown"), code, total, gems, need))
    lines += [f"Countries below the optional historical 20% benchmark after the staged strict reclassifications: **{len(short)}**.",
              f"Gem-only rows in the benchmark calculation: **{sum(x[4] for x in short)}**.", "",
              "| Continent | Country | Advisory | Projected adventures | Projected gems | Benchmark gem-only rows |",
              "|---|---|---|---:|---:|---:|"]
    for continent, code, total, gems, need in short:
        name = registry.get(code, (code,))[0]
        advisory = advisories.get(code, ("none",))[0]
        lines.append(f"| {continent} | {name} ({code}) | {advisory} | {total} | {gems} | {need} |")

    lines += ["", "## Held and rejected proposals", ""]
    held = [x for x in staged if x["validation"] not in READY_STATES]
    if not held:
        lines.append("None.")
    else:
        lines += ["| Batch | Action | Identity | Reason |", "|---|---|---|---|"]
        for item in held:
            identity = str(item.get("identity") or "unknown").replace("|", "\\|")
            reason = "; ".join(item["issues"]).replace("|", "\\|")
            lines.append(f"| {item['batch']} | {item['action']} | {identity} | {reason} |")
    return "\n".join(lines) + "\n"


def main():
    parser = argparse.ArgumentParser()
    parser.add_argument("plan", type=Path)
    parser.add_argument("--output", required=True, type=Path)
    args = parser.parse_args()

    plan = json.loads(args.plan.read_text(encoding="utf-8"))
    canonical_hash, ids_hash = sha(DATA), sha(IDS)
    head = subprocess.check_output(
        ["git", "rev-parse", "HEAD"], cwd=ROOT, text=True).strip()
    if plan.get("canonical_commit") != head:
        raise SystemExit(f"plan targets {plan.get('canonical_commit')}, but HEAD is {head}")
    expected = plan.get("canonical_sha256", {})
    if expected.get("adventures") != canonical_hash or expected.get("ids") != ids_hash:
        raise SystemExit("canonical data hashes do not match the reviewed plan")
    canonical = json.loads(DATA.read_text(encoding="utf-8"))
    ids = json.loads(IDS.read_text(encoding="utf-8"))["ids"]
    by_id = {row["id"]: row for row in canonical}
    by_key = {record_key(row): row for row in canonical}
    locations = canonical_sources()
    staged, input_hashes, count_models = [], {}, {}

    for batch in plan["batches"]:
        if batch.get("ready_manifest"):
            batch = {**batch, "canonical_commit": plan.get("canonical_commit")}
            staged.extend(process_embedded_ready_manifest(
                batch, canonical, by_id, by_key, locations, ids, input_hashes,
                canonical_hash, ids_hash))
            continue
        if batch.get("integration_manifest"):
            batch_items = process_authoritative_manifest(
                batch, canonical, by_id, by_key, locations, input_hashes,
                canonical_hash, ids_hash)
            staged.extend(batch_items)
            if batch.get("count_model"):
                model = authoritative_count_model(batch_items,
                                                  batch["count_model"]["baseline"])
                expected_model = batch["count_model"]
                if model != expected_model:
                    raise SystemExit(
                        f"{batch['name']} count model mismatch: computed {model}, expected {expected_model}")
                count_models[batch["name"]] = model
            continue
        sources = []
        source_index = collections.defaultdict(list)
        for raw_path in batch["sources"]:
            path = Path(raw_path)
            input_hashes[str(path)] = sha(path)
            for _, source in jsonl(path):
                sources.append(source)
                for key in source_keys(source):
                    source_index[key].append(source)

        for raw_path in batch["proposals"]:
            path = Path(raw_path)
            input_hashes[str(path)] = sha(path)
            for line_no, raw in jsonl(path):
                candidate = clean_candidate(raw)
                action = action_of(raw, candidate)
                target_id = target_id_of(raw, candidate)
                identity = record_key(candidate) if candidate else str(target_id or raw.get("provisional_id") or "unknown")
                issues = []

                if action == "hold":
                    issues.append("destructive, replacement or ambiguous action requires root decision")
                else:
                    issues.extend(candidate_errors(candidate))
                before = by_id.get(target_id) if action == "correct" else None
                if action == "correct":
                    if before is None:
                        issues.append(f"target id {target_id!r} is absent from canonical data")
                    elif record_key(before) != record_key(candidate):
                        issues.append(f"target identity changed from {record_key(before)}")
                    if len(locations.get(record_key(candidate), [])) != 1:
                        issues.append("canonical country|place must resolve to exactly one data/src row")
                elif action == "add":
                    if record_key(candidate) in by_key or record_key(candidate) in ids:
                        issues.append("addition duplicates a current or reserved country|place identity")

                attempted_keys = proposal_keys(raw, candidate, target_id)
                matches = []
                for key in attempted_keys:
                    matches.extend(source_index.get(key, []))
                matches = list({json.dumps(x, sort_keys=True): x for x in matches}.values())
                if action != "hold":
                    issues.extend(source_errors(matches, candidate.get("hidden_gem") is True, attempted_keys))
                state = str(batch.get("state", "pending"))
                integration = str(raw.get("integration_status", ""))
                combined = json.dumps({"proposal": raw, "sources": matches}, ensure_ascii=False)
                technical_validation = "pass" if not issues else "fail"
                if state != "complete":
                    issues.append(f"research batch is {state}, not complete")
                if integration and not integration.startswith("ready"):
                    issues.append(f"integration status is {integration}")
                review_flags = []
                if CONDITION.search(combined):
                    review_flags.append("proposal contains closure, safety, harm or deferral language; inspect context")

                staged.append({
                    "batch": batch["name"], "proposal_file": str(path), "line": line_no,
                    "action": action, "identity": identity, "target_id": target_id,
                    "candidate": candidate, "canonical_before": before,
                    "canonical_source": locations.get(record_key(candidate), []),
                    "sources": matches, "issues": sorted(set(issues)),
                    "review_flags": review_flags,
                    "technical_validation": technical_validation,
                    "validation": "review_ready" if not issues else "hold",
                })

    # Conflicting proposals for the same existing ID or new identity are held.
    collision = collections.defaultdict(list)
    for index, item in enumerate(staged):
        key = f"id:{item['target_id']}" if item["action"] == "correct" else f"key:{item['identity']}"
        if item["action"] != "hold":
            collision[key].append(index)
    for key, indexes in collision.items():
        candidates = {json.dumps(staged[i]["candidate"], sort_keys=True) for i in indexes}
        if len(indexes) > 1 and len(candidates) > 1:
            for index in indexes:
                staged[index]["issues"].append(f"conflicting proposal collision on {key}")
                staged[index]["validation"] = "hold"
                staged[index]["technical_validation"] = "fail"

    changed_inputs = [path for path, digest in input_hashes.items() if sha(Path(path)) != digest]
    if changed_inputs:
        raise SystemExit("research input changed during staging: " + ", ".join(changed_inputs))

    for item in staged:
        if item["action"] == "correct" and item.get("canonical_before"):
            item["field_changes"] = field_changes(item["canonical_before"], item["candidate"])

    manifest = {
        "format": 1, "mode": "review-only", "canonical_commit": plan.get("canonical_commit"),
        "canonical": {"adventures_sha256": canonical_hash, "ids_sha256": ids_hash},
        "input_sha256": input_hashes, "batches": plan["batches"],
        "count_models": count_models, "proposals": staged,
    }
    output = args.output.resolve()
    ready_add = [x for x in staged if x["validation"] in READY_STATES and x["action"] == "add"]
    ready_fix = [x for x in staged if x["validation"] in READY_STATES and x["action"] == "correct"]
    ready_diffs = [{
        "batch": x["batch"], "target_id": x["target_id"], "identity": x["identity"],
        "field_changes": x["field_changes"],
    } for x in ready_fix]
    suppressions = [x for x in staged if x["validation"] == "schema_support_required"]
    held = [x for x in staged if x["validation"] not in READY_STATES]
    atomic_text(output / "manifest.json", json.dumps(manifest, ensure_ascii=False, indent=2) + "\n")
    for filename, rows in (("review-additions.jsonl", ready_add),
                           ("review-corrections.jsonl", ready_fix),
                           ("review-field-diffs.jsonl", ready_diffs),
                           ("review-suppressions.jsonl", suppressions),
                           ("holds.jsonl", held)):
        atomic_text(output / filename, "".join(json.dumps(row, ensure_ascii=False) + "\n" for row in rows))
    atomic_text(output / "CATALOGUE-STAGING-REPORT.md",
                render_report(canonical, staged, plan["batches"], canonical_hash,
                              ids_hash, count_models))

    if sha(DATA) != canonical_hash or sha(IDS) != ids_hash:
        raise SystemExit("canonical data changed during review-only staging")
    print(f"Staged {len(staged)} proposals: {len(ready_add)} additions, "
          f"{len(ready_fix)} corrections, {len(suppressions)} suppression-schema holds, {len(held)} held")
    print(f"Canonical unchanged: {len(canonical)} rows; ids SHA-256 {ids_hash}")
    print(output)


if __name__ == "__main__":
    main()
