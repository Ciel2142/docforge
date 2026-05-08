import re

# Markdown link form: [text](href.html#anchor)
_MD_LINK_RE = re.compile(
    r"\]\((?!https?://|mailto:|#)([^)\s]+?)\.html(#[^)\s]*)?\)"
)

# Autolink form: <href.html#anchor>
_AUTOLINK_RE = re.compile(
    r"<(?!https?://|mailto:)([^>\s]+?)\.html(#[^>\s]*)?>"
)


def rewrite_internal_links(md: str) -> str:
    """Rewrite relative `.html` links to `.md` in both markdown and autolink form.

    Covers two forms Kreuzberg may emit:
      - `[text](href.html)` → `[text](href.md)`
      - `<href.html>`        → `<href.md>`

    Externals (http://, https://, mailto:) and pure anchors (#foo) are left alone.
    Anchors (`#section`) attached to the `.html` are preserved.
    """
    md = _MD_LINK_RE.sub(
        lambda m: f"]({m.group(1)}.md{m.group(2) or ''})",
        md,
    )
    md = _AUTOLINK_RE.sub(
        lambda m: f"<{m.group(1)}.md{m.group(2) or ''}>",
        md,
    )
    return md
