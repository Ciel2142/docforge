# docforge

Convert documentation HTML and OpenAPI specs to Markdown for RAG ingestion.

v0.4.0 scope: HTML (Sphinx-shaped output works best) + OpenAPI 3.x JSON/YAML.

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
