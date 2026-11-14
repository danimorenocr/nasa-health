"""Explicit public research metadata import. No health records, audio or session tokens sent."""

import json
import sys
import time
from pathlib import Path

sys.path.insert(0, str(Path(__file__).resolve().parents[1]))
from app.research import import_study

root = Path(__file__).resolve().parents[1] / "research_snapshots"
root.mkdir(exist_ok=True)
for accession in sys.argv[1:] or ["OSD-656", "OSD-48"]:
    document = import_study(accession, time.time())
    path = root / f"{accession}.json"
    path.write_text(json.dumps(document, ensure_ascii=False, indent=2) + "\n", encoding="utf-8")
    print(f"{accession}: {document['title']}; {len(document['files'])} archivos, solo catálogo; {path.name}")
