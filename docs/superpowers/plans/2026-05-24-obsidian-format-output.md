# Obsidian output format (`--format obsidian`) Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Add a `--format obsidian` output mode that emits YAML frontmatter (title, source) + vault-relative `[[wikilinks]]`, leaving the existing RAG/qmd format as the unchanged default.

**Architecture:** A new pure module `src/obsidian.ts` provides `buildObsidianOutput` (frontmatter renderer) and `toObsidianWikilinks` (link transform). `runPipeline` gains an optional `format` field and branches at its two render sites. The CLI `convert` command and the MCP `convert` tool each expose a `format` option threaded into the pipeline. No renderer abstraction — two formats, a branch suffices.

**Tech Stack:** TypeScript (ESM, NodeNext), vitest, commander, `node:path` (`posix` for vault-relative resolution).

**Spec:** `docs/superpowers/specs/2026-05-24-obsidian-format-output-design.md`
**Beads issue:** docf-jee

---

## File Structure

- **Create** `src/obsidian.ts` — `buildObsidianOutput(title, source, bodyMd)` and `toObsidianWikilinks(md, fromRelpath)`. Pure functions, no I/O. One responsibility: render the Obsidian flavour.
- **Create** `tests/obsidian.test.ts` — unit tests for both functions.
- **Create** `tests/pipeline-obsidian.test.ts` — integration test of `runPipeline` with `format: "obsidian"` over a temp filesystem fixture, plus a default-mode regression assertion.
- **Create** `tests/mcp-convert-format.test.ts` — asserts the MCP `convert` tool exposes the `format` arg.
- **Modify** `src/runPipeline.ts` — add `format` to `RunPipelineOptions`; branch the markdown/llms-full passthrough and HTML render sites.
- **Modify** `src/cli.ts` — add `--format <fmt>` option, validate, thread into `RunPipelineOptions`.
- **Modify** `src/mcp/tools/convert.ts` — add `format` to args/schema, thread into `RunPipelineOptions`.
- **Modify** `README.md` — document the flag and the Obsidian output shape.

The default-format code paths (`buildOutput`, `rewriteInternalLinks`) are untouched, guaranteeing byte-identical output when `--format` is absent.

---

### Task 1: `buildObsidianOutput` — frontmatter renderer

**Files:**
- Create: `src/obsidian.ts`
- Test: `tests/obsidian.test.ts`

- [ ] **Step 1: Write the failing test**

Create `tests/obsidian.test.ts`:

```ts
import { describe, expect, test } from "vitest";
import { buildObsidianOutput } from "../src/obsidian.js";

describe("buildObsidianOutput", () => {
  test("emits frontmatter (title, source) then body", () => {
    expect(
      buildObsidianOutput("My Title", "dir/page.html", "# My Title\n\nBody."),
    ).toBe(
      '---\ntitle: "My Title"\nsource: "dir/page.html"\n---\n\n# My Title\n\nBody.\n',
    );
  });

  test("escapes double quotes and backslashes in title", () => {
    expect(
      buildObsidianOutput('He said "hi" \\o/', "p.html", "Body."),
    ).toBe(
      '---\ntitle: "He said \\"hi\\" \\\\o/"\nsource: "p.html"\n---\n\nBody.\n',
    );
  });

  test("trims surrounding whitespace in body", () => {
    expect(buildObsidianOutput("T", "p.html", "  Body.  \n\n  ")).toBe(
      '---\ntitle: "T"\nsource: "p.html"\n---\n\nBody.\n',
    );
  });
});
```

- [ ] **Step 2: Run test to verify it fails**

Run: `npx vitest run tests/obsidian.test.ts`
Expected: FAIL — cannot resolve `../src/obsidian.js` (module does not exist).

- [ ] **Step 3: Write minimal implementation**

Create `src/obsidian.ts`:

```ts
function yamlQuote(s: string): string {
  return `"${s.replace(/\\/g, "\\\\").replace(/"/g, '\\"')}"`;
}

/** Render an Obsidian-vault note: YAML frontmatter (title, source) + body. */
export function buildObsidianOutput(
  title: string,
  source: string,
  bodyMd: string,
): string {
  const body = bodyMd.trim();
  return `---\ntitle: ${yamlQuote(title)}\nsource: ${yamlQuote(source)}\n---\n\n${body}\n`;
}
```

- [ ] **Step 4: Run test to verify it passes**

Run: `npx vitest run tests/obsidian.test.ts`
Expected: PASS (3 tests).

- [ ] **Step 5: Commit**

```bash
git add src/obsidian.ts tests/obsidian.test.ts
git commit -m "feat(obsidian): buildObsidianOutput frontmatter renderer (docf-jee)

Co-Authored-By: Claude Opus 4.7 (1M context) <noreply@anthropic.com>"
```

---

### Task 2: `toObsidianWikilinks` — internal-link transform

**Files:**
- Modify: `src/obsidian.ts`
- Test: `tests/obsidian.test.ts`

- [ ] **Step 1: Write the failing test**

Append to `tests/obsidian.test.ts`:

```ts
import { toObsidianWikilinks } from "../src/obsidian.js";

describe("toObsidianWikilinks", () => {
  test("resolves relative path, drops slug anchor, keeps text as alias", () => {
    expect(
      toObsidianWikilinks("[Install guide](../setup/index.md#install-foo)", "guide/page.md"),
    ).toBe("[[setup/index|Install guide]]");
  });

  test("rewrites .html internal targets", () => {
    expect(toObsidianWikilinks("[Next](other.html)", "page.md")).toBe(
      "[[other|Next]]",
    );
  });

  test("omits alias when link text equals target basename", () => {
    expect(toObsidianWikilinks("[index](sub/index.md)", "page.md")).toBe(
      "[[sub/index]]",
    );
  });

  test("converts autolinks without alias", () => {
    expect(toObsidianWikilinks("see <api.html>", "page.md")).toBe(
      "see [[api]]",
    );
  });

  test("resolves nested directories", () => {
    expect(toObsidianWikilinks("[See C](../c.md)", "a/b/page.md")).toBe(
      "[[a/c|See C]]",
    );
  });

  test("leaves image links untouched", () => {
    expect(toObsidianWikilinks("![diagram](img/d.png)", "page.md")).toBe(
      "![diagram](img/d.png)",
    );
  });

  test("leaves external, mailto, and bare-anchor links untouched", () => {
    const md = "[site](https://x.com/page.html) [mail](mailto:a@b.com) [top](#top)";
    expect(toObsidianWikilinks(md, "page.md")).toBe(md);
  });

  test("leaves above-vault-root targets untouched", () => {
    expect(toObsidianWikilinks("[up](../../x.md)", "page.md")).toBe(
      "[up](../../x.md)",
    );
  });
});
```

- [ ] **Step 2: Run test to verify it fails**

Run: `npx vitest run tests/obsidian.test.ts`
Expected: FAIL — `toObsidianWikilinks` is not exported by `../src/obsidian.js`.

- [ ] **Step 3: Write minimal implementation**

Add to the top of `src/obsidian.ts` (imports) and below `buildObsidianOutput`:

```ts
import { posix } from "node:path";
```

```ts
// Internal markdown link [text](target.{html,md}#anchor?) — NOT an image (negative lookbehind on `!`),
// NOT external/mailto/bare-anchor.
const MD_LINK_RE =
  /(?<!!)\[([^\]]*)\]\((?!https?:\/\/|\/\/|mailto:|#)([^)\s]+?)\.(?:html?|md)(?:#[^)\s]*)?\)/g;
// Autolink <target.{html,md}#anchor?> for internal targets only.
const AUTOLINK_RE =
  /<(?!https?:\/\/|\/\/|mailto:)([^>\s]+?)\.(?:html?|md)(?:#[^>\s]*)?>/g;

/**
 * Rewrite internal markdown links and autolinks into Obsidian wikilinks.
 * `fromRelpath` is the document's POSIX path relative to the vault (output) root,
 * used to resolve relative targets to vault-relative paths. Slug anchors are dropped.
 */
export function toObsidianWikilinks(md: string, fromRelpath: string): string {
  const fromDir = posix.dirname(fromRelpath);
  const resolveVault = (raw: string): string | null => {
    const vault = posix.join(fromDir, raw);
    // Targets above the vault root cannot be represented as a wikilink path.
    if (vault === ".." || vault.startsWith("../")) return null;
    return vault;
  };
  return md
    .replace(MD_LINK_RE, (match, text: string, rawPath: string) => {
      const vault = resolveVault(rawPath);
      if (vault === null) return match;
      const base = vault.split("/").pop() ?? vault;
      const alias = text && text !== base && text !== vault ? `|${text}` : "";
      return `[[${vault}${alias}]]`;
    })
    .replace(AUTOLINK_RE, (match, rawPath: string) => {
      const vault = resolveVault(rawPath);
      if (vault === null) return match;
      return `[[${vault}]]`;
    });
}
```

- [ ] **Step 4: Run test to verify it passes**

Run: `npx vitest run tests/obsidian.test.ts`
Expected: PASS (11 tests total).

- [ ] **Step 5: Commit**

```bash
git add src/obsidian.ts tests/obsidian.test.ts
git commit -m "feat(obsidian): toObsidianWikilinks internal-link transform (docf-jee)

Co-Authored-By: Claude Opus 4.7 (1M context) <noreply@anthropic.com>"
```

---

### Task 3: Wire `format` into `runPipeline`

**Files:**
- Modify: `src/runPipeline.ts`
- Test: `tests/pipeline-obsidian.test.ts`

- [ ] **Step 1: Write the failing test**

Create `tests/pipeline-obsidian.test.ts`:

```ts
import { afterEach, beforeEach, describe, expect, test } from "vitest";
import { mkdirSync, mkdtempSync, readFileSync, rmSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { runPipeline } from "../src/runPipeline.js";

const PAGE = `<!DOCTYPE html><html><head><title>Page Title</title></head><body>
<main><h1>Page Title</h1>
<p>${"word ".repeat(40)}</p>
<p>See <a href="other.html">Other</a> for details ${"word ".repeat(20)}</p>
</main></body></html>`;

let tmp: string;
beforeEach(() => {
  tmp = mkdtempSync(join(tmpdir(), "docforge-obsidian-"));
});
afterEach(() => {
  rmSync(tmp, { recursive: true, force: true });
});

describe("runPipeline format=obsidian", () => {
  test("emits frontmatter + wikilinks for HTML conversion", async () => {
    const inDir = join(tmp, "in");
    const outDir = join(tmp, "out");
    mkdirSync(inDir, { recursive: true });
    writeFileSync(join(inDir, "page.html"), PAGE);

    const res = await runPipeline({
      source: inDir,
      outputDir: outDir,
      maxBytes: 10485760,
      dryRun: false,
      format: "obsidian",
    });
    expect(res.converted).toBe(1);

    const out = readFileSync(join(outDir, "page.md"), "utf8");
    expect(out.startsWith("---\n")).toBe(true);
    expect(out).toContain('source: "page.html"');
    expect(out).toContain("[[other|Other]]");
    expect(out).not.toContain("Source: page.html");
  });

  test("default format unchanged (inline Source line, no frontmatter)", async () => {
    const inDir = join(tmp, "in");
    const outDir = join(tmp, "out");
    mkdirSync(inDir, { recursive: true });
    writeFileSync(join(inDir, "page.html"), PAGE);

    await runPipeline({
      source: inDir,
      outputDir: outDir,
      maxBytes: 10485760,
      dryRun: false,
    });

    const out = readFileSync(join(outDir, "page.md"), "utf8");
    expect(out.startsWith("---\n")).toBe(false);
    expect(out).toContain("Source: page.html");
    expect(out).toContain("[Other](other.md)");
  });
});
```

- [ ] **Step 2: Run test to verify it fails**

Run: `npx vitest run tests/pipeline-obsidian.test.ts`
Expected: FAIL — `format` is not a known property of the `runPipeline` options type (TS) / obsidian assertions fail.

- [ ] **Step 3a: Extend imports and options type**

In `src/runPipeline.ts`, change the `node:path` import (currently `import { basename, extname, resolve } from "node:path";`) to:

```ts
import { basename, extname, relative, resolve, sep } from "node:path";
```

Add the obsidian import next to the existing `./links.js` import:

```ts
import { buildObsidianOutput, toObsidianWikilinks } from "./obsidian.js";
```

Add `format` to the options interface:

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
}
```

- [ ] **Step 3b: Resolve the format once and branch the passthrough render site**

Immediately after `mkdirSync(opts.outputDir, { recursive: true });` (top of `runPipeline`), add:

```ts
  const format = opts.format ?? "default";
```

Replace the markdown/llms-full passthrough block (currently):

```ts
    if (item.kind === "llms-full" || item.kind === "markdown") {
      if (opts.dryRun) {
        log("info", `DRY ${item.key} -> ${outPath}`);
        continue;
      }
      const md = stripHeadingAnchors(rewriteInternalLinks(item.bytes.toString("utf8")));
      writeOutput(outPath, md);
      converted += 1;
      report.push({ input: item.key, srcUri: item.srcUri, output: outPath, status: "ok" });
      continue;
    }
```

with:

```ts
    if (item.kind === "llms-full" || item.kind === "markdown") {
      if (opts.dryRun) {
        log("info", `DRY ${item.key} -> ${outPath}`);
        continue;
      }
      const raw = item.bytes.toString("utf8");
      let md: string;
      if (format === "obsidian") {
        const fromRel = relative(opts.outputDir, outPath).split(sep).join("/");
        const stem = basename(item.key, extname(item.key)) || "index";
        const provenance = /^https?:\/\//i.test(item.srcUri) ? item.srcUri : item.key;
        md = buildObsidianOutput(stem, provenance, stripHeadingAnchors(toObsidianWikilinks(raw, fromRel)));
      } else {
        md = stripHeadingAnchors(rewriteInternalLinks(raw));
      }
      writeOutput(outPath, md);
      converted += 1;
      report.push({ input: item.key, srcUri: item.srcUri, output: outPath, status: "ok" });
      continue;
    }
```

- [ ] **Step 3c: Branch the HTML render site**

Replace the HTML render tail (currently):

```ts
    const stem = basename(item.key, extname(item.key)) || "index";
    const title = extractTitle(result.h1_text, result.soup_title_text, stem);
    let bodyMd = rewriteInternalLinks(result.body_md);
```

with:

```ts
    const stem = basename(item.key, extname(item.key)) || "index";
    const title = extractTitle(result.h1_text, result.soup_title_text, stem);
    const fromRel = relative(opts.outputDir, outPath).split(sep).join("/");
    let bodyMd =
      format === "obsidian"
        ? toObsidianWikilinks(result.body_md, fromRel)
        : rewriteInternalLinks(result.body_md);
```

Then replace the output-build line (currently):

```ts
    const content = buildOutput(title, item.key, bodyMd);
    writeOutput(outPath, content);
```

with:

```ts
    const provenance = /^https?:\/\//i.test(item.srcUri) ? item.srcUri : item.key;
    const content =
      format === "obsidian"
        ? buildObsidianOutput(title, provenance, bodyMd)
        : buildOutput(title, item.key, bodyMd);
    writeOutput(outPath, content);
```

- [ ] **Step 4: Run test to verify it passes**

Run: `npx vitest run tests/pipeline-obsidian.test.ts`
Expected: PASS (2 tests).

- [ ] **Step 5: Run the existing pipeline/output tests to confirm no regression**

Run: `npx vitest run tests/output.test.ts tests/convert.test.ts tests/source-llms-full.test.ts`
Expected: PASS (default format paths unchanged).

- [ ] **Step 6: Commit**

```bash
git add src/runPipeline.ts tests/pipeline-obsidian.test.ts
git commit -m "feat(obsidian): branch runPipeline render on format=obsidian (docf-jee)

Co-Authored-By: Claude Opus 4.7 (1M context) <noreply@anthropic.com>"
```

---

### Task 4: CLI `--format` flag

**Files:**
- Modify: `src/cli.ts`
- Test: `tests/cli-format.test.ts`

- [ ] **Step 1: Write the failing test**

Create `tests/cli-format.test.ts`:

```ts
import { mkdirSync, mkdtempSync, readFileSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { describe, expect, test, beforeEach } from "vitest";
import { runConvert } from "../src/cli.js";

const PAGE = `<!DOCTYPE html><html><head><title>T</title></head><body>
<main><h1>T</h1><p>${"word ".repeat(50)}</p></main></body></html>`;

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

describe("CLI --format flag", () => {
  let tmp: string;
  beforeEach(() => {
    tmp = mkdtempSync(join(tmpdir(), "docforge-cliformat-"));
  });

  test("format=obsidian writes frontmatter output", async () => {
    const inDir = join(tmp, "in");
    const outDir = join(tmp, "out");
    mkdirSync(inDir, { recursive: true });
    writeFileSync(join(inDir, "page.html"), PAGE);

    const code = await runConvert(inDir, { ...baseOpts(outDir), format: "obsidian" });
    expect(code).toBe(0);
    const out = readFileSync(join(outDir, "page.md"), "utf8");
    expect(out.startsWith("---\n")).toBe(true);
  });

  test("invalid format value exits 2", async () => {
    const inDir = join(tmp, "in");
    const outDir = join(tmp, "out");
    mkdirSync(inDir, { recursive: true });
    writeFileSync(join(inDir, "page.html"), PAGE);

    const code = await runConvert(inDir, { ...baseOpts(outDir), format: "markdown" });
    expect(code).toBe(2);
  });
});
```

- [ ] **Step 2: Run test to verify it fails**

Run: `npx vitest run tests/cli-format.test.ts`
Expected: FAIL — `format` not accepted / obsidian output not produced (frontmatter assertion fails).

- [ ] **Step 3a: Register the option**

In `src/cli.ts`, add this option to the `convert` command chain, immediately after the `--selector` option (line 44):

```ts
    .option("--format <fmt>", "output format: default|obsidian", "default")
```

- [ ] **Step 3b: Add `format` to `ConvertOpts`**

Add an optional field to the `ConvertOpts` interface (so existing test call-sites that omit it still type-check):

```ts
  format?: string | undefined;
```

- [ ] **Step 3c: Validate and thread into pipeline opts**

In `runConvert`, after `failThreshold` is computed and before `const pipelineOpts: RunPipelineOptions = {` block, add validation:

```ts
  const format = opts.format ?? "default";
  if (format !== "default" && format !== "obsidian") {
    log("error", `invalid --format value: ${opts.format} (expected default|obsidian)`);
    return 2;
  }
```

Then, immediately after the line `if (opts.selector !== undefined) pipelineOpts.selector = opts.selector;`, add:

```ts
  pipelineOpts.format = format as "default" | "obsidian";
```

- [ ] **Step 4: Run test to verify it passes**

Run: `npx vitest run tests/cli-format.test.ts`
Expected: PASS (2 tests).

- [ ] **Step 5: Confirm existing CLI tests still pass**

Run: `npx vitest run tests/cli-selector.test.ts tests/cli.test.ts`
Expected: PASS (call-sites omitting `format` still compile and behave as default).

- [ ] **Step 6: Commit**

```bash
git add src/cli.ts tests/cli-format.test.ts
git commit -m "feat(cli): add --format default|obsidian to convert (docf-jee)

Co-Authored-By: Claude Opus 4.7 (1M context) <noreply@anthropic.com>"
```

---

### Task 5: MCP `convert` tool `format` arg

**Files:**
- Modify: `src/mcp/tools/convert.ts`
- Test: `tests/mcp-convert-format.test.ts`

- [ ] **Step 1: Write the failing test**

Create `tests/mcp-convert-format.test.ts`:

```ts
import { describe, expect, test } from "vitest";
import { convertTool } from "../src/mcp/tools/convert.js";

describe("MCP convert tool format arg", () => {
  test("inputSchema exposes format enum default|obsidian", () => {
    const props = (convertTool.inputSchema as {
      properties: Record<string, { enum?: string[]; default?: string }>;
    }).properties;
    expect(props.format).toBeDefined();
    expect(props.format.enum).toEqual(["default", "obsidian"]);
    expect(props.format.default).toBe("default");
  });
});
```

- [ ] **Step 2: Run test to verify it fails**

Run: `npx vitest run tests/mcp-convert-format.test.ts`
Expected: FAIL — `props.format` is `undefined`.

- [ ] **Step 3a: Add `format` to `ConvertArgs` and `parseArgs`**

In `src/mcp/tools/convert.ts`, add to the `ConvertArgs` interface:

```ts
  format?: "default" | "obsidian";
```

In `parseArgs`, before `return args;`, add:

```ts
  if (raw.format === "default" || raw.format === "obsidian") args.format = raw.format;
```

- [ ] **Step 3b: Add `format` to the input schema**

In `convertTool.inputSchema.properties`, add (e.g. after the `selector` property):

```ts
      format: {
        type: "string",
        enum: ["default", "obsidian"],
        default: "default",
        description: "output format: default (RAG inline-provenance) or obsidian (YAML frontmatter + [[wikilinks]])",
      },
```

- [ ] **Step 3c: Thread into pipeline opts**

In the handler, immediately after `if (args.selector !== undefined) pipelineOpts.selector = args.selector;`, add:

```ts
      if (args.format !== undefined) pipelineOpts.format = args.format;
```

- [ ] **Step 4: Run test to verify it passes**

Run: `npx vitest run tests/mcp-convert-format.test.ts`
Expected: PASS (1 test).

- [ ] **Step 5: Commit**

```bash
git add src/mcp/tools/convert.ts tests/mcp-convert-format.test.ts
git commit -m "feat(mcp): add format arg to convert tool (docf-jee)

Co-Authored-By: Claude Opus 4.7 (1M context) <noreply@anthropic.com>"
```

---

### Task 6: Docs + full verification

**Files:**
- Modify: `README.md`

- [ ] **Step 1: Add the flag to the README**

Find the convert flags description in `README.md` (search: `grep -n "selector" README.md`). Add an entry near the other convert flags documenting:

```
--format <default|obsidian>   output format. `default` (the current RAG inline-
                              provenance shape) or `obsidian` (YAML frontmatter
                              with title + source, internal links as [[wikilinks]]).
```

- [ ] **Step 2: Add an "Output formats" subsection**

After the `## Usage` examples block, add:

```markdown
### Output formats

`--format default` (the default) emits RAG-friendly Markdown: a `# Title` line, a
`Source:` provenance line, and relative `.md` links — tuned for embedding/qmd.

`--format obsidian` emits Obsidian-vault Markdown instead:

- Provenance moves into YAML frontmatter (`title`, `source`).
- Internal links become vault-relative `[[wikilinks]]` (slug anchors are dropped,
  since Obsidian heading links need literal heading text).
- Images and external links are left as standard Markdown.

```bash
docforge convert ~/docs/some-corpus --output ~/vault/some-corpus --format obsidian
```

OpenAPI output, callouts, image embeds, and embedding-based related-notes are not
covered by `--format obsidian` (see the design spec).
```

- [ ] **Step 3: Run the full test suite + typecheck**

Run: `npm test`
Expected: PASS — all suites green, including the new `obsidian`, `pipeline-obsidian`, `cli-format`, and `mcp-convert-format` tests. (`pretest` runs `tsc`, so this also confirms the build type-checks.)

Run: `npm run typecheck`
Expected: no errors.

- [ ] **Step 4: Commit**

```bash
git add README.md
git commit -m "docs: document --format obsidian output mode (docf-jee)

Co-Authored-By: Claude Opus 4.7 (1M context) <noreply@anthropic.com>"
```

- [ ] **Step 5: Close the beads issue**

```bash
bd close docf-jee --reason="--format obsidian shipped: frontmatter + wikilinks, CLI + MCP, tests green"
```

---

## Notes for the implementer

- **ESM imports:** this project uses NodeNext module resolution — import local modules with the `.js` extension (e.g. `../src/obsidian.js`) even though the source is `.ts`. Follow the existing pattern in neighbouring files.
- **Lookbehind:** `MD_LINK_RE` uses `(?<!!)` to avoid matching image syntax `![alt](...)`. Node 20+ supports lookbehind; vitest runs under Node, so this is safe.
- **Why `posix` path APIs:** vault paths must use `/` separators on every OS. `relative(...).split(sep).join("/")` normalises the doc's own path; `posix.join`/`posix.dirname` keep target resolution POSIX.
- **Frontmatter `source` value — intentional divergence from the spec:** the spec §1 says "Use `item.srcUri`", but for filesystem items `srcUri` is a `file://` absolute URL (`src/source.ts:117` — `pathToFileURL(path)`), which would emit `source: "file:///tmp/.../page.html"`. So the plan uses `/^https?:\/\//.test(item.srcUri) ? item.srcUri : item.key` — full URL for URL sources, clean source-relative path (`item.key`) for filesystem sources. This matches the spec's *described intent* ("source-relative path for filesystem sources") and the Task 3 test's `source: "page.html"` assertion. Do **not** "fix" it back to bare `item.srcUri`.
- **Don't reuse the name `source`:** `runPipeline` already binds `let source: Source` (the input Source object) near the top. The obsidian provenance local is named `provenance` to avoid shadowing it — keep that name.
- **Backward compatibility is load-bearing:** never change the `format === "default"` branches. The Task 3 default-mode test and the existing `tests/output.test.ts` goldens guard this.
