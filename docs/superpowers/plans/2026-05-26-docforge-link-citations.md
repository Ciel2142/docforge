# Link → Footnote Citations Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Add an opt-in `--cite-links` flag that converts external `[text](https://…)` links in the converted Markdown body into `[^n]` footnotes plus a trailing `## References` block.

**Architecture:** A new pure module `src/citations.ts` exposes `convertLinksToFootnotes(md)`. `runPipeline.ts` calls it on `bodyMd` after the link/VLM/asset passes and before the output builders, gated on `opts.citeLinks`. The fenced-code-range helper (`fenceRanges`/`inAnyRange`), currently local to `src/vlm/select.ts`, is lifted to a shared `src/md-fences.ts` so both the VLM image scan and the citation pass skip code fences. The CLI threads `--cite-links` (default off) through and surfaces a footnote count in stats. When the flag is off, output is byte-identical to current behavior.

**Tech Stack:** TypeScript (ESM, `.js` import specifiers), vitest, commander.

**Spec:** `docs/superpowers/specs/2026-05-26-docforge-link-citations-design.md`

---

## Scope notes (read first)

- **HTML-conversion branch only.** The spec's pipeline placement (§2) names the passes that exist *only* in the HTML branch of `runPipeline.ts` (`relativizeSameOriginLinks`/`delocalizeLinks`, `toObsidianWikilinks`/`rewriteInternalLinks`, VLM, asset pass). The Markdown-passthrough branch (`item.kind === "markdown" | "llms-full"`, runPipeline.ts:129-157) runs none of those, so it is **out of scope** for v1. Do not wire citations into the passthrough branch.
- **Both output formats** (`default` and `obsidian`) get footnotes when the flag is on — the single insertion point sits before the format-conditional output build, so no per-format branching is needed.
- `--cite-links` is **format-agnostic** (unlike `--save-images`, which requires `--format obsidian`). No format gate.

## File structure

| File | Responsibility | Action |
|---|---|---|
| `src/md-fences.ts` | Shared: compute fenced-code byte ranges; test membership | **Create** (lift from `vlm/select.ts`) |
| `src/vlm/select.ts` | Image-ref scanning | **Modify** — import fence helpers instead of defining them |
| `src/citations.ts` | `convertLinksToFootnotes(md)` — external links → `[^n]` + `## References` | **Create** |
| `src/runPipeline.ts` | Pipeline orchestration | **Modify** — option, accumulator, call, result field |
| `src/cli.ts` | CLI surface | **Modify** — `--cite-links` flag, threading, stat log |
| `README.md` | User docs | **Modify** — document `--cite-links` |
| `tests/md-fences.test.ts` | Unit: fence helpers | **Create** |
| `tests/citations.test.ts` | Unit: `convertLinksToFootnotes` | **Create** |
| `tests/pipeline-citations.test.ts` | Integration: flag on (both formats) + flag-off regression | **Create** |
| `tests/cli-cite-links.test.ts` | CLI: `--cite-links` end-to-end | **Create** |

---

## Task 1: Lift fence helpers into a shared module

Pure refactor (behavior-preserving). The citation pass needs the same code-fence skip the VLM image scan uses; `fenceRanges`/`inAnyRange` are currently private to `vlm/select.ts`. Move them to `src/md-fences.ts` and have `select.ts` import them.

**Files:**
- Create: `src/md-fences.ts`
- Create: `tests/md-fences.test.ts`
- Modify: `src/vlm/select.ts:7-28` (remove local defs), `src/vlm/select.ts:1` (add import)

- [ ] **Step 1: Write the failing test**

Create `tests/md-fences.test.ts`:

```ts
import { describe, expect, test } from "vitest";
import { fenceRanges, inAnyRange } from "../src/md-fences.js";

describe("fenceRanges", () => {
  test("no fences → empty", () => {
    expect(fenceRanges("plain text\nmore text")).toEqual([]);
  });

  test("one ``` fence → one range covering it", () => {
    const md = "before\n```\ncode\n```\nafter";
    const ranges = fenceRanges(md);
    expect(ranges).toHaveLength(1);
    const [start, end] = ranges[0]!;
    expect(md.slice(start, end)).toContain("```\ncode\n```");
  });

  test("unterminated fence runs to end of string", () => {
    const md = "x\n```\ncode never closed";
    const ranges = fenceRanges(md);
    expect(ranges).toHaveLength(1);
    expect(ranges[0]![1]).toBe(md.length);
  });

  test("~~~ fence recognized", () => {
    expect(fenceRanges("~~~\ncode\n~~~")).toHaveLength(1);
  });
});

describe("inAnyRange", () => {
  test("inside a range → true; outside → false", () => {
    const ranges: Array<[number, number]> = [[5, 10]];
    expect(inAnyRange(7, ranges)).toBe(true);
    expect(inAnyRange(5, ranges)).toBe(true);  // start inclusive
    expect(inAnyRange(10, ranges)).toBe(false); // end exclusive
    expect(inAnyRange(2, ranges)).toBe(false);
  });
});
```

- [ ] **Step 2: Run test to verify it fails**

Run: `npx vitest run tests/md-fences.test.ts`
Expected: FAIL — `Failed to resolve import "../src/md-fences.js"` (module not created yet).

- [ ] **Step 3: Create the module**

Create `src/md-fences.ts` (verbatim copy of the current logic in `src/vlm/select.ts:7-28`, now exported):

```ts
/** Byte ranges (start inclusive, end exclusive) covered by ``` / ~~~ fences. */
export function fenceRanges(md: string): Array<[number, number]> {
  const ranges: Array<[number, number]> = [];
  let offset = 0;
  let fenceStart = -1;
  for (const line of md.split("\n")) {
    if (/^\s*(```|~~~)/.test(line)) {
      if (fenceStart === -1) fenceStart = offset;
      else {
        ranges.push([fenceStart, offset + line.length]);
        fenceStart = -1;
      }
    }
    offset += line.length + 1; // +1 for the consumed "\n"
  }
  if (fenceStart !== -1) ranges.push([fenceStart, md.length]);
  return ranges;
}

export function inAnyRange(i: number, ranges: Array<[number, number]>): boolean {
  return ranges.some(([s, e]) => i >= s && i < e);
}
```

- [ ] **Step 4: Run test to verify it passes**

Run: `npx vitest run tests/md-fences.test.ts`
Expected: PASS (6 tests).

- [ ] **Step 5: Refactor `src/vlm/select.ts` to import the shared helpers**

In `src/vlm/select.ts`, replace the local definitions (current lines 7-28, the `fenceRanges` and `inAnyRange` functions plus the doc comment) with nothing, and add an import at the top.

Change the top of the file from:

```ts
import type { ImageRef } from "./types.js";

const NAME_SKIP = /(icon|logo|sprite|badge|avatar|emoji|spacer|pixel)/i;
```

to:

```ts
import type { ImageRef } from "./types.js";
import { fenceRanges, inAnyRange } from "../md-fences.js";

const NAME_SKIP = /(icon|logo|sprite|badge|avatar|emoji|spacer|pixel)/i;
```

Then delete the two functions and the `/** Byte ranges … */` doc comment (the block spanning the original `fenceRanges` and `inAnyRange` definitions). Leave `findImageRefs`, `isDescribable`, `isSavable` untouched — they already call `fenceRanges(md)` / `inAnyRange(...)`, now resolved via the import.

- [ ] **Step 6: Run the affected tests to verify no regression**

Run: `npx vitest run tests/vlm-select.test.ts tests/md-fences.test.ts`
Expected: PASS — `vlm-select.test.ts` (its "ignores images inside fenced code blocks" case still passes) and `md-fences.test.ts` both green.

- [ ] **Step 7: Commit**

```bash
git add src/md-fences.ts tests/md-fences.test.ts src/vlm/select.ts
git commit -m "refactor(md): lift fenceRanges/inAnyRange to shared src/md-fences.ts (docf-vz0)"
```

---

## Task 2: `convertLinksToFootnotes` module (TDD)

**Files:**
- Create: `src/citations.ts`
- Create: `tests/citations.test.ts`

- [ ] **Step 1: Write the failing test**

Create `tests/citations.test.ts`:

```ts
import { describe, expect, test } from "vitest";
import { convertLinksToFootnotes } from "../src/citations.js";

describe("convertLinksToFootnotes", () => {
  test("external link → marker + References block", () => {
    const { md, count } = convertLinksToFootnotes("See [the docs](https://example.com/a).");
    expect(md).toBe(
      "See the docs[^1].\n\n## References\n\n[^1]: https://example.com/a\n",
    );
    expect(count).toBe(1);
  });

  test("http (not just https) is converted", () => {
    const { md, count } = convertLinksToFootnotes("[x](http://example.com/p)");
    expect(count).toBe(1);
    expect(md).toContain("x[^1]");
    expect(md).toContain("[^1]: http://example.com/p");
  });

  test("duplicate URLs share one footnote and one definition", () => {
    const { md, count } = convertLinksToFootnotes(
      "[a](https://x.com/1) and [b](https://x.com/1)",
    );
    expect(count).toBe(1);
    expect(md).toContain("a[^1]");
    expect(md).toContain("b[^1]");
    // exactly one definition line
    expect(md.match(/^\[\^1\]: https:\/\/x\.com\/1$/gm)).toHaveLength(1);
  });

  test("distinct URLs get sequential indices in first-seen order", () => {
    const { md, count } = convertLinksToFootnotes(
      "[a](https://x.com/1) [b](https://x.com/2)",
    );
    expect(count).toBe(2);
    expect(md).toContain("a[^1]");
    expect(md).toContain("b[^2]");
    expect(md).toContain("[^1]: https://x.com/1");
    expect(md).toContain("[^2]: https://x.com/2");
  });

  test("image links are not touched", () => {
    const input = "![alt](https://example.com/pic.png)";
    expect(convertLinksToFootnotes(input)).toEqual({ md: input, count: 0 });
  });

  test("internal .md links are not touched", () => {
    const input = "[guide](guide.md) and [[wikilink]]";
    expect(convertLinksToFootnotes(input)).toEqual({ md: input, count: 0 });
  });

  test("mailto links are not touched", () => {
    const input = "[mail](mailto:a@b.com)";
    expect(convertLinksToFootnotes(input)).toEqual({ md: input, count: 0 });
  });

  test("links inside a fenced code block are not touched", () => {
    const input = "```\n[x](https://example.com/in-code)\n```";
    expect(convertLinksToFootnotes(input)).toEqual({ md: input, count: 0 });
  });

  test("bare-URL anchor (text equals URL) is left as-is", () => {
    const input = "[https://example.com/x](https://example.com/x)";
    expect(convertLinksToFootnotes(input)).toEqual({ md: input, count: 0 });
  });

  test("no external links → unchanged, no heading", () => {
    const input = "Just text with [internal](page.md) and an ![img](a.png).";
    expect(convertLinksToFootnotes(input)).toEqual({ md: input, count: 0 });
  });

  test("real and fenced links coexist: only the real one converts", () => {
    const input = "[real](https://example.com/r)\n\n```\n[fake](https://example.com/f)\n```";
    const { md, count } = convertLinksToFootnotes(input);
    expect(count).toBe(1);
    expect(md).toContain("real[^1]");
    expect(md).toContain("[^1]: https://example.com/r");
    expect(md).toContain("[fake](https://example.com/f)"); // fenced link preserved verbatim
    expect(md).not.toContain("[^2]");
  });
});
```

- [ ] **Step 2: Run test to verify it fails**

Run: `npx vitest run tests/citations.test.ts`
Expected: FAIL — `Failed to resolve import "../src/citations.js"` (module not created yet).

- [ ] **Step 3: Write the implementation**

Create `src/citations.ts`:

```ts
import { fenceRanges, inAnyRange } from "./md-fences.js";

// External markdown link [text](http(s)://…), NOT an image (negative lookbehind on `!`).
// The http(s) scheme requirement naturally excludes internal/.md, mailto:, anchor-only,
// and bare relative links — by this pipeline stage only external links remain in this form.
const EXTERNAL_LINK_RE = /(?<!!)\[([^\]]*)\]\((https?:\/\/[^)\s]+)\)/g;

/**
 * Convert external inline Markdown links to `[^n]` footnotes and append a
 * `## References` definition block. Identical URLs share one footnote. Links
 * inside fenced code blocks, images, and bare-URL anchors are left untouched.
 * Returns the rewritten Markdown and the number of distinct footnotes created
 * (0 → input returned unchanged, no heading appended).
 */
export function convertLinksToFootnotes(md: string): { md: string; count: number } {
  const fences = fenceRanges(md);
  const order: string[] = []; // URLs in first-seen order; index = position + 1
  const indexByUrl = new Map<string, number>();

  const body = md.replace(
    EXTERNAL_LINK_RE,
    (match: string, text: string, url: string, offset: number): string => {
      if (inAnyRange(offset, fences)) return match; // inside a code fence
      if (text.trim() === url) return match; // bare-URL anchor — converting is pure redundancy
      let idx = indexByUrl.get(url);
      if (idx === undefined) {
        idx = order.length + 1;
        indexByUrl.set(url, idx);
        order.push(url);
      }
      return `${text}[^${idx}]`;
    },
  );

  if (order.length === 0) return { md, count: 0 };

  const refs = order.map((url, i) => `[^${i + 1}]: ${url}`).join("\n");
  return {
    md: `${body.trimEnd()}\n\n## References\n\n${refs}\n`,
    count: order.length,
  };
}
```

- [ ] **Step 4: Run test to verify it passes**

Run: `npx vitest run tests/citations.test.ts`
Expected: PASS (11 tests).

- [ ] **Step 5: Commit**

```bash
git add src/citations.ts tests/citations.test.ts
git commit -m "feat(citations): convertLinksToFootnotes — external links to [^n] + References (docf-vz0)"
```

---

## Task 3: Wire the pass into `runPipeline.ts` (TDD)

**Files:**
- Modify: `src/runPipeline.ts` (import, `RunPipelineOptions`, `PipelineResult`, accumulator, call site, return)
- Create: `tests/pipeline-citations.test.ts`

- [ ] **Step 1: Write the failing test**

Create `tests/pipeline-citations.test.ts`:

```ts
import { afterEach, beforeEach, describe, expect, test } from "vitest";
import { mkdirSync, mkdtempSync, readFileSync, rmSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { runPipeline } from "../src/runPipeline.js";

const PAD = "word ".repeat(40);
const PAGE = `<!DOCTYPE html><html><head><title>Page</title></head><body>
<main><h1>Page</h1>
<p>${PAD}</p>
<p>See <a href="https://example.com/x">ext</a> for details. ${PAD}</p>
</main></body></html>`;

let tmp: string;
beforeEach(() => {
  tmp = mkdtempSync(join(tmpdir(), "docforge-cite-"));
});
afterEach(() => {
  rmSync(tmp, { recursive: true, force: true });
});

function writeFixture(): { inDir: string; outDir: string } {
  const inDir = join(tmp, "in");
  const outDir = join(tmp, "out");
  mkdirSync(inDir, { recursive: true });
  writeFileSync(join(inDir, "page.html"), PAGE);
  return { inDir, outDir };
}

describe("runPipeline --cite-links", () => {
  test("default format: external link becomes a footnote + References block", async () => {
    const { inDir, outDir } = writeFixture();
    const res = await runPipeline({
      source: inDir, outputDir: outDir, maxBytes: 10485760, dryRun: false,
      citeLinks: true,
    });
    expect(res.citations).toEqual({ footnotes: 1 });
    const out = readFileSync(join(outDir, "page.md"), "utf8");
    expect(out).toContain("ext[^1]");
    expect(out).toContain("## References");
    expect(out).toContain("[^1]: https://example.com/x");
    expect(out).not.toContain("](https://example.com/x)"); // inline link form is gone
  });

  test("obsidian format: footnotes applied alongside frontmatter", async () => {
    const { inDir, outDir } = writeFixture();
    const res = await runPipeline({
      source: inDir, outputDir: outDir, maxBytes: 10485760, dryRun: false,
      format: "obsidian", citeLinks: true,
    });
    expect(res.citations).toEqual({ footnotes: 1 });
    const out = readFileSync(join(outDir, "page.md"), "utf8");
    expect(out.startsWith("---\n")).toBe(true);
    expect(out).toContain("ext[^1]");
    expect(out).toContain("[^1]: https://example.com/x");
  });

  test("flag off: no footnotes, inline link preserved, no citations stat", async () => {
    const { inDir, outDir } = writeFixture();
    // omitted citeLinks
    const resA = await runPipeline({
      source: inDir, outputDir: outDir, maxBytes: 10485760, dryRun: false,
    });
    const outA = readFileSync(join(outDir, "page.md"), "utf8");
    expect(resA.citations).toBeUndefined();
    expect(outA).toContain("](https://example.com/x)");
    expect(outA).not.toContain("## References");
    expect(outA).not.toContain("[^1]");

    // explicit citeLinks:false must produce byte-identical output
    const outDir2 = join(tmp, "out2");
    await runPipeline({
      source: inDir, outputDir: outDir2, maxBytes: 10485760, dryRun: false,
      citeLinks: false,
    });
    const outB = readFileSync(join(outDir2, "page.md"), "utf8");
    expect(outB).toBe(outA);
  });
});
```

- [ ] **Step 2: Run test to verify it fails**

Run: `npx vitest run tests/pipeline-citations.test.ts`
Expected: FAIL — TypeScript error / runtime: `citeLinks` is not a known property of `RunPipelineOptions`, and `res.citations` is `undefined` (option not yet honored).

- [ ] **Step 3: Add the import**

In `src/runPipeline.ts`, add the import after the `buildObsidianOutput` import (line 7):

```ts
import { buildObsidianOutput, toObsidianWikilinks } from "./obsidian.js";
import { convertLinksToFootnotes } from "./citations.js";
```

- [ ] **Step 4: Add the option and result fields**

In `RunPipelineOptions` (ends at line 37), add `citeLinks` after `saveImages`:

```ts
  format?: "default" | "obsidian";
  saveImages?: boolean;
  citeLinks?: boolean;
}
```

In `PipelineResult` (ends at line 47), add `citations` after `assets`:

```ts
  vlm?: DescribeStats;
  assets?: AssetStats;
  citations?: { footnotes: number };
}
```

- [ ] **Step 5: Add the accumulator**

In `runPipeline`, add a counter next to the existing accumulators. Change:

```ts
  const assetStats: AssetStats = { saved: 0, deduped: 0, skipped: 0, failed: 0 };
  const outputsUsed = new Map<string, string>();
```

to:

```ts
  const assetStats: AssetStats = { saved: 0, deduped: 0, skipped: 0, failed: 0 };
  let citationFootnotes = 0;
  const outputsUsed = new Map<string, string>();
```

- [ ] **Step 6: Add the call site**

In the HTML branch, insert the citation pass between the end of the asset block (line 274 `}`) and the `provenance` line (line 275). Change:

```ts
      bodyMd = ap.md;
      assetStats.saved += ap.stats.saved;
      assetStats.deduped += ap.stats.deduped;
      assetStats.skipped += ap.stats.skipped;
      assetStats.failed += ap.stats.failed;
    }
    const provenance = /^https?:\/\//i.test(item.srcUri) ? item.srcUri : item.key;
```

to:

```ts
      bodyMd = ap.md;
      assetStats.saved += ap.stats.saved;
      assetStats.deduped += ap.stats.deduped;
      assetStats.skipped += ap.stats.skipped;
      assetStats.failed += ap.stats.failed;
    }
    if (opts.citeLinks) {
      const cited = convertLinksToFootnotes(bodyMd);
      bodyMd = cited.md;
      citationFootnotes += cited.count;
    }
    const provenance = /^https?:\/\//i.test(item.srcUri) ? item.srcUri : item.key;
```

- [ ] **Step 7: Add the result field**

In the return object (lines 285-293), add the citations spread after the assets spread:

```ts
    ...(opts.vlm ? { vlm: vlmStats } : {}),
    ...(assetStore ? { assets: assetStats } : {}),
    ...(opts.citeLinks ? { citations: { footnotes: citationFootnotes } } : {}),
  };
```

- [ ] **Step 8: Run test to verify it passes**

Run: `npx vitest run tests/pipeline-citations.test.ts`
Expected: PASS (3 tests).

- [ ] **Step 9: Commit**

```bash
git add src/runPipeline.ts tests/pipeline-citations.test.ts
git commit -m "feat(pipeline): run citation pass for --cite-links, surface footnote count (docf-vz0)"
```

---

## Task 4: CLI flag `--cite-links` (TDD)

**Files:**
- Modify: `src/cli.ts` (option, `ConvertOpts`, threading, stat log)
- Create: `tests/cli-cite-links.test.ts`

- [ ] **Step 1: Write the failing test**

Create `tests/cli-cite-links.test.ts`:

```ts
import { mkdirSync, mkdtempSync, readFileSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { describe, expect, test, beforeEach } from "vitest";
import { runConvert } from "../src/cli.js";

const PAD = "word ".repeat(40);
const PAGE = `<!DOCTYPE html><html><head><title>T</title></head><body>
<main><h1>T</h1><p>${PAD}</p>
<p>See <a href="https://example.com/x">ext</a>. ${PAD}</p></main></body></html>`;

function baseOpts(output: string) {
  return {
    output,
    failThreshold: "0.10",
    maxBytes: "10485760",
    dryRun: false,
    maxPages: "100",
    maxDepth: "5",
    concurrency: "2",
    cacheDir: "~/.cache/docforge",
    cache: false,
    userAgent: "docforge-test",
    llmsFull: "off",
  };
}

describe("CLI --cite-links flag", () => {
  let tmp: string;
  beforeEach(() => {
    tmp = mkdtempSync(join(tmpdir(), "docforge-clicite-"));
  });

  test("--cite-links produces footnotes + References", async () => {
    const inDir = join(tmp, "in");
    const outDir = join(tmp, "out");
    mkdirSync(inDir, { recursive: true });
    writeFileSync(join(inDir, "page.html"), PAGE);

    const code = await runConvert(inDir, { ...baseOpts(outDir), citeLinks: true });
    expect(code).toBe(0);
    const out = readFileSync(join(outDir, "page.md"), "utf8");
    expect(out).toContain("ext[^1]");
    expect(out).toContain("## References");
    expect(out).toContain("[^1]: https://example.com/x");
  });

  test("without the flag, inline link preserved and no References block", async () => {
    const inDir = join(tmp, "in");
    const outDir = join(tmp, "out");
    mkdirSync(inDir, { recursive: true });
    writeFileSync(join(inDir, "page.html"), PAGE);

    const code = await runConvert(inDir, baseOpts(outDir));
    expect(code).toBe(0);
    const out = readFileSync(join(outDir, "page.md"), "utf8");
    expect(out).toContain("](https://example.com/x)");
    expect(out).not.toContain("## References");
  });
});
```

- [ ] **Step 2: Run test to verify it fails**

Run: `npx vitest run tests/cli-cite-links.test.ts`
Expected: FAIL — `--cite-links` does nothing yet; `out` lacks `## References` / contains the inline link in the first test.

- [ ] **Step 3: Register the CLI option**

In `src/cli.ts`, add the option after the `--save-images` option (line 46):

```ts
    .option("--save-images", "save referenced raster images beside the vault (--format obsidian only)", false)
    .option("--cite-links", "convert external links to [^n] footnotes + a ## References block", false)
```

- [ ] **Step 4: Extend the `ConvertOpts` interface**

Add `citeLinks` after `saveImages` (line 88):

```ts
  format?: string | undefined;
  saveImages?: boolean | undefined;
  citeLinks?: boolean | undefined;
}
```

- [ ] **Step 5: Thread the option into pipeline options**

After the `--save-images` handling block (lines 121-124), add:

```ts
  if (opts.saveImages) {
    if (format === "obsidian") pipelineOpts.saveImages = true;
    else log("warn", "--save-images ignored unless --format obsidian");
  }
  if (opts.citeLinks) pipelineOpts.citeLinks = true;
```

- [ ] **Step 6: Surface the stat**

After the `result.assets` log block (lines 210-215), add:

```ts
  if (result.assets) {
    log(
      "info",
      `images: saved=${result.assets.saved} deduped=${result.assets.deduped} skipped=${result.assets.skipped} failed=${result.assets.failed}`,
    );
  }

  if (result.citations) {
    log("info", `citations: footnotes=${result.citations.footnotes}`);
  }
```

- [ ] **Step 7: Run test to verify it passes**

Run: `npx vitest run tests/cli-cite-links.test.ts`
Expected: PASS (2 tests).

- [ ] **Step 8: Commit**

```bash
git add src/cli.ts tests/cli-cite-links.test.ts
git commit -m "feat(cli): --cite-links flag for footnote citations (docf-vz0)"
```

---

## Task 5: Document `--cite-links` in the README

**Files:**
- Modify: `README.md` (Output formats section, after the `--save-images` block at lines 130-137)

- [ ] **Step 1: Add the documentation paragraph**

In `README.md`, change:

```markdown
Add `--save-images` to copy referenced raster images (png/jpg/webp/gif/bmp) into
`<output>/_assets/` and rewrite each image reference as an Obsidian `![[embed]]`
link. Default off; no effect without `--format obsidian`.

```bash
docforge convert ~/docs/some-corpus --output ~/vault/some-corpus \
  --format obsidian --save-images
```

OpenAPI output, callouts, and embedding-based related-notes are not covered by
`--format obsidian` (see the design spec).
```

to:

```markdown
Add `--save-images` to copy referenced raster images (png/jpg/webp/gif/bmp) into
`<output>/_assets/` and rewrite each image reference as an Obsidian `![[embed]]`
link. Default off; no effect without `--format obsidian`.

```bash
docforge convert ~/docs/some-corpus --output ~/vault/some-corpus \
  --format obsidian --save-images
```

Add `--cite-links` (either format) to convert external `[text](https://…)` links
into `[^n]` footnotes and append a `## References` block to each document.
Identical URLs share one footnote; images, internal links, and code-fenced links
are left untouched. This keeps long URLs out of embedding chunks (a trailing
references chunk) and renders as native Obsidian footnotes. Default off.

```bash
docforge convert ~/docs/some-corpus --output ~/out --cite-links
```

OpenAPI output, callouts, and embedding-based related-notes are not covered by
`--format obsidian` (see the design spec).
```

- [ ] **Step 2: Commit**

```bash
git add README.md
git commit -m "docs(readme): document --cite-links footnote citation flag (docf-vz0)"
```

---

## Task 6: Full verification + close

- [ ] **Step 1: Typecheck**

Run: `npm run typecheck`
Expected: no output, exit 0.

- [ ] **Step 2: Full test suite**

Run: `npm test`
Expected: `tsc` (pretest) passes, then all vitest files pass — including the unchanged Sphinx goldens in `tests/convert.test.ts` (proving the conversion layer is untouched) and the new citation tests.

- [ ] **Step 3: Mark the bead done**

```bash
bd close docf-vz0 --reason="--cite-links footnote citation pass implemented (src/citations.ts), all tests green"
```

- [ ] **Step 4: Push**

```bash
git push
```

---

## Self-review

**Spec coverage:**

| Spec requirement | Task |
|---|---|
| Marker `[^n]` footnotes | Task 2 (impl), Task 2 tests |
| External `http(s)` only | Task 2 regex `https?://`; Task 2 tests (internal/mailto/.md untouched) |
| All formats when flag on | Task 3 placement before format branch; Task 3 obsidian + default tests |
| Default OFF | Task 3/4 gated on `opts.citeLinks`; Task 3 flag-off byte-identical test, Task 4 no-flag test |
| Dedup identical URLs | Task 2 `indexByUrl` map; Task 2 duplicate test |
| `## References` heading | Task 2 impl; asserted across Task 2/3/4 |
| `--cite-links` CLI flag | Task 4 |
| `src/citations.ts` exporting `convertLinksToFootnotes(md): { md; count }` | Task 2 |
| `count` surfaced in pipeline stats | Task 3 `citations.footnotes`; Task 4 stat log |
| Reuse/lift `fenceRanges` | Task 1 (lift to `src/md-fences.ts`) |
| Placement after link/VLM/asset, before builders | Task 3 Step 6 (between asset block and `provenance`) |
| Skip images (lookbehind `!`) | Task 2 regex; Task 2 image test |
| Skip `mailto:`/internal/bare-anchor | Task 2 (scheme filter + bare-anchor guard); Task 2 tests |
| Skip code-fence links | Task 1 + Task 2 fence skip; Task 2 fenced + coexist tests |
| No external links → emit nothing | Task 2 early return; Task 2 "no heading" test |
| TDD with flag-off byte-identical regression | every code task is test-first; Task 3 byte-identical assertion |

**Edge cases deferred per spec (not bugs):** autolinks `<https://…>` and URLs containing literal `)` or `"title"` syntax are intentionally out of v1 scope (spec §5) — the regex matches only the `[text](url)` form with `[^)\s]`-style URL capture, consistent with `links.ts:26-29`. No task needed; documented in spec.

**Placeholder scan:** none — every code step contains complete code; every run step has an exact command and expected result.

**Type/name consistency:** `convertLinksToFootnotes(md: string): { md: string; count: number }` defined in Task 2 and called identically in Task 3. `RunPipelineOptions.citeLinks?: boolean`, `PipelineResult.citations?: { footnotes: number }`, and `ConvertOpts.citeLinks?: boolean | undefined` are consistent across Tasks 3-4. Stat log reads `result.citations.footnotes` matching the field. `fenceRanges`/`inAnyRange` signatures unchanged by the Task 1 move.
