import { afterAll, beforeAll, describe, expect, test } from "vitest";
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
}> = {}): Promise<string[]> {
  const seen: string[] = [];
  for await (const item of crawlBfs(rootUrl, robots, fetchOpts(), {
    maxPages: opts.maxPages ?? 100,
    maxDepth: opts.maxDepth ?? 10,
    concurrency: opts.concurrency ?? 1,
    userAgent: "docforge-test/0",
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
});
