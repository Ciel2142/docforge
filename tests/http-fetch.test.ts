import { afterAll, beforeAll, describe, expect, test } from "vitest";
import { createServer, type Server } from "node:http";
import { mkdtempSync, rmSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { AddressInfo } from "node:net";
import { fetchUrl, FetchError, type FetchOptions } from "../src/http/fetch.js";

let server: Server;
let port: number;
let cacheDir: string;
let hits: { method: string; url: string; ifNoneMatch?: string }[] = [];

beforeAll(async () => {
  cacheDir = mkdtempSync(join(tmpdir(), "docforge-fetch-"));
  server = createServer((req, res) => {
    hits.push({
      method: req.method ?? "GET",
      url: req.url ?? "",
      ifNoneMatch: req.headers["if-none-match"] as string | undefined,
    });
    const url = req.url ?? "";
    if (url === "/ok") {
      const etag = '"v1"';
      if (req.headers["if-none-match"] === etag) {
        res.writeHead(304, { ETag: etag });
        res.end();
        return;
      }
      res.writeHead(200, { "Content-Type": "text/html; charset=utf-8", ETag: etag });
      res.end("<html>hi</html>");
      return;
    }
    if (url === "/notfound") {
      res.writeHead(404);
      res.end();
      return;
    }
    if (url === "/big") {
      res.writeHead(200, { "Content-Type": "text/html" });
      res.end("X".repeat(2_000_000));
      return;
    }
    if (url === "/slow") {
      setTimeout(() => {
        res.writeHead(200, { "Content-Type": "text/html" });
        res.end("ok");
      }, 200);
      return;
    }
    if (url === "/5xx") {
      res.writeHead(503);
      res.end();
      return;
    }
    res.writeHead(500);
    res.end();
  });
  await new Promise<void>((resolve) => server.listen(0, resolve));
  port = (server.address() as AddressInfo).port;
});

afterAll(async () => {
  await new Promise<void>((resolve) => server.close(() => resolve()));
  rmSync(cacheDir, { recursive: true, force: true });
});

function opts(overrides: Partial<FetchOptions> = {}): FetchOptions {
  return {
    userAgent: "docforge-test/0",
    timeoutMs: 1_000,
    maxBytes: 1_000_000,
    cacheDir,
    ...overrides,
  };
}

describe("fetchUrl", () => {
  test("200 returns body + contentType + etag", async () => {
    hits = [];
    const result = await fetchUrl(`http://localhost:${port}/ok`, opts({ cacheDir: null }));
    expect(result.status).toBe(200);
    expect(result.bytes.toString("utf8")).toBe("<html>hi</html>");
    expect(result.contentType).toMatch(/^text\/html/);
    expect(result.etag).toBe('"v1"');
    expect(result.fromCache).toBe(false);
  });

  test("304 round-trip via on-disk cache", async () => {
    hits = [];
    const url = `http://localhost:${port}/ok`;
    const first = await fetchUrl(url, opts());
    expect(first.status).toBe(200);
    expect(first.fromCache).toBe(false);
    const second = await fetchUrl(url, opts());
    expect(second.status).toBe(200);
    expect(second.bytes.toString("utf8")).toBe("<html>hi</html>");
    expect(second.fromCache).toBe(true);
    const conditional = hits.find((h) => h.ifNoneMatch === '"v1"');
    expect(conditional).toBeDefined();
  });

  test("404 throws FetchError with status", async () => {
    await expect(
      fetchUrl(`http://localhost:${port}/notfound`, opts({ cacheDir: null })),
    ).rejects.toMatchObject({ name: "FetchError", status: 404 });
  });

  test("max-bytes enforced", async () => {
    await expect(
      fetchUrl(`http://localhost:${port}/big`, opts({ cacheDir: null, maxBytes: 1024 })),
    ).rejects.toMatchObject({ name: "FetchError" });
  });

  test("timeout throws FetchError", async () => {
    await expect(
      fetchUrl(`http://localhost:${port}/slow`, opts({ cacheDir: null, timeoutMs: 50 })),
    ).rejects.toMatchObject({ name: "FetchError" });
  });
});
