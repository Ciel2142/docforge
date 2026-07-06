# docforge: seed path-prefix crawl scoping

- **Date:** 2026-07-06
- **Status:** Approved (design)
- **Bead:** docf-sxe
- **Origin:** crawl-improvement brainstorming (2026-07-06). Three pains identified (corpus scoping/noise, JS-rendered sites, native-markdown fidelity); scoping picked first — smallest change, cleans every future crawl.

## Problem

A URL-source crawl is bounded by **origin only**:

- `iterFromSitemap` (`src/source.ts`) keeps every sitemap URL on the seed's origin. Seeding `https://example.com/docs/` fetches the whole site — blog, marketing, changelog — because `/sitemap.xml` lists everything.
- `crawlBfs` (`src/http/crawl.ts`) admits any same-origin link, so BFS wanders out of `/docs/` through nav/footer links.

Out-of-scope pages waste the `--max-pages` budget and land as noise in the RAG corpus.

## Goal

Seed path implies crawl scope: `https://example.com/docs/` crawls only `/docs/**`, in both sitemap and BFS modes. Default on; `--scope origin` restores whole-origin behavior. Root seeds behave exactly as today.

## Non-goals

- Include/exclude URL glob patterns (`--exclude '/blog/**'`) — not requested yet; the scope predicate is the extension point if ever needed.
- Cross-subdomain host allowlist.
- Locale/version dedup heuristics (`/ja/`, `/v1/`).
- Scoping `llms-full` / `llms-index` modes (single file / curated cross-origin index — scope does not apply).
- Redirect-target scoping: scope is checked at frontier admission (the requested URL), not on the post-redirect final URL.

## Decisions

| Decision | Value | Rationale |
|---|---|---|
| Default | ON (`--scope path`) | Matches user expectation (wget `--no-parent` precedent); corpus noise is the bug being fixed |
| Escape hatch | `--scope origin` | Restores current whole-origin behavior per run |
| Extensionless seed (`/docs`) | Treated as directory → prefix `/docs/` | Common seed form; strict dirname would silently mean whole-origin |
| Seed with file extension (`/docs/intro.html`) | dirname → prefix `/docs/` | wget `--no-parent` semantics |
| Root seed (`/`) | Prefix `/` → unrestricted | Backward compatible; scoping a root seed is a no-op |
| Empty in-scope sitemap | Fall back to BFS | Sitemap listing only out-of-scope pages must not yield an empty corpus |
| Match rule | `pathname.startsWith(prefix)` + exact-seed admit | `startsWith("/docs/")` rejects `/docsother`; `/docs` itself admitted when prefix is `/docs/` |

## Design

### 1. Prefix derivation — `src/http/url.ts`

```ts
export function scopePrefixFromSeed(seedUrl: string): string | null;
```

On the `normalizeUrl`-normalized seed (query/hash already stripped):

1. Path ends with `/` → prefix is that path (`/docs/` → `/docs/`).
2. Last segment contains a `.` (file extension, e.g. `/docs/intro.html`) → prefix is dirname + `/` (`/docs/`). Applies to any dotted segment — a seed like `/docs/v1.2` also scopes to `/docs/` (erring wider never loses pages; a version-pinned crawl can use a trailing slash: `/docs/v1.2/`).
3. Extensionless last segment (`/docs`) → prefix is path + `/` (`/docs/`).
4. Result `/` (root seed) → return `null` (unrestricted).

Returns `null` for invalid URLs (caller has already validated; defensive).

### 2. Matching — `src/http/url.ts`

```ts
export function underScope(url: string, prefix: string): boolean;
```

Normalize `url`; admit when `pathname.startsWith(prefix)` **or** `pathname + "/" === prefix` (the extensionless seed page itself). Case-sensitive, per URL path semantics. Origin is NOT checked here — `sameOrigin` / sitemap origin filtering stays where it is.

### 3. Wiring

`CrawlOptions` (`src/http/crawl.ts`) gains:

```ts
scopePrefix?: string; // undefined = unrestricted (scope=origin or root seed)
```

- **BFS** (`crawlBfs`): link admission adds `underScope(link, scopePrefix)` after the `sameOrigin` check, before the robots check (cheap string test first). Seed is in scope by construction.
- **Sitemap** (`HttpSource.iter`, `src/source.ts`): filter the `discoverSitemaps` result by scope **before** the `sitemapUrls.length > 0` mode decision, so an all-out-of-scope sitemap falls through to BFS. Origin/robots filtering inside `iterFromSitemap` unchanged; the pre-filter also runs before the `maxPages` slice, so the page budget is spent on in-scope URLs only.
- **Untouched paths:** `singlePage`, `llms-full`, `llms-index`.

### 4. CLI — `src/cli.ts`

`--scope <mode>` on `convert`, choices `path` | `origin`, default `path`. URL-source only (ignored for filesystem sources, like the other crawl flags). `scope=path` → `scopePrefix = scopePrefixFromSeed(seed) ?? undefined`; `scope=origin` → `undefined`.

### 5. MCP — `src/mcp/tools/convert.ts`

Optional `scope?: "path" | "origin"` arg, default `"path"`, threaded to `CrawlOptions` identically. Schema + tool description note the default and the `origin` escape hatch. Applies to `kind=site`/`auto`-resolved-to-site only (page/llms kinds unaffected).

### 6. Docs

README "URL sources" section: one paragraph + flag listing. MCP tool docs line for `scope`.

## Error handling

- Invalid `--scope` value → commander `choices` rejection (exit 2, usage message).
- No new runtime failure modes: empty in-scope sitemap degrades to BFS; a BFS whose seed page fails to fetch behaves as today (error item, empty crawl).

## Testing (TDD)

| Case | Expectation |
|---|---|
| `scopePrefixFromSeed`: `/`, `/docs/`, `/docs`, `/docs/intro.html`, `/a/b/c` | `null`, `/docs/`, `/docs/`, `/docs/`, `/a/b/c/` |
| `underScope`: `/docs/x` vs `/docs/` | true |
| `underScope`: `/docsother` vs `/docs/` | false |
| `underScope`: `/docs` vs `/docs/` | true (exact-seed admit) |
| BFS fixture site, seed `/docs/`, links to `/docs/a` + `/blog/b` | only `/docs/**` fetched |
| Sitemap listing `/docs/a` + `/blog/b`, seed `/docs/` | only `/docs/a` fetched; budget not spent on `/blog/b` |
| Sitemap listing only `/blog/**`, seed `/docs/` | falls back to BFS |
| `--scope origin`, seed `/docs/` | whole-origin crawl (current behavior) |
| Root seed, default scope | byte-identical to current behavior (regression) |
| MCP `convert` arg parse: `scope` present/absent/invalid | threaded / default `path` / schema rejection |

## Rejected alternatives

- **B — generalized `UrlFilter` object** (prefix + globs + host allowlist): speculative abstraction; only prefix scoping is requested. The `underScope` predicate is the refactor seam if globs arrive later.
- **C — post-fetch filtering** (fetch everything, skip writing out-of-scope): wastes bandwidth and `--max-pages` budget on noise. Rejected.

## References

- docforge: `src/http/crawl.ts:26-91` (`crawlBfs` link admission), `src/source.ts:203-275` (`iter` mode decision, `iterFromSitemap` filter+slice), `src/http/url.ts:17-40` (`normalizeUrl`, `sameOrigin`), `src/http/sitemap.ts:5-24` (`discoverSitemaps` returns page URLs), `src/cli.ts`, `src/mcp/tools/convert.ts:275-282` (CrawlOptions build).
- Precedent: wget `--no-parent`.
