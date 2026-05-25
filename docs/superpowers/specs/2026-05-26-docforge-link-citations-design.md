# docforge: inline-link → footnote citation pass (HTML→MD)

- **Date:** 2026-05-26
- **Status:** Approved (design)
- **Bead:** docf-vz0
- **Origin:** crawl4ai technique-mining session (2026-05-25). crawl4ai's `markdown_with_citations` / `references_markdown` (`DefaultMarkdownGenerator options={citations:True}`) is the one HTML→MD technique not already covered by docforge's Defuddle + kreuzberg + qmd stack.

## Problem

External inline links `[text](https://…)` carry the full URL inline in the markdown body. For RAG:

- **qmd** embeds chunk text verbatim, URLs included (`qmd llm.ts:116` `formatDocForEmbedding`). Long URLs are embedding noise — they tokenize into low-signal fragments inside content chunks.
- **Obsidian** renders inline links fine but the raw URL clutters the note and is not navigable as a citation.

crawl4ai's answer: keep the human-readable anchor text inline, move the URL to a reference marker + a reference list at the document end.

## Value ceiling (measured, do not overstate)

- qmd: a doc ≤ 3600 chars (≈900 tokens) becomes **one** whole-doc chunk (`qmd store.ts:283-285`). For single-chunk docs, moving URLs to the end keeps them in the same chunk → **no embedding benefit**. Benefit accrues only on **long, link-dense** docs, where URLs move out of content chunks into the trailing references chunk.
- Obsidian: benefit is reading/navigation UX (native footnote rendering) regardless of doc length.

This is a **modest, conditional** win. Scoped accordingly: opt-in flag, default off.

## Goal

When enabled, convert external inline markdown links in the converted body to `[^n]` footnotes plus a `## References` definition block at the body end. Serve both targets with one mechanism: Obsidian renders/navigates `[^n]` footnotes natively (its TS API models them: `FootnoteSubpathResult`, `FootnoteRefCache`), and qmd gets a clean `##`-bounded references chunk.

## Non-goals

- Internal links / `[[wikilinks]]` — never touched (vault navigation must not break).
- Images — never touched.
- BM25 / query-scoped filtering, LLM content filtering, density pruning, line-wrap changes — out of scope (evaluated and rejected; see Rejected alternatives).

## Decisions

| Decision | Value | Rationale |
|---|---|---|
| Marker | `[^n]` markdown footnotes | Obsidian-native render + navigation; low-noise in qmd; standard CommonMark-extension syntax |
| Link scope | External `http(s)` only | Internal links already rewritten to `[[wikilinks]]`/`(path.md)` by the time this runs |
| Formats | All (`obsidian` + `default`) when flag on | One mechanism serves both targets |
| Default | OFF | Modest/conditional value; opt-in |
| Dedup | Identical URLs share one `[^n]` | Fewer footnotes, matches crawl4ai |
| References heading | `## References` included | `##` scores 90 as a qmd chunk breakpoint (`store.ts:115-128`) → isolates URL defs into their own chunk; harmless in Obsidian |

## Design

### 1. Trigger
New CLI flag `--cite-links` (boolean, default false) in `cli.ts`, threaded through pipeline options to the new pass. When off, output is byte-identical to current behavior.

### 2. Pipeline placement (`runPipeline.ts`)
Run on the `bodyMd` string **after**: link normalization (`relativizeSameOriginLinks`/`delocalizeLinks`), format link rewrite (`toObsidianWikilinks`/`rewriteInternalLinks`), VLM caption pass, and asset pass — and **before** `buildObsidianOutput`/`buildOutput`. At this point internal targets are no longer `[text](relative)`; only external `http(s)` links remain in `[text](url)` form, making the match unambiguous.

### 3. Module
New `src/citations.ts`:

```ts
export function convertLinksToFootnotes(md: string): { md: string; count: number };
```

`count` (number of distinct footnotes created) is surfaced in pipeline stats, mirroring the asset pass.

### 4. Transform algorithm
1. Compute fenced-code ranges (reuse `fenceRanges` from `vlm/select.ts`, or lift to a shared util) and skip any match inside them.
2. Match external markdown links: `[text](http(s)://…)` with negative lookbehind on `!` (skip images). Skip `mailto:`.
3. Maintain an ordered URL→index map; identical URLs reuse their index (dedup).
4. Replace each matched `[text](url)` with `text[^n]`.
5. If ≥1 footnote was created, append to the body end:
   ```
   \n\n## References\n\n[^1]: url1\n[^2]: url2\n…\n
   ```
6. If no external links matched, return the body unchanged (no empty heading).

### 5. Scope guards / edge cases
- **Images** `![alt](url)`: untouched (negative lookbehind `!`).
- **Internal links / wikilinks**: untouched (not `http(s)` at this stage).
- **`mailto:`**: untouched.
- **Code-fence links**: untouched (fence-range skip).
- **Bare-URL anchor** (anchor text already equals the URL): leave as-is — converting `https://x` → `https://x[^1]` + `[^1]: https://x` is pure redundancy.
- **No external links**: emit nothing.
- **Autolinks `<https://…>`**: v1 leaves untouched; only `[text](url)` form is converted. Validate kreuzberg's actual autolink emission during TDD; expand if warranted.
- **URL with literal `)` or `[text](url "title")` title syntax**: shares the `[^)\s]` link-body limitation documented in `links.ts:26-29` — the target is captured as `[^)\s]+`, so a `)` inside the URL or a trailing `"title"` is not handled. Not expected from kreuzberg on doc corpora; validate in TDD, fix all link regexes together if ever needed.

### 6. Interaction notes
- Runs after asset/VLM passes, which operate on images — no overlap with link conversion.
- Footnote definitions live literally at body end. Obsidian relocates footnote rendering to its own bottom section regardless of literal position; qmd sees the literal `## References` position and chunks on it. Both satisfied.

## Testing (TDD)

Write tests first. Fixtures:

| Case | Expectation |
|---|---|
| External `[text](https://…)` | → `text[^1]` + `## References` with `[^1]: https://…` |
| Duplicate external URL | both refs → same `[^n]`; one def |
| Image `![alt](https://…)` | unchanged |
| Internal `[t](path.md)` / `[[wikilink]]` | unchanged |
| Link inside ``` fence | unchanged |
| Bare-URL anchor `[https://x](https://x)` | unchanged |
| Doc with no external links | unchanged (no heading) |
| `--format obsidian` and `default` | both produce footnotes |
| **Flag OFF** | byte-identical to existing goldens (regression) |

## Rejected alternatives

- **Approach B** (transform in `convert.ts` pre-link-normalization): later wikilink/`.md` rewrite passes would have to skip footnoted links; ordering tangles. Rejected.
- **Approach C** (kreuzberg native citation option): no such option exists in `JsHtmlOptions` (`@kreuzberg/node index.d.ts:1359-1389`). Not available.
- **No-wrap (`body_width=0`)**: docforge already emits unwrapped markdown — kreuzberg runtime default is effectively `wrap=off` (measured: default maxLine 341 == `wrap:false`; `.d.ts:396` "Default: true" is stale). No-op, not built.
- **PruningContentFilter / fit_markdown**: overlaps Defuddle's Readability removal; only the `link_density` metric is marginally additive (separate measure-first task if Sphinx/TOC sidebars leak).
- **BM25 query filter**: wrong fit for whole-corpus ingest.
- **LLMContentFilter**: cost-prohibitive / nondeterministic for batch.
- **crawl4ai chunkers** (TextTiling, overlapping-window): all plain-text; qmd's heading-scored chunker (`store.ts:115-128`) is strictly better.

## References

- crawl4ai source: `crawl4ai/markdown_generation_strategy.py`, `crawl4ai/content_filter_strategy.py` (`unclecode/crawl4ai@main`).
- docforge: `src/runPipeline.ts`, `src/convert.ts:5-8` (KZ_CONFIG), `src/links.ts`, `src/obsidian.ts`, `src/vlm/select.ts:8-44` (`fenceRanges`/`findImageRefs`).
- qmd: `store.ts:115-128` (break-pattern scores), `store.ts:283-285` (single-chunk threshold), `llm.ts:116-123` (embedding input format).
- kreuzberg: `@kreuzberg/node/dist/types.d.ts:344-352, 396-399`.
