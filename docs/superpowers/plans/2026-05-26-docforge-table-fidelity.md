# Table-Look Fidelity (hybrid GFM / HTML) Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Convert tables that GFM cannot represent (merged cells or block-level cell content) to a sanitized embedded-HTML block, while keeping clean GFM for simple tables.

**Architecture:** A new `src/tables.ts` module wraps the existing Kreuzberg HTML→Markdown step in `src/convert.ts`. Before conversion, complex `<table>` nodes are sanitized, stashed, and replaced by a unique placeholder paragraph (`swapComplexTables`); after conversion, the stashed HTML is re-inserted where each placeholder landed (`restoreTables`). Simple tables flow through Kreuzberg unchanged. Table-free and simple-only pages produce byte-identical output to today (short-circuit guards).

**Tech Stack:** TypeScript (ESM, NodeNext, strict, `verbatimModuleSyntax`), linkedom (DOM parse/serialize — already a dependency), `@kreuzberg/node` (HTML→MD), Defuddle (body extraction), vitest.

Spec: `docs/superpowers/specs/2026-05-26-docforge-table-fidelity-design.md`

---

## Background the engineer needs

- Pipeline today (`src/convert.ts`): `rawHtml → Defuddle(cleanedHtml) → extractBytesSync(cleanedHtml, "text/html") → markdown`.
- **Verified** facts this plan relies on (do not re-litigate):
  - Defuddle keeps `colspan`/`rowspan` and `<ul>` in `cleanedHtml`, but strips inline `style`/colour. So colour is out of scope; structural triggers survive.
  - Kreuzberg makes clean GFM for simple tables, but for complex ones it drops spans, detaches rowspan cells, and **fuses** nested list items (`<li>core</li><li>API</li>` → `coreAPI`).
  - linkedom: `parseHTML(fragment).document` round-trips a fragment via `document.toString()` (no `<html>` wrapper added); `body.innerHTML` is empty in fragment mode — **use `toString()`**. `querySelectorAll`, `getAttribute`, `querySelector`, `closest`, `parentElement`, `createElement`, `textContent`, `replaceWith(...nodes)`, `remove()`, `el.attributes` + `removeAttribute` all work and typecheck under the repo's strict config when the document is cast `as unknown as Document`.
  - A placeholder of the form `DOCFORGETABLE<runId>N<i>END` wrapped in `<p>` passes through Kreuzberg unescaped on its own line.
- Test layout: tests live in `tests/<topic>.test.ts` (vitest). `tsconfig.json` excludes `tests/`, so `npm run typecheck` checks `src/` only; tests are run (not strictly type-checked) by vitest. Use `.js` import specifiers (NodeNext), e.g. `import { x } from "../src/tables.js"`.
- Run a single test file: `npx vitest run tests/<file>.test.ts`. Full suite: `npm test` (runs `tsc` then vitest). Typecheck only: `npm run typecheck`.

## File Structure

- **Create** `src/tables.ts` — the whole feature's logic: classification (`isComplexTable`), sanitization (`sanitizeTable`), `swapComplexTables`, `restoreTables`, plus the `Placeholder`/`SwapResult` types. One responsibility: representing complex tables across the HTML→MD boundary. Helpers stay private; the module exports only `swapComplexTables`, `restoreTables`, and the two types (mirrors `src/md-fences.ts` exporting focused helpers).
- **Modify** `src/convert.ts` — wire `swapComplexTables`/`restoreTables` around the existing `extractBytesSync` call. No other logic changes.
- **Create** `tests/tables.test.ts` — unit tests for the module (classification, sanitization, nesting, restore).
- **Create** `tests/convert-tables.test.ts` — integration tests through `convertHtml`, plus the Confluence fixture test.
- **Create** `tests/fixtures/confluence-table.html` — realistic Confluence rendered markup.
- **Modify** `README.md` — short `### Tables` note under `### Body extraction`.

No CLI flag, no `ConvertOptions` change, no MCP parameter (hybrid is always-on).

---

### Task 1: Types + `restoreTables`

**Files:**
- Create: `src/tables.ts`
- Test: `tests/tables.test.ts`

- [ ] **Step 1: Write the failing test**

Create `tests/tables.test.ts`:

```ts
import { describe, expect, test } from "vitest";
import { restoreTables } from "../src/tables.js";

describe("restoreTables", () => {
  test("replaces each token with its HTML block and tidies blank lines", () => {
    const md = "before\n\nDOCFORGETABLEab12N0END\n\nafter";
    const out = restoreTables(md, [
      { token: "DOCFORGETABLEab12N0END", html: "<table><tr><td>x</td></tr></table>" },
    ]);
    expect(out).toContain("<table><tr><td>x</td></tr></table>");
    expect(out).not.toContain("DOCFORGETABLEab12N0END");
    expect(out).not.toMatch(/\n{3,}/);
  });

  test("is a no-op when there are no placeholders", () => {
    expect(restoreTables("hello\n\n\nworld", [])).toBe("hello\n\n\nworld");
  });
});
```

- [ ] **Step 2: Run test to verify it fails**

Run: `npx vitest run tests/tables.test.ts`
Expected: FAIL — cannot resolve `../src/tables.js` (module does not exist).

- [ ] **Step 3: Write minimal implementation**

Create `src/tables.ts`:

```ts
export interface Placeholder {
  token: string;
  html: string;
}

export interface SwapResult {
  html: string;
  placeholders: Placeholder[];
}

/** Re-insert each stashed HTML table where its placeholder landed in the Markdown. */
export function restoreTables(markdown: string, placeholders: Placeholder[]): string {
  if (placeholders.length === 0) return markdown;
  let out = markdown;
  for (const { token, html } of placeholders) {
    out = out.replaceAll(token, `\n\n${html}\n\n`);
  }
  return out.replace(/\n{3,}/g, "\n\n").trim();
}
```

- [ ] **Step 4: Run test to verify it passes**

Run: `npx vitest run tests/tables.test.ts`
Expected: PASS (2 tests).

- [ ] **Step 5: Commit**

```bash
git add src/tables.ts tests/tables.test.ts
git commit -m "feat(tables): restoreTables + Placeholder types"
```

---

### Task 2: `swapComplexTables` skeleton — simple tables untouched

**Files:**
- Modify: `src/tables.ts`
- Test: `tests/tables.test.ts`

- [ ] **Step 1: Write the failing test**

Add to `tests/tables.test.ts` (extend the import and append a describe block):

```ts
// change the import line at the top of the file to:
import { restoreTables, swapComplexTables } from "../src/tables.js";

describe("swapComplexTables — simple tables", () => {
  test("leaves a simple table untouched", () => {
    const html =
      `<p>intro</p><table><thead><tr><th>Name</th><th>Role</th></tr></thead>` +
      `<tbody><tr><td>Ada</td><td>Eng</td></tr></tbody></table>`;
    const { html: out, placeholders } = swapComplexTables(html);
    expect(placeholders).toHaveLength(0);
    expect(out).toContain("<table");
    expect(out).toContain("Ada");
  });
});
```

- [ ] **Step 2: Run test to verify it fails**

Run: `npx vitest run tests/tables.test.ts`
Expected: FAIL — `swapComplexTables` is not exported.

- [ ] **Step 3: Write minimal implementation**

In `src/tables.ts`, add the import at the very top and append the function plus two private stubs (the stubs are filled in Tasks 3 and 4):

```ts
import { parseHTML } from "linkedom";
```

```ts
/**
 * Replace tables GFM cannot represent with placeholder paragraphs, returning
 * their sanitized HTML so the caller can re-insert it after the HTML->Markdown step.
 */
export function swapComplexTables(cleanedHtml: string): SwapResult {
  const { document } = parseHTML(cleanedHtml);
  const doc = document as unknown as Document;
  const placeholders: Placeholder[] = [];
  const runId = Math.random().toString(36).slice(2, 8);
  let swapped = false;
  for (const table of Array.from(doc.querySelectorAll("table"))) {
    if (!isComplexTable(table)) continue;
    sanitizeTable(table);
    const token = `DOCFORGETABLE${runId}N${placeholders.length}END`;
    placeholders.push({ token, html: table.outerHTML });
    const marker = doc.createElement("p");
    marker.textContent = token;
    table.replaceWith(marker);
    swapped = true;
  }
  return { html: swapped ? doc.toString() : cleanedHtml, placeholders };
}

function isComplexTable(_table: Element): boolean {
  return false; // real classification added in Task 3
}

function sanitizeTable(_table: Element): void {
  // real sanitization added in Task 4
}
```

- [ ] **Step 4: Run tests + typecheck to verify they pass**

Run: `npx vitest run tests/tables.test.ts && npm run typecheck`
Expected: PASS (3 tests); typecheck exit 0. (With the stub, no table is swapped, so the simple table is returned unchanged.)

- [ ] **Step 5: Commit**

```bash
git add src/tables.ts tests/tables.test.ts
git commit -m "feat(tables): swapComplexTables skeleton (simple tables pass through)"
```

---

### Task 3: Classification — swap tables with spans or block-content cells

**Files:**
- Modify: `src/tables.ts`
- Test: `tests/tables.test.ts`

- [ ] **Step 1: Write the failing test**

Append to `tests/tables.test.ts`:

```ts
describe("swapComplexTables — classification", () => {
  test("swaps a table with colspan >= 2", () => {
    const html = `<table><tr><td colspan="2">Span</td></tr><tr><td>a</td><td>b</td></tr></table>`;
    const { html: out, placeholders } = swapComplexTables(html);
    expect(placeholders).toHaveLength(1);
    expect(out).toContain(placeholders[0]!.token);
    expect(out).not.toContain("<table");
  });

  test("swaps a table with rowspan >= 2", () => {
    const html = `<table><tr><td rowspan="2">A</td><td>b</td></tr><tr><td>c</td></tr></table>`;
    const { placeholders } = swapComplexTables(html);
    expect(placeholders).toHaveLength(1);
  });

  test("swaps a table with block content (list) in a cell", () => {
    const html = `<table><tr><td><ul><li>core</li><li>API</li></ul></td><td>x</td></tr></table>`;
    const { placeholders } = swapComplexTables(html);
    expect(placeholders).toHaveLength(1);
    expect(placeholders[0]!.html).toContain("<ul>");
  });

  test("does NOT swap a table whose cells hold only inline content", () => {
    const html =
      `<table><tr><td><strong>b</strong> <code>x()</code><br>line <a href="/y">y</a></td></tr></table>`;
    const { placeholders } = swapComplexTables(html);
    expect(placeholders).toHaveLength(0);
  });
});
```

- [ ] **Step 2: Run test to verify it fails**

Run: `npx vitest run tests/tables.test.ts`
Expected: FAIL — colspan/rowspan/block tests expect 1 placeholder but the stub returns 0.

- [ ] **Step 3: Write the implementation**

In `src/tables.ts`, add the block-element constant near the other top-level consts:

```ts
/** Block-level elements that, inside a cell, make GFM unable to represent the table. */
const BLOCK_IN_CELL =
  "ul,ol,p,table,pre,blockquote,div,h1,h2,h3,h4,h5,h6,hr,figure,figcaption";
```

Replace the `isComplexTable` stub with:

```ts
function isComplexTable(table: Element): boolean {
  for (const cell of Array.from(table.querySelectorAll("th,td"))) {
    const colspan = parseInt(cell.getAttribute("colspan") ?? "1", 10);
    const rowspan = parseInt(cell.getAttribute("rowspan") ?? "1", 10);
    if (colspan >= 2 || rowspan >= 2) return true;
    if (cell.querySelector(BLOCK_IN_CELL)) return true;
  }
  return false;
}
```

- [ ] **Step 4: Run tests + typecheck to verify they pass**

Run: `npx vitest run tests/tables.test.ts && npm run typecheck`
Expected: PASS (7 tests); typecheck exit 0.

- [ ] **Step 5: Commit**

```bash
git add src/tables.ts tests/tables.test.ts
git commit -m "feat(tables): classify complex tables (spans / block-content cells)"
```

---

### Task 4: Sanitization of the stashed HTML

**Files:**
- Modify: `src/tables.ts`
- Test: `tests/tables.test.ts`

- [ ] **Step 1: Write the failing test**

Append to `tests/tables.test.ts`:

```ts
describe("swapComplexTables — sanitization", () => {
  test("strips class/style/onclick/data-* but keeps colspan", () => {
    const html =
      `<table><tr><td colspan="2" class="c" style="color:red" data-x="1" onclick="e()">h</td></tr>` +
      `<tr><td>a</td><td>b</td></tr></table>`;
    const { placeholders } = swapComplexTables(html);
    const out = placeholders[0]!.html;
    expect(out).toContain('colspan="2"');
    expect(out).not.toContain("class");
    expect(out).not.toContain("style");
    expect(out).not.toContain("onclick");
    expect(out).not.toContain("data-x");
  });

  test("removes <script> and unwraps disallowed elements to their text", () => {
    const html =
      `<table><tr><td colspan="2"><span class="status">Done</span><script>evil()</script></td></tr>` +
      `<tr><td>a</td><td>b</td></tr></table>`;
    const out = swapComplexTables(html).placeholders[0]!.html;
    expect(out).toContain("Done");
    expect(out).not.toContain("<span");
    expect(out).not.toContain("evil");
    expect(out).not.toContain("<script");
  });

  test("keeps inline formatting and literal pipes inside cells", () => {
    const html =
      `<table><tr><td colspan="2"><strong>b</strong> a | b <code>x()</code></td></tr>` +
      `<tr><td>a</td><td>b</td></tr></table>`;
    const out = swapComplexTables(html).placeholders[0]!.html;
    expect(out).toContain("<strong>b</strong>");
    expect(out).toContain("<code>x()</code>");
    expect(out).toContain("|");
  });
});
```

- [ ] **Step 2: Run test to verify it fails**

Run: `npx vitest run tests/tables.test.ts`
Expected: FAIL — `sanitizeTable` is a no-op, so `class`/`style`/`<span>`/`<script>` survive in the stashed HTML.

- [ ] **Step 3: Write the implementation**

In `src/tables.ts`, add these top-level consts:

```ts
/** Elements allowed to remain inside an emitted HTML table. Anything else is unwrapped to its children. */
const ALLOWED_TAGS = new Set([
  "table", "thead", "tbody", "tfoot", "tr", "th", "td",
  "strong", "em", "b", "i", "u", "s", "code", "a", "br", "ul", "ol", "li", "p", "sup", "sub",
]);

/** Elements removed wholesale (content dropped, not unwrapped). */
const DROP_TAGS = new Set([
  "script", "style", "iframe", "object", "embed", "noscript", "template",
]);

const KEEP_ATTRS_CELL = new Set(["colspan", "rowspan", "scope"]);
const KEEP_ATTRS_LINK = new Set(["href"]);
```

Replace the `sanitizeTable` stub with:

```ts
function sanitizeTable(table: Element): void {
  for (const el of Array.from(table.querySelectorAll("*"))) {
    const tag = el.tagName.toLowerCase();
    if (DROP_TAGS.has(tag)) {
      el.remove();
      continue;
    }
    if (!ALLOWED_TAGS.has(tag)) {
      el.replaceWith(...Array.from(el.childNodes));
      continue;
    }
    const keep = tag === "a" ? KEEP_ATTRS_LINK : KEEP_ATTRS_CELL;
    for (const name of Array.from(el.attributes).map((a) => a.name)) {
      if (!keep.has(name)) el.removeAttribute(name);
    }
  }
  for (const name of Array.from(table.attributes).map((a) => a.name)) {
    table.removeAttribute(name);
  }
}
```

- [ ] **Step 4: Run tests + typecheck to verify they pass**

Run: `npx vitest run tests/tables.test.ts && npm run typecheck`
Expected: PASS (10 tests); typecheck exit 0.

- [ ] **Step 5: Commit**

```bash
git add src/tables.ts tests/tables.test.ts
git commit -m "feat(tables): sanitize stashed table HTML (whitelist tags/attrs)"
```

---

### Task 5: Nested tables — one placeholder, inner rides inside outer

**Files:**
- Modify: `src/tables.ts`
- Test: `tests/tables.test.ts`

- [ ] **Step 1: Write the failing test**

Append to `tests/tables.test.ts`:

```ts
describe("swapComplexTables — nested tables", () => {
  test("emits a single placeholder; the inner table rides inside the outer block", () => {
    const html =
      `<table><tr><td><table><tr><td colspan="2">inner</td></tr></table></td></tr></table>`;
    const { html: out, placeholders } = swapComplexTables(html);
    expect(placeholders).toHaveLength(1);
    expect(placeholders[0]!.html).toContain("inner");
    expect((placeholders[0]!.html.match(/<table/g) ?? []).length).toBe(2);
    expect(out).not.toContain("<table");
  });
});
```

Why this currently fails: the outer table is complex (it contains a `<table>` — block content), and the inner table is complex (colspan). Without a nesting guard, the loop processes the outer (stash includes the inner), then also tries the inner — producing a second placeholder.

- [ ] **Step 2: Run test to verify it fails**

Run: `npx vitest run tests/tables.test.ts`
Expected: FAIL — `placeholders` has length 2, not 1.

- [ ] **Step 3: Write the implementation**

In `src/tables.ts`, add the nesting guard as the **first** statement inside the `for` loop of `swapComplexTables`, so the loop head reads:

```ts
  for (const table of Array.from(doc.querySelectorAll("table"))) {
    // Only act on the outermost table; a nested table rides inside its ancestor.
    if (table.parentElement && table.parentElement.closest("table")) continue;
    if (!isComplexTable(table)) continue;
    sanitizeTable(table);
    const token = `DOCFORGETABLE${runId}N${placeholders.length}END`;
    placeholders.push({ token, html: table.outerHTML });
    const marker = doc.createElement("p");
    marker.textContent = token;
    table.replaceWith(marker);
    swapped = true;
  }
```

- [ ] **Step 4: Run tests + typecheck to verify they pass**

Run: `npx vitest run tests/tables.test.ts && npm run typecheck`
Expected: PASS (11 tests); typecheck exit 0.

- [ ] **Step 5: Commit**

```bash
git add src/tables.ts tests/tables.test.ts
git commit -m "feat(tables): skip nested tables (outermost carries inner)"
```

---

### Task 6: Wire into `convert.ts` + integration test

**Files:**
- Modify: `src/convert.ts` (imports near top; conversion block at lines ~67-78)
- Create: `tests/convert-tables.test.ts`

- [ ] **Step 1: Write the failing test**

Create `tests/convert-tables.test.ts`:

```ts
import { describe, expect, test } from "vitest";
import { convertHtml } from "../src/convert.js";

describe("convertHtml — table fidelity", () => {
  test("keeps simple tables as GFM and complex tables as faithful HTML", async () => {
    const html = `<!doctype html><html><body><main>
<h1>Doc</h1>
<p>Intro paragraph with enough words to keep this as real article content here.</p>
<table><thead><tr><th>Name</th><th>Role</th></tr></thead>
<tbody><tr><td>Ada</td><td>Engineer</td></tr></tbody></table>
<p>Middle paragraph separating the two tables with several words of filler.</p>
<table>
<tr><td rowspan="2">Ada</td><td>Owns:<ul><li>core</li><li>API</li></ul></td></tr>
<tr><td>Author</td></tr>
</table>
<p>Trailing paragraph also with several words to keep the body large enough.</p>
</main></body></html>`;
    const r = await convertHtml(html);
    expect(r.status).toBe("ok");
    if (r.status !== "ok") return;
    const md = r.body_md;
    // simple table -> GFM
    expect(md).toContain("| Name | Role |");
    expect(md).toContain("| --- | --- |");
    // complex table -> embedded HTML, rowspan + list preserved
    expect(md).toContain("<table");
    expect(md).toContain('rowspan="2"');
    expect(md).toContain("<li>core</li>");
    // the corruption we are fixing must NOT occur
    expect(md).not.toContain("coreAPI");
    // no placeholder leaks into output
    expect(md).not.toMatch(/DOCFORGETABLE/);
  });
});
```

- [ ] **Step 2: Run test to verify it fails**

Run: `npx vitest run tests/convert-tables.test.ts`
Expected: FAIL — output contains `coreAPI` and no `<table`/`rowspan` (current Kreuzberg-only path).

- [ ] **Step 3: Write the implementation**

In `src/convert.ts`, add the import after the existing `./extract.js` import:

```ts
import { swapComplexTables, restoreTables } from "./tables.js";
```

Replace this block:

```ts
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
```

with:

```ts
    const { html, placeholders } = swapComplexTables(extracted.cleanedHtml);
    const result = extractBytesSync(
      Buffer.from(html, "utf8"),
      "text/html",
      KZ_CONFIG,
    );
    const body_md = restoreTables(result.content.trim(), placeholders);

    return {
      status: "ok",
      body_md,
      h1_text: h1,
      soup_title_text: soupTitle,
    };
```

- [ ] **Step 4: Run tests + typecheck to verify they pass**

Run: `npx vitest run tests/convert-tables.test.ts && npm run typecheck`
Expected: PASS; typecheck exit 0.

- [ ] **Step 5: Commit**

```bash
git add src/convert.ts tests/convert-tables.test.ts
git commit -m "feat(convert): hybrid table conversion via swap/restore around Kreuzberg"
```

---

### Task 7: Confluence fixture + recognition test

**Files:**
- Create: `tests/fixtures/confluence-table.html`
- Modify: `tests/convert-tables.test.ts`

- [ ] **Step 1: Write the failing test**

Create `tests/fixtures/confluence-table.html`:

```html
<!doctype html><html><body><main>
<h1>Release Notes</h1>
<p>This page documents the release status across components with enough words to pass extraction.</p>
<table class="confluenceTable">
<thead>
<tr><th class="confluenceTh" colspan="2">Component</th><th class="confluenceTh">Status</th></tr>
</thead>
<tbody>
<tr>
  <td class="confluenceTd" rowspan="2">Core</td>
  <td class="confluenceTd">Parser</td>
  <td class="confluenceTd"><span class="status-macro aui-lozenge aui-lozenge-success">DONE</span></td>
</tr>
<tr>
  <td class="confluenceTd">Emitter</td>
  <td class="confluenceTd"><span class="status-macro aui-lozenge">IN PROGRESS</span></td>
</tr>
</tbody>
</table>
<p>Trailing paragraph with several words so the article body stays large enough for Defuddle.</p>
</main></body></html>
```

Add to `tests/convert-tables.test.ts` (extend the import with `readFileSync`, then add the test inside the existing describe):

```ts
import { readFileSync } from "node:fs";

  test("recognises real Confluence markup and preserves status text", async () => {
    const html = readFileSync("tests/fixtures/confluence-table.html", "utf8");
    const r = await convertHtml(html);
    expect(r.status).toBe("ok");
    if (r.status !== "ok") return;
    const md = r.body_md;
    expect(md).toContain("<table");
    expect(md).toContain('colspan="2"');
    expect(md).toContain('rowspan="2"');
    expect(md).toContain("DONE");
    expect(md).toContain("IN PROGRESS");
    expect(md).not.toContain("confluenceTable"); // class attr stripped
    expect(md).not.toContain("aui-lozenge");      // status <span> unwrapped to text
    expect(md).not.toMatch(/DOCFORGETABLE/);
  });
```

- [ ] **Step 2: Run test to verify it fails**

Run: `npx vitest run tests/convert-tables.test.ts`
Expected: the fixture test FAILS first if the fixture file is missing (ENOENT) — create the file in Step 1 above so the failure is instead a clean assertion failure only if logic is wrong. With Task 6 implemented, this test should pass once the fixture exists; if you are running strict red-green, temporarily assert `expect(md).toContain("NONEXISTENT")` to see RED, then remove it. (The fixture exercises `class` stripping and `<span>` unwrap on real markup.)

- [ ] **Step 3: Confirm implementation**

No new implementation — Tasks 1-6 already cover this. This task adds coverage for real-world Confluence markup (class soup + status-lozenge spans).

- [ ] **Step 4: Run tests + typecheck to verify they pass**

Run: `npx vitest run tests/convert-tables.test.ts && npm run typecheck`
Expected: PASS (2 tests in the file); typecheck exit 0.

- [ ] **Step 5: Commit**

```bash
git add tests/fixtures/confluence-table.html tests/convert-tables.test.ts
git commit -m "test(convert): Confluence table fixture (class strip, status spans)"
```

---

### Task 8: Document the behaviour in README

**Files:**
- Modify: `README.md` (insert after the `### Body extraction` section, before `### Image description (VLM)`)

- [ ] **Step 1: Make the edit**

In `README.md`, find:

```
Override per run with `--selector <css>` when the picker chooses the wrong
element on a specific site. Use `--format <default|obsidian>` to switch the
output shape (see [Output formats](#output-formats) below).

### Image description (VLM)
```

Replace with:

```
Override per run with `--selector <css>` when the picker chooses the wrong
element on a specific site. Use `--format <default|obsidian>` to switch the
output shape (see [Output formats](#output-formats) below).

### Tables

Most tables convert to GitHub-Flavoured Markdown. Tables that GFM cannot
represent faithfully — those with merged cells (`colspan`/`rowspan`) or
block-level content inside a cell (lists, paragraphs, nested tables) — are
emitted as a sanitized HTML `<table>` block instead, preserving their
structure. The embedded HTML renders on GitHub and in Obsidian; simple tables
are unaffected. Cell background colour is not preserved.

### Image description (VLM)
```

- [ ] **Step 2: Verify the edit**

Run: `grep -n "### Tables" README.md`
Expected: one match between the Body extraction and Image description sections.

- [ ] **Step 3: Commit**

```bash
git add README.md
git commit -m "docs(readme): document hybrid table conversion behaviour"
```

---

### Task 9: Full verification

**Files:** none (verification only)

- [ ] **Step 1: Typecheck**

Run: `npm run typecheck`
Expected: exit 0, no output errors.

- [ ] **Step 2: Full test suite**

Run: `npm test`
Expected: `tsc` passes, then **all** vitest files pass — the new `tables`/`convert-tables` tests plus every pre-existing test (no regressions). Pay attention that `extract.test.ts` golden files and any `pipeline-*` tests still pass; if a golden changed, investigate whether the linkedom round-trip leaked into a no-complex-table path (it must not — `swapComplexTables` returns the original string when nothing was swapped).

- [ ] **Step 3: Build**

Run: `npm run build`
Expected: exit 0 (compiles to `dist/`).

- [ ] **Step 4: Commit (only if anything was adjusted during verification)**

```bash
git add -A
git commit -m "chore(tables): verification fixes"
```

---

## Self-Review (completed during planning)

- **Spec coverage:** hybrid representation (Tasks 1-6); structural-only trigger — colspan/rowspan + block-in-cell (Task 3); sanitizer whitelist (Task 4); placeholder-swap architecture + sentinel (Tasks 1-2); nested tables (Task 5); `convert.ts` wiring + data flow (Task 6); tests incl. "no coreAPI fusion", rowspan present, no sentinel leak (Task 6) and Confluence fixture (Task 7); README note (Task 8). Colour deferral and "no CLI flag" honoured (no flag task). Acceptance criteria 1-5 map to Tasks 6-9.
- **Placeholder scan:** none — every code/test step contains complete code and exact commands.
- **Type consistency:** `Placeholder { token, html }` and `SwapResult { html, placeholders }` defined in Task 1 and used unchanged in Tasks 2/6; `swapComplexTables`/`restoreTables` signatures stable across tasks; `isComplexTable`/`sanitizeTable` stubbed in Task 2 with the exact signatures filled in Tasks 3/4. The complete module compiles under the repo's strict config (`npm run typecheck` exit 0, verified during planning).
- **Out of scope (unchanged):** Confluence acquisition (REST adapter / crawl auth / JS-render) — separate follow-up spec.
