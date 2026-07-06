# docforge JS-Rendered Page Support Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Opt-in headless-chromium rendering (`--render auto|force`) so client-rendered (SPA) docs sites produce full markdown corpora instead of empty shells.

**Architecture:** Render slots into the fetch layer as a byte-swap: a URL passes all existing filters (robots, scope, budgets) unchanged, then `fetchMaybeRender` optionally replaces static bytes with rendered DOM bytes. BFS link extraction therefore sees rendered anchors and SPA discovery works. New module `src/http/render.ts` owns playwright (lazy import, optional peer dep); `runPipeline` owns renderer lifecycle.

**Tech Stack:** TypeScript ESM, Node ≥20, playwright (optional peer + dev dep), cheerio, got, vitest.

**Spec:** `docs/superpowers/specs/2026-07-06-docforge-js-render-design.md`

## Global Constraints

- Node ≥20, ESM (`"type": "module"`), imports end in `.js`.
- Zero new **runtime** dependencies for the non-render path; playwright imported only inside `src/http/render.ts` via lazy `await import("playwright")` (type-only imports allowed anywhere — they erase).
- `peerDependencies: { "playwright": ">=1.40" }` with `peerDependenciesMeta: { "playwright": { "optional": true } }`; playwright also in `devDependencies`.
- Heuristic threshold: visible body text `< 200` chars → JS-rendered candidate (named constant `JS_RENDERED_TEXT_THRESHOLD`).
- Render failures throw `FetchError` (from `src/http/fetch.js`) — never a new error class.
- `auto` + render failure → warn + fall back to static bytes. `force` + render failure → `FetchError` (counted failed).
- Auth header in browser context only via origin-scoped `context.route()` interception — NEVER `setExtraHTTPHeaders` (would leak the credential to cross-origin subresources).
- llms-full / llms-index paths never render. Non-HTML responses never render.
- All tests must pass without chromium installed (live suite skips itself).
- Run tests with `npm test` (runs `tsc` first via pretest). Single file: `npx vitest run tests/<file>.test.ts`.
- Commit after every task. Conventional commits, imperative subject.

---

### Task 1: `looksJsRendered` heuristic

**Files:**
- Create: `src/http/render.ts`
- Test: `tests/render-heuristic.test.ts`

**Interfaces:**
- Consumes: cheerio `load` (existing dependency, same import style as `src/http/crawl.ts:2`).
- Produces: `export const JS_RENDERED_TEXT_THRESHOLD = 200` and `export function looksJsRendered(html: string): boolean` — Task 3 calls `looksJsRendered`.

- [ ] **Step 1: Write the failing test**

Create `tests/render-heuristic.test.ts`:

```ts
import { describe, expect, test } from "vitest";
import { looksJsRendered } from "../src/http/render.js";

const SPA_SHELL = `<!doctype html><html><head><title>Docs</title>
<script src="/static/js/main.7c2f.js"></script>
<style>body{margin:0}</style></head>
<body><div id="root"></div>
<noscript>You need to enable JavaScript to run this app.</noscript>
</body></html>`;

const STATIC_PAGE = `<!doctype html><html><body><main><h1>Guide</h1>
<p>${"Real documentation content about configuring the frobnicator. ".repeat(6)}</p>
</main></body></html>`;

describe("looksJsRendered", () => {
  test("SPA shell (empty root div + scripts) → true", () => {
    expect(looksJsRendered(SPA_SHELL)).toBe(true);
  });

  test("real docs page with body text → false", () => {
    expect(looksJsRendered(STATIC_PAGE)).toBe(false);
  });

  test("noscript-only text does not count as visible content", () => {
    const html = `<html><body><noscript>${"enable javascript please ".repeat(20)}</noscript></body></html>`;
    expect(looksJsRendered(html)).toBe(true);
  });

  test("script/style text does not count as visible content", () => {
    const html = `<html><body><script>${"var x = 1; ".repeat(50)}</script><style>${".a{color:red} ".repeat(30)}</style></body></html>`;
    expect(looksJsRendered(html)).toBe(true);
  });

  test("boundary: 199 visible chars → true, 200 → false", () => {
    expect(looksJsRendered(`<html><body>${"a".repeat(199)}</body></html>`)).toBe(true);
    expect(looksJsRendered(`<html><body>${"a".repeat(200)}</body></html>`)).toBe(false);
  });
});
```

- [ ] **Step 2: Run test to verify it fails**

Run: `npx vitest run tests/render-heuristic.test.ts`
Expected: FAIL — `Cannot find module '../src/http/render.js'` (or tsc pretest error if using `npm test`; use the direct vitest command here).

- [ ] **Step 3: Write minimal implementation**

Create `src/http/render.ts`:

```ts
import { load as loadHtml } from "cheerio";

export const JS_RENDERED_TEXT_THRESHOLD = 200;

/**
 * Cheap signal that a page is a client-rendered shell: after dropping
 * script/style/noscript/template, almost no visible body text remains.
 * False positives (legitimately tiny pages) cost one wasted render.
 * False negatives are escape-hatched by --render force.
 */
export function looksJsRendered(html: string): boolean {
  const $ = loadHtml(html);
  $("script, style, noscript, template").remove();
  const text = $("body").text().replace(/\s+/g, " ").trim();
  return text.length < JS_RENDERED_TEXT_THRESHOLD;
}
```

- [ ] **Step 4: Run test to verify it passes**

Run: `npx vitest run tests/render-heuristic.test.ts`
Expected: PASS (5 tests).

- [ ] **Step 5: Typecheck and commit**

```bash
npm run typecheck
git add src/http/render.ts tests/render-heuristic.test.ts
git commit -m "feat(render): looksJsRendered heuristic for SPA shell detection (docf-z6g)"
```

---

### Task 2: `Renderer` class, `createRenderer`, `probeRenderAvailable`, packaging

**Files:**
- Modify: `src/http/render.ts` (append)
- Modify: `package.json` (peer + dev deps)
- Test: `tests/render-live.test.ts` (self-skipping when chromium unavailable)

**Interfaces:**
- Consumes: `FetchError` from `src/http/fetch.js` (constructor `(message: string, status: number | null = null, cause?: unknown)`); `log` from `src/log.js` (`log("warn", msg)`).
- Produces (used by Tasks 3, 6, 7):
  - `export interface RenderOptions { userAgent: string; timeoutMs: number; maxBytes: number; auth?: { header: string; origin: string } }`
  - `export interface RenderResult { bytes: Buffer; contentType: "text/html" }`
  - `export interface PageRenderer { render(url: string): Promise<RenderResult> }`
  - `export interface RendererHandle extends PageRenderer { close(): Promise<void> }`
  - `export class Renderer implements RendererHandle`
  - `export async function createRenderer(opts: RenderOptions): Promise<Renderer>`
  - `export async function probeRenderAvailable(): Promise<void>`
  - `export const RENDER_INSTALL_HINT: string`

- [ ] **Step 1: Install playwright as dev dependency and declare optional peer**

```bash
npm i -D playwright
npx playwright install chromium || true   # best effort; live tests skip if absent
```

Then edit `package.json` — add after the `"devDependencies"` block (sibling keys):

```json
  "peerDependencies": {
    "playwright": ">=1.40"
  },
  "peerDependenciesMeta": {
    "playwright": {
      "optional": true
    }
  }
```

Run: `npm install` (refresh lockfile), then `npm run typecheck` — expected clean.

- [ ] **Step 2: Write the live test (self-skipping)**

Create `tests/render-live.test.ts`:

```ts
import { afterAll, beforeAll, describe, expect, test } from "vitest";
import { createServer, type Server } from "node:http";
import { AddressInfo } from "node:net";
import { FetchError } from "../src/http/fetch.js";
import { createRenderer } from "../src/http/render.js";

// Probe once at module load: playwright importable AND chromium launchable.
let available = false;
try {
  const pw = await import("playwright");
  const b = await pw.chromium.launch({ headless: true });
  await b.close();
  available = true;
} catch {
  // playwright or chromium missing — whole suite skips
}

const SHELL = `<!doctype html><html><head><script>
document.addEventListener("DOMContentLoaded", () => {
  document.getElementById("root").innerHTML =
    "<h1>Hydrated</h1><p>content injected by script at load time</p><a href=\\"/next\\">next</a>";
});
</script></head><body><div id="root"></div></body></html>`;

describe.skipIf(!available)("Renderer (live chromium)", () => {
  let server: Server;
  let base: string;
  let origin: string;
  const mainAuth: Array<string | undefined> = [];

  let xServer: Server; // cross-origin (different port = different origin)
  let xBase: string;
  const xAuth: Array<string | undefined> = [];

  beforeAll(async () => {
    server = createServer((req, res) => {
      mainAuth.push(req.headers.authorization);
      if (req.url === "/shell") {
        res.writeHead(200, { "Content-Type": "text/html" });
        res.end(SHELL);
      } else if (req.url === "/with-img") {
        res.writeHead(200, { "Content-Type": "text/html" });
        res.end(`<html><body><p>page</p><img src="${xBase}/pixel.png"></body></html>`);
      } else {
        res.writeHead(404);
        res.end();
      }
    });
    xServer = createServer((req, res) => {
      xAuth.push(req.headers.authorization);
      res.writeHead(200, { "Content-Type": "image/png" });
      res.end(Buffer.from([0x89, 0x50, 0x4e, 0x47]));
    });
    await new Promise<void>((r) => xServer.listen(0, r));
    xBase = `http://localhost:${(xServer.address() as AddressInfo).port}`;
    await new Promise<void>((r) => server.listen(0, r));
    base = `http://localhost:${(server.address() as AddressInfo).port}`;
    origin = base;
  });

  afterAll(async () => {
    await new Promise<void>((r) => server.close(() => r()));
    await new Promise<void>((r) => xServer.close(() => r()));
  });

  test("returns hydrated DOM including script-injected anchors", async () => {
    const renderer = await createRenderer({
      userAgent: "docforge-test/0",
      timeoutMs: 15_000,
      maxBytes: 10_000_000,
    });
    try {
      const res = await renderer.render(`${base}/shell`);
      const html = res.bytes.toString("utf8");
      expect(res.contentType).toBe("text/html");
      expect(html).toContain("Hydrated");
      expect(html).toContain('href="/next"');
    } finally {
      await renderer.close();
    }
  });

  test("rendered bytes over maxBytes throw FetchError", async () => {
    const renderer = await createRenderer({
      userAgent: "docforge-test/0",
      timeoutMs: 15_000,
      maxBytes: 10,
    });
    try {
      await expect(renderer.render(`${base}/shell`)).rejects.toBeInstanceOf(FetchError);
    } finally {
      await renderer.close();
    }
  });

  test("auth header sent only to matching origin, not cross-origin subresources", async () => {
    mainAuth.length = 0;
    xAuth.length = 0;
    const renderer = await createRenderer({
      userAgent: "docforge-test/0",
      timeoutMs: 15_000,
      maxBytes: 10_000_000,
      auth: { header: "Bearer secret-token", origin },
    });
    try {
      await renderer.render(`${base}/with-img`);
      expect(mainAuth.some((h) => h === "Bearer secret-token")).toBe(true);
      expect(xAuth.every((h) => h === undefined)).toBe(true);
      expect(xAuth.length).toBeGreaterThan(0); // the pixel WAS fetched
    } finally {
      await renderer.close();
    }
  });

  test("relaunches once after browser death and serves the page", async () => {
    const renderer = await createRenderer({
      userAgent: "docforge-test/0",
      timeoutMs: 15_000,
      maxBytes: 10_000_000,
    });
    try {
      await renderer.render(`${base}/shell`); // first launch
      // simulate crash: reach into the private browser handle and kill it
      const inner = (renderer as unknown as { browser: { close(): Promise<void> } }).browser;
      await inner.close();
      const res = await renderer.render(`${base}/shell`); // must relaunch + retry
      expect(res.bytes.toString("utf8")).toContain("Hydrated");
    } finally {
      await renderer.close();
    }
  });
});
```

- [ ] **Step 3: Run test to verify it fails**

Run: `npx vitest run tests/render-live.test.ts`
Expected: FAIL with `createRenderer` not exported (if chromium available) OR suite reported as skipped (chromium absent). If skipped, proceed — Step 5 re-runs after implementation and the other suites still gate correctness.

- [ ] **Step 4: Implement Renderer**

Append to `src/http/render.ts` (below the heuristic; add the new imports at the top of the file):

```ts
import { FetchError } from "./fetch.js";
import { log } from "../log.js";
import type { Browser, BrowserContext } from "playwright";
```

```ts
export interface RenderOptions {
  userAgent: string;
  timeoutMs: number; // navigation timeout (reuse fetchOptions.timeoutMs)
  maxBytes: number;
  auth?: { header: string; origin: string }; // same shape as FetchOptions.auth
}

export interface RenderResult {
  bytes: Buffer;
  contentType: "text/html";
}

export interface PageRenderer {
  render(url: string): Promise<RenderResult>;
}

export interface RendererHandle extends PageRenderer {
  close(): Promise<void>;
}

export const RENDER_INSTALL_HINT =
  "--render requires playwright: npm i playwright && npx playwright install chromium";

type PlaywrightModule = typeof import("playwright");

async function importPlaywright(): Promise<PlaywrightModule> {
  try {
    return await import("playwright");
  } catch (e) {
    throw new Error(RENDER_INSTALL_HINT, { cause: e });
  }
}

/** Fail-fast probe for the CLI: throws with install instructions when playwright is absent. */
export async function probeRenderAvailable(): Promise<void> {
  await importPlaywright();
}

export async function createRenderer(opts: RenderOptions): Promise<Renderer> {
  const pw = await importPlaywright();
  return new Renderer(pw, opts);
}

const NETWORKIDLE_SETTLE_MS = 5_000;

export class Renderer implements RendererHandle {
  private browser: Browser | null = null;
  private context: BrowserContext | null = null;
  private relaunchBudget = 1; // one relaunch per consecutive-crash streak

  constructor(
    private readonly pw: PlaywrightModule,
    private readonly opts: RenderOptions,
  ) {}

  private async getContext(): Promise<BrowserContext> {
    if (this.context && this.browser?.isConnected()) return this.context;
    if (this.browser) await this.browser.close().catch(() => {});
    this.browser = await this.pw.chromium.launch({ headless: true });
    this.context = await this.browser.newContext({ userAgent: this.opts.userAgent });
    const auth = this.opts.auth;
    if (auth) {
      // Origin-scoped auth via route interception. setExtraHTTPHeaders would send
      // the credential on EVERY request from the context, including cross-origin
      // subresources — same invariant as fetch.ts (header only when origin matches).
      await this.context.route("**/*", async (route) => {
        let origin = "";
        try {
          origin = new URL(route.request().url()).origin;
        } catch {
          // data:/about: etc — pass through untouched
        }
        if (origin === auth.origin) {
          await route.continue({
            headers: { ...route.request().headers(), authorization: auth.header },
          });
        } else {
          await route.continue();
        }
      });
    }
    return this.context;
  }

  async render(url: string): Promise<RenderResult> {
    try {
      const result = await this.renderOnce(url);
      this.relaunchBudget = 1; // success resets the streak
      return result;
    } catch (e) {
      if (e instanceof FetchError) throw e; // e.g. maxBytes — not a crash
      const browserDead = this.browser !== null && !this.browser.isConnected();
      if (browserDead && this.relaunchBudget > 0) {
        this.relaunchBudget -= 1;
        this.context = null;
        log("warn", `render browser died, relaunching for ${url}`);
        try {
          const result = await this.renderOnce(url);
          this.relaunchBudget = 1;
          return result;
        } catch (e2) {
          throw toRenderFetchError(url, e2);
        }
      }
      throw toRenderFetchError(url, e);
    }
  }

  private async renderOnce(url: string): Promise<RenderResult> {
    const context = await this.getContext();
    const page = await context.newPage();
    try {
      await page.goto(url, { waitUntil: "domcontentloaded", timeout: this.opts.timeoutMs });
      // Bounded settle: polling/analytics sites never reach networkidle — best effort.
      await page
        .waitForLoadState("networkidle", { timeout: NETWORKIDLE_SETTLE_MS })
        .catch(() => {});
      const html = await page.content();
      const bytes = Buffer.from(html, "utf8");
      if (bytes.length > this.opts.maxBytes) {
        throw new FetchError(
          `render body ${bytes.length} bytes exceeds maxBytes ${this.opts.maxBytes} for ${url}`,
        );
      }
      return { bytes, contentType: "text/html" };
    } finally {
      await page.close().catch(() => {});
    }
  }

  async close(): Promise<void> {
    if (this.browser) await this.browser.close().catch(() => {});
    this.browser = null;
    this.context = null;
  }
}

function toRenderFetchError(url: string, e: unknown): FetchError {
  if (e instanceof FetchError) return e;
  const msg = e instanceof Error ? e.message : String(e);
  return new FetchError(`render failed ${url}: ${msg}`, null, e);
}
```

Note: `renderOnce` has NO catch block (only `finally`) — generic errors must reach `render()` raw so the browser-dead relaunch check can run.

- [ ] **Step 5: Run tests**

Run: `npx vitest run tests/render-live.test.ts tests/render-heuristic.test.ts`
Expected: heuristic PASS; live suite PASS (4 tests) if chromium installed, otherwise "skipped". Run `npm run typecheck` — clean.

- [ ] **Step 6: Commit**

```bash
git add src/http/render.ts tests/render-live.test.ts package.json package-lock.json
git commit -m "feat(render): Renderer with lazy playwright, origin-scoped auth, crash relaunch (docf-z6g)"
```

---

### Task 3: `fetchMaybeRender` choke point

**Files:**
- Modify: `src/http/render.ts` (append)
- Test: `tests/fetch-maybe-render.test.ts`

**Interfaces:**
- Consumes: `fetchUrl`, `FetchError`, `FetchOptions`, `FetchResult` from `./fetch.js`; `looksJsRendered`, `PageRenderer`, `RenderResult` from Task 1/2.
- Produces (used by Tasks 4, 5):
  - `export type RenderMode = "auto" | "force"`
  - `export async function fetchMaybeRender(url: string, fetchOpts: FetchOptions, renderMode: RenderMode | undefined, renderer: PageRenderer | null): Promise<FetchResult & { rendered?: boolean }>`

- [ ] **Step 1: Write the failing test**

Create `tests/fetch-maybe-render.test.ts`:

```ts
import { afterAll, beforeAll, describe, expect, test } from "vitest";
import { createServer, type Server } from "node:http";
import { AddressInfo } from "node:net";
import { FetchError, type FetchOptions } from "../src/http/fetch.js";
import { fetchMaybeRender, type RenderResult } from "../src/http/render.js";

let server: Server;
let base: string;
let pages: Record<string, { body: string; type?: string }> = {};

beforeAll(async () => {
  server = createServer((req, res) => {
    const entry = pages[req.url ?? ""];
    if (!entry) {
      res.writeHead(404);
      res.end();
      return;
    }
    res.writeHead(200, { "Content-Type": entry.type ?? "text/html" });
    res.end(entry.body);
  });
  await new Promise<void>((r) => server.listen(0, r));
  base = `http://localhost:${(server.address() as AddressInfo).port}`;
});

afterAll(async () => {
  await new Promise<void>((r) => server.close(() => r()));
});

const SHELL = `<html><body><div id="root"></div><script src="/x.js"></script></body></html>`;
const RICH = `<html><body><main>${"real static documentation content here ".repeat(10)}</main></body></html>`;

function fetchOpts(): FetchOptions {
  return { userAgent: "docforge-test/0", timeoutMs: 1_000, maxBytes: 1_000_000, cacheDir: null };
}

function stubRenderer(html = "<html><body><h1>Rendered</h1></body></html>") {
  const calls: string[] = [];
  return {
    calls,
    render: async (url: string): Promise<RenderResult> => {
      calls.push(url);
      return { bytes: Buffer.from(html, "utf8"), contentType: "text/html" };
    },
  };
}

function failingRenderer() {
  const calls: string[] = [];
  return {
    calls,
    render: async (url: string): Promise<RenderResult> => {
      calls.push(url);
      throw new Error("boom");
    },
  };
}

describe("fetchMaybeRender", () => {
  test("mode undefined → static bytes, renderer never called", async () => {
    pages = { "/p": { body: SHELL } };
    const stub = stubRenderer();
    const res = await fetchMaybeRender(`${base}/p`, fetchOpts(), undefined, stub);
    expect(res.bytes.toString("utf8")).toBe(SHELL);
    expect(res.rendered).toBeUndefined();
    expect(stub.calls).toEqual([]);
  });

  test("auto + rich static page → not rendered", async () => {
    pages = { "/p": { body: RICH } };
    const stub = stubRenderer();
    const res = await fetchMaybeRender(`${base}/p`, fetchOpts(), "auto", stub);
    expect(res.bytes.toString("utf8")).toBe(RICH);
    expect(stub.calls).toEqual([]);
  });

  test("auto + shell page → rendered bytes, rendered flag, one call", async () => {
    pages = { "/p": { body: SHELL } };
    const stub = stubRenderer();
    const res = await fetchMaybeRender(`${base}/p`, fetchOpts(), "auto", stub);
    expect(res.bytes.toString("utf8")).toContain("Rendered");
    expect(res.rendered).toBe(true);
    expect(stub.calls).toEqual([`${base}/p`]);
  });

  test("auto + render failure → static bytes fallback, no throw", async () => {
    pages = { "/p": { body: SHELL } };
    const stub = failingRenderer();
    const res = await fetchMaybeRender(`${base}/p`, fetchOpts(), "auto", stub);
    expect(res.bytes.toString("utf8")).toBe(SHELL);
    expect(res.rendered).toBeUndefined();
    expect(stub.calls.length).toBe(1);
  });

  test("force + rich page → rendered anyway", async () => {
    pages = { "/p": { body: RICH } };
    const stub = stubRenderer();
    const res = await fetchMaybeRender(`${base}/p`, fetchOpts(), "force", stub);
    expect(res.rendered).toBe(true);
    expect(stub.calls.length).toBe(1);
  });

  test("force + render failure → rejects with FetchError", async () => {
    pages = { "/p": { body: SHELL } };
    const stub = failingRenderer();
    await expect(
      fetchMaybeRender(`${base}/p`, fetchOpts(), "force", stub),
    ).rejects.toBeInstanceOf(FetchError);
  });

  test("non-HTML response never rendered even in force mode", async () => {
    pages = { "/spec.json": { body: '{"openapi":"3.0.0"}', type: "application/json" } };
    const stub = stubRenderer();
    const res = await fetchMaybeRender(`${base}/spec.json`, fetchOpts(), "force", stub);
    expect(res.bytes.toString("utf8")).toBe('{"openapi":"3.0.0"}');
    expect(res.rendered).toBeUndefined();
    expect(stub.calls).toEqual([]);
  });
});
```

- [ ] **Step 2: Run test to verify it fails**

Run: `npx vitest run tests/fetch-maybe-render.test.ts`
Expected: FAIL — `fetchMaybeRender` not exported.

- [ ] **Step 3: Implement**

Append to `src/http/render.ts` (extend the existing `./fetch.js` import to also pull `fetchUrl`, `FetchOptions`, `FetchResult`):

```ts
import { FetchError, fetchUrl, type FetchOptions, type FetchResult } from "./fetch.js";
```

```ts
export type RenderMode = "auto" | "force";

/**
 * Static fetch first, then optionally swap in rendered bytes.
 * Fetch-first preserves HTTP status semantics, the response cache, and
 * OpenAPI JSON/YAML detection (rendering a .json URL would corrupt it).
 * Only successful (fetchUrl returns only status < 400) text/html responses render.
 */
export async function fetchMaybeRender(
  url: string,
  fetchOpts: FetchOptions,
  renderMode: RenderMode | undefined,
  renderer: PageRenderer | null,
): Promise<FetchResult & { rendered?: boolean }> {
  const res = await fetchUrl(url, fetchOpts);
  if (!renderMode || !renderer) return res;
  if (!/^text\/html/i.test(res.contentType)) return res;
  if (renderMode === "auto" && !looksJsRendered(res.bytes.toString("utf8"))) return res;
  try {
    const rendered = await renderer.render(url);
    return { ...res, bytes: rendered.bytes, contentType: rendered.contentType, rendered: true };
  } catch (e) {
    if (renderMode === "auto") {
      log("warn", `render failed for ${url}, falling back to static bytes: ${(e as Error).message}`);
      return res;
    }
    throw e instanceof FetchError ? e : toRenderFetchError(url, e);
  }
}
```

- [ ] **Step 4: Run test to verify it passes**

Run: `npx vitest run tests/fetch-maybe-render.test.ts`
Expected: PASS (7 tests). Run `npm run typecheck` — clean.

- [ ] **Step 5: Commit**

```bash
git add src/http/render.ts tests/fetch-maybe-render.test.ts
git commit -m "feat(render): fetchMaybeRender choke point with auto/force semantics (docf-z6g)"
```

---

### Task 4: BFS crawl integration — rendered DOM feeds link discovery

**Files:**
- Modify: `src/http/crawl.ts`
- Test: `tests/crawl-render-discovery.test.ts`

**Interfaces:**
- Consumes: `fetchMaybeRender`, `PageRenderer`, `RenderMode` from `./render.js`.
- Produces (used by Task 5):
  - `CrawlOptions` gains `renderMode?: RenderMode`
  - `CrawlItem` gains `rendered?: boolean`
  - `crawlBfs(rootUrl, robots, fetchOpts, crawlOpts, renderer: PageRenderer | null = null)` — new optional 5th parameter.

- [ ] **Step 1: Write the failing test**

Create `tests/crawl-render-discovery.test.ts`:

```ts
import { afterAll, beforeAll, describe, expect, test } from "vitest";
import { createServer, type Server } from "node:http";
import { AddressInfo } from "node:net";
import { crawlBfs, type CrawlItem, type CrawlOptions } from "../src/http/crawl.js";
import type { Robots } from "../src/http/robots.js";
import type { FetchOptions } from "../src/http/fetch.js";
import type { PageRenderer, RenderResult } from "../src/http/render.js";

let server: Server;
let port: number;
let pages: Record<string, string> = {};

beforeAll(async () => {
  server = createServer((req, res) => {
    const body = pages[req.url ?? ""];
    if (body === undefined) {
      res.writeHead(404);
      res.end();
      return;
    }
    res.writeHead(200, { "Content-Type": "text/html" });
    res.end(body);
  });
  await new Promise<void>((r) => server.listen(0, r));
  port = (server.address() as AddressInfo).port;
});

afterAll(async () => {
  await new Promise<void>((r) => server.close(() => r()));
});

const allowAll: Robots = {
  isAllowed: () => true,
  getCrawlDelay: () => 0,
  getSitemaps: () => [],
};

function fetchOpts(): FetchOptions {
  return { userAgent: "docforge-test/0", timeoutMs: 1_000, maxBytes: 1_000_000, cacheDir: null };
}

function crawlOpts(renderMode?: "auto" | "force"): CrawlOptions {
  return {
    maxPages: 100,
    maxDepth: 10,
    concurrency: 1,
    userAgent: "docforge-test/0",
    llmsFullMode: "off",
    ...(renderMode ? { renderMode } : {}),
  };
}

const SHELL = `<html><body><div id="root"></div><script src="/app.js"></script></body></html>`;
const RICH = `<html><body>${"leaf page static content ".repeat(15)}</body></html>`;

// Stub: rendering the shell root reveals nav anchors; any other URL renders to a plain leaf.
function stubRenderer(rootPath: string) {
  const calls: string[] = [];
  const renderer: PageRenderer & { calls: string[] } = {
    calls,
    render: async (url: string): Promise<RenderResult> => {
      calls.push(url);
      const html =
        new URL(url).pathname === rootPath
          ? `<html><body><nav><a href="/a">a</a><a href="/b">b</a></nav><p>${"hydrated home ".repeat(20)}</p></body></html>`
          : `<html><body>${"hydrated leaf ".repeat(20)}</body></html>`;
      return { bytes: Buffer.from(html, "utf8"), contentType: "text/html" };
    },
  };
  return renderer;
}

async function collect(
  renderMode: "auto" | "force" | undefined,
  renderer: PageRenderer | null,
): Promise<CrawlItem[]> {
  const items: CrawlItem[] = [];
  for await (const item of crawlBfs(
    `http://localhost:${port}/`,
    allowAll,
    fetchOpts(),
    crawlOpts(renderMode),
    renderer,
  )) {
    items.push(item);
  }
  return items.sort((x, y) => x.url.localeCompare(y.url));
}

describe("crawlBfs with renderer", () => {
  test("SPA shell without render mode: crawl dies at root (baseline)", async () => {
    pages = { "/": SHELL, "/a": RICH, "/b": RICH };
    const items = await collect(undefined, null);
    expect(items.map((i) => i.url)).toEqual([`http://localhost:${port}/`]);
  });

  test("auto mode: rendered root reveals links, BFS discovers them", async () => {
    pages = { "/": SHELL, "/a": RICH, "/b": RICH };
    const stub = stubRenderer("/");
    const items = await collect("auto", stub);
    expect(items.map((i) => i.url)).toEqual([
      `http://localhost:${port}/`,
      `http://localhost:${port}/a`,
      `http://localhost:${port}/b`,
    ]);
    const root = items.find((i) => i.url === `http://localhost:${port}/`)!;
    const leaf = items.find((i) => i.url === `http://localhost:${port}/a`)!;
    expect(root.rendered).toBe(true);
    expect(leaf.rendered).toBeUndefined(); // rich static leaf → heuristic negative
    expect(stub.calls).toEqual([`http://localhost:${port}/`]);
  });

  test("force mode: every HTML page rendered", async () => {
    pages = { "/": SHELL, "/a": RICH, "/b": RICH };
    const stub = stubRenderer("/");
    const items = await collect("force", stub);
    expect(items.length).toBe(3);
    expect(items.every((i) => i.rendered === true)).toBe(true);
    expect(stub.calls.length).toBe(3);
  });
});
```

- [ ] **Step 2: Run test to verify it fails**

Run: `npx vitest run tests/crawl-render-discovery.test.ts`
Expected: FAIL — `crawlBfs` accepts 4 arguments / `renderMode` not in `CrawlOptions` (tsc via vitest) or items lack rendered flag.

- [ ] **Step 3: Implement crawl changes**

In `src/http/crawl.ts`:

Replace the fetch import line (line 3):

```ts
import { FetchError, type FetchOptions } from "./fetch.js";
import { fetchMaybeRender, type PageRenderer, type RenderMode } from "./render.js";
```

(`fetchUrl` is no longer imported — the direct call is replaced below.)

Extend `CrawlOptions` and `CrawlItem`:

```ts
export interface CrawlOptions {
  maxPages: number;
  maxDepth: number;
  concurrency: number;
  userAgent: string;
  llmsFullMode: "auto" | "force" | "off";
  llmsIndexMode?: "auto" | "force" | "off";
  singlePage?: boolean;
  excludeHosts?: string[];
  scopePrefix?: string; // path prefix (e.g. "/docs/"); undefined = unrestricted
  renderMode?: RenderMode; // headless render: "auto" (heuristic) | "force" (all HTML)
}

export interface CrawlItem {
  url: string;
  bytes: Buffer;
  contentType: string;
  error?: string;
  rendered?: boolean; // bytes came from the headless renderer
}
```

Change the `crawlBfs` signature and the fetch call inside the batch worker:

```ts
export async function* crawlBfs(
  rootUrl: string,
  robots: Robots,
  fetchOpts: FetchOptions,
  crawlOpts: CrawlOptions,
  renderer: PageRenderer | null = null,
): AsyncIterable<CrawlItem> {
```

Inside the worker, replace:

```ts
          const res = await fetchUrl(entry.url, fetchOpts);
          item = { url: entry.url, bytes: res.bytes, contentType: res.contentType };
```

with:

```ts
          const res = await fetchMaybeRender(entry.url, fetchOpts, crawlOpts.renderMode, renderer);
          item = {
            url: entry.url,
            bytes: res.bytes,
            contentType: res.contentType,
            ...(res.rendered ? { rendered: true } : {}),
          };
```

Everything else (link extraction, filters, budgets) is untouched — link extraction now operates on rendered bytes automatically.

- [ ] **Step 4: Run tests**

Run: `npx vitest run tests/crawl-render-discovery.test.ts tests/http-crawl.test.ts`
Expected: new suite PASS (3 tests); existing crawl suite still PASS (renderer param optional). Run `npm run typecheck` — clean.

- [ ] **Step 5: Commit**

```bash
git add src/http/crawl.ts tests/crawl-render-discovery.test.ts
git commit -m "feat(crawl): render-aware BFS — rendered DOM feeds link discovery (docf-z6g)"
```

---

### Task 5: HttpSource integration — singlePage, sitemap, BFS propagation

**Files:**
- Modify: `src/source.ts`
- Test: `tests/source-render.test.ts`

**Interfaces:**
- Consumes: `fetchMaybeRender`, `PageRenderer` from `./http/render.js`; Task 4's `crawlBfs` 5th param and `CrawlItem.rendered`.
- Produces (used by Task 6):
  - `SourceItem` gains `rendered?: boolean`
  - `HttpSource` constructor gains optional 4th param: `new HttpSource(rootUrl, fetchOpts, crawlOpts, renderer: PageRenderer | null = null)`.

- [ ] **Step 1: Write the failing test**

Create `tests/source-render.test.ts`:

```ts
import { afterAll, beforeAll, beforeEach, describe, expect, test } from "vitest";
import { createServer, type Server } from "node:http";
import { AddressInfo } from "node:net";
import { HttpSource, type SourceItem } from "../src/source.js";
import type { FetchOptions } from "../src/http/fetch.js";
import type { CrawlOptions } from "../src/http/crawl.js";
import type { PageRenderer, RenderResult } from "../src/http/render.js";
import { __clearRobotsCache } from "../src/http/robots.js";

let server: Server;
let base: string;
let pages: Record<string, { body: string; type?: string }> = {};

beforeAll(async () => {
  server = createServer((req, res) => {
    const entry = pages[req.url ?? ""];
    if (!entry) {
      res.writeHead(404);
      res.end();
      return;
    }
    res.writeHead(200, { "Content-Type": entry.type ?? "text/html" });
    res.end(entry.body);
  });
  await new Promise<void>((r) => server.listen(0, r));
  base = `http://localhost:${(server.address() as AddressInfo).port}`;
});

afterAll(async () => {
  await new Promise<void>((r) => server.close(() => r()));
});

beforeEach(() => {
  __clearRobotsCache();
});

const SHELL = `<html><body><div id="root"></div><script src="/app.js"></script></body></html>`;

function fetchOpts(): FetchOptions {
  return { userAgent: "docforge-test/0", timeoutMs: 1_000, maxBytes: 1_000_000, cacheDir: null };
}

function crawlOpts(over: Partial<CrawlOptions> = {}): CrawlOptions {
  return {
    maxPages: 100,
    maxDepth: 10,
    concurrency: 1,
    userAgent: "docforge-test/0",
    llmsFullMode: "off",
    llmsIndexMode: "off",
    renderMode: "auto",
    ...over,
  };
}

function stubRenderer(html = `<html><body><h1>Hydrated</h1><p>${"rendered text ".repeat(20)}</p></body></html>`) {
  const calls: string[] = [];
  const r: PageRenderer & { calls: string[] } = {
    calls,
    render: async (url: string): Promise<RenderResult> => {
      calls.push(url);
      return { bytes: Buffer.from(html, "utf8"), contentType: "text/html" };
    },
  };
  return r;
}

async function collect(src: HttpSource): Promise<SourceItem[]> {
  const items: SourceItem[] = [];
  for await (const item of src.iter()) items.push(item);
  return items;
}

describe("HttpSource with renderer", () => {
  test("singlePage: shell page comes back rendered", async () => {
    pages = { "/p": { body: SHELL } };
    const stub = stubRenderer();
    const src = new HttpSource(`${base}/p`, fetchOpts(), crawlOpts({ singlePage: true }), stub);
    const items = await collect(src);
    expect(items.length).toBe(1);
    expect(items[0].rendered).toBe(true);
    expect(items[0].bytes.toString("utf8")).toContain("Hydrated");
    expect(stub.calls).toEqual([`${base}/p`]);
  });

  test("singlePage: OpenAPI JSON is never rendered, stays openapi kind", async () => {
    pages = { "/spec.json": { body: '{"openapi":"3.0.3","info":{"title":"t","version":"1"},"paths":{}}', type: "application/json" } };
    const stub = stubRenderer();
    const src = new HttpSource(
      `${base}/spec.json`,
      fetchOpts(),
      crawlOpts({ singlePage: true, renderMode: "force" }),
      stub,
    );
    const items = await collect(src);
    expect(items.length).toBe(1);
    expect(items[0].kind).toBe("openapi");
    expect(items[0].rendered).toBeUndefined();
    expect(stub.calls).toEqual([]);
  });

  test("sitemap path: shell pages listed in sitemap come back rendered", async () => {
    pages = {
      "/sitemap.xml": {
        body: `<?xml version="1.0" encoding="UTF-8"?>
<urlset xmlns="http://www.sitemaps.org/schemas/sitemap/0.9">
  <url><loc>${base}/docs/page</loc></url>
</urlset>`,
        type: "application/xml",
      },
      "/docs/page": { body: SHELL },
    };
    const stub = stubRenderer();
    const src = new HttpSource(`${base}/`, fetchOpts(), crawlOpts(), stub);
    const items = await collect(src);
    expect(items.length).toBe(1);
    expect(items[0].srcUri).toBe(`${base}/docs/page`);
    expect(items[0].rendered).toBe(true);
    expect(items[0].bytes.toString("utf8")).toContain("Hydrated");
  });

  test("BFS fallback path propagates rendered flag", async () => {
    // no sitemap.xml → BFS from root; root is a shell; stub reveals no links (leaf render)
    pages = { "/": { body: SHELL } };
    const stub = stubRenderer();
    const src = new HttpSource(`${base}/`, fetchOpts(), crawlOpts(), stub);
    const items = await collect(src);
    expect(items.length).toBe(1);
    expect(items[0].rendered).toBe(true);
  });
});
```

- [ ] **Step 2: Run test to verify it fails**

Run: `npx vitest run tests/source-render.test.ts`
Expected: FAIL — `HttpSource` constructor takes 3 arguments / `rendered` missing on `SourceItem`.

- [ ] **Step 3: Implement source changes**

In `src/source.ts`:

Add to imports (line 9 area):

```ts
import { fetchMaybeRender, type PageRenderer } from "./http/render.js";
```

Extend `SourceItem`:

```ts
export interface SourceItem {
  key: string;
  srcUri: string;
  bytes: Buffer;
  contentType: string;
  error?: string;          // set when fetch failed; convert loop counts as failed
  kind?: "html" | "llms-full" | "markdown" | "openapi";
  outputKey?: string;      // when set, runPipeline uses this for output path (host-prefixed for cross-origin)
  spec?: Record<string, unknown>; // parsed OpenAPI 3.x spec when kind === "openapi"
  rendered?: boolean;      // bytes came from the headless renderer
}
```

Extend the `HttpSource` constructor:

```ts
  constructor(
    private readonly rootUrl: string,
    private readonly fetchOpts: FetchOptions,
    private readonly crawlOpts: CrawlOptions,
    private readonly renderer: PageRenderer | null = null,
  ) {}
```

**singlePage branch** — replace `const res = await fetchUrl(normalized, this.fetchOpts);` with:

```ts
        const res = await fetchMaybeRender(
          normalized,
          this.fetchOpts,
          this.crawlOpts.renderMode,
          this.renderer,
        );
```

and extend the HTML yield in the same branch:

```ts
        yield {
          key: pathFromUrl(normalized),
          srcUri: normalized,
          bytes: res.bytes,
          contentType: res.contentType,
          ...(res.rendered ? { rendered: true } : {}),
        };
```

(The non-HTML/openapi sub-branch is untouched — `fetchMaybeRender` never renders non-HTML, so `maybeOpenapiItem` still sees pristine JSON/YAML bytes.)

**`iterFromSitemap`** — replace `const res = await fetchUrl(url, this.fetchOpts);` with:

```ts
        const res = await fetchMaybeRender(
          url,
          this.fetchOpts,
          this.crawlOpts.renderMode,
          this.renderer,
        );
```

and extend the HTML `buffered.push`:

```ts
        buffered.push({
          key: pathFromUrl(url),
          srcUri: url,
          bytes: res.bytes,
          contentType: res.contentType,
          ...(res.rendered ? { rendered: true } : {}),
        });
```

**`iterFromBfs`** — pass the renderer through and propagate the flag:

```ts
    for await (const item of crawlBfs(this.rootUrl, robots, this.fetchOpts, this.crawlOpts, this.renderer)) {
```

and the final HTML yield in that method:

```ts
      yield {
        key: pathFromUrl(item.url),
        srcUri: item.url,
        bytes: item.bytes,
        contentType: item.contentType,
        ...(item.rendered ? { rendered: true } : {}),
      };
```

`iterFromLlmsIndex` and the llms-full probe are NOT touched (spec non-goal).

- [ ] **Step 4: Run tests**

Run: `npx vitest run tests/source-render.test.ts tests/source.test.ts tests/source-llms-index.test.ts tests/source-openapi.test.ts tests/source-llms-full.test.ts`
Expected: all PASS (constructor param optional, existing behavior unchanged). Run `npm run typecheck` — clean.

- [ ] **Step 5: Commit**

```bash
git add src/source.ts tests/source-render.test.ts
git commit -m "feat(source): thread renderer through singlePage/sitemap/BFS paths (docf-z6g)"
```

---

### Task 6: runPipeline lifecycle, rendered accounting, report flag

**Files:**
- Modify: `src/runPipeline.ts`
- Modify: `src/output.ts` (ReportEntry)
- Test: `tests/pipeline-render.test.ts`

**Interfaces:**
- Consumes: `createRenderer`, `RendererHandle` from `./http/render.js`; `SourceItem.rendered` from Task 5.
- Produces (used by Task 7):
  - `RunPipelineOptions` gains `renderer?: RendererHandle` (test/DI seam — CLI never sets it)
  - `PipelineResult` gains `rendered?: number` (present only when `crawlOptions.renderMode` set)
  - `ReportEntry` gains `rendered?: boolean`.

- [ ] **Step 1: Write the failing test**

Create `tests/pipeline-render.test.ts`:

```ts
import { afterAll, afterEach, beforeAll, beforeEach, describe, expect, test } from "vitest";
import { createServer, type Server } from "node:http";
import { AddressInfo } from "node:net";
import { mkdtempSync, readFileSync, rmSync, existsSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { runPipeline } from "../src/runPipeline.js";
import type { RenderResult } from "../src/http/render.js";
import { __clearRobotsCache } from "../src/http/robots.js";

let server: Server;
let base: string;
let tmp: string;

const SHELL = `<html><body><div id="root"></div><script src="/app.js"></script></body></html>`;
const HYDRATED = `<!doctype html><html><head><title>Home</title></head><body><main>
<h1>Hydrated Home</h1>
<p>${"This paragraph exists only after client-side rendering has completed. ".repeat(8)}</p>
<p>${"More rendered documentation content for the extractor to keep. ".repeat(8)}</p>
</main></body></html>`;

beforeAll(async () => {
  server = createServer((req, res) => {
    if (req.url === "/") {
      res.writeHead(200, { "Content-Type": "text/html" });
      res.end(SHELL);
      return;
    }
    res.writeHead(404);
    res.end();
  });
  await new Promise<void>((r) => server.listen(0, r));
  base = `http://localhost:${(server.address() as AddressInfo).port}`;
});

afterAll(async () => {
  await new Promise<void>((r) => server.close(() => r()));
});

beforeEach(() => {
  __clearRobotsCache();
  tmp = mkdtempSync(join(tmpdir(), "docforge-render-"));
});

afterEach(() => {
  rmSync(tmp, { recursive: true, force: true });
});

function makeStub() {
  const calls: string[] = [];
  let closed = false;
  return {
    calls,
    get closed() {
      return closed;
    },
    render: async (url: string): Promise<RenderResult> => {
      calls.push(url);
      return { bytes: Buffer.from(HYDRATED, "utf8"), contentType: "text/html" };
    },
    close: async () => {
      closed = true;
    },
  };
}

function pipelineOpts(stub: ReturnType<typeof makeStub>, renderMode?: "auto" | "force") {
  return {
    source: `${base}/`,
    outputDir: tmp,
    maxBytes: 10_485_760,
    dryRun: false,
    fetchOptions: {
      userAgent: "docforge-test/0",
      timeoutMs: 1_000,
      maxBytes: 10_485_760,
      cacheDir: null,
    },
    crawlOptions: {
      maxPages: 10,
      maxDepth: 2,
      concurrency: 1,
      userAgent: "docforge-test/0",
      llmsFullMode: "off" as const,
      llmsIndexMode: "off" as const,
      ...(renderMode ? { renderMode } : {}),
    },
    renderer: stub,
  };
}

describe("runPipeline render integration", () => {
  test("auto mode: converts rendered content, counts it, flags report, closes renderer", async () => {
    const stub = makeStub();
    const result = await runPipeline(pipelineOpts(stub, "auto"));
    expect(result.converted).toBe(1);
    expect(result.rendered).toBe(1);
    expect(result.report[0].rendered).toBe(true);
    expect(stub.calls).toEqual([`${base}/`]);
    expect(stub.closed).toBe(true);
    expect(existsSync(join(tmp, "index.md"))).toBe(true);
    const md = readFileSync(join(tmp, "index.md"), "utf8");
    expect(md).toContain("Hydrated Home");
  });

  test("no renderMode: rendered stat absent, renderer unused", async () => {
    const stub = makeStub();
    const result = await runPipeline(pipelineOpts(stub, undefined));
    expect(result.rendered).toBeUndefined();
    expect(stub.calls).toEqual([]);
  });
});
```

- [ ] **Step 2: Run test to verify it fails**

Run: `npx vitest run tests/pipeline-render.test.ts`
Expected: FAIL — `renderer` not a known option / `result.rendered` undefined where 1 expected.

- [ ] **Step 3: Implement output.ts change**

In `src/output.ts`, extend `ReportEntry` (line 74):

```ts
export interface ReportEntry {
  input: string;
  srcUri: string;
  output: string | null;
  status: ReportStatus;
  error?: string;
  rendered?: boolean; // bytes came from the headless renderer
}
```

- [ ] **Step 4: Implement runPipeline changes**

In `src/runPipeline.ts`:

Add import:

```ts
import { createRenderer, type RendererHandle } from "./http/render.js";
```

Extend the options and result interfaces:

```ts
export interface RunPipelineOptions {
  source: string;
  outputDir: string;
  maxBytes: number;
  dryRun: boolean;
  fetchOptions?: FetchOptions;
  crawlOptions?: CrawlOptions;
  selector?: string;
  vlm?: VlmOptions;
  format?: "default" | "obsidian";
  saveImages?: boolean;
  citeLinks?: boolean;
  /** Test/DI seam: injected renderer. When absent and renderMode is set, runPipeline creates one. */
  renderer?: RendererHandle;
}

export interface PipelineResult {
  converted: number;
  empty: number;
  skipped: number;
  failed: number;
  report: ReportEntry[];
  vlm?: DescribeStats;
  assets?: AssetStats;
  citations?: { footnotes: number };
  rendered?: number; // pages whose bytes came from the renderer (renderMode set only)
}
```

In the URL branch of `runPipeline` (currently `source = new HttpSource(...)`), create/inject the renderer:

```ts
  let renderer: RendererHandle | null = null;

  let source: Source;
  let sourceRoot: string | undefined;
  if (isUrl(opts.source)) {
    if (!opts.fetchOptions || !opts.crawlOptions) {
      throw new Error("URL sources require fetchOptions and crawlOptions");
    }
    if (opts.fetchOptions.cacheDir) {
      try {
        mkdirSync(opts.fetchOptions.cacheDir, { recursive: true });
      } catch (e) {
        log("warn", `cache dir not writable: ${(e as Error).message}`);
      }
    }
    if (opts.crawlOptions.renderMode) {
      renderer =
        opts.renderer ??
        (await createRenderer({
          userAgent: opts.fetchOptions.userAgent,
          timeoutMs: opts.fetchOptions.timeoutMs,
          maxBytes: opts.fetchOptions.maxBytes,
          ...(opts.fetchOptions.auth ? { auth: opts.fetchOptions.auth } : {}),
        }));
    }
    source = new HttpSource(opts.source, opts.fetchOptions, opts.crawlOptions, renderer);
  } else {
    // ... existing filesystem branch unchanged
  }
```

Add a `renderedCount` counter next to the existing counters:

```ts
  let renderedCount = 0;
```

Wrap the existing `for await (const item of source.iter()) { ... }` loop in `try`/`finally` so the browser always closes (including on abort/throw):

```ts
  try {
    for await (const item of source.iter()) {
      if (signal?.aborted) throw new Error("aborted");
      if (item.rendered) renderedCount += 1;
      // ... entire existing loop body unchanged ...
    }
  } finally {
    if (renderer) await renderer.close();
  }
```

Add `...(item.rendered ? { rendered: true } : {})` to the three report pushes that can carry rendered HTML items — the `empty`, convert-`failed`, and final `ok` pushes in the HTML branch:

```ts
      report.push({ input: item.key, srcUri: item.srcUri, output: null, status: "empty", ...(item.rendered ? { rendered: true } : {}) });
```

```ts
      report.push({
        input: item.key, srcUri: item.srcUri, output: null,
        status: "failed", error: result.error,
        ...(item.rendered ? { rendered: true } : {}),
      });
```

```ts
    report.push({ input: item.key, srcUri: item.srcUri, output: outPath, status: "ok", ...(item.rendered ? { rendered: true } : {}) });
```

(The fetch-error, llms/markdown, and openapi pushes never carry rendered items — leave them.)

Extend the return:

```ts
  return {
    converted,
    empty,
    skipped: source.skippedCount,
    failed,
    report,
    ...(opts.vlm ? { vlm: vlmStats } : {}),
    ...(assetStore ? { assets: assetStats } : {}),
    ...(opts.citeLinks ? { citations: { footnotes: citationFootnotes } } : {}),
    ...(opts.crawlOptions?.renderMode ? { rendered: renderedCount } : {}),
  };
```

- [ ] **Step 5: Run tests**

Run: `npx vitest run tests/pipeline-render.test.ts tests/crawl-e2e.test.ts tests/pipeline-url-links.test.ts`
Expected: all PASS. Run `npm run typecheck` — clean.

- [ ] **Step 6: Commit**

```bash
git add src/runPipeline.ts src/output.ts tests/pipeline-render.test.ts
git commit -m "feat(pipeline): renderer lifecycle, rendered count, report provenance (docf-z6g)"
```

---

### Task 7: CLI flag `--render`, fail-fast probe, summary line

**Files:**
- Modify: `src/cli.ts`
- Test: `tests/cli-render.test.ts`

**Interfaces:**
- Consumes: `probeRenderAvailable` from `./http/render.js`; Task 6's `PipelineResult.rendered`.
- Produces: `--render <mode>` CLI option (`auto|force|off`, default `off`); `render: rendered=N` summary log; exit 2 on invalid value or missing playwright.

- [ ] **Step 1: Write the failing test**

Create `tests/cli-render.test.ts`:

```ts
import { describe, expect, test, vi } from "vitest";
import { mkdtempSync, mkdirSync, rmSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";

vi.mock("../src/http/render.js", async (importOriginal) => {
  const mod = await importOriginal<typeof import("../src/http/render.js")>();
  return { ...mod, probeRenderAvailable: vi.fn(async () => {}) };
});

import { probeRenderAvailable } from "../src/http/render.js";
import { runConvert } from "../src/cli.js";

function baseOpts(output: string, render?: string) {
  return {
    output,
    failThreshold: "0.10",
    maxBytes: "10485760",
    dryRun: false,
    maxPages: "10",
    maxDepth: "2",
    concurrency: "1",
    cacheDir: join(output, ".cache"),
    cache: false,
    userAgent: "docforge-test/0",
    llmsFull: "off",
    ...(render !== undefined ? { render } : {}),
  };
}

describe("--render CLI flag", () => {
  test("invalid value → exit 2, no probe, no fetch", async () => {
    const tmp = mkdtempSync(join(tmpdir(), "docforge-cli-render-"));
    try {
      const code = await runConvert("http://localhost:9/", baseOpts(tmp, "banana"));
      expect(code).toBe(2);
    } finally {
      rmSync(tmp, { recursive: true, force: true });
    }
  });

  test("missing playwright (probe throws) → exit 2 before crawling", async () => {
    const tmp = mkdtempSync(join(tmpdir(), "docforge-cli-render-"));
    vi.mocked(probeRenderAvailable).mockRejectedValueOnce(
      new Error("--render requires playwright: npm i playwright && npx playwright install chromium"),
    );
    try {
      const code = await runConvert("http://localhost:9/", baseOpts(tmp, "auto"));
      expect(code).toBe(2);
    } finally {
      rmSync(tmp, { recursive: true, force: true });
    }
  });

  test("--render on filesystem source → warn + ignore, converts normally", async () => {
    const tmp = mkdtempSync(join(tmpdir(), "docforge-cli-render-"));
    const srcDir = join(tmp, "src");
    mkdirSync(srcDir, { recursive: true });
    writeFileSync(
      join(srcDir, "page.html"),
      `<html><head><title>T</title></head><body><main><h1>T</h1><p>${"local static content ".repeat(20)}</p></main></body></html>`,
    );
    const out = join(tmp, "out");
    try {
      const code = await runConvert(srcDir, baseOpts(out, "auto"));
      expect(code).toBe(0);
      expect(vi.mocked(probeRenderAvailable)).not.toHaveBeenCalled(); // fs path skips probe
    } finally {
      rmSync(tmp, { recursive: true, force: true });
    }
  });

  test("--render off is accepted and means static-only", async () => {
    const tmp = mkdtempSync(join(tmpdir(), "docforge-cli-render-"));
    const srcDir = join(tmp, "src");
    mkdirSync(srcDir, { recursive: true });
    writeFileSync(
      join(srcDir, "page.html"),
      `<html><head><title>T</title></head><body><main><h1>T</h1><p>${"local static content ".repeat(20)}</p></main></body></html>`,
    );
    const out = join(tmp, "out");
    try {
      const code = await runConvert(srcDir, baseOpts(out, "off"));
      expect(code).toBe(0);
    } finally {
      rmSync(tmp, { recursive: true, force: true });
    }
  });
});
```

Note on the probe-throw test: `mockRejectedValueOnce` fires on the first probe call; the URL `http://localhost:9/` is never fetched because runConvert must return 2 before building the pipeline.

- [ ] **Step 2: Run test to verify it fails**

Run: `npx vitest run tests/cli-render.test.ts`
Expected: FAIL — invalid `--render` value is not rejected (code 0/other instead of 2) since the flag doesn't exist yet.

- [ ] **Step 3: Implement CLI changes**

In `src/cli.ts`:

Add import:

```ts
import { probeRenderAvailable } from "./http/render.js";
```

Add the option to the `convert` command, after the `--scope` option line:

```ts
    .option(
      "--render <mode>",
      "render JS-only pages via headless chromium: auto|force|off (URL source only; requires playwright)",
      "off",
    )
```

Extend `ConvertOpts`:

```ts
  render?: string | undefined;
```

In `runConvert`, inside the `if (isUrl(sourceArg))` block, after the `--scope` validation:

```ts
    const renderMode = opts.render ?? "off";
    if (renderMode !== "off" && renderMode !== "auto" && renderMode !== "force") {
      log("error", `invalid --render value: ${opts.render} (expected auto|force|off)`);
      return 2;
    }
    if (renderMode !== "off") {
      try {
        await probeRenderAvailable();
      } catch (e) {
        log("error", (e as Error).message);
        return 2;
      }
    }
```

Extend the `crawlOptions` object literal:

```ts
    pipelineOpts.crawlOptions = {
      maxPages: parseInt(opts.maxPages, 10),
      maxDepth: parseInt(opts.maxDepth, 10),
      concurrency: parseInt(opts.concurrency, 10),
      userAgent: opts.userAgent,
      llmsFullMode,
      ...(scopePrefix ? { scopePrefix } : {}),
      ...(renderMode !== "off" ? { renderMode } : {}),
    };
```

After the existing `--describe-images` non-URL warning block, add:

```ts
  if (opts.render && opts.render !== "off" && !isUrl(sourceArg)) {
    log("warn", "--render ignored for non-URL sources");
  }
```

After the vlm/assets/citations summary blocks, add:

```ts
  if (result.rendered !== undefined) {
    log("info", `render: rendered=${result.rendered}`);
  }
```

- [ ] **Step 4: Run tests**

Run: `npx vitest run tests/cli-render.test.ts tests/cli.test.ts tests/crawl-e2e.test.ts`
Expected: all PASS. Run `npm run typecheck` — clean.

- [ ] **Step 5: Commit**

```bash
git add src/cli.ts tests/cli-render.test.ts
git commit -m "feat(cli): --render flag with fail-fast playwright probe (docf-z6g)"
```

---

### Task 8: README, version bump, full suite, close issue

**Files:**
- Modify: `README.md`
- Modify: `package.json` (version)
- Modify: `src/index.ts` (VERSION — currently drifted at "0.6.0" while package.json says 0.7.0; align both at 0.8.0)

**Interfaces:**
- Consumes: everything above.
- Produces: released docs + 0.8.0 version.

- [ ] **Step 1: README section**

Add to `README.md` after the Usage section:

```markdown
## JS-rendered sites (SPA docs)

Sites that render content client-side yield empty shells over plain HTTP. Opt in to
headless rendering:

```bash
npm i playwright && npx playwright install chromium   # one-time, optional peer dep
docforge convert https://spa-docs.example.com/docs --output ./out --render auto
```

- `--render auto` — fetch statically first; pages whose visible body text is near-empty
  (< 200 chars) are re-rendered in headless chromium. Link discovery uses the rendered
  DOM, so SPA navigation is crawled.
- `--render force` — render every HTML page (slower; ~1–3s per page).
- Robots, `--scope`, `--max-pages`, `--max-depth`, crawl-delay, and `--max-bytes` apply
  unchanged. Rendered output is not cached between runs (static responses still are).
- `--auth-header` is honored during rendering and sent only to the root origin — never
  to cross-origin subresources.
- Known limitation: subresources fetched by the browser during render (scripts, XHR)
  are not robots-checked — robots governs which page URLs are crawled, as before.
```

Also update the scope line at the top of the README: change `v0.6.0 scope:` to `v0.8.0 scope:` and append `JS-rendered (SPA) sites via optional --render playwright backend.` to the scope sentence.

- [ ] **Step 2: Version bump (both files — note existing drift)**

- `package.json`: `"version": "0.8.0"`
- `src/index.ts`: `export const VERSION = "0.8.0";`

- [ ] **Step 3: Full suite + typecheck**

Run: `npm test`
Expected: all suites PASS (live render suite may report skipped without chromium — acceptable). `tsc` (pretest) clean.

- [ ] **Step 4: Commit and close the bead**

```bash
git add README.md package.json src/index.ts
git commit -m "docs(readme): JS render section; version 0.8.0 (docf-z6g)"
br close docf-z6g
git add .beads && git commit -m "chore(beads): close docf-z6g" || true
```

(If `br close` syncs differently, follow the repo's existing beads commit pattern — see `git log --oneline | grep beads`.)
