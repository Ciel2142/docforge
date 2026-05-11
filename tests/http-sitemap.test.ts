import { afterAll, beforeAll, describe, expect, test } from "vitest";
import { createServer, type Server } from "node:http";
import { AddressInfo } from "node:net";
import { discoverSitemaps } from "../src/http/sitemap.js";
import type { Robots } from "../src/http/robots.js";
import type { FetchOptions } from "../src/http/fetch.js";

let server: Server;
let port: number;
let routes: Record<string, { status: number; body?: string }> = {};

beforeAll(async () => {
  server = createServer((req, res) => {
    const r = routes[req.url ?? ""];
    if (!r) {
      res.writeHead(404);
      res.end();
      return;
    }
    res.writeHead(r.status, { "Content-Type": "application/xml" });
    res.end(r.body ?? "");
  });
  await new Promise<void>((resolve) => server.listen(0, resolve));
  port = (server.address() as AddressInfo).port;
});

afterAll(async () => {
  await new Promise<void>((resolve) => server.close(() => resolve()));
});

function fetchOpts(): FetchOptions {
  return { userAgent: "docforge-test/0", timeoutMs: 1_000, maxBytes: 1_000_000, cacheDir: null };
}

const sitemapXml = (urls: string[]) =>
  `<?xml version="1.0"?><urlset xmlns="http://www.sitemaps.org/schemas/sitemap/0.9">${urls
    .map((u) => `<url><loc>${u}</loc></url>`)
    .join("")}</urlset>`;

function robotsWith(sitemaps: string[]): Robots {
  return {
    isAllowed: () => true,
    getCrawlDelay: () => 0,
    getSitemaps: () => sitemaps,
  };
}

describe("discoverSitemaps", () => {
  test("uses robots-declared sitemap when present", async () => {
    routes = {
      "/custom-sitemap.xml": {
        status: 200,
        body: sitemapXml([`http://localhost:${port}/a`, `http://localhost:${port}/b`]),
      },
    };
    const urls = await discoverSitemaps(
      `http://localhost:${port}/`,
      robotsWith([`http://localhost:${port}/custom-sitemap.xml`]),
      fetchOpts(),
    );
    expect(urls.sort()).toEqual([
      `http://localhost:${port}/a`,
      `http://localhost:${port}/b`,
    ]);
  });

  test("falls back to /sitemap.xml when robots empty", async () => {
    routes = {
      "/sitemap.xml": { status: 200, body: sitemapXml([`http://localhost:${port}/x`]) },
    };
    const urls = await discoverSitemaps(
      `http://localhost:${port}/`,
      robotsWith([]),
      fetchOpts(),
    );
    expect(urls).toEqual([`http://localhost:${port}/x`]);
  });

  test("falls back to /sitemap_index.xml when /sitemap.xml 404", async () => {
    routes = {
      "/sitemap_index.xml": { status: 200, body: sitemapXml([`http://localhost:${port}/y`]) },
    };
    const urls = await discoverSitemaps(
      `http://localhost:${port}/`,
      robotsWith([]),
      fetchOpts(),
    );
    expect(urls).toEqual([`http://localhost:${port}/y`]);
  });

  test("returns empty when all probes miss", async () => {
    routes = {};
    const urls = await discoverSitemaps(
      `http://localhost:${port}/`,
      robotsWith([]),
      fetchOpts(),
    );
    expect(urls).toEqual([]);
  });

  test("returns empty on malformed XML", async () => {
    routes = { "/sitemap.xml": { status: 200, body: "<not-xml" } };
    const urls = await discoverSitemaps(
      `http://localhost:${port}/`,
      robotsWith([]),
      fetchOpts(),
    );
    expect(urls).toEqual([]);
  });
});
