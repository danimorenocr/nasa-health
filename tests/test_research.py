import json
from pathlib import Path

import pytest

from app.research import BASE, ResearchUnavailable, import_study, public_url


def sample_fetch(url):
    root = {
        "REST_URL": BASE + "OSD-656/",
        "metadata": {
            "study title": "Synthetic metadata fixture",
            "organism": "Homo sapiens",
            "material type": "Urine",
            "study description": ["Research only"],
        },
        "files": {"REST_URL": BASE + "OSD-656/files/"},
    }
    if url.endswith("files/"):
        return {
            "OSD-656": {
                "files": {
                    "sample.csv": {
                        "URL": "https://osdr.nasa.gov/sample.csv",
                        "REST_URL": BASE + "OSD-656/file/sample.csv/",
                    }
                }
            }
        }
    return {"OSD-656": root}


def test_normalization_and_provenance():
    calls = []

    def fetch(url):
        calls.append(url)
        return sample_fetch(url)

    doc = import_study("OSD-656", 1800000000, fetch)
    assert doc["organisms"] == ["Homo sapiens"]
    assert doc["materials"] == ["Urine"]
    assert doc["files"][0]["name"] == "sample.csv"
    assert doc["measurement_data_downloaded"] is False
    assert doc["used_for_training"] is False
    assert doc["reuse"]["license_status"] == "dataset_specific_license_not_verified"
    assert calls == [BASE + "OSD-656/", BASE + "OSD-656/files/"]


@pytest.mark.parametrize(
    "accession", ["OSD-0", "../../secret", "https://bad.example", "OSD-3?x=a", "OSD-9999999"]
)
def test_no_arbitrary_upstream_urls(accession):
    with pytest.raises(ValueError):
        import_study(accession, 1800000000, lambda _: pytest.fail("No network expected"))


def test_upstream_schema_changed():
    with pytest.raises(ResearchUnavailable):
        import_study("OSD-656", 1800000000, lambda _: {"wrong": {}})
    assert public_url("https://evil.example/a") is None
    assert public_url("javascript:alert(1)") is None


def test_research_separate_and_cached(client, monkeypatch):
    from app import main

    def fail(*_args, **_kwargs):
        raise ResearchUnavailable("Offline")

    monkeypatch.setattr(main, "import_study", fail)
    listing = client.get("/api/v1/research/studies").json()
    assert len(listing["studies"]) >= 2
    r = client.get("/api/v1/research/studies/OSD-656")
    assert r.status_code == 200
    assert r.json()["cached"] is True
    assert r.json()["data_kind"] == "public_research_metadata_and_file_manifest"
    # Ensure snapshots don't contain downloaded individual measurements.
    for study in listing["studies"]:
        assert study["measurement_data_downloaded"] is False
        assert study["clinical_use"] is False
    assert client.get("/api/v1/research/studies/OSD-777777").status_code == 502
    assert client.get("/api/v1/research/studies/bad-id").status_code == 422


def test_bundled_live_snapshot_shape():
    path = Path(__file__).resolve().parents[1] / "research_snapshots/OSD-656.json"
    doc = json.loads(path.read_text())
    assert "Inspiration4" in doc["title"]
    assert doc["materials"] == ["Urine"]
    assert doc["organisms"] == ["Homo sapiens"]
    assert doc["files"] and doc["retrieved_at"]
