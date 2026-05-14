import { describe, expect, test, beforeEach, afterEach } from "vitest";
import { mkdtempSync, rmSync, existsSync, readFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { convertTool, resolveKindFromUrl } from "../../src/mcp/tools/convert.js";
import { LockManager } from "../../src/mcp/locks.js";
import { McpError } from "../../src/mcp/errors.js";
import { readManifest } from "../../src/mcp/manifest.js";
import { startStub, type StubServer } from "./helpers/http-stub.js";

let qmdRoot: string;
let stub: StubServer;

const PAGE_HTML = `<!doctype html><html><head><title>Welcome</title></head>
<body><main><h1>Welcome</h1><p>Hello world. This is a test page with enough content for extraction.</p></main></body></html>`;

beforeEach(async () => {
  qmdRoot = mkdtempSync(join(tmpdir(), "df-convert-"));
  stub = await startStub([
    { path: "/", body: PAGE_HTML },
    { path: "/robots.txt", contentType: "text/plain", body: "User-agent: *\nDisallow:" },
    { path: "/llms-full.txt", status: 404, body: "" },
    { path: "/sitemap.xml", status: 404, body: "" },
    { path: "/sitemap_index.xml", status: 404, body: "" },
  ]);
});
afterEach(async () => {
  await stub.close();
  rmSync(qmdRoot, { recursive: true, force: true });
});

function ctx() {
  return {
    config: {
      qmdRoot,
      cacheDir: join(qmdRoot, ".cache"),
      userAgent: "docforge-test/1.0",
      maxPages: 5,
      maxDepth: 2,
      concurrency: 2,
    },
    locks: new LockManager(),
  };
}

describe("convert tool", () => {
  test("single page write + manifest", async () => {
    const res = await convertTool.handler(
      { url: stub.url, kind: "page" },
      ctx(),
    );
    const sc = res.structuredContent as any;
    expect(sc.collection).toMatch(/^127-0-0-1/);
    expect(sc.kind_resolved).toBe("page");
    expect(sc.pages.length).toBe(1);
    expect(sc.preview.markdown).toContain("Welcome");
    const m = readManifest(sc.path);
    expect(m?.source_url).toBe(stub.url);
    expect(m?.kind).toBe("page");
  });

  test("rejects non-http URL", async () => {
    await expect(
      convertTool.handler({ url: "ftp://x.com/" }, ctx())
    ).rejects.toMatchObject({ code: "INVALID_URL" });
  });

  test("rejects bad corpus override", async () => {
    await expect(
      convertTool.handler({ url: stub.url, corpus: "../etc" }, ctx())
    ).rejects.toMatchObject({ code: "INVALID_CORPUS_NAME" });
  });

  test("SOURCE_MISMATCH when reusing collection for different URL", async () => {
    await convertTool.handler({ url: stub.url, kind: "page", corpus: "shared" }, ctx());
    const stub2 = await startStub([
      { path: "/", body: PAGE_HTML },
      { path: "/robots.txt", contentType: "text/plain", body: "User-agent: *\nDisallow:" },
      { path: "/llms-full.txt", status: 404, body: "" },
      { path: "/sitemap.xml", status: 404, body: "" },
      { path: "/sitemap_index.xml", status: 404, body: "" },
    ]);
    try {
      await expect(
        convertTool.handler({ url: stub2.url, kind: "page", corpus: "shared" }, ctx())
      ).rejects.toMatchObject({ code: "SOURCE_MISMATCH" });
    } finally {
      await stub2.close();
    }
  });

  test("force_refresh overwrites prior corpus", async () => {
    await convertTool.handler({ url: stub.url, kind: "page", corpus: "shared" }, ctx());
    const stub2 = await startStub([
      { path: "/", body: PAGE_HTML },
      { path: "/robots.txt", contentType: "text/plain", body: "User-agent: *\nDisallow:" },
      { path: "/llms-full.txt", status: 404, body: "" },
      { path: "/sitemap.xml", status: 404, body: "" },
      { path: "/sitemap_index.xml", status: 404, body: "" },
    ]);
    try {
      const res = await convertTool.handler(
        { url: stub2.url, kind: "page", corpus: "shared", force_refresh: true },
        ctx(),
      );
      const sc = res.structuredContent as any;
      const m = readManifest(sc.path);
      expect(m?.source_url).toBe(stub2.url);
    } finally {
      await stub2.close();
    }
  });

  test("llms-full force missing → LLMS_FULL_MISSING", async () => {
    await expect(
      convertTool.handler({ url: stub.url, llms_full: "force" }, ctx())
    ).rejects.toMatchObject({ code: "LLMS_FULL_MISSING" });
  });
});

describe("resolveKindFromUrl (pure unit)", () => {
  test(".yaml suffix → page", () => {
    expect(resolveKindFromUrl("http://example.com/spec.yaml")).toBe("page");
  });

  test(".yml suffix → page", () => {
    expect(resolveKindFromUrl("http://example.com/openapi.yml")).toBe("page");
  });

  test(".html suffix → page", () => {
    expect(resolveKindFromUrl("http://example.com/guide.html")).toBe("page");
  });

  test(".htm suffix → page", () => {
    expect(resolveKindFromUrl("http://example.com/index.htm")).toBe("page");
  });

  test(".md suffix → page", () => {
    expect(resolveKindFromUrl("http://example.com/README.md")).toBe("page");
  });

  test(".txt suffix → page", () => {
    expect(resolveKindFromUrl("http://example.com/llms.txt")).toBe("page");
  });

  test(".json suffix → page", () => {
    expect(resolveKindFromUrl("http://example.com/data.json")).toBe("page");
  });

  test("trailing slash → site", () => {
    expect(resolveKindFromUrl("http://example.com/")).toBe("site");
  });

  test("no suffix (directory-like) → site", () => {
    expect(resolveKindFromUrl("http://example.com/docs/guide")).toBe("site");
  });

  test("suffix matching is case-insensitive", () => {
    expect(resolveKindFromUrl("http://example.com/spec.YAML")).toBe("page");
    expect(resolveKindFromUrl("http://example.com/page.HTML")).toBe("page");
  });
});

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
