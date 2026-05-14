# docforge HTTP auth Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Let CLI `convert` and MCP `convert` send a caller-supplied `Authorization` header value to the documentation site, scoped to the root URL's origin, so auth-protected doc sites can be crawled.

**Architecture:** A single optional `auth` field on `FetchOptions` carries the header value plus the origin it may be sent to. `fetchUrl` attaches the header only when the request URL's origin matches. The two `convert` entry points compute the origin from the root URL and pass the literal value through. The `got` client singleton stays auth-agnostic — the header rides per-request.

**Tech Stack:** TypeScript, `got` v15 (HTTP), `vitest` v2 (tests), `commander` (CLI), `@modelcontextprotocol/sdk` (MCP).

**Spec:** `docs/superpowers/specs/2026-05-14-docforge-http-auth-design.md`
**Beads:** docf-eih — claim it before Task 1 (`bd update docf-eih --claim`), close it in Task 4.

**Note on commits:** the beads pre-commit hook may also stage `.beads/issues.jsonl` alongside your code files — that is expected, not an error.

---

## Task 1: Core — `FetchOptions.auth` + origin-gated header in `fetchUrl`

**Files:**
- Modify: `src/http/fetch.ts` (`FetchOptions` interface ~24-29, `fetchUrl` ~55-92)
- Test: `tests/http-fetch.test.ts` (extend existing file)

- [ ] **Step 0: Claim the beads issue**

Run: `bd update docf-eih --claim`
Expected: issue moves to `in_progress`.

- [ ] **Step 1: Write the failing tests**

In `tests/http-fetch.test.ts`:

(a) Change the `hits` array type to also capture the `authorization` header. Replace:

```ts
let hits: { method: string; url: string; ifNoneMatch?: string }[] = [];
```

with:

```ts
let hits: { method: string; url: string; ifNoneMatch?: string; authorization?: string }[] = [];
```

(b) In the server handler, replace the `hits.push({...})` call with:

```ts
    hits.push({
      method: req.method ?? "GET",
      url: req.url ?? "",
      ifNoneMatch: req.headers["if-none-match"] as string | undefined,
      authorization: req.headers["authorization"] as string | undefined,
    });
```

(c) In the server handler, add a `/needsauth` route immediately before the final catch-all `res.writeHead(500);`:

```ts
    if (url === "/needsauth") {
      if (req.headers["authorization"] !== "Bearer testtoken") {
        res.writeHead(401);
        res.end();
        return;
      }
      res.writeHead(200, { "Content-Type": "text/html; charset=utf-8" });
      res.end("<html>secret</html>");
      return;
    }
```

(d) Append this new `describe` block to the end of the file:

```ts
describe("fetchUrl auth", () => {
  test("attaches authorization header when request origin matches auth origin", async () => {
    hits = [];
    const origin = `http://localhost:${port}`;
    await fetchUrl(`${origin}/ok`, opts({
      cacheDir: null,
      auth: { header: "Bearer testtoken", origin },
    }));
    const hit = hits.find((h) => h.url === "/ok");
    expect(hit?.authorization).toBe("Bearer testtoken");
  });

  test("omits authorization header when request origin differs from auth origin", async () => {
    hits = [];
    await fetchUrl(`http://localhost:${port}/ok`, opts({
      cacheDir: null,
      auth: { header: "Bearer testtoken", origin: "http://other.example" },
    }));
    const hit = hits.find((h) => h.url === "/ok");
    expect(hit?.authorization).toBeUndefined();
  });

  test("omits authorization header when no auth is configured", async () => {
    hits = [];
    await fetchUrl(`http://localhost:${port}/ok`, opts({ cacheDir: null }));
    const hit = hits.find((h) => h.url === "/ok");
    expect(hit?.authorization).toBeUndefined();
  });

  test("auth header unlocks a 401-guarded route", async () => {
    const origin = `http://localhost:${port}`;
    const result = await fetchUrl(`${origin}/needsauth`, opts({
      cacheDir: null,
      auth: { header: "Bearer testtoken", origin },
    }));
    expect(result.status).toBe(200);
    expect(result.bytes.toString("utf8")).toBe("<html>secret</html>");
  });

  test("401 with auth set adds a hint to the error message", async () => {
    const origin = `http://localhost:${port}`;
    try {
      await fetchUrl(`${origin}/needsauth`, opts({
        cacheDir: null,
        auth: { header: "Bearer wrongtoken", origin },
      }));
      throw new Error("expected fetchUrl to throw");
    } catch (e) {
      expect(e).toBeInstanceOf(FetchError);
      expect((e as FetchError).status).toBe(401);
      expect((e as Error).message).toContain("auth header sent");
    }
  });
});
```

- [ ] **Step 2: Run tests to verify they fail**

Run: `npx vitest run tests/http-fetch.test.ts`
Expected: the 5 new `fetchUrl auth` tests FAIL (header not attached / route returns 401 / message has no hint). Existing tests still PASS.

- [ ] **Step 3: Implement the core change**

In `src/http/fetch.ts`, add the `auth` field to `FetchOptions`. Replace:

```ts
export interface FetchOptions {
  userAgent: string;
  timeoutMs: number;
  maxBytes: number;
  cacheDir: string | null;
}
```

with:

```ts
export interface FetchOptions {
  userAgent: string;
  timeoutMs: number;
  maxBytes: number;
  cacheDir: string | null;
  auth?: { header: string; origin: string };
}
```

In `fetchUrl`, build the per-request headers with the origin gate. Replace:

```ts
export async function fetchUrl(url: string, opts: FetchOptions): Promise<FetchResult> {
  const client = makeClient(opts);
  let res;
  try {
    res = await client.get(url, {
      headers: { "user-agent": opts.userAgent },
      timeout: { request: opts.timeoutMs },
    });
  } catch (e) {
```

with:

```ts
export async function fetchUrl(url: string, opts: FetchOptions): Promise<FetchResult> {
  const client = makeClient(opts);
  // url is always an absolute http(s) URL here (validated upstream), so `new URL` is safe.
  const headers: Record<string, string> = { "user-agent": opts.userAgent };
  if (opts.auth && new URL(url).origin === opts.auth.origin) {
    headers.authorization = opts.auth.header;
  }
  let res;
  try {
    res = await client.get(url, {
      headers,
      timeout: { request: opts.timeoutMs },
    });
  } catch (e) {
```

In `fetchUrl`, add the 401/403 hint. Replace:

```ts
  if (res.statusCode >= 400) {
    throw new FetchError(`HTTP ${res.statusCode} for ${url}`, res.statusCode);
  }
```

with:

```ts
  if (res.statusCode >= 400) {
    const authHint =
      opts.auth && (res.statusCode === 401 || res.statusCode === 403)
        ? " (auth header sent — check value)"
        : "";
    throw new FetchError(`HTTP ${res.statusCode} for ${url}${authHint}`, res.statusCode);
  }
```

- [ ] **Step 4: Run tests to verify they pass**

Run: `npx vitest run tests/http-fetch.test.ts`
Expected: all tests PASS (existing + 5 new).

- [ ] **Step 5: Typecheck**

Run: `npx tsc --noEmit`
Expected: no errors.

- [ ] **Step 6: Commit**

```bash
git add src/http/fetch.ts tests/http-fetch.test.ts
git commit -m "$(cat <<'EOF'
feat(http): attach origin-scoped Authorization header in fetchUrl (docf-eih)

FetchOptions gains optional auth { header, origin }. fetchUrl attaches
the Authorization header only when the request URL's origin matches the
configured origin. 401/403 responses with auth set get a hint appended.

Co-Authored-By: Claude Opus 4.7 (1M context) <noreply@anthropic.com>
EOF
)"
```

---

## Task 2: CLI `convert` — `--auth-header` flag

**Files:**
- Modify: `src/cli.ts` (option list ~42, `ConvertOpts` interface ~55-69, `runConvert` ~101-106)
- Test: `tests/cli-auth-header.test.ts` (create)

- [ ] **Step 1: Write the failing test**

Create `tests/cli-auth-header.test.ts`:

```ts
import { afterEach, beforeEach, describe, expect, test } from "vitest";
import { createServer, type Server } from "node:http";
import { AddressInfo } from "node:net";
import { existsSync, mkdtempSync, readFileSync, rmSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { runConvert } from "../src/cli.js";
import { __clearRobotsCache } from "../src/http/robots.js";

const AUTH_VALUE = "Bearer cli-test-token";
const PAGE_HTML =
  `<!doctype html><html><head><title>Secret Docs</title></head>` +
  `<body><main><h1>Secret Docs</h1>` +
  `<p>This documentation page sits behind HTTP authentication for testing purposes.</p>` +
  `</main></body></html>`;

interface AuthServer {
  url: string;
  close(): Promise<void>;
}

async function startAuthServer(): Promise<AuthServer> {
  const server: Server = createServer((req, res) => {
    const path = (req.url ?? "/").split("?")[0];
    if (path !== "/") {
      res.writeHead(404).end();
      return;
    }
    if (req.headers["authorization"] !== AUTH_VALUE) {
      res.writeHead(401).end();
      return;
    }
    res.writeHead(200, { "Content-Type": "text/html; charset=utf-8" });
    res.end(PAGE_HTML);
  });
  await new Promise<void>((r) => server.listen(0, "127.0.0.1", r));
  const port = (server.address() as AddressInfo).port;
  return {
    url: `http://127.0.0.1:${port}/`,
    close: () => new Promise<void>((r) => server.close(() => r())),
  };
}

let tmp: string;
beforeEach(() => {
  __clearRobotsCache();
  tmp = mkdtempSync(join(tmpdir(), "docforge-cli-auth-"));
});
afterEach(() => {
  rmSync(tmp, { recursive: true, force: true });
});

function baseOpts(output: string) {
  return {
    output,
    failThreshold: "0.10",
    maxBytes: "10485760",
    dryRun: false,
    maxPages: "1",
    maxDepth: "1",
    concurrency: "1",
    cacheDir: join(tmp, ".cache"),
    cache: false,
    userAgent: "docforge-test/0",
    llmsFull: "auto",
  };
}

describe("convert --auth-header", () => {
  test("crawls an auth-gated page when --auth-header is provided", async () => {
    const srv = await startAuthServer();
    try {
      const out = join(tmp, "authed");
      const code = await runConvert(srv.url, {
        ...baseOpts(out),
        authHeader: AUTH_VALUE,
      });
      expect(code).toBe(0);
      expect(existsSync(join(out, "index.md"))).toBe(true);
      expect(readFileSync(join(out, "index.md"), "utf8")).toContain("Secret Docs");
    } finally {
      await srv.close();
    }
  });

  test("fails to crawl the same page without --auth-header", async () => {
    const srv = await startAuthServer();
    try {
      const out = join(tmp, "noauth");
      const code = await runConvert(srv.url, baseOpts(out));
      expect(code).not.toBe(0);
      expect(existsSync(join(out, "index.md"))).toBe(false);
    } finally {
      await srv.close();
    }
  });
});
```

- [ ] **Step 2: Run test to verify it fails**

Run: `npx vitest run tests/cli-auth-header.test.ts`
Expected: the "provided" test FAILS — `ConvertOpts` has no `authHeader` field yet, so `runConvert` never sets `fetchOptions.auth`, the root fetch gets a 401, and `index.md` is not written. (The "without" test may already pass — it asserts failure.)

- [ ] **Step 3: Implement the CLI wiring**

In `src/cli.ts`, add the option. After this line in the `convert` command builder:

```ts
    .option("--user-agent <str>", "User-Agent header (URL source only)", DEFAULT_USER_AGENT)
```

add:

```ts
    .option("--auth-header <value>", "Authorization header value sent to the root origin (URL source only). Warning: visible in process list and shell history.")
```

In `src/cli.ts`, add the field to the `ConvertOpts` interface. Replace:

```ts
  userAgent: string;
  selector?: string | undefined;
  llmsFull: string;
}
```

with:

```ts
  userAgent: string;
  selector?: string | undefined;
  llmsFull: string;
  authHeader?: string | undefined;
}
```

In `src/cli.ts` `runConvert`, thread the value into `fetchOptions`. Replace:

```ts
    pipelineOpts.fetchOptions = {
      userAgent: opts.userAgent,
      timeoutMs: 30_000,
      maxBytes,
      cacheDir: opts.cache ? expandHome(opts.cacheDir) : null,
    };
    pipelineOpts.crawlOptions = {
```

with:

```ts
    pipelineOpts.fetchOptions = {
      userAgent: opts.userAgent,
      timeoutMs: 30_000,
      maxBytes,
      cacheDir: opts.cache ? expandHome(opts.cacheDir) : null,
    };
    if (opts.authHeader) {
      pipelineOpts.fetchOptions.auth = {
        header: opts.authHeader,
        origin: new URL(sourceArg).origin,
      };
    }
    pipelineOpts.crawlOptions = {
```

- [ ] **Step 4: Run test to verify it passes**

Run: `npx vitest run tests/cli-auth-header.test.ts`
Expected: both tests PASS.

- [ ] **Step 5: Typecheck**

Run: `npx tsc --noEmit`
Expected: no errors.

- [ ] **Step 6: Commit**

```bash
git add src/cli.ts tests/cli-auth-header.test.ts
git commit -m "$(cat <<'EOF'
feat(cli): add --auth-header flag to convert (docf-eih)

URL-source convert can now send an Authorization header value, scoped
to the root URL's origin, so auth-protected doc sites can be crawled.

Co-Authored-By: Claude Opus 4.7 (1M context) <noreply@anthropic.com>
EOF
)"
```

---

## Task 3: MCP `convert` tool — `auth_header` arg

**Files:**
- Modify: `src/mcp/tools/convert.ts` (imports ~1-18, `ConvertArgs` ~20-34, `parseArgs` ~36-73, `resolveKind` ~94-127, `inputSchema` ~167-190, handler `fetchOptions` ~234-239)
- Modify: `tests/mcp/helpers/http-stub.ts` (add request-header capture)
- Test: `tests/mcp/tools-convert.test.ts` (extend existing file)

- [ ] **Step 1: Extend the stub server to capture request headers**

Replace the entire contents of `tests/mcp/helpers/http-stub.ts` with:

```ts
import { createServer, type Server } from "node:http";

export interface StubRoute {
  path: string;
  status?: number;
  contentType?: string;
  body: string;
}

export interface StubRequest {
  path: string;
  authorization: string | undefined;
}

export interface StubServer {
  url: string;
  origin: string;
  requests: StubRequest[];
  close(): Promise<void>;
}

export async function startStub(routes: StubRoute[]): Promise<StubServer> {
  const map = new Map<string, StubRoute>();
  for (const r of routes) map.set(r.path, r);
  const requests: StubRequest[] = [];

  const server: Server = createServer((req, res) => {
    const path = (req.url ?? "/").split("?")[0] ?? "/";
    requests.push({
      path,
      authorization: req.headers["authorization"] as string | undefined,
    });
    const route = map.get(path);
    if (!route) {
      res.writeHead(404, { "content-type": "text/plain" }).end("not found");
      return;
    }
    res.writeHead(route.status ?? 200, {
      "content-type": route.contentType ?? "text/html; charset=utf-8",
    });
    res.end(route.body);
  });
  await new Promise<void>(r => server.listen(0, "127.0.0.1", r));
  const addr = server.address();
  if (!addr || typeof addr === "string") throw new Error("bad address");
  const origin = `http://127.0.0.1:${addr.port}`;
  return {
    url: origin + "/",
    origin,
    requests,
    close: () => new Promise<void>(r => server.close(() => r())),
  };
}
```

- [ ] **Step 2: Write the failing tests**

Append this new `describe` block to the end of `tests/mcp/tools-convert.test.ts`:

```ts
describe("convert tool auth_header", () => {
  test("threads Authorization header into the page fetch", async () => {
    const res = await convertTool.handler(
      { url: stub.url, kind: "page", auth_header: "Bearer sekret" },
      ctx(),
    );
    expect((res.structuredContent as any).pages.length).toBe(1);
    const rootReq = stub.requests.find((r) => r.path === "/");
    expect(rootReq?.authorization).toBe("Bearer sekret");
  });

  test("threads Authorization header into the llms-full.txt probe", async () => {
    await convertTool.handler(
      { url: stub.url, auth_header: "Bearer sekret" },
      ctx(),
    );
    const probeReq = stub.requests.find((r) => r.path === "/llms-full.txt");
    expect(probeReq).toBeDefined();
    expect(probeReq?.authorization).toBe("Bearer sekret");
  });

  test("ignores an empty auth_header (no Authorization header sent)", async () => {
    await convertTool.handler(
      { url: stub.url, kind: "page", auth_header: "" },
      ctx(),
    );
    const rootReq = stub.requests.find((r) => r.path === "/");
    expect(rootReq?.authorization).toBeUndefined();
  });
});
```

- [ ] **Step 3: Run tests to verify they fail**

Run: `npx vitest run tests/mcp/tools-convert.test.ts`
Expected: the two "threads ..." tests FAIL — the handler does not yet read `auth_header`, so the stub records `authorization: undefined`. The "ignores an empty auth_header" test PASSES already (nothing threads an empty value). Existing `convert tool` tests still PASS.

- [ ] **Step 4: Implement the MCP wiring**

In `src/mcp/tools/convert.ts`, add the `FetchOptions` type import. After this line:

```ts
import { probeLlmsTxt } from "../../http/llms-index.js";
```

add:

```ts
import type { FetchOptions } from "../../http/fetch.js";
```

Add the field to the `ConvertArgs` interface. Replace:

```ts
  user_agent?: string;
  force_refresh?: boolean;
  preview_bytes?: number;
  exclude_hosts?: string[];
}
```

with:

```ts
  user_agent?: string;
  force_refresh?: boolean;
  preview_bytes?: number;
  exclude_hosts?: string[];
  auth_header?: string;
}
```

Parse the arg. In `parseArgs`, after this line:

```ts
  if (typeof raw.user_agent === "string") args.user_agent = raw.user_agent;
```

add:

```ts
  if (typeof raw.auth_header === "string" && raw.auth_header) args.auth_header = raw.auth_header;
```

Thread auth into the probe options. In `resolveKind`, replace:

```ts
  const probeOpts = {
    userAgent,
    timeoutMs: 10_000,
    maxBytes: 10 * 1024 * 1024,
    cacheDir: null,
  };
```

with:

```ts
  const probeOpts: FetchOptions = {
    userAgent,
    timeoutMs: 10_000,
    maxBytes: 10 * 1024 * 1024,
    cacheDir: null,
    ...(args.auth_header
      ? { auth: { header: args.auth_header, origin: new URL(args.url).origin } }
      : {}),
  };
```

Thread auth into the pipeline fetch options. In the handler, replace:

```ts
        fetchOptions: {
          userAgent: args.user_agent ?? ctx.config.userAgent,
          timeoutMs: 30_000,
          maxBytes: 10 * 1024 * 1024,
          cacheDir: ctx.config.cacheDir,
        },
```

with:

```ts
        fetchOptions: {
          userAgent: args.user_agent ?? ctx.config.userAgent,
          timeoutMs: 30_000,
          maxBytes: 10 * 1024 * 1024,
          cacheDir: ctx.config.cacheDir,
          ...(args.auth_header
            ? { auth: { header: args.auth_header, origin: new URL(args.url).origin } }
            : {}),
        },
```

Add the arg to the input schema. In `inputSchema.properties`, replace:

```ts
      user_agent: { type: "string" },
      force_refresh: { type: "boolean", default: false },
```

with:

```ts
      user_agent: { type: "string" },
      auth_header: {
        type: "string",
        description: "Authorization header value, sent only to the root URL's origin. Warning: appears in the tool-call transcript.",
      },
      force_refresh: { type: "boolean", default: false },
```

- [ ] **Step 5: Run tests to verify they pass**

Run: `npx vitest run tests/mcp/tools-convert.test.ts`
Expected: all tests PASS (existing + 3 new).

- [ ] **Step 6: Typecheck**

Run: `npx tsc --noEmit`
Expected: no errors.

- [ ] **Step 7: Commit**

```bash
git add src/mcp/tools/convert.ts tests/mcp/helpers/http-stub.ts tests/mcp/tools-convert.test.ts
git commit -m "$(cat <<'EOF'
feat(mcp): add auth_header arg to convert tool (docf-eih)

The convert tool accepts an auth_header value, threaded into both the
kind-detection probes and the crawl pipeline, scoped to the root URL's
origin.

Co-Authored-By: Claude Opus 4.7 (1M context) <noreply@anthropic.com>
EOF
)"
```

---

## Task 4: Full-suite verification + close

**Files:** none (verification only)

- [ ] **Step 1: Run the full test suite**

Run: `npm test`
Expected: `pretest` runs `tsc` cleanly, then `vitest run` reports all test files PASS — including `tests/http-fetch.test.ts`, `tests/cli-auth-header.test.ts`, `tests/mcp/tools-convert.test.ts`, and every pre-existing file (no regressions).

- [ ] **Step 2: Confirm `got` cross-host redirect behaviour**

This is a documentation/verification step, no code change. The spec relies on `got` stripping the `authorization` header on cross-host redirects. Confirm it is still true in the installed version:

Run: `grep -n "crossOriginStripHeaders\|_stripCrossOriginState" node_modules/got/dist/source/core/index.js`
Expected: matches found (`got` v15 strips sensitive headers, including `authorization`, on cross-origin redirect). If this ever returns nothing, open a follow-up issue — the origin gate in `fetchUrl` still protects separate fetch calls, but redirect hops would need explicit handling.

- [ ] **Step 3: Close the beads issue**

Run: `bd close docf-eih --reason="HTTP auth (Authorization header) added to CLI + MCP convert, origin-scoped"`
Expected: issue closed.

---

## Self-Review

**Spec coverage:**
- Spec §Design 1 (`FetchOptions.auth` + origin-gated `fetchUrl`) → Task 1. ✓
- Spec §Design 2 CLI wiring (`--auth-header`, `ConvertOpts`, `runConvert`) → Task 2. ✓
- Spec §Design 2 MCP wiring (schema `auth_header`, `ConvertArgs`, `parseArgs`, handler `fetchOptions`, `resolveKind` `probeOpts`) → Task 3. ✓
- Spec §Design 3 401/403 hint → Task 1, Step 3. ✓
- Spec §Design 3 redirects → Task 4, Step 2 (verification; `got` handles it, no code). ✓
- Spec §Design 3 cache unchanged → no task needed (deliberately untouched). ✓
- Spec §Design 4 testing (`fetchUrl` unit, CLI, MCP `parseArgs` empty-ignored, MCP handler threads into `fetchOptions` + `probeOpts`) → Tasks 1-3 tests. ✓
- Spec §Security note → flag description (Task 2, Step 3) + schema description (Task 3, Step 4). ✓

**Placeholder scan:** no TBD/TODO/"handle edge cases" — every step has concrete code or an exact command. ✓

**Type consistency:** `auth: { header: string; origin: string }` is defined identically in `FetchOptions` (Task 1) and constructed identically in `cli.ts` and `convert.ts` (`{ header, origin }`). The CLI uses `authHeader` (commander camelCase) and the MCP tool uses `auth_header` (matching the existing `user_agent` snake_case) — intentionally different per each surface's existing convention. `StubRequest`/`StubServer.requests` in the test helper match their use in Task 3's tests. ✓
