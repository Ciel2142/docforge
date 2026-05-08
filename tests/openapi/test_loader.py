import json
from pathlib import Path

import pytest

from docforge.openapi.loader import UnsupportedSpecError, load_spec


def test_load_spec_json(petstore_path: Path) -> None:
    spec = load_spec(petstore_path)
    assert spec["openapi"].startswith("3.")
    assert spec["info"]["title"] == "Petstore Mini"
    assert "/pets" in spec["paths"]


def test_load_spec_yaml(tmp_path: Path, petstore_spec: dict) -> None:
    import yaml

    yaml_path = tmp_path / "spec.yaml"
    yaml_path.write_text(yaml.safe_dump(petstore_spec), encoding="utf-8")
    spec = load_spec(yaml_path)
    assert spec["openapi"].startswith("3.")


def test_load_spec_rejects_swagger_2(tmp_path: Path) -> None:
    swagger_path = tmp_path / "swagger.json"
    swagger_path.write_text(json.dumps({"swagger": "2.0", "paths": {}}), encoding="utf-8")
    with pytest.raises(UnsupportedSpecError, match="Swagger 2.0"):
        load_spec(swagger_path)


def test_load_spec_rejects_unknown_version(tmp_path: Path) -> None:
    bad = tmp_path / "spec.json"
    bad.write_text(json.dumps({"openapi": "4.0.0", "paths": {}}), encoding="utf-8")
    with pytest.raises(UnsupportedSpecError, match="4.0.0"):
        load_spec(bad)


def test_load_spec_rejects_unknown_suffix(tmp_path: Path) -> None:
    bad = tmp_path / "spec.txt"
    bad.write_text("{}", encoding="utf-8")
    with pytest.raises(UnsupportedSpecError, match="suffix"):
        load_spec(bad)
