import { afterEach, beforeEach, describe, expect, test } from "vitest";
import { createServer, type Server } from "node:http";
import { mkdtempSync, rmSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { AddressInfo } from "node:net";
import { runVlmPass } from "../src/vlm/index.js";
import type { VlmOptions } from "../src/vlm/types.js";
import type { FetchOptions } from "../src/http/fetch.js";

// 1x1 transparent PNG.
const PNG_1x1 = Buffer.from(
  "iVBORw0KGgoAAAANSUhEUgAAAAEAAAABCAQAAAC1HAwCAAAAC0lEQVR42mP8z8BQDwAEhQGAhKmMIQAAAABJRU5ErkJggg==",
  "base64",
);

let server: Server;
let base: string;

beforeEach(async () => {
  server = createServer((req, res) => {
    const path = (req.url ?? "").split("?")[0];
    if (path === "/img.png") {
      res.writeHead(200, { "content-type": "image/png" });
      res.end(PNG_1x1);
      return;
    }
    if (path === "/notimg.png") {
      res.writeHead(200, { "content-type": "text/plain" });
      res.end("not an image");
      return;
    }
    if (path === "/v1/chat/completions") {
      let raw = "";
      req.on("data", (c) => (raw += c));
      req.on("end", () => {
        res.writeHead(200, { "content-type": "application/json" });
        res.end(JSON.stringify({ choices: [{ message: { content: "A tiny test image." } }] }));
      });
      return;
    }
    res.writeHead(404).end();
  });
  await new Promise<void>((r) => server.listen(0, "127.0.0.1", r));
  base = `http://127.0.0.1:${(server.address() as AddressInfo).port}`;
});
afterEach(async () => {
  await new Promise<void>((r) => server.close(() => r()));
});

function fetchOpts(): FetchOptions {
  return { userAgent: "docforge-test/0", timeoutMs: 5000, maxBytes: 10_000_000, cacheDir: null };
}
function vlm(): VlmOptions {
  return { baseUrl: `${base}/v1`, model: "test", minDim: 1, maxImages: 50, concurrency: 2, timeoutMs: 5000 };
}

describe("runVlmPass (real fetch + client wiring)", () => {
  test("describes a relative-URL image and injects a caption", async () => {
    const { md, stats } = await runVlmPass("![Arch](/img.png)", `${base}/page`, vlm(), fetchOpts());
    expect(stats.described).toBe(1);
    expect(md).toContain("> **Figure — Arch.** A tiny test image.");
  });

  test("describes a data: URI image", async () => {
    const dataUri = `data:image/png;base64,${PNG_1x1.toString("base64")}`;
    const { stats } = await runVlmPass(`![d](${dataUri})`, `${base}/page`, vlm(), fetchOpts());
    expect(stats.described).toBe(1);
  });

  test("treats a non-image response as a failure (leaves ref untouched)", async () => {
    const { md, stats } = await runVlmPass("![x](/notimg.png)", `${base}/page`, vlm(), fetchOpts());
    expect(stats.failed).toBe(1);
    expect(md).toBe("![x](/notimg.png)");
  });

  test("caches a description across passes sharing a cacheDir", async () => {
    const dir = mkdtempSync(join(tmpdir(), "docforge-vlm-cache-"));
    try {
      const optsWithCache = { ...fetchOpts(), cacheDir: dir };
      const r1 = await runVlmPass("![Arch](/img.png)", `${base}/page`, vlm(), optsWithCache);
      expect(r1.stats.described).toBe(1);
      const r2 = await runVlmPass("![Arch](/img.png)", `${base}/page`, vlm(), { ...fetchOpts(), cacheDir: dir });
      expect(r2.stats.cached).toBe(1);
      expect(r2.stats.described).toBe(0);
    } finally {
      rmSync(dir, { recursive: true, force: true });
    }
  });
});
