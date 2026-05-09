# docforge — TypeScript Rewrite Design Spec

**Date:** 2026-05-09
**Status:** Approved (brainstorm complete)
**Author:** brainstorm session w/ user igi21
**Supersedes:** docforge Python implementation at version 0.3.0

## 1. Purpose

Rewrite the `docforge` CLI tool from Python to TypeScript. TypeScript becomes the canonical implementation; the Python codebase is retired once parity is proven via dogfood.

**Motivation:** Personal preference / learning. The Python tool works; this rewrite is a vehicle for the user to gain hands-on experience with idiomatic TS tooling on a real, scope-bounded project.

**Scope of port:** full v1 functionality
- HTML → Markdown converter (`convert` subcommand, primary use case)
- OpenAPI 3.x → per-endpoint + per-schema Markdown (`openapi` subcommand)

The TS port mirrors current Python behavior with small, motivated improvements (see §4).

## 2. Non-goals

- No expansion of feature set during the rewrite. Functional changes are limited to the small list in §4.
- No support for additional input formats (PDF, Office, URLs) — already deferred in the v1 design.
- No npm-registry publish in the initial waves. Local install via `npm install -g .` or `npm link`. Publishing is a follow-up decision.
- No async/concurrent conversion. Sync throughout, matches Python.
- No abandonment of `@kreuzberg/node`. The rewrite explicitly depends on the Rust-core kreuzberg binding to preserve HTML→Markdown output quality.

## 3. Stack

| Concern | Choice | Rationale |
|---|---|---|
| Runtime | Node 20+ | Built-in fetch (unused but available), recursive readdir, stable enough across distros |
| Package manager | npm | Vanilla; fewest learning detours |
| Module system | ESM only (`"type": "module"`) | Modern; matches `@kreuzberg/node` and most current libs |
| TypeScript | strict, NodeNext, target ES2022 | Strictness expected on a personal-learning project |
| HTML parser | `cheerio` | jQuery-like API maps cleanly from BS4 (`soup.find()` → `$()`) |
| HTML→Markdown | `@kreuzberg/node` | Same Rust core as Python binding; preserves output quality |
| YAML | `js-yaml` | Standard, mature, types via `@types/js-yaml` |
| CLI parsing | `commander` | Most common Node CLI lib; subcommand support matches Python `argparse` shape |
| Test runner | `vitest` | Snapshot-to-file matches `pytest` golden pattern |
| TS execution (dev) | `tsx` | For running `src/bin.ts` directly without build step |

`package.json` deps:

```json
{
  "name": "docforge",
  "version": "0.4.0",
  "type": "module",
  "bin": { "docforge": "dist/bin.js" },
  "dependencies": {
    "@kreuzberg/node": "^4",
    "cheerio": "^1",
    "commander": "^13",
    "js-yaml": "^4"
  },
  "devDependencies": {
    "@types/node": "^22",
    "@types/js-yaml": "^4",
    "typescript": "^5.7",
    "vitest": "^2",
    "tsx": "^4"
  }
}
```

Version bump to `0.4.0` to mark the language switch.

## 4. CLI Surface

```
docforge [-v|-q] [--version] <command> [...]

Commands:
  convert <source> --output <dir> [options]
  openapi <spec>   --output <dir>

convert flags:
  --output <dir>           required
  --fail-threshold <ratio> default 0.10 (set 1.0 to disable)
  --max-bytes <int>        default 10485760 (10 MB)
  --dry-run                walk + log planned outputs, write nothing
  --report-json <path>     write per-file status JSON to <path>

Root flags:
  -v / --verbose           DEBUG-level logging
  -q / --quiet             WARNING-level logging
  --version                print version and exit
  -h / --help              print usage

Exit codes:
  0  success (failure ratio within threshold)
  1  failure ratio exceeded --fail-threshold
  2  usage error (missing source, output not writable, collision detected, etc.)

Final stderr summary:
  converted=N empty=M skipped=K failed=F total=T
```

**Differences from Python tool:**

| What | From | To | Why |
|---|---|---|---|
| `skipped` counter | always reports `0` (Python TODO at cli.py:126) | walker returns `{ paths, skippedCount }` | the current line lies; fix during port |
| `--max-bytes` default | 50 MB | 10 MB | HTML rarely exceeds 10 MB; 50 MB was paranoia for lxml OOM. Kreuzberg has its own limits. Walker logs `WARN large-file ...` when skipped. |
| `--report-json <path>` | absent | new flag | per-file status JSON for CI/scripts. Was deferred in original spec §15; cheap during rewrite. |
| Log format | `<level> <logger>: <message>` | `<level> <message>` | drop logger name; less Python-flavored |

The CLI is otherwise byte-identical in shape to the Python tool. Subcommand structure (`convert` + `openapi`) is preserved.

## 5. Project Layout

```
~/experiements/docforge/
├── package.json
├── tsconfig.json
├── vitest.config.ts
├── README.md
├── LICENSE                       # MIT, carried over
├── .gitignore                    # node_modules, dist, .vitest
├── docs/
│   └── superpowers/specs/        # this doc + carry over prior specs
├── src/
│   ├── index.ts                  # exports + version constant
│   ├── bin.ts                    # shebang #!/usr/bin/env node + cli.main()
│   ├── cli.ts                    # commander root + convert subcommand handler
│   ├── walk.ts                   # iter HTML files (filters, sorted, no symlinks)
│   ├── convert.ts                # cheerio body select + strip + kreuzberg
│   ├── title.ts                  # 3-tier fallback
│   ├── links.ts                  # regex .html → .md (md links + autolinks)
│   ├── output.ts                 # assemble + collision detect + write + report-json
│   └── openapi/
│       ├── cli.ts                # commander subcommand registration
│       ├── loader.ts             # js-yaml + JSON.parse + version guards
│       ├── iter.ts               # iterEndpoints + iterSchemas
│       ├── refs.ts               # $ref resolver
│       ├── paths.ts              # slug + filename helpers + collision detect
│       └── render.ts             # endpoint + schema renderers
└── tests/
    ├── fixtures/                 # carry over .html fixtures from Python tests
    ├── expected/                 # carry over .md goldens (regenerate once in Wave 2)
    ├── walk.test.ts
    ├── convert.test.ts
    ├── title.test.ts
    ├── links.test.ts
    ├── output.test.ts
    ├── cli.test.ts
    └── openapi/
        ├── fixtures/petstore-mini.{json,yaml}
        ├── loader.test.ts
        ├── iter.test.ts
        ├── refs.test.ts
        ├── paths.test.ts
        ├── render.test.ts
        └── cli.test.ts
```

Wave 6 retires the Python `src/docforge/` and `pyproject.toml` once dogfood proves parity.

## 6. Module-by-module port plan

| Python | TS | Notes |
|---|---|---|
| `bs4.BeautifulSoup` | `cheerio.load(html)` | `$('selector')` replaces `soup.find(...)` |
| `kreuzberg.extract_bytes_sync` | `@kreuzberg/node` `extractBytesSync` | Same Rust core; identical config (camelCase: `outputFormat`, `useCache`) |
| `pyyaml` | `js-yaml` | `load(raw, { schema: JSON_SCHEMA })` to avoid YAML 1.1 booleans |
| `argparse` subparsers | `commander` subcommands | Root command + `convert` + `openapi` |
| `pathlib.Path` | `node:path` + `node:fs` | Manual joins via `path.join`/`path.relative` |
| `logging` module | 5-line custom logger to stderr | Levels: debug/info/warn/error; toggled by `-v/-q` |
| `pytest` golden files | `vitest` + `expect(...).toMatchFileSnapshot(path)` | Same approach: read `.html` fixture, compare to `.md` golden |

## 7. Conversion Pipeline (`src/convert.ts`)

Per-file flow:

```
read bytes (utf-8; Node default replaces invalid sequences with U+FFFD,
                   matching Python errors="replace")
  → cheerio.load(html, { xml: false })          # HTML mode
  → select body via 3-tier chain                # see below
  → if no body → status="empty", return
  → extract h1 text + <title> text BEFORE strip
  → strip <a.headerlink> + <a.viewcode-link>
  → serialize body via $.html(bodyNode)         # outer HTML; matches Python str(body)
  → extractBytesSync(buffer, "text/html",
        { useCache: false, outputFormat: "markdown" })
  → status="ok", body_md = result.content.trim()

caller (cli.ts):
  → title = extractTitle(h1, soupTitle, basename(path, ext))
  → body_md = rewriteInternalLinks(body_md)
  → out = buildOutput(title, relpath, body_md)
  → write
```

**Body selection chain (port from Python `convert.py:27-41`):**

```ts
function selectBody($: CheerioAPI): Cheerio<Element> | null {
  const direct = $('div[itemprop="articleBody"]').first();
  if (direct.length) return direct;

  const main = $('div[role="main"]').first();
  if (!main.length) return null;

  const inner = main.find('div[itemprop="articleBody"]').first();
  return inner.length ? inner : main;
}
```

**Result type (discriminated union, tighter than Python dataclass):**

```ts
type ConvertResult =
  | { status: "ok"; body_md: string; h1_text: string | null; soup_title_text: string | null }
  | { status: "empty" }
  | { status: "failed"; error: string };
```

**Cheerio gotchas to verify in Wave 2:**

1. `$.html(node)` returns outer HTML for a single node; matches Python `str(body)`.
2. Cheerio decodes entities differently than BS4. Possible golden-file regen needed once.
3. Cheerio wraps top-level `<html><body>` automatically. Selectors still work; we serialize only the matched body node, never the document root.

**Encoding note:** Node's default UTF-8 decoder substitutes U+FFFD on invalid bytes, equivalent to Python's `errors="replace"`. No flag needed.

**Risk to verify in Wave 2:** Kreuzberg's Node binding may emit slightly different markdown than the Python binding (e.g., spacing, escape rules) even though both use the same Rust core. Mitigation: regenerate goldens once against TS output, commit, lock in.

## 8. Walker (`src/walk.ts`)

```ts
const SKIP_DIRS = new Set([
  "_static", "_downloads", ".git", ".venv", "node_modules",
  ".tox", "__pycache__", "dist", "build",
]);
const SKIP_FILES = new Set(["genindex.html", "search.html", "robots.txt", "rss.xml"]);
const SKIP_EXT = new Set([
  ".css", ".js", ".xml", ".xsd", ".txt",
  ".eot", ".ttf", ".woff", ".woff2",
  ".png", ".jpg", ".jpeg", ".ico",
]);
const HTML_EXT = new Set([".html", ".htm"]);

interface WalkResult {
  paths: string[];
  skippedCount: number;     // fix the lying counter
}

function iterHtmlFiles(source: string, maxBytes: number): WalkResult;
```

**Rules (carried over from Python):**

- No symlink follow (use `fs.lstatSync` to detect).
- Sorted entries per directory (alphabetical, case-sensitive — required for deterministic logs).
- Skip dot-dirs (any dir name starting with `.`) plus `SKIP_DIRS`.
- Files: `SKIP_FILES` name OR `SKIP_EXT` extension OR not in `HTML_EXT` → skipped.
- Files larger than `maxBytes` → log warning `WARN large-file <path> (<bytes>)`, skipped.

`skippedCount` increments once per filtered file (extension reject, size reject, name reject). Used to make `cli.ts` summary line accurate.

## 9. Output (`src/output.ts`)

```ts
function buildOutput(title: string, sourceRelpath: string, bodyMd: string): string {
  return `# ${title}\n\nSource: ${sourceRelpath}\n\n${bodyMd.trim()}\n`;
}

function detectCollisions(
  inputs: string[], sourceRoot: string, outputRoot: string,
  opts?: { caseInsensitive?: boolean },
): Map<string, string>;     // throws Error with multi-line listing on collision

function writeOutput(outPath: string, content: string): void;
// fs.mkdirSync(dirname, { recursive: true }) + fs.writeFileSync(utf8)

interface ReportEntry {
  input: string;             // relative path
  output: string | null;
  status: "ok" | "empty" | "failed" | "skipped";
  error?: string;
}

function writeReportJson(reportPath: string, entries: ReportEntry[]): void;
```

Collision detection runs pre-write, identical to Python. On collision, throws an Error whose `.message` lists all colliding pairs. CLI catches and exits with code 2.

## 10. Links (`src/links.ts`)

Direct port of Python regexes:

```ts
const MD_LINK_RE = /\]\((?!https?:\/\/|\/\/|mailto:|#)([^)\s]+?)\.html(#[^)\s]*)?\)/g;
const AUTOLINK_RE = /<(?!https?:\/\/|\/\/|mailto:)([^>\s]+?)\.html(#[^>\s]*)?>/g;

export function rewriteInternalLinks(md: string): string {
  return md
    .replace(MD_LINK_RE, (_, p1, p2) => `](${p1}.md${p2 ?? ""})`)
    .replace(AUTOLINK_RE, (_, p1, p2) => `<${p1}.md${p2 ?? ""}>`);
}
```

Same fixtures, same behavior. JS regex syntax is identical to Python's for these patterns.

## 11. Title (`src/title.ts`)

```ts
export function extractTitle(
  h1Text: string | null,
  soupTitleText: string | null,
  fallbackStem: string,
): string {
  if (h1Text && h1Text.trim()) return h1Text.trim();
  if (soupTitleText && soupTitleText.trim()) return soupTitleText.trim();
  return fallbackStem;
}
```

Three-tier fallback: body `<h1>` → HTML `<title>` → filename stem. Empty / whitespace-only inputs fall through.

## 12. OpenAPI Subcommand (`src/openapi/`)

Pure dict/string manipulation. No HTML, no kreuzberg, no cheerio.

**Module-level mapping:**

| Python | TS | Notes |
|---|---|---|
| `loader.py` | `loader.ts` | `js-yaml.load()` for `.yaml/.yml`, `JSON.parse()` for `.json`; throw `UnsupportedSpecError` for non-3.x specs and Swagger 2.0 |
| `iter.py` | `iter.ts` | `Endpoint` + `Schema` as TypeScript `interface`; `iterEndpoints()` + `iterSchemas()` as generator functions |
| `refs.py` | `refs.ts` | `refToSchemaName(ref)` and `refLink(ref, fromKind)` returning `[label, href]` tuple |
| `paths.py` | `paths.ts` | `slugPath`, `endpointFilename`, `schemaFilename`, `detectEndpointCollisions` (throws `SlugCollisionError`) |
| `render.py` | `render.ts` | Build `string[]` then `.join("\n") + "\n"`; trim trailing empty strings |
| `cli.py` | `cli.ts` | commander subcommand registration |

**Type shapes:**

```ts
interface Endpoint {
  method: string;       // lowercase
  path: string;
  operation: Record<string, unknown>;
  tags: string[];
  summary: string;
  description: string;
}

interface Schema {
  name: string;
  body: Record<string, unknown>;
}

class UnsupportedSpecError extends Error {}
class SlugCollisionError extends Error {}
```

**Spec validation:** parse → assert root is plain object → reject `swagger` key (Swagger 2.0) → require `openapi` field starts with `"3."`.

**Output structure (unchanged):**

```
<output>/
├── endpoints/
│   └── <METHOD>_<slugified-path>.md
└── schemas/
    └── <SchemaName>.md
```

**Final log line:** `endpoints=N schemas=M`.

## 13. Logging

5-line custom logger to stderr; no external dep.

```ts
type Level = "debug" | "info" | "warn" | "error";
const LEVEL_RANK: Record<Level, number> = { debug: 0, info: 1, warn: 2, error: 3 };

let _minLevel: Level = "info";

export function setLevel(level: Level): void { _minLevel = level; }

export function log(level: Level, msg: string, ...args: unknown[]): void {
  if (LEVEL_RANK[level] < LEVEL_RANK[_minLevel]) return;
  console.error(`${level.toUpperCase()} ${msg}`, ...args);
}
```

`-v` sets `debug`; `-q` sets `warn`; default `info`. Output format is `<LEVEL> <message>` (no logger name, unlike Python).

## 14. Output Per File

Identical to Python. Context7-style provenance, no YAML frontmatter:

```markdown
# <Title>

Source: <relative-path-from-source-root>

<converted markdown body>
```

## 15. Testing Strategy

**Test runner:** vitest. Run with `npm test` (script alias for `vitest run`).

**Golden file pattern:**

```ts
import { expect, test } from "vitest";
import { readFileSync } from "node:fs";
import { basename, extname } from "node:path";
import { convertHtml } from "../src/convert.js";
import { extractTitle } from "../src/title.js";
import { rewriteInternalLinks } from "../src/links.js";
import { buildOutput } from "../src/output.js";

function fullPipeline(htmlPath: string, relpath: string): string {
  const html = readFileSync(htmlPath, "utf8");
  const result = convertHtml(html);
  if (result.status !== "ok") throw new Error(`expected ok, got ${result.status}`);
  const stem = basename(htmlPath, extname(htmlPath));
  const title = extractTitle(result.h1_text, result.soup_title_text, stem);
  const body = rewriteInternalLinks(result.body_md);
  return buildOutput(title, relpath, body);
}

test("sphinx-method", () => {
  const md = fullPipeline(
    "tests/fixtures/sphinx-method.html",
    "diadoc-api/AcquireCounteragent.html",
  );
  expect(md).toMatchFileSnapshot("tests/expected/sphinx-method.md");
});
```

The `fullPipeline` helper composes the four module functions exactly the way `cli.ts` does. Each module remains independently unit-testable; `fullPipeline` is a test-side concern, not a production export. `toMatchFileSnapshot` writes/updates the file under `-u`, locks behavior thereafter.

**Fixtures (carry over from Python `tests/fixtures/`):**

- `sphinx-method.html` (full method page)
- `sphinx-proto.html` (proto page with nested lists — known Docling failure case)
- `sphinx-guide.html` (quickstart-style page)
- `sphinx-internal-link.html` (locks down the link-rewrite regex)
- `sphinx-highlight-default.html` (code block with `highlight-default` class)
- `sphinx-empty-body.html` (no body marker — must count as `empty`, not `failed`)
- `non-utf8.html` (invalid UTF-8 bytes — must convert via replace, not crash)
- `generic-no-articleBody.html` (no Sphinx markers — counted `empty` in v1)

Each fixture has both a committed `.html` source and `.md` golden output.

**CLI integration test (`tests/cli.test.ts`):**

```ts
test("convert tmpdir e2e", () => {
  // copy a small fixture tree into mkdtempSync
  // execSync("node dist/bin.js convert <tmpdir>/in --output <tmpdir>/out")
  // assert: file count, exit code, stderr summary line, idempotency on re-run
});
```

Run via `node dist/bin.js` (after Wave 0 establishes a build) or `tsx src/bin.ts` if avoiding the build step.

**OpenAPI tests:** mirror Python `tests/openapi/` — petstore-mini fixture, unit tests per module, end-to-end CLI test that runs against the fixture and asserts file counts + names.

## 16. Acceptance Criteria

- `npm test` green across all module + CLI + openapi suites.
- `docforge convert ~/docs/diadok --output /tmp/dogfood-ts` runs cleanly and produces 642 `.md` files (same count as current `~/docs/diadok-md/`).
- Output **body content** equivalent to current Python pipeline; document any drift in Wave 5 dogfood report.
- `--help` prints usage with examples and all flags listed in §4.
- `--version` prints `docforge 0.4.0` and exits 0.
- Output path collision produces clear stderr listing + exit 2.
- Failure rate over `--fail-threshold` produces summary + exit 1.
- Re-running on the same source overwrites existing output silently.
- `--dry-run` walks + logs planned outputs and writes nothing.
- `--report-json <path>` writes a valid JSON file with one entry per processed input.
- `docforge openapi <spec> --output <dir>` produces the same file set as the current Python tool against the same spec.
- After Wave 6: `git ls-files` contains no Python source files; `pyproject.toml` and `uv.lock` are deleted.

## 17. Implementation Phasing

| Wave | Slice | Verify |
|---|---|---|
| **0 — Scaffold** | `package.json`, `tsconfig.json`, `vitest.config.ts`, `src/bin.ts` shebang, `src/cli.ts` skeleton, root `--version`, `.gitignore` (node_modules, dist), README rewrite | `npm install` + `npx docforge --version` prints version |
| **1 — Pure helpers** | `walk.ts`, `title.ts`, `links.ts` + tests. `WalkResult` includes `skippedCount` (fix the Python bug). | `npm test -- walk title links` green |
| **2 — Convert + goldens** | `convert.ts`: cheerio body select chain, strip noise, kreuzberg call. Carry over 8 fixtures. Regenerate goldens once vs TS output. Commit goldens. | `npm test -- convert` green; manual eyeball of goldens vs Python output |
| **3 — Output + cli convert + e2e** | `output.ts`, `cli.ts` (convert subcommand), `--report-json` flag, all error paths, collision pre-check. CLI integration test. | `npm test` all green; manual `docforge convert tests/fixtures --output /tmp/out` works |
| **4 — OpenAPI port** | `openapi/{loader,iter,refs,paths,render,cli}.ts` + tests. Carry over petstore-mini fixture. | `npm test -- openapi` green |
| **5 — Dogfood** | Run TS `docforge convert ~/docs/diadok --output /tmp/dogfood-ts`. Diff body content vs `~/docs/diadok-md/`. Document deltas. Run TS `docforge openapi <spec> --output /tmp/openapi-ts`. Diff vs current. | Diffs limited to expected (header tweaks, kreuzberg-binding-version differences). No dropped content. |
| **6 — Retire Python** | Delete `src/docforge/`, `tests/*.py`, `pyproject.toml`, `uv.lock`. Update `README.md`. Update beads memory + close infra issue. | `git status` clean; `npm test` green; `npx docforge --help` works |

**Repo strategy:** branch `ts-rewrite` off `master`. Waves 0–6 commit there. Merge to `master` only after Wave 5 dogfood passes.

## 18. Decisions Made During Brainstorming

| Decision | Choice | Rationale |
|---|---|---|
| Why rewrite | Personal preference / learning | User explicit |
| Migration | Replace — TS becomes canonical | User explicit; Python retired in Wave 6 |
| Runtime | Node 20+ + npm | Vanilla; fewest learning detours |
| HTML→Markdown engine | `@kreuzberg/node` | Same Rust core as Python binding; preserves output quality |
| HTML parser | cheerio | jQuery-like API maps cleanly from BS4 |
| YAML | js-yaml | Standard, mature |
| CLI lib | commander | Most common Node CLI lib; subcommand support matches Python `argparse` shape |
| Test runner | vitest | `toMatchFileSnapshot` matches the pytest golden pattern |
| Sync vs async | sync throughout | Matches Python; kreuzberg `extractBytesSync` is sync; no perf reason to async-wrap |
| Module system | ESM only | Modern; matches `@kreuzberg/node` |
| `skipped` counter | Walker returns `{ paths, skippedCount }` | Fix the Python TODO at `cli.py:126` (currently lies, reports 0) |
| `--max-bytes` default | Tighten 50 MB → 10 MB | HTML rarely exceeds 10 MB; original was paranoia for lxml OOM |
| `--report-json` | Add | Was deferred in original §15; cheap during rewrite |
| Log format | Drop logger name | Less Python-flavored |
| Repo strategy | Branch `ts-rewrite`, merge after dogfood | Keeps `master` working until parity proven |
| npm publish | Deferred | Local install via `npm install -g .`; publishing is a separate decision |

## 19. Deferred / Follow-ups

| Title | Trigger to revisit |
|---|---|
| Publish to npm registry | When the user wants `npx docforge` from another machine |
| GitHub Actions CI (lint + test on PR) | When the rewrite feels stable enough to gate changes |
| Add `--config <toml>` flag for kreuzberg passthrough | When OCR / PDF / chunking tuning becomes needed |
| Concurrency (`--jobs N`) | If real corpora exceed ~10s single-threaded |
| URL fetch input | When ingesting docs directly from web becomes routine |
| Plugin registry seam | When a second backend competes for the same format |
| Add Office (DOCX/PPTX/XLSX) backend | When ingesting Office docs becomes routine |
