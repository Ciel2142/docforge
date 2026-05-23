# docforge VLM image description — design

**Date:** 2026-05-23
**Beads:** docf-i17
**Status:** approved, ready for implementation plan

## Problem

docforge converts documentation HTML to Markdown for qmd RAG ingestion, but it
throws away everything inside images. A `<img>` becomes `![alt](src)`, and on
real doc sites the alt-text is usually empty or a filename. Diagrams,
architecture figures, screenshots, and tables-rendered-as-images carry real
information that is then **invisible to the embedder** — qmd embeds text only,
so an image's content contributes nothing to retrieval.

There is no model in the pipeline today. The conversion path is deterministic
and golden-tested (`convertHtml` → Kreuzberg, `tests/`), and that property is
worth keeping.

## Goal

An **opt-in** pass that turns informative images into searchable prose in the
output Markdown, using a local OpenAI-compatible VLM (LM Studio on the user's
RTX 5090), **without** compromising the deterministic base pipeline. When the
flag is off, output is byte-identical to today.

This is a capability-push: the user has the GPU and wants the highest
value-per-effort use of a local model for their RAG corpus. Recovering content
that is currently 100% lost is that use; it is also the one thing only a VLM
can do.

## Decisions

Resolved during brainstorming:

1. **Direction — VLM image description.** Chosen over LLM retrieval enrichment
   (docf-1fi; riskier, can add embedding noise, partly designed already) and a
   VLM fallback extractor (high effort, non-deterministic, no broken corpora to
   justify it). Image description recovers content that is otherwise absent.

2. **Output format — caption block after the image.** Keep the image line;
   inject a delimited blockquote caption immediately after it:

   ```markdown
   ![alt](src)

   > **Figure — <alt or "image">.** <one-paragraph factual description,
   > transcribing any visible text/labels/axes/code>
   ```

   Rationale: the reference stays traceable and renders for humans, the
   description sits adjacent to the section so it embeds with that chunk, and
   the blockquote marks it as model-generated rather than source prose.
   Rejected: stuffing the description into alt-text (long alt is awkward,
   renderers truncate) and replacing the image with bare text (loses the source
   pointer).

3. **Scope v1 — URL sources only.** The pass runs only for crawled HTTP(S)
   sources. Image `src` resolves against the page URL and fetches through the
   existing HTTP client (reusing its disk cache and auth header). Local-file
   image resolution is deferred to a follow-up.

4. **Architecture — post-Markdown enrichment pass, outside the deterministic
   core.** Run after Kreuzberg produces the Markdown body, gated by an opt-in
   flag. Base-conversion goldens stay byte-stable because they only ever run
   with the flag off.

5. **Failure-safe and cached.** A model outage, timeout, or bad response skips
   that one image and warns; the document still converts. Descriptions are
   cached by image-bytes hash so repeated logos/diagrams are described once.

## Approach

**A `src/vlm/` module invoked from `runPipeline` on the converted Markdown body,
gated on an opt-in flag and an HTTP(S) source.**

The insertion point is `runPipeline.ts:190-196`, where the HTML branch has the
final body Markdown in hand:

```ts
const bodyMd = rewriteInternalLinks(result.body_md);
// NEW: optional VLM image-description pass (URL sources only)
const enrichedMd =
  opts.vlm && isHttpUrl(item.srcUri)
    ? await describeImages(bodyMd, {
        pageUrl: item.srcUri,
        fetch: opts.fetchOptions!, // already required for URL sources
        vlm: opts.vlm,
        signal,
      })
    : bodyMd;
const content = buildOutput(title, item.key, enrichedMd);
```

`opts.fetchOptions` is already mandatory for URL sources (`runPipeline.ts:63`),
so image fetches reuse the same cache directory, ETag revalidation, and
origin-scoped `Authorization` header that the crawl uses — no new HTTP plumbing.

**Alternatives considered and rejected:**

- *Pre-HTML `<img>` rewrite before Kreuzberg* — would let the VLM see the raw
  DOM, but couples the feature to Defuddle/Kreuzberg internals and makes it hard
  to keep the deterministic core cleanly separable. Operating on finished
  Markdown keeps the pass a true bolt-on.
- *A generic enrichment/plugin framework now* — YAGNI. v1 is one well-bounded
  function with a clean signature. LLM retrieval enrichment (direction B) can
  reuse the same hook later without a framework built up front.

## Design

### 1. Module layout (`src/vlm/`)

Mirrors the existing `src/http/` and `src/openapi/` structure.

| File | Responsibility |
|------|----------------|
| `types.ts` | `VlmOptions`, `ImageRef`, `DescribeStats` (`{ described, skipped, failed, cached }`) types |
| `select.ts` | Find Markdown image refs, apply skip heuristics |
| `client.ts` | OpenAI-compatible VLM call (chat/completions + image) |
| `cache.ts` | Disk cache of description by image hash |
| `describe.ts` | Orchestrates: select → fetch → cache/call → inject; returns rewritten MD + stats |

### 2. Pipeline hook (`src/runPipeline.ts`)

`RunPipelineOptions` gains one optional field:

```ts
export interface RunPipelineOptions {
  // ...existing...
  vlm?: VlmOptions;
}
```

The pass is invoked only on the HTML branch and only for HTTP(S) `srcUri`
(decision 3). The `markdown` / `llms-full` / `openapi` branches are untouched.
`describeImages` returns the rewritten body plus a `DescribeStats`
(`{ described, skipped, failed, cached }`) that is folded into the run report.

### 3. Image discovery + selection (`src/vlm/select.ts`)

Parse inline Markdown image refs `![alt](url)` (and `![alt](url "title")`) from
the body. **Skip refs inside fenced code blocks** so example Markdown is never
rewritten. HTML `<img>` passthrough (if Kreuzberg ever emits it) is a secondary
case to confirm at implementation time with a fixture.

Describe only **informative raster** images:

- **Eligible types:** `png`, `jpg`/`jpeg`, `webp`, `gif`, `bmp` (by URL
  extension or fetched content-type).
- **Skip cheaply, pre-fetch:** URL/filename hints —
  `icon`, `logo`, `sprite`, `badge`, `avatar`, `emoji`, `spacer`, `pixel`.
- **Skip after fetch:** `max(width, height) < vlmMinDim` (default 64px;
  decorative), and tiny `data:` URIs.
- **Cap:** at most `vlmMaxImages` per document (default 50) to bound runaway
  pages.
- **Deferred:** `SVG` (vector — needs rasterizing first). Noted as future work.

### 4. Source resolution + fetch (URL sources)

For each eligible ref, resolve `src` to bytes:

- Absolute `http(s)://` → fetch as-is.
- Relative → `new URL(src, pageUrl)` then fetch.
- `data:` URI → decode inline (no fetch).

Fetching reuses the existing HTTP client via `opts.fetchOptions` (cache + auth).
Non-200, non-image, or oversized responses are treated as "skip this image".

### 5. VLM client (`src/vlm/client.ts`)

A thin OpenAI-compatible `POST {baseUrl}/chat/completions` over `got` (already a
dependency — no new package). The image rides as a base64 data-URL content part:

```ts
{
  model: vlm.model,
  temperature: 0,
  max_tokens: 256,
  messages: [{
    role: "user",
    content: [
      { type: "text", text: `${PROMPT}\n\nContext:\n${context}` },
      { type: "image_url", image_url: { url: `data:${mime};base64,${b64}` } },
    ],
  }],
}
```

- **Prompt:** factual description; **transcribe all visible text** (labels,
  axes, legends, code, UI strings); **no speculation**; ≤ ~120 words; return
  prose only (no preamble).
- **Context fed in:** the nearest preceding heading, the original alt-text, and
  a short snippet of surrounding Markdown — improves grounding.
- **`Authorization: Bearer {vlm.apiKey}`** (LM Studio runs with
  `tokenMode: required`).
- Per-call timeout (default 60s). Output is trimmed and collapsed to a single
  paragraph before injection.

### 6. Caption injection (`src/vlm/describe.ts`)

Replace the matched image ref with the ref followed by the caption block from
decision 2. The label is the original alt-text, or `"image"` when alt is empty.
Description text is escaped/normalized so it cannot break the blockquote (no
stray newlines that would terminate the `>` block; collapse to one line or
re-prefix continuation lines with `> `).

### 7. Caching (`src/vlm/cache.ts`)

Disk cache via `keyv-file` (already a dependency), under
`{cacheDir}/vlm/` where `cacheDir` comes from `fetchOptions.cacheDir`
(default `~/.cache/docforge`). Key:

```
sha256(imageBytes) + ":" + vlm.model + ":" + PROMPT_VERSION
```

Hashing the bytes (not the URL) means the same logo reused across hundreds of
pages — or the same diagram served from two URLs — is described once.
`PROMPT_VERSION` is a constant bumped when the prompt changes, invalidating
stale descriptions.

### 8. Concurrency + failure handling

- **Concurrency:** a `p-queue` (already a dependency) bounds in-flight VLM calls;
  default 2 (a single GPU is near-serial). Image fetches use the existing crawl
  concurrency.
- **Failure-safe:** any error fetching, decoding, or describing an image →
  log a `warn`, leave that image ref untouched, increment `failed`/`skipped`,
  continue. **The pass never throws into the document conversion.**

### 9. Config surface

`--describe-images` is the on switch; `--vlm-base-url` and `--vlm-model` are
required when it is set. CLI `convert` flags:

| Flag | Env fallback | Default |
|------|--------------|---------|
| `--describe-images` | — | off |
| `--vlm-base-url <url>` | `DOCFORGE_VLM_BASE_URL` | — (required when on) |
| `--vlm-model <name>` | `DOCFORGE_VLM_MODEL` | — (required when on) |
| `--vlm-api-key <key>` | `DOCFORGE_VLM_API_KEY` | — |
| `--vlm-min-dim <px>` | — | 64 |
| `--vlm-max-images <n>` | — | 50 |

If `--describe-images` is set but base-url/model are missing, fail fast with a
clear error (do not silently no-op). For the MCP `convert` tool the VLM
endpoint, model, and key come from the **server environment**
(`DOCFORGE_VLM_BASE_URL` / `DOCFORGE_VLM_MODEL` / `DOCFORGE_VLM_API_KEY`), not
from tool arguments, so the API key never enters the tool-call transcript. The
tool exposes only a `describe_images` boolean plus `vlm_min_dim` /
`vlm_max_images` overrides; `describe_images=true` with no server VLM configured
returns `INVALID_ARGS`. Off by default. The two OpenAPI entry points are
untouched (specs have no images).

### 10. Reporting

`PipelineResult` carries the aggregate `DescribeStats`. End-of-run log line:
`vlm: described=N skipped=M failed=K (cache hits=H)`. Per-document failures stay
non-fatal and are summarized, not fatal report entries.

## Security

- API key comes from env/flag, is sent only as the `Authorization` header to the
  configured VLM endpoint, and is never logged.
- Image bytes are sent only to the configured endpoint (the user's own LAN LM
  Studio). The doc-site `Authorization` header (for fetching images) stays
  origin-scoped by the existing `fetchUrl` gate and is never forwarded to the
  VLM endpoint.
- No image bytes or descriptions are written anywhere except the cache dir and
  the output Markdown.

## Testing

- **Base goldens unchanged.** All existing conversion tests run with the flag
  off and must stay byte-identical.
- **Mocked VLM client.** A deterministic stub returns canned descriptions. Unit
  tests cover: image-ref discovery (incl. ignoring fenced code blocks), each
  skip heuristic (extension, filename hint, min-dim, max-images cap), URL/data
  resolution, caption-block injection format, cache hit vs miss, and the
  failure path (stub throws → image untouched, doc still converts, stats
  incremented).
- **One fixture** confirming Kreuzberg preserves `![alt](src)` for a real
  `<img>` so the post-MD assumption holds.
- **Optional manual smoke** against real LM Studio (documented, not in CI).

## Future work (out of scope for v1)

- Local-file image sources (resolve `src` against the source file directory).
- SVG support (rasterize, or pass SVG source to a text LLM).
- LLM retrieval enrichment (direction B / docf-1fi) reusing this hook.
- Alt-text quality gate: skip the VLM call when alt-text is already rich.
- Per-run cost/time budget cap across all images.

## Prerequisite (infra, not code)

A **vision-capable** model must be loaded in LM Studio (e.g. Qwen2.5-VL-7B or
-32B). The existing `text-embedding-qwen3-embedding-8b` cannot do this. Output
is **not byte-reproducible** with the flag on — VLMs are not deterministic even
at temperature 0; the cache makes output *stable within a cache lifetime*, not
reproducible across cache clears. This is acceptable for an opt-in enrichment
pass and is stated, not hidden.
