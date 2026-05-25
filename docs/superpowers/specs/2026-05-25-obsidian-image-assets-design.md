# Obsidian image assets — design

**Date:** 2026-05-25
**Status:** approved (pending spec review)

## Problem

`docforge convert --format obsidian` produces a vault of Markdown notes but never
saves referenced images. The converter keeps the `![alt](src)` ref (kreuzberg
emits it; `toObsidianWikilinks` deliberately skips images via the `(?<!!)`
lookbehind in `obsidian.ts:24`), and `writeOutput` writes **only** the `.md` text
(`output.ts:22-25`). No step copies image bytes. Result: the vault note links to
`![](some/path.png)` whose target was never written → broken embed in Obsidian.

This is by design (output targets RAG/embedding, not asset preservation). The VLM
pass (`--describe-images`) *describes* an image as a text caption but still saves
no file, and runs for URL sources only.

## Goal

When `--format obsidian` and a new `--save-images` flag are both set, copy each
referenced raster image into the vault and rewrite its ref to an Obsidian embed,
so Obsidian renders the image. Default behaviour (and the `default` format) is
unchanged.

## Scope

In scope:
- CLI `convert` command only.
- `--format obsidian` only.
- Both URL sources (fetch bytes) and local sources (read bytes from disk).
- Raster formats: `png`, `jpg`/`jpeg`, `webp`, `gif`, `bmp`, and `data:` URIs of
  those MIME types.

Out of scope (v1):
- MCP `convert` tool. It is URL-only and writes into qmd collections whose every
  file is enumerated by `listPages` (`mcp/tools/convert.ts:149`) and folded into
  the corpus sha + manifest `page_count`. Saving `_assets/*.png` there would
  pollute the page list and confuse downstream qmd indexing. Revisit separately
  if needed (would require excluding `_assets/` from `listPages`).
- SVG (it is XML text, not a raster; would add embedding noise if ever inlined).
- Base64 inlining into the `.md` (bloats the file and poisons qmd embeddings,
  which embed chunk text verbatim).
- Image resize/optimisation.
- Preserving alt text inside the embed.

## CLI

New boolean option on `convert`:

```
--save-images   save referenced raster images beside the vault (--format obsidian only)
```

Default `false`. When `--save-images` is passed **without** `--format obsidian`,
log a warning and ignore it — mirroring the existing `--describe-images`
ignored-for-non-URL precedent (`cli.ts:175-177`). It is wired into a new
`RunPipelineOptions.saveImages` boolean.

## Module: `src/assets/`

Mirrors the structure of `src/vlm/`: a pure core, an IO shell, and a small stateful
store. Reuses `findImageRefs` from `src/vlm/select.ts` (already ignores refs inside
fenced code blocks).

### `store.ts` — `AssetStore`

Created once per `runPipeline` call, bound to the output dir. Holds only the
seen-hash set; it carries **no** stats (per-doc stats are owned by the core pass
and accumulated by `runPipeline`, mirroring the VLM stats handling).

```ts
class AssetStore {
  constructor(outputDir: string);
  // sha256(bytes) -> first 16 hex; filename = `<hash>.<ext>`.
  // One file per content hash for the whole run. Writes to
  // `<outputDir>/_assets/<hash>.<ext>` (skips the write when the hash was already
  // written this run, or the file already exists on disk).
  // `deduped` is true when no write happened (hash already present).
  save(bytes: Buffer, ext: string): { filename: string; deduped: boolean };
}
```

Content-hash filenames make every asset name unique, so the embed can reference
it by bare filename regardless of the note's directory depth, and identical images
across notes collapse to one file.

### `core.ts` — `rewriteImageRefs` (pure)

```ts
interface RewriteDeps {
  // Resolve image bytes + canonical extension for a ref's src.
  // Throws on any failure (network, missing file, bad data URI).
  resolve(src: string): Promise<{ bytes: Buffer; ext: string }>;
  // Persist bytes, return the bare filename to embed + whether it was a dedup.
  store(bytes: Buffer, ext: string): { filename: string; deduped: boolean };
}
function rewriteImageRefs(
  md: string,
  deps: RewriteDeps,
): Promise<{ md: string; stats: AssetStats }>;
```

For each ref that `findImageRefs` returns and `isSavable(src)` accepts: call
`resolve`, then `store`, then replace the whole `![alt](src)` match with
`![[<filename>]]`. Edits are collected and applied end → start so earlier offsets
stay valid (mirrors `describe.ts:104-110`). The returned `stats` is **per-doc**:
`saved`/`deduped` from each `store` result, `failed` when `resolve` throws (the
original ref is left untouched), `skipped` for refs that are not savable rasters.

`isSavable(src)` reuses the raster predicates from `select.ts`
(`RASTER_EXT` / `RASTER_DATA`).

### `index.ts` — `runAssetPass` (IO shell)

```ts
interface AssetPassOptions {
  fetchOpts: FetchOptions;
  // Local-source root, used only to reverse the docforge.invalid sentinel.
  // Undefined for URL sources.
  sourceRoot?: string;
}
function runAssetPass(
  md: string,
  docOrigin: string,        // item.srcUri: file:// for local, http(s):// for URL
  opts: AssetPassOptions,
  store: AssetStore,
): Promise<{ md: string; stats: AssetStats }>;
```

Wires `rewriteImageRefs` with a `resolve` that resolves the src against
`docOrigin` (`new URL(src, docOrigin)`) and dispatches on the resulting scheme:

- `data:` URI → decode (reuse `decodeDataUri` from `vlm/index.ts`); ext from MIME.
- `file:` → `fileURLToPath` + `readFileSync`; ext from the file path.
- `http(s):` real host → `fetchUrl(url, fetchOpts)`; ext from response MIME, else
  URL path.
- `http://docforge.invalid/...` sentinel (local HTML; `LOCAL_BASE` is injected as
  Defuddle's base in `runPipeline.ts:193`, so a relative `<img>` may be
  absolutized against it) → the pathname (leading `/` stripped) is the path
  **relative to the local source root**, because `LOCAL_BASE` is the root and the
  doc key is appended to it. Read from `join(sourceRoot, pathname)`. This is the
  only use of `sourceRoot`. When Defuddle instead leaves the src relative, the
  `file:` branch resolves it against `docOrigin` to the same on-disk file — both
  paths converge.

MIME → ext via a small fixed map (`image/png`→`png`, `image/jpeg`→`jpg`,
`image/webp`→`webp`, `image/gif`→`gif`, `image/bmp`→`bmp`). Query/hash suffixes
are stripped before deriving an ext from a path.

## Embed syntax

`![[<hash>.<ext>]]` — Obsidian wikilink embed by bare filename. Hash uniqueness
guarantees Obsidian resolves it from any note depth without relative-path math.
Alt text is dropped; when `--describe-images` also ran, the VLM caption block
already carries the description.

## Pipeline wiring (`runPipeline.ts`)

When `format === "obsidian" && opts.saveImages`, construct one `AssetStore` for
the run. The asset pass runs in **both** body-producing branches, **after** the
VLM pass:

- md-passthrough branch (`kind === "markdown" | "llms-full"`, URL-only): after
  building `md`, before `writeOutput`.
- HTML-convert branch: after the existing VLM block (`runPipeline.ts:223-239`),
  before `buildObsidianOutput`.

Ordering rationale: the VLM pass keeps the `![](src)` ref and appends a caption;
the asset pass then rewrites the ref's src to `![[ ]]`. The two edits target
different spans and coexist (the embed precedes its caption).

`docOrigin` is `item.srcUri` — a `file://` URL for local sources, an `http(s)`
URL for URL sources — so one resolver serves both. `sourceRoot` is computed once
for local sources (`lstatSync(fsPath).isFile() ? dirname(fsPath) : fsPath`,
matching `FilesystemSource`) and passed through `AssetPassOptions`; it is
`undefined` for URL runs.

## Stats & reporting

New `AssetStats { saved: number; deduped: number; skipped: number; failed: number }`.
Each `runAssetPass` returns per-doc stats; `runPipeline` sums them into a
run-level total (mirroring the vlm accumulation at `runPipeline.ts:230-234`),
exposed as `PipelineResult.assets` (present only when `saveImages`). Logged as a
one-line summary alongside the vlm line in `runConvert` (`cli.ts:197-202`):

```
images: saved=N deduped=N skipped=N failed=N
```

## Failure handling

A per-image resolve/read/fetch error never aborts the document: the original
`![](src)` ref is left intact, `failed` is incremented, and the error is logged at
debug/warn. Matches the VLM pass's swallow-per-image philosophy.

## Testing (TDD)

- **core** (`rewriteImageRefs`): single ref → `![[hash.ext]]`; multiple refs in
  one doc; refs inside fenced code blocks skipped; non-raster ref skipped; two
  refs with identical bytes share one filename (dedup); `resolve` failure leaves
  the original ref and counts `failed`.
- **store** (`AssetStore`): hash + ext → filename; identical bytes deduped (single
  write); file written under `_assets/`.
- **resolver** (`runAssetPass` deps): `data:` decode; `file://` read against a
  fixture PNG; `http(s)` fetch via a mock; `docforge.invalid` sentinel mapped to
  the source dir; MIME → ext mapping.
- **integration** (`runPipeline`): local HTML fixture containing
  `<img src="img/logo.png">` with `--format obsidian --save-images` → asset
  written under `_assets/` and the note contains the `![[ ]]` embed; `default`
  format → no assets dir; URL fixture via mock fetch; `--save-images` without
  `--format obsidian` → warning, no assets.

## Files touched

- `src/assets/store.ts` (new)
- `src/assets/core.ts` (new)
- `src/assets/index.ts` (new)
- `src/assets/types.ts` (new — `AssetStats`, dep interfaces)
- `src/vlm/select.ts` (export `RASTER_EXT`/`RASTER_DATA` or a shared `isSavable`)
- `src/runPipeline.ts` (construct store, run pass in both branches, surface stats)
- `src/cli.ts` (`--save-images` flag, validation/warn, stats log)
- `tests/` (unit + integration as above)
