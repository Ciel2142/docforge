# Obsidian output format (`--format obsidian`)

**Date:** 2026-05-24
**Status:** Approved (design)
**Scope:** Add an Obsidian-flavoured Markdown output mode to docforge's conversion pipeline.

## Summary

docforge converts documentation sources to Markdown for RAG ingestion. Its
current output is a fixed "inline-provenance" shape tuned for qmd embedding:

```
# Title

Source: <relpath-or-url>

<body…>
```

with internal links kept as relative `.md` links.

This feature adds a second output flavour, selected with `--format obsidian`,
that emits Markdown suited to an Obsidian vault instead: provenance moves into
YAML frontmatter (Obsidian Properties) and internal links become `[[wikilinks]]`.
The existing format remains the default and is unchanged.

## Motivation

The RAG/qmd format and an Obsidian vault want different things from the same
converted content:

- **Provenance:** qmd reads an inline `Source:` line; Obsidian reads YAML
  frontmatter properties.
- **Links:** RAG output keeps relative `.md` links; Obsidian uses `[[wikilinks]]`
  to drive backlinks and the graph view.

Rather than post-processing docforge output with a separate tool, the format is
selected at conversion time so a single run produces a ready-to-open vault.

## Non-goals

- **OpenAPI output** — the `openapi` command has its own multi-file pipeline
  (`src/openapi/pipeline.ts`); re-flavouring it is deferred to separate work.
- **Callouts** — mapping admonitions to `> [!note]` is lossy. Kreuzberg flattens
  HTML admonitions to plain blockquotes/text before docforge sees them, so
  reliable detection is not available. Out of scope.
- **Image embeds** — `![[image]]` only makes sense once images are downloaded
  into the vault. docforge keeps remote image references; localisation is not
  part of this work. Standard `![alt](url)` Markdown is left untouched.
- **Related-notes via embeddings** — computing semantically-related `[[links]]`
  is a cross-corpus embedding + similarity pass that runs after conversion and
  introduces an embedding dependency. Tracked as its own future spec, not here.

## Design

### Approach

A format flag selects the renderer at the existing output stage in
`runPipeline`. No renderer abstraction is introduced — there are two formats, so
a branch is sufficient. (If a third format ever lands, extract a `Renderer`
interface then; not before.)

- New CLI/MCP option: `--format <default|obsidian>`, default `default`
  (current behaviour, fully backward compatible).
- New option field: `RunPipelineOptions.format?: "default" | "obsidian"`.
- New module `src/obsidian.ts` with two pure functions:
  - `buildObsidianOutput(title, source, bodyMd): string`
  - `toObsidianWikilinks(md, fromRelpath): string`
- At each render site in `runPipeline`, branch on `format`.

### 1. Frontmatter

In `obsidian` mode, the inline `Source:` line is replaced by YAML frontmatter:

```yaml
---
title: "Page Title"
source: https://docs.example.com/guide/page
---

# Page Title

<body…>
```

- `title` — from the existing `extractTitle()` result. YAML-safe: wrap in double
  quotes and escape any embedded `"` and `\`.
- `source` — the document's canonical source URI: the full URL for URL sources,
  the source-relative path for filesystem sources. (Use `item.srcUri`; this may
  read more fully than the default format's `Source:` line, which passes
  `item.key` — acceptable, they are different formats.)
- The body's `# Title` H1 is **kept** (content fidelity; Obsidian tolerates a
  frontmatter `title` alongside an H1).
- Fields are limited to `title` and `source`. No `date`, `aliases`, or `tags` —
  there is no reliable source for them and adding speculative fields is YAGNI.

`buildObsidianOutput` mirrors the responsibility of the current `buildOutput`
(`src/output.ts`): take title + source + body, return the file contents. It does
**not** rewrite links — link rewriting is a separate step (below) so the two
concerns stay independent and unit-testable.

### 2. Wikilinks — `toObsidianWikilinks(md, fromRelpath)`

Converts internal Markdown links to Obsidian wikilinks. `fromRelpath` is the
output path of the current document relative to the output root (e.g.
`guide/page.md`), needed to resolve relative link targets to vault-relative
paths.

**Rule.** For a Markdown link `[text](relTarget)` where `relTarget` is an
internal target ending in `.md` or `.html`, optionally with a `#anchor`:

1. Resolve `relTarget` against `dirname(fromRelpath)` → vault-relative path.
2. Strip the `.md` / `.html` extension; drop any `#anchor`; use POSIX `/`
   separators.
3. Emit `[[vaultpath|text]]`. If the link is an autolink (`<a.html>`) or `text`
   equals the target's basename, emit `[[vaultpath]]` (no alias).

```
doc at guide/page.md:
  [Install guide](../setup/index.md#install-foo)
→ [[setup/index|Install guide]]
```

**Anchor handling.** The `#anchor` is dropped. docforge's anchors are slugs
(`#install-foo`), but Obsidian heading links require the literal heading text
(`#Install Foo`). A slug will not resolve, so the note-level link is kept and the
anchor discarded — predictable, never a broken subpath.

**Edge cases:**

- **Images** `![alt](img)` — not touched (negative lookbehind on `!`). Image
  embeds are out of scope; standard image Markdown is preserved.
- **External / non-internal** — `http(s)://`, `//`, `mailto:`, and bare `#`
  targets are left as standard Markdown links.
- **Above-root targets** — if a target resolves above the vault root (e.g.
  `../../x` from a top-level doc), it cannot be represented as a vault path; leave
  the original link untouched and log at debug level.
- **Supersedes `rewriteInternalLinks`** — `toObsidianWikilinks` handles both
  `.html` and `.md` internal targets in a single pass and emits wikilinks
  directly. In `obsidian` mode it runs **instead of** `rewriteInternalLinks`
  (`src/links.ts`), not in addition, to avoid double processing.

### 3. Pipeline integration (`src/runPipeline.ts`)

`fromRelpath` is computed once per item at the render site as
`relative(opts.outputDir, outPath)` (POSIX-normalised), then passed to
`toObsidianWikilinks`.

Two render sites change, both gated on `opts.format === "obsidian"`:

1. **`markdown` / `llms-full` passthrough** (currently
   `stripHeadingAnchors(rewriteInternalLinks(...))`, written verbatim with no
   provenance header): in obsidian mode, run `toObsidianWikilinks` for link
   rewriting (still strip heading anchors), then wrap with `buildObsidianOutput`
   using `title = stem` and `source = item.srcUri`. This makes passthrough items
   proper vault notes with frontmatter, consistent with converted pages.

2. **HTML convert path** (currently
   `bodyMd = rewriteInternalLinks(result.body_md)` then
   `content = buildOutput(title, item.key, bodyMd)`): in obsidian mode, use
   `bodyMd = toObsidianWikilinks(result.body_md, fromRelpath)` and
   `content = buildObsidianOutput(title, source, bodyMd)`. The VLM pass, if
   enabled, runs on `bodyMd` exactly as today (it touches image refs, which the
   wikilink transform leaves alone — order is independent).

The `openapi` branch is untouched (non-goal).

### 4. CLI (`src/cli.ts`)

- Add `.option("--format <fmt>", "output format: default|obsidian", "default")`.
- Validate the value is one of `default` / `obsidian`; otherwise exit non-zero
  with a clear message (consistent with existing flag validation).
- Thread `format` into `RunPipelineOptions`.

### 5. MCP convert tool (`src/mcp/server.ts`)

- Add an optional `format` argument to the `convert` tool input schema (enum
  `default` | `obsidian`, default `default`), mirroring the CLI flag.
- Thread it into the `runPipeline` call.
- `openapi`-related MCP tools are untouched.

## Testing

- **`tests/obsidian.test.ts`** (unit):
  - `buildObsidianOutput`: frontmatter shape; `"`/`\` escaping in title; body
    and H1 preserved.
  - `toObsidianWikilinks`: relative-path resolution to vault path; anchor drop;
    autolink → aliasless `[[…]]`; alias retained when text differs from basename;
    image links skipped; external/`mailto`/`#` links skipped; above-root target
    left untouched.
- **CLI e2e** (extend existing CLI test style): run `--format obsidian` over a
  small fixture directory; assert output contains YAML frontmatter and at least
  one `[[wikilink]]`, and that an image link is unchanged.
- **Backward compatibility:** with no `--format` flag (or `--format default`),
  output is byte-identical to current behaviour; existing goldens and tests stay
  green.

## Backward compatibility

`--format` defaults to `default`, which is the current code path. No existing
output changes. The new module and branches are additive.

## Future work

- Obsidian output for the `openapi` pipeline.
- Related-notes `[[links]]` via cross-corpus embeddings (own spec).
- Optional image localisation enabling `![[embeds]]`.
