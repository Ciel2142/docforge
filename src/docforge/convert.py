from dataclasses import dataclass
from enum import Enum

from bs4 import BeautifulSoup
from bs4.element import Tag
from kreuzberg import ExtractionConfig, extract_bytes_sync


_KREUZBERG_CONFIG = ExtractionConfig(use_cache=False, output_format="markdown")


class ConvertStatus(Enum):
    OK = "ok"
    EMPTY = "empty"
    FAILED = "failed"


@dataclass
class ConvertResult:
    status: ConvertStatus
    body_md: str | None = None
    h1_text: str | None = None
    soup_title_text: str | None = None
    error: str | None = None


def _select_body(soup: BeautifulSoup) -> Tag | None:
    """Sphinx-first body selector chain.

    Returns the first matching node or None. Generic HTML lacking either
    `[itemprop=articleBody]` or `[role=main]` is intentionally not supported
    in v1 (see 2026-05-08-docforge-design.md §5.1).
    """
    body = soup.find("div", attrs={"itemprop": "articleBody"})
    if body is not None:
        return body
    main = soup.find("div", attrs={"role": "main"})
    if main is None:
        return None
    inner = main.find("div", attrs={"itemprop": "articleBody"})
    return inner if inner is not None else main


def _strip_sphinx_noise(body: Tag) -> None:
    """Remove Sphinx-specific anchors that pollute markdown output."""
    for a in body.find_all("a", class_="headerlink"):
        a.decompose()
    for a in body.find_all("a", class_="viewcode-link"):
        a.decompose()


def _h1_text(body: Tag) -> str | None:
    h1 = body.find("h1")
    if h1 is None:
        return None
    text = h1.get_text(strip=True).rstrip("¶").strip()
    return text or None


def _soup_title_text(soup: BeautifulSoup) -> str | None:
    title = soup.find("title")
    if title is None:
        return None
    text = title.get_text(strip=True)
    return text or None


def convert_html(raw_html: str) -> ConvertResult:
    """Convert one HTML document to Markdown.

    Returns ConvertResult with status:
      - OK: body_md, h1_text, soup_title_text populated.
      - EMPTY: no Sphinx body found; everything else None.
      - FAILED: exception raised somewhere; error populated.

    Caller is responsible for the final link-rewrite + assembly step.
    """
    try:
        soup = BeautifulSoup(raw_html, "lxml")
        body = _select_body(soup)
        if body is None:
            return ConvertResult(status=ConvertStatus.EMPTY)
        h1 = _h1_text(body)
        title = _soup_title_text(soup)
        _strip_sphinx_noise(body)
        result = extract_bytes_sync(str(body).encode("utf-8"), "text/html", _KREUZBERG_CONFIG)
        return ConvertResult(
            status=ConvertStatus.OK,
            body_md=result.content.strip(),
            h1_text=h1,
            soup_title_text=title,
        )
    except Exception as e:  # noqa: BLE001
        return ConvertResult(status=ConvertStatus.FAILED, error=f"{type(e).__name__}: {e}")
