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


def _flatten_pygments(soup: BeautifulSoup, body: Tag) -> None:
    """Convert Sphinx Pygments highlight blocks to plain `<pre><code class="language-X">`.

    Sphinx wraps each highlighted code block as either:

        <div class="highlight-LANG"><div class="highlight"><pre>...spans...</pre></div></div>

    or just:

        <div class="highlight"><pre>...spans...</pre></div>

    We replace the outermost matching wrapper with a clean <pre><code> pair so
    Kreuzberg fences the block and tags the language. `highlight-default` is
    treated as no language (avoids bogus `language-default` tag).
    """
    for wrapper in list(body.find_all("div", class_="highlight")):
        lang = ""
        outer = wrapper.parent
        if outer is not None and outer.has_attr("class"):
            for c in outer.get("class", []):
                if c.startswith("highlight-") and c != "highlight-default":
                    lang = c[len("highlight-"):]
                    break
        if not lang:
            for c in wrapper.get("class", []):
                if c.startswith("highlight-") and c != "highlight-default":
                    lang = c[len("highlight-"):]
                    break

        pre = wrapper.find("pre")
        if pre is None:
            continue
        text = pre.get_text()

        new_pre = soup.new_tag("pre")
        code = soup.new_tag("code")
        if lang:
            code["class"] = [f"language-{lang}"]
        code.string = text
        new_pre.append(code)

        replace_target = (
            outer
            if (
                outer is not None
                and outer.has_attr("class")
                and any(c.startswith("highlight-") for c in outer.get("class", []))
            )
            else wrapper
        )
        replace_target.replace_with(new_pre)
