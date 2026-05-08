# docforge

Convert documentation HTML to Markdown for RAG ingestion.

v1 scope: HTML only (Sphinx-shaped output works best). Office and other formats deferred.

## Install

```bash
uv tool install git+file:///home/igi21/experiements/docforge
docforge --help
```

## Usage

```bash
docforge ~/docs/some-corpus --output ~/docs/some-corpus-md
```

See `docforge --help` for all flags.

## Development

```bash
cd ~/experiements/docforge
uv venv .venv
uv pip install -e ".[dev]"
.venv/bin/pytest
```

## Design

See `docs/superpowers/specs/2026-05-08-docforge-design.md`.
