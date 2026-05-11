import { afterAll, beforeAll, describe, expect, test } from "vitest";
import { createServer, type Server } from "node:http";
import { AddressInfo } from "node:net";
import { mkdtempSync, rmSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { getRobots, __clearRobotsCache } from "../src/http/robots.js";
import type { FetchOptions } from "../src/http/fetch.js";

let server: Server;
let port: number;
let cacheDir: string;
let robotsBody: string | 404 = "User-agent: *\nDisallow:";

beforeAll(async () => {
  cacheDir = mkdtempSync(join(tmpdir(), "docforge-robots-"));
  server = createServer((req, res) => {
    if (req.url === "/robots.txt") {
      if (robotsBody === 404) {
        res.writeHead(404);
        res.end();
        return;
      }
      res.writeHead(200, { "Content-Type": "text/plain" });
      res.end(robotsBody);
      return;
    }
    res.writeHead(404);
    res.end();
  });
  await new Promise<void>((resolve) => server.listen(0, resolve));
  port = (server.address() as AddressInfo).port;
});

afterAll(async () => {
  await new Promise<void>((resolve) => server.close(() => resolve()));
  rmSync(cacheDir, { recursive: true, force: true });
});

function opts(): FetchOptions {
  return { userAgent: "docforge-test/0", timeoutMs: 1_000, maxBytes: 100_000, cacheDir: null };
}

describe("getRobots", () => {
  test("allow-all when robots.txt is 404", async () => {
    __clearRobotsCache();
    robotsBody = 404;
    const r = await getRobots(`http://localhost:${port}`, opts());
    expect(r.isAllowed(`http://localhost:${port}/any`, "docforge")).toBe(true);
    expect(r.getCrawlDelay("docforge")).toBe(0);
    expect(r.getSitemaps()).toEqual([]);
  });

  test("Disallow rule denies matching path", async () => {
    __clearRobotsCache();
    robotsBody = "User-agent: *\nDisallow: /private/\nAllow: /";
    const r = await getRobots(`http://localhost:${port}`, opts());
    expect(r.isAllowed(`http://localhost:${port}/private/secret`, "docforge")).toBe(false);
    expect(r.isAllowed(`http://localhost:${port}/public`, "docforge")).toBe(true);
  });

  test("Crawl-delay parsed", async () => {
    __clearRobotsCache();
    robotsBody = "User-agent: *\nCrawl-delay: 2";
    const r = await getRobots(`http://localhost:${port}`, opts());
    expect(r.getCrawlDelay("docforge")).toBe(2);
  });

  test("Sitemap directives extracted", async () => {
    __clearRobotsCache();
    robotsBody = "Sitemap: http://localhost/sitemap.xml\nSitemap: http://localhost/sitemap2.xml";
    const r = await getRobots(`http://localhost:${port}`, opts());
    expect(r.getSitemaps()).toEqual([
      "http://localhost/sitemap.xml",
      "http://localhost/sitemap2.xml",
    ]);
  });
});
