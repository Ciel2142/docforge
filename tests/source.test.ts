import { afterAll, afterEach, beforeAll, beforeEach, describe, expect, test } from "vitest";
import { mkdtempSync, mkdirSync, rmSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { createServer, type Server } from "node:http";
import { AddressInfo } from "node:net";
import { FilesystemSource, HttpSource } from "../src/source.js";
import { __clearRobotsCache } from "../src/http/robots.js";

let tmp: string;
beforeEach(() => {
  tmp = mkdtempSync(join(tmpdir(), "docforge-source-"));
});
afterEach(() => {
  rmSync(tmp, { recursive: true, force: true });
});

describe("FilesystemSource", () => {
  test("yields items for each html file with file:// srcUri", async () => {
    mkdirSync(join(tmp, "guide"), { recursive: true });
    writeFileSync(join(tmp, "index.html"), "<html>i</html>");
    writeFileSync(join(tmp, "guide/foo.html"), "<html>f</html>");

    const source = new FilesystemSource(tmp, 10_000_000);
    const items = [];
    for await (const item of source.iter()) items.push(item);
    items.sort((a, b) => a.key.localeCompare(b.key));

    expect(items.map((i) => i.key)).toEqual(["guide/foo.html", "index.html"]);
    expect(items[0].srcUri.startsWith("file://")).toBe(true);
    expect(items[0].contentType).toBe("text/html");
    expect(items[1].bytes.toString("utf8")).toBe("<html>i</html>");
    expect(source.skippedCount).toBe(0);
  });

  test("single-file source yields one item keyed by basename", async () => {
    const file = join(tmp, "a.html");
    writeFileSync(file, "<html>a</html>");
    const source = new FilesystemSource(file, 10_000_000);
    const items = [];
    for await (const item of source.iter()) items.push(item);
    expect(items).toHaveLength(1);
    expect(items[0].key).toBe("a.html");
  });

  test("non-html files do not appear; skippedCount tracks them", async () => {
    writeFileSync(join(tmp, "a.html"), "<html>a</html>");
    writeFileSync(join(tmp, "b.css"), "body{}");
    const source = new FilesystemSource(tmp, 10_000_000);
    const items = [];
    for await (const item of source.iter()) items.push(item);
    expect(items).toHaveLength(1);
    expect(source.skippedCount).toBeGreaterThanOrEqual(1);
  });
});

let server: Server;
let port: number;
let pages: Record<string, { status: number; ctype: string; body: string }> = {};

beforeAll(async () => {
  server = createServer((req, res) => {
    if (req.url === "/robots.txt") {
      res.writeHead(404);
      res.end();
      return;
    }
    const r = pages[req.url ?? ""];
    if (!r) {
      res.writeHead(404);
      res.end();
      return;
    }
    res.writeHead(r.status, { "Content-Type": r.ctype });
    res.end(r.body);
  });
  await new Promise<void>((resolve) => server.listen(0, resolve));
  port = (server.address() as AddressInfo).port;
});

afterAll(async () => {
  await new Promise<void>((resolve) => server.close(() => resolve()));
});

describe("HttpSource", () => {
  test("BFS yields all linked html pages, skips non-html", async () => {
    __clearRobotsCache();
    pages = {
      "/": { status: 200, ctype: "text/html", body: `<a href="/a">a</a><a href="/b.css">c</a>` },
      "/a": { status: 200, ctype: "text/html", body: `<html>a</html>` },
      "/b.css": { status: 200, ctype: "text/css", body: `body{}` },
    };
    const source = new HttpSource(
      `http://localhost:${port}/`,
      { userAgent: "t", timeoutMs: 1_000, maxBytes: 1_000_000, cacheDir: null },
      { maxPages: 100, maxDepth: 10, concurrency: 1, userAgent: "t", llmsFullMode: "off" },
    );
    const items = [];
    for await (const it of source.iter()) items.push(it);
    expect(items.map((i) => i.srcUri).sort()).toEqual([
      `http://localhost:${port}/`,
      `http://localhost:${port}/a`,
    ]);
    expect(source.skippedCount).toBeGreaterThanOrEqual(1); // .css filtered
  });

  test("singlePage fetches seed only, bypassing sitemap.xml", async () => {
    __clearRobotsCache();
    pages = {
      "/sitemap.xml": {
        status: 200,
        ctype: "application/xml",
        body: `<?xml version="1.0"?><urlset xmlns="http://www.sitemaps.org/schemas/sitemap/0.9"><url><loc>http://localhost:${port}/first.html</loc></url><url><loc>http://localhost:${port}/wanted.html</loc></url></urlset>`,
      },
      "/first.html": { status: 200, ctype: "text/html", body: `<html><body>FIRST</body></html>` },
      "/wanted.html": { status: 200, ctype: "text/html", body: `<html><body>WANTED</body></html>` },
    };
    const source = new HttpSource(
      `http://localhost:${port}/wanted.html`,
      { userAgent: "t", timeoutMs: 1_000, maxBytes: 1_000_000, cacheDir: null },
      { maxPages: 1, maxDepth: 10, concurrency: 1, userAgent: "t", llmsFullMode: "off", singlePage: true },
    );
    const items = [];
    for await (const it of source.iter()) items.push(it);
    expect(items).toHaveLength(1);
    expect(items[0].srcUri).toBe(`http://localhost:${port}/wanted.html`);
    expect(items[0].bytes.toString("utf8")).toContain("WANTED");
  });

  test("singlePage skips llms-full probe even when llmsFullMode=auto", async () => {
    __clearRobotsCache();
    pages = {
      "/llms-full.txt": { status: 200, ctype: "text/plain", body: `# llms-full content` },
      "/wanted.html": { status: 200, ctype: "text/html", body: `<html><body>WANTED</body></html>` },
    };
    const source = new HttpSource(
      `http://localhost:${port}/wanted.html`,
      { userAgent: "t", timeoutMs: 1_000, maxBytes: 1_000_000, cacheDir: null },
      { maxPages: 1, maxDepth: 10, concurrency: 1, userAgent: "t", llmsFullMode: "auto", singlePage: true },
    );
    const items = [];
    for await (const it of source.iter()) items.push(it);
    expect(items).toHaveLength(1);
    expect(items[0].srcUri).toBe(`http://localhost:${port}/wanted.html`);
    expect(items[0].kind).toBeUndefined();
  });

  test("singlePage skips non-html content type", async () => {
    __clearRobotsCache();
    pages = {
      "/binary.bin": { status: 200, ctype: "application/octet-stream", body: `garbage` },
    };
    const source = new HttpSource(
      `http://localhost:${port}/binary.bin`,
      { userAgent: "t", timeoutMs: 1_000, maxBytes: 1_000_000, cacheDir: null },
      { maxPages: 1, maxDepth: 10, concurrency: 1, userAgent: "t", llmsFullMode: "off", singlePage: true },
    );
    const items = [];
    for await (const it of source.iter()) items.push(it);
    expect(items).toHaveLength(0);
    expect(source.skippedCount).toBe(1);
  });

  test("sitemap URLs outside scopePrefix are not fetched", async () => {
    __clearRobotsCache();
    pages = {
      "/sitemap.xml": {
        status: 200,
        ctype: "application/xml",
        body: `<?xml version="1.0"?><urlset xmlns="http://www.sitemaps.org/schemas/sitemap/0.9"><url><loc>http://localhost:${port}/docs/a.html</loc></url><url><loc>http://localhost:${port}/blog/b.html</loc></url></urlset>`,
      },
      "/docs/": { status: 200, ctype: "text/html", body: `<html>docs</html>` },
      "/docs/a.html": { status: 200, ctype: "text/html", body: `<html>a</html>` },
      "/blog/b.html": { status: 200, ctype: "text/html", body: `<html>b</html>` },
    };
    const source = new HttpSource(
      `http://localhost:${port}/docs/`,
      { userAgent: "t", timeoutMs: 1_000, maxBytes: 1_000_000, cacheDir: null },
      {
        maxPages: 100, maxDepth: 10, concurrency: 1, userAgent: "t",
        llmsFullMode: "off", llmsIndexMode: "off", scopePrefix: "/docs/",
      },
    );
    const items = [];
    for await (const it of source.iter()) items.push(it);
    expect(items.map((i) => i.srcUri).sort()).toEqual([
      `http://localhost:${port}/docs/a.html`,
    ]);
  });

  test("sitemap with zero in-scope URLs falls back to BFS", async () => {
    __clearRobotsCache();
    pages = {
      "/sitemap.xml": {
        status: 200,
        ctype: "application/xml",
        body: `<?xml version="1.0"?><urlset xmlns="http://www.sitemaps.org/schemas/sitemap/0.9"><url><loc>http://localhost:${port}/blog/b.html</loc></url></urlset>`,
      },
      "/docs/": { status: 200, ctype: "text/html", body: `<html><a href="/docs/a.html">a</a></html>` },
      "/docs/a.html": { status: 200, ctype: "text/html", body: `<html>a</html>` },
      "/blog/b.html": { status: 200, ctype: "text/html", body: `<html>b</html>` },
    };
    const source = new HttpSource(
      `http://localhost:${port}/docs/`,
      { userAgent: "t", timeoutMs: 1_000, maxBytes: 1_000_000, cacheDir: null },
      {
        maxPages: 100, maxDepth: 10, concurrency: 1, userAgent: "t",
        llmsFullMode: "off", llmsIndexMode: "off", scopePrefix: "/docs/",
      },
    );
    const items = [];
    for await (const it of source.iter()) items.push(it);
    expect(items.map((i) => i.srcUri).sort()).toEqual([
      `http://localhost:${port}/docs/`,
      `http://localhost:${port}/docs/a.html`,
    ]);
  });

  test("sitemap with only cross-origin and out-of-scope URLs falls back to BFS", async () => {
    __clearRobotsCache();
    pages = {
      "/sitemap.xml": {
        status: 200,
        ctype: "application/xml",
        body: `<?xml version="1.0"?><urlset xmlns="http://www.sitemaps.org/schemas/sitemap/0.9"><url><loc>http://example.invalid/docs/x.html</loc></url><url><loc>http://localhost:${port}/blog/b.html</loc></url></urlset>`,
      },
      "/docs/": { status: 200, ctype: "text/html", body: `<html><a href="/docs/a.html">a</a></html>` },
      "/docs/a.html": { status: 200, ctype: "text/html", body: `<html>a</html>` },
      "/blog/b.html": { status: 200, ctype: "text/html", body: `<html>b</html>` },
    };
    const source = new HttpSource(
      `http://localhost:${port}/docs/`,
      { userAgent: "t", timeoutMs: 1_000, maxBytes: 1_000_000, cacheDir: null },
      {
        maxPages: 100, maxDepth: 10, concurrency: 1, userAgent: "t",
        llmsFullMode: "off", llmsIndexMode: "off", scopePrefix: "/docs/",
      },
    );
    const items = [];
    for await (const it of source.iter()) items.push(it);
    expect(items.map((i) => i.srcUri).sort()).toEqual([
      `http://localhost:${port}/docs/`,
      `http://localhost:${port}/docs/a.html`,
    ]);
  });

  test("sitemap with only cross-origin URLs falls back to BFS when unscoped", async () => {
    // Domain-moved site (docf-801): sitemap advertises the new host only.
    // Without a scope prefix the mode decision must still drop cross-origin
    // entries, else sitemap mode is chosen and yields an empty corpus.
    __clearRobotsCache();
    pages = {
      "/sitemap.xml": {
        status: 200,
        ctype: "application/xml",
        body: `<?xml version="1.0"?><urlset xmlns="http://www.sitemaps.org/schemas/sitemap/0.9"><url><loc>http://example.invalid/docs/x.html</loc></url></urlset>`,
      },
      "/": { status: 200, ctype: "text/html", body: `<html><a href="/a.html">a</a></html>` },
      "/a.html": { status: 200, ctype: "text/html", body: `<html>a</html>` },
    };
    const source = new HttpSource(
      `http://localhost:${port}/`,
      { userAgent: "t", timeoutMs: 1_000, maxBytes: 1_000_000, cacheDir: null },
      { maxPages: 100, maxDepth: 10, concurrency: 1, userAgent: "t", llmsFullMode: "off", llmsIndexMode: "off" },
    );
    const items = [];
    for await (const it of source.iter()) items.push(it);
    expect(items.map((i) => i.srcUri).sort()).toEqual([
      `http://localhost:${port}/`,
      `http://localhost:${port}/a.html`,
    ]);
  });

  test("sitemap without scopePrefix is unfiltered (regression)", async () => {
    __clearRobotsCache();
    pages = {
      "/sitemap.xml": {
        status: 200,
        ctype: "application/xml",
        body: `<?xml version="1.0"?><urlset xmlns="http://www.sitemaps.org/schemas/sitemap/0.9"><url><loc>http://localhost:${port}/docs/a.html</loc></url><url><loc>http://localhost:${port}/blog/b.html</loc></url></urlset>`,
      },
      "/docs/": { status: 200, ctype: "text/html", body: `<html>docs</html>` },
      "/docs/a.html": { status: 200, ctype: "text/html", body: `<html>a</html>` },
      "/blog/b.html": { status: 200, ctype: "text/html", body: `<html>b</html>` },
    };
    const source = new HttpSource(
      `http://localhost:${port}/docs/`,
      { userAgent: "t", timeoutMs: 1_000, maxBytes: 1_000_000, cacheDir: null },
      { maxPages: 100, maxDepth: 10, concurrency: 1, userAgent: "t", llmsFullMode: "off", llmsIndexMode: "off" },
    );
    const items = [];
    for await (const it of source.iter()) items.push(it);
    expect(items.map((i) => i.srcUri).sort()).toEqual([
      `http://localhost:${port}/blog/b.html`,
      `http://localhost:${port}/docs/a.html`,
    ]);
  });
});
