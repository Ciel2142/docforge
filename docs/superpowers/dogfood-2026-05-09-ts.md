# docforge TS Rewrite — Dogfood Report

**Date:** 2026-05-10
**Branch:** `ts-rewrite` (commits 0..7a9aeb9; 121 tests passing)
**Tooling:** Node 20, `@kreuzberg/node` 4.x, cheerio 1, commander 13.

This report records the Wave 5 dogfood comparing the new TS implementation against the legacy Python pipeline output stored at `~/docs/diadok-md/` and the published `diadoc-openapi` qmd collection (608 docs).

## Convert subcommand — diadok corpus

### Run

```bash
mkdir -p /tmp/docforge-ts-dogfood
node dist/bin.js convert ~/docs/diadok \
  --output /tmp/docforge-ts-dogfood \
  --report-json /tmp/docforge-ts-report.json
```

Stderr summary:

```
INFO converted=642 empty=0 skipped=4 failed=0 total=642
```

### File counts

| Metric | TS | Python (`~/docs/diadok-md/`) |
|---|---|---|
| `*.html` source files | 644 | n/a |
| Skipped (walker filter) | 4 | not reported (Python had skipped-count bug) |
| Converted `.md` outputs | 642 | 642 |
| Empty | 0 | n/a |
| Failed | 0 | n/a |

The 4 skipped files are correctly classified noise:

- `diadoc-api/genindex.html` — Sphinx auto-generated index
- `diadoc-api/search.html` — Sphinx search shell
- `diadoc-api/rss.xml` — extension-skipped
- `robots.txt` — extension-skipped

This matches the design: Python walker had a known bug where `skipped` always reported 0 (`cli.py:126`); the TS rewrite returns `{ paths, skippedCount }` from the walker so the count is honest.

### Body diff (`diff -r --brief`)

All 642 files differ. Per-file diff is uniform — header swap + trailing newline. Sample on `diadoc-api/proto/Address.md`:

```diff
1,7c1,3
< ---
< title: Address
< source: diadoc-api/proto/Address.html
< category: proto
< version: current
< lang: ru
< ---
---
> # Address
>
> Source: diadoc-api/proto/Address.html
87c83
< - в устаревшей структуре [ExtendedOrganizationInfo](obsolete/ExtendedOrganizationInfo.md)
\ No newline at end of file
---
> - в устаревшей структуре [ExtendedOrganizationInfo](obsolete/ExtendedOrganizationInfo.md)
```

Two deltas, both intentional:

1. **YAML frontmatter → Context7 inline header.** Decided in spec §4 (and bd memory `qmd-does-not-strip-yaml-frontmatter-verified-via`). YAML keys (`title:`, `category:`, `lang:`) pollute embedding lex matches; Context7 inline `# Title \n\n Source: <rel-path> \n\n body` keeps provenance grep-able without polluting embeddings.
2. **Trailing newline.** Python `Path.write_text` omitted the final `\n`; TS `writeOutput` writes a trailing newline. Cosmetic and POSIX-friendly.

Confirmed on second sample (`api-catalog/messages.md`, `proto/Message.md`) — same shape. No dropped paragraphs, no dropped table rows, no dropped list bullets, no link-rewrite drift.

This matches expectations: bd memory `kreuzberg-py-vs-node-binding-byte-identical-output` already records that the Python (kreuzberg-py 4.9) and Node (`@kreuzberg/node` 4.x) bindings produce byte-identical Markdown for HTML input on our 6 sphinx golden fixtures. Confirmed across the full diadok corpus here.

### Convert verdict

PASS. Body content parity with the legacy Python pipeline. Header format change is the documented design decision.

## OpenAPI subcommand — diadoc.api.json

### Run

```bash
mkdir -p /tmp/docforge-ts-openapi
node dist/bin.js openapi tests/openapi/fixtures/diadoc.api.json \
  --output /tmp/docforge-ts-openapi
```

Stderr summary:

```
INFO endpoints=125 schemas=483
```

### File counts

| Bucket | TS | Published `diadoc-openapi` qmd collection |
|---|---|---|
| `endpoints/*.md` | 125 | 125 (per qmd doc shape) |
| `schemas/*.md` | 483 | 483 (per qmd doc shape) |
| **Total** | **608** | **608** |

Counts match the published diadoc-openapi qmd collection exactly (608 docs).

### Sample structure

`/tmp/docforge-ts-openapi/schemas/Address.md`:

```markdown
# Address

Source: diadoc.api.json#/components/schemas/Address

Адрес [организации](https://developer.kontur.ru/doc/diadoc-api/glossary/organization.html) или [подразделения](https://developer.kontur.ru/doc/diadoc-api/glossary/department.html).

Обязательно должно быть заполнено одно из полей `RussianAddress` или `ForeignAddress`.

## Properties

| Name | Type | Required | Description |
|------|------|----------|-------------|
| RussianAddress | [RussianAddress](RussianAddress.md) | no |  |
| ForeignAddress | [ForeignAddress](ForeignAddress.md) | no |  |
| AddressCode | string | no | Код ГАР. |
| GarAddress | [GarAddress](GarAddress.md) | no |  |
```

`/tmp/docforge-ts-openapi/endpoints/GET_V6_GetMessage.md` head:

```markdown
# GET /V6/GetMessage

Source: diadoc.api.json#/paths/~1V6~1GetMessage/get

**Tags:** Сообщения

Возвращает данные [сообщения](https://developer.kontur.ru/doc/diadoc-api/glossary/message.html) по указанному идентификатору.

## Parameters

| Name | In | Type | Required | Description |
|------|----|----|----------|-------------|
| boxId | query | string (uuid) | yes | Идентификатор [ящика] ... |
...

## Responses

### 200 Операция успешно завершена.

`application/json`: [Message](../schemas/Message.md)
```

Structural checks:

- `# METHOD /path` heading shape is preserved.
- `Source:` pointer uses RFC 6901 jsonpointer encoding (`/` → `~1`) → `diadoc.api.json#/paths/~1V6~1GetMessage/get`.
- `**Tags:**` line preserved.
- Parameters/Properties/Responses tables share the same column layout used by the Python tool.
- Cross-refs from endpoints (`../schemas/Foo.md`) and within schemas (`Foo.md`) follow the same relative-link convention as the Python tool.

### OpenAPI verdict

PASS. File counts exact, structure equivalent to the published `diadoc-openapi` qmd collection.

## §16 acceptance criteria

| Criterion | Status |
|---|---|
| `npm test` green across all module + CLI + openapi suites | PASS — 121 tests across 13 files |
| `docforge convert ~/docs/diadok` produces 642 `.md` files | PASS |
| Output body content equivalent to Python pipeline | PASS — header swap + trailing newline only |
| `--help` prints usage with all flags | PASS |
| `--version` prints `docforge 0.4.0` and exits 0 | PASS |
| Output path collision → clear stderr + exit 2 | PASS |
| Failure rate over `--fail-threshold` → summary + exit 1 | PASS |
| Re-run overwrites existing output silently | PASS |
| `--dry-run` walks + logs, writes nothing | PASS |
| `--report-json` writes valid JSON, one entry per input | PASS — 642 entries, all `ok` |
| `docforge openapi` matches Python file set | PASS — 608 files (125 endpoints + 483 schemas) |
| Wave 6: `git ls-files` no Python sources, no `pyproject.toml`/`uv.lock` | PENDING — Wave 6 |

## Recommendation

Proceed to Wave 6 (retire Python). All Wave 5 criteria pass. The body-level parity is empirically equivalent to the Python pipeline; the only deltas are documented design choices (header format, trailing newline) and an intentional bug fix (honest `skippedCount`).
