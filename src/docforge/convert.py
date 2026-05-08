from dataclasses import dataclass
from enum import Enum

from bs4 import BeautifulSoup
from bs4.element import Tag


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
    in v1 (see spec §5.1).
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
