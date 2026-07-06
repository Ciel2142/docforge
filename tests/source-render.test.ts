import { afterAll, beforeAll, beforeEach, describe, expect, test } from "vitest";
import { createServer, type Server } from "node:http";
import { AddressInfo } from "node:net";
import { HttpSource, type SourceItem } from "../src/source.js";
import type { FetchOptions } from "../src/http/fetch.js";
import type { CrawlOptions } from "../src/http/crawl.js";
import type { PageRenderer, RenderResult } from "../src/http/render.js";
import { __clearRobotsCache } from "../src/http/robots.js";

let server: Server;
let base: string;
let pages: Record<string, { body: string; type?: string }> = {};

beforeAll(async () => {
  server = createServer((req, res) => {
    const entry = pages[req.url ?? ""];
    if (!entry) {
      res.writeHead(404);
      res.end();
      return;
    }
    res.writeHead(200, { "Content-Type": entry.type ?? "text/html" });
    res.end(entry.body);
  });
  await new Promise<void>((r) => server.listen(0, r));
  base = `http://localhost:${(server.address() as AddressInfo).port}`;
});

afterAll(async () => {
  await new Promise<void>((r) => server.close(() => r()));
});

beforeEach(() => {
  __clearRobotsCache();
});

const SHELL = `<html><body><div id="root"></div><script src="/app.js"></script></body></html>`;

function fetchOpts(): FetchOptions {
  return { userAgent: "docforge-test/0", timeoutMs: 1_000, maxBytes: 1_000_000, cacheDir: null };
}

function crawlOpts(over: Partial<CrawlOptions> = {}): CrawlOptions {
  return {
    maxPages: 100,
    maxDepth: 10,
    concurrency: 1,
    userAgent: "docforge-test/0",
    llmsFullMode: "off",
    llmsIndexMode: "off",
    renderMode: "auto",
    ...over,
  };
}

function stubRenderer(html = `<html><body><h1>Hydrated</h1><p>${"rendered text ".repeat(20)}</p></body></html>`) {
  const calls: string[] = [];
  const r: PageRenderer & { calls: string[] } = {
    calls,
    render: async (url: string): Promise<RenderResult> => {
      calls.push(url);
      return { bytes: Buffer.from(html, "utf8"), contentType: "text/html" };
    },
  };
  return r;
}

async function collect(src: HttpSource): Promise<SourceItem[]> {
  const items: SourceItem[] = [];
  for await (const item of src.iter()) items.push(item);
  return items;
}

describe("HttpSource with renderer", () => {
  test("singlePage: shell page comes back rendered", async () => {
    pages = { "/p": { body: SHELL } };
    const stub = stubRenderer();
    const src = new HttpSource(`${base}/p`, fetchOpts(), crawlOpts({ singlePage: true }), stub);
    const items = await collect(src);
    expect(items.length).toBe(1);
    expect(items[0].rendered).toBe(true);
    expect(items[0].bytes.toString("utf8")).toContain("Hydrated");
    expect(stub.calls).toEqual([`${base}/p`]);
  });

  test("singlePage: OpenAPI JSON is never rendered, stays openapi kind", async () => {
    pages = { "/spec.json": { body: '{"openapi":"3.0.3","info":{"title":"t","version":"1"},"paths":{}}', type: "application/json" } };
    const stub = stubRenderer();
    const src = new HttpSource(
      `${base}/spec.json`,
      fetchOpts(),
      crawlOpts({ singlePage: true, renderMode: "force" }),
      stub,
    );
    const items = await collect(src);
    expect(items.length).toBe(1);
    expect(items[0].kind).toBe("openapi");
    expect(items[0].rendered).toBeUndefined();
    expect(stub.calls).toEqual([]);
  });

  test("sitemap path: shell pages listed in sitemap come back rendered", async () => {
    pages = {
      "/sitemap.xml": {
        body: `<?xml version="1.0" encoding="UTF-8"?>
<urlset xmlns="http://www.sitemaps.org/schemas/sitemap/0.9">
  <url><loc>${base}/docs/page</loc></url>
</urlset>`,
        type: "application/xml",
      },
      "/docs/page": { body: SHELL },
    };
    const stub = stubRenderer();
    const src = new HttpSource(`${base}/`, fetchOpts(), crawlOpts(), stub);
    const items = await collect(src);
    expect(items.length).toBe(1);
    expect(items[0].srcUri).toBe(`${base}/docs/page`);
    expect(items[0].rendered).toBe(true);
    expect(items[0].bytes.toString("utf8")).toContain("Hydrated");
  });

  test("BFS fallback path propagates rendered flag", async () => {
    // no sitemap.xml → BFS from root; root is a shell; stub reveals no links (leaf render)
    pages = { "/": { body: SHELL } };
    const stub = stubRenderer();
    const src = new HttpSource(`${base}/`, fetchOpts(), crawlOpts(), stub);
    const items = await collect(src);
    expect(items.length).toBe(1);
    expect(items[0].rendered).toBe(true);
  });
});
