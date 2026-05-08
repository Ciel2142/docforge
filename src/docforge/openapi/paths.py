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
