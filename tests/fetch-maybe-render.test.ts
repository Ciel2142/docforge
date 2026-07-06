import { afterAll, beforeAll, describe, expect, test } from "vitest";
import { createServer, type Server } from "node:http";
import { AddressInfo } from "node:net";
import { FetchError, type FetchOptions } from "../src/http/fetch.js";
import { fetchMaybeRender, type RenderResult } from "../src/http/render.js";

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

const SHELL = `<html><body><div id="root"></div><script src="/x.js"></script></body></html>`;
const RICH = `<html><body><main>${"real static documentation content here ".repeat(10)}</main></body></html>`;

function fetchOpts(): FetchOptions {
  return { userAgent: "docforge-test/0", timeoutMs: 1_000, maxBytes: 1_000_000, cacheDir: null };
}

function stubRenderer(html = "<html><body><h1>Rendered</h1></body></html>") {
  const calls: string[] = [];
  return {
    calls,
    render: async (url: string): Promise<RenderResult> => {
      calls.push(url);
      return { bytes: Buffer.from(html, "utf8"), contentType: "text/html" };
    },
  };
}

function failingRenderer() {
  const calls: string[] = [];
  return {
    calls,
    render: async (url: string): Promise<RenderResult> => {
      calls.push(url);
      throw new Error("boom");
    },
  };
}

describe("fetchMaybeRender", () => {
  test("mode undefined → static bytes, renderer never called", async () => {
    pages = { "/p": { body: SHELL } };
    const stub = stubRenderer();
    const res = await fetchMaybeRender(`${base}/p`, fetchOpts(), undefined, stub);
    expect(res.bytes.toString("utf8")).toBe(SHELL);
    expect(res.rendered).toBeUndefined();
    expect(stub.calls).toEqual([]);
  });

  test("auto + rich static page → not rendered", async () => {
    pages = { "/p": { body: RICH } };
    const stub = stubRenderer();
    const res = await fetchMaybeRender(`${base}/p`, fetchOpts(), "auto", stub);
    expect(res.bytes.toString("utf8")).toBe(RICH);
    expect(stub.calls).toEqual([]);
  });

  test("auto + shell page → rendered bytes, rendered flag, one call", async () => {
    pages = { "/p": { body: SHELL } };
    const stub = stubRenderer();
    const res = await fetchMaybeRender(`${base}/p`, fetchOpts(), "auto", stub);
    expect(res.bytes.toString("utf8")).toContain("Rendered");
    expect(res.rendered).toBe(true);
    expect(stub.calls).toEqual([`${base}/p`]);
  });

  test("auto + render failure → static bytes fallback, no throw", async () => {
    pages = { "/p": { body: SHELL } };
    const stub = failingRenderer();
    const res = await fetchMaybeRender(`${base}/p`, fetchOpts(), "auto", stub);
    expect(res.bytes.toString("utf8")).toBe(SHELL);
    expect(res.rendered).toBeUndefined();
    expect(stub.calls.length).toBe(1);
  });

  test("force + rich page → rendered anyway", async () => {
    pages = { "/p": { body: RICH } };
    const stub = stubRenderer();
    const res = await fetchMaybeRender(`${base}/p`, fetchOpts(), "force", stub);
    expect(res.rendered).toBe(true);
    expect(stub.calls.length).toBe(1);
  });

  test("force + render failure → rejects with FetchError", async () => {
    pages = { "/p": { body: SHELL } };
    const stub = failingRenderer();
    await expect(
      fetchMaybeRender(`${base}/p`, fetchOpts(), "force", stub),
    ).rejects.toBeInstanceOf(FetchError);
  });

  test("non-HTML response never rendered even in force mode", async () => {
    pages = { "/spec.json": { body: '{"openapi":"3.0.0"}', type: "application/json" } };
    const stub = stubRenderer();
    const res = await fetchMaybeRender(`${base}/spec.json`, fetchOpts(), "force", stub);
    expect(res.bytes.toString("utf8")).toBe('{"openapi":"3.0.0"}');
    expect(res.rendered).toBeUndefined();
    expect(stub.calls).toEqual([]);
  });
});
