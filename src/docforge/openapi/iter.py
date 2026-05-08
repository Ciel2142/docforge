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
