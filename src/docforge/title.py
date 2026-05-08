def extract_title(
    h1_text: str | None,
    soup_title_text: str | None,
    fallback_stem: str,
) -> str:
    """Resolve title: body h1 → HTML <title> → filename stem.

    Empty / whitespace-only inputs fall through to the next tier.
    """
    if h1_text and h1_text.strip():
        return h1_text.strip()
    if soup_title_text and soup_title_text.strip():
        return soup_title_text.strip()
    return fallback_stem
