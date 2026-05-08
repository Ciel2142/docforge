# OpenAPI Adapter Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Add `docforge openapi <spec> --output <dir>` subcommand that parses an OpenAPI 3.x JSON/YAML spec into one Markdown file per endpoint and one Markdown file per component schema, suitable for qmd/RAG ingestion.

**Architecture:** New `docforge.openapi` subpackage with single-responsibility modules (loader → iterator → renderer → writer). The existing top-level `docforge` CLI is refactored into argparse subparsers (`convert` for the existing HTML→MD path, `openapi` for the new path). Endpoint MDs use the same Context7-style header (`# {METHOD} {path}` + `Source: ...` line) as `convert` for retrieval consistency. `$ref` references rewrite to relative MD links between endpoints/ and schemas/ directories — schemas are NOT inlined.

**Tech Stack:** Python 3.10+, stdlib `json`, `pyyaml>=6,<7` (new dep), argparse, pytest. No HTTP client (user pre-downloads spec via curl).

**Beads issue:** `infra-la5` ([docforge] Add OpenAPI/Swagger adapter)

**Validation target:** Diadoc API spec (`https://developer.kontur.ru/api/documentations/diadoc.api/file`, OpenAPI 3.0.1, 123 paths, 483 schemas, Russian markdown descriptions).

---

## File Structure

**Create:**
- `src/docforge/openapi/__init__.py` — public re-exports for the subpackage
- `src/docforge/openapi/loader.py` — `load_spec(path: Path) -> dict`; auto-detects JSON vs YAML; validates `openapi: 3.x`
- `src/docforge/openapi/iter.py` — `iter_endpoints(spec)`, `iter_schemas(spec)` generators
- `src/docforge/openapi/refs.py` — `ref_to_link(ref: str, from_kind: str) -> str` rewrites `#/components/schemas/Foo` → relative MD path
- `src/docforge/openapi/paths.py` — `endpoint_filename(method, path)`, `schema_filename(name)`, slug helpers
- `src/docforge/openapi/render.py` — `render_endpoint(ep, spec)`, `render_schema(name, schema, spec)` → markdown strings
- `src/docforge/openapi/cli.py` — `add_openapi_subparser(subparsers)` + `run_openapi(args)`
- `tests/openapi/__init__.py` — empty
- `tests/openapi/conftest.py` — pytest fixtures: `petstore_spec`, `tmp_out`
- `tests/openapi/fixtures/petstore-mini.json` — 3-endpoint, 4-schema synthetic spec for unit tests
- `tests/openapi/test_loader.py` — JSON+YAML load, version validation, missing-paths fallback
- `tests/openapi/test_iter.py` — endpoint/schema iteration shape + count
- `tests/openapi/test_refs.py` — $ref rewrite to relative paths from endpoint→schema and schema→schema
- `tests/openapi/test_paths.py` — slug rules, path-param brace handling, collision behavior
- `tests/openapi/test_render.py` — endpoint and schema rendering golden assertions
- `tests/openapi/test_cli.py` — argparse + e2e subprocess against petstore-mini

**Modify:**
- `src/docforge/__init__.py` — bump `__version__` from `"0.1.0"` to `"0.2.0"`
- `src/docforge/cli.py` — refactor monolithic `main()` into subparser router (`convert` + `openapi`); existing HTML logic becomes `run_convert(args)`
- `tests/test_cli.py` — update existing CLI tests to use `convert` subcommand
- `pyproject.toml` — bump version to `0.2.0`, add `pyyaml>=6,<7` dependency

**Reference (not gitignored, but heavy — fetch on demand for E2E only):**
- `tests/openapi/fixtures/diadoc.api.json` — full 1.5 MB diadoc spec; fetched in Task 1, used by E2E smoke in Task 10

---

## Task 1: Setup — claim issue, bump version, add dep, fetch fixture

**Files:**
- Modify: `pyproject.toml`
- Modify: `src/docforge/__init__.py`
- Create: `tests/openapi/__init__.py`
- Create: `tests/openapi/fixtures/diadoc.api.json`

- [ ] **Step 1: Claim the beads issue**

```bash
cd /home/igi21/experiements/docforge
bd update infra-la5 --claim
bd update infra-la5 --status=in_progress
```

Expected: `infra-la5` now `in_progress`, owned by `igi21`.

- [ ] **Step 2: Bump version in `src/docforge/__init__.py`**

Read current content first:

```bash
cat src/docforge/__init__.py
```

Replace `__version__ = "0.1.0"` with `__version__ = "0.2.0"`.

- [ ] **Step 3: Bump version + add pyyaml dep in `pyproject.toml`**

Change `version = "0.1.0"` → `version = "0.2.0"`.

In the `dependencies = [...]` list, add `"pyyaml>=6,<7",` after the existing entries:

```toml
dependencies = [
    "html-to-markdown>=3.3,<4",
    "beautifulsoup4>=4.13,<5",
    "lxml>=5.0,<6",
    "pyyaml>=6,<7",
]
```

- [ ] **Step 4: Sync the editable env**

Run from the repo root:

```bash
uv sync --all-extras
```

Expected: `pyyaml` resolved + installed. No errors.

- [ ] **Step 5: Create test scaffolding directories + fetch diadoc fixture**

```bash
mkdir -p tests/openapi/fixtures
touch tests/openapi/__init__.py
curl -sf "https://developer.kontur.ru/api/documentations/diadoc.api/file" \
  -o tests/openapi/fixtures/diadoc.api.json
ls -la tests/openapi/fixtures/diadoc.api.json
```

Expected: ~1.5 MB JSON file. If `curl` fails (network or URL drift), the E2E task in Task 10 will be skipped — proceed with the synthetic petstore fixture.

- [ ] **Step 6: Verify smoke**

```bash
python -c "import yaml; print('pyyaml', yaml.__version__)"
python -c "from docforge import __version__; print('docforge', __version__)"
pytest -q
```

Expected: `pyyaml 6.x`, `docforge 0.2.0`, all existing tests pass.

- [ ] **Step 7: Commit**

```bash
git add pyproject.toml src/docforge/__init__.py tests/openapi/__init__.py tests/openapi/fixtures/diadoc.api.json
git commit -m "chore(openapi): bump to 0.2.0, add pyyaml dep, scaffold fixtures (infra-la5)"
```

---

## Task 2: Build the petstore-mini test fixture

**Files:**
- Create: `tests/openapi/fixtures/petstore-mini.json`

This synthetic fixture drives every unit test. Build it once with realistic shape: 3 endpoints, 4 schemas, $refs between them, a path parameter, multiple response codes.

- [ ] **Step 1: Write `tests/openapi/fixtures/petstore-mini.json`**

```json
{
  "openapi": "3.0.1",
  "info": {
    "title": "Petstore Mini",
    "version": "1.0.0"
  },
  "paths": {
    "/pets": {
      "get": {
        "tags": ["pets"],
        "summary": "List pets",
        "description": "Returns all pets currently in the store.",
        "parameters": [
          {
            "name": "limit",
            "in": "query",
            "schema": {"type": "integer", "format": "int32"},
            "description": "Maximum items to return"
          }
        ],
        "responses": {
          "200": {
            "description": "OK",
            "content": {
              "application/json": {
                "schema": {
                  "type": "array",
                  "items": {"$ref": "#/components/schemas/Pet"}
                }
              }
            }
          }
        }
      },
      "post": {
        "tags": ["pets"],
        "summary": "Create pet",
        "description": "Adds a new pet.",
        "requestBody": {
          "required": true,
          "content": {
            "application/json": {
              "schema": {"$ref": "#/components/schemas/NewPet"}
            }
          }
        },
        "responses": {
          "201": {
            "description": "Created",
            "content": {
              "application/json": {
                "schema": {"$ref": "#/components/schemas/Pet"}
              }
            }
          },
          "400": {
            "description": "Bad request",
            "content": {
              "application/json": {
                "schema": {"$ref": "#/components/schemas/Error"}
              }
            }
          }
        }
      }
    },
    "/pets/{id}": {
      "get": {
        "tags": ["pets"],
        "summary": "Get pet by id",
        "parameters": [
          {
            "name": "id",
            "in": "path",
            "required": true,
            "schema": {"type": "string"}
          }
        ],
        "responses": {
          "200": {
            "description": "OK",
            "content": {
              "application/json": {
                "schema": {"$ref": "#/components/schemas/Pet"}
              }
            }
          }
        }
      }
    }
  },
  "components": {
    "schemas": {
      "Pet": {
        "type": "object",
        "required": ["id", "name"],
        "properties": {
          "id": {"type": "string", "format": "uuid", "description": "Unique id"},
          "name": {"type": "string", "description": "Display name"},
          "owner": {"$ref": "#/components/schemas/Owner"}
        }
      },
      "NewPet": {
        "type": "object",
        "required": ["name"],
        "properties": {
          "name": {"type": "string", "description": "Display name"}
        }
      },
      "Owner": {
        "type": "object",
        "properties": {
          "email": {"type": "string", "format": "email"}
        }
      },
      "Error": {
        "type": "object",
        "properties": {
          "message": {"type": "string"}
        }
      }
    }
  }
}
```

- [ ] **Step 2: Validate fixture is valid JSON**

```bash
python -m json.tool tests/openapi/fixtures/petstore-mini.json > /dev/null
```

Expected: no output, exit 0.

- [ ] **Step 3: Commit**

```bash
git add tests/openapi/fixtures/petstore-mini.json
git commit -m "test(openapi): add petstore-mini fixture for unit tests"
```

---

## Task 3: Loader

**Files:**
- Create: `src/docforge/openapi/__init__.py`
- Create: `src/docforge/openapi/loader.py`
- Create: `tests/openapi/test_loader.py`
- Create: `tests/openapi/conftest.py`

The loader reads a JSON or YAML spec from disk, returns a dict, and rejects non-3.x versions early.

- [ ] **Step 1: Write `tests/openapi/conftest.py`**

```python
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
```

- [ ] **Step 2: Write the failing tests in `tests/openapi/test_loader.py`**

```python
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
```

- [ ] **Step 3: Run to verify they fail**

```bash
pytest tests/openapi/test_loader.py -v
```

Expected: all 5 tests fail with `ModuleNotFoundError: No module named 'docforge.openapi'`.

- [ ] **Step 4: Create `src/docforge/openapi/__init__.py`**

```python
"""OpenAPI 3.x → Markdown adapter for docforge."""

from .loader import UnsupportedSpecError, load_spec

__all__ = ["UnsupportedSpecError", "load_spec"]
```

- [ ] **Step 5: Implement `src/docforge/openapi/loader.py`**

```python
import json
from pathlib import Path
from typing import Any

import yaml


class UnsupportedSpecError(ValueError):
    """Raised when the spec file is not a supported OpenAPI 3.x document."""


def load_spec(path: Path) -> dict[str, Any]:
    suffix = path.suffix.lower()
    raw = path.read_text(encoding="utf-8")

    if suffix == ".json":
        spec = json.loads(raw)
    elif suffix in (".yaml", ".yml"):
        spec = yaml.safe_load(raw)
    else:
        raise UnsupportedSpecError(
            f"unknown spec suffix {suffix!r} (expected .json/.yaml/.yml)"
        )

    if not isinstance(spec, dict):
        raise UnsupportedSpecError("spec root must be an object")

    if "swagger" in spec:
        raise UnsupportedSpecError(
            f"Swagger 2.0 not supported (found swagger={spec['swagger']!r}); "
            "convert to OpenAPI 3.x first"
        )

    version = spec.get("openapi", "")
    if not isinstance(version, str) or not version.startswith("3."):
        raise UnsupportedSpecError(
            f"unsupported openapi version: {version!r} (expected 3.x)"
        )

    return spec
```

- [ ] **Step 6: Run tests to verify they pass**

```bash
pytest tests/openapi/test_loader.py -v
```

Expected: all 5 tests pass.

- [ ] **Step 7: Commit**

```bash
git add src/docforge/openapi/__init__.py src/docforge/openapi/loader.py \
        tests/openapi/conftest.py tests/openapi/test_loader.py
git commit -m "feat(openapi): add spec loader for JSON+YAML 3.x (infra-la5)"
```

---

## Task 4: Iterators (endpoints + schemas)

**Files:**
- Create: `src/docforge/openapi/iter.py`
- Create: `tests/openapi/test_iter.py`

`iter_endpoints` walks `spec["paths"]` × HTTP methods. `iter_schemas` walks `spec["components"]["schemas"]`. Both are generators yielding flat records.

- [ ] **Step 1: Write the failing tests in `tests/openapi/test_iter.py`**

```python
from docforge.openapi.iter import Endpoint, Schema, iter_endpoints, iter_schemas


def test_iter_endpoints_yields_each_method_per_path(petstore_spec: dict) -> None:
    eps = list(iter_endpoints(petstore_spec))
    keys = {(e.method, e.path) for e in eps}
    assert keys == {("get", "/pets"), ("post", "/pets"), ("get", "/pets/{id}")}


def test_iter_endpoints_record_shape(petstore_spec: dict) -> None:
    eps = {(e.method, e.path): e for e in iter_endpoints(petstore_spec)}
    get_pets = eps[("get", "/pets")]
    assert isinstance(get_pets, Endpoint)
    assert get_pets.summary == "List pets"
    assert get_pets.tags == ["pets"]
    assert get_pets.operation["responses"]["200"]["description"] == "OK"


def test_iter_endpoints_skips_non_method_keys(petstore_spec: dict) -> None:
    petstore_spec["paths"]["/pets"]["parameters"] = [
        {"name": "x-trace", "in": "header", "schema": {"type": "string"}}
    ]
    methods = {e.method for e in iter_endpoints(petstore_spec) if e.path == "/pets"}
    assert methods == {"get", "post"}


def test_iter_schemas_yields_each_component(petstore_spec: dict) -> None:
    names = {s.name for s in iter_schemas(petstore_spec)}
    assert names == {"Pet", "NewPet", "Owner", "Error"}


def test_iter_schemas_record_shape(petstore_spec: dict) -> None:
    schemas = {s.name: s for s in iter_schemas(petstore_spec)}
    pet = schemas["Pet"]
    assert isinstance(pet, Schema)
    assert pet.body["type"] == "object"
    assert "id" in pet.body["properties"]


def test_iter_schemas_empty_when_no_components() -> None:
    spec = {"openapi": "3.0.0", "paths": {}}
    assert list(iter_schemas(spec)) == []
```

- [ ] **Step 2: Run to verify they fail**

```bash
pytest tests/openapi/test_iter.py -v
```

Expected: 6 tests fail with `ModuleNotFoundError: No module named 'docforge.openapi.iter'`.

- [ ] **Step 3: Implement `src/docforge/openapi/iter.py`**

```python
from collections.abc import Iterator
from dataclasses import dataclass, field
from typing import Any

HTTP_METHODS = {"get", "post", "put", "delete", "patch", "head", "options", "trace"}


@dataclass(frozen=True)
class Endpoint:
    method: str
    path: str
    operation: dict[str, Any]
    tags: list[str] = field(default_factory=list)
    summary: str = ""
    description: str = ""


@dataclass(frozen=True)
class Schema:
    name: str
    body: dict[str, Any]


def iter_endpoints(spec: dict[str, Any]) -> Iterator[Endpoint]:
    paths = spec.get("paths") or {}
    for path, item in paths.items():
        if not isinstance(item, dict):
            continue
        for method, op in item.items():
            if method.lower() not in HTTP_METHODS:
                continue
            if not isinstance(op, dict):
                continue
            yield Endpoint(
                method=method.lower(),
                path=path,
                operation=op,
                tags=list(op.get("tags") or []),
                summary=str(op.get("summary") or ""),
                description=str(op.get("description") or ""),
            )


def iter_schemas(spec: dict[str, Any]) -> Iterator[Schema]:
    schemas = (spec.get("components") or {}).get("schemas") or {}
    for name, body in schemas.items():
        if not isinstance(body, dict):
            continue
        yield Schema(name=name, body=body)
```

- [ ] **Step 4: Run tests to verify they pass**

```bash
pytest tests/openapi/test_iter.py -v
```

Expected: all 6 tests pass.

- [ ] **Step 5: Commit**

```bash
git add src/docforge/openapi/iter.py tests/openapi/test_iter.py
git commit -m "feat(openapi): add endpoint + schema iterators (infra-la5)"
```

---

## Task 5: Path/slug helpers

**Files:**
- Create: `src/docforge/openapi/paths.py`
- Create: `tests/openapi/test_paths.py`

Slug rules:
- Endpoint filename: `{METHOD_UPPER}_{slug}.md` where slug = path with `/` and `{`/`}` collapsed to `_`, leading/trailing `_` stripped
- Schema filename: `{name}.md` (schemas live in their own dir, no method prefix)
- Detect collisions; raise on duplicates

- [ ] **Step 1: Write the failing tests in `tests/openapi/test_paths.py`**

```python
import pytest

from docforge.openapi.paths import (
    SlugCollisionError,
    detect_endpoint_collisions,
    endpoint_filename,
    schema_filename,
    slug_path,
)


def test_slug_path_simple() -> None:
    assert slug_path("/pets") == "pets"


def test_slug_path_nested() -> None:
    assert slug_path("/V3/Authenticate") == "V3_Authenticate"


def test_slug_path_with_brace_param() -> None:
    assert slug_path("/pets/{id}") == "pets_id"


def test_slug_path_collapses_repeated_underscores() -> None:
    assert slug_path("/a//b/{x}/{y}") == "a_b_x_y"


def test_slug_path_root() -> None:
    assert slug_path("/") == "root"


def test_endpoint_filename() -> None:
    assert endpoint_filename("get", "/pets") == "GET_pets.md"
    assert endpoint_filename("POST", "/V3/Authenticate") == "POST_V3_Authenticate.md"
    assert endpoint_filename("get", "/pets/{id}") == "GET_pets_id.md"


def test_schema_filename_passthrough() -> None:
    assert schema_filename("Pet") == "Pet.md"
    assert schema_filename("Foo.Bar") == "Foo.Bar.md"


def test_detect_endpoint_collisions_clean() -> None:
    pairs = [("get", "/pets"), ("post", "/pets"), ("get", "/pets/{id}")]
    detect_endpoint_collisions(pairs)


def test_detect_endpoint_collisions_raises() -> None:
    pairs = [("get", "/pets/{id}"), ("get", "/pets/id")]
    with pytest.raises(SlugCollisionError, match="GET_pets_id.md"):
        detect_endpoint_collisions(pairs)
```

- [ ] **Step 2: Run to verify they fail**

```bash
pytest tests/openapi/test_paths.py -v
```

Expected: 9 tests fail with `ModuleNotFoundError`.

- [ ] **Step 3: Implement `src/docforge/openapi/paths.py`**

```python
import re
from collections import defaultdict


class SlugCollisionError(ValueError):
    """Two distinct (method, path) pairs map to the same output filename."""


_NON_SLUG_CHARS = re.compile(r"[/{}]+")
_MULTI_UNDERSCORE = re.compile(r"_+")


def slug_path(path: str) -> str:
    s = _NON_SLUG_CHARS.sub("_", path)
    s = _MULTI_UNDERSCORE.sub("_", s).strip("_")
    return s or "root"


def endpoint_filename(method: str, path: str) -> str:
    return f"{method.upper()}_{slug_path(path)}.md"


def schema_filename(name: str) -> str:
    return f"{name}.md"


def detect_endpoint_collisions(pairs: list[tuple[str, str]]) -> None:
    inverse: dict[str, list[tuple[str, str]]] = defaultdict(list)
    for method, path in pairs:
        inverse[endpoint_filename(method, path)].append((method, path))
    dupes = {k: v for k, v in inverse.items() if len(v) > 1}
    if dupes:
        lines = ["endpoint filename collisions:"]
        for fname, sources in dupes.items():
            lines.append(f"  -> {fname}")
            for m, p in sources:
                lines.append(f"      from {m.upper()} {p}")
        raise SlugCollisionError("\n".join(lines))
```

- [ ] **Step 4: Run tests to verify they pass**

```bash
pytest tests/openapi/test_paths.py -v
```

Expected: all 9 tests pass.

- [ ] **Step 5: Commit**

```bash
git add src/docforge/openapi/paths.py tests/openapi/test_paths.py
git commit -m "feat(openapi): add slug/filename helpers + collision detection (infra-la5)"
```

---

## Task 6: $ref resolver

**Files:**
- Create: `src/docforge/openapi/refs.py`
- Create: `tests/openapi/test_refs.py`

Rewrites `$ref` JSON pointers to relative MD links. The output dir layout is:

```
output/
  endpoints/<file>.md
  schemas/<file>.md
```

So from an endpoint MD, `#/components/schemas/Pet` → `../schemas/Pet.md`.
From a schema MD (sibling), `#/components/schemas/Pet` → `Pet.md`.
For unknown ref shapes (e.g., `#/components/responses/...`), pass through unchanged with `#` rendered as the link text.

- [ ] **Step 1: Write the failing tests in `tests/openapi/test_refs.py`**

```python
import pytest

from docforge.openapi.refs import (
    ref_link,
    ref_to_schema_name,
)


def test_ref_to_schema_name_simple() -> None:
    assert ref_to_schema_name("#/components/schemas/Pet") == "Pet"


def test_ref_to_schema_name_nested_name() -> None:
    assert ref_to_schema_name("#/components/schemas/Foo.Bar") == "Foo.Bar"


def test_ref_to_schema_name_returns_none_for_non_schema_ref() -> None:
    assert ref_to_schema_name("#/components/responses/Default") is None
    assert ref_to_schema_name("#/paths/~1pets/get") is None
    assert ref_to_schema_name("not-a-ref") is None


def test_ref_link_from_endpoint() -> None:
    assert ref_link("#/components/schemas/Pet", from_kind="endpoint") == (
        "Pet",
        "../schemas/Pet.md",
    )


def test_ref_link_from_schema() -> None:
    assert ref_link("#/components/schemas/Pet", from_kind="schema") == (
        "Pet",
        "Pet.md",
    )


def test_ref_link_unknown_ref_returns_raw() -> None:
    label, href = ref_link("#/components/responses/Default", from_kind="endpoint")
    assert label == "#/components/responses/Default"
    assert href == "#/components/responses/Default"


def test_ref_link_invalid_from_kind() -> None:
    with pytest.raises(ValueError, match="from_kind"):
        ref_link("#/components/schemas/Pet", from_kind="bogus")
```

- [ ] **Step 2: Run to verify they fail**

```bash
pytest tests/openapi/test_refs.py -v
```

Expected: 7 tests fail with `ModuleNotFoundError`.

- [ ] **Step 3: Implement `src/docforge/openapi/refs.py`**

```python
_SCHEMA_PREFIX = "#/components/schemas/"
_FROM_KINDS = {"endpoint", "schema"}


def ref_to_schema_name(ref: str) -> str | None:
    if not isinstance(ref, str) or not ref.startswith(_SCHEMA_PREFIX):
        return None
    name = ref[len(_SCHEMA_PREFIX):]
    return name or None


def ref_link(ref: str, *, from_kind: str) -> tuple[str, str]:
    if from_kind not in _FROM_KINDS:
        raise ValueError(f"from_kind must be one of {_FROM_KINDS}, got {from_kind!r}")
    name = ref_to_schema_name(ref)
    if name is None:
        return ref, ref
    if from_kind == "endpoint":
        return name, f"../schemas/{name}.md"
    return name, f"{name}.md"
```

- [ ] **Step 4: Run tests to verify they pass**

```bash
pytest tests/openapi/test_refs.py -v
```

Expected: all 7 tests pass.

- [ ] **Step 5: Commit**

```bash
git add src/docforge/openapi/refs.py tests/openapi/test_refs.py
git commit -m "feat(openapi): add \$ref resolver (infra-la5)"
```

---

## Task 7: Endpoint renderer

**Files:**
- Create: `src/docforge/openapi/render.py` (endpoint half)
- Create: `tests/openapi/test_render.py` (endpoint section)

Each endpoint MD looks like:

```markdown
# POST /pets

Source: petstore-mini.json#/paths/~1pets/post

**Tags:** pets

Adds a new pet.

## Parameters

| Name | In | Type | Required | Description |
|------|----|----|----------|-------------|
| ... |

## Request Body

`application/json`: [NewPet](../schemas/NewPet.md) (required)

## Responses

### 201 Created

`application/json`: [Pet](../schemas/Pet.md)

### 400 Bad request

`application/json`: [Error](../schemas/Error.md)
```

JSON pointer-encoding: per RFC 6901, `/` becomes `~1` and `~` becomes `~0`. Used for the `Source:` line.

- [ ] **Step 1: Write the failing tests in `tests/openapi/test_render.py`**

```python
from docforge.openapi.iter import iter_endpoints
from docforge.openapi.render import jsonpointer_encode, render_endpoint


def test_jsonpointer_encode() -> None:
    assert jsonpointer_encode("/pets") == "~1pets"
    assert jsonpointer_encode("/pets/{id}") == "~1pets~1{id}"
    assert jsonpointer_encode("a~b/c") == "a~0b~1c"


def test_render_endpoint_header(petstore_spec: dict) -> None:
    eps = {(e.method, e.path): e for e in iter_endpoints(petstore_spec)}
    md = render_endpoint(eps[("post", "/pets")], spec_filename="petstore-mini.json")
    lines = md.splitlines()
    assert lines[0] == "# POST /pets"
    assert lines[2] == "Source: petstore-mini.json#/paths/~1pets/post"


def test_render_endpoint_tags_and_description(petstore_spec: dict) -> None:
    eps = {(e.method, e.path): e for e in iter_endpoints(petstore_spec)}
    md = render_endpoint(eps[("post", "/pets")], spec_filename="petstore-mini.json")
    assert "**Tags:** pets" in md
    assert "Adds a new pet." in md


def test_render_endpoint_parameters_table(petstore_spec: dict) -> None:
    eps = {(e.method, e.path): e for e in iter_endpoints(petstore_spec)}
    md = render_endpoint(eps[("get", "/pets")], spec_filename="petstore-mini.json")
    assert "## Parameters" in md
    assert "| limit | query | integer (int32) | no | Maximum items to return |" in md


def test_render_endpoint_path_parameter_required(petstore_spec: dict) -> None:
    eps = {(e.method, e.path): e for e in iter_endpoints(petstore_spec)}
    md = render_endpoint(eps[("get", "/pets/{id}")], spec_filename="petstore-mini.json")
    assert "| id | path | string | yes |" in md


def test_render_endpoint_request_body_with_ref(petstore_spec: dict) -> None:
    eps = {(e.method, e.path): e for e in iter_endpoints(petstore_spec)}
    md = render_endpoint(eps[("post", "/pets")], spec_filename="petstore-mini.json")
    assert "## Request Body" in md
    assert "`application/json`: [NewPet](../schemas/NewPet.md) (required)" in md


def test_render_endpoint_responses_with_refs(petstore_spec: dict) -> None:
    eps = {(e.method, e.path): e for e in iter_endpoints(petstore_spec)}
    md = render_endpoint(eps[("post", "/pets")], spec_filename="petstore-mini.json")
    assert "### 201 Created" in md
    assert "`application/json`: [Pet](../schemas/Pet.md)" in md
    assert "### 400 Bad request" in md
    assert "`application/json`: [Error](../schemas/Error.md)" in md


def test_render_endpoint_array_of_ref_in_response(petstore_spec: dict) -> None:
    eps = {(e.method, e.path): e for e in iter_endpoints(petstore_spec)}
    md = render_endpoint(eps[("get", "/pets")], spec_filename="petstore-mini.json")
    assert "`application/json`: array of [Pet](../schemas/Pet.md)" in md


def test_render_endpoint_omits_empty_sections() -> None:
    from docforge.openapi.iter import Endpoint

    ep = Endpoint(method="get", path="/ping", operation={"responses": {"200": {"description": "OK"}}})
    md = render_endpoint(ep, spec_filename="x.json")
    assert "## Parameters" not in md
    assert "## Request Body" not in md
    assert "### 200 OK" in md
```

- [ ] **Step 2: Run to verify they fail**

```bash
pytest tests/openapi/test_render.py -v
```

Expected: all 9 tests fail with `ModuleNotFoundError: No module named 'docforge.openapi.render'`.

- [ ] **Step 3: Implement endpoint half of `src/docforge/openapi/render.py`**

```python
from typing import Any

from .iter import Endpoint, Schema
from .refs import ref_link


def jsonpointer_encode(s: str) -> str:
    return s.replace("~", "~0").replace("/", "~1")


def _type_str(schema: dict[str, Any]) -> str:
    t = schema.get("type")
    fmt = schema.get("format")
    if t and fmt:
        return f"{t} ({fmt})"
    return t or "any"


def _schema_summary(schema: dict[str, Any], *, from_kind: str) -> str:
    """Render a one-line summary of a schema (for request/response content lines)."""
    if "$ref" in schema:
        label, href = ref_link(schema["$ref"], from_kind=from_kind)
        return f"[{label}]({href})"
    if schema.get("type") == "array":
        items = schema.get("items") or {}
        return f"array of {_schema_summary(items, from_kind=from_kind)}"
    return f"`{_type_str(schema)}`"


def _render_parameters(params: list[dict[str, Any]]) -> list[str]:
    if not params:
        return []
    lines = [
        "## Parameters",
        "",
        "| Name | In | Type | Required | Description |",
        "|------|----|----|----------|-------------|",
    ]
    for p in params:
        name = p.get("name", "")
        loc = p.get("in", "")
        schema = p.get("schema") or {}
        type_s = _type_str(schema)
        required = "yes" if p.get("required") else "no"
        desc = (p.get("description") or "").replace("|", "\\|").replace("\n", " ")
        lines.append(f"| {name} | {loc} | {type_s} | {required} | {desc} |")
    lines.append("")
    return lines


def _render_request_body(body: dict[str, Any] | None) -> list[str]:
    if not body:
        return []
    lines = ["## Request Body", ""]
    required_marker = " (required)" if body.get("required") else ""
    desc = body.get("description")
    if desc:
        lines.append(desc.strip())
        lines.append("")
    for ctype, media in (body.get("content") or {}).items():
        schema = media.get("schema") or {}
        summary = _schema_summary(schema, from_kind="endpoint")
        lines.append(f"`{ctype}`: {summary}{required_marker}")
    lines.append("")
    return lines


def _render_responses(responses: dict[str, Any]) -> list[str]:
    if not responses:
        return []
    lines = ["## Responses", ""]
    for code, resp in responses.items():
        if not isinstance(resp, dict):
            continue
        desc = (resp.get("description") or "").strip()
        lines.append(f"### {code} {desc}".rstrip())
        lines.append("")
        for ctype, media in (resp.get("content") or {}).items():
            schema = media.get("schema") or {}
            summary = _schema_summary(schema, from_kind="endpoint")
            lines.append(f"`{ctype}`: {summary}")
        lines.append("")
    return lines


def render_endpoint(ep: Endpoint, *, spec_filename: str) -> str:
    pointer = f"#/paths/{jsonpointer_encode(ep.path)}/{ep.method}"
    out: list[str] = [
        f"# {ep.method.upper()} {ep.path}",
        "",
        f"Source: {spec_filename}{pointer}",
        "",
    ]
    if ep.tags:
        out.append(f"**Tags:** {', '.join(ep.tags)}")
        out.append("")
    if ep.description:
        out.append(ep.description.strip())
        out.append("")
    elif ep.summary:
        out.append(ep.summary.strip())
        out.append("")

    out.extend(_render_parameters(list(ep.operation.get("parameters") or [])))
    out.extend(_render_request_body(ep.operation.get("requestBody")))
    out.extend(_render_responses(ep.operation.get("responses") or {}))

    while out and out[-1] == "":
        out.pop()
    return "\n".join(out) + "\n"
```

- [ ] **Step 4: Run tests to verify they pass**

```bash
pytest tests/openapi/test_render.py -v
```

Expected: 9 tests pass (the schema renderer tests in Task 8 will not exist yet).

- [ ] **Step 5: Commit**

```bash
git add src/docforge/openapi/render.py tests/openapi/test_render.py
git commit -m "feat(openapi): add endpoint renderer with refs/params/responses (infra-la5)"
```

---

## Task 8: Schema renderer

**Files:**
- Modify: `src/docforge/openapi/render.py` (add `render_schema`)
- Modify: `tests/openapi/test_render.py` (append schema tests)

Each schema MD looks like:

```markdown
# Pet

Source: petstore-mini.json#/components/schemas/Pet

## Properties

| Name | Type | Required | Description |
|------|------|----------|-------------|
| id | string (uuid) | yes | Unique id |
| name | string | yes | Display name |
| owner | [Owner](Owner.md) | no |  |
```

For non-object schemas (enums, primitives, allOf), render type info + the raw JSON in a fenced block under `## Definition` so nothing is lost.

- [ ] **Step 1: Append failing tests to `tests/openapi/test_render.py`**

```python


def test_render_schema_header(petstore_spec: dict) -> None:
    from docforge.openapi.iter import iter_schemas
    from docforge.openapi.render import render_schema

    schemas = {s.name: s for s in iter_schemas(petstore_spec)}
    md = render_schema(schemas["Pet"], spec_filename="petstore-mini.json")
    lines = md.splitlines()
    assert lines[0] == "# Pet"
    assert lines[2] == "Source: petstore-mini.json#/components/schemas/Pet"


def test_render_schema_properties_table(petstore_spec: dict) -> None:
    from docforge.openapi.iter import iter_schemas
    from docforge.openapi.render import render_schema

    schemas = {s.name: s for s in iter_schemas(petstore_spec)}
    md = render_schema(schemas["Pet"], spec_filename="petstore-mini.json")
    assert "## Properties" in md
    assert "| id | string (uuid) | yes | Unique id |" in md
    assert "| name | string | yes | Display name |" in md


def test_render_schema_property_with_ref(petstore_spec: dict) -> None:
    from docforge.openapi.iter import iter_schemas
    from docforge.openapi.render import render_schema

    schemas = {s.name: s for s in iter_schemas(petstore_spec)}
    md = render_schema(schemas["Pet"], spec_filename="petstore-mini.json")
    assert "| owner | [Owner](Owner.md) | no |" in md


def test_render_schema_non_object_falls_back_to_definition_block() -> None:
    from docforge.openapi.iter import Schema
    from docforge.openapi.render import render_schema

    s = Schema(name="Color", body={"type": "string", "enum": ["red", "green", "blue"]})
    md = render_schema(s, spec_filename="x.json")
    assert "# Color" in md
    assert "## Definition" in md
    assert "```json" in md
    assert "\"enum\"" in md
```

- [ ] **Step 2: Run to verify they fail**

```bash
pytest tests/openapi/test_render.py::test_render_schema_header -v
```

Expected: ImportError — `cannot import name 'render_schema' from 'docforge.openapi.render'`.

- [ ] **Step 3: Append `render_schema` to `src/docforge/openapi/render.py`**

Add at the bottom of the file:

```python
import json as _json


def _property_type(schema: dict[str, Any]) -> str:
    if "$ref" in schema:
        label, href = ref_link(schema["$ref"], from_kind="schema")
        return f"[{label}]({href})"
    if schema.get("type") == "array":
        items = schema.get("items") or {}
        return f"array of {_property_type(items)}"
    return _type_str(schema)


def render_schema(schema: Schema, *, spec_filename: str) -> str:
    body = schema.body
    out: list[str] = [
        f"# {schema.name}",
        "",
        f"Source: {spec_filename}#/components/schemas/{schema.name}",
        "",
    ]
    desc = (body.get("description") or "").strip()
    if desc:
        out.append(desc)
        out.append("")

    properties = body.get("properties") if body.get("type") == "object" else None
    if properties:
        required = set(body.get("required") or [])
        out.extend([
            "## Properties",
            "",
            "| Name | Type | Required | Description |",
            "|------|------|----------|-------------|",
        ])
        for prop_name, prop in properties.items():
            type_s = _property_type(prop or {})
            req = "yes" if prop_name in required else "no"
            pdesc = ((prop or {}).get("description") or "").replace("|", "\\|").replace("\n", " ")
            out.append(f"| {prop_name} | {type_s} | {req} | {pdesc} |")
        out.append("")
    else:
        out.append("## Definition")
        out.append("")
        out.append("```json")
        out.append(_json.dumps(body, indent=2, ensure_ascii=False))
        out.append("```")
        out.append("")

    while out and out[-1] == "":
        out.pop()
    return "\n".join(out) + "\n"
```

- [ ] **Step 4: Run tests to verify they pass**

```bash
pytest tests/openapi/test_render.py -v
```

Expected: all schema tests pass; existing endpoint tests still pass.

- [ ] **Step 5: Commit**

```bash
git add src/docforge/openapi/render.py tests/openapi/test_render.py
git commit -m "feat(openapi): add schema renderer with properties table + JSON fallback (infra-la5)"
```

---

## Task 9: CLI subcommand router

**Files:**
- Modify: `src/docforge/cli.py` (refactor to subparsers)
- Create: `src/docforge/openapi/cli.py`
- Modify: `tests/test_cli.py` (update existing CLI tests to use `convert`)
- Create: `tests/openapi/test_cli.py`

Refactor `cli.py` so `main(argv)` builds a parent parser with two subcommands and delegates. The existing HTML logic moves into `run_convert(args)` (functionally identical, only the argparse plumbing changes).

- [ ] **Step 1: Read current `tests/test_cli.py` to know which assertions must be updated**

```bash
cat tests/test_cli.py
```

Note every place `argv` looks like `[source, "--output", out]` — those become `["convert", source, "--output", out]`.

- [ ] **Step 2: Write the failing test in `tests/openapi/test_cli.py`**

```python
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
```

- [ ] **Step 3: Run to verify failures**

```bash
pytest tests/openapi/test_cli.py -v
```

Expected: import errors / argparse failures / subcommand-not-found errors.

- [ ] **Step 4: Implement `src/docforge/openapi/cli.py`**

```python
import argparse
import json
import logging
from pathlib import Path

from .iter import iter_endpoints, iter_schemas
from .loader import UnsupportedSpecError, load_spec
from .paths import (
    SlugCollisionError,
    detect_endpoint_collisions,
    endpoint_filename,
    schema_filename,
)
from .render import render_endpoint, render_schema

log = logging.getLogger("docforge.openapi")


def build_openapi_parser() -> argparse.ArgumentParser:
    parser = argparse.ArgumentParser(
        prog="docforge openapi",
        description="Convert an OpenAPI 3.x spec into per-endpoint + per-schema Markdown.",
    )
    parser.add_argument("spec", help="path to OpenAPI 3.x JSON or YAML spec file")
    parser.add_argument("--output", required=True, help="output directory")
    return parser


def add_openapi_subparser(subparsers: argparse._SubParsersAction) -> None:
    sp = subparsers.add_parser(
        "openapi",
        help="Convert an OpenAPI 3.x spec to Markdown",
        description="Convert an OpenAPI 3.x spec into per-endpoint + per-schema Markdown.",
    )
    sp.add_argument("spec", help="path to OpenAPI 3.x JSON or YAML spec file")
    sp.add_argument("--output", required=True, help="output directory")
    sp.set_defaults(func=run_openapi)


def run_openapi(args: argparse.Namespace) -> int:
    spec_path = Path(args.spec).expanduser()
    output = Path(args.output).expanduser()

    if not spec_path.is_file():
        log.error("spec not found: %s", spec_path)
        return 2

    try:
        spec = load_spec(spec_path)
    except UnsupportedSpecError as e:
        log.error("%s", e)
        return 2
    except (json.JSONDecodeError, ValueError) as e:
        log.error("failed to parse %s: %s", spec_path, e)
        return 2

    endpoints_dir = output / "endpoints"
    schemas_dir = output / "schemas"
    endpoints_dir.mkdir(parents=True, exist_ok=True)
    schemas_dir.mkdir(parents=True, exist_ok=True)

    endpoints = list(iter_endpoints(spec))
    schemas = list(iter_schemas(spec))

    try:
        detect_endpoint_collisions([(e.method, e.path) for e in endpoints])
    except SlugCollisionError as e:
        log.error("%s", e)
        return 2

    spec_filename = spec_path.name

    for ep in endpoints:
        out_path = endpoints_dir / endpoint_filename(ep.method, ep.path)
        out_path.write_text(render_endpoint(ep, spec_filename=spec_filename), encoding="utf-8")

    for sc in schemas:
        out_path = schemas_dir / schema_filename(sc.name)
        out_path.write_text(render_schema(sc, spec_filename=spec_filename), encoding="utf-8")

    log.info("endpoints=%d  schemas=%d", len(endpoints), len(schemas))
    return 0
```

- [ ] **Step 5: Refactor `src/docforge/cli.py` to subparser router**

Replace the entire file with:

```python
import argparse
import logging
import sys
from pathlib import Path

from . import __version__
from .convert import ConvertStatus, convert_html
from .links import rewrite_internal_links
from .openapi.cli import add_openapi_subparser
from .output import build_output, detect_collisions, write_output
from .title import extract_title
from .walk import iter_html_files

log = logging.getLogger("docforge")


def build_parser() -> argparse.ArgumentParser:
    parser = argparse.ArgumentParser(
        prog="docforge",
        description="Convert documentation sources to Markdown for RAG ingestion.",
        formatter_class=argparse.RawDescriptionHelpFormatter,
    )
    parser.add_argument("--version", action="version", version=f"docforge {__version__}")
    verbosity = parser.add_mutually_exclusive_group()
    verbosity.add_argument("-v", "--verbose", action="store_true", help="DEBUG-level logging")
    verbosity.add_argument("-q", "--quiet", action="store_true", help="WARNING-level logging")

    subparsers = parser.add_subparsers(dest="command", required=True)
    _add_convert_subparser(subparsers)
    add_openapi_subparser(subparsers)
    return parser


def _add_convert_subparser(subparsers: argparse._SubParsersAction) -> None:
    sp = subparsers.add_parser(
        "convert",
        help="Convert HTML to Markdown",
        description="Convert documentation HTML to Markdown for RAG ingestion.",
        formatter_class=argparse.RawDescriptionHelpFormatter,
        epilog=(
            "examples:\n"
            "  docforge convert ~/docs/diadok --output ~/docs/diadok-md\n"
            "  docforge convert page.html --output ./out\n"
        ),
    )
    sp.add_argument("source", help="path to HTML file or directory")
    sp.add_argument("--output", required=True, help="output directory (mirrors source structure)")
    sp.add_argument(
        "--fail-threshold",
        type=float,
        default=0.10,
        help="max acceptable failure ratio before exit 1 (default 0.10; set 1.0 to disable)",
    )
    sp.add_argument(
        "--max-bytes",
        type=int,
        default=52_428_800,
        help="skip HTML files larger than N bytes (default 50MB)",
    )
    sp.add_argument("--dry-run", action="store_true", help="walk + report planned outputs, write nothing")
    sp.set_defaults(func=run_convert)


def run_convert(args: argparse.Namespace) -> int:
    source = Path(args.source).expanduser()
    output = Path(args.output).expanduser()

    if not source.exists():
        log.error("source not found: %s", source)
        return 2
    if not source.is_file() and not source.is_dir():
        log.error("source is neither file nor directory: %s", source)
        return 2

    try:
        output.mkdir(parents=True, exist_ok=True)
    except OSError as e:
        log.error("cannot create output dir %s: %s", output, e)
        return 2

    paths = list(iter_html_files(source, max_bytes=args.max_bytes))
    if not paths:
        log.warning("no HTML files found under %s", source)
        log.info("converted=0  empty=0  skipped=0  failed=0  total=0")
        return 0

    source_root = source.parent if source.is_file() else source

    try:
        mapping = detect_collisions(paths, source_root, output)
    except ValueError as e:
        log.error("%s", e)
        return 2

    converted = empty = failed = 0
    for in_path in paths:
        rel = in_path.relative_to(source_root)
        out_path = mapping[in_path]
        if args.dry_run:
            log.info("DRY %s -> %s", rel.as_posix(), out_path)
            continue

        try:
            raw = in_path.read_text(encoding="utf-8", errors="replace")
        except OSError as e:
            log.error("FAIL read %s: %s", rel.as_posix(), e)
            failed += 1
            continue

        result = convert_html(raw)
        if result.status == ConvertStatus.EMPTY:
            empty += 1
            log.debug("empty %s", rel.as_posix())
            continue
        if result.status == ConvertStatus.FAILED:
            failed += 1
            log.error("FAIL %s: %s", rel.as_posix(), result.error)
            continue

        title = extract_title(result.h1_text, result.soup_title_text, in_path.stem)
        body_md = rewrite_internal_links(result.body_md or "")
        content = build_output(title, rel.as_posix(), body_md)
        write_output(out_path, content)
        converted += 1

    skipped = 0
    total = converted + empty + failed
    log.info(
        "converted=%d  empty=%d  skipped=%d  failed=%d  total=%d",
        converted, empty, skipped, failed, total,
    )

    if total > 0 and (failed / total) > args.fail_threshold:
        log.error(
            "failure ratio %.3f exceeds threshold %.3f",
            failed / total, args.fail_threshold,
        )
        return 1

    return 0


def main(argv: list[str] | None = None) -> int:
    parser = build_parser()
    args = parser.parse_args(argv)
    _configure_logging(args.verbose, args.quiet)
    return args.func(args)


def _configure_logging(verbose: bool, quiet: bool) -> None:
    if verbose:
        level = logging.DEBUG
    elif quiet:
        level = logging.WARNING
    else:
        level = logging.INFO
    logging.basicConfig(
        stream=sys.stderr,
        level=level,
        format="%(levelname)s %(name)s: %(message)s",
        force=True,
    )


if __name__ == "__main__":
    sys.exit(main())
```

- [ ] **Step 6: Update `tests/test_cli.py` argv calls to use `convert` subcommand**

For every test that calls `main([source, "--output", out, ...])` or builds argv lists, prepend `"convert"`:

```python
# Before:
exit_code = main([str(src), "--output", str(out)])
# After:
exit_code = main(["convert", str(src), "--output", str(out)])
```

For subprocess invocations like `[sys.executable, "-m", "docforge", str(src), "--output", ...]`, add `"convert"` after `"docforge"`:

```python
# Before:
[sys.executable, "-m", "docforge", str(src), "--output", str(out)]
# After:
[sys.executable, "-m", "docforge", "convert", str(src), "--output", str(out)]
```

If `tests/test_cli.py` references `build_parser` directly (e.g., `parser = build_parser(); parser.parse_args([source, ...])`), update those too with the `convert` subcommand prefix.

- [ ] **Step 7: Run full suite**

```bash
pytest -v
```

Expected: all tests in `tests/openapi/` pass and all updated tests in `tests/test_cli.py` pass. Zero failures.

- [ ] **Step 8: Commit**

```bash
git add src/docforge/cli.py src/docforge/openapi/cli.py \
        tests/test_cli.py tests/openapi/test_cli.py
git commit -m "feat(openapi): add CLI subcommand + refactor cli.py to subparser router (infra-la5)"
```

---

## Task 10: E2E smoke against diadoc spec + qmd ingest

**Files:**
- (No code changes; verify-only)

This task validates the full pipeline against the real diadoc spec, then ingests the result into qmd.

- [ ] **Step 1: Reinstall the upgraded uv tool**

```bash
uv tool install --reinstall --editable /home/igi21/experiements/docforge
docforge --version
```

Expected: `docforge 0.2.0`.

- [ ] **Step 2: Run docforge against the diadoc spec fixture**

```bash
rm -rf /tmp/diadoc-openapi-md
time docforge openapi tests/openapi/fixtures/diadoc.api.json --output /tmp/diadoc-openapi-md
```

Expected: exit 0; stderr line `INFO docforge.openapi: endpoints=123  schemas=483`. Wall time well under 30s.

- [ ] **Step 3: Sanity-check the output**

```bash
ls /tmp/diadoc-openapi-md/endpoints/ | wc -l
ls /tmp/diadoc-openapi-md/schemas/ | wc -l
head -40 /tmp/diadoc-openapi-md/endpoints/POST_V3_Authenticate.md
echo "---"
head -40 /tmp/diadoc-openapi-md/schemas/Message.md
```

Expected:
- `123` endpoint files, `483` schema files
- `POST_V3_Authenticate.md` starts with `# POST /V3/Authenticate`, `Source: diadoc.api.json#/paths/~1V3~1Authenticate/post`, `**Tags:** Авторизация`, then Russian description
- `Message.md` starts with `# Message`, has a `## Properties` table with property names, types (some with `[SchemaName](SchemaName.md)` links)

- [ ] **Step 4: Verify $ref links resolve to existing files**

```bash
python3 - <<'PY'
import re
from pathlib import Path

base = Path("/tmp/diadoc-openapi-md")
broken = 0
checked = 0
for md in (base / "endpoints").iterdir():
    txt = md.read_text(encoding="utf-8")
    for m in re.finditer(r"\]\(\.\./schemas/([^)]+)\)", txt):
        checked += 1
        target = base / "schemas" / m.group(1)
        if not target.is_file():
            print(f"BROKEN: {md.name} -> {m.group(1)}")
            broken += 1
for md in (base / "schemas").iterdir():
    txt = md.read_text(encoding="utf-8")
    for m in re.finditer(r"\]\(([A-Z][^)]+\.md)\)", txt):
        checked += 1
        target = base / "schemas" / m.group(1)
        if not target.is_file():
            print(f"BROKEN: {md.name} -> {m.group(1)}")
            broken += 1
print(f"checked {checked} schema links, {broken} broken")
PY
```

Expected: `0 broken`.

- [ ] **Step 5: Register qmd collection + embed**

```bash
qmd collection add /tmp/diadoc-openapi-md --mask '**/*.md' --name diadoc-openapi
qmd context add 'qmd://diadoc-openapi/' \
  'Diadoc OpenAPI 3.0.1 spec (REST). One markdown per endpoint and per schema. Endpoints under endpoints/ (filename {METHOD}_{path-slug}.md), schemas under schemas/ (filename {SchemaName}.md). $refs rewritten to relative MD links.'
qmd embed
qmd status
```

Expected: 606 docs added, embed completes, `qmd status` shows the new collection.

- [ ] **Step 6: Smoke query (cross-lingual, EN → RU spec)**

```bash
qmd query 'how do I authenticate by certificate' --collection diadoc-openapi -n 5
```

Expected: `POST_V3_Authenticate.md` or `POST_V3_AuthenticateConfirm.md` in top hits.

```bash
qmd query 'message structure for sending invoices' --collection diadoc-openapi -n 5
```

Expected: `Message.md` or `MessagePatch.md` in top hits.

- [ ] **Step 7: Close the beads issue**

```bash
bd close infra-la5 --reason="Shipped in docforge 0.2.0. \`docforge openapi <spec> --output <dir>\` emits per-endpoint + per-schema MD with relative \$ref links. Validated end-to-end against diadoc spec (123 endpoints + 483 schemas in <30s, qmd ingest + cross-lingual smoke query passing)."
```

- [ ] **Step 8: Commit any final docs/notes (none expected)**

```bash
git status
```

If clean: nothing to commit. If `pyproject.toml` or other artifacts changed during reinstall, commit:

```bash
git add -A
git commit -m "chore(openapi): finalize 0.2.0 release notes (infra-la5)"
```
