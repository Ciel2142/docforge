"""OpenAPI 3.x → Markdown adapter for docforge."""

from .loader import UnsupportedSpecError, load_spec

__all__ = ["UnsupportedSpecError", "load_spec"]
