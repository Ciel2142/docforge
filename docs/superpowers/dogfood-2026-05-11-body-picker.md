# Body Picker Dogfood Report — 2026-05-11

**Branch:** body-picker-defuddle
**HEAD:** e96e597d178d4710162bcacd11fa2a2499fada14
**Spec:** docs/superpowers/specs/2026-05-11-docforge-body-picker-defuddle-design.md
**Plan:** docs/superpowers/plans/2026-05-11-docforge-body-picker-defuddle.md

## docs.kreuzberg.dev (Material for MkDocs, --max-pages 15)

- converted: 15
- empty: 0
- skipped: 0
- failed: 0
- total: 15

**Acceptance gate (>=12 converted): PASS**

Summary line (verbatim):
```
INFO converted=15 empty=0 skipped=0 failed=0 total=15
```

Exit code: 0. All 15 entries in `/tmp/dogfood-docs-report.json` report `status: "ok"`. No per-page failures, so no Defuddle spike was needed.

Pages converted:
- `index.md` (root landing)
- `features/index.md`
- `getting-started/installation/index.md`, `getting-started/quickstart/index.md`
- `concepts/architecture/index.md`, `concepts/extraction-pipeline/index.md`, `concepts/plugin-system/index.md`
- `guides/extraction/index.md`, `guides/configuration/index.md`, `guides/output-formats/index.md`, `guides/ocr/index.md`, `guides/html-output/index.md`, `guides/advanced/index.md`, `guides/keywords/index.md`, `guides/layout-detection/index.md`

## kreuzberg.dev (marketing + llms-full.txt, --max-pages 10, default --llms-full auto)

- converted: 1 (single `llms-full.md`)
- output filename: `llms-full.md`
- bytes: 12917

**Acceptance gate (>=1 converted): PASS**

Summary line (verbatim):
```
INFO converted=1 empty=0 skipped=0 failed=0 total=1
```

Auto-detect picked up `https://kreuzberg.dev/llms-full.txt` and short-circuited the HTML crawl, writing the single file as designed.

Head of `llms-full.md`:
```
# Kreuzberg

> Document text extraction for AI pipelines. Extract text, tables, and metadata from PDFs, images, Office documents, and 92 file formats — plus 305 programming languages for code intelligence. Available as an open-source library (Rust core, 12 language SDKs) and as a managed cloud API at <https://kreuzberg.dev>.

This is a single-document version of <https://kreuzberg.dev/llms.txt> — agents that prefer one fetch can read everything here.

## Positioning
```

## kreuzberg.dev with --llms-full off (--max-pages 10)

- converted: 2 (`index.md`, `privacy.md`)
- HTML pages handled: yes
- llms-full.md present: no (confirmed — directory contains only `index.md` and `privacy.md`)

Summary line (verbatim):
```
INFO converted=2 empty=0 skipped=8 failed=0 total=2
```

The 8 `skipped` entries are off-host or non-text-doc links the crawler correctly filtered (asset URLs, external sites). The HTML body-picker path activated for both visited pages.

## Quality notes

Spot-checked `/tmp/dogfood-docs/index.md`, `/tmp/dogfood-docs/getting-started/quickstart/index.md`, `/tmp/dogfood-docs/concepts/architecture/index.md`, and `/tmp/dogfood-marketing-off/index.md`:

- **Titles**: Each page opens with a clean `# <Title>` heading (e.g., `# Kreuzberg`, `# Quick Start`, `# Architecture`). The H1-hoist fix from commit d1d12c1 is holding — no duplicate-title regressions observed.
- **Code blocks**: Fenced with correct language tags. Quickstart preserves `c`, `csharp`, plus Python/TypeScript/Bash blocks further down. Mermaid diagrams in `concepts/architecture/index.md` (lines 29-40) are kept as `flowchart TB` blocks inside code fences.
- **Nav/sidebar text**: Absent from body content on the Material for MkDocs target. The Defuddle picker is correctly stripping the left-rail TOC and the right-rail in-page ToC. No "Skip to content" / "Table of contents" leakage.
- **Internal links**: Left as absolute URLs (e.g., `https://docs.kreuzberg.dev/getting-started/installation/`) rather than rewritten to relative `.md` paths. This is acceptable for the LLM-ingest use case (the URL still resolves) but is a known limitation worth tracking — not a regression introduced by this branch.
- **Marketing site (off mode)**: The hero block on `/tmp/dogfood-marketing-off/index.md` extracts the stat counters as separate paragraph lines ("1", "97", "file formats", ...), which is mildly noisy. This is the marketing-page shape, not a body-picker bug — Defuddle returns what's in the DOM and the page literally has the numbers in separate elements. Caught by the dogfood comment in the plan: "marketing-site shape is harder".

## Follow-ups

- [ ] Optional: investigate rewriting same-host absolute links to relative `.md` paths inside the body-picker output. Low priority — current behavior is correct for LLM ingestion.
- [ ] Optional: consider whether to collapse adjacent single-line paragraphs (the marketing-page stat-counter noise) — likely out of scope for this branch.

No blocking follow-ups. Both acceptance gates pass; ready to proceed to Task 10 (version bump).
