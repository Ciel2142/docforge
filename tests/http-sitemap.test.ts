import { afterAll, beforeAll, describe, expect, test } from "vitest";
import { createServer, type Server } from "node:http";
import { AddressInfo } from "node:net";
import { discoverSitemaps } from "../src/http/sitemap.js";
import type { Robots } from "../src/http/robots.js";
import type { FetchOptions } from "../src/http/fetch.js";

let server: Server;
let port: number;
let routes: Record<string, { status: number; body?: string; requireAuth?: string }> = {};
let hits: { url: string; authorization?: string }[] = [];

beforeAll(async () => {
  server = createServer((req, res) => {
    hits.push({
      url: req.url ?? "",
      authorization: req.headers["authorization"] as string | undefined,
    });
    const r = routes[req.url ?? ""];
    if (!r) {
      res.writeHead(404);
      res.end();
      return;
    }
    if (r.requireAuth && req.headers["authorization"] !== r.requireAuth) {
      res.writeHead(401);
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

describe("discoverSitemaps auth", () => {
  test("forwards the auth header to an auth-gated sitemap on the matching origin", async () => {
    hits = [];
    const origin = `http://localhost:${port}`;
    routes = {
      "/sitemap.xml": {
        status: 200,
        body: sitemapXml([`${origin}/a`]),
        requireAuth: "Bearer testtoken",
      },
    };
    const urls = await discoverSitemaps(`${origin}/`, robotsWith([]), {
      ...fetchOpts(),
      auth: { header: "Bearer testtoken", origin },
    });
    expect(urls).toEqual([`${origin}/a`]);
    const hit = hits.find((h) => h.url === "/sitemap.xml");
    expect(hit?.authorization).toBe("Bearer testtoken");
  });

  test("omits the auth header when the sitemap origin does not match the auth origin", async () => {
    hits = [];
    const origin = `http://localhost:${port}`;
    routes = {
      "/sitemap.xml": { status: 200, body: sitemapXml([`${origin}/x`]) },
    };
    await discoverSitemaps(`${origin}/`, robotsWith([]), {
      ...fetchOpts(),
      auth: { header: "Bearer testtoken", origin: "http://other.example" },
    });
    const hit = hits.find((h) => h.url === "/sitemap.xml");
    expect(hit?.authorization).toBeUndefined();
  });

  test("skips a malformed robots-declared sitemap URL and falls through to /sitemap.xml", async () => {
    hits = [];
    const origin = `http://localhost:${port}`;
    routes = {
      "/sitemap.xml": { status: 200, body: sitemapXml([`${origin}/ok`]) },
    };
    const urls = await discoverSitemaps(`${origin}/`, robotsWith(["not a valid url"]), {
      ...fetchOpts(),
      auth: { header: "Bearer testtoken", origin },
    });
    expect(urls).toEqual([`${origin}/ok`]);
  });
});
