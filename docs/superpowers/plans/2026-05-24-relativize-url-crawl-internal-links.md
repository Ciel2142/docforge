# Relativize Same-Origin Links on URL Crawls Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** When converting a URL source (site crawl), rewrite same-origin internal links to point at the converted local `.md` copies (relative paths), so `--format default` produces a self-contained corpus and `--format obsidian` produces real `[[wikilinks]]`.

**Architecture:** This is the URL-source analog of the local-source `delocalizeLinks` (docf-7w5). For a crawled page, same-origin absolute links (`https://host/a/b`) are mapped — via the existing `urlToOutputPath` — to the same corpus-relative `.md` path the pipeline writes outputs to, then expressed relative to the current page. The existing `rewriteInternalLinks` (default) / `toObsidianWikilinks` (obsidian) then finish the job on those relative links. External links and same-origin non-page assets (images, `.pdf`, `.css`, …) are left absolute.

**Tech Stack:** TypeScript (ESM, NodeNext), Vitest, `node:path` (posix), `node:url` (`URL`). Reuses `sameOrigin` + `urlToOutputPath` already in `src/http/url.ts`.

**Key facts established during investigation (do not re-litigate):**
- `src/http/url.ts` already exports `sameOrigin(a, b)` (normalized protocol+host compare) and `urlToOutputPath(url, outputDir)` which maps a URL's `pathname` to an output path: trailing-slash/empty → `index.md`, `.html?$` → `.md`, else `+ ".md"`, segments sanitized, joined under `outputDir`.
- `urlToOutputPath(url, "")` returns the **bare posix relpath** (e.g. `beads/cli-reference/admin.md`) because `posix.join("", x)` === `x` and leading slashes are stripped. Use this — no `outputDir` plumbing needed.
- `normalizeUrl` (called inside both helpers) strips `hash` and `search`. So the `#fragment` must be re-appended from the original link URL; query strings are intentionally dropped (the local copy has no query variants).
- docforge does NOT download images/assets — only HTML pages become `.md`. Therefore same-origin links to non-page resources (`.png`, `.pdf`, `.css`, `.zip`, …) must stay absolute, or they'd point at nonexistent `.md` files. Crawled doc-site page links are extensionless/`.html`/trailing-slash (e.g. `/beads/cli-reference/admin`).
- This is strictly the URL path. Local-dir sources (docf-7w5 sentinel/`delocalizeLinks`) must be untouched. The two are mutually exclusive per `item.srcUri`.
- Emitting `.md` relative links works for both formats: `rewriteInternalLinks` leaves an already-`.md` target as-is; `toObsidianWikilinks` matches `.md` and produces a wikilink (dropping the anchor).

---

## File Structure

- `src/http/url.ts` — gains `relativizeSameOriginLinks(md, pageUrl)` + a small `isLikelyPageUrl(pathname)` helper, alongside the existing `sameOrigin` / `urlToOutputPath` (cohesive: all URL-domain logic).
- `src/runPipeline.ts` — in the HTML-convert branch, choose the pre-rewrite step by source kind: `relativizeSameOriginLinks` for URL sources, the existing `delocalizeLinks` for local sources.
- `tests/http-url.test.ts` — unit tests for `relativizeSameOriginLinks` (this is the existing test file for `src/http/url.ts`; confirm the name with `ls tests | grep url` and use whatever already tests `url.ts`).
- `tests/mcp/tools-convert.test.ts` or a new `tests/pipeline-url-links.test.ts` — integration test via the existing http stub (`tests/mcp/helpers/http-stub.ts`), crawling ≥2 cross-linked pages, asserting relative links (default) and wikilinks (obsidian).

---

### Task 1: `relativizeSameOriginLinks` + `isLikelyPageUrl` in `src/http/url.ts`

**Files:**
- Modify: `src/http/url.ts`
- Test: `tests/http-url.test.ts` (or the existing test file covering `src/http/url.ts` — verify the path first)

- [ ] **Step 1: Confirm the test file**

Run: `ls tests | grep -i url` and `grep -rl "from \"../src/http/url" tests` — use the existing test file that imports `src/http/url.js`. If none exists, create `tests/http-url.test.ts` with `import { ... } from "../src/http/url.js";`.

- [ ] **Step 2: Write the failing tests**

Add this block to that test file (add `relativizeSameOriginLinks` to the existing import from `"../src/http/url.js"`):

```ts
import { relativizeSameOriginLinks } from "../src/http/url.js";

describe("relativizeSameOriginLinks", () => {
  const PAGE = "https://docs.example.com/guide/intro";

  test("same-origin extensionless link → relative .md, fragment preserved", () => {
    expect(
      relativizeSameOriginLinks(
        "See [the API](https://docs.example.com/api/reference#post-widgets).",
        PAGE,
      ),
    ).toBe("See [the API](../api/reference.md#post-widgets).");
  });

  test("same-origin sibling link → relative .md", () => {
    expect(
      relativizeSameOriginLinks(
        "[next](https://docs.example.com/guide/advanced)",
        PAGE,
      ),
    ).toBe("[next](advanced.md)");
  });

  test("same-origin .html link → relative .md", () => {
    expect(
      relativizeSameOriginLinks(
        "[ref](https://docs.example.com/api/reference.html)",
        PAGE,
      ),
    ).toBe("[ref](../api/reference.md)");
  });

  test("trailing-slash same-origin link → index.md", () => {
    expect(
      relativizeSameOriginLinks(
        "[api home](https://docs.example.com/api/)",
        PAGE,
      ),
    ).toBe("[api home](../api/index.md)");
  });

  test("autolink same-origin → relative .md", () => {
    expect(
      relativizeSameOriginLinks(
        "<https://docs.example.com/api/reference>",
        PAGE,
      ),
    ).toBe("<../api/reference.md>");
  });

  test("external link left untouched", () => {
    const md = "[ext](https://other.com/x) and [rel](../already/rel.md)";
    expect(relativizeSameOriginLinks(md, PAGE)).toBe(md);
  });

  test("same-origin image left absolute (asset not converted)", () => {
    const md = "![diagram](https://docs.example.com/img/arch.png)";
    expect(relativizeSameOriginLinks(md, PAGE)).toBe(md);
  });

  test("same-origin non-page asset link left absolute", () => {
    const md = "[spec](https://docs.example.com/files/spec.pdf)";
    expect(relativizeSameOriginLinks(md, PAGE)).toBe(md);
  });
});
```

- [ ] **Step 3: Run tests to verify they fail**

Run: `npx vitest run tests/http-url.test.ts -t relativizeSameOriginLinks`
Expected: FAIL — `relativizeSameOriginLinks` not exported.

- [ ] **Step 4: Implement in `src/http/url.ts`**

`posix` is already imported at line 1. Append:

```ts
// A same-origin link is a "page" (will have a converted .md) if its path is a
// directory (ends with "/"), an HTML file, or extensionless (e.g. /guide/intro).
// Asset links (.png, .pdf, .css, ...) are NOT converted, so leave them absolute.
function isLikelyPageUrl(pathname: string): boolean {
  if (pathname === "" || pathname.endsWith("/")) return true;
  if (/\.html?$/i.test(pathname)) return true;
  const last = pathname.split("/").pop() ?? "";
  return !last.includes(".");
}

// Markdown inline link [text](url) — NOT an image (negative lookbehind on `!`).
const ABS_LINK_RE = /(?<!!)\[([^\]]*)\]\((https?:\/\/[^)\s]+)\)/g;
const ABS_AUTOLINK_RE = /<(https?:\/\/[^>\s]+)>/g;

/**
 * Rewrite SAME-ORIGIN page links in `md` from absolute URLs to paths relative
 * to `pageUrl`'s converted output (.md), preserving the `#fragment`. External
 * links, same-origin non-page assets, and images are left untouched. Mirrors
 * delocalizeLinks but for real-origin (URL-crawl) sources.
 */
export function relativizeSameOriginLinks(md: string, pageUrl: string): string {
  const pageRel = urlToOutputPath(pageUrl, ""); // bare posix relpath, e.g. "guide/intro.md"
  const fromDir = posix.dirname(pageRel);
  const toRel = (absUrl: string): string | null => {
    if (!sameOrigin(absUrl, pageUrl)) return null;
    let u: URL;
    try {
      u = new URL(absUrl);
    } catch {
      return null;
    }
    if (!isLikelyPageUrl(u.pathname)) return null;
    const targetRel = urlToOutputPath(absUrl, "");
    const rel = posix.relative(fromDir, targetRel) || posix.basename(targetRel);
    return rel + u.hash;
  };
  return md
    .replace(ABS_LINK_RE, (m, text: string, url: string) => {
      const r = toRel(url);
      return r === null ? m : `[${text}](${r})`;
    })
    .replace(ABS_AUTOLINK_RE, (m, url: string) => {
      const r = toRel(url);
      return r === null ? m : `<${r}>`;
    });
}
```

- [ ] **Step 5: Run tests to verify they pass**

Run: `npx vitest run tests/http-url.test.ts`
Expected: PASS — the 8 new tests + all pre-existing url tests green.

- [ ] **Step 6: Commit**

```bash
git add src/http/url.ts tests/http-url.test.ts
git commit -m "feat(url): relativizeSameOriginLinks for URL-crawl internal links (docf-cf1)"
```

---

### Task 2: Wire into the pipeline (URL sources)

**Files:**
- Modify: `src/runPipeline.ts` (import line 11-ish where `urlToOutputPath` is imported from `./output.js`; and the HTML-convert branch ≈ lines 209-218)

- [ ] **Step 1: Import `relativizeSameOriginLinks`**

`urlToOutputPath` is imported from `./output.js` (which re-exports it from `./http/url.js`). Add `relativizeSameOriginLinks` to that same import block. Verify with `grep -n "urlToOutputPath" src/runPipeline.ts` and `grep -n "relativizeSameOriginLinks\|export" src/output.ts`. If `src/output.ts` does not re-export it, add `export { relativizeSameOriginLinks } from "./http/url.js";` to `src/output.ts` next to the existing `export { urlToOutputPath } from "./http/url.js";` (line 92), then import it from `./output.js` in runPipeline. (Pick ONE import source and keep it consistent with how `urlToOutputPath` is already imported.)

- [ ] **Step 2: Choose the pre-rewrite step by source kind**

The current HTML-branch block (≈ lines 209-218, after docf-7w5) reads:

```ts
    const fromRel = relative(opts.outputDir, outPath).split(sep).join("/");
    const localized = delocalizeLinks(result.body_md, fromRel);
    let bodyMd =
      format === "obsidian"
        ? toObsidianWikilinks(localized, fromRel)
        : rewriteInternalLinks(localized);
```

Change it to:

```ts
    const fromRel = relative(opts.outputDir, outPath).split(sep).join("/");
    const isUrlSource =
      item.srcUri.startsWith("http://") || item.srcUri.startsWith("https://");
    const normalizedLinks = isUrlSource
      ? relativizeSameOriginLinks(result.body_md, item.srcUri)
      : delocalizeLinks(result.body_md, fromRel);
    let bodyMd =
      format === "obsidian"
        ? toObsidianWikilinks(normalizedLinks, fromRel)
        : rewriteInternalLinks(normalizedLinks);
```

(URL sources relativize same-origin links; local sources delocalize the sentinel. Mutually exclusive. `delocalizeLinks` was already a no-op on URL output, so this is behavior-preserving for local and additive for URL.)

- [ ] **Step 3: Verify existing tests still pass**

Run: `npx vitest run tests/mcp/tools-convert.test.ts tests/pipeline-obsidian.test.ts tests/cli-format.test.ts`
Expected: PASS (docf-7w5 local behavior unchanged; single-page URL convert still fine).

- [ ] **Step 4: Commit**

```bash
git add src/runPipeline.ts src/output.ts
git commit -m "fix(pipeline): relativize same-origin links for URL sources (docf-cf1)"
```

(Only add `src/output.ts` if you edited it in Step 1.)

---

### Task 3: Integration test — multi-page crawl, both formats

**Files:**
- Create: `tests/pipeline-url-links.test.ts`

- [ ] **Step 1: Write the failing integration test**

Model the stub usage on `tests/mcp/tools-convert.test.ts` (which uses `startStub` from `tests/mcp/helpers/http-stub.js`). First read that helper to confirm the `startStub` signature and the `{ url, requests, close }` shape, and read an existing crawl test (e.g. `tests/http-crawl.test.ts` or `tests/crawl-e2e.test.ts`) to confirm how to invoke `runPipeline` against a stub with multiple pages. Then create `tests/pipeline-url-links.test.ts`:

```ts
import { afterEach, beforeEach, describe, expect, test } from "vitest";
import { mkdtempSync, readFileSync, rmSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { runPipeline } from "../src/runPipeline.js";
import { startStub, type StubServer } from "./mcp/helpers/http-stub.js";

const PAD = "word ".repeat(40);
// NOTE: links are written as root-absolute paths against the stub origin so the
// crawler discovers them and they serialize as same-origin absolute URLs.
function page(body: string): string {
  return `<!doctype html><html><head><title>T</title></head><body><main><h1>T</h1><p>${PAD}</p>${body}</main></body></html>`;
}

let tmp: string;
let stub: StubServer;
beforeEach(async () => {
  tmp = mkdtempSync(join(tmpdir(), "df-urllinks-"));
});
afterEach(async () => {
  if (stub) await stub.close();
  rmSync(tmp, { recursive: true, force: true });
});

// Build a 2-page same-origin site: /guide/intro links to /api/reference (with #frag) + an external link.
async function startSite(): Promise<StubServer> {
  return startStub([
    { path: "/guide/intro", body: page(`<p>See <a href="/api/reference#post-widgets">API</a> and <a href="https://external.example/x">ext</a>. ${PAD}</p>`) },
    { path: "/api/reference", body: page(`<p>Back to <a href="/guide/intro">intro</a>. ${PAD}</p>`) },
    { path: "/robots.txt", contentType: "text/plain", body: "User-agent: *\nDisallow:" },
    { path: "/llms-full.txt", status: 404, body: "" },
    { path: "/sitemap.xml", status: 404, body: "" },
    { path: "/sitemap_index.xml", status: 404, body: "" },
  ]);
}

describe("URL crawl relativizes same-origin links (docf-cf1)", () => {
  test("obsidian: same-origin link → wikilink, external untouched", async () => {
    stub = await startSite();
    const outDir = join(tmp, "out");
    await runPipeline({ source: `${stub.url}/guide/intro`, outputDir: outDir, maxBytes: 10485760, dryRun: false, format: "obsidian", maxPages: 5, llmsFull: "off" } as any);
    const intro = readFileSync(join(outDir, "guide", "intro.md"), "utf8");
    expect(intro).toContain("[[api/reference|API]]");
    expect(intro).toContain("https://external.example/x"); // external stays absolute
    expect(intro).not.toContain(`${stub.url}/api/reference`); // same-origin no longer absolute
  });

  test("default: same-origin link → relative .md, external untouched", async () => {
    stub = await startSite();
    const outDir = join(tmp, "out");
    await runPipeline({ source: `${stub.url}/guide/intro`, outputDir: outDir, maxBytes: 10485760, dryRun: false, maxPages: 5, llmsFull: "off" } as any);
    const intro = readFileSync(join(outDir, "guide", "intro.md"), "utf8");
    expect(intro).toContain("[API](../api/reference.md#post-widgets)");
    expect(intro).toContain("https://external.example/x");
  });
});
```

**IMPORTANT:** the exact `RunPipelineOptions` shape (field names like `maxPages`, `llmsFull`, `fetchOptions`, and whether `source` is the page URL or site root) must be verified against `src/runPipeline.ts`'s `RunPipelineOptions` interface and an existing crawl test before finalizing — adjust the option object to match. The `as any` is a placeholder; replace with the real typed options. If the crawler needs a site-root `source` + BFS to reach both pages, set `source: stub.url` and ensure `/` serves a page linking to both, or seed appropriately. Do not weaken the assertions to match wrong output — if output differs, investigate whether it's the impl or the test setup.

- [ ] **Step 2: Run — confirm fail on missing wiring, pass once Tasks 1-2 applied**

Run: `npx vitest run tests/pipeline-url-links.test.ts`
Expected: PASS (with Tasks 1-2 applied). To prove non-vacuous: temporarily revert Task 2's `src/runPipeline.ts` change (`git stash` the working change, or check out the prior commit of that file), re-run → MUST FAIL (links stay absolute / no wikilink), then restore.

- [ ] **Step 3: Full suite**

Run: `npm test`
Expected: all green (incl. tsc pretest).

- [ ] **Step 4: Commit**

```bash
git add tests/pipeline-url-links.test.ts
git commit -m "test(pipeline): URL-crawl same-origin link relativization, both formats (docf-cf1)"
```

---

## Self-Review

**1. Spec coverage (vs docf-cf1 acceptance):**
- "default emits relative .md links between converted pages (no absolute same-origin, external untouched)" → Task 1 unit (sibling/.html/trailing-slash/external) + Task 3 default test. ✅
- "obsidian emits [[wikilinks]] for same-origin links (anchor dropped), external as standard md" → Task 1 unit + Task 3 obsidian test. ✅
- "about:blank/local-dir behavior (docf-7w5) unchanged" → Task 2 keeps `delocalizeLinks` for local; Task 2 Step 3 runs `pipeline-obsidian.test.ts`. ✅
- "regression test via http-stub" → Task 3 uses `tests/mcp/helpers/http-stub.ts`. ✅
- Asset/image safety (don't break non-page same-origin links) → Task 1 image + `.pdf` tests. ✅ (beyond the written acceptance, but required for correctness).

**2. Placeholder scan:** All code steps show full code. The Task 3 options object is explicitly flagged as needing verification against `RunPipelineOptions` — that is a *verification instruction*, not a placeholder; the implementer must read the interface and an existing crawl test (named) to finalize it.

**3. Type consistency:** `relativizeSameOriginLinks(md: string, pageUrl: string): string` defined in Task 1, consumed with that signature in Task 2. `isLikelyPageUrl` is module-private. Reuses existing `sameOrigin`, `urlToOutputPath` (unchanged signatures).

## Out of scope
- Query strings on internal links (dropped when relativized — the local copy has no query variants).
- Same-origin asset *fetching*/localization (docforge doesn't download assets; asset links intentionally stay absolute).
- The shared `[^)\s]` paren-in-URL limitation (consistent with the other link regexes; see docf-7w5 note).

## Execution Handoff

Plan complete and saved to `docs/superpowers/plans/2026-05-24-relativize-url-crawl-internal-links.md`. Two execution options:

1. **Subagent-Driven (recommended)** — fresh subagent per task, review between tasks.
2. **Inline Execution** — execute tasks in this session with checkpoints.

Which approach?
