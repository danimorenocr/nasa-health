from app.catalog import INDICATORS


def test_guidance_endpoint_publico_y_completo(client):
    r = client.get("/api/v1/guidance")
    assert r.status_code == 200
    data = r.json()
    for key in (
        "intro",
        "challenge_questions",
        "hazards",
        "measures",
        "indicators",
        "medical_only",
        "not_monitored",
        "sources",
    ):
        assert key in data, key
    assert data["clinical_assessment"] == "not_performed"
    assert data["generated_by_ai"] is False
    assert len(data["challenge_questions"]) == 5
    assert len(data["hazards"]) == 5


def test_todos_los_indicadores_tienen_orientacion(client):
    data = client.get("/api/v1/guidance").json()
    codes = {i["code"] for i in data["indicators"]}
    assert codes == {i["code"] for i in INDICATORS}
    for item in data["indicators"]:
        assert item["what"] and item["purpose"] and item["attention"]
        assert item["instruments"], item["code"]
        assert item["not_shown"], item["code"]
        assert item["actions"], item["code"]
        for action in item["actions"]:
            # Cada acción enlazada trae su contexto y sus fuentes.
            assert action["context"] in {"space", "terrestrial", "both"}
            assert action["source_ids"]


def test_fuentes_resolubles_y_con_url(client):
    data = client.get("/api/v1/guidance").json()
    sources = {s["id"]: s for s in data["sources"]}
    referenced = set()
    for item in data["indicators"]:
        referenced.update(item["source_ids"])
        for action in item["actions"]:
            referenced.update(action["source_ids"])
    for measure in data["measures"]:
        referenced.update(measure["source_ids"])
    for block in data["medical_only"]:
        referenced.update(block["source_ids"])
    for hazard in data["hazards"]:
        referenced.update(hazard["source_ids"])
    for question in data["challenge_questions"]:
        referenced.update(question.get("source_ids", []))
    assert referenced <= set(sources), referenced - set(sources)
    for sid in referenced:
        assert sources[sid]["url"].startswith("https://"), sid
        assert sources[sid]["reviewed_at"], sid
        assert sources[sid]["scope"], sid


def test_sin_umbrales_clinicos_inventados(client):
    data = client.get("/api/v1/guidance").json()
    joined = " ".join(i["attention"] for i in data["indicators"]).lower()
    # Las señales de aviso no fijan cifras de corte clínicas.
    for forbidden in ("lpm", "mmhg", "mg/dl", "normal", "anormal"):
        assert forbidden not in joined, forbidden
