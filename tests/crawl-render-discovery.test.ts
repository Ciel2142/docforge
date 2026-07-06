import { afterAll, beforeAll, describe, expect, test } from "vitest";
import { createServer, type Server } from "node:http";
import { AddressInfo } from "node:net";
import { crawlBfs, type CrawlItem, type CrawlOptions } from "../src/http/crawl.js";
import type { Robots } from "../src/http/robots.js";
import type { FetchOptions } from "../src/http/fetch.js";
import type { PageRenderer, RenderResult } from "../src/http/render.js";

let server: Server;
let port: number;
let pages: Record<string, string> = {};

beforeAll(async () => {
  server = createServer((req, res) => {
    const body = pages[req.url ?? ""];
    if (body === undefined) {
      res.writeHead(404);
      res.end();
      return;
    }
    res.writeHead(200, { "Content-Type": "text/html" });
    res.end(body);
  });
  await new Promise<void>((r) => server.listen(0, r));
  port = (server.address() as AddressInfo).port;
});

afterAll(async () => {
  await new Promise<void>((r) => server.close(() => r()));
});

const allowAll: Robots = {
  isAllowed: () => true,
  getCrawlDelay: () => 0,
  getSitemaps: () => [],
};

function fetchOpts(): FetchOptions {
  return { userAgent: "docforge-test/0", timeoutMs: 1_000, maxBytes: 1_000_000, cacheDir: null };
}

function crawlOpts(renderMode?: "auto" | "force"): CrawlOptions {
  return {
    maxPages: 100,
    maxDepth: 10,
    concurrency: 1,
    userAgent: "docforge-test/0",
    llmsFullMode: "off",
    ...(renderMode ? { renderMode } : {}),
  };
}

const SHELL = `<html><body><div id="root"></div><script src="/app.js"></script></body></html>`;
const RICH = `<html><body>${"leaf page static content ".repeat(15)}</body></html>`;

// Stub: rendering the shell root reveals nav anchors; any other URL renders to a plain leaf.
function stubRenderer(rootPath: string) {
  const calls: string[] = [];
  const renderer: PageRenderer & { calls: string[] } = {
    calls,
    render: async (url: string): Promise<RenderResult> => {
      calls.push(url);
      const html =
        new URL(url).pathname === rootPath
          ? `<html><body><nav><a href="/a">a</a><a href="/b">b</a></nav><p>${"hydrated home ".repeat(20)}</p></body></html>`
          : `<html><body>${"hydrated leaf ".repeat(20)}</body></html>`;
      return { bytes: Buffer.from(html, "utf8"), contentType: "text/html" };
    },
  };
  return renderer;
}

async function collect(
  renderMode: "auto" | "force" | undefined,
  renderer: PageRenderer | null,
): Promise<CrawlItem[]> {
  const items: CrawlItem[] = [];
  for await (const item of crawlBfs(
    `http://localhost:${port}/`,
    allowAll,
    fetchOpts(),
    crawlOpts(renderMode),
    renderer,
  )) {
    items.push(item);
  }
  return items.sort((x, y) => x.url.localeCompare(y.url));
}

describe("crawlBfs with renderer", () => {
  test("SPA shell without render mode: crawl dies at root (baseline)", async () => {
    pages = { "/": SHELL, "/a": RICH, "/b": RICH };
    const items = await collect(undefined, null);
    expect(items.map((i) => i.url)).toEqual([`http://localhost:${port}/`]);
  });

  test("auto mode: rendered root reveals links, BFS discovers them", async () => {
    pages = { "/": SHELL, "/a": RICH, "/b": RICH };
    const stub = stubRenderer("/");
    const items = await collect("auto", stub);
    expect(items.map((i) => i.url)).toEqual([
      `http://localhost:${port}/`,
      `http://localhost:${port}/a`,
      `http://localhost:${port}/b`,
    ]);
    const root = items.find((i) => i.url === `http://localhost:${port}/`)!;
    const leaf = items.find((i) => i.url === `http://localhost:${port}/a`)!;
    expect(root.rendered).toBe(true);
    expect(leaf.rendered).toBeUndefined(); // rich static leaf → heuristic negative
    expect(stub.calls).toEqual([`http://localhost:${port}/`]);
  });

  test("force mode: every HTML page rendered", async () => {
    pages = { "/": SHELL, "/a": RICH, "/b": RICH };
    const stub = stubRenderer("/");
    const items = await collect("force", stub);
    expect(items.length).toBe(3);
    expect(items.every((i) => i.rendered === true)).toBe(true);
    expect(stub.calls.length).toBe(3);
  });
});
