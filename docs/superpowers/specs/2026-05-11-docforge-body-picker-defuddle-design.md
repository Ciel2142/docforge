# Body Picker Generalization via Defuddle + llms-full.txt — Design Spec

**Date:** 2026-05-11
**Status:** Approved (Option A + C from scout report); plan pending
**Supersedes:** `docs/superpowers/plans/2026-05-11-docforge-body-picker-generalize.md` (hand-rolled selector chain — was the "guessing and inventing" the user warned against; deleted)
**Related:** prior `url-source` feature shipped on branch `url-source` HEAD `2165cf5`, 19 commits ahead of master, 181 tests pass

---

## Motivation

`docforge convert https://docs.kreuzberg.dev` (run 2026-05-11 after URL-source feature landed) produced `converted=0 empty=10` — every page fetched but none converted. Root cause: `selectBody` in `src/convert.ts` only matches Sphinx-shape (`div[itemprop="articleBody"]`, `div[role="main"]`). `docs.kreuzberg.dev` is Material for MkDocs, content wrapped in `<article class="md-content__inner md-typeset">`.

A general-purpose research agent surveyed prior art (full brief in conversation history; key findings preserved below). Primary lesson: real libraries (Mozilla Readability, Trafilatura, Defuddle) all rank **class-name evidence ABOVE semantic landmarks**, opposite of the naive `Sphinx → Material → <main> → <article>` chain I initially drafted. Every modern doc framework emits ONE of: `<main>`, `<article>`, `[role="main"]`, or a class containing `content`/`article`/`markdown`/`md-*`. Hand-rolling the chain ages badly (new frameworks every year); embedding a maintained library solves it once.

## Decision

**Adopt: Option A (Defuddle as body picker) + Option C (llms-full.txt detection as orthogonal optimization).**

Rationale:
- **Defuddle** (kepano, MIT, npm `defuddle@0.18.1` 2026-04-22) is built *specifically* for "extract clean HTML for Markdown conversion" — docforge's literal mission. Used in production by Obsidian Web Clipper.
- Has entry-point selector list (`ENTRY_POINT_ELEMENTS` in `defuddle/src/constants.ts`), content scoring (`defuddle/src/removals/scoring.ts`), and retry-on-low-wordcount escalation. Replaces both `selectBody` and `stripNoise` in one library boundary.
- TS-native, MIT, accepts any DOM. Pairs with `linkedom` (MIT, ESM-native, faster than jsdom).
- Combined dep size ~230 KB, acceptable next to cheerio (~600 KB).
- **llms-full.txt** detection is orthogonal and cheap (one HEAD request before crawl). ~10% adoption per Nov 2025 SERanking 300K-domain survey; named publishers include Anthropic, Stripe, Cursor, Cloudflare, Vercel, Mintlify, Supabase, LangGraph. **kreuzberg.dev publishes one** — direct existence proof on our failing test site.

Discarded:
- Option B (curated 14-selector chain, no deps). Kept as documented fallback if the A spike fails (<8/10 pass rate); not the primary path.
- Hand-rolled Sphinx → Material → main → article chain (my initial plan). Wrong selector ordering per evidence; no scoring on miss; manual maintenance burden.

## Validation gate (MUST pass before plan execution)

**Spike before committing to Defuddle.** Write a ~30-line script that:
1. Crawls 10 pages from `https://docs.kreuzberg.dev` (sitemap discovery — already works).
2. For each page: `Defuddle(linkedom.parseHTML(html).document, url, { markdown: false }).content`.
3. Pipes the cleaned HTML to existing Kreuzberg conversion.
4. Counts: how many produce non-empty Markdown with the expected `# <title>` H1 and main body text intact.

**Acceptance:** ≥ 8/10 pages convert cleanly. If yes → A is the path. If 6-7/10 → file follow-up issues per failing page, still ship A with a notch. If < 6/10 → fall back to Option B (curated chain spec preserved in §Fallback below).

## Integration design

### File structure

**Create:**
- `src/extract.ts` — new module wrapping Defuddle. Replaces the `selectBody` + `stripNoise` half of `src/convert.ts`. Exports `extractMainContent(rawHtml: string, url?: string, opts?: ExtractOptions): ExtractResult`.
- `src/http/llms.ts` — `probeLlmsFullTxt(rootUrl, fetchOpts): Promise<string | null>`. Returns the body of `<origin>/llms-full.txt` if `HEAD` then `GET` succeed with 200 + plausible content-type (`text/plain` or `text/markdown` or `text/*` with `.txt`/`.md`-shaped Content-Disposition), else null.
- `tests/extract.test.ts` — unit tests for `extractMainContent` against the existing 6 Sphinx fixtures + 3 new fixtures (Material, generic `<article>`, generic `<main>`).
- `tests/llms-txt.test.ts` — unit test for `probeLlmsFullTxt` via the existing `tests/helpers/static-server.ts` harness.
- `tests/cli-selector.test.ts` — integration test for `--selector <css>` flag override (Defuddle supports `entryPoint` option per its API).
- `tests/fixtures/material-mkdocs.html` — Material for MkDocs shape fixture (real-world structure with chrome around `article.md-content__inner`).
- `tests/fixtures/generic-article.html` — top-level `<article>` shape.
- `tests/fixtures/llms-full-site/` — static-server fixture corpus with a `llms-full.txt` at root + an HTML page that should be IGNORED when llms-full path is taken.
- `tests/expected/material-mkdocs.md`, `tests/expected/generic-article.md` — golden outputs (captured from real Defuddle + Kreuzberg run).

**Modify:**
- `src/convert.ts` — collapse to thin shim: `convertHtml(rawHtml, opts)` calls `extractMainContent` then feeds cleaned HTML to Kreuzberg. Existing `__testing__` export removed (selectBody/stripNoise no longer exist as standalone — moved into extract.ts which has its own tests). `convertHtml` signature gains `opts?: { selector?: string }`.
- `src/cli.ts` — add `--selector <css>` flag on `convert` subcommand (was in prior plan, still needed — wires through to Defuddle's `entryPoint` option). Add `--llms-full <mode>` flag with values `auto` (default; probe before crawl, use if found), `force` (require, fail if missing), `off` (skip detection).
- `src/source.ts` — `HttpSource` checks `llms-full.txt` first when mode is `auto` or `force`. If found, yields a single `SourceItem { key: 'llms-full.txt', srcUri: <url>, bytes, contentType: 'text/markdown', kind: 'llms-full' }` and stops. CLI conversion loop detects the `kind` and short-circuits (no Defuddle, no Kreuzberg — just rewrite internal links + write).
- `src/source.ts:SourceItem` — extend with `kind?: 'html' | 'llms-full'` (default `'html'` when absent).
- `package.json` — `defuddle@^0.18.1`, `linkedom@^0.18.5` added. Version bump `0.5.0` → `0.6.0` (Defuddle replaces the body picker; semver-significant behavior change).
- `tests/convert.test.ts` — most existing tests stay (golden cases). The `selectBody` describe block and `stripSphinxNoise` describe block move to `tests/extract.test.ts`. The "returns empty when no body marker" test changes because Defuddle has a different empty-classification heuristic — likely fewer empties (Defuddle falls through to `body`). Adjust assertions per actual Defuddle behavior captured during spike.
- `README.md` — replace any reference to the Sphinx-only picker with Defuddle behavior + the new flags.

### Defuddle integration sketch

```typescript
// src/extract.ts
import { parseHTML } from "linkedom";
import { Defuddle } from "defuddle/node";

export interface ExtractOptions {
  selector?: string;   // overrides Defuddle's entry-point selection
  url?: string;        // passed to Defuddle for context (link rewriting hints)
}

export type ExtractResult =
  | { status: "ok"; cleanedHtml: string; title: string | null; wordCount: number }
  | { status: "empty" };

export async function extractMainContent(
  rawHtml: string,
  opts: ExtractOptions = {},
): Promise<ExtractResult> {
  const { document } = parseHTML(rawHtml);
  const defuddleOpts: Record<string, unknown> = {
    markdown: false,                  // we want cleaned HTML, not MD — Kreuzberg does the MD step
    removePartialSelectors: true,
  };
  if (opts.selector) defuddleOpts.entryPoint = opts.selector;
  if (opts.url) defuddleOpts.url = opts.url;

  const result = await Defuddle(document, opts.url ?? "", defuddleOpts);
  if (!result?.content || result.wordCount < 5) return { status: "empty" };
  return {
    status: "ok",
    cleanedHtml: result.content,
    title: result.title ?? null,
    wordCount: result.wordCount,
  };
}
```

**Open question for spike:** verify Defuddle's actual API matches. `entryPoint` option is inferred from the selector-override pattern; if the actual option name differs (e.g. `rootSelector`, `entrySelector`), adjust. Confirm via `node_modules/defuddle/dist/index.d.ts` after install.

**Open question for spike:** does Defuddle reliably preserve code blocks with language tags (`<pre><code class="language-bash">`)? Kreuzberg downstream needs them for fenced-block language hints. If Defuddle strips them, the Material fixture golden will look worse than the prior Sphinx output. Capture-and-inspect during spike.

### llms-full.txt detection sketch

```typescript
// src/http/llms.ts
import { fetchUrl, FetchError, type FetchOptions } from "./fetch.js";

export async function probeLlmsFullTxt(
  rootUrl: string,
  opts: FetchOptions,
): Promise<{ url: string; bytes: Buffer; contentType: string } | null> {
  const origin = new URL(rootUrl).origin;
  const candidate = `${origin}/llms-full.txt`;
  try {
    const res = await fetchUrl(candidate, opts);
    if (res.status !== 200) return null;
    const ct = res.contentType.toLowerCase();
    if (!ct.startsWith("text/")) return null;
    return { url: candidate, bytes: res.bytes, contentType: res.contentType };
  } catch (e) {
    if (e instanceof FetchError) return null;
    throw e;
  }
}
```

`HttpSource.iter()` adds at the top:

```typescript
if (this.crawlOpts.llmsFullMode !== "off") {
  const llms = await probeLlmsFullTxt(this.rootUrl, this.fetchOpts);
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
    throw new Error(`llms-full.txt required (--llms-full force) but not found at ${this.rootUrl}`);
  }
}
// existing sitemap/BFS path follows
```

CLI loop in `runConvert`:

```typescript
if (item.kind === "llms-full") {
  // already markdown — skip Defuddle + Kreuzberg, just rewrite internal links
  const md = rewriteInternalLinks(item.bytes.toString("utf8"));
  const outPath = computeOutputPath(item, output);
  writeOutput(outPath, md);
  converted += 1;
  report.push({ input: item.key, srcUri: item.srcUri, output: outPath, status: "ok" });
  continue;
}
// existing convertHtml path for kind: 'html'
```

### `--selector` flag (preserved from prior plan)

Defuddle exposes `entryPoint` (or equivalent — confirm during spike). Wire `--selector <css>` directly through. Behavior: when supplied, Defuddle uses it as the entry point and skips its built-in `ENTRY_POINT_ELEMENTS` chain. Match required — if selector returns no element on a page, that page is classified `empty`.

Flag is `convert`-only; `openapi` subcommand parses JSON/YAML and ignores it.

## Fallback (Option B) — if spike fails

If Defuddle integration <6/10 on docs.kreuzberg.dev, abandon A and ship the curated selector chain. The 14-selector list synthesized from Defuddle's `ENTRY_POINT_ELEMENTS` + Trafilatura's `BODY_XPATH` (in priority order, class/id before landmarks):

```
 1. div[itemprop="articleBody"]              (Sphinx — existing)
 2. article.md-content__inner                (Material for MkDocs)
 3. main.md-main article                     (Material for MkDocs alt)
 4. div.theme-doc-markdown                   (Docusaurus)
 5. div.vp-doc                               (VitePress)
 6. article.markdown-body                    (GitHub-flavoured, mdBook)
 7. div.entry-content, div.article-content,
    div.article-body, div.post-content,
    div.content-article                      (generic blog/docs)
 8. div#content                              (Sphinx classic, mkdocs default)
 9. div[role="main"]                         (existing — Sphinx variant)
10. main[role="main"], main#main-content     (ARIA landmarks)
11. article[role="article"]                  (ARIA articles)
12. main                                     (HTML5 landmark)
13. article                                  (HTML5 article)
14. body                                     (give-up convert-everything)
```

Documented for future reference; not the chosen path.

## Tech Stack

- Node 20+, TypeScript strict + ESM + `verbatimModuleSyntax` + `exactOptionalPropertyTypes` (existing constraints)
- `defuddle@^0.18.1` (MIT) — body extraction
- `linkedom@^0.18.5` (MIT) — DOM for Defuddle (existing cheerio stays for link rewriting in `src/links.ts` — not replaced)
- `@kreuzberg/node` — HTML → MD conversion (unchanged)
- vitest — test framework (unchanged)
- commander — CLI (unchanged)

## Risk register

| Risk | Mitigation |
|---|---|
| Defuddle's `entryPoint` option name is inferred, not verified from source | Spike confirms via `node_modules/defuddle/dist/index.d.ts` before plan execution |
| Defuddle strips language tags from `<pre><code class="language-X">` blocks | Spike inspects 1 code-heavy fixture; if dropped, treat as known limitation (matches existing Kreuzberg behavior on language tags — see beads memory `kreuzberg-py-4-9-extractionconfig-use-cache-false`) |
| Defuddle's `isProbablyReaderable`-equivalent rejects doc pages with short prose + heavy code | Defuddle's retry escalation (`removePartialSelectors=false` at <200 words, scoring-off at <50) handles this case explicitly per kepano docs — verify via spike |
| llms-full.txt content is Markdown but contains author-specific formatting (front-matter, llms.txt link headers) | When `kind: 'llms-full'`, write the body as-is post link-rewrite. No header injection. Output filename: `llms-full.md` |
| `linkedom` parsing diverges from cheerio on edge cases (entities, malformed HTML) | Existing golden fixtures cover most cases; non-utf8 fixture covers character handling. Add 1 new fixture for &amp;/&lt; entity handling if spike surfaces divergence |
| Adding 2 new deps grows lockfile + supply chain surface | Defuddle: 1 contributor (kepano), MIT, mature for its age. linkedom: WebReflection, ~5 contributors, MIT, broadly used. Acceptable |
| Defuddle's content scoring removes content docforge wants (e.g. method signature paragraphs that look like nav) | If observed, use `--selector` override per-site as escape hatch |
| Version bump 0.5.0 → 0.6.0 implies breaking change | True — behavior of `convert` against non-Sphinx sites differs significantly. README documents the change |

## Open questions (deferred to plan-time spike)

1. Exact Defuddle option name for entry-point override (`entryPoint` vs `rootSelector` vs other)
2. Does Defuddle preserve `<pre><code class="language-X">` lang tags
3. Defuddle behavior on short pages — does retry escalation trigger reliably
4. Whether `linkedom`'s HTML parsing matches our existing fixtures byte-for-byte after Kreuzberg conversion (likely yes for valid HTML, possibly diverges for malformed)
5. Output filename convention for `llms-full.txt` source: `llms-full.md` vs `index.md`. Recommended: `llms-full.md` (preserves origin filename, avoids collision with crawl of HTML root)

## Acceptance criteria

1. `node dist/bin.js convert https://docs.kreuzberg.dev --output /tmp/dogfood --max-pages 15` produces `converted >= 12` (≥80% of fetched HTML pages).
2. `node dist/bin.js convert https://kreuzberg.dev --output /tmp/marketing --max-pages 10` produces `converted >= 1` (root + at least one of /privacy /terms /imprint /benchmarks). Marketing-site shape is harder; lower bar.
3. All existing 181 tests still pass (Sphinx fixtures unaffected — Defuddle handles them via class-name evidence).
4. `--selector "main.content"` override produces output identical to having that selector as the sole picker (no chain fallback when override given).
5. `--llms-full auto` (default) detects `kreuzberg.dev/llms-full.txt`, writes single `llms-full.md`, no HTML crawl performed on that site.
6. `--llms-full off` skips detection entirely (regression escape for users who don't trust llms-full content).
7. No regression in filesystem-source dogfood: `docforge convert ./tests/fixtures --output /tmp/fs-out` still produces correct output for the 6 Sphinx fixtures + 3 new fixtures.

## Branch strategy

This work depends on the `url-source` feature (HEAD `2165cf5` on branch `url-source`, 19 commits ahead of master). Options:

- **B1:** Branch `body-picker-defuddle` from `url-source`. Ship both as one v0.6.0 batch. Cleanest for users.
- **B2:** Merge `url-source` to master first (it's complete on its own merit and dogfood proved the URL plumbing). Then branch from master. Ships in two PRs: v0.5.0 (URL source) and v0.6.0 (body picker).

Recommended: **B2.** URL source is independently valuable and its tests pass. Body picker work has open questions (spike outcome) and shouldn't gate URL source merge. If spike succeeds quickly, both ship within days anyway.

## Next step (post-compact)

1. Use `superpowers:writing-plans` skill with this spec as input.
2. Plan must include: pre-implementation spike (Task 1: install Defuddle + linkedom, write 30-line validator against docs.kreuzberg.dev, gate on 8/10 pass rate). All other tasks branch on spike outcome.
3. Plan author decides B1 vs B2 based on user preference at plan-writing time.
