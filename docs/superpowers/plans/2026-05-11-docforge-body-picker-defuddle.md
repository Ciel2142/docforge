# Body Picker Generalization via Defuddle + llms-full.txt — Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Replace the Sphinx-only `selectBody`/`stripSphinxNoise` pipeline in `src/convert.ts` with a Defuddle-based extractor that handles every doc framework (Sphinx, Material for MkDocs, Docusaurus, VitePress, generic `<article>`/`<main>`), and add an llms-full.txt detection shortcut that bypasses HTML crawl entirely when the site publishes one.

**Architecture:** A new `src/extract.ts` module owns Defuddle. `src/convert.ts` collapses to a thin shim that calls `extractMainContent` then feeds the cleaned HTML to Kreuzberg. A new `src/http/llms.ts` probes `<origin>/llms-full.txt`. `HttpSource.iter()` short-circuits to a single `kind: 'llms-full'` item when found; the CLI loop detects that kind and writes the body directly as Markdown (skipping Defuddle + Kreuzberg). Two new CLI flags: `--selector <css>` overrides Defuddle's auto-detection, `--llms-full <auto|force|off>` controls the shortcut.

**Tech Stack:** Node 20+, TypeScript strict + ESM + `verbatimModuleSyntax` + `exactOptionalPropertyTypes`. New deps: `defuddle@^0.18.1` (MIT, kepano), `linkedom@^0.18.12` (MIT, WebReflection). Unchanged: `@kreuzberg/node`, `cheerio` (kept for `src/links.ts` and `src/http/crawl.ts:extractLinks`), `got`, `commander`, `vitest`.

**Branch:** Per design spec §"Branch strategy" the recommendation is B2 (merge `url-source` to master first). This plan uses **B1** (branch `body-picker-defuddle` from `url-source`) to avoid the master-merge gate before plan execution — the merge is reversible only by a force-push, which violates the CLAUDE.md blast-radius rule. The user can flip to B2 at any time by merging `url-source` to master and rebasing this branch.

**Source spec:** `docs/superpowers/specs/2026-05-11-docforge-body-picker-defuddle-design.md`

---

## File structure (planned)

**Create:**
- `src/extract.ts` (~40 lines) — Defuddle wrapper, sole export `extractMainContent` + types.
- `src/http/llms.ts` (~30 lines) — `probeLlmsFullTxt`.
- `tests/extract.test.ts` — unit tests against existing 6 Sphinx fixtures + 3 new fixtures + empty cases.
- `tests/llms-txt.test.ts` — unit test for `probeLlmsFullTxt` via static-server.
- `tests/cli-selector.test.ts` — integration test for `--selector` flag.
- `tests/cli-llms-full.test.ts` — integration test for `--llms-full` flag (auto/force/off).
- `tests/fixtures/material-mkdocs.html` — Material for MkDocs shape.
- `tests/fixtures/generic-article.html` — top-level `<article class="markdown-body">` shape.
- `tests/fixtures/generic-main.html` — top-level `<main>` shape (no class).
- `tests/expected/material-mkdocs.md`, `tests/expected/generic-article.md`, `tests/expected/generic-main.md` — golden outputs captured during Task 3.
- `tests/fixtures/llms-full-site/llms-full.txt` — fixture body.
- `tests/fixtures/llms-full-site/sitemap.xml` — fixture sitemap (used by test that asserts llms-full path is taken BEFORE sitemap).
- `tests/fixtures/llms-full-site/index.html` — fixture HTML root (used to verify it is NOT fetched when llms-full path taken).
- `tests/fixtures/llms-full-site/robots.txt` — empty robots (allow all).
- `scripts/spike-defuddle.ts` — one-off validator removed after Task 1 commit (kept in git history for reproducibility).

**Modify:**
- `src/convert.ts` — collapse to ~25-line shim around `extractMainContent` + `extractBytesSync`. Drop `selectBody`/`stripSphinxNoise`/`__testing__` exports.
- `src/source.ts` — extend `SourceItem` with `kind?: 'html' | 'llms-full'`. `HttpSource.iter()` probes llms-full first when `crawlOpts.llmsFullMode` is `auto` or `force`.
- `src/http/crawl.ts:CrawlOptions` — add `llmsFullMode: 'auto' | 'force' | 'off'`.
- `src/cli.ts` — add `--selector <css>` and `--llms-full <mode>` flags on `convert`; thread `kind` through CLI loop; short-circuit when `kind === 'llms-full'`.
- `src/index.ts` — bump VERSION re-export (version lives in `package.json`).
- `package.json` — add deps; bump version `0.5.0` → `0.6.0`.
- `tests/convert.test.ts` — strip `__testing__`-based describe blocks (move tests to `tests/extract.test.ts`); existing 6 Sphinx golden cases stay; `EMPTY_CASES` adjusted per Defuddle behavior captured in Task 4; `convertHtml returns failed when kreuzberg throws` test stays.
- `README.md` — replace Sphinx-only description with Defuddle behavior + new flags.

---

## Task 0: Branch setup + dependency install

**Files:**
- Modify: `package.json`
- Modify: `package-lock.json` (auto)

- [ ] **Step 1: Verify starting branch state**

Run: `git status && git log --oneline -3`
Expected: branch `url-source`, HEAD `2165cf5` or descendant, working tree clean (or only untracked plan/spec docs).

- [ ] **Step 2: Create body-picker branch from url-source**

Run:
```bash
git checkout -b body-picker-defuddle url-source
git log --oneline -3
```
Expected: `body-picker-defuddle` checked out, log shows same commits as `url-source`.

- [ ] **Step 3: Install Defuddle + linkedom**

Run:
```bash
npm install defuddle@^0.18.1 linkedom@^0.18.12
```
Expected: package.json gains both deps, `node_modules/defuddle` + `node_modules/linkedom` populated, lockfile updated.

- [ ] **Step 4: Verify Defuddle API matches spec assumption**

Run:
```bash
grep -nE 'contentSelector|export.*Defuddle' node_modules/defuddle/dist/types.d.ts node_modules/defuddle/dist/node.d.ts
```
Expected output includes:
```
node_modules/defuddle/dist/types.d.ts:    contentSelector?: string;
node_modules/defuddle/dist/node.d.ts:export declare function Defuddle(input: Document | string | { ... }, url?: string, options?: DefuddleOptions): Promise<DefuddleResponse>;
```
This confirms the option name is `contentSelector` (NOT `entryPoint` as the spec inferred) and that `Defuddle` from `defuddle/node` is an async function.

- [ ] **Step 5: Typecheck baseline still green**

Run: `npm run typecheck`
Expected: PASS (no errors). New deps are not yet imported anywhere.

- [ ] **Step 6: Test baseline still green**

Run: `npm test`
Expected: 181/181 tests pass.

- [ ] **Step 7: Commit**

Run:
```bash
git add package.json package-lock.json
git commit -m "deps: add defuddle@^0.18.1 + linkedom@^0.18.12 (body picker generalization)"
```

---

## Task 1: Spike — validate Defuddle against docs.kreuzberg.dev (GATE)

**Files:**
- Create: `scripts/spike-defuddle.ts`
- Output: `/tmp/defuddle-spike-report.json` (local-only, not committed)

This task is the **validation gate** from the spec. ≥ 8/10 pages must convert non-empty for the rest of the plan to proceed.

- [ ] **Step 1: Write the spike script**

Create `scripts/spike-defuddle.ts`:
```typescript
import { writeFileSync } from "node:fs";
import { parseHTML } from "linkedom";
import { Defuddle } from "defuddle/node";
import { extractBytesSync } from "@kreuzberg/node";
import Sitemapper from "sitemapper";
import got from "got";

const ROOT = "https://docs.kreuzberg.dev";
const SITEMAP = `${ROOT}/sitemap.xml`;
const TARGET = 10;

interface SpikeResult {
  url: string;
  status: "ok" | "empty" | "failed";
  wordCount?: number;
  hasH1?: boolean;
  mdLen?: number;
  error?: string;
}

async function main(): Promise<void> {
  const sitemap = new Sitemapper({ url: SITEMAP, timeout: 30_000 });
  const { sites } = await sitemap.fetch();
  const urls = sites.slice(0, TARGET);
  console.log(`fetched ${sites.length} sitemap urls, sampling first ${urls.length}`);

  const results: SpikeResult[] = [];
  for (const url of urls) {
    try {
      const html = await got(url, { timeout: { request: 30_000 } }).text();
      const { document } = parseHTML(html);
      const defuddled = await Defuddle(document, url, {
        markdown: false,
        removePartialSelectors: true,
      });
      if (!defuddled?.content || defuddled.wordCount < 5) {
        results.push({ url, status: "empty", wordCount: defuddled?.wordCount ?? 0 });
        continue;
      }
      const md = extractBytesSync(
        Buffer.from(defuddled.content, "utf8"),
        "text/html",
        { useCache: false, outputFormat: "markdown" },
      );
      const hasH1 = /^# .+/m.test(md.content);
      results.push({
        url,
        status: "ok",
        wordCount: defuddled.wordCount,
        hasH1,
        mdLen: md.content.length,
      });
    } catch (e) {
      results.push({ url, status: "failed", error: (e as Error).message });
    }
  }

  const ok = results.filter((r) => r.status === "ok").length;
  const okWithH1 = results.filter((r) => r.status === "ok" && r.hasH1).length;
  console.log(`\nSPIKE RESULT: ${ok}/${urls.length} converted (${okWithH1} with H1)`);
  for (const r of results) {
    const flag = r.status === "ok" ? (r.hasH1 ? "OK" : "OK-no-H1") : r.status.toUpperCase();
    console.log(`  [${flag.padEnd(8)}] ${r.url} ${r.wordCount ?? "-"}w`);
  }

  writeFileSync(
    "/tmp/defuddle-spike-report.json",
    JSON.stringify({ results, summary: { ok, okWithH1, total: urls.length } }, null, 2),
  );
  console.log(`\nreport: /tmp/defuddle-spike-report.json`);

  const PASS = ok >= 8;
  process.exit(PASS ? 0 : 1);
}

main().catch((e) => {
  console.error(e);
  process.exit(2);
});
```

- [ ] **Step 2: Run the spike**

Run: `npx tsx scripts/spike-defuddle.ts`
Expected output: `SPIKE RESULT: N/10 converted (M with H1)` plus per-URL lines. Exit code 0 iff `N ≥ 8`.

- [ ] **Step 3: Decision gate**

| Outcome | Action |
|---|---|
| `N >= 8` | Proceed with Task 2. Note the figure in commit message. |
| `6 <= N <= 7` | Proceed with Task 2 BUT file follow-up beads issues for each failing URL describing what Defuddle returned (empty / wrong wordcount / missing H1). Mention figure + issues in commit message. |
| `N < 6` | STOP. Discard branch. Restart planning against spec §"Fallback" (curated 14-selector chain). |

- [ ] **Step 4: Inspect one OK and one non-OK page (optional but recommended)**

Re-run the spike script with `node --inspect-brk` or insert `console.log(defuddled.content.slice(0, 500))` on a passing case and an empty case. Confirm whether Defuddle preserves `<pre><code class="language-X">` tags (Risk register item from spec). Capture findings in commit message.

- [ ] **Step 5: Commit the spike + report summary**

Run:
```bash
git add scripts/spike-defuddle.ts
git commit -m "spike: validate Defuddle against docs.kreuzberg.dev (N/10 pages converted)"
```
Replace `N/10` with actual figure from Step 2.

---

## Task 2: `src/extract.ts` — Defuddle wrapper

**Files:**
- Create: `src/extract.ts`
- Create: `tests/extract.test.ts`

- [ ] **Step 1: Write the failing test (basic Sphinx case)**

Create `tests/extract.test.ts`:
```typescript
import { describe, expect, test } from "vitest";
import { extractMainContent } from "../src/extract.js";

describe("extractMainContent", () => {
  test("extracts Sphinx articleBody and returns wordCount + title", async () => {
    const html = `<!DOCTYPE html>
<html><head><title>Test Page</title></head>
<body><div role="main"><div itemprop="articleBody">
<h1>Hello World</h1>
<p>Some body content with enough words to satisfy any threshold.</p>
</div></div></body></html>`;
    const r = await extractMainContent(html);
    expect(r.status).toBe("ok");
    if (r.status === "ok") {
      expect(r.cleanedHtml).toContain("Hello World");
      expect(r.cleanedHtml).toContain("Some body content");
      expect(r.wordCount).toBeGreaterThan(0);
    }
  });

  test("returns empty when document has no body content", async () => {
    const html = "<!DOCTYPE html><html><head></head><body></body></html>";
    const r = await extractMainContent(html);
    expect(r.status).toBe("empty");
  });

  test("honours selector override via contentSelector", async () => {
    const html = `<!DOCTYPE html>
<html><body>
<nav>Should not appear</nav>
<div class="custom-content"><h1>Picked</h1><p>${"word ".repeat(50)}</p></div>
<footer>Should not appear either</footer>
</body></html>`;
    const r = await extractMainContent(html, { selector: "div.custom-content" });
    expect(r.status).toBe("ok");
    if (r.status === "ok") {
      expect(r.cleanedHtml).toContain("Picked");
      expect(r.cleanedHtml).not.toContain("Should not appear");
    }
  });
});
```

- [ ] **Step 2: Run test to verify it fails**

Run: `npx vitest run tests/extract.test.ts`
Expected: FAIL — `Cannot find module '../src/extract.js'`.

- [ ] **Step 3: Implement `src/extract.ts`**

Create `src/extract.ts`:
```typescript
import { parseHTML } from "linkedom";
import { Defuddle } from "defuddle/node";

export interface ExtractOptions {
  selector?: string;
  url?: string;
}

export type ExtractResult =
  | {
      status: "ok";
      cleanedHtml: string;
      title: string | null;
      wordCount: number;
    }
  | { status: "empty" };

export async function extractMainContent(
  rawHtml: string,
  opts: ExtractOptions = {},
): Promise<ExtractResult> {
  const { document } = parseHTML(rawHtml);

  const defuddleOpts: Record<string, unknown> = {
    markdown: false,
    removePartialSelectors: true,
  };
  if (opts.selector !== undefined) defuddleOpts.contentSelector = opts.selector;
  if (opts.url !== undefined) defuddleOpts.url = opts.url;

  const result = await Defuddle(
    document as unknown as Document,
    opts.url ?? "",
    defuddleOpts,
  );

  if (!result?.content || result.wordCount < 5) {
    return { status: "empty" };
  }
  return {
    status: "ok",
    cleanedHtml: result.content,
    title: result.title ? result.title : null,
    wordCount: result.wordCount,
  };
}
```

Note: `document as unknown as Document` cast is because linkedom's Document type is structurally identical to lib.dom's but TypeScript can't prove it. Defuddle accepts any Document-shaped object per its `node.d.ts` signature.

- [ ] **Step 4: Run tests to verify pass**

Run: `npx vitest run tests/extract.test.ts`
Expected: PASS — all 3 tests green.

- [ ] **Step 5: Typecheck**

Run: `npm run typecheck`
Expected: PASS.

- [ ] **Step 6: Commit**

```bash
git add src/extract.ts tests/extract.test.ts
git commit -m "feat(extract): add Defuddle wrapper module with selector override"
```

---

## Task 3: New fixtures + goldens (Material/article/main)

**Files:**
- Create: `tests/fixtures/material-mkdocs.html`
- Create: `tests/fixtures/generic-article.html`
- Create: `tests/fixtures/generic-main.html`
- Create: `tests/expected/material-mkdocs.md`
- Create: `tests/expected/generic-article.md`
- Create: `tests/expected/generic-main.md`

- [ ] **Step 1: Create Material for MkDocs fixture**

Create `tests/fixtures/material-mkdocs.html`:
```html
<!DOCTYPE html>
<html lang="en">
<head>
<meta charset="utf-8">
<title>Quickstart - Kreuzberg</title>
</head>
<body class="md-grid">
<header class="md-header">site nav here</header>
<div class="md-container">
<nav class="md-sidebar md-sidebar--primary">left nav</nav>
<main class="md-main">
<div class="md-main__inner md-grid">
<article class="md-content__inner md-typeset">
<h1>Quickstart</h1>
<p>Install Kreuzberg with pip. This installs the core library only; document type backends are optional extras you can add as needed.</p>
<h2>Installation</h2>
<pre><code class="language-bash">pip install kreuzberg</code></pre>
<h2>Basic usage</h2>
<p>Pass a file path or bytes buffer to <code>extract_file</code> and receive an <code>ExtractionResult</code> back. The result contains the extracted text plus metadata such as page count and detected language.</p>
</article>
</div>
</main>
<nav class="md-sidebar md-sidebar--secondary">right nav (toc)</nav>
</div>
<footer class="md-footer">site footer</footer>
</body>
</html>
```

- [ ] **Step 2: Create generic-article fixture (GitHub/mdBook shape)**

Create `tests/fixtures/generic-article.html`:
```html
<!DOCTYPE html>
<html lang="en">
<head>
<meta charset="utf-8">
<title>API Reference</title>
</head>
<body>
<nav>skip me</nav>
<article class="markdown-body">
<h1>API Reference</h1>
<p>The API exposes three primary entry points: <code>extract_file</code>, <code>extract_bytes</code>, and <code>batch_extract_file</code>. All accept the same options object and return identical result shapes.</p>
<h2>extract_file</h2>
<p>Synchronously extract content from a file path on disk. The function reads the file, sniffs the MIME type, and dispatches to the appropriate backend.</p>
</article>
<aside>skip me too</aside>
</body>
</html>
```

- [ ] **Step 3: Create generic-main fixture (HTML5 landmark only)**

Create `tests/fixtures/generic-main.html`:
```html
<!DOCTYPE html>
<html lang="en">
<head>
<meta charset="utf-8">
<title>Plain Page</title>
</head>
<body>
<header>top chrome</header>
<main>
<h1>Plain Page</h1>
<p>This page uses only the HTML5 main landmark with no framework classes. It is the least-specific shape and exercises the bottom of Defuddle's entry-point fallback chain.</p>
<p>Defuddle should still find this content because main is in its ENTRY_POINT_ELEMENTS list as a last-resort landmark.</p>
</main>
<footer>bottom chrome</footer>
</body>
</html>
```

- [ ] **Step 4: Capture goldens by running extractor + Kreuzberg**

Create a one-shot capture script `scripts/capture-goldens.ts`:
```typescript
import { readFileSync, writeFileSync } from "node:fs";
import { join } from "node:path";
import { extractMainContent } from "../src/extract.js";
import { extractBytesSync } from "@kreuzberg/node";

const NEW_FIXTURES = ["material-mkdocs", "generic-article", "generic-main"];

for (const name of NEW_FIXTURES) {
  const raw = readFileSync(join("tests/fixtures", `${name}.html`), "utf8");
  const r = await extractMainContent(raw);
  if (r.status !== "ok") {
    console.error(`FATAL: ${name} returned ${r.status}`);
    process.exit(1);
  }
  const md = extractBytesSync(
    Buffer.from(r.cleanedHtml, "utf8"),
    "text/html",
    { useCache: false, outputFormat: "markdown" },
  );
  const trimmed = md.content.trim();
  writeFileSync(join("tests/expected", `${name}.md`), trimmed + "\n");
  console.log(`captured ${name}.md (${trimmed.length} chars, ${r.wordCount} words)`);
}
```

Run: `npx tsx scripts/capture-goldens.ts`
Expected: three lines `captured X.md (...)` and three new files in `tests/expected/`.

- [ ] **Step 5: Inspect captured goldens**

Run: `head -20 tests/expected/material-mkdocs.md tests/expected/generic-article.md tests/expected/generic-main.md`

Expected for `material-mkdocs.md`: starts with `# Quickstart`, contains "Install Kreuzberg", contains a fenced code block. Does NOT contain "site nav here" / "left nav" / "right nav" / "site footer".

Expected for `generic-article.md`: starts with `# API Reference`, contains "extract_file", does NOT contain "skip me".

Expected for `generic-main.md`: starts with `# Plain Page`, contains "HTML5 main landmark", does NOT contain "top chrome" / "bottom chrome".

If any of these expectations fail, inspect the cleanedHtml manually (modify the script to print `r.cleanedHtml`) and adjust the fixture HTML until Defuddle's auto-detection picks the right element. Do NOT use `--selector` in the goldens — that defeats the purpose of testing auto-detection.

- [ ] **Step 6: Add fixtures to `tests/extract.test.ts` golden cases**

Append to `tests/extract.test.ts`:
```typescript
import { readFileSync } from "node:fs";
import { join } from "node:path";
import { extractBytesSync } from "@kreuzberg/node";

const FIXTURES = "tests/fixtures";
const EXPECTED = "tests/expected";

const NEW_GOLDEN_CASES = ["material-mkdocs", "generic-article", "generic-main"];

describe("extract golden files", () => {
  for (const name of NEW_GOLDEN_CASES) {
    test(`golden: ${name}`, async () => {
      const raw = readFileSync(join(FIXTURES, `${name}.html`), "utf8");
      const r = await extractMainContent(raw);
      expect(r.status).toBe("ok");
      if (r.status === "ok") {
        const md = extractBytesSync(
          Buffer.from(r.cleanedHtml, "utf8"),
          "text/html",
          { useCache: false, outputFormat: "markdown" },
        );
        const expected = readFileSync(join(EXPECTED, `${name}.md`), "utf8");
        expect(md.content.trim()).toBe(expected.trim());
      }
    });
  }
});
```

- [ ] **Step 7: Run tests**

Run: `npx vitest run tests/extract.test.ts`
Expected: PASS — 3 existing tests + 3 golden tests all green.

- [ ] **Step 8: Delete capture script (single-use)**

Run: `rm scripts/capture-goldens.ts`

- [ ] **Step 9: Commit**

```bash
git add tests/fixtures/material-mkdocs.html tests/fixtures/generic-article.html tests/fixtures/generic-main.html
git add tests/expected/material-mkdocs.md tests/expected/generic-article.md tests/expected/generic-main.md
git add tests/extract.test.ts
git commit -m "test(extract): add Material/article/main fixtures + goldens"
```

---

## Task 4: Collapse `src/convert.ts` to extract.ts shim

**Files:**
- Modify: `src/convert.ts`
- Modify: `tests/convert.test.ts`

- [ ] **Step 1: Read current convert.test.ts to see what must adapt**

Run: `cat tests/convert.test.ts | grep -E '^(describe|test|const \w+_CASES)'`

Confirm: top-level describes are `selectBody`, `stripSphinxNoise`, `h1Text + soupTitleText`, `convertHtml result type`, `golden files` (sphinx-* names), `empty classification` (sphinx-empty-body, generic-no-articleBody), `non-utf8 fixture`. The first three describes test internals being removed. The remaining three describe blocks must stay valid.

- [ ] **Step 2: Update tests/convert.test.ts — remove internal-API tests**

Replace `tests/convert.test.ts` contents entirely with:
```typescript
import { readFileSync } from "node:fs";
import { join } from "node:path";
import { describe, expect, test, vi } from "vitest";
import { convertHtml } from "../src/convert.js";

describe("convertHtml result type", () => {
  test("returns ok with body_md + h1_text + soup_title_text for Sphinx shape", async () => {
    const r = await convertHtml(
      '<html><head><title>T</title></head><body><div role="main"><div itemprop="articleBody"><h1>Hello</h1><p>Body content with enough words to pass the threshold check easily.</p></div></div></body></html>',
    );
    expect(r.status).toBe("ok");
    if (r.status === "ok") {
      expect(r.h1_text).toBe("Hello");
      expect(r.soup_title_text).toBe("T");
      expect(r.body_md).toContain("Hello");
    }
  });

  test("returns empty when document has no body", async () => {
    const r = await convertHtml("<html><body></body></html>");
    expect(r.status).toBe("empty");
  });

  test("returns failed when kreuzberg throws", async () => {
    vi.doMock("@kreuzberg/node", () => ({
      extractBytesSync: () => {
        throw new Error("kreuzberg blew up");
      },
    }));
    vi.resetModules();
    const mod = await import("../src/convert.js");
    const r = await mod.convertHtml(
      '<html><body><div itemprop="articleBody"><h1>X</h1><p>Body content with enough words to pass the threshold check easily.</p></div></body></html>',
    );
    expect(r.status).toBe("failed");
    if (r.status === "failed") expect(r.error).toMatch(/kreuzberg/);
    vi.doUnmock("@kreuzberg/node");
    vi.resetModules();
  });
});

const FIXTURES = "tests/fixtures";
const EXPECTED = "tests/expected";

const GOLDEN_CASES = [
  "sphinx-method",
  "sphinx-proto",
  "sphinx-proto-blockquote",
  "sphinx-guide",
  "sphinx-internal-link",
  "sphinx-highlight-default",
];

describe("golden files (Sphinx — unchanged regression)", () => {
  for (const name of GOLDEN_CASES) {
    test(`golden: ${name}`, async () => {
      const raw = readFileSync(join(FIXTURES, `${name}.html`), "utf8");
      const r = await convertHtml(raw);
      expect(r.status).toBe("ok");
      if (r.status === "ok") {
        const expected = readFileSync(join(EXPECTED, `${name}.md`), "utf8");
        expect(r.body_md.trim()).toBe(expected.trim());
      }
    });
  }
});

describe("empty classification", () => {
  test("sphinx-empty-body returns empty (no body content)", async () => {
    const raw = readFileSync(join(FIXTURES, "sphinx-empty-body.html"), "utf8");
    const r = await convertHtml(raw);
    expect(r.status).toBe("empty");
  });
});

describe("non-utf8 fixture", () => {
  test("does not crash and converts", async () => {
    const buf = readFileSync(join(FIXTURES, "non-utf8.html"));
    const raw = buf.toString("utf8");
    const r = await convertHtml(raw);
    expect(r.status).toBe("ok");
    if (r.status === "ok") expect(r.h1_text).toBe("Bad");
  });
});
```

Notes on what changed:
- All `selectBody`/`stripSphinxNoise`/`h1Text`/`soupTitleText` describe blocks removed (those internals no longer exist; equivalent behavior now tested in `tests/extract.test.ts`).
- `convertHtml` is now async — every `expect` block uses `await`.
- `generic-no-articleBody` fixture removed from EMPTY_CASES — Defuddle finds content in any `<p>` with sufficient words. We expect Defuddle to extract something from this fixture (verify in Step 4). If it does, remove the fixture entirely in Step 7.
- Sphinx Sphinx-empty-body remains empty because the fixture has no body words (verify in Step 4).

- [ ] **Step 3: Rewrite `src/convert.ts` as thin shim**

Replace `src/convert.ts` contents with:
```typescript
import { extractBytesSync, type ExtractionConfig } from "@kreuzberg/node";
import { parseHTML } from "linkedom";
import { extractMainContent } from "./extract.js";

const KZ_CONFIG: ExtractionConfig = {
  useCache: false,
  outputFormat: "markdown",
};

export type ConvertResult =
  | {
      status: "ok";
      body_md: string;
      h1_text: string | null;
      soup_title_text: string | null;
    }
  | { status: "empty" }
  | { status: "failed"; error: string };

export interface ConvertOptions {
  selector?: string;
  url?: string;
}

function extractH1(cleanedHtml: string): string | null {
  const { document } = parseHTML(cleanedHtml);
  const h1 = document.querySelector("h1");
  if (!h1) return null;
  const text = (h1.textContent ?? "").trim().replace(/¶+$/, "").trim();
  return text || null;
}

function extractTitle(rawHtml: string): string | null {
  const { document } = parseHTML(rawHtml);
  const t = document.querySelector("title");
  if (!t) return null;
  const text = (t.textContent ?? "").trim();
  return text || null;
}

export async function convertHtml(
  rawHtml: string,
  opts: ConvertOptions = {},
): Promise<ConvertResult> {
  try {
    const extractOpts: { selector?: string; url?: string } = {};
    if (opts.selector !== undefined) extractOpts.selector = opts.selector;
    if (opts.url !== undefined) extractOpts.url = opts.url;
    const extracted = await extractMainContent(rawHtml, extractOpts);
    if (extracted.status === "empty") return { status: "empty" };

    const soupTitle = extractTitle(rawHtml);
    const h1 = extractH1(extracted.cleanedHtml);

    const result = extractBytesSync(
      Buffer.from(extracted.cleanedHtml, "utf8"),
      "text/html",
      KZ_CONFIG,
    );

    return {
      status: "ok",
      body_md: result.content.trim(),
      h1_text: h1,
      soup_title_text: soupTitle,
    };
  } catch (e) {
    const err = e instanceof Error ? `${e.name}: ${e.message}` : String(e);
    return { status: "failed", error: err };
  }
}
```

Notes:
- `cheerio` import removed — `src/convert.ts` no longer imports it. (cheerio is still used by `src/links.ts` and `src/http/crawl.ts`, so package.json keeps the dep.)
- `__testing__` export removed — internals moved to `src/extract.ts`. If any other file in the codebase imports `__testing__`, the typecheck in Step 5 will catch it.
- `convertHtml` is now `async` (Defuddle is async).

- [ ] **Step 4: Run the existing Sphinx goldens and empty case**

Run: `npx vitest run tests/convert.test.ts`
Expected first-run failures:
1. The 6 Sphinx golden tests may pass (Defuddle handles `div[itemprop="articleBody"]` via its ENTRY_POINT_ELEMENTS chain) OR may fail with whitespace/structural diffs.
2. `sphinx-empty-body` should pass (empty stays empty).
3. `non-utf8 fixture` should pass (Defuddle extracts the `<h1>Bad</h1>`).

If golden tests fail with content differences, run:
```bash
npx tsx -e "
import { convertHtml } from './src/convert.js';
import { readFileSync, writeFileSync } from 'node:fs';
const NAMES = ['sphinx-method','sphinx-proto','sphinx-proto-blockquote','sphinx-guide','sphinx-internal-link','sphinx-highlight-default'];
for (const n of NAMES) {
  const r = await convertHtml(readFileSync('tests/fixtures/'+n+'.html','utf8'));
  if (r.status==='ok') {
    writeFileSync('/tmp/'+n+'.actual.md', r.body_md.trim()+'\n');
    console.log('wrote /tmp/'+n+'.actual.md');
  } else { console.log(n, r.status); }
}
"
```
Then `diff tests/expected/sphinx-method.md /tmp/sphinx-method.actual.md` for each name. If diffs are pure formatting (extra blank lines, paragraph wrapping), update the golden — Defuddle's output is the new ground truth. If diffs are content-meaningful (entire blocks dropped), STOP and investigate (Defuddle removed content with low score; consider passing `removeLowScoring: false` in `src/extract.ts`).

- [ ] **Step 5: Typecheck**

Run: `npm run typecheck`
Expected: PASS. If there are errors about `convertHtml` being awaited downstream, note them — Task 5 will fix the CLI call site.

Known expected error: `src/cli.ts` calls `convertHtml(...)` synchronously. Typecheck WILL fail here. That is fine; Task 5 fixes it.

- [ ] **Step 6: Delete obsolete fixture `generic-no-articleBody.html` only if Defuddle no longer treats it as empty**

Run:
```bash
npx tsx -e "
import { convertHtml } from './src/convert.js';
import { readFileSync } from 'node:fs';
const r = await convertHtml(readFileSync('tests/fixtures/generic-no-articleBody.html','utf8'));
console.log(r.status);
"
```

If `ok`, the fixture no longer represents "empty" — it now represents a successful generic-main case which is already covered by `tests/fixtures/generic-main.html`. Delete it:
```bash
git rm tests/fixtures/generic-no-articleBody.html
```

If still `empty`, leave it in place (it might be too short for Defuddle's wordcount threshold).

- [ ] **Step 7: Re-run convert.test.ts**

Run: `npx vitest run tests/convert.test.ts`
Expected: PASS — all describe blocks green.

- [ ] **Step 8: Commit**

```bash
git add src/convert.ts tests/convert.test.ts
[ -e tests/fixtures/generic-no-articleBody.html ] || git rm tests/fixtures/generic-no-articleBody.html 2>/dev/null
git commit -m "refactor(convert): collapse to extract.ts shim, drop selectBody/stripSphinxNoise"
```

---

## Task 5: CLI `--selector` flag

**Files:**
- Modify: `src/cli.ts`
- Create: `tests/cli-selector.test.ts`

- [ ] **Step 1: Write the failing CLI test**

Create `tests/cli-selector.test.ts`:
```typescript
import { mkdtempSync, readdirSync, readFileSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { describe, expect, test, beforeEach } from "vitest";
import { runConvert } from "../src/cli.js";

describe("CLI --selector flag", () => {
  let tmp: string;

  beforeEach(() => {
    tmp = mkdtempSync(join(tmpdir(), "docforge-selector-"));
  });

  test("selector picks specified element, rejecting Defuddle defaults", async () => {
    const html = `<!DOCTYPE html>
<html><head><title>T</title></head><body>
<article class="markdown-body"><h1>Default Pick</h1><p>${"word ".repeat(50)}</p></article>
<aside class="custom-pick"><h1>Custom Pick</h1><p>${"word ".repeat(50)}</p></aside>
</body></html>`;
    const fixDir = join(tmp, "in");
    const outDir = join(tmp, "out");
    writeFileSync(join(mkdirSyncCompat(fixDir), "page.html"), html);

    const code = await runConvert(fixDir, {
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
      selector: "aside.custom-pick",
      llmsFull: "off",
    });
    expect(code).toBe(0);

    const files = readdirSync(outDir);
    expect(files).toContain("page.md");
    const out = readFileSync(join(outDir, "page.md"), "utf8");
    expect(out).toContain("Custom Pick");
    expect(out).not.toContain("Default Pick");
  });
});

import { mkdirSync } from "node:fs";
function mkdirSyncCompat(p: string): string {
  mkdirSync(p, { recursive: true });
  return p;
}
```

- [ ] **Step 2: Run test to verify it fails**

Run: `npx vitest run tests/cli-selector.test.ts`
Expected: FAIL with TypeScript error (`Object literal may only specify known properties, and 'selector' does not exist in type 'ConvertOpts'`). This is the expected red — the flag does not exist yet.

- [ ] **Step 3: Extend `ConvertOpts` and CLI definition**

In `src/cli.ts`, modify `ConvertOpts` interface (around line 64):
```typescript
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
  cache: boolean;
  userAgent: string;
  selector?: string | undefined;
  llmsFull: string;
}
```

In `buildProgram()` (around line 39), add the new options to the `convert` subcommand chain (before `.action(...)`):
```typescript
    .option("--selector <css>", "CSS selector override for body extraction (Defuddle contentSelector)")
    .option("--llms-full <mode>", "llms-full.txt mode: auto|force|off (URL source only)", "auto")
```

- [ ] **Step 4: Thread `selector` through to `convertHtml`**

In `src/cli.ts:runConvert`, find the call site (currently `const result = convertHtml(item.bytes.toString("utf8"));`, around line 164). Replace with:
```typescript
    const convertOpts: { selector?: string; url?: string } = {};
    if (opts.selector !== undefined) convertOpts.selector = opts.selector;
    if (item.srcUri.startsWith("http://") || item.srcUri.startsWith("https://")) {
      convertOpts.url = item.srcUri;
    }
    const result = await convertHtml(item.bytes.toString("utf8"), convertOpts);
```

Note the `await` — `convertHtml` is now async.

- [ ] **Step 5: Run typecheck**

Run: `npm run typecheck`
Expected: PASS. If there are errors about `llmsFull` not being on `ConvertOpts`, double-check Step 3 added the field.

- [ ] **Step 6: Run the selector test**

Run: `npx vitest run tests/cli-selector.test.ts`
Expected: PASS — `Custom Pick` appears, `Default Pick` does not.

- [ ] **Step 7: Run full test suite**

Run: `npm test`
Expected: PASS — all prior tests + new selector test green. `tests/cli.test.ts` may need to add `llmsFull: "auto"` to its option objects; if it fails with `Property 'llmsFull' is missing`, append that key to each `runConvert` call's opts object in `tests/cli.test.ts`. Same for any other test calling `runConvert` directly.

- [ ] **Step 8: Commit**

```bash
git add src/cli.ts tests/cli-selector.test.ts tests/cli.test.ts
git commit -m "feat(cli): add --selector flag for body extraction override"
```

---

## Task 6: `src/http/llms.ts` — probe llms-full.txt

**Files:**
- Create: `src/http/llms.ts`
- Create: `tests/llms-txt.test.ts`
- Create: `tests/fixtures/llms-full-site/llms-full.txt`
- Create: `tests/fixtures/llms-full-site/index.html`
- Create: `tests/fixtures/llms-full-site/sitemap.xml`
- Create: `tests/fixtures/llms-full-site/robots.txt`

- [ ] **Step 1: Create the fixture site**

```bash
mkdir -p tests/fixtures/llms-full-site
```

Create `tests/fixtures/llms-full-site/llms-full.txt`:
```text
# Test Site

This is the canonical llms-full.txt body for the test site.

## Section

Content goes here. Markdown formatting is preserved verbatim.
```

Create `tests/fixtures/llms-full-site/index.html`:
```html
<!DOCTYPE html><html><head><title>HTML root</title></head>
<body><main><h1>HTML root</h1><p>This page should be IGNORED when llms-full.txt is taken.</p></main></body></html>
```

Create `tests/fixtures/llms-full-site/sitemap.xml`:
```xml
<?xml version="1.0" encoding="UTF-8"?>
<urlset xmlns="http://www.sitemaps.org/schemas/sitemap/0.9">
<url><loc>__BASE__/</loc></url>
</urlset>
```

Create `tests/fixtures/llms-full-site/robots.txt`:
```text
User-agent: *
Allow: /
```

- [ ] **Step 2: Write the failing test**

Create `tests/llms-txt.test.ts`:
```typescript
import { afterEach, beforeEach, describe, expect, test } from "vitest";
import { resolve } from "node:path";
import { startStaticServer, type RunningServer } from "./helpers/static-server.js";
import { probeLlmsFullTxt } from "../src/http/llms.js";
import type { FetchOptions } from "../src/http/fetch.js";

let server: RunningServer;
const FIXTURE = resolve("tests/fixtures/llms-full-site");

const FETCH_OPTS: FetchOptions = {
  userAgent: "docforge-test",
  timeoutMs: 5_000,
  maxBytes: 1_000_000,
  cacheDir: null,
};

describe("probeLlmsFullTxt", () => {
  beforeEach(async () => {
    server = await startStaticServer({ rootDir: FIXTURE, rewriteBase: true });
  });
  afterEach(async () => {
    await server.close();
  });

  test("returns body when /llms-full.txt exists with text content type", async () => {
    const r = await probeLlmsFullTxt(server.baseUrl, FETCH_OPTS);
    expect(r).not.toBeNull();
    if (r) {
      expect(r.url).toBe(`${server.baseUrl}/llms-full.txt`);
      expect(r.bytes.toString("utf8")).toContain("This is the canonical");
      expect(r.contentType).toMatch(/^text\//);
    }
  });

  test("returns null when /llms-full.txt does not exist", async () => {
    // start a server pointing at a directory WITHOUT llms-full.txt
    await server.close();
    server = await startStaticServer({ rootDir: resolve("tests/fixtures"), rewriteBase: false });
    const r = await probeLlmsFullTxt(server.baseUrl, FETCH_OPTS);
    expect(r).toBeNull();
  });
});
```

- [ ] **Step 3: Run test to verify it fails**

Run: `npx vitest run tests/llms-txt.test.ts`
Expected: FAIL — `Cannot find module '../src/http/llms.js'`.

- [ ] **Step 4: Implement `src/http/llms.ts`**

Create `src/http/llms.ts`:
```typescript
import { fetchUrl, FetchError, type FetchOptions } from "./fetch.js";

export interface LlmsFullResult {
  url: string;
  bytes: Buffer;
  contentType: string;
}

export async function probeLlmsFullTxt(
  rootUrl: string,
  opts: FetchOptions,
): Promise<LlmsFullResult | null> {
  const origin = new URL(rootUrl).origin;
  const candidate = `${origin}/llms-full.txt`;
  try {
    const res = await fetchUrl(candidate, opts);
    if (res.status !== 200) return null;
    const ct = res.contentType.toLowerCase();
    if (!ct.startsWith("text/")) return null;
    return {
      url: candidate,
      bytes: res.bytes,
      contentType: res.contentType,
    };
  } catch (e) {
    if (e instanceof FetchError) return null;
    throw e;
  }
}
```

- [ ] **Step 5: Run tests to verify pass**

Run: `npx vitest run tests/llms-txt.test.ts`
Expected: PASS — both tests green.

- [ ] **Step 6: Commit**

```bash
git add src/http/llms.ts tests/llms-txt.test.ts tests/fixtures/llms-full-site/
git commit -m "feat(http): add probeLlmsFullTxt for llms-full.txt detection"
```

---

## Task 7: `SourceItem.kind` + `HttpSource` probe

**Files:**
- Modify: `src/source.ts`
- Modify: `src/http/crawl.ts` (add `llmsFullMode` to CrawlOptions)
- Modify: `tests/source.test.ts` (extend with kind assertion)
- Create: `tests/source-llms-full.test.ts`

- [ ] **Step 1: Write the failing test for HttpSource probe**

Create `tests/source-llms-full.test.ts`:
```typescript
import { afterEach, beforeEach, describe, expect, test } from "vitest";
import { resolve } from "node:path";
import { startStaticServer, type RunningServer } from "./helpers/static-server.js";
import { HttpSource, type SourceItem } from "../src/source.js";
import type { FetchOptions } from "../src/http/fetch.js";
import type { CrawlOptions } from "../src/http/crawl.js";

let server: RunningServer;
const FIXTURE = resolve("tests/fixtures/llms-full-site");

const FETCH_OPTS: FetchOptions = {
  userAgent: "docforge-test",
  timeoutMs: 5_000,
  maxBytes: 1_000_000,
  cacheDir: null,
};

function crawlOpts(mode: "auto" | "force" | "off"): CrawlOptions {
  return {
    maxPages: 100,
    maxDepth: 5,
    concurrency: 2,
    userAgent: "docforge-test",
    llmsFullMode: mode,
  };
}

async function collect(source: HttpSource): Promise<SourceItem[]> {
  const items: SourceItem[] = [];
  for await (const item of source.iter()) items.push(item);
  return items;
}

describe("HttpSource llms-full short-circuit", () => {
  beforeEach(async () => {
    server = await startStaticServer({ rootDir: FIXTURE, rewriteBase: true });
  });
  afterEach(async () => {
    await server.close();
  });

  test("auto mode: yields single llms-full item when file exists", async () => {
    const source = new HttpSource(server.baseUrl, FETCH_OPTS, crawlOpts("auto"));
    const items = await collect(source);
    expect(items.length).toBe(1);
    expect(items[0]!.kind).toBe("llms-full");
    expect(items[0]!.key).toBe("llms-full.txt");
    expect(items[0]!.bytes.toString("utf8")).toContain("This is the canonical");
  });

  test("off mode: ignores llms-full.txt and yields HTML items", async () => {
    const source = new HttpSource(server.baseUrl, FETCH_OPTS, crawlOpts("off"));
    const items = await collect(source);
    expect(items.length).toBeGreaterThan(0);
    expect(items.every((i) => i.kind !== "llms-full")).toBe(true);
  });

  test("force mode: throws when llms-full.txt missing", async () => {
    await server.close();
    server = await startStaticServer({ rootDir: resolve("tests/fixtures"), rewriteBase: false });
    const source = new HttpSource(server.baseUrl, FETCH_OPTS, crawlOpts("force"));
    await expect(collect(source)).rejects.toThrow(/llms-full\.txt required/);
  });
});
```

- [ ] **Step 2: Run test to verify it fails**

Run: `npx vitest run tests/source-llms-full.test.ts`
Expected: FAIL with TS error `Property 'llmsFullMode' does not exist on type 'CrawlOptions'` and `Property 'kind' does not exist on type 'SourceItem'`.

- [ ] **Step 3: Extend `CrawlOptions`**

In `src/http/crawl.ts`, modify `CrawlOptions` interface (line 8):
```typescript
export interface CrawlOptions {
  maxPages: number;
  maxDepth: number;
  concurrency: number;
  userAgent: string;
  llmsFullMode: "auto" | "force" | "off";
}
```

Existing `crawlBfs` does not need to react to `llmsFullMode` — only `HttpSource.iter()` does. The added field is plumbing.

- [ ] **Step 4: Extend `SourceItem` and `HttpSource.iter()`**

In `src/source.ts`, modify `SourceItem` interface (line 15):
```typescript
export interface SourceItem {
  key: string;
  srcUri: string;
  bytes: Buffer;
  contentType: string;
  error?: string;
  kind?: "html" | "llms-full";
}
```

Add import at top of file:
```typescript
import { probeLlmsFullTxt } from "./http/llms.js";
```

Modify `HttpSource.iter()` (currently around line 62):
```typescript
  async *iter(): AsyncIterable<SourceItem> {
    const normalized = normalizeUrl(this.rootUrl);
    if (!normalized) throw new Error(`invalid root url: ${this.rootUrl}`);

    if (this.crawlOpts.llmsFullMode !== "off") {
      const llms = await probeLlmsFullTxt(normalized, this.fetchOpts);
      if (llms) {
        yield {
          key: "llms-full.txt",
          srcUri: llms.url,
          bytes: llms.bytes,
          contentType: llms.contentType,
          kind: "llms-full",
        };
        return;
      }
      if (this.crawlOpts.llmsFullMode === "force") {
        throw new Error(
          `llms-full.txt required (--llms-full force) but not found at ${this.rootUrl}`,
        );
      }
    }

    const origin = new URL(normalized).origin;
    const robots = await getRobots(origin, this.fetchOpts);
    const sitemapUrls = await discoverSitemaps(normalized, robots, this.fetchOpts);

    if (sitemapUrls.length > 0) {
      yield* this.iterFromSitemap(sitemapUrls, robots);
    } else {
      yield* this.iterFromBfs(robots);
    }
  }
```

- [ ] **Step 5: Run tests to verify pass**

Run: `npx vitest run tests/source-llms-full.test.ts`
Expected: PASS — three tests green.

- [ ] **Step 6: Update existing tests that build `CrawlOptions`**

Run: `grep -nE '^\s*(const|let|var)\s+\w+(\s*:\s*CrawlOptions)?\s*=\s*\{' tests/`
Inspect each match. For each `CrawlOptions` literal missing `llmsFullMode`, add the field — for tests that exercise the HTTP source against arbitrary servers, use `llmsFullMode: "off"` (don't poll for llms-full.txt). For tests that explicitly target llms-full behavior, use `"auto"` or `"force"` as needed.

Likely-affected files (verify):
- `tests/crawl-bfs-fallback.test.ts`
- `tests/crawl-cache-304.test.ts`
- `tests/crawl-e2e.test.ts`
- `tests/crawl-fail-threshold.test.ts`
- `tests/crawl-robots-deny.test.ts`
- `tests/http-crawl.test.ts`
- `tests/source.test.ts`

Add `llmsFullMode: "off"` to each `CrawlOptions` literal in those files.

- [ ] **Step 7: Run full suite**

Run: `npm test`
Expected: PASS (excluding `tests/cli.test.ts` and others that haven't been wired through Task 8 yet — note any failures and verify they relate to the missing `llmsFull` field on CLI opts, which Task 8 handles).

If there are failures in `tests/cli.test.ts`, add `llmsFull: "off"` and `selector: undefined` to each `runConvert` opts object. Those are the new CLI fields; the CLI test file calls `runConvert` directly with a plain object.

- [ ] **Step 8: Commit**

```bash
git add src/http/crawl.ts src/source.ts tests/source-llms-full.test.ts tests/crawl-*.test.ts tests/http-crawl.test.ts tests/source.test.ts tests/cli.test.ts
git commit -m "feat(source): probe llms-full.txt before crawl, yield kind='llms-full'"
```

---

## Task 8: CLI `--llms-full` plumbing + loop short-circuit

**Files:**
- Modify: `src/cli.ts`
- Create: `tests/cli-llms-full.test.ts`

- [ ] **Step 1: Write the failing CLI test**

Create `tests/cli-llms-full.test.ts`:
```typescript
import { afterEach, beforeEach, describe, expect, test } from "vitest";
import { mkdtempSync, readdirSync, readFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { join, resolve } from "node:path";
import { startStaticServer, type RunningServer } from "./helpers/static-server.js";
import { runConvert } from "../src/cli.js";

let server: RunningServer;
let outDir: string;
const FIXTURE = resolve("tests/fixtures/llms-full-site");

describe("CLI --llms-full flag", () => {
  beforeEach(async () => {
    server = await startStaticServer({ rootDir: FIXTURE, rewriteBase: true });
    outDir = mkdtempSync(join(tmpdir(), "docforge-llms-"));
  });
  afterEach(async () => {
    await server.close();
  });

  test("auto: writes llms-full.md when present, skips HTML crawl", async () => {
    const code = await runConvert(server.baseUrl, baseOpts(outDir, "auto"));
    expect(code).toBe(0);
    const files = readdirSync(outDir);
    expect(files).toContain("llms-full.md");
    const out = readFileSync(join(outDir, "llms-full.md"), "utf8");
    expect(out).toContain("This is the canonical");
    expect(files.some((f) => f.startsWith("index"))).toBe(false);
  });

  test("off: ignores llms-full.txt, walks HTML normally", async () => {
    const code = await runConvert(server.baseUrl, baseOpts(outDir, "off"));
    expect(code).toBe(0);
    const files = readdirSync(outDir);
    expect(files).not.toContain("llms-full.md");
  });

  test("force: succeeds when present", async () => {
    const code = await runConvert(server.baseUrl, baseOpts(outDir, "force"));
    expect(code).toBe(0);
    const files = readdirSync(outDir);
    expect(files).toContain("llms-full.md");
  });
});

function baseOpts(outDir: string, llmsFull: string) {
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
    llmsFull,
  };
}
```

- [ ] **Step 2: Run test to verify it fails**

Run: `npx vitest run tests/cli-llms-full.test.ts`
Expected: FAIL — output dir contains no `llms-full.md` because the CLI doesn't handle `kind: 'llms-full'` yet.

- [ ] **Step 3: Wire `llmsFull` into CrawlOptions construction in `runConvert`**

In `src/cli.ts:runConvert`, locate the URL branch's `const crawlOpts: CrawlOptions = { ... }` block (around line 102). Add validation and pass the mode:
```typescript
    const llmsFullMode = opts.llmsFull as "auto" | "force" | "off";
    if (llmsFullMode !== "auto" && llmsFullMode !== "force" && llmsFullMode !== "off") {
      log("error", `invalid --llms-full value: ${opts.llmsFull} (expected auto|force|off)`);
      return 2;
    }
    const crawlOpts: CrawlOptions = {
      maxPages: parseInt(opts.maxPages, 10),
      maxDepth: parseInt(opts.maxDepth, 10),
      concurrency: parseInt(opts.concurrency, 10),
      userAgent: opts.userAgent,
      llmsFullMode,
    };
```

- [ ] **Step 4: Add short-circuit in the CLI loop**

In `src/cli.ts:runConvert`, find the `for await (const item of source.iter())` loop body. Right after the `if (item.error)` block and before the `if (opts.dryRun)` block, insert:
```typescript
    if (item.kind === "llms-full") {
      if (opts.dryRun) {
        log("info", `DRY ${item.key} -> ${outPath}`);
        continue;
      }
      const md = rewriteInternalLinks(item.bytes.toString("utf8"));
      writeOutput(outPath, md);
      converted += 1;
      report.push({ input: item.key, srcUri: item.srcUri, output: outPath, status: "ok" });
      continue;
    }
```

Note: `outPath` is computed before this branch (existing `const outPath = computeOutputPath(item, output);` at top of the loop, around line 138). `computeOutputPath` for an http(s) `srcUri` ending in `/llms-full.txt` produces `<outputDir>/llms-full.txt` (URL pathname stripped, extension preserved by `urlToOutputPath`). That is wrong — the file should be `llms-full.md`. Fix `computeOutputPath` to rewrite `.txt` to `.md` when `kind === 'llms-full'`:

Modify `computeOutputPath` (around line 215):
```typescript
function computeOutputPath(item: SourceItem, outputDir: string): string {
  if (item.kind === "llms-full") {
    return resolve(outputDir, "llms-full.md");
  }
  if (item.srcUri.startsWith("http://") || item.srcUri.startsWith("https://")) {
    return urlToOutputPath(item.srcUri, outputDir);
  }
  const outRel = item.key.replace(/\.html?$/i, ".md");
  return resolve(outputDir, outRel);
}
```

- [ ] **Step 5: Run the CLI llms-full test**

Run: `npx vitest run tests/cli-llms-full.test.ts`
Expected: PASS — all three subtests (auto/off/force) green.

- [ ] **Step 6: Run full suite**

Run: `npm test`
Expected: PASS — no regressions. If `tests/cli.test.ts` fails because its opts object is missing `llmsFull`, add `llmsFull: "off"` to each test's opts (this should already have been done in Task 7 Step 6).

- [ ] **Step 7: Commit**

```bash
git add src/cli.ts tests/cli-llms-full.test.ts
git commit -m "feat(cli): add --llms-full flag (auto|force|off) with loop short-circuit"
```

---

## Task 9: Dogfood validation against docs.kreuzberg.dev

**Files:**
- Output: `/tmp/dogfood-docs/` (not committed)
- Output: `/tmp/dogfood-marketing/` (not committed)
- Output: `docs/superpowers/dogfood-2026-05-11-body-picker.md` (committed report)

- [ ] **Step 1: Build the binary**

Run: `npm run build`
Expected: PASS — `dist/bin.js` exists.

- [ ] **Step 2: Run against docs.kreuzberg.dev**

```bash
node dist/bin.js convert https://docs.kreuzberg.dev --output /tmp/dogfood-docs --max-pages 15 --report-json /tmp/dogfood-docs-report.json
```

Capture stdout. The summary line should report `converted=N empty=M skipped=K failed=L total=15`.

**Acceptance** (per spec §"Acceptance criteria" item 1): `converted >= 12`. Anything less than 12 means the body picker is regressing somewhere; pick one of the empty/failed entries from `/tmp/dogfood-docs-report.json` and re-run `npx tsx scripts/spike-defuddle.ts` against that specific URL to investigate.

- [ ] **Step 3: Run against kreuzberg.dev (marketing site)**

```bash
node dist/bin.js convert https://kreuzberg.dev --output /tmp/dogfood-marketing --max-pages 10 --report-json /tmp/dogfood-marketing-report.json
```

**Acceptance** (per spec §"Acceptance criteria" item 2): `converted >= 1` (lower bar — marketing-site shape is harder). The site publishes `llms-full.txt`, so with `--llms-full auto` (default) the run should yield a single `llms-full.md` and report `converted=1`. Verify:
```bash
ls /tmp/dogfood-marketing/
cat /tmp/dogfood-marketing/llms-full.md | head -20
```

Expected: a single file `llms-full.md`; head shows the marketing site's llms-full body (publisher description, key features, install commands).

- [ ] **Step 4: Run --llms-full off against same marketing site**

```bash
node dist/bin.js convert https://kreuzberg.dev --output /tmp/dogfood-marketing-off --max-pages 10 --llms-full off --report-json /tmp/dogfood-marketing-off-report.json
```

Verify the HTML-crawl path takes over and writes at least one `.md` file from a real HTML page (root, /privacy, /terms, etc.). Per spec §"Acceptance criteria" item 6, the `off` mode must skip llms-full detection entirely.

- [ ] **Step 5: Spot-check converted Markdown quality**

```bash
ls /tmp/dogfood-docs/
head -40 /tmp/dogfood-docs/quickstart.md
head -40 /tmp/dogfood-docs/reference/api-typescript.md  # or whichever path exists
```

Inspect: does the page start with `# <Title>`? Are code blocks fenced? Is nav/sidebar text absent? Are internal links rewritten to `.md` extensions?

If quality is poor (code language tags lost, headings dropped), note in dogfood report — this informs whether to file follow-up issues or escalate before merge.

- [ ] **Step 6: Write dogfood report**

Create `docs/superpowers/dogfood-2026-05-11-body-picker.md`:
```markdown
# Body Picker Dogfood Report — 2026-05-11

**Branch:** body-picker-defuddle
**HEAD:** <fill in `git rev-parse HEAD`>
**Spec:** docs/superpowers/specs/2026-05-11-docforge-body-picker-defuddle-design.md
**Plan:** docs/superpowers/plans/2026-05-11-docforge-body-picker-defuddle.md

## docs.kreuzberg.dev (Material for MkDocs, --max-pages 15)

- converted: N
- empty: M
- skipped: K
- failed: L
- total: 15

**Acceptance gate (≥12 converted): PASS / FAIL**

[paste summary line + any notable per-page failures here]

## kreuzberg.dev (marketing + llms-full.txt, --max-pages 10, default --llms-full auto)

- converted: 1 (single `llms-full.md`)
- output filename: `llms-full.md`
- bytes: <fill in>

**Acceptance gate (≥1 converted): PASS / FAIL**

## kreuzberg.dev with --llms-full off (--max-pages 10)

- converted: N
- HTML pages handled: yes/no

## Quality notes

[Code blocks preserved? Headings intact? Internal links rewritten? Nav stripped? Any per-site oddities worth filing as follow-up issues?]

## Follow-ups

- [ ] [Optional: file beads issues for failing pages with `[docforge] body picker:` prefix]
```

Fill in actual numbers from Steps 2-5.

- [ ] **Step 7: Commit dogfood report**

```bash
git add docs/superpowers/dogfood-2026-05-11-body-picker.md
git commit -m "docs: dogfood report — body picker generalization 2026-05-11"
```

- [ ] **Step 8: Decision gate**

If both acceptance gates pass (≥12 on docs, ≥1 on marketing) → proceed to Task 10.

If either fails → STOP. Do not bump version or finalize README. Triage failures: are they Defuddle scoring issues (file follow-up, ship anyway), or fundamental extraction failures (consider fallback to Option B)?

---

## Task 10: README + version bump + final commit

**Files:**
- Modify: `README.md`
- Modify: `package.json` (version 0.5.0 → 0.6.0)

- [ ] **Step 1: Read current README to find sections that mention body picker**

Run: `grep -nE 'Sphinx|articleBody|selectBody|body picker|HTML to' README.md`
Identify the section(s) that describe how docforge picks the body. Likely candidates: "Features" list, "How it works" section, "Roadmap".

- [ ] **Step 2: Update README**

Replace the Sphinx-only body picker description (whatever sentence/section was identified in Step 1) with text approximating:

```markdown
### Body extraction

docforge uses [Defuddle](https://github.com/kepano/defuddle) to find the
primary article content on each page. Defuddle ranks class-name evidence
(`#post`, `.markdown-body`, `.md-content__inner`, `.theme-doc-markdown`,
`.vp-doc`, ...) above semantic landmarks (`<main>`, `<article>`,
`[role="main"]`) and falls back to scoring-based detection. The same picker
works for Sphinx, Material for MkDocs, Docusaurus, VitePress, GitHub-flavoured
Markdown, mdBook, and bare HTML5 pages out of the box.

Override per run with `--selector <css>` when the picker chooses the wrong
element on a specific site.
```

Add a new section near the URL-source section (or under "Usage"):

```markdown
### llms-full.txt shortcut

When a site publishes an [llms-full.txt](https://llmstxt.org/) at its root,
docforge can fetch that single file instead of crawling the HTML site.
Enabled by default for URL sources; control with `--llms-full <mode>`:

- `auto` (default): probe `<origin>/llms-full.txt` first; fall back to HTML
  crawl if absent.
- `force`: require the file; exit with an error if missing.
- `off`: skip the probe entirely.

The output filename is `llms-full.md` (the body is written verbatim after
internal-link rewriting; no Defuddle, no Kreuzberg).
```

- [ ] **Step 3: Bump package version**

Run:
```bash
npm version --no-git-tag-version 0.6.0
cat package.json | grep '"version"'
```
Expected: `"version": "0.6.0",`

- [ ] **Step 4: Run typecheck + tests one final time**

Run: `npm run typecheck && npm test`
Expected: PASS — full suite green.

- [ ] **Step 5: Final commit**

```bash
git add README.md package.json package-lock.json
git commit -m "release: v0.6.0 — body picker via Defuddle + llms-full.txt support"
```

---

## Task 11: Beads closeout + branch handoff

**Files:** None (state-only)

- [ ] **Step 1: Verify all tests pass + status clean**

Run: `git status && npm test`
Expected: working tree clean (or only untracked unrelated files); all tests green.

- [ ] **Step 2: Update the beads issue with completion notes**

The plan was tracked under bd issue `infra-x0b` ("[docforge] body picker generalization via Defuddle + llms-full.txt").

Run:
```bash
bd update infra-x0b --notes "Implementation complete on branch body-picker-defuddle. Spike result: N/10 (Task 1). Dogfood result: docs.kreuzberg.dev converted=X/15, kreuzberg.dev llms-full=1/1. Report: docs/superpowers/dogfood-2026-05-11-body-picker.md. New deps: defuddle@^0.18.1 + linkedom@^0.18.12. Version bumped 0.5.0 -> 0.6.0. Awaiting user decision on merge order with url-source (B1 vs B2)."
```

- [ ] **Step 3: Persist key learnings via `bd remember`**

Run:
```bash
bd remember --key docforge-body-picker-shipped-2026-05-11 "docforge body picker generalization shipped 2026-05-11 on branch body-picker-defuddle (forked from url-source). Replaced Sphinx-only selectBody/stripSphinxNoise in src/convert.ts with Defuddle-based src/extract.ts (~40 lines). Defuddle option for selector override is contentSelector (NOT entryPoint as spec inferred). Added src/http/llms.ts probe + SourceItem.kind='llms-full' short-circuit in HttpSource.iter. Two new CLI flags on convert: --selector <css> and --llms-full <auto|force|off>. Output filename for llms-full source: llms-full.md. New deps: defuddle@^0.18.1 + linkedom@^0.18.12 (linkedom is also defuddle's transitive dep). Version 0.6.0. Spike result on docs.kreuzberg.dev: N/10. Plan: docs/superpowers/plans/2026-05-11-docforge-body-picker-defuddle.md. Spec: docs/superpowers/specs/2026-05-11-docforge-body-picker-defuddle-design.md."
```

Replace `N/10` and `X/15` with actual figures captured in Task 1 + Task 9.

- [ ] **Step 4: Close the beads issue**

Run:
```bash
bd close infra-x0b --reason "Body picker generalization complete; merged on branch body-picker-defuddle (forked from url-source). 0.6.0 ready for merge to master."
```

- [ ] **Step 5: Hand off to user**

Final session message should summarize: branch state, test count, dogfood numbers, version bump, and the two open questions for the user:
1. Merge order: url-source → master first, then body-picker-defuddle → master? Or vice versa? Or interleave?
2. Push to remote / open PR?

---

## Self-review notes

**Spec coverage:**
- §"Decision" — Defuddle + llms-full.txt = Task 2 + Tasks 6-8. PASS.
- §"Validation gate" — Task 1 (spike) GATEs the rest. PASS.
- §"Integration design — File structure" — every Create/Modify file listed maps to a Task. PASS.
- §"Defuddle integration sketch" — Task 2 implements; corrected `entryPoint` → `contentSelector` (verified via local package inspection — see Task 0 Step 4). PASS.
- §"llms-full.txt detection sketch" — Task 6. PASS.
- §"`--selector` flag" — Task 5. PASS.
- §"Acceptance criteria" items 1-7 — Task 9 covers items 1, 2, 5, 6, 7; items 3 (181 tests pass) and 4 (selector override) covered cumulatively by Tasks 3-8. PASS.
- §"Branch strategy" — Plan chose B1; recorded in plan header + Task 11 Step 5. PASS.
- §"Risk register" — Risk items become commit-time observations in Task 1 Step 4 and Task 9 Step 5. PASS.
- §"Open questions" — Q1 resolved during Task 0 Step 4 (`contentSelector` confirmed). Q2-4 inspected in Task 1 Step 4 + Task 9 Step 5. Q5 resolved in plan: `llms-full.md` filename (Task 8 Step 4). PASS.

**Placeholder scan:** No "TBD" / "TODO" / "fill in later" markers. Every code step has actual code. Every command has expected output (where deterministic) or a concrete inspection target (where output depends on real-world data, e.g. spike). The dogfood report template DOES contain `[paste summary line ... here]` and `[Code blocks preserved? ...]` — these are dogfood-time observations the engineer captures; they are deliberate placeholders inside a report DOCUMENT, not skip-able plan steps.

**Type consistency:**
- `ExtractOptions` defined in Task 2 Step 3, used in Task 4 Step 3 + Task 5 Step 4. Field names match (`selector`, `url`). PASS.
- `ConvertResult` shape unchanged from prior file (still `{status: "ok"|"empty"|"failed", body_md, h1_text, soup_title_text, error}`). PASS.
- `SourceItem.kind` typed as `"html" | "llms-full"` consistently (Task 7 Step 4). PASS.
- `CrawlOptions.llmsFullMode` typed as `"auto" | "force" | "off"` in Task 7 Step 3; CLI parses opts.llmsFull (string) and validates against the same three values in Task 8 Step 3. PASS.
- `convertHtml` signature changes from sync to async in Task 4; every caller in tests is awaited (Task 4 Step 2) and the CLI call site is awaited (Task 5 Step 4). PASS.
