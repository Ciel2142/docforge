import logging
from collections.abc import Iterator
from pathlib import Path

log = logging.getLogger("docforge.walk")

SKIP_DIRS = {
    "_static",
    "_downloads",
    ".git",
    ".venv",
    "node_modules",
    ".tox",
    "__pycache__",
    "dist",
    "build",
}
SKIP_FILES = {"genindex.html", "search.html", "robots.txt", "rss.xml"}
SKIP_EXT = {
    ".css", ".js", ".xml", ".xsd", ".txt",
    ".eot", ".ttf", ".woff", ".woff2",
    ".png", ".jpg", ".jpeg", ".ico",
}
HTML_EXT = {".html", ".htm"}


def iter_html_files(source: Path, max_bytes: int) -> Iterator[Path]:
    """Yield HTML files under `source` matching docforge filter rules.

    - Single-file source: yielded if it passes the same filters.
    - Directory source: walked recursively, depth-first, sorted within each directory.
    - Symlinks are never followed (file or dir).
    - Files larger than `max_bytes` are skipped with a WARNING log.
    """
    if source.is_symlink():
        return
    if source.is_file():
        if _passes_file_filters(source, max_bytes):
            yield source
        return
    if source.is_dir():
        yield from _walk_dir(source, max_bytes)


def _walk_dir(d: Path, max_bytes: int) -> Iterator[Path]:
    try:
        entries = sorted(d.iterdir(), key=lambda p: p.name)
    except (PermissionError, OSError):
        return
    for entry in entries:
        if entry.is_symlink():
            continue
        if entry.is_dir():
            if entry.name in SKIP_DIRS or entry.name.startswith("."):
                continue
            yield from _walk_dir(entry, max_bytes)
        elif entry.is_file():
            if _passes_file_filters(entry, max_bytes):
                yield entry


def _passes_file_filters(p: Path, max_bytes: int) -> bool:
    if p.name in SKIP_FILES:
        return False
    suffix = p.suffix.lower()
    if suffix in SKIP_EXT:
        return False
    if suffix not in HTML_EXT:
        return False
    try:
        size = p.stat().st_size
    except OSError:
        return False
    if size > max_bytes:
        log.warning("large-file skipped: %s (%d bytes > %d)", p, size, max_bytes)
        return False
    return True
