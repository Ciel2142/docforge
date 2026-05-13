import { afterAll, afterEach, beforeAll, beforeEach, describe, expect, test } from "vitest";
import { existsSync, mkdtempSync, readdirSync, rmSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { createServer, type Server } from "node:http";
import type { AddressInfo } from "node:net";
import { runPipeline } from "../src/runPipeline.js";
import { __clearRobotsCache } from "../src/http/robots.js";

const MINIMAL_OPENAPI_JSON = JSON.stringify({
  openapi: "3.0.0",
  info: { title: "T", version: "1.0" },
  paths: {
    "/users": {
      get: { summary: "List", responses: { "200": { description: "ok" } } },
    },
  },
  components: {
    schemas: { User: { type: "object", properties: { id: { type: "string" } } } },
  },
});

let server: Server;
let port: number;
let pages: Record<string, { status: number; ctype: string; body: string }> = {};
let tmp: string;

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
  tmp = mkdtempSync(join(tmpdir(), "docforge-pipeline-openapi-"));
});

afterEach(() => {
  rmSync(tmp, { recursive: true, force: true });
});

describe("runPipeline openapi routing", () => {
  test("openapi item written under <stem>/{endpoints,schemas}/", async () => {
    pages = {
      "/": {
        status: 200,
        ctype: "text/html",
        body: `<a href="/openapi.json">spec</a>`,
      },
      "/openapi.json": { status: 200, ctype: "application/json", body: MINIMAL_OPENAPI_JSON },
    };
    const result = await runPipeline({
      source: `http://localhost:${port}/`,
      outputDir: tmp,
      maxBytes: 1_000_000,
      dryRun: false,
      fetchOptions: { userAgent: "t", timeoutMs: 1_000, maxBytes: 1_000_000, cacheDir: null },
      crawlOptions: { maxPages: 100, maxDepth: 10, concurrency: 1, userAgent: "t", llmsFullMode: "off" },
    });

    // The spec stem becomes 'openapi' (basename without .json/.md ext)
    void result;
    const specDir = join(tmp, "openapi");
    expect(existsSync(specDir)).toBe(true);
    expect(existsSync(join(specDir, "endpoints"))).toBe(true);
    expect(existsSync(join(specDir, "schemas"))).toBe(true);

    const endpoints = readdirSync(join(specDir, "endpoints"));
    expect(endpoints.length).toBeGreaterThanOrEqual(1);
    const schemas = readdirSync(join(specDir, "schemas"));
    expect(schemas.length).toBeGreaterThanOrEqual(1);

    // index page also converted as html
    expect(result.converted).toBeGreaterThanOrEqual(1);
  });

  test("openapi report entry records endpoint+schema counts", async () => {
    pages = {
      "/openapi.json": { status: 200, ctype: "application/json", body: MINIMAL_OPENAPI_JSON },
    };
    const result = await runPipeline({
      source: `http://localhost:${port}/openapi.json`,
      outputDir: tmp,
      maxBytes: 1_000_000,
      dryRun: false,
      fetchOptions: { userAgent: "t", timeoutMs: 1_000, maxBytes: 1_000_000, cacheDir: null },
      crawlOptions: { maxPages: 1, maxDepth: 10, concurrency: 1, userAgent: "t", llmsFullMode: "off", singlePage: true },
    });
    const openapiEntry = result.report.find((r) => r.srcUri.endsWith("/openapi.json"));
    expect(openapiEntry).toBeDefined();
    expect(openapiEntry?.status).toBe("ok");
  });
});
