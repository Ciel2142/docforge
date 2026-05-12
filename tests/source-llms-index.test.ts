import { afterAll, beforeAll, beforeEach, describe, expect, test } from "vitest";
import { createServer, type Server } from "node:http";
import type { AddressInfo } from "node:net";
import { HttpSource } from "../src/source.js";
import { __clearRobotsCache } from "../src/http/robots.js";

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

beforeEach(() => {
  __clearRobotsCache();
});

const fetchOpts = (): { userAgent: string; timeoutMs: number; maxBytes: number; cacheDir: null } => ({
  userAgent: "t",
  timeoutMs: 1_000,
  maxBytes: 1_000_000,
  cacheDir: null,
});

describe("HttpSource llms-index mode", () => {
  test("auto: fetches each link in llms.txt as a separate page", async () => {
    pages = {
      "/llms.txt": {
        status: 200,
        ctype: "text/plain",
        body: `# x\n\n## Docs\n\n- [A](http://localhost:${port}/a.html)\n- [B](http://localhost:${port}/b.html)\n`,
      },
      "/a.html": { status: 200, ctype: "text/html", body: `<html>A</html>` },
      "/b.html": { status: 200, ctype: "text/html", body: `<html>B</html>` },
    };
    const source = new HttpSource(
      `http://localhost:${port}/`,
      fetchOpts(),
      { maxPages: 100, maxDepth: 10, concurrency: 2, userAgent: "t", llmsFullMode: "off", llmsIndexMode: "auto" },
    );
    const items = [];
    for await (const it of source.iter()) items.push(it);
    expect(items.map((i) => i.srcUri).sort()).toEqual([
      `http://localhost:${port}/a.html`,
      `http://localhost:${port}/b.html`,
    ]);
    expect(items.every((i) => i.bytes.length > 0)).toBe(true);
  });

  test("auto: llms-full takes priority when both exist", async () => {
    pages = {
      "/llms-full.txt": { status: 200, ctype: "text/plain", body: `# Full dump` },
      "/llms.txt": {
        status: 200,
        ctype: "text/plain",
        body: `# x\n\n- [A](http://localhost:${port}/a.html)\n`,
      },
      "/a.html": { status: 200, ctype: "text/html", body: `<html>A</html>` },
    };
    const source = new HttpSource(
      `http://localhost:${port}/`,
      fetchOpts(),
      { maxPages: 100, maxDepth: 10, concurrency: 1, userAgent: "t", llmsFullMode: "auto", llmsIndexMode: "auto" },
    );
    const items = [];
    for await (const it of source.iter()) items.push(it);
    expect(items).toHaveLength(1);
    expect(items[0].kind).toBe("llms-full");
  });

  test("force: throws when llms.txt missing", async () => {
    pages = {};
    const source = new HttpSource(
      `http://localhost:${port}/`,
      fetchOpts(),
      { maxPages: 100, maxDepth: 10, concurrency: 1, userAgent: "t", llmsFullMode: "off", llmsIndexMode: "force" },
    );
    await expect(async () => {
      for await (const _ of source.iter()) { /* drain */ }
    }).rejects.toThrow(/llms\.txt required/);
  });

  test("off: bypasses llms-index probe and falls through to crawl", async () => {
    pages = {
      "/llms.txt": {
        status: 200,
        ctype: "text/plain",
        body: `# x\n\n- [A](http://localhost:${port}/a.html)\n`,
      },
      "/": { status: 200, ctype: "text/html", body: `<a href="/b.html">b</a>` },
      "/a.html": { status: 200, ctype: "text/html", body: `<html>A</html>` },
      "/b.html": { status: 200, ctype: "text/html", body: `<html>B</html>` },
    };
    const source = new HttpSource(
      `http://localhost:${port}/`,
      fetchOpts(),
      { maxPages: 100, maxDepth: 10, concurrency: 1, userAgent: "t", llmsFullMode: "off", llmsIndexMode: "off" },
    );
    const items = [];
    for await (const it of source.iter()) items.push(it);
    // BFS path: root + b.html (linked from root). a.html not reached because not linked.
    expect(items.map((i) => i.srcUri).sort()).toEqual([
      `http://localhost:${port}/`,
      `http://localhost:${port}/b.html`,
    ]);
  });

  test("respects maxPages clamp", async () => {
    pages = {
      "/llms.txt": {
        status: 200,
        ctype: "text/plain",
        body: `# x\n\n- [A](http://localhost:${port}/a.html)\n- [B](http://localhost:${port}/b.html)\n- [C](http://localhost:${port}/c.html)\n`,
      },
      "/a.html": { status: 200, ctype: "text/html", body: `<html>A</html>` },
      "/b.html": { status: 200, ctype: "text/html", body: `<html>B</html>` },
      "/c.html": { status: 200, ctype: "text/html", body: `<html>C</html>` },
    };
    const source = new HttpSource(
      `http://localhost:${port}/`,
      fetchOpts(),
      { maxPages: 2, maxDepth: 10, concurrency: 1, userAgent: "t", llmsFullMode: "off", llmsIndexMode: "auto" },
    );
    const items = [];
    for await (const it of source.iter()) items.push(it);
    expect(items).toHaveLength(2);
  });

  test("sets outputKey with host prefix so cross-host links do not collide", async () => {
    pages = {
      "/llms.txt": {
        status: 200,
        ctype: "text/plain",
        body: `# x\n\n- [A](http://localhost:${port}/)\n- [B](http://127.0.0.1:${port}/)\n`,
      },
      "/": { status: 200, ctype: "text/html", body: `<html>root</html>` },
    };
    const source = new HttpSource(
      `http://localhost:${port}/`,
      fetchOpts(),
      { maxPages: 100, maxDepth: 10, concurrency: 1, userAgent: "t", llmsFullMode: "off", llmsIndexMode: "auto" },
    );
    const items = [];
    for await (const it of source.iter()) items.push(it);
    const keys = items.map((i) => i.outputKey).sort();
    expect(keys).toEqual([`127.0.0.1/index.md`, `localhost/index.md`]);
  });

  test("skips non-html non-markdown links (e.g. PDF) but still yields siblings", async () => {
    pages = {
      "/llms.txt": {
        status: 200,
        ctype: "text/plain",
        body: `# x\n\n- [HTML](http://localhost:${port}/page.html)\n- [PDF](http://localhost:${port}/doc.pdf)\n`,
      },
      "/page.html": { status: 200, ctype: "text/html", body: `<html>P</html>` },
      "/doc.pdf": { status: 200, ctype: "application/pdf", body: `%PDF` },
    };
    const source = new HttpSource(
      `http://localhost:${port}/`,
      fetchOpts(),
      { maxPages: 100, maxDepth: 10, concurrency: 1, userAgent: "t", llmsFullMode: "off", llmsIndexMode: "auto" },
    );
    const items = [];
    for await (const it of source.iter()) items.push(it);
    expect(items.map((i) => i.srcUri)).toEqual([`http://localhost:${port}/page.html`]);
    expect(source.skippedCount).toBe(1);
  });

  test("accepts text/markdown links and flags them with kind=markdown", async () => {
    pages = {
      "/llms.txt": {
        status: 200,
        ctype: "text/plain",
        body: `# x\n\n- [HTML](http://localhost:${port}/page.html)\n- [MD](http://localhost:${port}/doc.md)\n`,
      },
      "/page.html": { status: 200, ctype: "text/html", body: `<html>P</html>` },
      "/doc.md": { status: 200, ctype: "text/markdown; charset=utf-8", body: `# Doc\n\nbody.` },
    };
    const source = new HttpSource(
      `http://localhost:${port}/`,
      fetchOpts(),
      { maxPages: 100, maxDepth: 10, concurrency: 1, userAgent: "t", llmsFullMode: "off", llmsIndexMode: "auto" },
    );
    const items = [];
    for await (const it of source.iter()) items.push(it);
    items.sort((a, b) => a.srcUri.localeCompare(b.srcUri));
    expect(items.map((i) => i.srcUri)).toEqual([
      `http://localhost:${port}/doc.md`,
      `http://localhost:${port}/page.html`,
    ]);
    expect(items[0].kind).toBe("markdown");
    expect(items[1].kind).toBeUndefined();
  });
});
