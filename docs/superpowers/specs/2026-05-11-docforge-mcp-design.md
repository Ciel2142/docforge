# docforge MCP server — design

- **Date:** 2026-05-11
- **Status:** Draft, awaiting user review
- **Author:** brainstorming session (claude + igi21)
- **Related:**
  - `2026-05-09-docforge-typescript-rewrite-design.md` — pipeline being wrapped
  - `2026-05-11-docforge-url-source-design.md` — URL source contract
  - `2026-05-11-docforge-body-picker-defuddle-design.md` — extraction layer
  - `2026-05-09-docforge-code-chunking.md` — deferred; not part of this scope

## 1. Overview

Expose docforge as a Model Context Protocol (MCP) server so that coding agents
(Claude Code, Cursor, and other MCP hosts) can convert documentation sources to
Markdown on demand, without shelling out to the CLI.

The server is a second front-end on the existing pipeline. The CLI keeps
working unchanged. A new `docforge-mcp` binary registers MCP tools that wrap
the same pipeline modules (`source.ts`, `http/`, `extract.ts`, `convert.ts`,
`output.ts`, `walk.ts`, `openapi/`).

The server writes converted corpora to a configured base directory that the
user's local search backend (qmd) already indexes, so search becomes an
out-of-band concern handled by qmd rather than by docforge.

### Goals

- Agents can convert a URL, a site, an `llms-full.txt`, or an OpenAPI spec to
  Markdown via three MCP tools.
- Output lives in a predictable on-disk layout the user's existing qmd
  instance can ingest without extra glue.
- No regressions in the existing CLI.

### Non-goals (v1)

- HTTP/SSE transport.
- Chunking, search, or RAG features (covered by qmd and a separate chunking
  spec).
- Authenticated/private documentation sources.
- Long-running job orchestration with progress streaming.
- Auto-registration of corpora into qmd (qmd discovers via its own indexing).

## 2. Architecture

### Package layout

A new entry `src/mcp/server.ts` lives in the existing docforge repo and ships
in the same npm package. `package.json` gains a second `bin` entry:

```json
"bin": {
  "docforge": "dist/bin.js",
  "docforge-mcp": "dist/mcp/bin.js"
}
```

The MCP server reuses the existing pipeline modules. To do this without
copy-paste, the pipeline body currently inlined in `src/cli.ts` is extracted
into `src/index.ts` as a callable function:

```ts
// src/index.ts (new top-level export)
export interface RunOpts {
  source: string;                  // URL or local path
  kind?: "auto" | "page" | "site" | "llms-full" | "openapi";
  outputDir: string;               // absolute path to <collection> root
  llmsFull?: "auto" | "force" | "off";
  selector?: string;
  maxPages?: number;
  maxDepth?: number;
  concurrency?: number;
  userAgent?: string;
  cacheDir?: string;
  isInlineSpec?: boolean;          // for OpenAPI inline source
  specFormat?: "auto" | "json" | "yaml";
}

export interface RunResult {
  kindResolved: "page" | "site" | "llms-full" | "openapi";
  pages: Array<{ relPath: string; title: string; sourceUrl: string; bytes: number }>;
  warnings: string[];
  failures: Array<{ url: string; reason: string }>;
  totalBytes: number;
}

export async function runPipeline(opts: RunOpts, signal?: AbortSignal): Promise<RunResult>;
```

Both `bin.ts` (CLI) and `src/mcp/server.ts` (MCP) call `runPipeline`. The CLI
keeps its current flags and exit codes by translating them into `RunOpts`
before the call.

### Transport

Stdio only for v1. This is the de facto standard for desktop MCP hosts
(Claude Code, Cursor) and avoids opening network ports.

### Runtime and dependencies

- Node 20+ (matches CLI).
- TypeScript, ESM.
- New dependency: `@modelcontextprotocol/sdk` (official TypeScript SDK).
- Lock-file dependency: `proper-lockfile` (or raw POSIX `flock` via
  `node:fs.promises.open` + advisory locking — final choice during
  implementation; both are reviewed in deliverables).

### Process model

One MCP server process per host session. The server is stateless across calls
— no in-memory job queue, no long-running crawls held in RAM. Each tool call
runs the pipeline synchronously, writes to disk, returns. In-call concurrency
uses the existing `p-queue` dependency (already used by the crawler).

### Configuration

Environment variables, read once at startup:

| Variable | Required | Default | Purpose |
|---|---|---|---|
| `DOCFORGE_QMD_ROOT` | yes | — | Base dir for collections. Auto-created on startup if missing; startup fails if path exists and is not writable. |
| `DOCFORGE_CACHE_DIR` | no | `~/.cache/docforge` | HTTP cache. Shared with the CLI. |
| `DOCFORGE_USER_AGENT` | no | CLI default | UA string for fetches. |
| `DOCFORGE_MAX_PAGES` | no | 5000 | Crawl cap default. |
| `DOCFORGE_MAX_DEPTH` | no | 10 | Crawl depth default. |
| `DOCFORGE_CONCURRENCY` | no | 4 | Crawler parallelism default. |

Per-call tool arguments override the env defaults when present.

### MCP host wiring example

```jsonc
// Claude Code mcpServers config
{
  "mcpServers": {
    "docforge": {
      "command": "docforge-mcp",
      "env": {
        "DOCFORGE_QMD_ROOT": "/home/igi21/qmd/collections"
      }
    }
  }
}
```

## 3. Tool schemas

Three tools. Schemas are presented as TypeScript interfaces for clarity; the
implementation registers them with the MCP SDK using its JSON Schema input
declaration.

### 3.1 `convert`

Convert a URL to Markdown. Handles single pages, site crawls, and
`llms-full.txt` shortcuts.

**Input:**

```ts
{
  url: string;                                          // required, http(s)
  corpus?: string;                                      // override derived name
  kind?: "auto" | "page" | "site" | "llms-full";        // default "auto"
  llms_full?: "auto" | "force" | "off";                 // default "auto"; honored when kind in {auto, site}
  selector?: string;                                    // CSS body picker override
  max_pages?: number;
  max_depth?: number;
  concurrency?: number;
  user_agent?: string;
  force_refresh?: boolean;                              // default false; bypass SOURCE_MISMATCH guard
  preview_bytes?: number;                               // default 8192; clamped to [256, 65536]
}
```

**Output:**

```ts
{
  collection: string;                                   // e.g. "docs-foo-dev"
  path: string;                                         // absolute, "<QMD_ROOT>/docs-foo-dev"
  kind_resolved: "page" | "site" | "llms-full";
  pages: Array<{
    rel_path: string;
    title: string;
    source_url: string;
    bytes: number;
  }>;
  preview: {
    rel_path: string;
    markdown: string;
    truncated: boolean;
  };
  total_bytes: number;
  warnings: string[];
}
```

**Kind auto-resolve order** (when `kind="auto"`):

1. If `llms_full != "off"`: probe `<origin>/llms-full.txt`. On 200 with
   non-empty body, resolve to `llms-full`.
2. If the URL path ends in one of `.html`, `.htm`, `.md`, `.txt`, `.json`,
   `.yaml`, `.yml`, resolve to `page` (last-segment match, case-insensitive).
3. Otherwise resolve to `site`.

Explicit `kind` skips auto-resolution.

### 3.2 `convert_openapi`

Convert an OpenAPI spec to per-operation Markdown.

**Input:**

```ts
{
  source: string;                                       // URL or raw spec text
  is_inline?: boolean;                                  // default false
  format?: "auto" | "json" | "yaml";                    // default "auto"
  corpus?: string;
  force_refresh?: boolean;
  preview_bytes?: number;
}
```

**Output:** same shape as `convert`, with `kind_resolved: "openapi"`. Each
entry in `pages` represents one route/operation file as produced by the
existing `openapi/` module.

When `corpus` is not supplied, the collection name is derived from
`info.title` (+ `v<major>` if present) before falling back to URL-based
derivation. See §5 for the full rules.

### 3.3 `list_corpora`

Enumerate corpora that docforge has produced under `$DOCFORGE_QMD_ROOT`.

**Input:**

```ts
{ filter?: string }                                     // optional substring match on collection name
```

**Output:**

```ts
{
  corpora: Array<{
    collection: string;
    path: string;
    source_url: string;
    kind: "page" | "site" | "llms-full" | "openapi";
    last_run: string;                                   // ISO-8601
    page_count: number;
    sha: string;
  }>;
}
```

Reads each `<QMD_ROOT>/*/.docforge.json` manifest. Directories without a
manifest are skipped (treated as foreign content).

`list_corpora` answers a different question than `qmd.list_workspaces`: this
returns *what docforge has produced and when*, including source-URL provenance
and content hash. qmd only knows what it has indexed.

### 3.4 Error envelope (all tools)

```ts
{
  isError: true;
  code:
    | "INVALID_URL"
    | "INVALID_CORPUS_NAME"
    | "ROBOTS_BLOCKED"
    | "SOURCE_MISMATCH"
    | "LLMS_FULL_MISSING"
    | "OPENAPI_PARSE"
    | "FETCH_FAILED"
    | "WRITE_FAILED"
    | "NOT_WRITABLE_QMD_ROOT"
    | "BUSY"
    | "CANCELLED";
  message: string;
  hint?: string;
}
```

## 4. Output layout

### 4.1 Directory shape

```
$DOCFORGE_QMD_ROOT/
└── docs-foo-dev/
    ├── .docforge.json                                  # manifest
    ├── index.md                                        # root page for sites
    ├── getting-started.md
    ├── api/
    │   ├── authentication.md
    │   └── endpoints.md
    └── llms-full.md                                    # when kind_resolved="llms-full"
```

**OpenAPI variant:**

```
docs-stripe-api-v1/
├── .docforge.json
├── index.md                                            # spec info + table of operations
├── operations/
│   ├── post-charges.md
│   └── get-customers-id.md
└── schemas/
    └── Charge.md                                       # optional; one file per component schema
```

### 4.2 File naming (site crawl)

- Strip origin, slugify each URL path segment, append `.md`.
- `https://docs.foo.dev/api/auth#section` → `api/auth.md` (fragments dropped,
  dedup'd against the same `api/auth.md`).
- Trailing slash or no extension → append `index.md`.
- Slug collision (e.g. `/foo` and `/foo.html` both resolve to `foo.md`) → the
  second to be written gets a `-2`, `-3`, … suffix. The manifest records the
  final names.

### 4.3 Manifest `<collection>/.docforge.json`

```ts
{
  version: 1,                                           // manifest schema version
  collection: string,
  source_url: string,
  kind: "page" | "site" | "llms-full" | "openapi",
  last_run: string,                                     // ISO-8601 UTC
  page_count: number,
  sha: string,                                          // sha256 over sorted [rel_path|sha256(content)] lines
  docforge_version: string                              // package.json version that wrote it
}
```

Written atomically (temp file + `rename`) at the end of every successful
conversion.

## 5. Collection-name derivation

Pure helper `deriveCollectionName(source, openApiInfo?, override?)` returns a
slug that obeys `^[a-z0-9][a-z0-9-]{0,127}$`.

**Rule order:**

1. If `override` is provided, validate it against the slug regex and return
   it (error `INVALID_CORPUS_NAME` otherwise).
2. For OpenAPI with `info.title`, return `slug(title)` + `"-v" + major` if
   `info.version` parses. Example: `Stripe API` v1 → `stripe-api-v1`.
3. For URLs: lowercase host, join `host` and the first non-empty path segment
   with `-`, slugify, return.
4. For local paths: basename of the directory, slugified.

**Slugify rules:** lowercase, replace non-`[a-z0-9]` with `-`, collapse repeats,
trim leading/trailing `-`. Truncate to 128 chars.

**Examples:**

| Input | Result |
|---|---|
| `https://docs.kreuzberg.dev/` | `docs-kreuzberg-dev` |
| `https://docs.python.org/3/` | `docs-python-org-3` |
| `https://docs.python.org/3.12/library/` | `docs-python-org-3-12` |
| `https://api.stripe.com/v1/openapi.yaml` (URL fallback) | `api-stripe-com-v1` |
| `https://api.stripe.com/v1/openapi.yaml` (with `info.title="Stripe API"`, `version="1.x"`) | `stripe-api-v1` |
| `file:///home/me/sphinx-build/` | `sphinx-build` |

## 6. Data flow

### 6.1 `convert` call sequence

1. Validate input (URL well-formed, `kind` consistent with other args).
2. Derive collection name via `deriveCollectionName`.
3. Read existing `<collection>/.docforge.json` if present; compare
   `source_url` against the normalized request URL. Mismatch → return
   `SOURCE_MISMATCH` unless `force_refresh=true`.
4. Acquire per-collection lock (in-memory map + on-disk `<collection>.lock`).
   Conflict → `BUSY`.
5. Resolve `kind` (llms-full probe / single page / site crawl).
6. Run `runPipeline` with `outputDir = <QMD_ROOT>/<collection>.tmp`. The
   pipeline reuses HTTP cache at `$DOCFORGE_CACHE_DIR` for cheap repeated
   crawls.
7. Compute manifest sha over the written tree. Write `.docforge.json` into
   `<collection>.tmp/`.
8. Atomic swap:
   - If `<collection>/` exists, `rename` it to `<collection>.old`.
   - `rename <collection>.tmp <collection>`.
   - Background-delete `<collection>.old`.
9. Release lock.
10. Build response: enumerate `pages[]` from `RunResult`, load preview page
    (truncated to `preview_bytes`, UTF-8-safe), return.

### 6.2 Preview selection

- Sites: the root page (`index.md`).
- OpenAPI: `index.md` (the spec overview).
- Single-page / llms-full: the only file.
- Truncate at `preview_bytes`; if any bytes were cut, set `truncated: true`.

## 7. Error handling and edge cases

### 7.0 Input validation

Each tool validates its input before any I/O. Bad URLs (parse failure, missing
scheme, scheme other than `http`/`https`) → error `INVALID_URL` with a hint
quoting the offending value. Bad `corpus` overrides → `INVALID_CORPUS_NAME`
(see §7.17). Numeric fields outside their permitted ranges (e.g. negative
`max_pages`, `preview_bytes` below the clamp floor) are clamped silently and
recorded in warnings.

### 7.1 Partial crawl failures

Some pages 5xx/timeout/extract-failure:

- Continue the crawl. Write successful pages.
- Response is `isError: false` with `warnings` summarising counts and the
  first three failed URLs.
- Full failure list written to `<collection>/.docforge.failures.log`.

### 7.2 Seed-URL failures

If the seed URL itself is unreachable, returns 4xx, or is disallowed by
robots.txt, fail the entire call. No `.tmp/` left behind. Error code is
`FETCH_FAILED` or `ROBOTS_BLOCKED` as appropriate.

### 7.3 robots.txt Disallow on non-seed URLs

Silently dropped from the frontier (already CLI behaviour). Summarised in
warnings as `"N URLs blocked by robots.txt"`.

### 7.4 max_pages reached

Crawl stops cleanly. Warning: `"crawl hit max_pages=<N>; corpus may be
incomplete"`. Response is `isError: false`.

### 7.5 llms-full required but missing

`llms_full="force"` with no `<origin>/llms-full.txt` (or empty body) → error
`LLMS_FULL_MISSING`. No `.tmp/` written.

### 7.6 OpenAPI parse error

Spec fails JSON/YAML parse or basic OpenAPI 3 validation → `OPENAPI_PARSE`.
Message carries the parser's error. No `.tmp/` written.

### 7.7 `DOCFORGE_QMD_ROOT` issues

- Missing at startup → server runs `mkdir -p` and logs to stderr.
- Exists but not writable at startup → server exits non-zero before
  registering tools. MCP host sees the process die.
- Becomes unwritable mid-session → per-call error `NOT_WRITABLE_QMD_ROOT`.

### 7.8 Source-URL mismatch on refresh

Existing manifest has `source_url = A`; new call passes a URL normalising to
`B`. Error `SOURCE_MISMATCH` with hint:
`"pass force_refresh=true to overwrite, or use a different corpus name"`.

**URL normalisation for comparison:** lowercase host, strip default ports,
strip trailing slash on path. `http` and `https` are treated as distinct
(prevents a downgrade-clobber).

### 7.9 Concurrent same-collection — same process

In-memory `Map<collection, Promise>`. Second call returns immediately with
`BUSY` and `hint: "conversion in progress; retry shortly"`. No queueing.

### 7.10 Concurrent same-collection — different processes

On entering the write phase, the server opens `<collection>.lock` with an
exclusive non-blocking `flock`. If the lock is taken → `BUSY` with
`hint: "another docforge process holds the lock"`.

Lock files carry the holding PID. On startup the server may steal a stale
lock whose PID is no longer alive (after a 5-second grace probe). v1 keeps
this conservative — the default response to a lock conflict is `BUSY`, and
the user can manually remove a stale lock if needed.

### 7.11 Cancellation

MCP exposes `AbortSignal` to tool handlers. The signal is forwarded to
`runPipeline`, which propagates it to `got`, `p-queue`, and the crawler.

On abort: stop scheduling new fetches, abort in-flight ones, remove
`<collection>.tmp/`, release the lock, return `CANCELLED`. Existing
`<collection>/` is untouched.

### 7.12 Redirect loops

`got` follows up to 10 redirects by default. Loops surface as `FETCH_FAILED`
on that URL, counted as a page failure rather than a session failure.

### 7.13 HTTPS certificate errors

Default: fail the fetch. No `insecure` flag in v1. This is a security
boundary — agents should not be able to silently downgrade TLS.

### 7.14 Preview size

`preview_bytes` is clamped server-side to `[256, 65536]`. Default 8192.
Prevents an agent asking for a 10 MB inline preview.

### 7.15 Disk full mid-write

`ENOSPC` during a page write → stop the pipeline, remove `<collection>.tmp/`,
return `WRITE_FAILED` with a hint about disk space.

### 7.16 Crash recovery

`<collection>.tmp/` orphaned by a previous crashed process. On startup, the
server scans `$DOCFORGE_QMD_ROOT/*.tmp/` and removes directories older than
one hour. Newer temp dirs are preserved (might belong to a concurrent
process).

### 7.17 Collection-name validation

Slug regex `^[a-z0-9][a-z0-9-]{0,127}$` is enforced both for derived names
(after slugifying) and for user-supplied `corpus` overrides. Anything else →
`INVALID_CORPUS_NAME`.

This blocks `..`, `/`, `\`, control characters, and names starting with `.`
(which would collide with hidden files like the manifest).

## 8. Testing strategy

The repo uses vitest with fixtures in `tests/`. The MCP server adds the
following coverage.

### 8.1 Unit

- `deriveCollectionName` — table-driven cases (host, host+path, OpenAPI
  title, override, slug edge cases, traversal rejection).
- Manifest serialise/parse; sha computation is deterministic over the sorted
  file list.
- Slug validator — accept good names, reject `..`, `/`, control chars,
  leading `.`, length over 128.
- Kind auto-resolver — URL shape → page/site/llms-full decision.

### 8.2 Integration (filesystem)

- Atomic swap: success path leaves only `<collection>/`; failure mid-write
  leaves the previous `<collection>/` intact and removes `.tmp/`.
- Lock file: a second in-test "process" (helper that opens the lock file
  directly) holding the lock → BUSY.
- `list_corpora` — mixed directories (with/without manifest) → only valid
  ones returned; filter substring works.
- Source-URL mismatch guard — pre-seeded manifest + new URL →
  `SOURCE_MISMATCH`; with `force_refresh=true` → overwrite succeeds and the
  new manifest replaces the old.
- Force refresh end-to-end with the same source URL but mutated content →
  manifest updates, sha changes.
- Crash recovery — leftover `<collection>.tmp/` older than 1 h removed on
  startup; younger preserved.

### 8.3 Pipeline reuse (against fixtures)

Using existing fixtures under `tests/fixtures/` and `tests/openapi/`, served
by a local HTTP stub (e.g. vitest + a tiny Node server or `nock`):

- Single-page convert → expected `pages[1]`, preview present, manifest sha
  matches recomputed.
- Site crawl over a 5-page fixture with sitemap → all 5 written, internal
  links rewritten, root chosen as preview.
- llms-full probe present → only `llms-full.md` written;
  `kind_resolved = "llms-full"`.
- llms-full force missing → error envelope `LLMS_FULL_MISSING`.
- OpenAPI fixture → operations files written; OpenAPI `info.title` used for
  collection naming when `corpus` is absent.
- robots.txt Disallow on a non-seed URL → warning, success; on the seed →
  error.
- max_pages hit → warning, partial corpus.

### 8.4 MCP roundtrip smoke

One end-to-end test: spawn `dist/mcp/bin.js` as a child process, pipe
JSON-RPC over stdio, send `initialize`, `tools/list`, and `tools/call convert`
against the local fixture server. Assert that the structured tool result
arrives with the expected schema. Proves wiring rather than pipeline behaviour
(that is covered above).

### 8.5 Error envelope contract

One test per error code (`INVALID_URL`, `INVALID_CORPUS_NAME`,
`ROBOTS_BLOCKED`, `SOURCE_MISMATCH`, `LLMS_FULL_MISSING`, `OPENAPI_PARSE`,
`FETCH_FAILED`, `WRITE_FAILED`, `NOT_WRITABLE_QMD_ROOT`, `BUSY`,
`CANCELLED`). Each asserts `code` and the presence of `message`/`hint`.

### 8.6 Coverage target

Match the repo's current norm — no formal percentage gate. Focus is on error
paths and atomic-write correctness, which is where silent corruption hides.

## 9. Deliverables

### New files

- `src/mcp/server.ts` — entry; registers tools; stdio transport.
- `src/mcp/tools/convert.ts`
- `src/mcp/tools/convert_openapi.ts`
- `src/mcp/tools/list_corpora.ts`
- `src/mcp/collection.ts` — `deriveCollectionName` + slug validation.
- `src/mcp/manifest.ts` — read, write, sha.
- `src/mcp/locks.ts` — in-memory map + on-disk lock.
- `src/mcp/errors.ts` — error code constants + envelope helper.
- `src/mcp/preview.ts` — UTF-8-safe truncation.
- `tests/mcp/*.test.ts` — one file per module + integration tests.

### Refactor

- Extract the pipeline body from `src/cli.ts` into `src/index.ts` as
  `runPipeline(opts, signal?)`. `cli.ts` reduces to argv parsing plus a call
  to `runPipeline`. CLI behaviour is unchanged; existing CLI tests must
  remain green.

### Modified files

- `package.json` — add `bin.docforge-mcp`, add dep
  `@modelcontextprotocol/sdk`, add dep `proper-lockfile` (final lock
  approach confirmed at implementation time).
- `tsconfig.json` — include `src/mcp/**`.
- `README.md` — new section "MCP server" with install steps, Claude Code
  config example, and a brief tool reference.

## 10. Scope

### In v1

- Three tools: `convert`, `convert_openapi`, `list_corpora`.
- Stdio transport.
- Atomic swap and per-collection locking.
- Manifest with sha and schema version.
- `llms-full` auto/force/off modes.
- Selector override.
- Environment-based config with per-call overrides.
- Partial-success crawls with warnings and a failure log.
- Cancellation via `AbortSignal`.

### Out of v1 (deferred)

- HTTP/SSE transport.
- Chunking (covered by `2026-05-09-docforge-code-chunking.md`).
- `refresh` tool (re-calling `convert` already refreshes via the manifest).
- `delete_corpus` tool (manual `rm -rf` until there is demand).
- Watch / scheduled refresh / cron.
- Streaming progress for long crawls.
- Multi-source single-call ingest.
- Search and RAG primitives (qmd's responsibility).
- Agent-passed credentials, cookies, or auth headers for private docs.
- Automatic registration of new corpora with qmd (qmd discovers via its own
  indexing).

## 11. Open questions

- **Lock library choice.** `proper-lockfile` is well-trodden but adds a dep;
  raw `fs.promises.open` + advisory locking is dependency-free but
  platform-quirky on Windows. Resolve during implementation; document the
  choice in the corresponding plan step.
- **`info.version` parsing for OpenAPI.** Some specs use semver-ish strings
  (`"1.0.4"`), others use loose strings (`"2025-01-01"`). The major-version
  heuristic falls back to URL-derived naming when parsing fails. Acceptable
  for v1; revisit if it produces noisy duplicates.
