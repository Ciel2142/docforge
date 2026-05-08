import json
import subprocess
import sys
from pathlib import Path

import pytest

from docforge.openapi.cli import build_openapi_parser

FIXTURES = Path(__file__).parent / "fixtures"


def test_openapi_subparser_requires_input_and_output() -> None:
    parser = build_openapi_parser()
    with pytest.raises(SystemExit):
        parser.parse_args([])


def test_openapi_subparser_parses_args(tmp_path: Path) -> None:
    parser = build_openapi_parser()
    spec = FIXTURES / "petstore-mini.json"
    args = parser.parse_args([str(spec), "--output", str(tmp_path / "out")])
    assert args.spec == str(spec)
    assert args.output == str(tmp_path / "out")


def test_openapi_e2e_against_petstore(tmp_path: Path) -> None:
    out = tmp_path / "out"
    spec = FIXTURES / "petstore-mini.json"
    result = subprocess.run(
        [sys.executable, "-m", "docforge", "openapi", str(spec), "--output", str(out)],
        capture_output=True,
        text=True,
        check=False,
    )
    assert result.returncode == 0, result.stderr

    endpoints = sorted(p.name for p in (out / "endpoints").iterdir())
    schemas = sorted(p.name for p in (out / "schemas").iterdir())
    assert endpoints == ["GET_pets.md", "GET_pets_id.md", "POST_pets.md"]
    assert schemas == ["Error.md", "NewPet.md", "Owner.md", "Pet.md"]

    pet_md = (out / "schemas" / "Pet.md").read_text(encoding="utf-8")
    assert pet_md.startswith("# Pet\n")
    assert "[Owner](Owner.md)" in pet_md

    post_pets_md = (out / "endpoints" / "POST_pets.md").read_text(encoding="utf-8")
    assert post_pets_md.startswith("# POST /pets\n")
    assert "../schemas/NewPet.md" in post_pets_md
    assert "endpoints=3" in result.stderr
    assert "schemas=4" in result.stderr


def test_top_level_help_lists_subcommands() -> None:
    result = subprocess.run(
        [sys.executable, "-m", "docforge", "--help"],
        capture_output=True,
        text=True,
        check=False,
    )
    assert result.returncode == 0
    assert "convert" in result.stdout
    assert "openapi" in result.stdout


def test_openapi_subcommand_returns_2_on_yaml_parse_error(tmp_path: Path) -> None:
    bad = tmp_path / "spec.yaml"
    bad.write_text("foo: [unterminated\n", encoding="utf-8")
    out = tmp_path / "out"
    result = subprocess.run(
        [sys.executable, "-m", "docforge", "openapi", str(bad), "--output", str(out)],
        capture_output=True,
        text=True,
        check=False,
    )
    assert result.returncode == 2
    assert "failed to parse" in result.stderr
