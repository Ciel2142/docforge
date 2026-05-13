import { afterAll, afterEach, beforeAll, beforeEach, describe, expect, test } from "vitest";
import { createServer, type Server } from "node:http";
import type { AddressInfo } from "node:net";
import { HttpSource } from "../src/source.js";
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

const MINIMAL_OPENAPI_YAML = `openapi: "3.0.0"
info:
  title: T
  version: "1.0"
paths:
  /users:
    get:
      summary: List
      responses:
        "200":
          description: ok
`;

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

const fetchOpts = () => ({
  userAgent: "t",
  timeoutMs: 1_000,
  maxBytes: 1_000_000,
  cacheDir: null,
});

describe("HttpSource openapi detection", () => {
  test("BFS yields kind=openapi for application/json with openapi:3.x", async () => {
    pages = {
      "/": {
        status: 200,
        ctype: "text/html",
        body: `<a href="/openapi.json">spec</a>`,
      },
      "/openapi.json": { status: 200, ctype: "application/json", body: MINIMAL_OPENAPI_JSON },
    };
    const source = new HttpSource(
      `http://localhost:${port}/`,
      fetchOpts(),
      { maxPages: 100, maxDepth: 10, concurrency: 1, userAgent: "t", llmsFullMode: "off" },
    );
    const items: Array<{ kind?: string; srcUri: string }> = [];
    for await (const it of source.iter()) items.push(it);
    const spec = items.find((i) => i.srcUri.endsWith("/openapi.json"));
    expect(spec).toBeDefined();
    expect(spec?.kind).toBe("openapi");
  });

  test("BFS skips application/json without openapi key (still skippedCount++)", async () => {
    pages = {
      "/": {
        status: 200,
        ctype: "text/html",
        body: `<a href="/data.json">data</a>`,
      },
      "/data.json": {
        status: 200,
        ctype: "application/json",
        body: JSON.stringify({ foo: "bar" }),
      },
    };
    const source = new HttpSource(
      `http://localhost:${port}/`,
      fetchOpts(),
      { maxPages: 100, maxDepth: 10, concurrency: 1, userAgent: "t", llmsFullMode: "off" },
    );
    const items: Array<{ kind?: string; srcUri: string }> = [];
    for await (const it of source.iter()) items.push(it);
    expect(items.some((i) => i.srcUri.endsWith("/data.json"))).toBe(false);
    expect(source.skippedCount).toBeGreaterThanOrEqual(1);
  });

  test("BFS yields kind=openapi for application/yaml body", async () => {
    pages = {
      "/": {
        status: 200,
        ctype: "text/html",
        body: `<a href="/openapi.yaml">spec</a>`,
      },
      "/openapi.yaml": { status: 200, ctype: "application/yaml", body: MINIMAL_OPENAPI_YAML },
    };
    const source = new HttpSource(
      `http://localhost:${port}/`,
      fetchOpts(),
      { maxPages: 100, maxDepth: 10, concurrency: 1, userAgent: "t", llmsFullMode: "off" },
    );
    const items: Array<{ kind?: string; srcUri: string }> = [];
    for await (const it of source.iter()) items.push(it);
    const spec = items.find((i) => i.srcUri.endsWith("/openapi.yaml"));
    expect(spec?.kind).toBe("openapi");
  });

  test("BFS yields kind=openapi when ctype is generic but path ends .json", async () => {
    pages = {
      "/": {
        status: 200,
        ctype: "text/html",
        body: `<a href="/spec.json">spec</a>`,
      },
      "/spec.json": {
        status: 200,
        ctype: "application/octet-stream",
        body: MINIMAL_OPENAPI_JSON,
      },
    };
    const source = new HttpSource(
      `http://localhost:${port}/`,
      fetchOpts(),
      { maxPages: 100, maxDepth: 10, concurrency: 1, userAgent: "t", llmsFullMode: "off" },
    );
    const items: Array<{ kind?: string; srcUri: string }> = [];
    for await (const it of source.iter()) items.push(it);
    const spec = items.find((i) => i.srcUri.endsWith("/spec.json"));
    expect(spec?.kind).toBe("openapi");
  });

  test("singlePage yields kind=openapi when seed is a spec", async () => {
    pages = {
      "/openapi.json": { status: 200, ctype: "application/json", body: MINIMAL_OPENAPI_JSON },
    };
    const source = new HttpSource(
      `http://localhost:${port}/openapi.json`,
      fetchOpts(),
      { maxPages: 1, maxDepth: 10, concurrency: 1, userAgent: "t", llmsFullMode: "off", singlePage: true },
    );
    const items: Array<{ kind?: string; srcUri: string }> = [];
    for await (const it of source.iter()) items.push(it);
    expect(items).toHaveLength(1);
    expect(items[0].kind).toBe("openapi");
  });

  test("Swagger 2.0 json is skipped (not openapi 3.x)", async () => {
    pages = {
      "/": {
        status: 200,
        ctype: "text/html",
        body: `<a href="/swagger.json">spec</a>`,
      },
      "/swagger.json": {
        status: 200,
        ctype: "application/json",
        body: JSON.stringify({ swagger: "2.0", paths: {} }),
      },
    };
    const source = new HttpSource(
      `http://localhost:${port}/`,
      fetchOpts(),
      { maxPages: 100, maxDepth: 10, concurrency: 1, userAgent: "t", llmsFullMode: "off" },
    );
    const items: Array<{ kind?: string; srcUri: string }> = [];
    for await (const it of source.iter()) items.push(it);
    expect(items.some((i) => i.srcUri.endsWith("/swagger.json"))).toBe(false);
  });

  test("malformed JSON is skipped", async () => {
    pages = {
      "/": {
        status: 200,
        ctype: "text/html",
        body: `<a href="/broken.json">spec</a>`,
      },
      "/broken.json": {
        status: 200,
        ctype: "application/json",
        body: `not valid json {`,
      },
    };
    const source = new HttpSource(
      `http://localhost:${port}/`,
      fetchOpts(),
      { maxPages: 100, maxDepth: 10, concurrency: 1, userAgent: "t", llmsFullMode: "off" },
    );
    const items: Array<{ kind?: string; srcUri: string }> = [];
    for await (const it of source.iter()) items.push(it);
    expect(items.some((i) => i.srcUri.endsWith("/broken.json"))).toBe(false);
  });
});
