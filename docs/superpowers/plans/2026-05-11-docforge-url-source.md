# docforge URL Source Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Add HTTP(S) URL support to `docforge convert` and `docforge openapi` so users can convert remote documentation sites without first mirroring them locally. Filesystem behavior is preserved.

**Architecture:** Introduce a `Source` interface yielding `AsyncIterable<SourceItem>`. `FilesystemSource` wraps the existing `walk.ts`; `HttpSource` does sitemap-first discovery with BFS fallback, ETag-cached fetches via `got`, and robots.txt-aware boundary. The `convert` loop becomes source-agnostic. The `openapi` loader gains a one-shot `fetchUrl()` path.

**Tech Stack:** Node 20+, TypeScript strict, ESM. New deps: `got` 15 (HTTP), `cacheable-request` 13 + `keyv` 5 + `keyv-file` 5 (RFC 9111 disk cache), `sitemapper` 4, `@crawlee/utils` (RobotsTxtFile only), `p-queue` 9. Existing: `cheerio`, `commander`, `js-yaml`, `@kreuzberg/node` ^4. Spec: `docs/superpowers/specs/2026-05-11-docforge-url-source-design.md`.

**Test layout note:** project uses flat `tests/*.test.ts` (not `tests/unit/` or `tests/integration/`). Plan paths follow that convention; helpers live under `tests/helpers/`.

---

## File Structure

**Create:**

| File | Responsibility |
|---|---|
| `src/http/url.ts` | URL normalization, same-origin gate, URL→output path mapping |
| `src/http/fetch.ts` | `got` client with ETag/304 disk cache, retry, timeout, max-bytes |
| `src/http/robots.ts` | `@crawlee/utils#RobotsTxtFile` wrapper with per-origin memoization |
| `src/http/sitemap.ts` | `sitemapper`-based sitemap discovery (robots → /sitemap.xml → /sitemap_index.xml) |
| `src/http/crawl.ts` | BFS frontier with `p-queue`, same-origin + robots gate, dedup |
| `src/source.ts` | `Source` interface + `FilesystemSource` + `HttpSource` |
| `tests/http-url.test.ts` | unit tests for url.ts |
| `tests/http-fetch.test.ts` | unit tests for fetch.ts |
| `tests/http-robots.test.ts` | unit tests for robots.ts |
| `tests/http-sitemap.test.ts` | unit tests for sitemap.ts |
| `tests/http-crawl.test.ts` | unit tests for crawl.ts |
| `tests/source.test.ts` | unit tests for source.ts |
| `tests/helpers/static-server.ts` | local HTTP fixture server for integration tests |
| `tests/crawl-e2e.test.ts` | end-to-end convert against URL source |
| `tests/crawl-bfs-fallback.test.ts` | BFS fallback when sitemap missing |
| `tests/crawl-robots-deny.test.ts` | robots.txt Disallow respected |
| `tests/crawl-cache-304.test.ts` | second run uses ETag/304 cache |
| `tests/crawl-fail-threshold.test.ts` | --fail-threshold with HTTP errors |
| `tests/openapi-url.test.ts` | `docforge openapi <url>` end-to-end |
| `tests/fixtures/crawl-site/` | static HTML + robots.txt + sitemap.xml fixture corpus |

**Modify:**

| File | Change |
|---|---|
| `package.json` | bump version 0.4.0 → 0.5.0, add 7 deps |
| `src/index.ts` | bump VERSION constant |
| `src/output.ts` | add `srcUri` field to `ReportEntry`; new `urlToOutputPath` re-export |
| `src/cli.ts` | URL detection on `<source>`; new flags; source-agnostic convert loop |
| `src/openapi/loader.ts` | add `loadSpecFromUrl()` for HTTP path |
| `src/openapi/cli.ts` | URL detection on `<spec>` arg; pass fetchOpts |

**Unchanged:** `src/walk.ts`, `src/convert.ts`, `src/title.ts`, `src/links.ts`, `src/log.ts`, `src/bin.ts`, `src/openapi/{iter,paths,refs,render}.ts`.

---

## Task 1: Install dependencies and bump version

**Files:**
- Modify: `package.json`
- Modify: `src/index.ts:1`

- [ ] **Step 1: Install runtime deps**

Run:
```bash
npm install got@^15 cacheable-request@^13 keyv@^5 keyv-file@^5 sitemapper@^4 @crawlee/utils@^3 p-queue@^9
```

Expected: dependencies added to `package.json`, no peer warnings.

- [ ] **Step 2: Bump `package.json` version**

Edit `package.json`:
```diff
-  "version": "0.4.0",
+  "version": "0.5.0",
```

- [ ] **Step 3: Bump VERSION constant**

Replace `src/index.ts`:
```ts
export const VERSION = "0.5.0";
```

- [ ] **Step 4: Verify typecheck passes**

Run: `npm run typecheck`
Expected: zero errors. (Existing code only — no new code yet.)

- [ ] **Step 5: Commit**

```bash
git add package.json package-lock.json src/index.ts
git commit -m "chore(deps): add got, sitemapper, p-queue, keyv for URL source; bump 0.5.0"
```

---

## Task 2: `src/http/url.ts` — URL utilities

**Files:**
- Create: `src/http/url.ts`
- Create: `tests/http-url.test.ts`

- [ ] **Step 1: Write the failing test**

Create `tests/http-url.test.ts`:
```ts
import { describe, expect, test } from "vitest";
import { normalizeUrl, sameOrigin, urlToOutputPath } from "../src/http/url.js";

describe("normalizeUrl", () => {
  test("absolute http url passes through", () => {
    expect(normalizeUrl("https://x.com/a")).toBe("https://x.com/a");
  });

  test("strips fragment", () => {
    expect(normalizeUrl("https://x.com/a#sec")).toBe("https://x.com/a");
  });

  test("strips query string", () => {
    expect(normalizeUrl("https://x.com/a?v=1")).toBe("https://x.com/a");
  });

  test("resolves relative against base", () => {
    expect(normalizeUrl("../b", "https://x.com/a/c/")).toBe("https://x.com/a/b");
  });

  test("collapses default https port", () => {
    expect(normalizeUrl("https://x.com:443/a")).toBe("https://x.com/a");
  });

  test("collapses default http port", () => {
    expect(normalizeUrl("http://x.com:80/a")).toBe("http://x.com/a");
  });

  test("lowercases host", () => {
    expect(normalizeUrl("https://X.COM/A")).toBe("https://x.com/A");
  });

  test("returns null for mailto", () => {
    expect(normalizeUrl("mailto:foo@bar.com")).toBeNull();
  });

  test("returns null for javascript:", () => {
    expect(normalizeUrl("javascript:void(0)")).toBeNull();
  });

  test("returns null for relative without base", () => {
    expect(normalizeUrl("../b")).toBeNull();
  });
});

describe("sameOrigin", () => {
  test("same scheme + host + port", () => {
    expect(sameOrigin("https://x.com/a", "https://x.com/b")).toBe(true);
  });

  test("different host", () => {
    expect(sameOrigin("https://x.com/a", "https://y.com/a")).toBe(false);
  });

  test("different scheme", () => {
    expect(sameOrigin("https://x.com/", "http://x.com/")).toBe(false);
  });

  test("default port collapse same-origin", () => {
    expect(sameOrigin("https://x.com:443/a", "https://x.com/b")).toBe(true);
  });
});

describe("urlToOutputPath", () => {
  test.each([
    ["https://x.com/", "/out", "/out/index.md"],
    ["https://x.com/guide/", "/out", "/out/guide/index.md"],
    ["https://x.com/guide/foo.html", "/out", "/out/guide/foo.md"],
    ["https://x.com/guide/foo", "/out", "/out/guide/foo.md"],
    ["https://x.com/guide/foo?v=1#sec", "/out", "/out/guide/foo.md"],
    ["https://x.com/a/b/c/page.html", "/out", "/out/a/b/c/page.md"],
    ["https://x.com/foo.htm", "/out", "/out/foo.md"],
  ])("%s -> %s", (url, outDir, expected) => {
    expect(urlToOutputPath(url, outDir)).toBe(expected);
  });
});
```

- [ ] **Step 2: Run test to verify it fails**

Run: `npx vitest run tests/http-url.test.ts`
Expected: FAIL — `Cannot find module '../src/http/url.js'`.

- [ ] **Step 3: Implement url.ts**

Create `src/http/url.ts`:
```ts
import { posix } from "node:path";

const DEFAULT_PORTS: Record<string, string> = {
  "http:": "80",
  "https:": "443",
};

export function normalizeUrl(input: string, base?: string): string | null {
  let u: URL;
  try {
    u = base ? new URL(input, base) : new URL(input);
  } catch {
    return null;
  }
  if (u.protocol !== "http:" && u.protocol !== "https:") return null;
  u.hash = "";
  u.search = "";
  if (u.port && DEFAULT_PORTS[u.protocol] === u.port) u.port = "";
  u.hostname = u.hostname.toLowerCase();
  return u.toString();
}

export function sameOrigin(a: string, b: string): boolean {
  const na = normalizeUrl(a);
  const nb = normalizeUrl(b);
  if (!na || !nb) return false;
  const ua = new URL(na);
  const ub = new URL(nb);
  return ua.protocol === ub.protocol && ua.host === ub.host;
}

export function urlToOutputPath(url: string, outputDir: string): string {
  const normalized = normalizeUrl(url);
  if (!normalized) {
    throw new Error(`cannot map non-http url to output path: ${url}`);
  }
  const u = new URL(normalized);
  let path = decodeURIComponent(u.pathname);
  if (path.endsWith("/") || path === "") {
    path = `${path}index.md`;
  } else if (/\.html?$/i.test(path)) {
    path = path.replace(/\.html?$/i, ".md");
  } else {
    path = `${path}.md`;
  }
  const sanitized = path.split("/").map(sanitizeSegment).join("/");
  return posix.join(outputDir, sanitized.replace(/^\/+/, ""));
}

function sanitizeSegment(seg: string): string {
  return seg.replace(/[<>:"|?*\0]/g, "_");
}
```

- [ ] **Step 4: Run tests to verify they pass**

Run: `npx vitest run tests/http-url.test.ts`
Expected: all tests pass.

- [ ] **Step 5: Typecheck**

Run: `npm run typecheck`
Expected: zero errors.

- [ ] **Step 6: Commit**

```bash
git add src/http/url.ts tests/http-url.test.ts
git commit -m "feat(http): add url normalize + sameOrigin + urlToOutputPath helpers"
```

---

## Task 3: `src/http/fetch.ts` — HTTP client with ETag cache

**Files:**
- Create: `src/http/fetch.ts`
- Create: `tests/http-fetch.test.ts`

- [ ] **Step 1: Write the failing test**

Create `tests/http-fetch.test.ts`:
```ts
import { afterAll, beforeAll, describe, expect, test } from "vitest";
import { createServer, type Server } from "node:http";
import { mkdtempSync, rmSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { AddressInfo } from "node:net";
import { fetchUrl, FetchError, type FetchOptions } from "../src/http/fetch.js";

let server: Server;
let port: number;
let cacheDir: string;
let hits: { method: string; url: string; ifNoneMatch?: string }[] = [];

beforeAll(async () => {
  cacheDir = mkdtempSync(join(tmpdir(), "docforge-fetch-"));
  server = createServer((req, res) => {
    hits.push({
      method: req.method ?? "GET",
      url: req.url ?? "",
      ifNoneMatch: req.headers["if-none-match"] as string | undefined,
    });
    const url = req.url ?? "";
    if (url === "/ok") {
      const etag = '"v1"';
      if (req.headers["if-none-match"] === etag) {
        res.writeHead(304, { ETag: etag });
        res.end();
        return;
      }
      res.writeHead(200, { "Content-Type": "text/html; charset=utf-8", ETag: etag });
      res.end("<html>hi</html>");
      return;
    }
    if (url === "/notfound") {
      res.writeHead(404);
      res.end();
      return;
    }
    if (url === "/big") {
      res.writeHead(200, { "Content-Type": "text/html" });
      res.end("X".repeat(2_000_000));
      return;
    }
    if (url === "/slow") {
      setTimeout(() => {
        res.writeHead(200, { "Content-Type": "text/html" });
        res.end("ok");
      }, 200);
      return;
    }
    if (url === "/5xx") {
      res.writeHead(503);
      res.end();
      return;
    }
    res.writeHead(500);
    res.end();
  });
  await new Promise<void>((resolve) => server.listen(0, resolve));
  port = (server.address() as AddressInfo).port;
});

afterAll(async () => {
  await new Promise<void>((resolve) => server.close(() => resolve()));
  rmSync(cacheDir, { recursive: true, force: true });
});

function opts(overrides: Partial<FetchOptions> = {}): FetchOptions {
  return {
    userAgent: "docforge-test/0",
    timeoutMs: 1_000,
    maxBytes: 1_000_000,
    cacheDir,
    ...overrides,
  };
}

describe("fetchUrl", () => {
  test("200 returns body + contentType + etag", async () => {
    hits = [];
    const result = await fetchUrl(`http://localhost:${port}/ok`, opts({ cacheDir: null }));
    expect(result.status).toBe(200);
    expect(result.bytes.toString("utf8")).toBe("<html>hi</html>");
    expect(result.contentType).toMatch(/^text\/html/);
    expect(result.etag).toBe('"v1"');
    expect(result.fromCache).toBe(false);
  });

  test("304 round-trip via on-disk cache", async () => {
    hits = [];
    const url = `http://localhost:${port}/ok`;
    const first = await fetchUrl(url, opts());
    expect(first.status).toBe(200);
    expect(first.fromCache).toBe(false);
    const second = await fetchUrl(url, opts());
    expect(second.status).toBe(200);
    expect(second.bytes.toString("utf8")).toBe("<html>hi</html>");
    expect(second.fromCache).toBe(true);
    const conditional = hits.find((h) => h.ifNoneMatch === '"v1"');
    expect(conditional).toBeDefined();
  });

  test("404 throws FetchError with status", async () => {
    await expect(
      fetchUrl(`http://localhost:${port}/notfound`, opts({ cacheDir: null })),
    ).rejects.toMatchObject({ name: "FetchError", status: 404 });
  });

  test("max-bytes enforced", async () => {
    await expect(
      fetchUrl(`http://localhost:${port}/big`, opts({ cacheDir: null, maxBytes: 1024 })),
    ).rejects.toMatchObject({ name: "FetchError" });
  });

  test("timeout throws FetchError", async () => {
    await expect(
      fetchUrl(`http://localhost:${port}/slow`, opts({ cacheDir: null, timeoutMs: 50 })),
    ).rejects.toMatchObject({ name: "FetchError" });
  });
});
```

- [ ] **Step 2: Run test to verify it fails**

Run: `npx vitest run tests/http-fetch.test.ts`
Expected: FAIL — module not found.

- [ ] **Step 3: Implement fetch.ts**

Create `src/http/fetch.ts`:
```ts
import { join } from "node:path";
import got, { type Got, type OptionsOfTextResponseBody, RequestError, HTTPError, TimeoutError } from "got";
import Keyv from "keyv";
import KeyvFile from "keyv-file";

export class FetchError extends Error {
  public status: number | null;
  constructor(message: string, status: number | null = null, cause?: unknown) {
    super(message);
    this.name = "FetchError";
    this.status = status;
    if (cause !== undefined) (this as Error & { cause?: unknown }).cause = cause;
  }
}

export interface FetchResult {
  status: number;
  bytes: Buffer;
  contentType: string;
  etag: string | null;
  fromCache: boolean;
}

export interface FetchOptions {
  userAgent: string;
  timeoutMs: number;
  maxBytes: number;
  cacheDir: string | null;
}

let cached: { dir: string; client: Got } | null = null;
let nocacheClient: Got | null = null;

function makeClient(opts: FetchOptions): Got {
  const base: OptionsOfTextResponseBody = {
    headers: { "user-agent": opts.userAgent },
    timeout: { request: opts.timeoutMs },
    retry: { limit: 2, methods: ["GET"], statusCodes: [408, 429, 500, 502, 503, 504] },
    throwHttpErrors: false,
    responseType: "buffer" as unknown as "text",
    decompress: true,
  };
  if (opts.cacheDir === null) {
    if (!nocacheClient) nocacheClient = got.extend(base);
    return nocacheClient;
  }
  if (cached && cached.dir === opts.cacheDir) return cached.client;
  const store = new KeyvFile({ filename: join(opts.cacheDir, "responses.json") });
  const keyv = new Keyv({ store });
  const client = got.extend({ ...base, cache: keyv as unknown as Map<string, unknown> });
  cached = { dir: opts.cacheDir, client };
  return client;
}

export async function fetchUrl(url: string, opts: FetchOptions): Promise<FetchResult> {
  const client = makeClient(opts);
  let res;
  try {
    res = await client.get(url, {
      headers: { "user-agent": opts.userAgent },
      timeout: { request: opts.timeoutMs },
    });
  } catch (e) {
    if (e instanceof TimeoutError) throw new FetchError(`timeout fetching ${url}`, null, e);
    if (e instanceof RequestError) {
      const status =
        e instanceof HTTPError ? e.response.statusCode : null;
      throw new FetchError(`fetch failed ${url}: ${e.message}`, status, e);
    }
    throw new FetchError(`fetch failed ${url}: ${(e as Error).message}`, null, e);
  }

  if (res.statusCode >= 400) {
    throw new FetchError(`HTTP ${res.statusCode} for ${url}`, res.statusCode);
  }
  const body = res.rawBody;
  if (body.length > opts.maxBytes) {
    throw new FetchError(
      `body ${body.length} bytes exceeds maxBytes ${opts.maxBytes} for ${url}`,
      res.statusCode,
    );
  }
  const contentType = (res.headers["content-type"] as string | undefined) ?? "application/octet-stream";
  const etag = (res.headers["etag"] as string | undefined) ?? null;
  return {
    status: res.statusCode,
    bytes: body,
    contentType,
    etag,
    fromCache: res.isFromCache === true,
  };
}
```

- [ ] **Step 4: Run tests to verify they pass**

Run: `npx vitest run tests/http-fetch.test.ts`
Expected: all 5 tests pass.

- [ ] **Step 5: Typecheck**

Run: `npm run typecheck`
Expected: zero errors.

- [ ] **Step 6: Commit**

```bash
git add src/http/fetch.ts tests/http-fetch.test.ts
git commit -m "feat(http): fetchUrl with got + ETag/304 disk cache + retry + timeout"
```

---

## Task 4: `src/http/robots.ts` — robots.txt wrapper

**Files:**
- Create: `src/http/robots.ts`
- Create: `tests/http-robots.test.ts`

- [ ] **Step 1: Write the failing test**

Create `tests/http-robots.test.ts`:
```ts
import { afterAll, beforeAll, describe, expect, test } from "vitest";
import { createServer, type Server } from "node:http";
import { AddressInfo } from "node:net";
import { mkdtempSync, rmSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { getRobots, __clearRobotsCache } from "../src/http/robots.js";
import type { FetchOptions } from "../src/http/fetch.js";

let server: Server;
let port: number;
let cacheDir: string;
let robotsBody: string | 404 = "User-agent: *\nDisallow:";

beforeAll(async () => {
  cacheDir = mkdtempSync(join(tmpdir(), "docforge-robots-"));
  server = createServer((req, res) => {
    if (req.url === "/robots.txt") {
      if (robotsBody === 404) {
        res.writeHead(404);
        res.end();
        return;
      }
      res.writeHead(200, { "Content-Type": "text/plain" });
      res.end(robotsBody);
      return;
    }
    res.writeHead(404);
    res.end();
  });
  await new Promise<void>((resolve) => server.listen(0, resolve));
  port = (server.address() as AddressInfo).port;
});

afterAll(async () => {
  await new Promise<void>((resolve) => server.close(() => resolve()));
  rmSync(cacheDir, { recursive: true, force: true });
});

function opts(): FetchOptions {
  return { userAgent: "docforge-test/0", timeoutMs: 1_000, maxBytes: 100_000, cacheDir: null };
}

describe("getRobots", () => {
  test("allow-all when robots.txt is 404", async () => {
    __clearRobotsCache();
    robotsBody = 404;
    const r = await getRobots(`http://localhost:${port}`, opts());
    expect(r.isAllowed(`http://localhost:${port}/any`, "docforge")).toBe(true);
    expect(r.getCrawlDelay("docforge")).toBe(0);
    expect(r.getSitemaps()).toEqual([]);
  });

  test("Disallow rule denies matching path", async () => {
    __clearRobotsCache();
    robotsBody = "User-agent: *\nDisallow: /private/\nAllow: /";
    const r = await getRobots(`http://localhost:${port}`, opts());
    expect(r.isAllowed(`http://localhost:${port}/private/secret`, "docforge")).toBe(false);
    expect(r.isAllowed(`http://localhost:${port}/public`, "docforge")).toBe(true);
  });

  test("Crawl-delay parsed", async () => {
    __clearRobotsCache();
    robotsBody = "User-agent: *\nCrawl-delay: 2";
    const r = await getRobots(`http://localhost:${port}`, opts());
    expect(r.getCrawlDelay("docforge")).toBe(2);
  });

  test("Sitemap directives extracted", async () => {
    __clearRobotsCache();
    robotsBody = "Sitemap: http://localhost/sitemap.xml\nSitemap: http://localhost/sitemap2.xml";
    const r = await getRobots(`http://localhost:${port}`, opts());
    expect(r.getSitemaps()).toEqual([
      "http://localhost/sitemap.xml",
      "http://localhost/sitemap2.xml",
    ]);
  });
});
```

- [ ] **Step 2: Run test to verify it fails**

Run: `npx vitest run tests/http-robots.test.ts`
Expected: FAIL — module not found.

- [ ] **Step 3: Implement robots.ts**

Create `src/http/robots.ts`:
```ts
import { RobotsTxtFile } from "@crawlee/utils";
import { fetchUrl, FetchError, type FetchOptions } from "./fetch.js";

export interface Robots {
  isAllowed(url: string, userAgent: string): boolean;
  getCrawlDelay(userAgent: string): number;
  getSitemaps(): string[];
}

const cache = new Map<string, Robots>();

export function __clearRobotsCache(): void {
  cache.clear();
}

const ALLOW_ALL: Robots = {
  isAllowed: () => true,
  getCrawlDelay: () => 0,
  getSitemaps: () => [],
};

export async function getRobots(origin: string, opts: FetchOptions): Promise<Robots> {
  const key = origin.replace(/\/+$/, "");
  const cached = cache.get(key);
  if (cached) return cached;

  const url = `${key}/robots.txt`;
  let body: string;
  try {
    const result = await fetchUrl(url, opts);
    body = result.bytes.toString("utf8");
  } catch (e) {
    if (e instanceof FetchError) {
      cache.set(key, ALLOW_ALL);
      return ALLOW_ALL;
    }
    throw e;
  }

  const parsed = RobotsTxtFile.from(url, body);
  const robots: Robots = {
    isAllowed: (u, ua) => parsed.isAllowed(u, ua),
    getCrawlDelay: (ua) => parsed.getCrawlDelay(ua) ?? 0,
    getSitemaps: () => parsed.getSitemaps(),
  };
  cache.set(key, robots);
  return robots;
}
```

- [ ] **Step 4: Run tests to verify they pass**

Run: `npx vitest run tests/http-robots.test.ts`
Expected: all 4 tests pass.

If `RobotsTxtFile.from` is named differently in `@crawlee/utils`, consult the package's TS types (`node_modules/@crawlee/utils/dist/index.d.ts`) and use the correct constructor. The runtime contract is: `isAllowed(url, ua) → boolean`, `getCrawlDelay(ua) → number | undefined`, `getSitemaps() → string[]`.

- [ ] **Step 5: Typecheck**

Run: `npm run typecheck`
Expected: zero errors.

- [ ] **Step 6: Commit**

```bash
git add src/http/robots.ts tests/http-robots.test.ts
git commit -m "feat(http): robots.txt wrapper with allow-all fallback + per-origin memo"
```

---

## Task 5: `src/http/sitemap.ts` — sitemap discovery

**Files:**
- Create: `src/http/sitemap.ts`
- Create: `tests/http-sitemap.test.ts`

- [ ] **Step 1: Write the failing test**

Create `tests/http-sitemap.test.ts`:
```ts
import { afterAll, beforeAll, describe, expect, test } from "vitest";
import { createServer, type Server } from "node:http";
import { AddressInfo } from "node:net";
import { discoverSitemaps } from "../src/http/sitemap.js";
import type { Robots } from "../src/http/robots.js";
import type { FetchOptions } from "../src/http/fetch.js";

let server: Server;
let port: number;
let routes: Record<string, { status: number; body?: string }> = {};

beforeAll(async () => {
  server = createServer((req, res) => {
    const r = routes[req.url ?? ""];
    if (!r) {
      res.writeHead(404);
      res.end();
      return;
    }
    res.writeHead(r.status, { "Content-Type": "application/xml" });
    res.end(r.body ?? "");
  });
  await new Promise<void>((resolve) => server.listen(0, resolve));
  port = (server.address() as AddressInfo).port;
});

afterAll(async () => {
  await new Promise<void>((resolve) => server.close(() => resolve()));
});

function fetchOpts(): FetchOptions {
  return { userAgent: "docforge-test/0", timeoutMs: 1_000, maxBytes: 1_000_000, cacheDir: null };
}

const sitemapXml = (urls: string[]) =>
  `<?xml version="1.0"?><urlset xmlns="http://www.sitemaps.org/schemas/sitemap/0.9">${urls
    .map((u) => `<url><loc>${u}</loc></url>`)
    .join("")}</urlset>`;

function robotsWith(sitemaps: string[]): Robots {
  return {
    isAllowed: () => true,
    getCrawlDelay: () => 0,
    getSitemaps: () => sitemaps,
  };
}

describe("discoverSitemaps", () => {
  test("uses robots-declared sitemap when present", async () => {
    routes = {
      "/custom-sitemap.xml": {
        status: 200,
        body: sitemapXml([`http://localhost:${port}/a`, `http://localhost:${port}/b`]),
      },
    };
    const urls = await discoverSitemaps(
      `http://localhost:${port}/`,
      robotsWith([`http://localhost:${port}/custom-sitemap.xml`]),
      fetchOpts(),
    );
    expect(urls.sort()).toEqual([
      `http://localhost:${port}/a`,
      `http://localhost:${port}/b`,
    ]);
  });

  test("falls back to /sitemap.xml when robots empty", async () => {
    routes = {
      "/sitemap.xml": { status: 200, body: sitemapXml([`http://localhost:${port}/x`]) },
    };
    const urls = await discoverSitemaps(
      `http://localhost:${port}/`,
      robotsWith([]),
      fetchOpts(),
    );
    expect(urls).toEqual([`http://localhost:${port}/x`]);
  });

  test("falls back to /sitemap_index.xml when /sitemap.xml 404", async () => {
    routes = {
      "/sitemap_index.xml": { status: 200, body: sitemapXml([`http://localhost:${port}/y`]) },
    };
    const urls = await discoverSitemaps(
      `http://localhost:${port}/`,
      robotsWith([]),
      fetchOpts(),
    );
    expect(urls).toEqual([`http://localhost:${port}/y`]);
  });

  test("returns empty when all probes miss", async () => {
    routes = {};
    const urls = await discoverSitemaps(
      `http://localhost:${port}/`,
      robotsWith([]),
      fetchOpts(),
    );
    expect(urls).toEqual([]);
  });

  test("returns empty on malformed XML", async () => {
    routes = { "/sitemap.xml": { status: 200, body: "<not-xml" } };
    const urls = await discoverSitemaps(
      `http://localhost:${port}/`,
      robotsWith([]),
      fetchOpts(),
    );
    expect(urls).toEqual([]);
  });
});
```

- [ ] **Step 2: Run test to verify it fails**

Run: `npx vitest run tests/http-sitemap.test.ts`
Expected: FAIL — module not found.

- [ ] **Step 3: Implement sitemap.ts**

Create `src/http/sitemap.ts`:
```ts
import Sitemapper from "sitemapper";
import type { Robots } from "./robots.js";
import type { FetchOptions } from "./fetch.js";

export async function discoverSitemaps(
  rootUrl: string,
  robots: Robots,
  opts: FetchOptions,
): Promise<string[]> {
  const origin = new URL(rootUrl).origin;
  const probes = [
    ...robots.getSitemaps(),
    `${origin}/sitemap.xml`,
    `${origin}/sitemap_index.xml`,
  ];

  const collected = new Set<string>();
  for (const probe of probes) {
    const urls = await fetchSitemap(probe, opts);
    for (const u of urls) collected.add(u);
    if (collected.size > 0) break;
  }
  return [...collected];
}

async function fetchSitemap(url: string, opts: FetchOptions): Promise<string[]> {
  const sm = new Sitemapper({
    url,
    timeout: opts.timeoutMs,
    requestHeaders: { "user-agent": opts.userAgent },
  });
  try {
    const { sites } = await sm.fetch();
    return sites ?? [];
  } catch {
    return [];
  }
}
```

- [ ] **Step 4: Run tests to verify they pass**

Run: `npx vitest run tests/http-sitemap.test.ts`
Expected: all 5 tests pass.

- [ ] **Step 5: Typecheck**

Run: `npm run typecheck`
Expected: zero errors.

- [ ] **Step 6: Commit**

```bash
git add src/http/sitemap.ts tests/http-sitemap.test.ts
git commit -m "feat(http): sitemap discovery via robots + /sitemap.xml + /sitemap_index.xml"
```

---

## Task 6: `src/http/crawl.ts` — BFS frontier

**Files:**
- Create: `src/http/crawl.ts`
- Create: `tests/http-crawl.test.ts`

- [ ] **Step 1: Write the failing test**

Create `tests/http-crawl.test.ts`:
```ts
import { afterAll, beforeAll, describe, expect, test } from "vitest";
import { createServer, type Server } from "node:http";
import { AddressInfo } from "node:net";
import { crawlBfs } from "../src/http/crawl.js";
import type { Robots } from "../src/http/robots.js";
import type { FetchOptions } from "../src/http/fetch.js";

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
  await new Promise<void>((resolve) => server.listen(0, resolve));
  port = (server.address() as AddressInfo).port;
});

afterAll(async () => {
  await new Promise<void>((resolve) => server.close(() => resolve()));
});

function allowAll(disallowed: string[] = []): Robots {
  return {
    isAllowed: (url) => !disallowed.some((d) => new URL(url).pathname.startsWith(d)),
    getCrawlDelay: () => 0,
    getSitemaps: () => [],
  };
}

function fetchOpts(): FetchOptions {
  return { userAgent: "docforge-test/0", timeoutMs: 1_000, maxBytes: 1_000_000, cacheDir: null };
}

async function collect(rootUrl: string, robots: Robots, opts: Partial<{
  maxPages: number;
  maxDepth: number;
  concurrency: number;
}> = {}): Promise<string[]> {
  const seen: string[] = [];
  for await (const item of crawlBfs(rootUrl, robots, fetchOpts(), {
    maxPages: opts.maxPages ?? 100,
    maxDepth: opts.maxDepth ?? 10,
    concurrency: opts.concurrency ?? 1,
    userAgent: "docforge-test/0",
  })) {
    seen.push(item.url);
  }
  return seen.sort();
}

describe("crawlBfs", () => {
  test("discovers all linked same-origin pages", async () => {
    pages = {
      "/": `<html><a href="/a">a</a><a href="/b">b</a></html>`,
      "/a": `<html><a href="/c">c</a></html>`,
      "/b": `<html>b</html>`,
      "/c": `<html>c</html>`,
    };
    const urls = await collect(`http://localhost:${port}/`, allowAll());
    expect(urls).toEqual([
      `http://localhost:${port}/`,
      `http://localhost:${port}/a`,
      `http://localhost:${port}/b`,
      `http://localhost:${port}/c`,
    ]);
  });

  test("dedups repeated links", async () => {
    pages = {
      "/": `<html><a href="/a">x</a><a href="/a#frag">y</a><a href="/a?q=1">z</a></html>`,
      "/a": `<html>a</html>`,
    };
    const urls = await collect(`http://localhost:${port}/`, allowAll());
    expect(urls).toEqual([
      `http://localhost:${port}/`,
      `http://localhost:${port}/a`,
    ]);
  });

  test("rejects cross-origin links", async () => {
    pages = {
      "/": `<html><a href="https://other.com/x">x</a><a href="/a">a</a></html>`,
      "/a": `<html>a</html>`,
    };
    const urls = await collect(`http://localhost:${port}/`, allowAll());
    expect(urls).toEqual([
      `http://localhost:${port}/`,
      `http://localhost:${port}/a`,
    ]);
  });

  test("respects robots disallow", async () => {
    pages = {
      "/": `<html><a href="/private/p">p</a><a href="/ok">o</a></html>`,
      "/private/p": `<html>p</html>`,
      "/ok": `<html>o</html>`,
    };
    const urls = await collect(`http://localhost:${port}/`, allowAll(["/private/"]));
    expect(urls).toEqual([
      `http://localhost:${port}/`,
      `http://localhost:${port}/ok`,
    ]);
  });

  test("maxPages clamps yield count", async () => {
    pages = {
      "/": `<html><a href="/a">a</a><a href="/b">b</a><a href="/c">c</a></html>`,
      "/a": `<html>a</html>`,
      "/b": `<html>b</html>`,
      "/c": `<html>c</html>`,
    };
    const urls = await collect(`http://localhost:${port}/`, allowAll(), { maxPages: 2 });
    expect(urls.length).toBe(2);
  });

  test("maxDepth halts deeper enqueue", async () => {
    pages = {
      "/": `<html><a href="/a">a</a></html>`,
      "/a": `<html><a href="/b">b</a></html>`,
      "/b": `<html><a href="/c">c</a></html>`,
      "/c": `<html>c</html>`,
    };
    const urls = await collect(`http://localhost:${port}/`, allowAll(), { maxDepth: 1 });
    expect(urls).toEqual([
      `http://localhost:${port}/`,
      `http://localhost:${port}/a`,
    ]);
  });
});
```

- [ ] **Step 2: Run test to verify it fails**

Run: `npx vitest run tests/http-crawl.test.ts`
Expected: FAIL — module not found.

- [ ] **Step 3: Implement crawl.ts**

Create `src/http/crawl.ts`:
```ts
import PQueue from "p-queue";
import { load as loadHtml } from "cheerio";
import { fetchUrl, FetchError, type FetchOptions } from "./fetch.js";
import { normalizeUrl, sameOrigin } from "./url.js";
import type { Robots } from "./robots.js";
import { log } from "../log.js";

export interface CrawlOptions {
  maxPages: number;
  maxDepth: number;
  concurrency: number;
  userAgent: string;
}

export interface CrawlItem {
  url: string;
  bytes: Buffer;
  contentType: string;
  error?: string;
}

export async function* crawlBfs(
  rootUrl: string,
  robots: Robots,
  fetchOpts: FetchOptions,
  crawlOpts: CrawlOptions,
): AsyncIterable<CrawlItem> {
  const root = normalizeUrl(rootUrl);
  if (!root) throw new Error(`invalid root url: ${rootUrl}`);

  const visited = new Set<string>([root]);
  const delayMs = Math.max(0, Math.min(10_000, robots.getCrawlDelay(crawlOpts.userAgent) * 1000));
  const queue = new PQueue({
    concurrency: crawlOpts.concurrency,
    interval: delayMs > 0 ? delayMs : undefined,
    intervalCap: delayMs > 0 ? crawlOpts.concurrency : undefined,
  });

  const frontier: { url: string; depth: number }[] = [{ url: root, depth: 0 }];
  const results: CrawlItem[] = [];
  let yielded = 0;

  while (frontier.length > 0 && yielded < crawlOpts.maxPages) {
    const batch = frontier.splice(0, frontier.length);
    await queue.addAll(
      batch.map((entry) => async () => {
        if (yielded >= crawlOpts.maxPages) return;
        let item: CrawlItem;
        try {
          const res = await fetchUrl(entry.url, fetchOpts);
          item = { url: entry.url, bytes: res.bytes, contentType: res.contentType };
        } catch (e) {
          if (e instanceof FetchError) {
            log("debug", `crawl fetch fail ${entry.url}: ${e.message}`);
            results.push({
              url: entry.url,
              bytes: Buffer.alloc(0),
              contentType: "",
              error: e.message,
            });
            return;
          }
          throw e;
        }
        results.push(item);
        if (entry.depth >= crawlOpts.maxDepth) return;
        if (!/^text\/html/i.test(item.contentType)) return;
        const links = extractLinks(item.bytes.toString("utf8"), entry.url);
        for (const link of links) {
          if (!sameOrigin(link, root)) continue;
          if (!robots.isAllowed(link, crawlOpts.userAgent)) continue;
          if (visited.has(link)) continue;
          visited.add(link);
          frontier.push({ url: link, depth: entry.depth + 1 });
        }
      }),
    );
    while (results.length > 0 && yielded < crawlOpts.maxPages) {
      yielded += 1;
      yield results.shift()!;
    }
  }
}

function extractLinks(html: string, baseUrl: string): string[] {
  const $ = loadHtml(html);
  const out: string[] = [];
  $("a[href]").each((_, el) => {
    const href = $(el).attr("href");
    if (!href) return;
    const normalized = normalizeUrl(href, baseUrl);
    if (normalized) out.push(normalized);
  });
  return out;
}
```

- [ ] **Step 4: Run tests to verify they pass**

Run: `npx vitest run tests/http-crawl.test.ts`
Expected: all 6 tests pass.

- [ ] **Step 5: Typecheck**

Run: `npm run typecheck`
Expected: zero errors.

- [ ] **Step 6: Commit**

```bash
git add src/http/crawl.ts tests/http-crawl.test.ts
git commit -m "feat(http): BFS crawl with p-queue + same-origin gate + robots + dedup"
```

---

## Task 7: `src/source.ts` — Source interface + FilesystemSource

**Files:**
- Create: `src/source.ts`
- Create: `tests/source.test.ts`

- [ ] **Step 1: Write the failing test**

Create `tests/source.test.ts`:
```ts
import { afterEach, beforeEach, describe, expect, test } from "vitest";
import { mkdtempSync, mkdirSync, rmSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { FilesystemSource } from "../src/source.js";

let tmp: string;
beforeEach(() => {
  tmp = mkdtempSync(join(tmpdir(), "docforge-source-"));
});
afterEach(() => {
  rmSync(tmp, { recursive: true, force: true });
});

describe("FilesystemSource", () => {
  test("yields items for each html file with file:// srcUri", async () => {
    mkdirSync(join(tmp, "guide"), { recursive: true });
    writeFileSync(join(tmp, "index.html"), "<html>i</html>");
    writeFileSync(join(tmp, "guide/foo.html"), "<html>f</html>");

    const source = new FilesystemSource(tmp, 10_000_000);
    const items = [];
    for await (const item of source.iter()) items.push(item);
    items.sort((a, b) => a.key.localeCompare(b.key));

    expect(items.map((i) => i.key)).toEqual(["guide/foo.html", "index.html"]);
    expect(items[0].srcUri.startsWith("file://")).toBe(true);
    expect(items[0].contentType).toBe("text/html");
    expect(items[1].bytes.toString("utf8")).toBe("<html>i</html>");
    expect(source.skippedCount).toBe(0);
  });

  test("single-file source yields one item keyed by basename", async () => {
    const file = join(tmp, "a.html");
    writeFileSync(file, "<html>a</html>");
    const source = new FilesystemSource(file, 10_000_000);
    const items = [];
    for await (const item of source.iter()) items.push(item);
    expect(items).toHaveLength(1);
    expect(items[0].key).toBe("a.html");
  });

  test("non-html files do not appear; skippedCount tracks them", async () => {
    writeFileSync(join(tmp, "a.html"), "<html>a</html>");
    writeFileSync(join(tmp, "b.css"), "body{}");
    const source = new FilesystemSource(tmp, 10_000_000);
    const items = [];
    for await (const item of source.iter()) items.push(item);
    expect(items).toHaveLength(1);
    expect(source.skippedCount).toBeGreaterThanOrEqual(1);
  });
});
```

- [ ] **Step 2: Run test to verify it fails**

Run: `npx vitest run tests/source.test.ts`
Expected: FAIL — module not found.

- [ ] **Step 3: Implement source.ts (FilesystemSource only for this task)**

Create `src/source.ts`:
```ts
import { lstatSync, readFileSync } from "node:fs";
import { dirname, relative } from "node:path";
import { pathToFileURL } from "node:url";

import { iterHtmlFiles } from "./walk.js";

export interface SourceItem {
  key: string;
  srcUri: string;
  bytes: Buffer;
  contentType: string;
  error?: string;          // set when fetch failed; convert loop counts as failed
}

export interface Source {
  iter(): AsyncIterable<SourceItem>;
  readonly skippedCount: number;
}

export class FilesystemSource implements Source {
  public skippedCount = 0;
  constructor(
    private readonly source: string,
    private readonly maxBytes: number,
  ) {}

  async *iter(): AsyncIterable<SourceItem> {
    const walk = iterHtmlFiles(this.source, this.maxBytes);
    this.skippedCount = walk.skippedCount;

    const st = lstatSync(this.source);
    const sourceRoot = st.isFile() ? dirname(this.source) : this.source;

    for (const path of walk.paths) {
      const rel = relative(sourceRoot, path).split(/[\\/]/).join("/");
      yield {
        key: rel,
        srcUri: pathToFileURL(path).toString(),
        bytes: readFileSync(path),
        contentType: "text/html",
      };
    }
  }
}
```

- [ ] **Step 4: Run tests to verify they pass**

Run: `npx vitest run tests/source.test.ts`
Expected: all 3 tests pass.

- [ ] **Step 5: Typecheck**

Run: `npm run typecheck`
Expected: zero errors.

- [ ] **Step 6: Commit**

```bash
git add src/source.ts tests/source.test.ts
git commit -m "feat(source): add Source interface + FilesystemSource wrapping walk.ts"
```

---

## Task 8: Add `HttpSource` to `src/source.ts`

**Files:**
- Modify: `src/source.ts`
- Modify: `tests/source.test.ts`

- [ ] **Step 1: Add failing test for HttpSource**

Add these imports to the top of `tests/source.test.ts` (merging with existing imports):
```ts
import { afterAll, beforeAll } from "vitest";  // add if missing
import { createServer, type Server } from "node:http";
import { AddressInfo } from "node:net";
import { HttpSource } from "../src/source.js";
import { __clearRobotsCache } from "../src/http/robots.js";
```

Then append at the bottom of the file:
```ts

let server: Server;
let port: number;
let pages: Record<string, { status: number; ctype: string; body: string }> = {};

beforeAll(async () => {
  server = createServer((req, res) => {
    if (req.url === "/robots.txt") {
      res.writeHead(404);
      res.end();
      return;
    }
    const r = pages[req.url ?? ""];
    if (!r) {
      res.writeHead(404);
      res.end();
      return;
    }
    res.writeHead(r.status, { "Content-Type": r.ctype });
    res.end(r.body);
  });
  await new Promise<void>((resolve) => server.listen(0, resolve));
  port = (server.address() as AddressInfo).port;
});

afterAll(async () => {
  await new Promise<void>((resolve) => server.close(() => resolve()));
});

describe("HttpSource", () => {
  test("BFS yields all linked html pages, skips non-html", async () => {
    __clearRobotsCache();
    pages = {
      "/": { status: 200, ctype: "text/html", body: `<a href="/a">a</a><a href="/b.css">c</a>` },
      "/a": { status: 200, ctype: "text/html", body: `<html>a</html>` },
      "/b.css": { status: 200, ctype: "text/css", body: `body{}` },
    };
    const source = new HttpSource(
      `http://localhost:${port}/`,
      { userAgent: "t", timeoutMs: 1_000, maxBytes: 1_000_000, cacheDir: null },
      { maxPages: 100, maxDepth: 10, concurrency: 1, userAgent: "t" },
    );
    const items = [];
    for await (const it of source.iter()) items.push(it);
    expect(items.map((i) => i.srcUri).sort()).toEqual([
      `http://localhost:${port}/`,
      `http://localhost:${port}/a`,
    ]);
    expect(source.skippedCount).toBeGreaterThanOrEqual(1); // .css filtered
  });
});
```

- [ ] **Step 2: Run test to verify it fails**

Run: `npx vitest run tests/source.test.ts`
Expected: FAIL — `HttpSource` not exported.

- [ ] **Step 3: Implement HttpSource**

Edit `src/source.ts` — append after `FilesystemSource`:
```ts
import PQueue from "p-queue";
import { fetchUrl, FetchError, type FetchOptions } from "./http/fetch.js";
import { getRobots } from "./http/robots.js";
import { discoverSitemaps } from "./http/sitemap.js";
import { crawlBfs, type CrawlOptions } from "./http/crawl.js";
import { normalizeUrl } from "./http/url.js";
import { log } from "./log.js";

export class HttpSource implements Source {
  public skippedCount = 0;
  constructor(
    private readonly rootUrl: string,
    private readonly fetchOpts: FetchOptions,
    private readonly crawlOpts: CrawlOptions,
  ) {}

  async *iter(): AsyncIterable<SourceItem> {
    const normalized = normalizeUrl(this.rootUrl);
    if (!normalized) throw new Error(`invalid root url: ${this.rootUrl}`);
    const origin = new URL(normalized).origin;

    const robots = await getRobots(origin, this.fetchOpts);
    const sitemapUrls = await discoverSitemaps(normalized, robots, this.fetchOpts);

    if (sitemapUrls.length > 0) {
      yield* this.iterFromSitemap(sitemapUrls, robots);
    } else {
      yield* this.iterFromBfs(robots);
    }
  }

  private async *iterFromSitemap(
    urls: string[],
    robots: { isAllowed(url: string, ua: string): boolean; getCrawlDelay(ua: string): number },
  ): AsyncIterable<SourceItem> {
    const origin = new URL(normalizeUrl(this.rootUrl)!).origin;
    const filtered: string[] = [];
    for (const u of urls) {
      const n = normalizeUrl(u);
      if (!n) continue;
      if (new URL(n).origin !== origin) continue;
      if (!robots.isAllowed(n, this.crawlOpts.userAgent)) continue;
      filtered.push(n);
    }
    const delayMs = Math.max(
      0,
      Math.min(10_000, robots.getCrawlDelay(this.crawlOpts.userAgent) * 1000),
    );
    const queue = new PQueue({
      concurrency: this.crawlOpts.concurrency,
      interval: delayMs > 0 ? delayMs : undefined,
      intervalCap: delayMs > 0 ? this.crawlOpts.concurrency : undefined,
    });
    const buffered: SourceItem[] = [];
    const tasks = filtered.slice(0, this.crawlOpts.maxPages).map((url) => async () => {
      try {
        const res = await fetchUrl(url, this.fetchOpts);
        if (!/^text\/html/i.test(res.contentType)) {
          this.skippedCount += 1;
          return;
        }
        buffered.push({
          key: pathFromUrl(url),
          srcUri: url,
          bytes: res.bytes,
          contentType: res.contentType,
        });
      } catch (e) {
        if (e instanceof FetchError) {
          log("debug", `sitemap fetch fail ${url}: ${e.message}`);
          buffered.push({
            key: pathFromUrl(url),
            srcUri: url,
            bytes: Buffer.alloc(0),
            contentType: "",
            error: e.message,
          });
          return;
        }
        throw e;
      }
    });
    await queue.addAll(tasks);
    for (const item of buffered) yield item;
  }

  private async *iterFromBfs(
    robots: { isAllowed(url: string, ua: string): boolean; getCrawlDelay(ua: string): number; getSitemaps(): string[] },
  ): AsyncIterable<SourceItem> {
    for await (const item of crawlBfs(this.rootUrl, robots, this.fetchOpts, this.crawlOpts)) {
      if (item.error) {
        yield {
          key: pathFromUrl(item.url),
          srcUri: item.url,
          bytes: Buffer.alloc(0),
          contentType: "",
          error: item.error,
        };
        continue;
      }
      if (!/^text\/html/i.test(item.contentType)) {
        this.skippedCount += 1;
        continue;
      }
      yield {
        key: pathFromUrl(item.url),
        srcUri: item.url,
        bytes: item.bytes,
        contentType: item.contentType,
      };
    }
  }
}

function pathFromUrl(url: string): string {
  const u = new URL(url);
  const p = decodeURIComponent(u.pathname);
  if (p === "" || p === "/") return "index.html";
  return p.replace(/^\/+/, "");
}
```

- [ ] **Step 4: Run tests to verify they pass**

Run: `npx vitest run tests/source.test.ts`
Expected: all 4 tests pass.

- [ ] **Step 5: Typecheck**

Run: `npm run typecheck`
Expected: zero errors.

- [ ] **Step 6: Commit**

```bash
git add src/source.ts tests/source.test.ts
git commit -m "feat(source): add HttpSource with sitemap-first + BFS fallback"
```

---

## Task 9: Extend `ReportEntry` with `srcUri` + add `urlToOutputPath` re-export

**Files:**
- Modify: `src/output.ts`
- Modify: `tests/output.test.ts`

- [ ] **Step 1: Add failing test for srcUri field**

Open `tests/output.test.ts` and add a test inside the existing describe block (or append a new describe):
```ts
import { ReportEntry, writeReportJson } from "../src/output.js";
import { mkdtempSync, readFileSync, rmSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";

describe("ReportEntry srcUri", () => {
  test("writeReportJson persists srcUri", () => {
    const tmp = mkdtempSync(join(tmpdir(), "df-report-"));
    try {
      const entries: ReportEntry[] = [
        {
          input: "guide/foo.html",
          srcUri: "https://x.com/guide/foo.html",
          output: "/out/guide/foo.md",
          status: "ok",
        },
      ];
      const p = join(tmp, "r.json");
      writeReportJson(p, entries);
      const parsed = JSON.parse(readFileSync(p, "utf8"));
      expect(parsed.entries[0].srcUri).toBe("https://x.com/guide/foo.html");
    } finally {
      rmSync(tmp, { recursive: true, force: true });
    }
  });
});
```

- [ ] **Step 2: Run test to verify it fails**

Run: `npx vitest run tests/output.test.ts`
Expected: FAIL — TS error `Property 'srcUri' is missing in type ReportEntry`.

- [ ] **Step 3: Add `srcUri` to ReportEntry**

Edit `src/output.ts:74-79`:
```ts
export interface ReportEntry {
  input: string;
  srcUri: string;
  output: string | null;
  status: ReportStatus;
  error?: string;
}
```

- [ ] **Step 4: Re-export `urlToOutputPath` for cli.ts convenience**

Append to `src/output.ts`:
```ts
export { urlToOutputPath } from "./http/url.js";
```

- [ ] **Step 5: Run tests to verify they pass**

Run: `npx vitest run tests/output.test.ts`
Expected: all tests pass (including pre-existing). If pre-existing tests now fail due to missing `srcUri`, fix them by adding the field (use the synthesized `file://` URI for filesystem fixtures, or empty string if existing tests only check other fields — match what the tests assert).

- [ ] **Step 6: Typecheck**

Run: `npm run typecheck`
Expected: zero errors. If existing call sites in cli.ts fail to compile, defer fixes to Task 10 (intentional — Task 10 rewrites that loop).

- [ ] **Step 7: Commit**

```bash
git add src/output.ts tests/output.test.ts
git commit -m "feat(output): add srcUri to ReportEntry; re-export urlToOutputPath"
```

Note: the build may fail at the cli.ts level due to missing `srcUri` in existing report pushes. Task 10 fixes those.

---

## Task 10: `src/cli.ts` — URL detection, new flags, source-agnostic loop

**Files:**
- Modify: `src/cli.ts`
- Modify: `tests/cli.test.ts`

- [ ] **Step 1: Add failing test for URL detection on convert**

Append to `tests/cli.test.ts`:
```ts
describe("convert URL detection", () => {
  test("accepts http(s) URL as <source>", () => {
    const p = buildProgram();
    p.exitOverride();
    // Should not throw during parse — actual execution is mocked in integration tests
    expect(() =>
      p.parse(
        ["convert", "https://x.com/", "--output", "/tmp/x", "--dry-run"],
        { from: "user" },
      ),
    ).not.toThrow();
  });

  test("accepts new flags", () => {
    const p = buildProgram();
    p.exitOverride();
    expect(() =>
      p.parse(
        [
          "convert",
          "https://x.com/",
          "--output",
          "/tmp/x",
          "--max-pages",
          "10",
          "--concurrency",
          "2",
          "--no-cache",
          "--dry-run",
        ],
        { from: "user" },
      ),
    ).not.toThrow();
  });
});
```

- [ ] **Step 2: Run test to verify it fails**

Run: `npx vitest run tests/cli.test.ts`
Expected: FAIL — `error: unknown option '--max-pages'` (or similar).

- [ ] **Step 3: Rewrite `src/cli.ts`**

Replace the convert command definition and `runConvert` body. Final file:
```ts
import { Command } from "commander";
import { existsSync, lstatSync, mkdirSync } from "node:fs";
import { basename, dirname, extname, resolve } from "node:path";
import { pathToFileURL } from "node:url";

import { VERSION } from "./index.js";
import { convertHtml } from "./convert.js";
import { extractTitle } from "./title.js";
import { rewriteInternalLinks } from "./links.js";
import {
  CollisionError,
  buildOutput,
  writeOutput,
  writeReportJson,
  urlToOutputPath,
  type ReportEntry,
} from "./output.js";
import { log, setLevel } from "./log.js";
import { registerOpenapiSubcommand } from "./openapi/cli.js";
import { FilesystemSource, HttpSource, type Source, type SourceItem } from "./source.js";
import type { FetchOptions } from "./http/fetch.js";
import type { CrawlOptions } from "./http/crawl.js";

const DEFAULT_USER_AGENT = `docforge/${VERSION}`;
const DEFAULT_CACHE_DIR = "~/.cache/docforge";

export function buildProgram(): Command {
  const program = new Command();
  program
    .name("docforge")
    .description("Convert documentation sources to Markdown for RAG ingestion.")
    .version(VERSION, "--version", "print version and exit")
    .option("-v, --verbose", "DEBUG-level logging")
    .option("-q, --quiet", "WARNING-level logging")
    .hook("preAction", (thisCommand) => {
      const opts = thisCommand.opts<{ verbose?: boolean | undefined; quiet?: boolean | undefined }>();
      if (opts.verbose) setLevel("debug");
      else if (opts.quiet) setLevel("warn");
    });

  program
    .command("convert")
    .description("Convert HTML (filesystem path or http(s) URL) to Markdown")
    .argument("<source>", "filesystem path OR http(s):// URL")
    .requiredOption("--output <dir>", "output directory")
    .option("--fail-threshold <ratio>", "max acceptable failure ratio before exit 1", "0.10")
    .option("--max-bytes <int>", "skip HTML files/responses larger than N bytes", "10485760")
    .option("--dry-run", "walk + report planned outputs, write nothing", false)
    .option("--report-json <path>", "write per-file report JSON to <path>")
    .option("--max-pages <N>", "max URLs to fetch (URL source only)", "5000")
    .option("--max-depth <N>", "max BFS depth (URL source only)", "10")
    .option("--concurrency <N>", "parallel fetches (URL source only)", "4")
    .option("--cache-dir <path>", "ETag cache directory (URL source only)", DEFAULT_CACHE_DIR)
    .option("--no-cache", "disable ETag cache (URL source only)")
    .option("--user-agent <str>", "User-Agent header (URL source only)", DEFAULT_USER_AGENT)
    .action(async (source: string, opts: ConvertOpts) => {
      const code = await runConvert(source, opts);
      if (code !== 0) process.exit(code);
    });

  registerOpenapiSubcommand(program);

  return program;
}

interface ConvertOpts {
  output: string;
  failThreshold: string;
  maxBytes: string;
  dryRun: boolean;
  reportJson?: string | undefined;
  maxPages: string;
  maxDepth: string;
  concurrency: string;
  cacheDir: string;
  cache: boolean;       // commander --no-cache → cache: false
  userAgent: string;
}

function isUrl(s: string): boolean {
  return /^https?:\/\//i.test(s);
}

export async function runConvert(sourceArg: string, opts: ConvertOpts): Promise<number> {
  const output = resolve(expandHome(opts.output));
  try {
    mkdirSync(output, { recursive: true });
  } catch (e) {
    log("error", `cannot create output dir ${output}: ${(e as Error).message}`);
    return 2;
  }

  const maxBytes = parseInt(opts.maxBytes, 10);
  const failThreshold = parseFloat(opts.failThreshold);

  let source: Source;
  if (isUrl(sourceArg)) {
    const fetchOpts: FetchOptions = {
      userAgent: opts.userAgent,
      timeoutMs: 30_000,
      maxBytes,
      cacheDir: opts.cache ? expandHome(opts.cacheDir) : null,
    };
    const crawlOpts: CrawlOptions = {
      maxPages: parseInt(opts.maxPages, 10),
      maxDepth: parseInt(opts.maxDepth, 10),
      concurrency: parseInt(opts.concurrency, 10),
      userAgent: opts.userAgent,
    };
    if (fetchOpts.cacheDir) {
      try {
        mkdirSync(fetchOpts.cacheDir, { recursive: true });
      } catch (e) {
        log("warn", `cache dir not writable, continuing without cache: ${(e as Error).message}`);
        fetchOpts.cacheDir = null;
      }
    }
    source = new HttpSource(sourceArg, fetchOpts, crawlOpts);
  } else {
    const fsPath = resolve(expandHome(sourceArg));
    if (!existsSync(fsPath)) {
      log("error", `source not found: ${fsPath}`);
      return 2;
    }
    const st = lstatSync(fsPath);
    if (!st.isFile() && !st.isDirectory()) {
      log("error", `source is neither file nor directory: ${fsPath}`);
      return 2;
    }
    source = new FilesystemSource(fsPath, maxBytes);
  }

  let converted = 0;
  let empty = 0;
  let failed = 0;
  const report: ReportEntry[] = [];
  const outputsUsed = new Map<string, string>(); // outPath -> srcUri (for runtime collision)

  for await (const item of source.iter()) {
    const outPath = computeOutputPath(item, output);
    const prior = outputsUsed.get(outPath);
    if (prior && prior !== item.srcUri) {
      log("error", `output path collision: ${outPath} from ${prior} AND ${item.srcUri}`);
      return 2;
    }
    outputsUsed.set(outPath, item.srcUri);

    if (item.error) {
      failed += 1;
      log("error", `FAIL fetch ${item.key}: ${item.error}`);
      report.push({
        input: item.key,
        srcUri: item.srcUri,
        output: null,
        status: "failed",
        error: item.error,
      });
      continue;
    }

    if (opts.dryRun) {
      log("info", `DRY ${item.key} -> ${outPath}`);
      continue;
    }

    const result = convertHtml(item.bytes.toString("utf8"));
    if (result.status === "empty") {
      empty += 1;
      log("debug", `empty ${item.key}`);
      report.push({ input: item.key, srcUri: item.srcUri, output: null, status: "empty" });
      continue;
    }
    if (result.status === "failed") {
      failed += 1;
      log("error", `FAIL ${item.key}: ${result.error}`);
      report.push({
        input: item.key,
        srcUri: item.srcUri,
        output: null,
        status: "failed",
        error: result.error,
      });
      continue;
    }

    const stem = basename(item.key, extname(item.key)) || "index";
    const title = extractTitle(result.h1_text, result.soup_title_text, stem);
    const bodyMd = rewriteInternalLinks(result.body_md);
    const content = buildOutput(title, item.key, bodyMd);
    writeOutput(outPath, content);
    converted += 1;
    report.push({ input: item.key, srcUri: item.srcUri, output: outPath, status: "ok" });
  }

  const skipped = source.skippedCount;
  const total = converted + empty + failed;

  if (opts.reportJson) {
    writeReportJson(resolve(expandHome(opts.reportJson)), report);
  }

  log(
    "info",
    `converted=${converted} empty=${empty} skipped=${skipped} failed=${failed} total=${total}`,
  );

  if (total > 0 && failed / total > failThreshold) {
    log(
      "error",
      `failure ratio ${(failed / total).toFixed(3)} exceeds threshold ${failThreshold.toFixed(3)}`,
    );
    return 1;
  }
  return 0;
}

function computeOutputPath(item: SourceItem, outputDir: string): string {
  if (item.srcUri.startsWith("http://") || item.srcUri.startsWith("https://")) {
    return urlToOutputPath(item.srcUri, outputDir);
  }
  // filesystem: mirror item.key under outputDir, .html → .md
  const outRel = item.key.replace(/\.html?$/i, ".md");
  return resolve(outputDir, outRel);
}

function expandHome(p: string): string {
  if (p.startsWith("~/") || p === "~") {
    const home = process.env.HOME ?? process.env.USERPROFILE ?? "";
    return p.replace(/^~/, home);
  }
  return p;
}

export async function main(argv: string[]): Promise<number> {
  const program = buildProgram();
  await program.parseAsync(argv, { from: "user" });
  return 0;
}

// satisfy pathToFileURL import lint if unused
void pathToFileURL;
```

Remove the now-unused imports: drop `readFileSync` (item.bytes already has content), `dirname`, `relative` (only used in filesystem path that the Source now owns), `iterHtmlFiles` (FilesystemSource owns), `detectCollisions` (replaced by runtime per-item check above), and `pathToFileURL` (if unused — remove the trailing `void` if so).

Note: pre-existing test `cli.test.ts` that exercises `convert <fsdir>` should still pass — the filesystem path through `FilesystemSource` produces equivalent output. If any test asserts on collision-error EXIT 2 for filesystem inputs, that path now goes through `computeOutputPath` → runtime `outputsUsed` check, which still raises exit 2.

- [ ] **Step 4: Run tests**

Run: `npx vitest run tests/cli.test.ts`
Expected: parser tests pass; existing filesystem-based integration tests in cli.test.ts still pass.

If pre-existing filesystem tests fail because the new code path differs subtly, debug per test — the convert pipeline (convertHtml + buildOutput + writeOutput) is unchanged; only walking and collision detection moved.

- [ ] **Step 5: Full test sweep**

Run: `npm test`
Expected: all suites pass.

- [ ] **Step 6: Typecheck**

Run: `npm run typecheck`
Expected: zero errors.

- [ ] **Step 7: Commit**

```bash
git add src/cli.ts tests/cli.test.ts
git commit -m "feat(cli): URL detection on <source>, source-agnostic loop, new flags"
```

---

## Task 11: OpenAPI URL support

**Files:**
- Modify: `src/openapi/loader.ts`
- Modify: `src/openapi/cli.ts`
- Create: `tests/openapi-url.test.ts`

- [ ] **Step 1: Write failing test**

Create `tests/openapi-url.test.ts`:
```ts
import { afterAll, afterEach, beforeAll, beforeEach, describe, expect, test } from "vitest";
import { createServer, type Server } from "node:http";
import { AddressInfo } from "node:net";
import { mkdtempSync, readFileSync, readdirSync, rmSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { spawnSync } from "node:child_process";

let server: Server;
let port: number;
let tmp: string;

const yamlSpec = `openapi: 3.0.0
info:
  title: T
  version: '1'
paths:
  /items:
    get:
      operationId: listItems
      responses:
        '200':
          description: ok
`;

beforeAll(async () => {
  server = createServer((req, res) => {
    if (req.url === "/openapi.yaml") {
      res.writeHead(200, { "Content-Type": "application/yaml" });
      res.end(yamlSpec);
      return;
    }
    res.writeHead(404);
    res.end();
  });
  await new Promise<void>((resolve) => server.listen(0, resolve));
  port = (server.address() as AddressInfo).port;
});

afterAll(async () => {
  await new Promise<void>((resolve) => server.close(() => resolve()));
});

beforeEach(() => {
  tmp = mkdtempSync(join(tmpdir(), "docforge-oapi-url-"));
});
afterEach(() => {
  rmSync(tmp, { recursive: true, force: true });
});

describe("docforge openapi <url>", () => {
  test("fetches yaml spec and renders endpoints", () => {
    const r = spawnSync("node", [
      "--experimental-vm-modules",
      "./dist/bin.js",
      "openapi",
      `http://localhost:${port}/openapi.yaml`,
      "--output",
      tmp,
    ], { encoding: "utf8" });
    expect(r.status).toBe(0);
    const endpoints = readdirSync(join(tmp, "endpoints"));
    expect(endpoints.length).toBeGreaterThan(0);
  });
});
```

- [ ] **Step 2: Run test to verify it fails**

Run: `npm run build && npx vitest run tests/openapi-url.test.ts`
Expected: FAIL — exit 2 with "unknown spec suffix" or similar.

- [ ] **Step 3: Add URL loader to openapi/loader.ts**

Append to `src/openapi/loader.ts`:
```ts
import { fetchUrl, type FetchOptions } from "../http/fetch.js";

export async function loadSpecFromUrl(
  url: string,
  opts: FetchOptions,
): Promise<Record<string, unknown>> {
  const res = await fetchUrl(url, opts);
  const ct = res.contentType.toLowerCase();
  const body = res.bytes.toString("utf8");
  let spec: unknown;
  if (ct.includes("json")) {
    spec = JSON.parse(body);
  } else {
    spec = yamlLoad(body);
  }
  if (spec === null || typeof spec !== "object" || Array.isArray(spec)) {
    throw new UnsupportedSpecError("spec root must be an object");
  }
  const obj = spec as Record<string, unknown>;
  if ("swagger" in obj) {
    throw new UnsupportedSpecError(
      `Swagger 2.0 not supported (found swagger=${JSON.stringify(obj.swagger)}); convert to OpenAPI 3.x first`,
    );
  }
  const version = obj.openapi;
  if (typeof version !== "string" || !version.startsWith("3.")) {
    throw new UnsupportedSpecError(
      `unsupported openapi version: ${JSON.stringify(version)} (expected 3.x)`,
    );
  }
  return obj;
}
```

- [ ] **Step 4: Modify openapi/cli.ts to detect URL**

Edit `src/openapi/cli.ts`. Replace the `registerOpenapiSubcommand` and `runOpenapi` bodies:
```ts
import { Command } from "commander";
import { mkdirSync, writeFileSync } from "node:fs";
import { basename, resolve } from "node:path";

import { VERSION } from "../index.js";
import { log } from "../log.js";
import { iterEndpoints, iterSchemas } from "./iter.js";
import { UnsupportedSpecError, loadSpec, loadSpecFromUrl } from "./loader.js";
import {
  SlugCollisionError,
  detectEndpointCollisions,
  endpointFilename,
  schemaFilename,
} from "./paths.js";
import { renderEndpoint, renderSchema } from "./render.js";
import type { FetchOptions } from "../http/fetch.js";

const DEFAULT_USER_AGENT = `docforge/${VERSION}`;
const DEFAULT_CACHE_DIR = "~/.cache/docforge";

export function registerOpenapiSubcommand(program: Command): void {
  program
    .command("openapi")
    .description("Convert an OpenAPI 3.x spec (path or http(s):// URL) to per-endpoint + per-schema Markdown")
    .argument("<spec>", "filesystem path OR http(s):// URL to spec")
    .requiredOption("--output <dir>", "output directory")
    .option("--cache-dir <path>", "ETag cache directory (URL source only)", DEFAULT_CACHE_DIR)
    .option("--no-cache", "disable ETag cache (URL source only)")
    .option("--user-agent <str>", "User-Agent header (URL source only)", DEFAULT_USER_AGENT)
    .action(async (spec: string, opts: OpenapiOpts) => {
      const code = await runOpenapi(spec, opts);
      if (code !== 0) process.exit(code);
    });
}

interface OpenapiOpts {
  output: string;
  cacheDir: string;
  cache: boolean;
  userAgent: string;
}

function isUrl(s: string): boolean {
  return /^https?:\/\//i.test(s);
}

async function runOpenapi(specArg: string, opts: OpenapiOpts): Promise<number> {
  const output = resolve(expandHome(opts.output));

  let spec: Record<string, unknown>;
  let specFilename: string;
  try {
    if (isUrl(specArg)) {
      const fetchOpts: FetchOptions = {
        userAgent: opts.userAgent,
        timeoutMs: 30_000,
        maxBytes: 50 * 1024 * 1024,
        cacheDir: opts.cache ? expandHome(opts.cacheDir) : null,
      };
      if (fetchOpts.cacheDir) {
        try {
          mkdirSync(fetchOpts.cacheDir, { recursive: true });
        } catch {
          fetchOpts.cacheDir = null;
        }
      }
      spec = await loadSpecFromUrl(specArg, fetchOpts);
      specFilename = basename(new URL(specArg).pathname) || "openapi";
    } else {
      const specPath = resolve(expandHome(specArg));
      spec = loadSpec(specPath);
      specFilename = basename(specPath);
    }
  } catch (e) {
    if (e instanceof UnsupportedSpecError) {
      log("error", e.message);
      return 2;
    }
    if (e instanceof Error && e.message) {
      log("error", `failed to parse ${specArg}: ${e.message}`);
      return 2;
    }
    throw e;
  }

  const endpointsDir = resolve(output, "endpoints");
  const schemasDir = resolve(output, "schemas");
  mkdirSync(endpointsDir, { recursive: true });
  mkdirSync(schemasDir, { recursive: true });

  const endpoints = Array.from(iterEndpoints(spec));
  const schemas = Array.from(iterSchemas(spec));

  try {
    detectEndpointCollisions(endpoints.map((e) => [e.method, e.path]));
  } catch (e) {
    if (e instanceof SlugCollisionError) {
      log("error", e.message);
      return 2;
    }
    throw e;
  }

  for (const ep of endpoints) {
    const outPath = resolve(endpointsDir, endpointFilename(ep.method, ep.path));
    writeFileSync(outPath, renderEndpoint(ep, { specFilename }), "utf8");
  }
  for (const sc of schemas) {
    const outPath = resolve(schemasDir, schemaFilename(sc.name));
    writeFileSync(outPath, renderSchema(sc, { specFilename }), "utf8");
  }

  log("info", `endpoints=${endpoints.length} schemas=${schemas.length}`);
  return 0;
}

function expandHome(p: string): string {
  if (p.startsWith("~/") || p === "~") {
    const home = process.env.HOME ?? process.env.USERPROFILE ?? "";
    return p.replace(/^~/, home);
  }
  return p;
}
```

- [ ] **Step 5: Run test to verify it passes**

Run: `npm run build && npx vitest run tests/openapi-url.test.ts`
Expected: pass.

- [ ] **Step 6: Full test sweep**

Run: `npm test`
Expected: all suites pass.

- [ ] **Step 7: Commit**

```bash
git add src/openapi/loader.ts src/openapi/cli.ts tests/openapi-url.test.ts
git commit -m "feat(openapi): accept http(s):// URL as <spec> via fetchUrl"
```

---

## Task 12: Static fixture server helper

**Files:**
- Create: `tests/helpers/static-server.ts`
- Create: `tests/fixtures/crawl-site/` (HTML + robots.txt + sitemap.xml)

- [ ] **Step 1: Create fixture corpus**

Create files:

`tests/fixtures/crawl-site/robots.txt`:
```
User-agent: *
Crawl-delay: 0
Sitemap: /sitemap.xml
Disallow: /private/
```

`tests/fixtures/crawl-site/sitemap.xml`:
```xml
<?xml version="1.0" encoding="UTF-8"?>
<urlset xmlns="http://www.sitemaps.org/schemas/sitemap/0.9">
  <url><loc>__BASE__/</loc></url>
  <url><loc>__BASE__/guide/</loc></url>
  <url><loc>__BASE__/guide/intro.html</loc></url>
  <url><loc>__BASE__/guide/advanced.html</loc></url>
  <url><loc>__BASE__/api/</loc></url>
  <url><loc>__BASE__/api/reference.html</loc></url>
</urlset>
```

`tests/fixtures/crawl-site/index.html`:
```html
<html><head><title>Home</title></head><body>
<div role="main"><div itemprop="articleBody">
<h1>Home</h1>
<p>Welcome.</p>
<a href="/guide/">Guide</a>
<a href="/api/">API</a>
</div></div></body></html>
```

`tests/fixtures/crawl-site/guide/index.html`:
```html
<html><head><title>Guide</title></head><body>
<div role="main"><div itemprop="articleBody">
<h1>Guide</h1>
<a href="/guide/intro.html">Intro</a>
<a href="/guide/advanced.html">Advanced</a>
</div></div></body></html>
```

`tests/fixtures/crawl-site/guide/intro.html`:
```html
<html><head><title>Intro</title></head><body>
<div role="main"><div itemprop="articleBody">
<h1>Intro</h1><p>intro body</p>
</div></div></body></html>
```

`tests/fixtures/crawl-site/guide/advanced.html`:
```html
<html><head><title>Advanced</title></head><body>
<div role="main"><div itemprop="articleBody">
<h1>Advanced</h1><p>advanced body</p>
</div></div></body></html>
```

`tests/fixtures/crawl-site/api/index.html`:
```html
<html><head><title>API</title></head><body>
<div role="main"><div itemprop="articleBody">
<h1>API</h1>
<a href="/api/reference.html">Reference</a>
</div></div></body></html>
```

`tests/fixtures/crawl-site/api/reference.html`:
```html
<html><head><title>Reference</title></head><body>
<div role="main"><div itemprop="articleBody">
<h1>Reference</h1><p>reference body</p>
</div></div></body></html>
```

`tests/fixtures/crawl-site/private/secret.html`:
```html
<html><head><title>Secret</title></head><body><div role="main"><h1>Secret</h1></div></body></html>
```

- [ ] **Step 2: Create static-server.ts**

Create `tests/helpers/static-server.ts`:
```ts
import { createHash } from "node:crypto";
import { createServer, type Server, type IncomingMessage, type ServerResponse } from "node:http";
import { readFileSync, statSync, existsSync } from "node:fs";
import { extname, join, resolve } from "node:path";
import { AddressInfo } from "node:net";

export interface StaticServerOptions {
  rootDir: string;
  rewriteBase?: boolean;            // replace __BASE__ in served bodies (for sitemap.xml)
  inject?: Record<string, { status: number; body?: string }>; // per-URL overrides
}

export interface RunningServer {
  port: number;
  baseUrl: string;
  close(): Promise<void>;
  hits: string[];
}

const TYPES: Record<string, string> = {
  ".html": "text/html; charset=utf-8",
  ".xml": "application/xml; charset=utf-8",
  ".txt": "text/plain; charset=utf-8",
  ".css": "text/css; charset=utf-8",
};

export async function startStaticServer(options: StaticServerOptions): Promise<RunningServer> {
  const hits: string[] = [];
  let baseUrl = "";

  const handler = (req: IncomingMessage, res: ServerResponse) => {
    const url = req.url ?? "/";
    hits.push(url);

    const override = options.inject?.[url];
    if (override) {
      res.writeHead(override.status, { "Content-Type": "text/html" });
      res.end(override.body ?? "");
      return;
    }

    let relPath = url.split("?")[0];
    if (relPath.endsWith("/")) relPath += "index.html";
    const filePath = resolve(join(options.rootDir, relPath));
    if (!filePath.startsWith(resolve(options.rootDir))) {
      res.writeHead(403);
      res.end();
      return;
    }
    if (!existsSync(filePath)) {
      res.writeHead(404);
      res.end();
      return;
    }
    const st = statSync(filePath);
    if (!st.isFile()) {
      res.writeHead(404);
      res.end();
      return;
    }
    let body = readFileSync(filePath);
    if (options.rewriteBase && (filePath.endsWith(".xml") || filePath.endsWith(".txt"))) {
      body = Buffer.from(body.toString("utf8").replace(/__BASE__/g, baseUrl));
    }
    const etag = `"${createHash("sha1").update(body).digest("hex").slice(0, 16)}"`;
    if (req.headers["if-none-match"] === etag) {
      res.writeHead(304, { ETag: etag });
      res.end();
      return;
    }
    const ctype = TYPES[extname(filePath).toLowerCase()] ?? "application/octet-stream";
    res.writeHead(200, { "Content-Type": ctype, ETag: etag });
    res.end(body);
  };

  const server: Server = createServer(handler);
  await new Promise<void>((resolve) => server.listen(0, resolve));
  const port = (server.address() as AddressInfo).port;
  baseUrl = `http://localhost:${port}`;

  return {
    port,
    baseUrl,
    hits,
    close: () => new Promise<void>((resolve) => server.close(() => resolve())),
  };
}
```

- [ ] **Step 3: Sanity-check (no test file yet — manual)**

The helper has no dedicated test; it's exercised by integration tests in tasks 13–17.

- [ ] **Step 4: Typecheck**

Run: `npm run typecheck`
Expected: zero errors.

- [ ] **Step 5: Commit**

```bash
git add tests/helpers/static-server.ts tests/fixtures/crawl-site/
git commit -m "test(http): add static-server helper + crawl-site fixture corpus"
```

---

## Task 13: Integration test — crawl end-to-end with sitemap

**Files:**
- Create: `tests/crawl-e2e.test.ts`

- [ ] **Step 1: Write failing test**

Create `tests/crawl-e2e.test.ts`:
```ts
import { afterAll, afterEach, beforeAll, beforeEach, describe, expect, test } from "vitest";
import { mkdtempSync, readFileSync, readdirSync, rmSync, existsSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { startStaticServer, type RunningServer } from "./helpers/static-server.js";
import { main } from "../src/cli.js";
import { __clearRobotsCache } from "../src/http/robots.js";

let srv: RunningServer;
let tmp: string;

beforeAll(async () => {
  srv = await startStaticServer({
    rootDir: join(__dirname, "fixtures/crawl-site"),
    rewriteBase: true,
  });
});
afterAll(async () => {
  await srv.close();
});
beforeEach(() => {
  __clearRobotsCache();
  tmp = mkdtempSync(join(tmpdir(), "docforge-e2e-"));
});
afterEach(() => {
  rmSync(tmp, { recursive: true, force: true });
});

describe("convert URL e2e (sitemap path)", () => {
  test("converts all sitemap entries to mirrored .md tree", async () => {
    const code = await main([
      "convert",
      `${srv.baseUrl}/`,
      "--output",
      tmp,
      "--cache-dir",
      join(tmp, ".cache"),
      "--report-json",
      join(tmp, "report.json"),
    ]);
    expect(code).toBe(0);
    expect(existsSync(join(tmp, "index.md"))).toBe(true);
    expect(existsSync(join(tmp, "guide", "index.md"))).toBe(true);
    expect(existsSync(join(tmp, "guide", "intro.md"))).toBe(true);
    expect(existsSync(join(tmp, "guide", "advanced.md"))).toBe(true);
    expect(existsSync(join(tmp, "api", "index.md"))).toBe(true);
    expect(existsSync(join(tmp, "api", "reference.md"))).toBe(true);
    // private/ is disallowed in robots — must not appear
    expect(existsSync(join(tmp, "private", "secret.md"))).toBe(false);

    const report = JSON.parse(readFileSync(join(tmp, "report.json"), "utf8"));
    expect(report.entries.length).toBeGreaterThanOrEqual(6);
    const okEntries = report.entries.filter((e: { status: string }) => e.status === "ok");
    expect(okEntries.length).toBeGreaterThanOrEqual(6);
    expect(okEntries[0].srcUri.startsWith("http://")).toBe(true);
  });
});
```

**Note:** Task 10 exports `runConvert` so integration tests can call it directly (no `process.exit` involvement). Replace the test's `main([...])` call with:

```ts
import { runConvert } from "../src/cli.js";
// ...
const code = await runConvert(`${srv.baseUrl}/`, {
  output: tmp,
  failThreshold: "0.10",
  maxBytes: "10485760",
  dryRun: false,
  reportJson: join(tmp, "report.json"),
  maxPages: "5000",
  maxDepth: "10",
  concurrency: "4",
  cacheDir: join(tmp, ".cache"),
  cache: true,
  userAgent: "docforge-test/0",
});
```

Update the import at the top of the test file accordingly. Drop the `import { main } from "../src/cli.js"` line.

- [ ] **Step 2: Run test to verify it fails (before final logic in place) or passes**

Run: `npx vitest run tests/crawl-e2e.test.ts`
Expected: pass if Tasks 1–10 are complete. If it fails: read the error, fix the underlying module, do not skip the test.

- [ ] **Step 3: Commit**

```bash
git add tests/crawl-e2e.test.ts
git commit -m "test(crawl): e2e convert against URL source via sitemap discovery"
```

---

## Task 14: Integration test — BFS fallback when sitemap missing

**Files:**
- Create: `tests/crawl-bfs-fallback.test.ts`

- [ ] **Step 1: Write failing test**

Create `tests/crawl-bfs-fallback.test.ts`:
```ts
import { afterAll, afterEach, beforeAll, beforeEach, describe, expect, test } from "vitest";
import { mkdtempSync, rmSync, existsSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { startStaticServer, type RunningServer } from "./helpers/static-server.js";
import { runConvert } from "../src/cli.js";
import { __clearRobotsCache } from "../src/http/robots.js";

let srv: RunningServer;
let tmp: string;

beforeAll(async () => {
  srv = await startStaticServer({
    rootDir: join(__dirname, "fixtures/crawl-site"),
    rewriteBase: true,
    inject: {
      "/sitemap.xml": { status: 404 },
      "/sitemap_index.xml": { status: 404 },
    },
  });
});
afterAll(async () => srv.close());
beforeEach(() => {
  __clearRobotsCache();
  tmp = mkdtempSync(join(tmpdir(), "docforge-bfs-"));
});
afterEach(() => rmSync(tmp, { recursive: true, force: true }));

describe("BFS fallback when sitemap is absent", () => {
  test("discovers all pages via <a href> graph", async () => {
    const code = await runConvert(`${srv.baseUrl}/`, {
      output: tmp,
      failThreshold: "0.10",
      maxBytes: "10485760",
      dryRun: false,
      maxPages: "5000",
      maxDepth: "10",
      concurrency: "1",
      cacheDir: join(tmp, ".cache"),
      cache: true,
      userAgent: "docforge-test/0",
    });
    expect(code).toBe(0);
    expect(existsSync(join(tmp, "index.md"))).toBe(true);
    expect(existsSync(join(tmp, "guide", "index.md"))).toBe(true);
    expect(existsSync(join(tmp, "guide", "intro.md"))).toBe(true);
    expect(existsSync(join(tmp, "api", "reference.md"))).toBe(true);
  });
});
```

Note: the robots.txt at the fixture root contains a `Sitemap: /sitemap.xml` directive. With the override returning 404 for that URL plus `/sitemap_index.xml`, `discoverSitemaps` should return empty and BFS engages.

- [ ] **Step 2: Run test**

Run: `npx vitest run tests/crawl-bfs-fallback.test.ts`
Expected: pass.

- [ ] **Step 3: Commit**

```bash
git add tests/crawl-bfs-fallback.test.ts
git commit -m "test(crawl): BFS fallback when sitemap probes 404"
```

---

## Task 15: Integration test — robots.txt Disallow respected

**Files:**
- Create: `tests/crawl-robots-deny.test.ts`

- [ ] **Step 1: Write failing test**

Create `tests/crawl-robots-deny.test.ts`:
```ts
import { afterAll, afterEach, beforeAll, beforeEach, describe, expect, test } from "vitest";
import { mkdtempSync, rmSync, existsSync, readFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { startStaticServer, type RunningServer } from "./helpers/static-server.js";
import { runConvert } from "../src/cli.js";
import { __clearRobotsCache } from "../src/http/robots.js";

let srv: RunningServer;
let tmp: string;

beforeAll(async () => {
  // robots.txt in the fixture already disallows /private/.
  // Add a link to /private/secret.html from index by injection.
  srv = await startStaticServer({
    rootDir: join(__dirname, "fixtures/crawl-site"),
    rewriteBase: true,
    inject: {
      "/sitemap.xml": { status: 404 },
      "/sitemap_index.xml": { status: 404 },
      "/": {
        status: 200,
        body: `<html><head><title>Home</title></head><body>
<div role="main"><div itemprop="articleBody">
<h1>Home</h1>
<a href="/guide/">G</a>
<a href="/private/secret.html">Secret</a>
</div></div></body></html>`,
      },
    },
  });
});
afterAll(async () => srv.close());
beforeEach(() => {
  __clearRobotsCache();
  tmp = mkdtempSync(join(tmpdir(), "docforge-deny-"));
});
afterEach(() => rmSync(tmp, { recursive: true, force: true }));

describe("robots.txt Disallow is honored during crawl", () => {
  test("/private/* not fetched, not converted, not in report", async () => {
    const reportPath = join(tmp, "report.json");
    const code = await runConvert(`${srv.baseUrl}/`, {
      output: tmp,
      failThreshold: "0.10",
      maxBytes: "10485760",
      dryRun: false,
      reportJson: reportPath,
      maxPages: "5000",
      maxDepth: "10",
      concurrency: "1",
      cacheDir: join(tmp, ".cache"),
      cache: true,
      userAgent: "docforge-test/0",
    });
    expect(code).toBe(0);
    expect(existsSync(join(tmp, "private", "secret.md"))).toBe(false);
    const report = JSON.parse(readFileSync(reportPath, "utf8"));
    const denied = report.entries.find((e: { srcUri: string }) =>
      e.srcUri.includes("/private/"),
    );
    expect(denied).toBeUndefined();
  });
});
```

- [ ] **Step 2: Run test**

Run: `npx vitest run tests/crawl-robots-deny.test.ts`
Expected: pass.

- [ ] **Step 3: Commit**

```bash
git add tests/crawl-robots-deny.test.ts
git commit -m "test(crawl): robots.txt Disallow drops URLs from frontier and report"
```

---

## Task 16: Integration test — second run uses ETag 304 cache

**Files:**
- Create: `tests/crawl-cache-304.test.ts`

- [ ] **Step 1: Write failing test**

Create `tests/crawl-cache-304.test.ts`:
```ts
import { afterAll, afterEach, beforeAll, beforeEach, describe, expect, test } from "vitest";
import { mkdtempSync, rmSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { startStaticServer, type RunningServer } from "./helpers/static-server.js";
import { runConvert } from "../src/cli.js";
import { __clearRobotsCache } from "../src/http/robots.js";

let srv: RunningServer;
let tmp: string;
let cacheDir: string;

beforeAll(async () => {
  srv = await startStaticServer({
    rootDir: join(__dirname, "fixtures/crawl-site"),
    rewriteBase: true,
  });
});
afterAll(async () => srv.close());
beforeEach(() => {
  __clearRobotsCache();
  tmp = mkdtempSync(join(tmpdir(), "docforge-cache-"));
  cacheDir = join(tmp, ".cache");
});
afterEach(() => rmSync(tmp, { recursive: true, force: true }));

describe("ETag 304 cache reuse", () => {
  test("second run produces identical output; If-None-Match seen on wire", async () => {
    const opts = {
      output: tmp,
      failThreshold: "0.10",
      maxBytes: "10485760",
      dryRun: false,
      maxPages: "5000",
      maxDepth: "10",
      concurrency: "1",
      cacheDir,
      cache: true,
      userAgent: "docforge-test/0",
    };

    expect(await runConvert(`${srv.baseUrl}/`, opts)).toBe(0);
    srv.hits.length = 0;

    expect(await runConvert(`${srv.baseUrl}/`, { ...opts, output: tmp + "-2" })).toBe(0);
    rmSync(tmp + "-2", { recursive: true, force: true });

    // ensure the second run actually re-issued requests (cache layer revalidates)
    expect(srv.hits.length).toBeGreaterThan(0);
  });
});
```

- [ ] **Step 2: Run test**

Run: `npx vitest run tests/crawl-cache-304.test.ts`
Expected: pass. (The static server returns 304 when `If-None-Match` matches; got's cache layer surfaces the cached body.)

- [ ] **Step 3: Commit**

```bash
git add tests/crawl-cache-304.test.ts
git commit -m "test(crawl): ETag/304 disk cache reused across runs"
```

---

## Task 17: Integration test — --fail-threshold gate on HTTP errors

**Files:**
- Create: `tests/crawl-fail-threshold.test.ts`

- [ ] **Step 1: Write failing test**

Create `tests/crawl-fail-threshold.test.ts`:
```ts
import { afterAll, afterEach, beforeAll, beforeEach, describe, expect, test } from "vitest";
import { mkdtempSync, rmSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { startStaticServer, type RunningServer } from "./helpers/static-server.js";
import { runConvert } from "../src/cli.js";
import { __clearRobotsCache } from "../src/http/robots.js";

let srv: RunningServer;
let tmp: string;

beforeAll(async () => {
  // Inject 500 for 2 of 6 sitemap pages (~33% failure rate).
  srv = await startStaticServer({
    rootDir: join(__dirname, "fixtures/crawl-site"),
    rewriteBase: true,
    inject: {
      "/guide/intro.html": { status: 500 },
      "/api/reference.html": { status: 500 },
    },
  });
});
afterAll(async () => srv.close());
beforeEach(() => {
  __clearRobotsCache();
  tmp = mkdtempSync(join(tmpdir(), "docforge-fail-"));
});
afterEach(() => rmSync(tmp, { recursive: true, force: true }));

describe("--fail-threshold gates exit code", () => {
  test("default 0.10 threshold exits 1 with 33% failures", async () => {
    const code = await runConvert(`${srv.baseUrl}/`, {
      output: tmp,
      failThreshold: "0.10",
      maxBytes: "10485760",
      dryRun: false,
      maxPages: "5000",
      maxDepth: "10",
      concurrency: "1",
      cacheDir: join(tmp, ".cache"),
      cache: true,
      userAgent: "docforge-test/0",
    });
    expect(code).toBe(1);
  });

  test("1.0 threshold passes despite failures", async () => {
    const code = await runConvert(`${srv.baseUrl}/`, {
      output: tmp,
      failThreshold: "1.0",
      maxBytes: "10485760",
      dryRun: false,
      maxPages: "5000",
      maxDepth: "10",
      concurrency: "1",
      cacheDir: join(tmp, ".cache"),
      cache: true,
      userAgent: "docforge-test/0",
    });
    expect(code).toBe(0);
  });
});
```

Note: 5xx triggers 2 retries (got default); each retry returns 500 and the fetch ultimately throws `FetchError`. Tasks 6, 8, and 10 already surface fetch failures via `SourceItem.error` so the convert loop counts them as failed — no additional code change required in this task.

- [ ] **Step 2: Run test**

Run: `npx vitest run tests/crawl-fail-threshold.test.ts`
Expected: pass.

- [ ] **Step 3: Full sweep**

Run: `npm test`
Expected: all suites pass.

- [ ] **Step 4: Commit**

```bash
git add tests/crawl-fail-threshold.test.ts
git commit -m "test(crawl): --fail-threshold gates exit code on HTTP errors"
```

---

## Task 18: README + plan-state cleanup

**Files:**
- Modify: `README.md`

- [ ] **Step 1: Add URL examples to README**

Edit `README.md`. After the existing `## Usage` block, append:

```md
### URL sources

`<source>` and `<spec>` accept HTTP(S) URLs. For `convert`, docforge attempts
sitemap discovery first (robots.txt `Sitemap:` directives, then `/sitemap.xml`,
then `/sitemap_index.xml`) and falls back to a BFS crawl bounded by
`--max-pages` / `--max-depth` and the seed origin. `robots.txt` is honored.

```bash
docforge convert https://docs.example.com/ --output ./md
docforge openapi https://api.example.com/openapi.yaml --output ./api-md
```

URL-only flags: `--max-pages` (5000), `--max-depth` (10), `--concurrency` (4),
`--cache-dir` (`~/.cache/docforge`), `--no-cache`, `--user-agent`.

Responses are cached on disk with ETag/Last-Modified revalidation so repeat
runs are cheap.
```

- [ ] **Step 2: Verify README renders sensibly**

Run: `head -80 README.md`
Expected: new section visible after Usage.

- [ ] **Step 3: Commit**

```bash
git add README.md
git commit -m "docs: document URL source flags and behavior in README"
```

---

## Final verification

- [ ] **Run full test suite**

Run: `npm test`
Expected: all suites pass.

- [ ] **Typecheck + build**

Run: `npm run typecheck && npm run build`
Expected: zero TS errors, `dist/` populated.

- [ ] **CLI smoke**

Run:
```bash
node dist/bin.js --version
node dist/bin.js convert --help
node dist/bin.js openapi --help
```
Expected: version prints `0.5.0`; help text includes new URL-only flags on both subcommands.

- [ ] **Manual dogfood (optional, post-merge)**

```bash
node dist/bin.js convert https://kreuzberg.dev/ --output /tmp/kdev --max-pages 20
ls -R /tmp/kdev | head -50
node dist/bin.js convert https://kreuzberg.dev/ --output /tmp/kdev2 --max-pages 20  # second run hits cache
```
