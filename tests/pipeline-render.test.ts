import { afterAll, afterEach, beforeAll, beforeEach, describe, expect, test } from "vitest";
import { createServer, type Server } from "node:http";
import { AddressInfo } from "node:net";
import { mkdtempSync, readFileSync, rmSync, existsSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { runPipeline } from "../src/runPipeline.js";
import type { RenderResult } from "../src/http/render.js";
import { __clearRobotsCache } from "../src/http/robots.js";

let server: Server;
let base: string;
let tmp: string;

const SHELL = `<html><body><div id="root"></div><script src="/app.js"></script></body></html>`;
const HYDRATED = `<!doctype html><html><head><title>Home</title></head><body><main>
<h1>Hydrated Home</h1>
<p>${"This paragraph exists only after client-side rendering has completed. ".repeat(8)}</p>
<p>${"More rendered documentation content for the extractor to keep. ".repeat(8)}</p>
</main></body></html>`;

beforeAll(async () => {
  server = createServer((req, res) => {
    if (req.url === "/") {
      res.writeHead(200, { "Content-Type": "text/html" });
      res.end(SHELL);
      return;
    }
    res.writeHead(404);
    res.end();
  });
  await new Promise<void>((r) => server.listen(0, r));
  base = `http://localhost:${(server.address() as AddressInfo).port}`;
});

afterAll(async () => {
  await new Promise<void>((r) => server.close(() => r()));
});

beforeEach(() => {
  __clearRobotsCache();
  tmp = mkdtempSync(join(tmpdir(), "docforge-render-"));
});

afterEach(() => {
  rmSync(tmp, { recursive: true, force: true });
});

function makeStub() {
  const calls: string[] = [];
  let closed = false;
  return {
    calls,
    get closed() {
      return closed;
    },
    render: async (url: string): Promise<RenderResult> => {
      calls.push(url);
      return { bytes: Buffer.from(HYDRATED, "utf8"), contentType: "text/html" };
    },
    close: async () => {
      closed = true;
    },
  };
}

function pipelineOpts(stub: ReturnType<typeof makeStub>, renderMode?: "auto" | "force") {
  return {
    source: `${base}/`,
    outputDir: tmp,
    maxBytes: 10_485_760,
    dryRun: false,
    fetchOptions: {
      userAgent: "docforge-test/0",
      timeoutMs: 1_000,
      maxBytes: 10_485_760,
      cacheDir: null,
    },
    crawlOptions: {
      maxPages: 10,
      maxDepth: 2,
      concurrency: 1,
      userAgent: "docforge-test/0",
      llmsFullMode: "off" as const,
      llmsIndexMode: "off" as const,
      ...(renderMode ? { renderMode } : {}),
    },
    renderer: stub,
  };
}

describe("runPipeline render integration", () => {
  test("auto mode: converts rendered content, counts it, flags report, closes renderer", async () => {
    const stub = makeStub();
    const result = await runPipeline(pipelineOpts(stub, "auto"));
    expect(result.converted).toBe(1);
    expect(result.rendered).toBe(1);
    expect(result.report[0].rendered).toBe(true);
    expect(stub.calls).toEqual([`${base}/`]);
    expect(stub.closed).toBe(true);
    expect(existsSync(join(tmp, "index.md"))).toBe(true);
    const md = readFileSync(join(tmp, "index.md"), "utf8");
    expect(md).toContain("Hydrated Home");
  });

  test("no renderMode: rendered stat absent, renderer unused", async () => {
    const stub = makeStub();
    const result = await runPipeline(pipelineOpts(stub, undefined));
    expect(result.rendered).toBeUndefined();
    expect(stub.calls).toEqual([]);
  });
});
