# docforge HTTP auth — design

**Date:** 2026-05-14
**Beads:** docf-eih
**Status:** approved, ready for implementation plan

## Problem

docforge cannot crawl authentication-protected documentation sites. Internal
docs portals, paid documentation, and staging sites that sit behind HTTP auth
return 401/403 to every fetch, so no corpus can be built from them.

## Goal

Let a caller supply an HTTP `Authorization` header value that docforge attaches
to requests against the documentation site, so auth-protected sites can be
crawled and converted.

## Decisions

Four design questions were resolved during brainstorming:

1. **Auth method — raw `Authorization` header value, single input.** The caller
   supplies the full header value verbatim (`Bearer xyz`, `token abc`, or a
   self-encoded `Basic …`). docforge does no encoding and offers no
   username/password convenience field. One input covers every common scheme.

2. **Input channel — direct value.** A CLI flag `--auth-header <value>` and an
   MCP tool arg `auth_header` carry the literal secret. Simplest UX. The leak
   tradeoff (see Security note) was accepted as an informed choice.

3. **Origin scope — root origin only.** The header is attached only when a
   request's origin matches the root URL's origin. The crawl is already
   same-origin restricted (`crawl.ts:78`), so normal crawls are unchanged — but
   a redirect to a CDN or an auto-discovered off-origin OpenAPI spec will not
   leak the secret to a third party.

4. **Coverage — HTML `convert` path only.** CLI `convert` and MCP `convert`. The
   two OpenAPI entry points (CLI `openapi`, MCP `convert_openapi`) stay no-auth.

## Approach

**Per-request header in `fetchUrl`, origin-gated, response cache kept.**

The header-injection mechanism is constrained by an existing fact: `makeClient()`
caches the `got` client as a module-level singleton keyed by `cacheDir`
(`fetch.ts:31-52`). Baking auth into the client (e.g. via `got` hooks) would
poison that singleton across two converts with different credentials in the same
MCP-server process. Therefore auth must ride as a **per-request** header on
`client.get(url, { headers })`, leaving the client auth-agnostic.

Two alternatives were considered and rejected:

- *Bypass the response cache whenever auth is set* — eliminates all cross-auth
  cache bleed, but authed crawls re-fetch every page every run, losing ETag
  revalidation. The bleed it prevents is low-probability (same URL, same cache
  dir, auth toggled between runs).
- *`got` `beforeRequest`/`beforeRedirect` hooks own injection* — most defensive
  on redirects, but forces the client-cache singleton to be keyed by auth or
  abandoned. Not worth it: `got` already strips `authorization` on cross-host
  redirect.

## Design

### 1. Core — `FetchOptions` + `fetchUrl` (`src/http/fetch.ts`)

`FetchOptions` gains one optional field:

```ts
auth?: { header: string; origin: string };
```

`fetchUrl` builds per-request headers, origin-gated:

```ts
const headers: Record<string, string> = { "user-agent": opts.userAgent };
if (opts.auth && new URL(url).origin === opts.auth.origin) {
  headers.authorization = opts.auth.header;
}
res = await client.get(url, { headers, timeout: { request: opts.timeoutMs } });
```

`makeClient` is untouched — the client stays auth-agnostic and the singleton
remains safe. All six `fetchUrl` call sites (`crawl`, `robots`, `sitemap`,
`llms`, `llms-index`, `openapi/loader`) already receive `FetchOptions`, so `auth`
threads through automatically with no per-call-site changes.

### 2. Entry-point wiring

**CLI `convert` (`src/cli.ts`):**
- New option: `--auth-header <value>` — "Authorization header value sent to the
  root origin (URL source only)".
- `ConvertOpts` gains `authHeader?: string`.
- In `runConvert`, URL branch: when `opts.authHeader` is set,
  `pipelineOpts.fetchOptions.auth = { header: opts.authHeader, origin: new URL(sourceArg).origin }`.

**MCP `convert` (`src/mcp/tools/convert.ts`):**
- `inputSchema.properties` gains
  `auth_header: { type: "string", description: "Authorization header value, sent only to the root URL's origin" }`.
- `ConvertArgs` gains `auth_header?: string`.
- `parseArgs` accepts a non-empty string; empty / non-string ignored.
- Handler attaches `auth: { header: args.auth_header, origin: new URL(args.url).origin }`
  to `pipelineOpts.fetchOptions` **and** to `resolveKind`'s `probeOpts`
  (`convert.ts:96`) — otherwise an auth-walled site that has `llms-full.txt`
  fails the unauthenticated probe and is misdetected as plain HTML.

Origin derivation is safe: both entry points validate the root URL as http(s)
before this point, so `new URL(...)` will not throw.

### 3. Error handling + redirects

- **401/403:** no special-casing. `fetchUrl` already throws `FetchError` with
  `status` for any `>= 400`; the crawl logs and continues, a single-page convert
  fails the run. Behaviour is identical to today.
  - *Optional nicety:* when `opts.auth` is set and the status is 401/403, append
    `(auth header sent — check value)` to the error message. One line; may be
    dropped.
- **Redirects:** `got` strips the `authorization` header on cross-host redirect
  by default. This must be verified against the installed `got` v15 during
  implementation. The origin gate in `fetchUrl` covers separate fetch calls;
  together the secret never leaves the root origin.
- **Cache:** unchanged. Documented caveat — `got`'s response-cache key does not
  vary by `Authorization`, so a persisted cache dir + the same URL + auth toggled
  across runs can serve a stale authed/unauthed body. Accepted under this
  approach; low-probability and cross-run only.

### 4. Testing

- **`fetchUrl` unit** — local `http` server: `auth` set with a matching origin →
  server receives the `authorization` header; a request to a second server on a
  different port (different origin) → header absent; no `auth` → no header
  (regression guard).
- **CLI** — `--auth-header` populates `fetchOptions.auth` with the correct
  origin derived from the source URL.
- **MCP `parseArgs`** — `auth_header` string accepted; empty string and
  non-string ignored.
- **MCP handler** — `auth` is threaded into both `fetchOptions` and `probeOpts`,
  with the origin taken from `args.url`.

Tests follow the existing vitest conventions in the repo.

## Security note

The direct-value channel leaks the secret:
- `--auth-header` is visible in `ps` output and shell history.
- `auth_header` appears in the MCP conversation and tool-call transcript/logs.

This was an informed choice made during brainstorming. It is documented here and
in the flag / schema descriptions. No mitigation code is in scope. A future
change could add an env-var-reference channel (pass the *name* of an env var) if
the leak becomes a problem.

## Out of scope

- Username/password convenience field (caller self-encodes `Basic` if needed).
- Env-var-reference or fixed-env-var input channels.
- Custom header name / arbitrary header pairs.
- Auth on the OpenAPI entry points (CLI `openapi`, MCP `convert_openapi`).
- Per-origin / multi-origin credential maps.
- Cache-key partitioning by `Authorization`.


## Post-implementation corrections

### docf-plx — response cache bypassed for authed requests (2026-05-14)

The "Cache: unchanged" note (§3 *Error handling + redirects*) and the rejected
"bypass the response cache whenever auth is set" alternative (§*Approach*) are
superseded. `fetchUrl` now routes any request that carries the auth header
(origin-matched) through the no-cache `got` client, so an auth-gated body is never
written to or read from the shared on-disk cache. The trade-off the original spec
named — authed crawls lose ETag revalidation and re-fetch every page each run — was
accepted to close the cross-auth cache-bleed exposure.


### docf-sbf — sitemap auth is explicit, not automatic (2026-05-14)

§1 (*Core*) stated `auth` "threads through automatically" to all `fetch` sites,
and the call-site list implied `sitemap` reaches the network through `fetchUrl`.
That was inaccurate: `src/http/sitemap.ts` drives `Sitemapper`, a separate HTTP
client, and never calls `fetchUrl`. `fetchSitemap` now adds an origin-gated
`authorization` entry to the `Sitemapper` `requestHeaders` itself, mirroring the
`fetchUrl` origin gate.
