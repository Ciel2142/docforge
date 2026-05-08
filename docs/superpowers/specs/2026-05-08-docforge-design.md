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
docforge <source> --output <dir> [options]
```

**Positional:**
- `<source>`: local file or directory (required)

**Required flag:**
- `--output <dir>`: output directory; mirrors source dir structure

**Optional flags:**
- `--fail-threshold <ratio>`: max acceptable failure rate before exit 1 (default `0.10`)
- `--max-bytes <int>`: skip HTML files larger than N bytes, log warning (default `52428800` = 50MB)
- `--dry-run`: walk + report planned outputs, write nothing
- `-v` / `-q`: verbose / quiet logging
- `--version`: print version and exit
- `-h` / `--help`: print usage and exit

**Exit codes:**
- `0`: success (failure rate within threshold)
- `1`: failure rate exceeded `--fail-threshold`
- `2`: usage error (missing source, output not writable, output collision detected, etc.)

Examples:

```bash
# Convert directory tree
docforge ~/docs/diadok --output ~/docs/diadok-md

# Convert single file
docforge page.html --output ./out

# Dry run on big tree
docforge ~/docs/some-corpus --output /tmp/out --dry-run -v
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

Each file passes through these BS4 transforms before Kreuzberg conversion. **Encoding policy:** read file bytes as UTF-8 with `errors="replace"` (matches prototype). Non-decodable bytes counted as substitutions, not failures.

1. **Sphinx detection / body selection (auto, matches prototype):**
   - Try `soup.find("div", attrs={"itemprop": "articleBody"})`
   - Else: `main = soup.find("div", attrs={"role": "main"})` then `main.find("div", attrs={"itemprop": "articleBody"}) if main else main`
   - Else: `soup.find("div", attrs={"role": "main"})`
   - Else: **None → file counted as `empty/no-body`, skipped, no error.** Do NOT fall back to raw `<soup>` — that would emit nav/sidebar cruft.
   - Rationale: matches prototype exactly. Sphinx wraps real content in `[itemprop=articleBody]`. Generic HTML lacking this markup is not in v1 scope (deferred to `--selector` flag in v2).

2. **Strip Sphinx noise:**
   - Remove `a.headerlink` anchors (the `¶` noise)
   - Remove `a.viewcode-link` anchors

3. **Flatten Pygments code blocks:**
   - `<div class="highlight"><pre><spans>...</pre></div>` → `<pre><code class="language-X">plain text</code></pre>`
   - Language detected from `highlight-X` CSS class
   - **Skip `highlight-default`** — emit `<code>` without language attribute (prototype behavior — guards against bogus `language-default` tag)
   - Without this preprocessing, Kreuzberg mangles syntax-highlighted code

4. **Convert via Kreuzberg:**
   - `html_to_markdown.convert(str(body))` → `ConversionResult.content`
   - Defaults already produce ATX headings + fenced code blocks

5. **Link rewriting (always-on, integrated):**
   - Regex: `\]\((?!https?://|mailto:|#)([^)\s]+?)\.html(#[^)\s]*)?\)` → `]({1}.md{2})`
   - Rewrites internal relative `.html` links to `.md`
   - Externals (`http(s)://`, `mailto:`) untouched
   - **Risk:** Kreuzberg may emit different escaping (e.g., `\.html` or `<...>` autolinks). Wave 3 must include a fixture with an internal `.html` link and a golden file showing it rewritten to `.md` to lock this down before Wave 6 dogfood.

6. **Assemble final output:**
   ```
   # {title}

   Source: {relative_path}

   {body_md}
   ```

## 6. File walker filters

`walk.py` skips:

- **Directories** by name: `_static`, `_downloads`, `.git`, `.venv`, `node_modules`, `.tox`, `__pycache__`, `dist`, `build`, plus any directory beginning with `.` (dot-dirs)
- **Symlinks**: do **not** follow (prevents infinite loops on cyclic symlinks)
- **Files** by name: `genindex.html`, `search.html`, `robots.txt`, `rss.xml`
- **Extensions** that aren't HTML: `.css`, `.js`, `.xml`, `.xsd`, `.txt`, `.eot`, `.ttf`, `.woff`, `.woff2`, `.png`, `.jpg`, `.jpeg`, `.ico`
- Anything not `.html` (or `.htm`)
- **Large files** above `--max-bytes` (default 50MB): skip with `WARN large-file <path> (<bytes>)` log line

**Iteration order:** sort entries within each directory (alphabetical, case-sensitive). Required for deterministic logs and reproducible test output.

**Output path collision check:** before writing any file, build the full set of `(input_path → output_path)` mappings. If two distinct input paths map to the same output path (e.g., `Foo.html` and `foo.html` on case-insensitive output FS), abort with exit code 2 and an error message listing the colliding pairs. No partial writes.

These rules generalize the proven `/tmp/diadok-conv/convert_kreuzberg.py` filter list and add safety for arbitrary input trees.

## 7. Error handling

**Logging:** use Python `logging` module (not bare `print`). Default level `INFO`. `-v` raises to `DEBUG`, `-q` lowers to `WARNING`. All log output to stderr; stdout reserved for future structured report (deferred).

- **Per-file conversion failure:** log `ERROR FAIL <relative-path>: <exception>`, continue. Don't abort batch.
- **Empty / no-body file** (selector chain returned None): count as `empty`, no error, no log at INFO.
- **Filter-skipped file** (large, wrong extension, in skip-dir, symlink): count as `skipped`, log at DEBUG.
- **Output path collision:** detected pre-write (see §6), exit 2 with collision listing. No partial writes.
- **Threshold:** if `failed / total > --fail-threshold` (default 0.10), exit 1 at end with summary line. Set `--fail-threshold 1.0` to disable.
- **Missing input source / source not readable:** exit 2 with usage message.
- **Output directory not writable / cannot create:** exit 2 with explanation.
- **Idempotency / re-run behavior:** overwrite output files silently. v1 has no mtime/hash check. Re-running on the same source dir produces the same output bytes (assuming Kreuzberg version unchanged).
- **Final report (stderr, INFO):** `converted=N  empty=M  skipped=K  failed=F  total=T`

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
- **Golden file tests:** `convert.py` against the fixture set below. Output file diff = test fail. Golden files committed to `tests/expected/`.
- **CLI integration test:** tmpdir + small fixture tree → run CLI via subprocess → assert output structure, exit code, log lines, idempotency on re-run, and that `--dry-run` writes nothing.

**Required fixtures (add coverage for known regression risks):**

| Fixture | Purpose |
|---------|---------|
| `sphinx-method.html` | full diadok HTTP method page (AcquireCounteragent) |
| `sphinx-proto.html` | full diadok proto page (Address, with nested lists — known Docling failure case) |
| `sphinx-guide.html` | diadok howtostart/quickstart |
| `sphinx-internal-link.html` | small page with one internal `.html` link (locks down the link-rewrite regex against Kreuzberg's output) |
| `sphinx-highlight-default.html` | code block with `highlight-default` (no language) class |
| `sphinx-empty-body.html` | valid HTML, no `[itemprop=articleBody]` → must be counted `empty`, not `failed` |
| `non-utf8.html` | file with bytes that aren't valid UTF-8 → must convert via `errors="replace"`, not crash |
| `generic-no-articleBody.html` | HTML with `<main>` but no Sphinx markers → counted `empty` in v1 (since selector chain matches prototype) |

Karpathy guideline: capture Kreuzberg output as golden. Any regression breaks the test → forces conscious design change. Each fixture has both `.html` source and `.md` expected output committed.

## 13. Acceptance criteria

- `docforge ~/docs/diadok --output /tmp/test-out` runs cleanly and produces 642 `.md` files (same count as current `~/docs/diadok-md/`)
- Output **body content** equivalent to current Kreuzberg+rewrite-links pipeline. Header format differs intentionally: prototype emits YAML frontmatter with `title/source/category/version/lang`; v1 emits `# {title}\n\nSource: {path}\n` instead. The diadok-specific `category/version/lang` fields are dropped (not used by QMD; deferred to a future enrichment story).
- All golden tests pass (`pytest`)
- `--help` prints usage with examples and all flags listed in §3
- `--version` prints `docforge X.Y.Z` and exits 0
- Failure on missing source produces clear stderr message + exit 2
- Output path collision produces clear stderr listing + exit 2
- Failure rate > `--fail-threshold` produces summary + exit 1
- Re-running on the same source overwrites existing output silently (no surprise)
- `--dry-run` walks + logs planned outputs and writes nothing

## 14. Implementation phasing (planning input)

Implementation split into independent waves. Each wave produces a working, testable, committable slice. Architect feedback collapsed original 7 waves to 5.

| Wave | Slice | Verify |
|------|-------|--------|
| **0 — Scaffold** | `pyproject.toml`, `src/docforge/` skeleton, `tests/`, `LICENSE` (MIT), `README` stub, `.gitignore`, initial `git commit` | `uv pip install -e ".[dev]"` succeeds; `docforge --version` prints version |
| **1 — Pure helpers** | `title.py`, `links.py`, `walk.py` + their unit tests (filter rules, dot-dir/symlink handling, sorted iteration, title 3-tier fallback, link regex with externals/anchors/escaping) | `pytest tests/test_title.py tests/test_links.py tests/test_walk.py` green |
| **2 — Convert + golden fixtures** | `convert.py`: BS4 select chain (matches prototype), strip headerlinks/viewcode, Pygments flatten (incl. `highlight-default` skip), Kreuzberg call, encoding (`errors="replace"`). All 8 fixtures from §12 + golden outputs committed. | `pytest tests/test_convert.py` green; golden diffs zero |
| **3 — CLI + assembly + e2e** | `output.py` (assembly) + `cli.py` + `__main__.py`: argparse, all flags (`--output`, `--fail-threshold`, `--max-bytes`, `--dry-run`, `-v/-q`, `--version`), dispatch, error handling, collision pre-check, threshold logic. End-to-end CLI integration test using tmpdir + small fixture tree. | `pytest tests/test_cli.py` green; manual run on tiny tree works |
| **4 — Dogfood** | Run `docforge ~/docs/diadok --output /tmp/dogfood-out`. Diff body content against existing `~/docs/diadok-md/` (excluding header format change). Document any unintended deltas. | `diff` shows only the intentional header-format difference |

Each wave is independent enough to commit and review separately. Total estimated effort: ~1 day.

## 15. Deferred work (beads issues to create after spec approval)

| Title | Trigger to revisit |
|-------|--------------------|
| Add Office (DOCX/PPTX/XLSX) backend via Docling | first time user needs to ingest a Word/PowerPoint doc |
| Add MD passthrough adapter (just write `# Title\n\nSource: ...\n` + body) | when ingesting existing MD trees |
| Add code-repo walker adapter | when ingesting a code repo as searchable docs |
| Add OpenAPI/Swagger adapter (endpoint-per-record) | when ingesting an API spec |
| Add URL fetch input (`docforge https://docs.foo.com --output ./out`) | when downloading docs from web becomes routine |
| Add `--selector` CLI override (and broaden v1 selector chain to handle non-Sphinx HTML) | when encountering non-Sphinx custom HTML themes (MkDocs, Hugo, generic) |
| Add concurrency (`--jobs N`) | only if real corpus exceeds 10s single-threaded |
| Plugin registry seam (Option C) | when a 2nd backend competes for the same format (e.g., MinerU vs Docling for PDFs) |
| Configurable enrichment story (per-source rules adding tags/category/version/lang into output) | when a downstream consumer actually needs these fields |
| Incremental conversion (skip files where output mtime/hash >= input) | when corpora grow large and full reconvert is too slow |
| Structured JSON report on stdout (`{converted, failed, files: [...]}`) | when piping into CI / reporting tools |

## 16. Decisions made during brainstorming

| Decision | Choice | Rationale |
|----------|--------|-----------|
| Engine strategy | Router with hardcoded backends (Option B) | Avoids premature plugin abstraction; allows per-format quality tuning |
| Primary HTML backend | Kreuzberg `html-to-markdown` v3.3 + BS4 selector | Verified empirically: Docling drops nested list children on diadok corpus (issue #2330 confirmed); Kreuzberg preserves all 12 sub-fields in `Address.html` test |
| Provenance format | Context7-style inline `Source:` line | Verified: QMD does not strip YAML frontmatter, so YAML adds `key: value` boilerplate to embeddings; inline prose reads better and is equally findable |
| Title source | h1 → `<title>` → filename stem | Three-tier fallback always finds something usable |
| Sphinx detection | Match prototype's chain exactly; no body found = `empty` (skipped, not error) | Avoids emitting nav/sidebar cruft on non-Sphinx HTML; defers generic-HTML support to v2 `--selector` flag |
| Diadok-specific tags (`category/version/lang`) | Dropped in v1 | Not used by QMD downstream; per user. Configurable enrichment deferred to follow-up |
| Output path collisions | Pre-write check, abort with exit 2 + listing | Per user. Loud failure beats silent overwrite of distinct sources |
| Idempotency | Overwrite output silently on re-run; no mtime/hash check | Matches prototype; incremental conversion deferred |
| Link rewriting | Always-on, integrated in convert pass | Output is MD; broken `.html` refs would degrade browsing |
| Language | Python | Aligns with Office roadmap (Docling is Python-only) |
| CLI shape | `docforge <source> --output <dir>` + flags (Docling-clone) | Matches a tool user will compare against; positional source + flag output |
| Failure threshold | `--fail-threshold` flag, default 0.10, set 1.0 to disable | Per architect review; one-flag escape hatch saves a future beads issue |
| Large-file guard | `--max-bytes` flag, default 50MB | Per architect review; prevents lxml OOM on pathological input |
| Logging | Python `logging` module to stderr; `-v/-q` flags | Per architect review; standard, configurable, leaves stdout free for future structured report |
| Encoding policy | UTF-8 read with `errors="replace"` | Matches prototype; non-decodable bytes don't fail conversion |
| Walker safety | No symlink follow; skip dot-dirs + common build/cache dirs; sorted iteration | Per architect review; prevents infinite loops, ensures determinism |
| Distribution | `uv tool install git+...` | Aligns with user's existing uv ecosystem |
| Output format | MD only (no chunking) | Engine = converter only; chunking is downstream consumer's job |
| License | MIT | Permissive, common for personal tools |
