import json
from pathlib import Path

import pytest

FIXTURES = Path(__file__).parent / "fixtures"


@pytest.fixture
def petstore_path() -> Path:
    return FIXTURES / "petstore-mini.json"


@pytest.fixture
def petstore_spec(petstore_path: Path) -> dict:
    return json.loads(petstore_path.read_text(encoding="utf-8"))


@pytest.fixture
def tmp_out(tmp_path: Path) -> Path:
    out = tmp_path / "out"
    out.mkdir()
    return out
