# docforge — Kreuzberg Rewrite Design Spec

**Date:** 2026-05-09
**Status:** Approved (brainstorm complete)
**Supersedes engine choice in:** `2026-05-08-docforge-design.md` §10 (dep `html-to-markdown` → `kreuzberg`)
**Author:** brainstorm session w/ user igi21

## 1. Purpose

Replace docforge's HTML→Markdown engine. Drop `html-to-markdown` + custom Pygments code-block normaliser. Adopt `kreuzberg` (Rust core, Python binding) as conversion engine.

Scope per brainstorm decisions:
- **Full engine replacement.** No backwards-compat shim.
- **HTML-only v1 preserved.** Multi-format expansion (PDF/Office/email) deferred — Kreuzberg supports them, future stories enable per format.
- **BS4 pre-processor stays.** Empirical evidence (real Diadoc page, 50KB) shows raw Kreuzberg leaks page chrome (breadcrumbs, footer, headerlinks); BS4 body selection cuts every leak. Verified output: 8678 chars clean vs 9196 chars chrome-leaking.
- **Sphinx Pygments flattener dropped.** `_flatten_pygments` (39 lines) added language tags to code fences. Kreuzberg fences `<pre>` blocks but not languages. Original Diadoc-conv prototype also no language tags. Drop language preservation; net -39 lines.

Why now: Kreuzberg unlocks future format expansion (PDF, DOCX, XLSX, EPUB, email, archives) via single dep. v1 stays HTML-only, ground laid for v2+.

## 2. Non-goals

- No multi-format support in this story (deferred — per-format follow-up issues)
- No new CLI flags
- No Kreuzberg config exposure to user (single hardcoded `ExtractionConfig`)
- No Kreuzberg PostProcessor plugin (verified inapplicable: runs after extraction, can't do body selection)
- No language preservation on code blocks (matches prototype quality bar)

## 3. Architecture

Pipeline shape unchanged:

```
walk → BS4 parse + body select + headerlink strip → Kreuzberg HTML→MD → link rewrite → output assemble → write
```

Single behavioural change: stage 3 swaps engine.

### Before

```python
result = html_to_markdown.convert(str(body))
body_md = result.content.strip()
```

### After

```python
result = extract_bytes_sync(str(body).encode("utf-8"), "text/html", _KREUZBERG_CONFIG)
body_md = result.content.strip()
```

Where `_KREUZBERG_CONFIG = ExtractionConfig(use_cache=False, output_format="markdown")`.

## 4. Module impact

| Module | Lines now | Change | Lines after |
|--------|-----------|--------|-------------|
| `cli.py` | 166 | unchanged | 166 |
| `walk.py` | 77 | unchanged | 77 |
| **`convert.py`** | **146** | drop `_flatten_pygments` (-39); swap engine call (±0); keep `_select_body`, `_strip_sphinx_noise`, `_h1_text`, `_soup_title_text` | **~75** |
| `links.py` | 33 | unchanged | 33 |
| `output.py` | 59 | unchanged | 59 |
| `title.py` | 14 | unchanged | 14 |
| `__init__.py` | 1 | bump `__version__` `"0.2.0"` → `"0.3.0"` | 1 |
| `__main__.py` | 4 | unchanged | 4 |
| `openapi/` | — | unchanged | — |

Net source: -71 lines.

## 5. New `convert.py` (full module — ~75 lines)

```python
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
```

Compared to current `convert.py`: drops `import html_to_markdown`; drops `_flatten_pygments` (39 lines); module-level `_KREUZBERG_CONFIG` constant added (1 line); `convert_html` body shrinks by 1 line (no `_flatten_pygments` call). Function signatures + dataclass shape + return invariants identical.

## 6. Dep change

`pyproject.toml` `[project].dependencies`:

**Before**
```toml
dependencies = [
    "html-to-markdown>=3.3,<4",
    "beautifulsoup4>=4.13,<5",
    "lxml>=5.0,<6",
    "pyyaml>=6,<7",
]
```

**After**
```toml
dependencies = [
    "kreuzberg>=4.9,<5",
    "beautifulsoup4>=4.13,<5",
    "lxml>=5.0,<6",
    "pyyaml>=6,<7",
]
```

`[project].version`: `"0.2.0"` → `"0.3.0"` (breaking output change — code-block language tags lost).

`uv.lock` regenerated.

## 7. Configuration choices (with reasons)

`ExtractionConfig(use_cache=False, output_format="markdown")` — the only Kreuzberg config used.

| Setting | Value | Reason |
|---------|-------|--------|
| `use_cache` | `False` | docforge is one-shot CLI; cache adds disk I/O + TTL state per run, no benefit |
| `output_format` | `"markdown"` | matches our consumers (QMD, RAG ingestion) |
| `html_options.preprocessing.preset` | unset (= `"standard"` default) | BS4 already body-selects upstream; aggressive preprocessing redundant |
| `html_options.strip_tags` | unset | unneeded — BS4 strips chrome before Kreuzberg sees the fragment |
| `html_options.extract_metadata` | unset | metadata block emitted by Kreuzberg gets stripped by `result.content.strip()`; we use BS4 for `<title>`/`<h1>` |
| `content_filter` | unset | designed for PDF/Office, no HTML chrome impact (verified empirically) |
| `enable_quality_processing` | unset | no HTML chrome impact (verified empirically) |
| `chunking` / `ocr` / `pdf_options` / `images` / etc. | unset | not applicable to HTML pipeline |

All other defaults accepted. Configuration audit performed during brainstorm against real 50KB Diadoc page; results recorded above.

## 8. Goldens regeneration

`tests/expected/*.md` files regenerate from new pipeline. Each per-fixture diff inspected before commit:

| Fixture | Expected diff vs current golden |
|---------|----------------------------------|
| `sphinx-method.md` | code blocks lose `language-http` tag; list/heading spacing may shift |
| `sphinx-proto.md` | same; nested-list known regression case (must match prototype quality, not regress further) |
| `sphinx-guide.md` | same |
| `generic-no-articleBody.md` | unchanged (output is `EMPTY`, no body to differ on) |

Acceptance: regenerated goldens manually inspected; no chrome leakage; content-equivalent to prototype `~/docs/diadok-md/` reference.

## 9. Test changes

| Test file | Change |
|-----------|--------|
| `test_convert.py` | remove `_flatten_pygments`-targeted tests (currently lock down language-tag detection — that behaviour intentionally removed); update golden-file assertions to point at regenerated goldens; keep body-select / headerlink-strip / h1 / title / empty-body / non-utf8 / ConvertResult-shape / kreuzberg-blew-up tests |
| `test_walk.py` | unchanged |
| `test_links.py` | unchanged |
| `test_output.py` | unchanged |
| `test_title.py` | unchanged |
| `test_cli.py` | 1-line: repoint failure-injection wrapper from `c.html_to_markdown.convert = boom` to `c.extract_bytes_sync = boom` (subprocess integration; consumes regenerated goldens transparently) |

`test_convert.py:177` already references `"kreuzberg"` string in the engine-failure test (`raise RuntimeError("kreuzberg blew up")`). Stays — now literal.

## 10. Verification plan

Phased acceptance gates:

| Gate | How verified |
|------|--------------|
| 1. Unit tests green | `pytest` after goldens regenerated |
| 2. Full corpus run | `docforge convert ~/docs/diadok --output /tmp/test-out` produces 642 `.md` files (same count as current `~/docs/diadok-md/`) |
| 3. Output quality sample | random 10 files of new `/tmp/test-out` vs `~/docs/diadok-md/` reference: body content equivalent (no nav/breadcrumbs/footer/headerlink leakage) — manual eyeball |
| 4. Version stamp | `docforge --version` prints `docforge 0.3.0` |
| 5. Dep cleanliness | `pyproject.toml` does not mention `html-to-markdown`; `grep -r html_to_markdown src/ tests/` empty |
| 6. CLI surface unchanged | `docforge --help` and `docforge convert --help` output identical to current |
| 7. OpenAPI subcommand untouched | `docforge openapi --help` works; OpenAPI tests stay green without modification |

Failure of any gate → fix before commit (gate 1) or before merge (gates 2–7).

## 11. Risks & mitigations

| Risk | Mitigation |
|------|-----------|
| `kreuzberg` wheel install fails on cold environment | wheels published for linux-x86_64, macos-arm64, macos-x86_64 on PyPI; spec install on dev box (`uv tool install git+file:///home/igi21/experiements/docforge`) before merge |
| Kreuzberg output formatting differs from html-to-markdown in unexpected ways (whitespace, list nesting, inline code) | regenerate goldens; per-fixture manual diff; corpus-scale eyeball of 10 random files |
| `kreuzberg` heavy dep (~34MB wheel vs `html-to-markdown` ~50KB pure-python) | acceptable — `uv tool install` isolates; future format expansion (PDF/Office/email) becomes free |
| Kreuzberg API breakage in 4.x → 5.x | dep pin `>=4.9,<5` blocks major upgrades; revisit during 5.0 evaluation |
| Loss of code-block language tags hurts downstream RAG | matches prototype quality (`~/docs/diadok-md/` reference also has no language tags); QMD doesn't currently use language metadata; acceptable |
| BS4-then-Kreuzberg pipeline still tied to Sphinx-shaped HTML | unchanged from v1; future story enables generic HTML via Kreuzberg aggressive preprocessing path (verified working in brainstorm) |

## 12. Out of scope (future stories)

- Multi-format support: PDF, DOCX, XLSX, PPTX, EPUB, email, archives — Kreuzberg supports all, separate stories per format
- Generic-HTML support (non-Sphinx pages) via Kreuzberg aggressive preprocessing — verified viable in brainstorm, deferred
- Concurrency / batch — Kreuzberg has `batch_extract_bytes_sync`; deferred (current single-threaded converts 642 files in ~6s, no pressure)
- Plugin/extension seam — deferred to v3+
- Kreuzberg config exposure (`--ocr`, `--chunking`, etc.) — deferred until use case appears
- OpenAPI subcommand integration with Kreuzberg — out of scope (separate adapter, no HTML pipeline overlap)

## 13. Brainstorm artefacts

Empirical evidence captured during brainstorm, recorded for plan-time reference:

- Real Diadoc page tested: `/home/igi21/docs/diadok/diadoc-api/http/AcquireCounteragent.html` (50566 bytes input)
- Output table — what each Kreuzberg config produces:

| Approach | Bytes out | Front-matter | Breadcrumbs | Headerlinks | Footer | Tracking pixel |
|----------|-----------|--------------|-------------|-------------|--------|----------------|
| Raw + defaults | 9196 | leak | leak | leak | leak | leak |
| Raw + `preprocessing.preset="aggressive"` | 9022 | leak | clean | leak | clean | clean |
| **BS4 `articleBody` + strip `headerlink` + Kreuzberg defaults** | **8678** | **clean** | **clean** | **clean** | **clean** | **clean** |

Probe scripts kept at `/tmp/kreuztest/probe*.py` during brainstorm; not committed.

- Kreuzberg HTML extractor source verified: `kreuzberg/crates/kreuzberg/src/extractors/html.rs` — uses `html-to-markdown-rs`. `strip_tags` works at tag-name level only. `html_options.preprocessing.preset` works (Minimal/Standard/Aggressive). PostProcessor plugins run after extraction (cannot do body selection — too late).
- Kreuzberg python binding API verified: 4.9.7. `ExtractionConfig` accepts `html_options` as `dict`. Both `snake_case` and `camelCase` keys produce identical (no-op) results when applied to chrome-stripping settings — strip_tags doesn't reach `<div role="navigation">` / `<ul class="wy-breadcrumbs">` because they aren't semantic tags.

These findings drove the Path A choice (BS4 pre-processor + Kreuzberg defaults) over Path B (raw HTML + aggressive preprocessing + post-strip regex).
