"""Reference parity harness.

This deliberately reports an unavailable/unapproved reference instead of
claiming Excel parity from the runtime workbook alone.
"""
import json
from pathlib import Path


def parity_report(actual: dict, reference_path: Path) -> dict:
    if not reference_path.exists():
        return {"status": "unavailable_unapproved", "reason": "approved reference fixture is absent"}
    reference = json.loads(reference_path.read_text(encoding="utf-8"))
    expected = reference.get("metrics", {})
    observed = actual.get("metrics", {})
    mismatches = {key: {"actual": observed.get(key), "reference": value}
                  for key, value in expected.items() if observed.get(key) != value}
    return {"status": "matched" if not mismatches else "mismatch", "mismatches": mismatches}


def test_parity_does_not_claim_missing_reference(tmp_path):
    report = parity_report({"metrics": {"contractorNpv10": 1}}, tmp_path / "approved-reference.json")
    assert report["status"] == "unavailable_unapproved"
