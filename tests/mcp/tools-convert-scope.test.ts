import { describe, expect, test, beforeEach, afterEach } from "vitest";
import { mkdtempSync, rmSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { convertTool } from "../../src/mcp/tools/convert.js";
import { LockManager } from "../../src/mcp/locks.js";
import { startStub, type StubServer } from "./helpers/http-stub.js";

let qmdRoot: string;
let stub: StubServer;

const page = (title: string, links: string[] = []) =>
  `<!doctype html><html><head><title>${title}</title></head><body><main><h1>${title}</h1>` +
  `<p>Enough content for extraction to succeed on the ${title} page.</p>` +
  links.map((l) => `<a href="${l}">${l}</a>`).join("") +
  `</main></body></html>`;

beforeEach(async () => {
  qmdRoot = mkdtempSync(join(tmpdir(), "df-scope-"));
  stub = await startStub([
    { path: "/robots.txt", contentType: "text/plain", body: "User-agent: *\nDisallow:" },
    { path: "/sitemap.xml", status: 404, body: "" },
    { path: "/sitemap_index.xml", status: 404, body: "" },
    { path: "/docs/", body: page("Docs", ["/docs/a", "/blog/b"]) },
    { path: "/docs/a", body: page("A") },
    { path: "/blog/b", body: page("B") },
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
      maxPages: 10,
      maxDepth: 3,
      concurrency: 2,
    },
    locks: new LockManager(),
  };
}

describe("MCP convert scope arg", () => {
  test("inputSchema exposes scope enum path|origin, default path", () => {
    const props = (convertTool.inputSchema as {
      properties: Record<string, { enum?: string[]; default?: string }>;
    }).properties;
    expect(props.scope).toBeDefined();
    expect(props.scope.enum).toEqual(["path", "origin"]);
    expect(props.scope.default).toBe("path");
  });

  test("default scope: site crawl seeded at /docs/ skips /blog/", async () => {
    const res = await convertTool.handler(
      { url: `${stub.origin}/docs/`, kind: "site", corpus: "scope-default" },
      ctx(),
    );
    const sc = res.structuredContent as { pages: Array<{ rel_path: string }> };
    const rels = sc.pages.map((p) => p.rel_path).sort();
    expect(rels).toContain("docs/a.md");
    expect(rels.some((r) => r.startsWith("blog/"))).toBe(false);
  });

  test("scope=origin: site crawl seeded at /docs/ includes /blog/", async () => {
    const res = await convertTool.handler(
      { url: `${stub.origin}/docs/`, kind: "site", corpus: "scope-origin", scope: "origin" },
      ctx(),
    );
    const sc = res.structuredContent as { pages: Array<{ rel_path: string }> };
    const rels = sc.pages.map((p) => p.rel_path).sort();
    expect(rels).toContain("blog/b.md");
  });
});
