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
