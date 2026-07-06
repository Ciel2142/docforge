import { afterAll, beforeAll, describe, expect, test, vi } from "vitest";
import { createServer, type Server } from "node:http";
import { AddressInfo } from "node:net";
import { crawlBfs } from "../src/http/crawl.js";
import type { Robots } from "../src/http/robots.js";
import type { FetchOptions } from "../src/http/fetch.js";

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
  await new Promise<void>((resolve) => server.listen(0, resolve));
  port = (server.address() as AddressInfo).port;
});

afterAll(async () => {
  await new Promise<void>((resolve) => server.close(() => resolve()));
});

function allowAll(disallowed: string[] = []): Robots {
  return {
    isAllowed: (url) => !disallowed.some((d) => new URL(url).pathname.startsWith(d)),
    getCrawlDelay: () => 0,
    getSitemaps: () => [],
  };
}

function fetchOpts(): FetchOptions {
  return { userAgent: "docforge-test/0", timeoutMs: 1_000, maxBytes: 1_000_000, cacheDir: null };
}

async function collect(rootUrl: string, robots: Robots, opts: Partial<{
  maxPages: number;
  maxDepth: number;
  concurrency: number;
  scopePrefix: string;
}> = {}): Promise<string[]> {
  const seen: string[] = [];
  for await (const item of crawlBfs(rootUrl, robots, fetchOpts(), {
    maxPages: opts.maxPages ?? 100,
    maxDepth: opts.maxDepth ?? 10,
    concurrency: opts.concurrency ?? 1,
    userAgent: "docforge-test/0",
    llmsFullMode: "off" as const,
    ...(opts.scopePrefix !== undefined ? { scopePrefix: opts.scopePrefix } : {}),
  })) {
    seen.push(item.url);
  }
  return seen.sort();
}

describe("crawlBfs", () => {
  test("discovers all linked same-origin pages", async () => {
    pages = {
      "/": `<html><a href="/a">a</a><a href="/b">b</a></html>`,
      "/a": `<html><a href="/c">c</a></html>`,
      "/b": `<html>b</html>`,
      "/c": `<html>c</html>`,
    };
    const urls = await collect(`http://localhost:${port}/`, allowAll());
    expect(urls).toEqual([
      `http://localhost:${port}/`,
      `http://localhost:${port}/a`,
      `http://localhost:${port}/b`,
      `http://localhost:${port}/c`,
    ]);
  });

  test("dedups repeated links", async () => {
    pages = {
      "/": `<html><a href="/a">x</a><a href="/a#frag">y</a><a href="/a?q=1">z</a></html>`,
      "/a": `<html>a</html>`,
    };
    const urls = await collect(`http://localhost:${port}/`, allowAll());
    expect(urls).toEqual([
      `http://localhost:${port}/`,
      `http://localhost:${port}/a`,
    ]);
  });

  test("rejects cross-origin links", async () => {
    pages = {
      "/": `<html><a href="https://other.com/x">x</a><a href="/a">a</a></html>`,
      "/a": `<html>a</html>`,
    };
    const urls = await collect(`http://localhost:${port}/`, allowAll());
    expect(urls).toEqual([
      `http://localhost:${port}/`,
      `http://localhost:${port}/a`,
    ]);
  });

  test("respects robots disallow", async () => {
    pages = {
      "/": `<html><a href="/private/p">p</a><a href="/ok">o</a></html>`,
      "/private/p": `<html>p</html>`,
      "/ok": `<html>o</html>`,
    };
    const urls = await collect(`http://localhost:${port}/`, allowAll(["/private/"]));
    expect(urls).toEqual([
      `http://localhost:${port}/`,
      `http://localhost:${port}/ok`,
    ]);
  });

  test("maxPages clamps yield count", async () => {
    pages = {
      "/": `<html><a href="/a">a</a><a href="/b">b</a><a href="/c">c</a></html>`,
      "/a": `<html>a</html>`,
      "/b": `<html>b</html>`,
      "/c": `<html>c</html>`,
    };
    const urls = await collect(`http://localhost:${port}/`, allowAll(), { maxPages: 2 });
    expect(urls.length).toBe(2);
  });

  test("maxDepth halts deeper enqueue", async () => {
    pages = {
      "/": `<html><a href="/a">a</a></html>`,
      "/a": `<html><a href="/b">b</a></html>`,
      "/b": `<html><a href="/c">c</a></html>`,
      "/c": `<html>c</html>`,
    };
    const urls = await collect(`http://localhost:${port}/`, allowAll(), { maxDepth: 1 });
    expect(urls).toEqual([
      `http://localhost:${port}/`,
      `http://localhost:${port}/a`,
    ]);
  });

  test("scopePrefix restricts link admission to the prefix subtree", async () => {
    pages = {
      "/docs/": `<html><a href="/docs/a">a</a><a href="/blog/b">b</a></html>`,
      "/docs/a": `<html>a</html>`,
      "/blog/b": `<html>b</html>`,
    };
    const urls = await collect(`http://localhost:${port}/docs/`, allowAll(), {
      scopePrefix: "/docs/",
    });
    expect(urls).toEqual([
      `http://localhost:${port}/docs/`,
      `http://localhost:${port}/docs/a`,
    ]);
  });

  test("honors <base href> when resolving relative links", async () => {
    // SPA pattern (e.g. angular.io): <base href="/"> + relative hrefs. Browser
    // resolves "docs" to /docs; resolving against the page URL instead yields
    // junk like /guide/docs (docf-qmj).
    pages = {
      "/guide/page": `<html><head><base href="/"></head><body><a href="docs">d</a><a href="start/routing">r</a></body></html>`,
      "/docs": `<html>docs</html>`,
      "/start/routing": `<html>routing</html>`,
      "/guide/docs": `<html>wrong</html>`,
      "/guide/start/routing": `<html>wrong</html>`,
    };
    const urls = await collect(`http://localhost:${port}/guide/page`, allowAll());
    expect(urls).toEqual([
      `http://localhost:${port}/docs`,
      `http://localhost:${port}/guide/page`,
      `http://localhost:${port}/start/routing`,
    ]);
  });

  test("resolves a relative <base href> against the page URL", async () => {
    pages = {
      "/a/page": `<html><head><base href="sub/"></head><body><a href="x">x</a></body></html>`,
      "/a/sub/x": `<html>x</html>`,
    };
    const urls = await collect(`http://localhost:${port}/a/page`, allowAll());
    expect(urls).toEqual([
      `http://localhost:${port}/a/page`,
      `http://localhost:${port}/a/sub/x`,
    ]);
  });

  test("ignores an unparseable <base href>", async () => {
    pages = {
      "/p": `<html><head><base href="mailto:x"></head><body><a href="/a">a</a></body></html>`,
      "/a": `<html>a</html>`,
    };
    const urls = await collect(`http://localhost:${port}/p`, allowAll());
    expect(urls).toEqual([`http://localhost:${port}/p`, `http://localhost:${port}/a`].sort());
  });

  test("warns when scopePrefix excludes every same-origin link (1-page crawl)", async () => {
    pages = {
      "/guide/page": `<html><a href="/docs">d</a><a href="/start">s</a></html>`,
      "/docs": `<html>d</html>`,
      "/start": `<html>s</html>`,
    };
    const spy = vi.spyOn(console, "error").mockImplementation(() => {});
    try {
      const urls = await collect(`http://localhost:${port}/guide/page`, allowAll(), {
        scopePrefix: "/guide/page/",
      });
      expect(urls).toEqual([`http://localhost:${port}/guide/page`]);
      const warned = spy.mock.calls.some(
        (c) => String(c[0]).includes("WARN") && String(c[0]).includes("--scope origin"),
      );
      expect(warned).toBe(true);
    } finally {
      spy.mockRestore();
    }
  });

  test("does not warn when scope admits links", async () => {
    pages = {
      "/docs/": `<html><a href="/docs/a">a</a></html>`,
      "/docs/a": `<html>a</html>`,
    };
    const spy = vi.spyOn(console, "error").mockImplementation(() => {});
    try {
      await collect(`http://localhost:${port}/docs/`, allowAll(), { scopePrefix: "/docs/" });
      const warned = spy.mock.calls.some((c) => String(c[0]).includes("--scope origin"));
      expect(warned).toBe(false);
    } finally {
      spy.mockRestore();
    }
  });

  test("without scopePrefix the whole origin is crawled (regression)", async () => {
    pages = {
      "/docs/": `<html><a href="/docs/a">a</a><a href="/blog/b">b</a></html>`,
      "/docs/a": `<html>a</html>`,
      "/blog/b": `<html>b</html>`,
    };
    const urls = await collect(`http://localhost:${port}/docs/`, allowAll());
    expect(urls).toEqual([
      `http://localhost:${port}/blog/b`,
      `http://localhost:${port}/docs/`,
      `http://localhost:${port}/docs/a`,
    ]);
  });
});
