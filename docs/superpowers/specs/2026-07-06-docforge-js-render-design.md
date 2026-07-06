# docforge: JS-rendered page support (headless render fallback)

**Issue:** docf-z6g · **Date:** 2026-07-06 · **Target version:** 0.8.0

## Problem

`docforge convert <url>` does a plain HTTP fetch and static HTML parse. Client-rendered
docs sites (SPA / JS-only) return a near-empty HTML shell: extraction yields thin or
empty markdown, and — worse — BFS link discovery (`src/http/crawl.ts` `extractLinks`)
sees zero anchors in the static shell, so the crawl dies at the root page regardless of
what later stages do. A pipeline-level "re-render on empty extraction" retry cannot fix
discovery; rendering must happen at the fetch/crawl layer.

## Goals

- Opt-in headless rendering backend (playwright/chromium) for URL sources.
- `--render <auto|force|off>` on `docforge convert` (absent = `off` = today's behavior).
  - `auto`: static fetch first; a per-page heuristic (near-empty visible text in raw
    HTML) triggers a headless render of that page.
  - `force`: every 200 HTML response is rendered.
- BFS link extraction operates on the rendered DOM, so SPA navigation is discovered.
- All existing guarantees hold unchanged: robots, scopePrefix, maxPages/maxDepth,
  crawl-delay, concurrency, maxBytes, static-response cache.
- Zero new runtime dependencies for the non-render path; playwright is an optional
  peer dependency, imported lazily.

## Non-goals (v1)

- Render output caching (re-runs re-render; static-fetch cache still applies).
- MCP tool exposure (plumbing lands in `runPipeline`, so later exposure is one schema
  field + pass-through).
- Rendering on the llms-index path (llms.txt sites are static by design).
- Configurable heuristic threshold flag.
- JS execution beyond page load (no clicking, scrolling, or pagination interaction).

## CLI surface

```
--render <mode>   render JS pages: auto|force|off (URL source only; requires playwright)
```

- Absent or `off`: no render code loaded, no playwright import.
- Invalid value: exit 2, same pattern as `--llms-full`.
- `--render` given but playwright not importable: exit 2 **before any crawling**, with
  install instructions: `npm i playwright && npx playwright install chromium`.
- Non-URL source + `--render`: warn and ignore (same pattern as `--describe-images`).

## Architecture

Render slots in at the fetch layer as a byte-swap step. A URL passes all existing
filters (robots, scope, visited, budget) exactly as today; only the "get bytes for this
URL" step changes. Traversal, accounting, and output logic never see the difference —
they receive rendered bytes where static bytes would have been.

### New module `src/http/render.ts`

```ts
export interface RenderOptions {
  userAgent: string;
  timeoutMs: number;   // navigation timeout (reuse fetchOptions.timeoutMs = 30s)
  maxBytes: number;
  auth?: { header: string; origin: string };  // same shape as FetchOptions.auth
}

export async function createRenderer(opts: RenderOptions): Promise<Renderer>;
// Lazy `await import("playwright")`. Throws Error with install instructions if missing.
// Does NOT launch the browser yet — launch happens on first render() call.

export class Renderer {
  async render(url: string): Promise<{ bytes: Buffer; contentType: "text/html" }>;
  async close(): Promise<void>;
}

export function looksJsRendered(html: string): boolean;
```

**Renderer behavior:**

- One headless chromium browser, one context. Context user agent = crawl userAgent
  (consistent robots identity).
- Per `render(url)` call: new page → `page.goto(url, { waitUntil: "domcontentloaded",
  timeout: timeoutMs })` → best-effort bounded settle
  `page.waitForLoadState("networkidle", { timeout: 5000 }).catch(() => {})` →
  `page.content()` → close page. The networkidle wait must not hard-fail: sites with
  polling/analytics never go idle.
- Rendered bytes larger than `maxBytes` → throw, same rule as `fetchUrl`.
- Failures throw `FetchError` (imported from `fetch.js`) with message
  `render failed <url>: <cause>` — call sites already catch `FetchError`, zero churn.
- Browser crash recovery: if the browser is found dead on a `render()` call, relaunch
  once and retry that page; a second consecutive crash makes subsequent renders throw
  `FetchError` per page (crawl continues on static semantics, failures counted).
- Auth: when `opts.auth` is set, attach the Authorization header via
  `context.route()` interception **only for requests whose origin equals
  `auth.origin`**. Do not use `setExtraHTTPHeaders` — it would send the credential on
  every request from the context, including cross-origin subresources (CDNs, analytics
  hosts), which violates the origin-scoping invariant that static fetch enforces
  (`fetch.ts` sends the header only when `requestOrigin === auth.origin`).

**Heuristic `looksJsRendered(html)`:**

- Parse with cheerio (existing dependency), remove `script`, `style`, `noscript`,
  `template` elements, take `body` text, collapse whitespace.
- Visible text length < 200 chars → `true`.
- False positives (legitimately tiny pages) cost one wasted render (~1–3s), harmless.
- False negatives (SPA shell with ≥200 chars of boilerplate) are escape-hatched by
  `--render force`. Threshold is a named constant, not a flag (v1).
- `noscript` content ("please enable JavaScript") is stripped before measuring, so such
  pages correctly measure near-empty.

### Choke point `fetchMaybeRender`

```ts
export async function fetchMaybeRender(
  url: string,
  fetchOpts: FetchOptions,
  renderMode: "auto" | "force" | undefined,
  renderer: Renderer | null,
): Promise<FetchResult & { rendered?: boolean }>;
```

Logic:

1. Always `fetchUrl` first (static). This preserves: HTTP status semantics (404/500
   handling), the response cache, and OpenAPI JSON/YAML detection — force-rendering a
   `.json` spec URL through chromium would wrap it in a DOM and corrupt it.
2. If the static fetch succeeded (`fetchUrl` returns only status < 400) with
   `text/html` and mode is `force` → render, return rendered bytes.
3. Same success + `text/html` and mode is `auto` and `looksJsRendered(bytes)` →
   render, return rendered bytes.
4. Otherwise return the static result unchanged.

Error semantics:

- `auto` + render failure: log `warn`, **return static bytes** (best-effort
  enhancement; likely `empty` extraction downstream, but not a hard fail).
- `force` + render failure: throw the `FetchError` (user demanded render; a silent
  static fallback would defeat the intent). Counted `failed`, fail threshold applies.

### Call sites

`fetchUrl` → `fetchMaybeRender` in exactly three places:

| Site | File | Effect |
|------|------|--------|
| BFS crawl worker | `src/http/crawl.ts` | link extraction sees rendered DOM → SPA discovery works |
| sitemap fetch task | `src/source.ts` `iterFromSitemap` | thin sitemap-listed pages render |
| single-page fetch | `src/source.ts` `iter` (singlePage branch) | one-shot URLs render |

llms-full and llms-index paths unchanged.

### Plumbing and lifecycle

- `CrawlOptions += renderMode?: "auto" | "force"` (`src/http/crawl.ts`).
- `CrawlItem += rendered?: boolean` so the BFS path can propagate the flag.
- `runPipeline` (URL branch): when `crawlOptions.renderMode` is set, create the
  renderer and pass it into `HttpSource`; close it in a `finally` around the item loop.
  `RenderOptions` is derived entirely from existing options (`userAgent`, `timeoutMs`,
  `maxBytes`, `auth` all live in `FetchOptions`) — no new CLI plumbing beyond the flag.
  Lifecycle owned in one place; future MCP exposure inherits it.
- `cli.ts`: validate flag; when set, run the lazy-import probe (fail fast, exit 2 with
  instructions) before calling `runPipeline`; thread `renderMode` into `crawlOptions`.
- `HttpSource` constructor takes the optional renderer and hands it to the three call
  sites.

## Data flow (auto mode, BFS example)

1. URL passes robots / scopePrefix / visited / maxPages / maxDepth filters — unchanged,
   all before any fetch.
2. `fetchMaybeRender`: static fetch → 200 HTML, visible text 40 chars →
   `looksJsRendered` true → render → rendered DOM replaces bytes.
3. Crawl extracts links from rendered DOM → frontier grows (SPA nav now visible) → new
   URLs go through the same filters.
4. Item flows to `runPipeline` → `convertHtml` on rendered HTML → normal markdown
   output, title extraction, link rewriting.

Crawl-delay and concurrency: the render call runs inside the existing PQueue task, so
both bounds hold. Browser page concurrency equals crawl concurrency (default 4).

Cache interaction: static responses stay in the got/keyv cache. In auto mode a static
cache hit is still valid — the heuristic runs on cached bytes and the render re-runs
(render output itself is never cached in v1).

Robots note: subresources loaded during render (JS, XHR, CSS) are fetched by the
browser without robots checks — standard browser behavior. Robots continues to govern
the set of page URLs docforge enumerates, which is unchanged. Documented limitation.

## Accounting and reporting

- `PipelineResult += rendered?: number` — pages whose bytes came from the renderer.
  Present only when render mode was set.
- Summary log line when mode set: `render: rendered=N` (rendered pages; render
  failures already surface via existing `failed` count in force mode and `warn` logs in
  auto mode).
- `ReportEntry += rendered?: true` — per-page provenance in `--report-json`.
- `SourceItem += rendered?: boolean` to carry the flag from source to pipeline.

## Error handling summary

| Failure | Mode | Behavior |
|---------|------|----------|
| playwright not installed | any render mode | exit 2 before crawl, install instructions |
| render timeout/crash on a page | auto | warn, use static bytes |
| render timeout/crash on a page | force | `FetchError` → counted failed → threshold |
| browser dead | any | one relaunch+retry; then per-page `FetchError` |
| rendered bytes > maxBytes | any | `FetchError`, same as static |
| non-HTML response (JSON/YAML/md) | any | never rendered, static path |

## Testing

Existing patterns reused: local `node:http` fixture servers (`tests/crawl-e2e.test.ts`),
dependency stubs, CLI exit-code tests.

- `tests/render-heuristic.test.ts` — `looksJsRendered`: SPA shell
  (`<div id="root"></div>` + scripts) → true; real docs fixture → false;
  noscript-only "enable JS" page → true; page with ≥200 chars visible text → false.
- `tests/fetch-maybe-render.test.ts` — stub `Renderer` injected: mode off/undefined →
  renderer never called; auto → called only on near-empty HTML; auto + render throw →
  static bytes returned; force → called for all 200 HTML; force + throw → rejects with
  `FetchError`; JSON response → never called in any mode.
- `tests/crawl-render-discovery.test.ts` — local server serves SPA shell with zero
  static anchors; stub renderer returns DOM with anchors. BFS with `auto` discovers and
  fetches the linked pages; without render mode the corpus is 1 page. This is the
  headline behavioral test.
- `tests/cli-render.test.ts` — flag validation (`auto|force|off` accepted, garbage →
  exit 2); missing-playwright probe failure → exit 2 with install instructions (probe
  injected/mocked).
- `tests/render-live.test.ts` — real playwright against a local server page whose
  content is injected by script at load. Guarded with `describe.skipIf` on playwright
  being importable — skips cleanly where playwright/browsers absent, runs locally.

## Packaging

- `package.json`:
  - `peerDependencies: { "playwright": ">=1.40" }` with
    `peerDependenciesMeta: { "playwright": { "optional": true } }`.
  - `devDependencies += playwright` (for the live test; browser binaries remain a
    manual `npx playwright install chromium`).
- README: new "JS-rendered sites" section — flags, install steps, auto vs force
  semantics, heuristic behavior, known limitations (no render cache, subresource robots
  note).
- Version bump to 0.8.0.

## Risks / open edges

- **networkidle flakiness:** bounded 5s settle instead of hard requirement; worst case
  captures a partially-hydrated DOM — still strictly better than the empty shell.
- **Render cost:** force mode on a 500-page site ≈ 17–25 min. Mitigation: `auto`
  default recommendation in docs; render cache is the designated follow-up if re-run
  pain materializes.
- **Heuristic misses:** threshold constant documented next to the function; `force`
  covers misses.
- **Memory:** one chromium + up to `concurrency` pages. Default concurrency 4 is fine;
  no new flag.
