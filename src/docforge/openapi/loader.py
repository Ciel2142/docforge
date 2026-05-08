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
