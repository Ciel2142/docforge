# docforge v1 — Design Spec

**Date:** 2026-05-08
**Status:** Approved (brainstorm complete)
**Author:** brainstorm session w/ user igi21

## 1. Purpose

Standalone Python CLI converting documentation HTML → Markdown, optimized for QMD ingestion (Qwen3-Embedding-8B via llama.cpp on RTX 5090).

**v1 scope:** HTML only. Office (DOCX/PPTX/XLSX) and structured (MD passthrough, code-repo walker, OpenAPI adapter) deferred to follow-up beads issues.

**Why this exists:** Existing `/tmp/diadok-conv/` script converted Diadoc Sphinx HTML → Markdown for QMD. It is a one-off. Need reusable engine that handles "any sort of documentation" across multiple corpora over time, starting with HTML.

## 2. Non-goals (v1)

- No PDF support (deferred — MinerU/Docling integration later if needed)
- No Office document conversion (deferred to follow-up)
- No URL fetching (local files/dirs only)
- No watcher daemon (one-shot batch only)
- No QMD integration (writes MD files; user runs `qmd collection add` separately)
- No concurrency (single-threaded; Kreuzberg already converts 642 diadok files in 5.8s)
- No plugin registry (hardcoded backend; plugin seam deferred to Option C in follow-up)

## 3. CLI surface

```
docforge <source> --output <dir>
```

- `<source>`: local file or directory (positional, required)
- `--output <dir>`: required output directory; mirrors source structure
- Exit codes:
  - `0`: success (or failure rate within threshold)
  - `1`: failure rate exceeded threshold (default >10% of files failed)
  - `2`: usage error (missing source, output not writable, etc.)

Examples:

```bash
# Convert directory tree
docforge ~/docs/diadok --output ~/docs/diadok-md

# Convert single file
docforge page.html --output ./out
```

## 4. Output shape per file

Context7-style provenance (no YAML frontmatter — verified that QMD does not strip frontmatter, so YAML would pollute embeddings with `key: value` boilerplate; inline prose reads better and remains parseable):

```markdown
# <Title>

Source: <relative-path-from-source-root>

<converted markdown body>
```

- **Title resolution:** body `<h1>` → HTML `<title>` → filename stem
- **Source line:** path relative to the input source root (e.g., `diadoc-api/http/AcquireCounteragent.html`)
- **Body:** Kreuzberg `html_to_markdown.convert(...)` output, with cleanup applied before conversion (see §5)

## 5. HTML preprocessing pipeline

Each file passes through these BS4 transforms before Kreuzberg conversion:

1. **Sphinx detection / body selection (auto):**
   - `soup.find("div", attrs={"itemprop": "articleBody"})`
   - Fallback: `soup.find("main")`
   - Fallback: `soup.find("body")`
   - Fallback: `soup` (raw)
   - Rationale: Sphinx wraps real content in `[itemprop=articleBody]`. Auto-detection covers Sphinx + generic HTML in same pass without flags.

2. **Strip Sphinx noise:**
   - Remove `a.headerlink` anchors (the `¶` noise)
   - Remove `a.viewcode-link` anchors

3. **Flatten Pygments code blocks:**
   - `<div class="highlight"><pre><spans>...</pre></div>` → `<pre><code class="language-X">plain text</code></pre>`
   - Language detected from `highlight-X` CSS class
   - Without this, Kreuzberg/html2text mangle syntax-highlighted code

4. **Convert via Kreuzberg:**
   - `html_to_markdown.convert(str(body))` → `ConversionResult.content`
   - Defaults already produce ATX headings + fenced code blocks

5. **Link rewriting (always-on, integrated):**
   - Regex: `\]\((?!https?://|mailto:|#)([^)\s]+?)\.html(#[^)\s]*)?\)` → `]({1}.md{2})`
   - Rewrites internal relative `.html` links to `.md`
   - Externals (`http(s)://`, `mailto:`) untouched

6. **Assemble final output:**
   ```
   # {title}

   Source: {relative_path}

   {body_md}
   ```

## 6. File walker filters

`walk.py` skips:

- Directories: `_static/`, `_downloads/`
- Files: `genindex.html`, `search.html`, `robots.txt`, `rss.xml`
- Extensions: `.css`, `.js`, `.xml`, `.xsd`, `.txt`, `.eot`, `.ttf`, `.woff`, `.woff2`, `.png`, `.jpg`, `.jpeg`, `.ico`
- Anything not `.html` (or `.htm`)

These are the same filters used in the proven `/tmp/diadok-conv/convert_kreuzberg.py`.

## 7. Error handling

- **Per-file conversion failure:** log to stderr `FAIL <relative-path>: <exception>`, continue. Don't abort batch.
- **Empty / no-body file:** count as `skipped`, no error.
- **Threshold:** if `failed / total > 0.10`, exit 1 at end with summary line.
- **Missing input source:** exit 2 with usage message.
- **Output directory not writable / cannot create:** exit 2 with explanation.
- **Final report (stderr):** `converted=N  empty=M  skipped=K  failed=F  total=T`

## 8. Components

| Module | Responsibility | Pure? |
|--------|----------------|-------|
| `cli.py` | argparse, validate inputs, dispatch | side-effect: I/O |
| `walk.py` | walk source dir, yield `.html` files matching filter rules | pure (given dir) |
| `convert.py` | per-file: BS4 parse, body select, strip noise, flatten Pygments, Kreuzberg call | pure (str → str) |
| `title.py` | extract title via 3-tier fallback | pure |
| `links.py` | rewrite relative `.html` → `.md` in MD body | pure |
| `output.py` | assemble final string + write to mirrored output path | side-effect: write |
| `__main__.py` | `python -m docforge` entry | thin wrapper around cli.main |

## 9. Project layout

```
~/experiements/docforge/
├── pyproject.toml                # uv-managed
├── README.md                     # quickstart
├── LICENSE                       # MIT
├── .gitignore                    # python defaults + .venv/
├── docs/
│   └── superpowers/
│       └── specs/
│           └── 2026-05-08-docforge-design.md
├── src/
│   └── docforge/
│       ├── __init__.py           # version
│       ├── __main__.py           # python -m docforge
│       ├── cli.py
│       ├── walk.py
│       ├── convert.py
│       ├── title.py
│       ├── links.py
│       └── output.py
└── tests/
    ├── fixtures/
    │   ├── sphinx-method.html         # diadok AcquireCounteragent
    │   ├── sphinx-proto.html          # diadok Address
    │   ├── sphinx-guide.html          # diadok quickstart
    │   ├── generic-no-articleBody.html
    │   └── empty.html
    ├── expected/                       # golden outputs (committed)
    │   ├── sphinx-method.md
    │   ├── sphinx-proto.md
    │   ├── sphinx-guide.md
    │   └── generic-no-articleBody.md
    ├── test_walk.py
    ├── test_convert.py
    ├── test_title.py
    ├── test_links.py
    └── test_cli.py
```

## 10. Dependencies

`pyproject.toml`:

```toml
[project]
name = "docforge"
version = "0.1.0"
description = "Convert documentation HTML to Markdown for RAG ingestion"
license = { text = "MIT" }
requires-python = ">=3.10"
dependencies = [
    "html-to-markdown>=3.3,<4",
    "beautifulsoup4>=4.13,<5",
    "lxml>=5.0,<6",
]

[project.scripts]
docforge = "docforge.cli:main"

[project.optional-dependencies]
dev = ["pytest>=8", "pytest-cov"]

[build-system]
requires = ["hatchling"]
build-backend = "hatchling.build"
```

## 11. Distribution

```bash
# Production install
uv tool install git+file:///home/igi21/experiements/docforge
docforge --help

# Local dev
cd ~/experiements/docforge
uv venv .venv
uv pip install -e ".[dev]"
.venv/bin/docforge --help
.venv/bin/pytest
```

## 12. Testing strategy

- **Unit tests:** `walk.py`, `title.py`, `links.py` — pure functions, parametrize fixtures
- **Golden file tests:** `convert.py` against 5 fixtures (4 stratified diadok + 1 generic). Output file diff = test fail. Golden files committed to `tests/expected/`.
- **CLI integration test:** tmpdir + 3 fixture files → run CLI via subprocess → assert output structure + exit code

Karpathy guideline: capture current Kreuzberg output as golden. Any regression breaks the test → forces conscious design change.

## 13. Acceptance criteria

- `docforge ~/docs/diadok --output /tmp/test-out` runs cleanly and produces 642 `.md` files (matching current `~/docs/diadok-md/` count)
- Output content equivalent to current Kreuzberg+rewrite-links pipeline (allow whitespace differences only)
- All golden tests pass (`pytest`)
- `--help` prints usage with examples
- Failure on missing source produces clear stderr message + exit 2
- Failure on >10% conversion errors produces summary + exit 1

## 14. Implementation phasing (planning input)

This spec is large enough that implementation should be split into independent waves. Each wave produces a working, testable, committable slice. Suggested wave structure for the writing-plans phase:

| Wave | Slice | Verify |
|------|-------|--------|
| **0** | Scaffold: `pyproject.toml`, `src/docforge/`, `tests/`, `LICENSE`, `README` stub, `.gitignore`, initial `git commit` | `uv pip install -e ".[dev]"` succeeds |
| **1** | Pure helpers: `title.py`, `links.py` + their unit tests | `pytest tests/test_title.py tests/test_links.py` green |
| **2** | `walk.py` + filter unit tests | `pytest tests/test_walk.py` green |
| **3** | `convert.py`: BS4 select, strip noise, Pygments flatten, Kreuzberg call. Golden-file tests against 5 fixtures. | `pytest tests/test_convert.py` green |
| **4** | `output.py` + assembly (title + Source line + body) | unit test asserts shape |
| **5** | `cli.py` + `__main__.py`: argparse, dispatch, error handling, threshold logic. End-to-end CLI integration test. | `pytest tests/test_cli.py` green |
| **6** | Dogfood: run `docforge ~/docs/diadok --output /tmp/dogfood-out`, diff against existing `~/docs/diadok-md/`. Document any deltas. | `diff -r` shows only intentional differences |

Each wave is independent enough to commit and review separately. Total estimated effort: 1 day.

## 15. Deferred work (beads issues to create after spec approval)

| ID prefix | Title | Trigger to revisit |
|-----------|-------|--------------------|
| dfg-* | Add Office (DOCX/PPTX/XLSX) backend via Docling | first time user needs to ingest a Word/PowerPoint doc |
| dfg-* | Add MD passthrough adapter (frontmatter add only) | when ingesting existing MD trees |
| dfg-* | Add code-repo walker adapter | when ingesting a code repo as searchable docs |
| dfg-* | Add OpenAPI/Swagger adapter (endpoint-per-record) | when ingesting an API spec |
| dfg-* | Add URL fetch input | when downloading docs from web becomes routine |
| dfg-* | Add `--selector` CLI override | when encountering non-Sphinx custom HTML themes |
| dfg-* | Add concurrency (`--jobs N`) | only if real corpus exceeds 10s single-threaded |
| dfg-* | Plugin registry seam (Option C) | when a 2nd backend competes for the same format (e.g., MinerU vs Docling for PDFs) |

## 16. Decisions made during brainstorming

| Decision | Choice | Rationale |
|----------|--------|-----------|
| Engine strategy | Router with hardcoded backends (Option B) | Avoids premature plugin abstraction; allows per-format quality tuning |
| Primary HTML backend | Kreuzberg `html-to-markdown` v3.3 + BS4 selector | Verified empirically: Docling drops nested list children on diadok corpus (issue #2330 confirmed); Kreuzberg preserves all 12 sub-fields in `Address.html` test |
| Provenance format | Context7-style inline `Source:` line | Verified: QMD does not strip YAML frontmatter, so YAML adds `key: value` boilerplate to embeddings; inline prose reads better and is equally findable |
| Title source | h1 → `<title>` → filename stem | Three-tier fallback always finds something usable |
| Sphinx detection | Auto (sniff `[itemprop=articleBody]`, fallback to main/body) | No flags; works for Sphinx + generic in same run |
| Link rewriting | Always-on, integrated in convert pass | Output is MD; broken `.html` refs would degrade browsing |
| Language | Python | Aligns with Office roadmap (Docling is Python-only) |
| CLI shape | `docforge <source> --output <dir>` (Docling-clone) | Matches a tool user will compare against; positional source + flag output |
| Distribution | `uv tool install git+...` | Aligns with user's existing uv ecosystem |
| Output format | MD only (no chunking) | Engine = converter only; chunking is downstream consumer's job |
| License | MIT | Permissive, common for personal tools |
