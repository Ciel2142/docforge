# docforge — table-look fidelity (hybrid GFM / HTML)

- **Date:** 2026-05-26
- **Status:** Approved (design); ready for implementation plan
- **Topic:** Preserve the look of rich tables (Confluence-style) when converting HTML → Markdown
- **Scope:** Source-agnostic converter change only. Confluence *acquisition* is out of scope (separate follow-up).

## Summary

docforge converts source HTML to Markdown for RAG ingestion. The current path runs
every `<table>` through Kreuzberg's HTML→GFM conversion. GFM cannot represent merged
cells or block-level cell content, so rich tables come out **broken** — not just visually,
but structurally (data is lost and corrupted).

This change makes table conversion a **hybrid**: simple tables keep clean GFM; tables that
GFM would break fall back to a faithful, sanitized **embedded HTML block**. Markdown allows
inline HTML, and the relevant consumers (GitHub, Obsidian, RAG/LLM ingestion) all read HTML
tables. Confluence is the motivating case, but this applies to every HTML source.

## Motivation (measured)

Current pipeline: `rawHtml → Defuddle(cleanedHtml) → Kreuzberg(extractBytesSync, text/html) → markdown`.

A table with `colspan`/`rowspan`, a bulleted list in a cell, and a coloured cell, run through
the **current** path, produces:

```
| Team | | Notes |
| --- | --- | --- |
| Name | Role |  |
| Ada | Engineer | Owns:<br>coreAPI |
|  | Author | **Multi**   line   cell |
| Grace | Admiral | Pipe \| inside, and a `code()` |
```

Failures observed:
- **colspan/rowspan dropped** → cells misalign; the `Team` header span and the `Notes`
  rowspan collapse into stray empty cells.
- **rowspan data loss** → `Ada` (rowspan 2) appears only in row 1; row 2's first cell is
  empty, so *Ada is no longer associated with the "Author" row*. This is a correctness loss,
  not just a cosmetic one.
- **nested list corruption** → `<ul><li>core</li><li>API</li></ul>` is flattened and fused
  into the single token `coreAPI`.
- **cell colour dropped** (expected; not representable in GFM).

Pipes inside cells (`\|`) and inline `<code>` are handled correctly, and **simple** tables
(no spans, inline-only cells) already produce clean GFM. The fault line is precise: spans +
block-level cell content are what break GFM.

## Decisions

| Decision | Choice | Rationale |
|---|---|---|
| Representation | Hybrid: GFM for simple, embedded HTML for complex | Keeps RAG-friendly text for the common case; preserves structure for the cases GFM destroys. |
| Complexity trigger (v1) | Structural only: `colspan`/`rowspan` ≥ 2, or block content in a cell | These are the cases that break GFM (verified). Inline-only cells convert cleanly. |
| Cell colour | **Deferred** | Defuddle strips inline `style`/bgcolor from `cleanedHtml` *before* our code runs, and exposes no style-retain option (only removal toggles). Recovering colour needs a pre-Defuddle raw-HTML correlation path — real extra complexity for the lowest-value piece of "look". Documented as a future `--preserve-table-style` flag. |
| Hybrid on/off | Always-on, no flag | Strictly better than today's broken GFM; consumers all render inline HTML. No opt-out flag in v1 (see Future). |
| Intervention point | Post-Defuddle, around Kreuzberg (placeholder-swap) | `colspan`/`rowspan`/`<ul>` survive Defuddle (verified), so classifying on `cleanedHtml` works and reuses Kreuzberg's good GFM for simple tables. |

## Design

### Complexity classification

A `<table>` is **complex** (→ HTML) iff **any** of:
- some `<th>`/`<td>` has `colspan` or `rowspan` with integer value ≥ 2, **or**
- some cell contains a block-level descendant:
  `ul, ol, p, table, pre, blockquote, div, h1, h2, h3, h4, h5, h6, hr, figure, figcaption`.

Otherwise the table is **simple** and is left untouched for Kreuzberg → GFM.

Inline-only content (`strong, em, b, i, code, a, br, span, sup, sub`) does **not** make a
table complex — Kreuzberg handles it in GFM.

### New module: `src/tables.ts`

```ts
// Replace complex tables in HTML with placeholder paragraphs; return their sanitized HTML.
export function swapComplexTables(cleanedHtml: string): { html: string; stash: string[] };

// Re-insert stashed HTML blocks where their placeholders ended up in the Markdown.
export function restoreTables(markdown: string, stash: string[]): string;
```

`swapComplexTables`:
1. Parse `cleanedHtml` with linkedom (already a dependency).
2. For each `<table>` in document order: classify.
3. Complex → sanitize the table's HTML (see whitelist), push to `stash`, and replace the
   `<table>` node with a placeholder block element: `<p>{SENTINEL}</p>`.
4. Serialize the modified document back to an HTML string.

`restoreTables`:
- For each `i`, replace the line containing `SENTINEL_i` with `stash[i]`, padded with blank
  lines so the HTML table is a standalone block in the Markdown.

### Sentinel design

- Token form: `DOCFORGETABLE<runId><i>END` — uppercase letters + digits only, no
  Markdown-special characters. Wrapped in `<p>` so Kreuzberg emits it as its own paragraph
  line and passes it through unescaped (measured: plain alphanumerics survive; pipes get
  escaped — avoided).
- `runId` is a short random/opaque token generated per conversion to avoid collision with
  page content that might literally contain the base string.

### Sanitizer whitelist

- **Elements kept:** `table, thead, tbody, tfoot, tr, th, td`, and inside cells:
  `strong, em, b, i, u, s, code, a, br, ul, ol, li, p, sup, sub`.
- **Attributes kept:** `colspan`, `rowspan`, `scope` on cells; `href` on `<a>`.
- **Stripped:** `style`, `class`, `id`, `data-*`, event handlers (`on*`), `<script>`,
  `<style>`, and any element/attribute not whitelisted (unknown elements unwrapped to their
  text/children).
- Output is compact and deterministic (stable attribute order) so tests can assert exact HTML.

### Wiring — `convert.ts` only

In `convertHtml`, after `extractMainContent` returns `cleanedHtml`:

```ts
const { html, stash } = swapComplexTables(extracted.cleanedHtml);
const result = extractBytesSync(Buffer.from(html, "utf8"), "text/html", KZ_CONFIG);
const body_md = restoreTables(result.content.trim(), stash);
```

No new `ConvertOptions`, no CLI flag, no MCP parameter for v1.

### Data flow

```
rawHtml
  → Defuddle  → cleanedHtml
  → swapComplexTables   (simple tables stay inline; complex → <p>SENTINEL_i</p>, HTML stashed)
  → Kreuzberg HTML→MD   (simple tables → GFM; sentinels pass through as plain lines)
  → restoreTables       (SENTINEL_i → stash[i] as standalone HTML block)
  → body_md
```

## Edge cases

- **Nested tables:** an outer table containing a `<table>` cell is complex → emitted whole as
  HTML; the inner table comes along inside it. No recursion needed.
- **Sentinel collision:** mitigated by the per-conversion `runId`.
- **Malformed / unparseable table:** classification fails safe → table left in place for
  Kreuzberg (current behaviour), never throws.
- **Obsidian output path (`obsidian.ts`):** embedded HTML tables must pass through its
  transforms untouched — verify during implementation.
- **`th` vs `td`, `tfoot`, multiple `tbody`:** preserved structurally in the HTML fallback.

## Testing plan (TDD)

**Unit — `tables.test.ts`:**
- simple table (no spans, inline cells) → `stash` empty, not swapped.
- `colspan` ≥ 2 → swapped; `rowspan` ≥ 2 → swapped.
- cell containing `<ul>` / `<p>` / nested `<table>` → swapped.
- sanitizer: `<script>`, `on*`, `style`, `class`, `id`, `data-*` stripped; `colspan`/`rowspan`
  and inline formatting (`<strong>`, `<code>`, `<a href>`, `<br>`, `<ul>/<li>`) kept; literal
  pipe and `<code>` inside a complex cell preserved.
- `restoreTables`: reinserts at the right place, preserves order, handles multiple tables.

**Integration — `convert.test.ts`:**
- `convertHtml` on a page with one simple + one complex table:
  - simple table → GFM in output;
  - complex table → an HTML `<table>` in output;
  - no `coreAPI`-style list fusion (list rendered as real `<ul>`);
  - `rowspan` present (Ada associated with the correct row);
  - no sentinel string leaks into the output.

**Fixture:** realistic Confluence markup (`table.confluenceTable`, `th.confluenceTh`,
status-macro `<span>`, a `colspan` header) to confirm real-world recognition.

## Risks & what's already verified

- ✅ `colspan`, `rowspan`, and `<ul>` in cells survive Defuddle's `cleanedHtml` (probed).
- ✅ Kreuzberg gives clean GFM for simple tables; mangles complex ones exactly as described (probed).
- ✅ Defuddle strips inline `style`/bgcolor and exposes no style-retain option (probed).
- ⚠️ Sentinel survival through Kreuzberg — asserted by a round-trip test before relying on it.
- ⚠️ linkedom serialization fidelity for tables — covered by integration test.

## Future enhancements (out of scope here)

- `--preserve-table-style`: preserve cell background colour via a pre-Defuddle raw-HTML
  table-sourcing path (renders in Obsidian; GitHub strips `style` but keeps structure).
- `--no-html-tables`: opt-out to force legacy pure-GFM for consumers that cannot render HTML.
- **Confluence acquisition** (separate spec): REST adapter using a personal API token
  (`body.export_view`) vs HTTP crawl of rendered pages. Note the JS-render trap — docforge
  fetches with `got` (no JS), so Confluence Cloud's client-rendered bodies likely require the
  REST API rather than a page crawl; Server/Data Center is server-rendered and crawlable.
  Existing `--auth-header` carries `Authorization` (Basic/Bearer) but not `Cookie`.

## Acceptance criteria

1. A page with a `colspan`/`rowspan` table converts with that table as a structurally faithful
   HTML block; merged cells and row associations are preserved.
2. A cell containing a list converts without fusing list items (no `coreAPI`).
3. Simple tables are unchanged from current GFM output.
4. No sentinel/placeholder text appears in any output.
5. New unit + integration tests pass; existing test suite stays green.
