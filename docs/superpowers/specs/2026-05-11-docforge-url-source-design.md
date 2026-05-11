# docforge — URL Source Design Spec

**Date:** 2026-05-11
**Status:** Approved (brainstorm complete)
**Author:** brainstorm session w/ user igi21
**Builds on:** `docs/superpowers/specs/2026-05-09-docforge-typescript-rewrite-design.md`
**Target version:** 0.5.0

## 1. Purpose

Add HTTP(S) URL support to docforge so users can convert remote documentation sites without first mirroring them with `wget`. After this change:

```bash
docforge convert https://docs.example.com/  --output ./md       # crawl + convert
docforge openapi https://api.example.com/openapi.yaml --output ./api-md  # single fetch
```

The polymorphic `<source>` argument detects URL vs filesystem path. Filesystem behavior is unchanged.

## 2. Non-goals

- **No auth in v1.** Public docs only. Bearer/basic/cookie support deferred to a follow-up issue.
- **No JS rendering.** No Playwright/Puppeteer. Static HTML only. Sites requiring JS hydration are out of scope; deferred to future `--engine=crawlee` escape hatch.
- **No non-HTTP schemes** (`s3://`, `smb://`, `file://`). HTTP(S) only.
- **No partial-fetch resume.** Crawl runs are atomic from the runtime's POV (cache layer transparently handles re-runs via ETag/304).
- **No new subcommands.** `convert` and `openapi` stay; URL handling slots in behind the same `<source>` / `<spec>` arguments.
- **No engine swap.** `@kreuzberg/node` ^4 remains the HTML→Markdown converter. Crawl is purely an input-source change.

## 3. Stack additions

| Concern | Choice | Rationale |
|---|---|---|
| HTTP client | `got` 15 | ESM-native, retry + hooks built-in, integrates `cacheable-request` for ETag/304 via the `cache:` option |
| RFC 9111 cache | `cacheable-request` 13 | Standards-compliant cache layer; pluggable Keyv backend |
| Cache store | `keyv` + `@keyv/file` | Filesystem-backed Keyv adapter → writes to `~/.cache/docforge` |
| Sitemap parser | `sitemapper` 4 | Tiny, handles sitemap-index recursion + gzipped sitemaps, last release May 2026 |
| Robots parser | `@crawlee/utils` (`RobotsTxtFile` only) | Active 2026 maintenance; `robots-parser` is stale since 2023 |
| Concurrency | `p-queue` 9 | Promise queue with `concurrency`, `interval`, `intervalCap`; clean fit for honoring `Crawl-delay` |
| HTML link extraction | `cheerio` (existing) | Reused for `<a href>` discovery during BFS fallback |

All packages verified as having a 2026 release before adoption. See `docs/superpowers/specs/2026-05-09-docforge-typescript-rewrite-design.md` §3 for the existing stack.

Updated `package.json` `dependencies`:

```json
{
  "@kreuzberg/node": "^4",
  "@crawlee/utils": "^3.16",
  "@keyv/file": "^1",
  "cacheable-request": "^13",
  "cheerio": "^1",
  "commander": "^13",
  "got": "^15",
  "js-yaml": "^4",
  "keyv": "^5",
  "p-queue": "^9",
  "sitemapper": "^4"
}
```

## 4. Architecture

Two-layer split:

```
┌────────────────────────────────────────────────────┐
│ cli.ts: parse <source>, detect URL vs path         │
└──────────┬──────────────────────┬──────────────────┘
           │ filesystem            │ http(s)
           ▼                       ▼
   ┌──────────────────┐   ┌──────────────────────┐
   │ FilesystemSource │   │ HttpSource           │
   │ (wraps walk.ts)  │   │ (sitemap + BFS +     │
   │                  │   │  robots + cache)     │
   └──────────┬───────┘   └──────────┬───────────┘
              │                      │
              └──────────┬───────────┘
                         ▼
              Source.iter(): AsyncIterable<SourceItem>
                         ▼
              convert loop (existing)
              convertHtml → buildOutput → writeOutput
                         ▼
              report.json (srcUri stamped per entry)
```

A common `Source` interface yields `SourceItem` records. The convert loop is origin-agnostic. `openapi/loader.ts` uses the bare `fetchUrl()` primitive (no crawl).

`SourceItem`:

```ts
interface SourceItem {
  key: string;          // relative path used for output mapping and report.input
  srcUri: string;       // full origin URI: file:// (filesystem) or https:// (http)
                        // FilesystemSource synthesizes file:// from absolute path
  bytes: Buffer;
  contentType: string;  // sniffed from HTTP Content-Type or file extension
}

interface Source {
  iter(): AsyncIterable<SourceItem>;
  skippedCount: number; // settable during iter(); read after drain
}
```

## 5. New modules

```
src/
├── http/                       NEW
│   ├── fetch.ts                got client + ETag cache + retry/timeout
│   ├── robots.ts               wraps @crawlee/utils RobotsTxtFile, per-host memo
│   ├── sitemap.ts              wraps sitemapper, returns flat URL list
│   ├── crawl.ts                BFS frontier with p-queue, link-discovery
│   └── url.ts                  normalize, same-origin gate, url→output-path
├── source.ts                   NEW. Source iface + FilesystemSource + HttpSource
├── cli.ts                      MODIFY. URL detection + new flags
├── output.ts                   MODIFY. ReportEntry gains srcUri
└── openapi/loader.ts           MODIFY. detect URL → fetchUrl() (no crawl)
```

`convert.ts`, `walk.ts`, `title.ts`, `links.ts`, `log.ts` unchanged.

### 5.1 `src/http/fetch.ts`

```ts
export interface FetchResult {
  status: number;
  bytes: Buffer;
  contentType: string;
  etag: string | null;
  fromCache: boolean;
}

export interface FetchOptions {
  userAgent: string;
  timeoutMs: number;       // default 30_000
  maxBytes: number;        // default 10 * 1024 * 1024
  cacheDir: string | null; // null = no cache
}

export async function fetchUrl(url: string, opts: FetchOptions): Promise<FetchResult>;
```

Implementation: `got` instance with `cache: new Keyv({ store: new KeyvFile({ filename }) })` when `cacheDir` non-null. Default retry policy: 2 retries for 5xx/network errors with exponential backoff (1s, 3s). Throws `FetchError` with `status` (if any), `message`, `cause` on hard failure. Drops bodies exceeding `maxBytes`.

### 5.2 `src/http/robots.ts`

```ts
export interface Robots {
  isAllowed(url: string, userAgent: string): boolean;
  getCrawlDelay(userAgent: string): number; // seconds, 0 if absent
  getSitemaps(): string[];
}

export async function getRobots(origin: string, opts: FetchOptions): Promise<Robots>;
```

Memoized per-origin per session. On 404 / 5xx / network error: returns an allow-all robots that reports `crawlDelay=0` and no sitemaps (per RFC 9309). Wraps `@crawlee/utils#RobotsTxtFile`.

### 5.3 `src/http/sitemap.ts`

```ts
export async function discoverSitemaps(
  rootUrl: string,
  robots: Robots,
  opts: FetchOptions,
): Promise<string[]>;  // flat list of URLs (sitemap entries)
```

Order of probes: (1) URLs from `robots.getSitemaps()`; (2) `<origin>/sitemap.xml`; (3) `<origin>/sitemap_index.xml`. Each probe uses `sitemapper` which already handles sitemap-index recursion and `.xml.gz`. Returns empty array if all probes miss or parsing fails (caller falls back to BFS).

### 5.4 `src/http/crawl.ts`

```ts
export interface CrawlOptions {
  maxPages: number;       // default 5000
  maxDepth: number;       // default 10
  concurrency: number;    // default 4
  userAgent: string;
}

export async function* crawlBfs(
  rootUrl: string,
  robots: Robots,
  fetchOpts: FetchOptions,
  crawlOpts: CrawlOptions,
): AsyncIterable<{ url: string; bytes: Buffer; contentType: string }>;
```

Frontier seeded with `rootUrl` at depth 0. Per fetched page: extract `<a href>` via cheerio, normalize, gate same-origin + `robots.isAllowed` + dedup + `depth < maxDepth` → enqueue at `depth+1`. `p-queue` with `concurrency`, `interval: crawlDelay*1000`, `intervalCap: concurrency`. Stops when frontier empty or `maxPages` hit.

### 5.5 `src/http/url.ts`

```ts
export function normalizeUrl(input: string, base?: string): string | null;
export function sameOrigin(a: string, b: string): boolean;
export function urlToOutputPath(url: string, outputDir: string): string;
```

`normalizeUrl`: resolves relative URLs against `base`, strips fragments, drops query string, collapses default ports (`http://x:80/` → `http://x/`), lowercases host. Returns `null` for non-http(s) schemes (`mailto:`, `javascript:`, etc.).

`sameOrigin`: compares normalized scheme + host + port.

`urlToOutputPath`: see §6 mapping table.

### 5.6 `src/source.ts`

```ts
export class FilesystemSource implements Source {
  constructor(root: string, maxBytes: number);
  // iter() reads each file from existing iterHtmlFiles() result
}

export class HttpSource implements Source {
  constructor(
    rootUrl: string,
    fetchOpts: FetchOptions,
    crawlOpts: CrawlOptions,
  );
  // iter():
  //   1. robots = getRobots(origin)
  //   2. sitemap = discoverSitemaps(rootUrl, robots)
  //   3. if sitemap non-empty: fetch each URL via p-queue, yield
  //      else: yield from crawlBfs(rootUrl, robots, ...)
  //   4. content-type filter: text/html only emit;
  //      non-html → skippedCount++ (no yield)
}
```

### 5.7 `src/cli.ts` changes

- Detect URL prefix `^https?://` on `<source>` and `<spec>` args.
- New flags on `convert` (URL-only — accepted on filesystem source but ignored with debug log):
  - `--max-pages <N>` default `5000`
  - `--max-depth <N>` default `10`
  - `--concurrency <N>` default `4`
  - `--cache-dir <path>` default `~/.cache/docforge`
  - `--no-cache` opt out of ETag cache
  - `--user-agent <str>` default `docforge/<VERSION>`
- Same flags on `openapi` for completeness, but only `--cache-dir`, `--no-cache`, `--user-agent` are meaningful (no crawl).
- `runConvert` becomes source-agnostic: `for await (const item of source.iter())` replaces the `for (const inPath of walk.paths)` loop.
- Existing flags (`--output`, `--fail-threshold`, `--max-bytes`, `--dry-run`, `--report-json`) unchanged in semantics.

### 5.8 `src/output.ts` changes

```ts
export interface ReportEntry {
  input: string;              // existing: relative key (filesystem rel path or URL path)
  srcUri: string;             // NEW: full origin URI (file:// or https://)
  output: string | null;
  status: 'ok' | 'empty' | 'failed' | 'skipped';
  error?: string;
}
```

New helper:

```ts
export function urlToOutputPath(url: string, outputDir: string): string;
```

Mirrors §6 table. Collision detection (`detectCollisions`) operates on resolved output paths and is unchanged — URL-derived paths participate in the same map.

### 5.9 `src/openapi/loader.ts` changes

```ts
// Existing signature stays; internal:
if (/^https?:\/\//.test(spec)) {
  const result = await fetchUrl(spec, fetchOpts);
  return parseByContentType(result.bytes, result.contentType, spec);
}
// else: existing readFileSync path
```

Content-type sniff: `application/json` → `JSON.parse`; else `js-yaml.load` (matches existing behavior).

## 6. URL → output path mapping

| URL | Output |
|---|---|
| `https://x.com/` | `<out>/index.md` |
| `https://x.com/guide/` | `<out>/guide/index.md` |
| `https://x.com/guide/foo.html` | `<out>/guide/foo.md` |
| `https://x.com/guide/foo` | `<out>/guide/foo.md` |
| `https://x.com/guide/foo?v=1#sec` | `<out>/guide/foo.md` (query+fragment stripped) |
| `https://x.com/a/b/c/page.html` | `<out>/a/b/c/page.md` |

`.html` / `.htm` extension stripped. Empty path → `index.md`. Trailing slash → `index.md`. Path segments percent-decoded then sanitized for filesystem (forbidden chars replaced with `_`).

## 7. Data flow

### 7.1 `docforge convert <url>`

```
1. cli.ts parses <source>; matches ^https?://
2. instantiate HttpSource(rootUrl, fetchOpts, crawlOpts)
3. HttpSource.iter():
   a. getRobots(origin)
   b. discoverSitemaps(rootUrl, robots)
   c. sitemap path: for each URL, p-queue.add(fetchUrl) → yield SourceItem
      BFS path: crawlBfs() generator → yield SourceItem
4. convert loop (origin-agnostic):
   for await (item of source.iter()):
     - if contentType !~ text/html: skippedCount++ (Source handled), skip
     - convertHtml(item.bytes.toString('utf8'))
     - urlToOutputPath(item.srcUri, output) → outPath
     - detectCollisions accumulator updated
     - buildOutput + writeOutput
     - report.push({ input, srcUri, output, status: 'ok' })
5. write report.json if --report-json
6. log totals + apply fail-threshold
```

### 7.2 `docforge openapi <url>`

```
1. cli.ts: detect URL → fetchUrl(spec, fetchOpts)
2. content-type sniff → JSON.parse or yaml.load
3. existing renderEndpoint / renderSchema pipeline writes outputs
4. no crawl, no sitemap, no robots
```

### 7.3 Cache lifecycle

- got + cacheable-request + `@keyv/file` store at `<cacheDir>/responses.json` (or directory-of-files store — `@keyv/file` default).
- Key: full URL after normalization.
- Value: `{ etag, lastModified, body, headers, expiry }` per RFC 9111.
- On rerun: cache layer sends `If-None-Match` / `If-Modified-Since`; server 304 → cached body returned, `fromCache: true` in debug log.
- `--no-cache` constructs `fetchOpts.cacheDir = null` → got runs without cache option.
- `--cache-dir <path>` overrides default.

## 8. Error handling

### 8.1 Fetch outcomes

| Condition | Action | Report status | Counter |
|---|---|---|---|
| DNS / connect error | got retry 2× (exp backoff), then fail | `failed` | `failed++` |
| 5xx | got retry 2×, then fail | `failed` | `failed++` |
| 4xx (no retry) | drop URL | `failed` | `failed++` |
| 304 Not Modified | use cached body | `ok` | `converted++` |
| 200 + non-html content-type | drop, debug log | (no report row) | Source-internal `skippedCount++`; no entry written to report.json |
| Timeout (default 30s) | got retry 2×, then fail | `failed` | `failed++` |
| Body > `--max-bytes` | drop, warn log | `skipped` | `skipped++` |

### 8.2 Robots

| Condition | Action |
|---|---|
| `/robots.txt` returns 404 / 5xx / network error | allow-all (RFC 9309) |
| URL disallowed | skip URL, debug log, `skippedCount++` (no failure) |
| `Crawl-delay` directive | use as `p-queue` interval; clamped to `[0, 10_000]` ms |
| Multiple `Sitemap:` directives | merge all into discovery list |

### 8.3 Sitemap

| Condition | Action |
|---|---|
| `robots.getSitemaps()` empty | try `/sitemap.xml`, then `/sitemap_index.xml` |
| All probes 404 | fall back to BFS crawl from rootUrl |
| Sitemap parse error (malformed XML) | warn log, fall back to BFS |
| Sitemap empty (`<urlset>` with 0 entries) | fall back to BFS |
| Sitemap-index recursion: nested sitemap fails | warn log, continue with parsed entries |

### 8.4 BFS

| Condition | Action |
|---|---|
| `<a href>` parse error per-page | warn log, still emit SourceItem for that page, skip link extraction |
| Relative URL normalization fails | drop link, debug log |
| Cross-origin link | drop link, debug log |
| Already-visited URL (normalized) | drop link |
| `maxPages` hit | stop frontier enqueue, drain in-flight, warn log |
| `maxDepth` hit | stop enqueuing deeper links, continue current depth |

### 8.5 Convert / write (unchanged)

| Condition | Action |
|---|---|
| HTML parse fails | `failed` |
| Empty body after strip | `empty` |
| Output collision | `CollisionError` at `detectCollisions` phase → exit 2 (pre-write) |
| Write error | `failed` |

### 8.6 Cache

| Condition | Action |
|---|---|
| Cache file corrupt | fall through to fresh fetch, debug log, attempt rewrite |
| Cache dir unwritable | warn log once, continue in no-cache mode for session |
| Disk full mid-write | propagate as fetch error → `failed` |

### 8.7 Exit codes

| Exit | Condition |
|---|---|
| 0 | Normal completion, failed/total ≤ `--fail-threshold` |
| 1 | failed/total > `--fail-threshold` |
| 2 | Pre-walk fatal: source not found / invalid URL / output unwritable / no sitemap discoverable AND BFS seed (rootUrl) fetch fails / `CollisionError`. Robots 404/5xx is NOT fatal (treated as allow-all per §8.2). |

### 8.8 Invariants

- Every URL fetched at most once per run (visited Set).
- robots.txt evaluated once per origin per session (memoized).
- Same-origin gate evaluated against normalized URL (scheme + host + port; default ports collapsed).
- Cache hits counted as one fetch attempt (not duplicated).

## 9. Testing

### 9.1 Unit tests (`tests/unit/`)

| File | Coverage |
|---|---|
| `http/url.test.ts` | normalizeUrl edge cases (relative, protocol-relative, fragments, queries, port collapse, trailing slash); sameOrigin; urlToOutputPath table-driven (6 cases above) |
| `http/fetch.test.ts` | mock server (Node `http`): 200, 304, 404, 5xx-retry, timeout, ETag round-trip, content-type sniff, max-bytes cap, no-cache bypasses store |
| `http/robots.test.ts` | canned `robots.txt` fixtures: empty, Disallow rules, Crawl-delay parsed, Sitemap directives extracted, malformed file, 404 = allow-all |
| `http/sitemap.test.ts` | canned `sitemap.xml` + `sitemap_index.xml` fixtures: flat parse, nested index, empty urlset, malformed XML, gzipped (.xml.gz) |
| `http/crawl.test.ts` | mock HTTP with multi-page fixture: BFS order deterministic, dedup, same-origin gate, maxPages clamp, maxDepth clamp, robots-disallow drop |
| `source.test.ts` | FilesystemSource parity with current walk; HttpSource emits sitemap-first when available, BFS when not; non-html contentType increments skippedCount and skips yield |
| `output.test.ts` | extend existing: ReportEntry.srcUri populated for both filesystem + http; urlToOutputPath collision with filesystem mirror path raises CollisionError |

### 9.2 Integration tests (`tests/integration/`)

| File | Coverage |
|---|---|
| `crawl-e2e.test.ts` | local static server serves 5–10 Sphinx-shaped pages + robots.txt + sitemap.xml. Run `runConvert("http://localhost:PORT/", { output: tmpdir })`. Assert: all pages converted, output mirrors URL paths, report.json well-formed, exit 0 |
| `crawl-bfs-fallback.test.ts` | same fixture, server returns 404 for sitemap.xml. Assert BFS discovers all pages via `<a href>` graph |
| `crawl-robots-deny.test.ts` | fixture with `Disallow: /private/`. Assert `/private/*` URLs skipped, not failed; report total reduced |
| `crawl-cache-304.test.ts` | run twice against same fixture. Second run: server returns 304 for ETag-matching URLs. Assert second-run output identical, cache hits visible in debug log |
| `crawl-fail-threshold.test.ts` | fixture where 30% of pages return 500. Default `--fail-threshold=0.10` → exit 1. `--fail-threshold=1.0` → exit 0 |
| `openapi-url.test.ts` | server serves `openapi.yaml`. `runOpenapi("http://localhost:PORT/openapi.yaml", { output: tmpdir })` produces same output as filesystem load |

### 9.3 Fixture corpus

`tests/fixtures/crawl-site/`:

```
crawl-site/
├── robots.txt           User-agent: *; Crawl-delay: 0; Sitemap: /sitemap.xml
├── sitemap.xml          5–10 URLs
├── index.html           links to /guide/, /api/
├── guide/
│   ├── index.html
│   ├── intro.html
│   └── advanced.html
├── api/
│   ├── index.html
│   └── reference.html
└── private/
    └── secret.html      disallowed by robots
```

Served by `tests/helpers/static-server.ts` (Node `http` + `fs.readFile`): supports ETag from mtime, 304 on `If-None-Match` match, per-path injection of 404 / 500 for failure tests, configurable Crawl-delay. No external network or homelab dependency.

### 9.4 Dogfood (post-merge, manual)

- `https://docs.python.org/3/` (Sphinx, public, has sitemap) — sample 50 pages
- `https://kreuzberg.dev/` — small site, full crawl, verify cache 304 on second run
- Filesystem-vs-URL parity: `wget --mirror` a small site, then `docforge convert` both sources, `diff -r` outputs

### 9.5 Out of scope for tests v1

- JS-rendered sites
- Auth-gated sites
- Compressed transfer encoding (handled transparently by got)
- HTTP/2 / HTTP/3
- External-network smoke tests in CI

## 10. Open questions

None at spec time. All design decisions resolved during brainstorm:

1. Polymorphic `<source>` arg (vs separate `--url` flag or subcommand) — resolved: polymorphic.
2. Sitemap-first with BFS fallback (vs sitemap-only or BFS-only) — resolved: hybrid.
3. Boundary = same-origin + robots.txt — resolved.
4. Cache to `~/.cache/docforge` with ETag — resolved.
5. Concurrency 4 + honor `Crawl-delay` — resolved.
6. No auth in v1 — resolved.
7. URL→path = mirror — resolved.
8. HTML→MD engine stays `@kreuzberg/node` ^4 — resolved.
9. Dep stack: got + sitemapper + @crawlee/utils + p-queue + cacheable-request + @keyv/file + keyv — resolved.

## 11. Follow-ups (separate issues, not this spec)

- Auth support (`--header`, `--netrc`).
- `--engine=crawlee` or `--engine=playwright` for JS-rendered sites.
- `--include` / `--exclude` regex filters on URLs.
- Non-HTTP schemes (`s3://`, `smb://`, `file://`).
- `.gz` / `.xz` HTTP response decompression for non-standard servers.
- Switch HTML→MD engine to `@kreuzberg/html-to-markdown-node` 3.4.0 after benchmark + golden regen.
