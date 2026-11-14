"""Read-only public OSDR metadata. Never sends session text or health entries upstream."""

import json
import re
from datetime import datetime, timezone
from urllib.error import HTTPError, URLError
from urllib.parse import urlparse
from urllib.request import Request, urlopen

BASE = "https://visualization.osdr.nasa.gov/biodata/api/v2/dataset/"
TERMS = "https://science.nasa.gov/reference/osdr-help-terms-and-conditions/"
DOCS = "https://visualization.osdr.nasa.gov/biodata/api/"


class ResearchUnavailable(Exception):
    pass


def public_url(url):
    if not isinstance(url, str):
        return None
    parsed = urlparse(url)
    if parsed.scheme == "https" and parsed.hostname in {"osdr.nasa.gov", "visualization.osdr.nasa.gov"}:
        return url
    return None


def fetch_json(url):
    # Caller constructs from fixed host + validated accession. No user-supplied URLs.
    try:
        request = Request(
            url, headers={"Accept": "application/json", "User-Agent": "SpaceHealthResearchDemo/0.2"}
        )
        with urlopen(request, timeout=12) as response:
            if not public_url(response.url):
                raise ResearchUnavailable("Destino de la API no permitido.")
            body = response.read(2_000_001)
            if len(body) > 2_000_000:
                raise ResearchUnavailable("Respuesta OSDR demasiado grande.")
            return json.loads(body)
    except (HTTPError, URLError, TimeoutError, ValueError, OSError) as exc:
        raise ResearchUnavailable("No se pudo leer la API pública OSDR.") from exc


def texts(value):
    if value is None or value == "":
        return []
    if isinstance(value, str):
        return [value[:12000]]
    if isinstance(value, list):
        return [x[:12000] for x in value[:50] if isinstance(x, str)]
    return []


def import_study(accession, now, fetch=fetch_json):
    if not re.fullmatch(r"OSD-[1-9]\d{0,5}", accession):
        raise ValueError("Usa un identificador OSD- seguido de un número positivo.")
    url = BASE + accession + "/"
    payload = fetch(url)
    if not isinstance(payload, dict) or not isinstance(payload.get(accession), dict):
        raise ResearchUnavailable("El esquema de OSDR cambió o el estudio no está disponible.")
    root = payload[accession]
    metadata = root.get("metadata")
    if not isinstance(metadata, dict) or not isinstance(metadata.get("study title"), str):
        raise ResearchUnavailable("El estudio no contiene los campos esperados.")
    file_url = (
        public_url(root.get("files", {}).get("REST_URL")) if isinstance(root.get("files"), dict) else None
    )
    files, files_error, files_total = [], None, None
    # Do not follow arbitrary nested links, even returned by a remote source.
    expected_file_url = url + "files/"
    if file_url == expected_file_url:
        try:
            manifest = fetch(expected_file_url)
            raw_files = manifest.get(accession, {}).get("files", {})
            if not isinstance(raw_files, dict):
                raise ResearchUnavailable("Formato de manifiesto inesperado.")
            files_total = len(raw_files)
            files = [
                {
                    "name": name,
                    "metadata_url": public_url(info.get("REST_URL")),
                    "download_url": public_url(info.get("URL")),
                }
                for name, info in list(raw_files.items())[:500]
                if isinstance(name, str) and isinstance(info, dict)
            ]
        except (ResearchUnavailable, AttributeError):
            files_error = "No se pudo verificar el manifiesto de archivos."
    mission = metadata.get("mission") if isinstance(metadata.get("mission"), dict) else {}
    return {
        "accession": accession,
        "title": metadata["study title"][:1000],
        "organisms": texts(metadata.get("organism")),
        "materials": texts(metadata.get("material type")),
        "assay_types": texts(metadata.get("study assay measurement type")),
        "technologies": texts(metadata.get("study assay technology type")),
        "description": texts(metadata.get("study description")),
        "mission": {key: mission.get(key) for key in ["name", "start date", "end date"]},
        "publications": texts(metadata.get("study publication title")),
        "api_url": public_url(root.get("REST_URL")) or url,
        "files_api_url": file_url,
        "files": files,
        "files_error": files_error,
        "file_count_total": files_total,
        "files_truncated": files_total is not None and files_total > len(files),
        "retrieved_at": datetime.fromtimestamp(now, timezone.utc).isoformat(),
        "data_kind": "public_research_metadata_and_file_manifest",
        "measurement_data_downloaded": False,
        "used_for_training": False,
        "clinical_use": False,
        "api_docs_url": DOCS,
        "reuse": {
            "terms_url": TERMS,
            "license_status": "dataset_specific_license_not_verified",
            "attribution": "Metadata courtesy of NASA Open Science Data Repository and study authors.",
            "note": "Metadatos públicos consultados. Los términos piden citar el estudio. No se asume "
            "CC0 ni una licencia universal para cada archivo; revisar cita, versión y condiciones "
            "del dataset antes de reutilizar sus mediciones.",
        },
        "limitations": [
            "Investigación, no protocolo de atención ni lectura personal en vivo.",
            "No se infieren rangos clínicos ni causas a partir de este estudio.",
            "No se descargaron mediciones individuales ni se entrenó un modelo.",
            (
                "Organismo humano no demuestra que toda muestra sea de un astronauta; "
                "revisar población, material y diseño del estudio."
            ),
            "Resumen de campos de la fuente, no análisis ni validación científica de sus resultados.",
        ],
    }
