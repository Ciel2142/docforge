# docforge

Convert documentation HTML and OpenAPI specs to Markdown for RAG ingestion.

v0.6.0 scope: HTML (Sphinx, Material for MkDocs, Docusaurus, VitePress,
GitHub-flavoured Markdown, mdBook, bare HTML5) + OpenAPI 3.x JSON/YAML.

## Install

```bash
git clone https://github.com/<you>/docforge   # or local path
cd docforge
npm install
npm run build
npm install -g .
docforge --help
```

## Usage

```bash
docforge convert ~/docs/some-corpus --output ~/docs/some-corpus-md
docforge openapi ./api.yaml --output ./api-md
```

See `docforge --help` and `docforge <command> --help` for all flags.

### URL sources

`<source>` and `<spec>` accept HTTP(S) URLs. For `convert`, docforge attempts
sitemap discovery first (robots.txt `Sitemap:` directives, then `/sitemap.xml`,
then `/sitemap_index.xml`) and falls back to a BFS crawl bounded by
`--max-pages` / `--max-depth` and the seed origin. `robots.txt` is honored.

```bash
docforge convert https://docs.example.com/ --output ./md
docforge openapi https://api.example.com/openapi.yaml --output ./api-md
```

URL-only flags: `--max-pages` (5000), `--max-depth` (10), `--concurrency` (4),
`--cache-dir` (`~/.cache/docforge`), `--no-cache`, `--user-agent`.

Responses are cached on disk with ETag/Last-Modified revalidation so repeat
runs are cheap.

### Body extraction

docforge uses [Defuddle](https://github.com/kepano/defuddle) to find the
primary article content on each page. Defuddle ranks class-name evidence
(`#post`, `.markdown-body`, `.md-content__inner`, `.theme-doc-markdown`,
`.vp-doc`, ...) above semantic landmarks (`<main>`, `<article>`,
`[role="main"]`) and falls back to scoring-based detection. The same picker
works for Sphinx, Material for MkDocs, Docusaurus, VitePress, GitHub-flavoured
Markdown, mdBook, and bare HTML5 pages out of the box.

Override per run with `--selector <css>` when the picker chooses the wrong
element on a specific site. Use `--format <default|obsidian>` to switch the
output shape (see [Output formats](#output-formats) below).

### Image description (VLM)

Documentation images — diagrams, screenshots, figures — are normally lost in the
HTML→Markdown conversion (only weak alt-text survives). With `--describe-images`,
docforge sends each informative raster image to a local OpenAI-compatible VLM
(e.g. LM Studio serving Qwen2.5-VL) and injects a caption block after the image:

```` markdown
![Architecture overview](arch.png)

> **Figure — Architecture overview.** A load balancer routes traffic to three
> API nodes, each reading from a shared Postgres primary with one read replica.
````

This is an opt-in, **URL-source-only** pass. It runs outside the deterministic
conversion core: with the flag off, output is byte-identical to before. Image
fetches reuse the crawl's cache and auth; descriptions are cached by image hash
so repeated logos/diagrams are described once. A model outage skips the image
and warns — the document still converts.

```bash
docforge convert https://docs.example.com/ --output ./md \
  --describe-images \
  --vlm-base-url http://192.168.1.114:1234/v1 \
  --vlm-model qwen2.5-vl-7b-instruct \
  --vlm-api-key "$LMSTUDIO_TOKEN"
```

Flags: `--describe-images`, `--vlm-base-url` (env `DOCFORGE_VLM_BASE_URL`),
`--vlm-model` (env `DOCFORGE_VLM_MODEL`), `--vlm-api-key`
(env `DOCFORGE_VLM_API_KEY`), `--vlm-min-dim` (default 64),
`--vlm-max-images` (default 50), `--vlm-concurrency` (default 2). SVG and
local-file sources are not yet supported.

**Prerequisite:** a vision-capable model must be loaded in the endpoint; an
embedding-only model cannot describe images. Output is not byte-reproducible
with this flag on (VLMs are not deterministic); the cache makes it stable within
a cache lifetime.

For the MCP `convert` tool, the VLM endpoint/model/key are read from the server
environment (`DOCFORGE_VLM_*`); the tool exposes only `describe_images`,
`vlm_min_dim`, and `vlm_max_images` so the key never enters the transcript.

### llms-full.txt shortcut

When a site publishes an [llms-full.txt](https://llmstxt.org/) at its root,
docforge can fetch that single file instead of crawling the HTML site.
Enabled by default for URL sources; control with `--llms-full <mode>`:

- `auto` (default): probe `<origin>/llms-full.txt` first; fall back to HTML
  crawl if absent.
- `force`: require the file; exit with an error if missing.
- `off`: skip the probe entirely.

The output filename is `llms-full.md` (the body is written verbatim after
internal-link rewriting; no Defuddle, no Kreuzberg).

### Output formats

`--format default` (the default) emits RAG-friendly Markdown: a `# Title` line, a
`Source:` provenance line, and relative `.md` links — tuned for embedding/qmd.

`--format obsidian` emits Obsidian-vault Markdown instead:

- Provenance moves into YAML frontmatter (`title`, `source`).
- Internal links become vault-relative `[[wikilinks]]` (slug anchors are dropped,
  since Obsidian heading links need literal heading text).
- Images and external links are left as standard Markdown (unless `--save-images`
  is also passed — see below).

Add `--save-images` to copy referenced raster images (png/jpg/webp/gif/bmp) into
`<output>/_assets/` and rewrite each image reference as an Obsidian `![[embed]]`
link. Default off; no effect without `--format obsidian`.

```bash
docforge convert ~/docs/some-corpus --output ~/vault/some-corpus \
  --format obsidian --save-images
```

OpenAPI output, callouts, and embedding-based related-notes are not covered by
`--format obsidian` (see the design spec).

## Development

```bash
cd ~/experiements/docforge
npm install
npm test
npm run typecheck
npx tsx src/bin.ts convert tests/fixtures --output /tmp/out
```

## MCP server

docforge ships a stdio MCP server that exposes three tools — `convert`,
`convert_openapi`, and `list_corpora` — so coding agents (Claude Code,
Cursor, etc.) can convert docs to Markdown on demand.

### Install

After `npm run build && npm install -g .`, the `docforge-mcp` binary is on
your `PATH` alongside `docforge`.

### Configure

The server needs one required env var:

- `DOCFORGE_QMD_ROOT` — base directory where converted corpora are written
  (one subdirectory per collection). Auto-created on first start if the parent directory is writable.

Optional env vars: `DOCFORGE_CACHE_DIR`, `DOCFORGE_USER_AGENT`,
`DOCFORGE_MAX_PAGES`, `DOCFORGE_MAX_DEPTH`, `DOCFORGE_CONCURRENCY`.

### Claude Code example

Add to your `mcpServers` config:

```jsonc
{
  "mcpServers": {
    "docforge": {
      "command": "docforge-mcp",
      "env": {
        "DOCFORGE_QMD_ROOT": "/home/you/qmd/collections"
      }
    }
  }
}
```

### Tools

- **`convert(url, corpus?, kind?, llms_full?, llms_index?, selector?, exclude_hosts?, ...)`** —
  fetch a URL and write Markdown under `$DOCFORGE_QMD_ROOT/<collection>/`.
  Detects llms-full.txt by default, then llms.txt (curated index), falls
  back to single-page or site crawl. Returns the first-page Markdown
  preview, on-disk collection path, per-page listing, and any extraction
  warnings.
  `kind` accepts `auto` (default), `page`, `site`, `llms-full`, or
  `llms-index`. `kind=page` fetches the seed URL only (skipping sitemap
  discovery). `kind=llms-index` fetches every link in `/llms.txt`, writing
  one file per link under `<host>/<path>.md` so cross-origin links never
  collide. Markdown links (`text/markdown`) pass through verbatim;
  HTML links are converted via Defuddle.
  `exclude_hosts: string[]` skips URLs whose host matches any entry —
  exact match or `.suffix` (so `"linkedin.com"` also skips
  `www.linkedin.com`). Useful for dropping social/community URLs commonly
  listed in llms.txt: `["linkedin.com","discord.gg","twitter.com"]`.
- **`convert_openapi(source, is_inline?, format?, corpus?, ...)`** — same
  shape, accepts either a spec URL or an inline JSON/YAML string.
- **`list_corpora(filter?)`** — enumerate `.docforge.json` manifests under
  the root. Useful for "do I already have docs for this site?" before
  re-crawling.

Collection names are derived from the URL host + first path segment
(slugified), with OpenAPI `info.title` preferred when present. Override
with `corpus`. Re-running with the same `corpus` against a different
source returns `SOURCE_MISMATCH` unless you pass `force_refresh=true`.

See `docs/superpowers/specs/2026-05-11-docforge-mcp-design.md` for full
schema and error-envelope reference.

## Design

See `docs/superpowers/specs/2026-05-09-docforge-typescript-rewrite-design.md`.
