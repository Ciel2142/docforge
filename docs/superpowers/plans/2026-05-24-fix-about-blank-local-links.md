# Fix `about:blank` Internal-Link Corruption on Local-Dir Sources Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Make internal links with a `#fragment` resolve correctly when converting a local-directory source, in both `--format default` and `--format obsidian` (no more `about:blank/...`).

**Architecture:** The corruption comes from Defuddle absolutizing fragment-bearing relative `<a>`/`<img>` URLs against an empty base (`extract.ts` passes `""` for local files), producing `about:blank/<site-root-path>` with the original `../` collapsed. Fix at the root: give Defuddle a **synthetic per-file base** (`http://docforge.invalid/<relpath>`) for local sources so *every* internal link resolves to a correct absolute URL that preserves directory structure. Then a new `delocalizeLinks` step converts those sentinel-absolute URLs back to **file-relative** form *before* the existing format rewrites run — so `rewriteInternalLinks` (default) and `toObsidianWikilinks` (obsidian) keep working unchanged, because they already handle relative links correctly.

**Tech Stack:** TypeScript (ESM, NodeNext), Vitest, `node:path` (posix), `node:url` (`URL`), Defuddle 0.18, `@kreuzberg/node` 4.

**Key facts established during investigation (do not re-litigate):**
- `standardize: false` does **not** disable Defuddle URL absolutization (verified empirically — identical output). Do not pursue it.
- With base `""`: only fragment-bearing relative links corrupt to `about:blank/...`; plain relative links stay correct. With a real/synthetic base: **all** internal links (anchored or not, `<a>` and `<img>`) become absolute under that base, with `../` resolved correctly. `delocalizeLinks` therefore must restore *every* sentinel link, not just anchored ones.
- URL sources (`http(s)://`) are unaffected today and must stay unchanged. `delocalizeLinks` only touches the `docforge.invalid` sentinel host, so real-host links (URL sources + external links) pass through untouched.
- The `llms-full` / `markdown` raw-bytes branch (`runPipeline.ts:118-137`) never runs Defuddle, so it has no sentinel links — do **not** add `delocalizeLinks` there.

---

## File Structure

- `src/links.ts` — gains the sentinel constant `LOCAL_BASE` and `delocalizeLinks()`, alongside the existing `rewriteInternalLinks` / `stripHeadingAnchors`. This file owns all link-string transforms; it is the right home.
- `src/runPipeline.ts` — sets `convertOpts.url` to the synthetic base for local files (currently only set for URL sources), and calls `delocalizeLinks` before the format rewrite in the HTML-convert branch.
- `tests/links.test.ts` — unit tests for `delocalizeLinks`.
- `tests/pipeline-obsidian.test.ts` — integration test: cross-dir corpus with an anchored link, both formats, asserts no `about:blank` and correct link shapes.

No new files. No change to `extract.ts` or `convert.ts` (the base already threads through `ConvertOptions.url` → `ExtractOptions.url` → Defuddle).

---

### Task 1: `delocalizeLinks` + `LOCAL_BASE` in `links.ts`

**Files:**
- Modify: `src/links.ts`
- Test: `tests/links.test.ts`

- [ ] **Step 1: Write the failing tests**

Append to `tests/links.test.ts`. (Check the top of the file for the existing import; if `delocalizeLinks` / `LOCAL_BASE` are not yet imported there, add them to the existing `import { ... } from "../src/links.js";` line.)

```ts
import { delocalizeLinks, LOCAL_BASE } from "../src/links.js";

describe("delocalizeLinks", () => {
  test("LOCAL_BASE is the docforge.invalid sentinel", () => {
    expect(LOCAL_BASE).toBe("http://docforge.invalid/");
  });

  test("cross-dir anchored link → file-relative, fragment preserved", () => {
    expect(
      delocalizeLinks(
        "[API reference](http://docforge.invalid/api/ref.html#sec)",
        "guide/intro.md",
      ),
    ).toBe("[API reference](../api/ref.html#sec)");
  });

  test("same-dir link → bare relative", () => {
    expect(
      delocalizeLinks(
        "[sib](http://docforge.invalid/guide/sib.html#x)",
        "guide/intro.md",
      ),
    ).toBe("[sib](sib.html#x)");
  });

  test("root-level source file → relative without ../", () => {
    expect(
      delocalizeLinks(
        "[api](http://docforge.invalid/api/ref.html)",
        "index.md",
      ),
    ).toBe("[api](api/ref.html)");
  });

  test("autolink form is delocalized", () => {
    expect(
      delocalizeLinks("see <http://docforge.invalid/api/ref.html>", "guide/p.md"),
    ).toBe("see <../api/ref.html>");
  });

  test("image links are delocalized too", () => {
    expect(
      delocalizeLinks(
        "![diagram](http://docforge.invalid/img/arch.png)",
        "guide/p.md",
      ),
    ).toBe("![diagram](../img/arch.png)");
  });

  test("leaves real http(s) and relative links untouched", () => {
    const md =
      "[ext](https://example.com/page.html) [rel](../already/rel.html) [mail](mailto:a@b.com)";
    expect(delocalizeLinks(md, "guide/p.md")).toBe(md);
  });

  test("decodes percent-encoded path segments", () => {
    expect(
      delocalizeLinks(
        "[x](http://docforge.invalid/a%20b/c.html)",
        "index.md",
      ),
    ).toBe("[x](a b/c.html)");
  });
});
```

- [ ] **Step 2: Run the tests to verify they fail**

Run: `npx vitest run tests/links.test.ts -t delocalizeLinks`
Expected: FAIL — `delocalizeLinks`/`LOCAL_BASE` are not exported (`SyntaxError`/`undefined`).

- [ ] **Step 3: Implement `LOCAL_BASE` + `delocalizeLinks`**

Edit `src/links.ts`. Add the `posix` import at the top, and append the new constant + function (keep the existing `rewriteInternalLinks` / `stripHeadingAnchors` exactly as-is):

```ts
import { posix } from "node:path";

// Synthetic base URL handed to Defuddle for LOCAL (non-URL) sources, so it
// resolves relative internal links against a stable, structure-preserving
// origin instead of an empty base (which yields `about:blank/...`).
// `.invalid` is reserved (RFC 2606) and can never be a real link target.
export const LOCAL_BASE = "http://docforge.invalid/";

const SENTINEL_LINK_RE = /\]\((http:\/\/docforge\.invalid\/[^)\s]*)\)/g;
const SENTINEL_AUTOLINK_RE = /<(http:\/\/docforge\.invalid\/[^>\s]*)>/g;

/**
 * Convert sentinel-absolute internal links (produced when LOCAL_BASE was the
 * Defuddle base) back into paths relative to `fromRelpath` (the document's
 * POSIX path relative to the corpus/output root). Fragments are preserved.
 * Real http(s) links (URL sources, external links) are left untouched.
 */
export function delocalizeLinks(md: string, fromRelpath: string): string {
  const fromDir = posix.dirname(fromRelpath);
  const toRel = (abs: string): string => {
    const u = new URL(abs);
    const targetPath = decodeURI(u.pathname).replace(/^\//, "");
    let rel = posix.relative(fromDir, targetPath);
    if (rel === "") rel = posix.basename(targetPath);
    return rel + u.hash;
  };
  return md
    .replace(SENTINEL_LINK_RE, (_m, abs: string) => `](${toRel(abs)})`)
    .replace(SENTINEL_AUTOLINK_RE, (_m, abs: string) => `<${toRel(abs)}>`);
}
```

Note: `decodeURI` (not `decodeURIComponent`) so a `#` that was percent-encoded in the path is not introduced; `u.hash` already carries the real fragment.

- [ ] **Step 4: Run the tests to verify they pass**

Run: `npx vitest run tests/links.test.ts`
Expected: PASS — the new `delocalizeLinks` block and the pre-existing `rewriteInternalLinks`/`stripHeadingAnchors` tests all green.

- [ ] **Step 5: Commit**

```bash
git add src/links.ts tests/links.test.ts
git commit -m "feat(links): delocalizeLinks + LOCAL_BASE sentinel (docf-7w5)"
```

---

### Task 2: Wire synthetic base + delocalize into the pipeline

**Files:**
- Modify: `src/runPipeline.ts:4` (import), `src/runPipeline.ts:185-189` (base), `src/runPipeline.ts:209-213` (delocalize)

- [ ] **Step 1: Add `delocalizeLinks` + `LOCAL_BASE` to the links import**

The current import (line 4) is:

```ts
import { rewriteInternalLinks, stripHeadingAnchors } from "./links.js";
```

Change it to:

```ts
import { rewriteInternalLinks, stripHeadingAnchors, delocalizeLinks, LOCAL_BASE } from "./links.js";
```

- [ ] **Step 2: Set the synthetic base for local files**

The current block (lines 185-189) is:

```ts
    const convertOpts: { selector?: string; url?: string } = {};
    if (opts.selector !== undefined) convertOpts.selector = opts.selector;
    if (item.srcUri.startsWith("http://") || item.srcUri.startsWith("https://")) {
      convertOpts.url = item.srcUri;
    }
```

Change it to:

```ts
    const convertOpts: { selector?: string; url?: string } = {};
    if (opts.selector !== undefined) convertOpts.selector = opts.selector;
    if (item.srcUri.startsWith("http://") || item.srcUri.startsWith("https://")) {
      convertOpts.url = item.srcUri;
    } else {
      // Local source: give Defuddle a structure-preserving base so relative
      // internal links resolve correctly (empty base → `about:blank/...`).
      convertOpts.url = LOCAL_BASE + encodeURI(item.key.split(sep).join("/"));
    }
```

(`sep` is already imported at `runPipeline.ts:1`. `item.key` is the corpus-relative path; normalizing separators + `encodeURI` keeps the base a valid URL when filenames contain spaces.)

- [ ] **Step 3: Delocalize before the format rewrite (HTML branch)**

The current block (lines 209-213) is:

```ts
    const fromRel = relative(opts.outputDir, outPath).split(sep).join("/");
    let bodyMd =
      format === "obsidian"
        ? toObsidianWikilinks(result.body_md, fromRel)
        : rewriteInternalLinks(result.body_md);
```

Change it to:

```ts
    const fromRel = relative(opts.outputDir, outPath).split(sep).join("/");
    const localized = delocalizeLinks(result.body_md, fromRel);
    let bodyMd =
      format === "obsidian"
        ? toObsidianWikilinks(localized, fromRel)
        : rewriteInternalLinks(localized);
```

(`fromRel` is the output relpath, e.g. `guide/intro.md`; its directory equals the source file's directory, so relative math is consistent with the base built from `item.key`. For URL sources `localized === result.body_md` since no sentinel links exist.)

- [ ] **Step 4: Run the existing pipeline + MCP tests to verify no regression**

Run: `npx vitest run tests/pipeline-obsidian.test.ts tests/mcp/tools-convert.test.ts tests/cli-format.test.ts`
Expected: PASS — URL-source and same-dir behavior unchanged.

- [ ] **Step 5: Commit**

```bash
git add src/runPipeline.ts
git commit -m "fix(pipeline): synthetic base + delocalize for local internal links (docf-7w5)"
```

---

### Task 3: Integration test — cross-dir anchored links, both formats

**Files:**
- Modify: `tests/pipeline-obsidian.test.ts`

- [ ] **Step 1: Write the failing integration test**

Append this `describe` block to `tests/pipeline-obsidian.test.ts` (it reuses the file's existing imports: `runPipeline`, `mkdirSync`, `mkdtempSync`, `readFileSync`, `rmSync`, `writeFileSync`, `join`, `tmpdir`, and the `tmp`/`beforeEach`/`afterEach` scaffold — define a local corpus inline):

```ts
describe("runPipeline local cross-dir internal links (docf-7w5)", () => {
  const PAD = "word ".repeat(40);
  const INTRO = `<!DOCTYPE html><html><head><title>Intro</title></head><body>
<main><h1>Intro</h1><p>${PAD}</p>
<p>See the <a href="../api/reference.html#post-widgets">API reference</a>. ${PAD}</p>
</main></body></html>`;
  const REF = `<!DOCTYPE html><html><head><title>API Reference</title></head><body>
<main><h1>API Reference</h1><p>${PAD}</p>
<p>Back to the <a href="../guide/intro.html">intro</a>. ${PAD}</p>
</main></body></html>`;

  function writeCorpus(): { inDir: string; outDir: string } {
    const inDir = join(tmp, "in");
    const outDir = join(tmp, "out");
    mkdirSync(join(inDir, "guide"), { recursive: true });
    mkdirSync(join(inDir, "api"), { recursive: true });
    writeFileSync(join(inDir, "guide", "intro.html"), INTRO);
    writeFileSync(join(inDir, "api", "reference.html"), REF);
    return { inDir, outDir };
  }

  test("obsidian: cross-dir anchored link → vault wikilink, no about:blank", async () => {
    const { inDir, outDir } = writeCorpus();
    await runPipeline({ source: inDir, outputDir: outDir, maxBytes: 10485760, dryRun: false, format: "obsidian" });
    const intro = readFileSync(join(outDir, "guide", "intro.md"), "utf8");
    expect(intro).not.toContain("about:blank");
    expect(intro).toContain("[[api/reference|API reference]]");
  });

  test("default: cross-dir anchored link → correct relative .md, no about:blank", async () => {
    const { inDir, outDir } = writeCorpus();
    await runPipeline({ source: inDir, outputDir: outDir, maxBytes: 10485760, dryRun: false });
    const intro = readFileSync(join(outDir, "guide", "intro.md"), "utf8");
    expect(intro).not.toContain("about:blank");
    expect(intro).toContain("[API reference](../api/reference.md#post-widgets)");
  });
});
```

- [ ] **Step 2: Run to confirm it fails on the OLD behavior, passes on the new**

If Tasks 1–2 are already applied, run and expect PASS:
Run: `npx vitest run tests/pipeline-obsidian.test.ts -t "docf-7w5"`
Expected: PASS.

To confirm the test actually catches the bug, `git stash` the `src/` changes once and re-run — it must FAIL with `about:blank` present (then `git stash pop`). This proves the test is meaningful, not vacuous.

- [ ] **Step 3: Run the full suite**

Run: `npm test`
Expected: PASS — whole suite green (the `pretest` `tsc` build must also succeed; `delocalizeLinks` is fully typed).

- [ ] **Step 4: Commit**

```bash
git add tests/pipeline-obsidian.test.ts
git commit -m "test(pipeline): cross-dir anchored internal links, both formats (docf-7w5)"
```

---

## Self-Review

**1. Spec coverage (vs docf-7w5 acceptance criteria):**
- "default emits correct internal .md links (no about:blank)" → Task 3 default test. ✅
- "obsidian emits correct vault-relative [[wikilinks]] with anchor dropped (no about:blank, no double dir prefix)" → Task 3 obsidian test (`[[api/reference|API reference]]`). ✅
- "URL-source behavior unchanged" → Task 2 Step 4 runs `tools-convert.test.ts` (URL path); `delocalizeLinks` no-ops on real hosts. ✅
- "regression test fixture covering same-dir + cross-dir anchored links in both formats" → Task 1 unit (same-dir + cross-dir + root) + Task 3 integration (cross-dir, both formats). ✅

**2. Placeholder scan:** No TBD/TODO/"handle edge cases"; every code step shows full code. ✅

**3. Type consistency:** `LOCAL_BASE: string` and `delocalizeLinks(md: string, fromRelpath: string): string` are defined in Task 1 and consumed with those exact names/signatures in Task 2. `convertOpts` keeps its `{ selector?: string; url?: string }` shape. `sep`, `relative`, `item.key`, `outPath`, `opts.outputDir` all already exist at the cited lines. ✅

## Out of scope (do not do here)
- Re-relativizing **URL-source** same-origin links (they stay absolute today; separate concern).
- Filenames containing `#`, `?`, or other URL-significant characters beyond spaces (rare in doc corpora; `encodeURI` covers spaces). Note as a known edge if it ever surfaces.

## Execution Handoff

Plan complete and saved to `docs/superpowers/plans/2026-05-24-fix-about-blank-local-links.md`. Two execution options:

1. **Subagent-Driven (recommended)** — fresh subagent per task, review between tasks, fast iteration.
2. **Inline Execution** — execute tasks in this session using executing-plans, batch execution with checkpoints.

Which approach?
