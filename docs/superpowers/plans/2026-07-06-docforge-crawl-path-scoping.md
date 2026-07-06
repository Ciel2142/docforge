# Seed Path-Prefix Crawl Scoping Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Seeding `https://example.com/docs/` crawls only `/docs/**` (sitemap and BFS modes), default on, with `--scope origin` restoring whole-origin behavior.

**Architecture:** A pure scope predicate (`scopePrefixFromSeed` + `underScope`) lives in `src/http/url.ts`. `CrawlOptions` gains an optional `scopePrefix`; `crawlBfs` applies it at link admission, `HttpSource.iter` applies it to the sitemap URL list before the sitemap-vs-BFS mode decision (empty in-scope sitemap falls back to BFS). CLI and MCP compute the prefix from the seed URL and thread it through.

**Tech Stack:** TypeScript (Node 18+, ESM), vitest, commander, existing test helpers (`tests/helpers/static-server.ts`, `tests/mcp/helpers/http-stub.ts`).

**Spec:** `docs/superpowers/specs/2026-07-06-docforge-crawl-path-scoping-design.md` (bead docf-sxe)

## Global Constraints

- No new dependencies.
- `scopePrefix?: string` — `undefined` means unrestricted (scope=origin, or root seed). Never pass `"/"` as a prefix; derivation returns `null` for root and callers omit the field.
- `singlePage`, `llms-full`, `llms-index` modes are NEVER scope-filtered.
- Existing tests must stay green: every current CLI/MCP crawl test seeds the origin root, which derives a `null` prefix (unrestricted) — zero behavior change for them.
- Commit style: conventional commits (`feat(crawl): …`), each ending with:
  ```
  Co-Authored-By: Claude Fable 5 <noreply@anthropic.com>
  ```
- Run `npm run typecheck` before every commit.

---

### Task 1: Scope predicate in `src/http/url.ts`

**Files:**
- Modify: `src/http/url.ts` (add two exported functions after `sameOrigin`, ~line 40)
- Test: `tests/http-url.test.ts` (append two describe blocks)

**Interfaces:**
- Consumes: `normalizeUrl(input: string): string | null` (already in `src/http/url.ts`).
- Produces:
  - `scopePrefixFromSeed(seedUrl: string): string | null` — `null` = unrestricted (root seed or invalid URL); otherwise a path prefix that always starts and ends with `/` (e.g. `"/docs/"`).
  - `underScope(url: string, prefix: string): boolean` — true when the normalized URL's pathname is under `prefix` (or is the extensionless seed page itself). Tasks 2–5 rely on these exact names/signatures.

- [ ] **Step 1: Write the failing tests**

Append to `tests/http-url.test.ts` (the file already imports from `../src/http/url.js`; extend that import):

```ts
import {
  normalizeUrl,
  relativizeSameOriginLinks,
  sameOrigin,
  scopePrefixFromSeed,
  underScope,
  urlToOutputPath,
} from "../src/http/url.js";
```

(Replace the existing import block with the above — same names plus the two new ones, alphabetical order.)

Append at the end of the file:

```ts
describe("scopePrefixFromSeed", () => {
  test("root seed is unrestricted", () => {
    expect(scopePrefixFromSeed("https://x.com/")).toBe(null);
    expect(scopePrefixFromSeed("https://x.com")).toBe(null);
  });

  test("trailing-slash seed uses its own path", () => {
    expect(scopePrefixFromSeed("https://x.com/docs/")).toBe("/docs/");
    expect(scopePrefixFromSeed("https://x.com/a/b/")).toBe("/a/b/");
  });

  test("extensionless seed is treated as a directory", () => {
    expect(scopePrefixFromSeed("https://x.com/docs")).toBe("/docs/");
    expect(scopePrefixFromSeed("https://x.com/a/b/c")).toBe("/a/b/c/");
  });

  test("seed with file extension scopes to its directory", () => {
    expect(scopePrefixFromSeed("https://x.com/docs/intro.html")).toBe("/docs/");
  });

  test("dotted segment counts as a file (scopes wider)", () => {
    expect(scopePrefixFromSeed("https://x.com/docs/v1.2")).toBe("/docs/");
  });

  test("file at root is unrestricted", () => {
    expect(scopePrefixFromSeed("https://x.com/intro.html")).toBe(null);
  });

  test("query and fragment are ignored", () => {
    expect(scopePrefixFromSeed("https://x.com/docs/?q=1#frag")).toBe("/docs/");
  });

  test("invalid url returns null", () => {
    expect(scopePrefixFromSeed("not a url")).toBe(null);
  });
});

describe("underScope", () => {
  test("path under prefix matches", () => {
    expect(underScope("https://x.com/docs/a", "/docs/")).toBe(true);
    expect(underScope("https://x.com/docs/deep/page.html", "/docs/")).toBe(true);
  });

  test("prefix itself matches", () => {
    expect(underScope("https://x.com/docs/", "/docs/")).toBe(true);
  });

  test("extensionless seed page itself matches", () => {
    expect(underScope("https://x.com/docs", "/docs/")).toBe(true);
  });

  test("sibling with shared string prefix does not match", () => {
    expect(underScope("https://x.com/docsother", "/docs/")).toBe(false);
    expect(underScope("https://x.com/docsother/a", "/docs/")).toBe(false);
  });

  test("outside prefix does not match", () => {
    expect(underScope("https://x.com/blog/b", "/docs/")).toBe(false);
    expect(underScope("https://x.com/", "/docs/")).toBe(false);
  });

  test("invalid url does not match", () => {
    expect(underScope("not a url", "/docs/")).toBe(false);
  });
});
```

- [ ] **Step 2: Run tests to verify they fail**

Run: `npx vitest run tests/http-url.test.ts`
Expected: FAIL — `scopePrefixFromSeed` / `underScope` are not exported (`SyntaxError` or `undefined is not a function`).

- [ ] **Step 3: Implement**

In `src/http/url.ts`, insert after the `sameOrigin` function (after line 40):

```ts
/**
 * Derive the crawl scope prefix from a seed URL (wget --no-parent semantics).
 * Returns null when unrestricted: root seed, file at root, or invalid URL.
 * A non-null result always starts and ends with "/" (e.g. "/docs/").
 *
 * An extensionless last segment ("/docs") is treated as a directory, not a
 * page — the common docs-seed form; strict dirname would silently mean
 * whole-origin. Any dotted last segment ("/docs/v1.2", "/docs/intro.html")
 * scopes to its directory: erring wider never loses pages.
 */
export function scopePrefixFromSeed(seedUrl: string): string | null {
  const normalized = normalizeUrl(seedUrl);
  if (!normalized) return null;
  const path = new URL(normalized).pathname;
  if (path === "/") return null;
  if (path.endsWith("/")) return path;
  const lastSegment = path.split("/").pop() ?? "";
  if (lastSegment.includes(".")) {
    const dir = path.slice(0, path.lastIndexOf("/") + 1);
    return dir === "/" ? null : dir;
  }
  return `${path}/`;
}

/**
 * True when `url`'s pathname is under `prefix` ("/docs/" admits "/docs/a"
 * and "/docs/" itself), or is the extensionless seed page ("/docs" when the
 * prefix is "/docs/"). Origin is NOT checked here — callers pair this with
 * sameOrigin / an origin filter.
 */
export function underScope(url: string, prefix: string): boolean {
  const normalized = normalizeUrl(url);
  if (!normalized) return false;
  const path = new URL(normalized).pathname;
  return path.startsWith(prefix) || `${path}/` === prefix;
}
```

- [ ] **Step 4: Run tests to verify they pass**

Run: `npx vitest run tests/http-url.test.ts`
Expected: PASS (all, including pre-existing tests).

- [ ] **Step 5: Typecheck and commit**

```bash
npm run typecheck
git add src/http/url.ts tests/http-url.test.ts
git commit -m "feat(crawl): scopePrefixFromSeed + underScope predicates (docf-sxe)

Co-Authored-By: Claude Fable 5 <noreply@anthropic.com>"
```

---

### Task 2: BFS link admission respects `scopePrefix`

**Files:**
- Modify: `src/http/crawl.ts` (CrawlOptions interface ~line 8-17; link admission ~line 77-83; import ~line 4)
- Test: `tests/http-crawl.test.ts` (extend `collect` helper + append tests)

**Interfaces:**
- Consumes: `underScope(url, prefix)` from Task 1.
- Produces: `CrawlOptions.scopePrefix?: string` — optional field; when set, `crawlBfs` never enqueues a link whose path is outside the prefix. Tasks 3–5 set this field.

- [ ] **Step 1: Write the failing tests**

In `tests/http-crawl.test.ts`, replace the `collect` helper (lines 43-59) with:

```ts
async function collect(rootUrl: string, robots: Robots, opts: Partial<{
  maxPages: number;
  maxDepth: number;
  concurrency: number;
  scopePrefix: string;
}> = {}): Promise<string[]> {
  const seen: string[] = [];
  for await (const item of crawlBfs(rootUrl, robots, fetchOpts(), {
    maxPages: opts.maxPages ?? 100,
    maxDepth: opts.maxDepth ?? 10,
    concurrency: opts.concurrency ?? 1,
    userAgent: "docforge-test/0",
    llmsFullMode: "off" as const,
    ...(opts.scopePrefix !== undefined ? { scopePrefix: opts.scopePrefix } : {}),
  })) {
    seen.push(item.url);
  }
  return seen.sort();
}
```

Append inside the `describe("crawlBfs", ...)` block:

```ts
  test("scopePrefix restricts link admission to the prefix subtree", async () => {
    pages = {
      "/docs/": `<html><a href="/docs/a">a</a><a href="/blog/b">b</a></html>`,
      "/docs/a": `<html>a</html>`,
      "/blog/b": `<html>b</html>`,
    };
    const urls = await collect(`http://localhost:${port}/docs/`, allowAll(), {
      scopePrefix: "/docs/",
    });
    expect(urls).toEqual([
      `http://localhost:${port}/docs/`,
      `http://localhost:${port}/docs/a`,
    ]);
  });

  test("without scopePrefix the whole origin is crawled (regression)", async () => {
    pages = {
      "/docs/": `<html><a href="/docs/a">a</a><a href="/blog/b">b</a></html>`,
      "/docs/a": `<html>a</html>`,
      "/blog/b": `<html>b</html>`,
    };
    const urls = await collect(`http://localhost:${port}/docs/`, allowAll());
    expect(urls).toEqual([
      `http://localhost:${port}/blog/b`,
      `http://localhost:${port}/docs/`,
      `http://localhost:${port}/docs/a`,
    ]);
  });
```

- [ ] **Step 2: Run tests to verify the new one fails**

Run: `npx vitest run tests/http-crawl.test.ts`
Expected: FAIL — "scopePrefix restricts…" test sees `/blog/b` in the result (field is ignored; TS may also error on the unknown option field — either failure mode is fine). The regression test passes.

- [ ] **Step 3: Implement**

In `src/http/crawl.ts`:

Line 4, extend the import:

```ts
import { normalizeUrl, sameOrigin, underScope } from "./url.js";
```

In `CrawlOptions` (after `excludeHosts?: string[];`):

```ts
  scopePrefix?: string; // path prefix (e.g. "/docs/"); undefined = unrestricted
```

In the link-admission loop (currently lines 77-83), add the scope check after `sameOrigin`, before robots:

```ts
        for (const link of links) {
          if (!sameOrigin(link, root)) continue;
          if (crawlOpts.scopePrefix && !underScope(link, crawlOpts.scopePrefix)) continue;
          if (!robots.isAllowed(link, crawlOpts.userAgent)) continue;
          if (visited.has(link)) continue;
          visited.add(link);
          frontier.push({ url: link, depth: entry.depth + 1 });
        }
```

- [ ] **Step 4: Run tests to verify they pass**

Run: `npx vitest run tests/http-crawl.test.ts`
Expected: PASS (8 tests).

- [ ] **Step 5: Typecheck and commit**

```bash
npm run typecheck
git add src/http/crawl.ts tests/http-crawl.test.ts
git commit -m "feat(crawl): scopePrefix bounds BFS link admission (docf-sxe)

Co-Authored-By: Claude Fable 5 <noreply@anthropic.com>"
```

---

### Task 3: Sitemap scoping + empty-fallback in `HttpSource.iter`

**Files:**
- Modify: `src/source.ts` (mode decision ~line 203-212; import ~line 13)
- Test: `tests/source.test.ts` (append tests inside `describe("HttpSource", ...)`)

**Interfaces:**
- Consumes: `underScope` (Task 1), `CrawlOptions.scopePrefix` (Task 2).
- Produces: sitemap-mode crawls are scope-filtered before the sitemap-vs-BFS decision; an all-out-of-scope sitemap falls back to BFS. No new exports.

- [ ] **Step 1: Write the failing tests**

Append inside `describe("HttpSource", ...)` in `tests/source.test.ts`:

```ts
  test("sitemap URLs outside scopePrefix are not fetched", async () => {
    __clearRobotsCache();
    pages = {
      "/sitemap.xml": {
        status: 200,
        ctype: "application/xml",
        body: `<?xml version="1.0"?><urlset xmlns="http://www.sitemaps.org/schemas/sitemap/0.9"><url><loc>http://localhost:${port}/docs/a.html</loc></url><url><loc>http://localhost:${port}/blog/b.html</loc></url></urlset>`,
      },
      "/docs/": { status: 200, ctype: "text/html", body: `<html>docs</html>` },
      "/docs/a.html": { status: 200, ctype: "text/html", body: `<html>a</html>` },
      "/blog/b.html": { status: 200, ctype: "text/html", body: `<html>b</html>` },
    };
    const source = new HttpSource(
      `http://localhost:${port}/docs/`,
      { userAgent: "t", timeoutMs: 1_000, maxBytes: 1_000_000, cacheDir: null },
      {
        maxPages: 100, maxDepth: 10, concurrency: 1, userAgent: "t",
        llmsFullMode: "off", llmsIndexMode: "off", scopePrefix: "/docs/",
      },
    );
    const items = [];
    for await (const it of source.iter()) items.push(it);
    expect(items.map((i) => i.srcUri).sort()).toEqual([
      `http://localhost:${port}/docs/a.html`,
    ]);
  });

  test("sitemap with zero in-scope URLs falls back to BFS", async () => {
    __clearRobotsCache();
    pages = {
      "/sitemap.xml": {
        status: 200,
        ctype: "application/xml",
        body: `<?xml version="1.0"?><urlset xmlns="http://www.sitemaps.org/schemas/sitemap/0.9"><url><loc>http://localhost:${port}/blog/b.html</loc></url></urlset>`,
      },
      "/docs/": { status: 200, ctype: "text/html", body: `<html><a href="/docs/a.html">a</a></html>` },
      "/docs/a.html": { status: 200, ctype: "text/html", body: `<html>a</html>` },
      "/blog/b.html": { status: 200, ctype: "text/html", body: `<html>b</html>` },
    };
    const source = new HttpSource(
      `http://localhost:${port}/docs/`,
      { userAgent: "t", timeoutMs: 1_000, maxBytes: 1_000_000, cacheDir: null },
      {
        maxPages: 100, maxDepth: 10, concurrency: 1, userAgent: "t",
        llmsFullMode: "off", llmsIndexMode: "off", scopePrefix: "/docs/",
      },
    );
    const items = [];
    for await (const it of source.iter()) items.push(it);
    expect(items.map((i) => i.srcUri).sort()).toEqual([
      `http://localhost:${port}/docs/`,
      `http://localhost:${port}/docs/a.html`,
    ]);
  });

  test("sitemap without scopePrefix is unfiltered (regression)", async () => {
    __clearRobotsCache();
    pages = {
      "/sitemap.xml": {
        status: 200,
        ctype: "application/xml",
        body: `<?xml version="1.0"?><urlset xmlns="http://www.sitemaps.org/schemas/sitemap/0.9"><url><loc>http://localhost:${port}/docs/a.html</loc></url><url><loc>http://localhost:${port}/blog/b.html</loc></url></urlset>`,
      },
      "/docs/": { status: 200, ctype: "text/html", body: `<html>docs</html>` },
      "/docs/a.html": { status: 200, ctype: "text/html", body: `<html>a</html>` },
      "/blog/b.html": { status: 200, ctype: "text/html", body: `<html>b</html>` },
    };
    const source = new HttpSource(
      `http://localhost:${port}/docs/`,
      { userAgent: "t", timeoutMs: 1_000, maxBytes: 1_000_000, cacheDir: null },
      { maxPages: 100, maxDepth: 10, concurrency: 1, userAgent: "t", llmsFullMode: "off", llmsIndexMode: "off" },
    );
    const items = [];
    for await (const it of source.iter()) items.push(it);
    expect(items.map((i) => i.srcUri).sort()).toEqual([
      `http://localhost:${port}/blog/b.html`,
      `http://localhost:${port}/docs/a.html`,
    ]);
  });
```

Note: the test server's handler already returns 404 for `/robots.txt` and any path missing from `pages`, so the `llms.txt` probes being "off" plus 404s keep the discovery chain deterministic.

- [ ] **Step 2: Run tests to verify the new ones fail**

Run: `npx vitest run tests/source.test.ts`
Expected: FAIL — `scopePrefix` is ignored, so the first new test also yields `/blog/b.html`, and the second stays in sitemap mode (its one out-of-scope URL is fetched, no BFS fallback) yielding `/blog/b.html` instead of the two `/docs/` pages. The regression test passes.

- [ ] **Step 3: Implement**

In `src/source.ts`:

Line 13, extend the import:

```ts
import { normalizeUrl, underScope } from "./http/url.js";
```

Replace the mode decision at the end of `iter()` (currently):

```ts
    const origin = new URL(normalized).origin;
    const robots = await getRobots(origin, this.fetchOpts);
    const sitemapUrls = await discoverSitemaps(normalized, robots, this.fetchOpts);

    if (sitemapUrls.length > 0) {
      yield* this.iterFromSitemap(sitemapUrls, robots);
    } else {
      yield* this.iterFromBfs(robots);
    }
```

with:

```ts
    const origin = new URL(normalized).origin;
    const robots = await getRobots(origin, this.fetchOpts);
    const sitemapUrls = await discoverSitemaps(normalized, robots, this.fetchOpts);
    // Scope-filter before the mode decision: a sitemap whose entries are all
    // out of scope must fall back to BFS, not produce an empty corpus.
    const prefix = this.crawlOpts.scopePrefix;
    const scoped = prefix ? sitemapUrls.filter((u) => underScope(u, prefix)) : sitemapUrls;

    if (scoped.length > 0) {
      yield* this.iterFromSitemap(scoped, robots);
    } else {
      yield* this.iterFromBfs(robots);
    }
```

- [ ] **Step 4: Run tests to verify they pass**

Run: `npx vitest run tests/source.test.ts`
Expected: PASS (all).

- [ ] **Step 5: Run the full suite (BFS + sitemap paths interact widely)**

Run: `npx vitest run`
Expected: PASS — every existing crawl/CLI/MCP test seeds an origin root or uses singlePage/llms modes, all unaffected.

- [ ] **Step 6: Typecheck and commit**

```bash
npm run typecheck
git add src/source.ts tests/source.test.ts
git commit -m "feat(crawl): scope-filter sitemap URLs, BFS fallback when none in scope (docf-sxe)

Co-Authored-By: Claude Fable 5 <noreply@anthropic.com>"
```

---

### Task 4: CLI `--scope` flag + README

**Files:**
- Modify: `src/cli.ts` (option ~line 55; `ConvertOpts` ~line 66-91; URL branch of `runConvert` ~line 129-153)
- Modify: `README.md` ("URL sources" section, lines 28-44)
- Test: Create `tests/cli-scope.test.ts` (reuses `tests/fixtures/crawl-site` — has `/guide/**`, `/api/**`, sitemap.xml listing both)

**Interfaces:**
- Consumes: `scopePrefixFromSeed` (Task 1), `CrawlOptions.scopePrefix` (Task 2/3).
- Produces: CLI flag `--scope <mode>` (`path` default | `origin`); `ConvertOpts.scope?: string`. `runConvert` returns 2 on an invalid value (same pattern as `--llms-full`).

- [ ] **Step 1: Write the failing test**

Create `tests/cli-scope.test.ts`:

```ts
import { afterEach, beforeEach, describe, expect, test } from "vitest";
import { existsSync, mkdtempSync, rmSync } from "node:fs";
import { tmpdir } from "node:os";
import { join, resolve } from "node:path";
import { startStaticServer, type RunningServer } from "./helpers/static-server.js";
import { runConvert } from "../src/cli.js";

let server: RunningServer;
let outDir: string;
const FIXTURE = resolve("tests/fixtures/crawl-site");

describe("CLI --scope flag", () => {
  beforeEach(async () => {
    server = await startStaticServer({ rootDir: FIXTURE, rewriteBase: true });
    outDir = mkdtempSync(join(tmpdir(), "docforge-scope-"));
  });
  afterEach(async () => {
    await server.close();
    rmSync(outDir, { recursive: true, force: true });
  });

  test("default scope=path: seed /guide/ converts only guide pages", async () => {
    const code = await runConvert(`${server.baseUrl}/guide/`, baseOpts(outDir));
    expect(code).toBe(0);
    expect(existsSync(join(outDir, "guide/index.md"))).toBe(true);
    expect(existsSync(join(outDir, "guide/intro.md"))).toBe(true);
    expect(existsSync(join(outDir, "guide/advanced.md"))).toBe(true);
    expect(existsSync(join(outDir, "api/reference.md"))).toBe(false);
    expect(existsSync(join(outDir, "index.md"))).toBe(false);
  });

  test("--scope origin: seed /guide/ converts the whole origin", async () => {
    const code = await runConvert(`${server.baseUrl}/guide/`, baseOpts(outDir, "origin"));
    expect(code).toBe(0);
    expect(existsSync(join(outDir, "guide/intro.md"))).toBe(true);
    expect(existsSync(join(outDir, "api/reference.md"))).toBe(true);
    expect(existsSync(join(outDir, "index.md"))).toBe(true);
  });

  test("invalid --scope value returns 2", async () => {
    const code = await runConvert(`${server.baseUrl}/guide/`, baseOpts(outDir, "banana"));
    expect(code).toBe(2);
  });
});

function baseOpts(outDir: string, scope?: string) {
  return {
    output: outDir,
    failThreshold: "0.10",
    maxBytes: "10485760",
    dryRun: false,
    maxPages: "100",
    maxDepth: "5",
    concurrency: "2",
    cacheDir: "~/.cache/docforge",
    cache: false,
    userAgent: "docforge-test",
    selector: undefined,
    llmsFull: "off",
    ...(scope !== undefined ? { scope } : {}),
  };
}
```

- [ ] **Step 2: Run test to verify it fails**

Run: `npx vitest run tests/cli-scope.test.ts`
Expected: FAIL — default-scope test finds `api/reference.md` (sitemap lists the whole origin); invalid-value test returns 0 instead of 2.

- [ ] **Step 3: Implement**

In `src/cli.ts`:

Import (line 9 area, with the other src imports):

```ts
import { scopePrefixFromSeed } from "./http/url.js";
```

Option, after the `--llms-full` option (line 55):

```ts
    .option("--scope <mode>", "crawl scope: path (seed path prefix) | origin (whole origin) (URL source only)", "path")
```

`ConvertOpts`, after `llmsFull: string;`:

```ts
  scope?: string | undefined;
```

(Optional so existing test opts objects that omit it keep compiling; commander always supplies the default at runtime.)

In `runConvert`'s URL branch, right after the `llmsFullMode` validation block (line 130-134):

```ts
    const scopeMode = opts.scope ?? "path";
    if (scopeMode !== "path" && scopeMode !== "origin") {
      log("error", `invalid --scope value: ${opts.scope} (expected path|origin)`);
      return 2;
    }
```

And extend the `crawlOptions` build (line 147-153):

```ts
    const scopePrefix = scopeMode === "path" ? scopePrefixFromSeed(sourceArg) : null;
    pipelineOpts.crawlOptions = {
      maxPages: parseInt(opts.maxPages, 10),
      maxDepth: parseInt(opts.maxDepth, 10),
      concurrency: parseInt(opts.concurrency, 10),
      userAgent: opts.userAgent,
      llmsFullMode,
      ...(scopePrefix ? { scopePrefix } : {}),
    };
```

- [ ] **Step 4: Run tests to verify they pass**

Run: `npx vitest run tests/cli-scope.test.ts tests/cli.test.ts tests/crawl-e2e.test.ts tests/crawl-bfs-fallback.test.ts`
Expected: PASS (new + existing CLI/crawl tests — the latter all seed the origin root).

- [ ] **Step 5: Update README**

In `README.md`, "URL sources" section — replace the paragraph + flags list (lines 30-41):

```markdown
`<source>` and `<spec>` accept HTTP(S) URLs. For `convert`, docforge attempts
sitemap discovery first (robots.txt `Sitemap:` directives, then `/sitemap.xml`,
then `/sitemap_index.xml`) and falls back to a BFS crawl bounded by
`--max-pages` / `--max-depth` and the seed origin. `robots.txt` is honored.

Crawls are scoped to the seed's path prefix by default: seeding
`https://docs.example.com/guide/` converts only pages under `/guide/`, in both
sitemap and BFS modes (a sitemap with no in-scope entries falls back to BFS).
A page seed scopes to its directory (`/guide/intro.html` → `/guide/`); an
extensionless seed is treated as a directory (`/guide` → `/guide/`). Root
seeds are unaffected. Pass `--scope origin` to crawl the whole origin.

```bash
docforge convert https://docs.example.com/ --output ./md
docforge openapi https://api.example.com/openapi.yaml --output ./api-md
```

URL-only flags: `--max-pages` (5000), `--max-depth` (10), `--concurrency` (4),
`--scope` (`path`), `--cache-dir` (`~/.cache/docforge`), `--no-cache`,
`--user-agent`.
```

- [ ] **Step 6: Typecheck and commit**

```bash
npm run typecheck
git add src/cli.ts tests/cli-scope.test.ts README.md
git commit -m "feat(cli): --scope path|origin flag, path-prefix default (docf-sxe)

Co-Authored-By: Claude Fable 5 <noreply@anthropic.com>"
```

---

### Task 5: MCP `scope` param + docs + bead close

**Files:**
- Modify: `src/mcp/tools/convert.ts` (`ConvertArgs` ~line 21-40; `parseArgs` ~line 42-84; `inputSchema.properties` ~line 183-218; handler `crawlOptions` ~line 274-284; imports ~line 19)
- Modify: `README.md` (MCP Tools bullet for `convert`, ~line 211-226)
- Test: Create `tests/mcp/tools-convert-scope.test.ts`

**Interfaces:**
- Consumes: `scopePrefixFromSeed` (Task 1), `CrawlOptions.scopePrefix` (Task 2/3).
- Produces: MCP `convert` arg `scope?: "path" | "origin"` (default `"path"`), threaded to `crawlOptions.scopePrefix`. Only site crawls consult it (page/llms kinds never read `scopePrefix`).

- [ ] **Step 1: Write the failing test**

Create `tests/mcp/tools-convert-scope.test.ts`:

```ts
import { describe, expect, test, beforeEach, afterEach } from "vitest";
import { mkdtempSync, rmSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { convertTool } from "../../src/mcp/tools/convert.js";
import { LockManager } from "../../src/mcp/locks.js";
import { startStub, type StubServer } from "./helpers/http-stub.js";

let qmdRoot: string;
let stub: StubServer;

const page = (title: string, links: string[] = []) =>
  `<!doctype html><html><head><title>${title}</title></head><body><main><h1>${title}</h1>` +
  `<p>Enough content for extraction to succeed on the ${title} page.</p>` +
  links.map((l) => `<a href="${l}">${l}</a>`).join("") +
  `</main></body></html>`;

beforeEach(async () => {
  qmdRoot = mkdtempSync(join(tmpdir(), "df-scope-"));
  stub = await startStub([
    { path: "/robots.txt", contentType: "text/plain", body: "User-agent: *\nDisallow:" },
    { path: "/sitemap.xml", status: 404, body: "" },
    { path: "/sitemap_index.xml", status: 404, body: "" },
    { path: "/docs/", body: page("Docs", ["/docs/a", "/blog/b"]) },
    { path: "/docs/a", body: page("A") },
    { path: "/blog/b", body: page("B") },
  ]);
});
afterEach(async () => {
  await stub.close();
  rmSync(qmdRoot, { recursive: true, force: true });
});

function ctx() {
  return {
    config: {
      qmdRoot,
      cacheDir: join(qmdRoot, ".cache"),
      userAgent: "docforge-test/1.0",
      maxPages: 10,
      maxDepth: 3,
      concurrency: 2,
    },
    locks: new LockManager(),
  };
}

describe("MCP convert scope arg", () => {
  test("inputSchema exposes scope enum path|origin, default path", () => {
    const props = (convertTool.inputSchema as {
      properties: Record<string, { enum?: string[]; default?: string }>;
    }).properties;
    expect(props.scope).toBeDefined();
    expect(props.scope.enum).toEqual(["path", "origin"]);
    expect(props.scope.default).toBe("path");
  });

  test("default scope: site crawl seeded at /docs/ skips /blog/", async () => {
    const res = await convertTool.handler(
      { url: `${stub.origin}/docs/`, kind: "site", corpus: "scope-default" },
      ctx(),
    );
    const sc = res.structuredContent as { pages: Array<{ rel_path: string }> };
    const rels = sc.pages.map((p) => p.rel_path).sort();
    expect(rels).toContain("docs/a.md");
    expect(rels.some((r) => r.startsWith("blog/"))).toBe(false);
  });

  test("scope=origin: site crawl seeded at /docs/ includes /blog/", async () => {
    const res = await convertTool.handler(
      { url: `${stub.origin}/docs/`, kind: "site", corpus: "scope-origin", scope: "origin" },
      ctx(),
    );
    const sc = res.structuredContent as { pages: Array<{ rel_path: string }> };
    const rels = sc.pages.map((p) => p.rel_path).sort();
    expect(rels).toContain("blog/b.md");
  });
});
```

Note: `kind: "site"` bypasses the llms-full/llms.txt probes in `resolveKind` (explicit non-auto kind returns early) and the handler sets `llmsFullMode`/`llmsIndexMode` to `"off"` for site kind, so no extra stub routes are needed.

- [ ] **Step 2: Run test to verify it fails**

Run: `npx vitest run tests/mcp/tools-convert-scope.test.ts`
Expected: FAIL — schema test: `props.scope` undefined; default-scope test: `blog/b.md` present. (`scope` in the args object is also rejected by `additionalProperties: false` only at real MCP transport level — `parseArgs` ignores unknown keys, so the handler tests exercise wiring, not schema validation.)

- [ ] **Step 3: Implement**

In `src/mcp/tools/convert.ts`:

Import (line 19 area):

```ts
import { scopePrefixFromSeed } from "../../http/url.js";
```

`ConvertArgs`, after `exclude_hosts?: string[];`:

```ts
  scope?: "path" | "origin";
```

`parseArgs`, after the `exclude_hosts` block (line 81):

```ts
  if (raw.scope === "path" || raw.scope === "origin") args.scope = raw.scope;
```

`inputSchema.properties`, after `exclude_hosts` (line 210):

```ts
      scope: {
        type: "string",
        enum: ["path", "origin"],
        default: "path",
        description: "site-crawl scope: path = only URLs under the seed's path prefix (e.g. /docs/**), origin = whole origin",
      },
```

Handler, extend the `crawlOptions` build (line 274-284) — add before the closing brace:

```ts
      const scopePrefix =
        (args.scope ?? "path") === "path" ? scopePrefixFromSeed(args.url) : null;
      const pipelineOpts: RunPipelineOptions = {
        // ... (existing fields unchanged)
        crawlOptions: {
          maxPages: kind === "page" ? 1 : (args.max_pages ?? ctx.config.maxPages),
          maxDepth: args.max_depth ?? ctx.config.maxDepth,
          concurrency: args.concurrency ?? ctx.config.concurrency,
          userAgent: args.user_agent ?? ctx.config.userAgent,
          llmsFullMode: kind === "llms-full" ? "force" : "off",
          llmsIndexMode: kind === "llms-index" ? "force" : "off",
          singlePage: kind === "page",
          ...(args.exclude_hosts ? { excludeHosts: args.exclude_hosts } : {}),
          ...(scopePrefix ? { scopePrefix } : {}),
        },
      };
```

(The `const scopePrefix = …` line goes right above the `pipelineOpts` declaration; only the spread line is added inside `crawlOptions`.)

- [ ] **Step 4: Run tests to verify they pass**

Run: `npx vitest run tests/mcp/`
Expected: PASS (new + all existing MCP tests — they seed origin roots or use `kind: "page"`).

- [ ] **Step 5: Update README (MCP tools bullet)**

In `README.md`, in the `convert` tool bullet (line 211-226), change the signature line and append one sentence. Signature:

```markdown
- **`convert(url, corpus?, kind?, scope?, llms_full?, llms_index?, selector?, exclude_hosts?, ...)`** —
```

Append to the bullet (after the `exclude_hosts` sentence):

```markdown
  `scope` (`path` default | `origin`) bounds site crawls to the seed's path
  prefix — seeding `…/docs/` converts only `/docs/**`; pass `origin` for the
  whole origin.
```

- [ ] **Step 6: Full suite + typecheck**

Run: `npx vitest run && npm run typecheck`
Expected: PASS.

- [ ] **Step 7: Commit and close the bead**

```bash
git add src/mcp/tools/convert.ts tests/mcp/tools-convert-scope.test.ts README.md
git commit -m "feat(mcp): scope param for convert tool, path-prefix default (docf-sxe)

Co-Authored-By: Claude Fable 5 <noreply@anthropic.com>"
br close docf-sxe
git add .beads && git commit -m "chore(beads): close docf-sxe

Co-Authored-By: Claude Fable 5 <noreply@anthropic.com>"
```

---

## Verification (after all tasks)

1. `npx vitest run` — full suite green.
2. `npm run typecheck` — clean.
3. Manual smoke (optional but recommended):
   ```bash
   npx tsx src/bin.ts convert https://docs.python.org/3/library/json.html --output /tmp/scope-smoke --max-pages 10
   ```
   Expect: only `/3/library/**` pages fetched (scope `/3/library/`), no `/3/tutorial/**` output.
