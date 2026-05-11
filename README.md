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
element on a specific site.

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

## Development

```bash
cd ~/experiements/docforge
npm install
npm test
npm run typecheck
npx tsx src/bin.ts convert tests/fixtures --output /tmp/out
```

## Design

See `docs/superpowers/specs/2026-05-09-docforge-typescript-rewrite-design.md`.
