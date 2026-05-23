import { afterEach, beforeEach, describe, expect, test } from "vitest";
import { createServer, type Server } from "node:http";
import { AddressInfo } from "node:net";
import { mkdtempSync, readFileSync, rmSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { runPipeline } from "../src/runPipeline.js";
import { __clearRobotsCache } from "../src/http/robots.js";

const PNG_1x1 = Buffer.from(
  "iVBORw0KGgoAAAANSUhEUgAAAAEAAAABCAQAAAC1HAwCAAAAC0lEQVR42mP8z8BQDwAEhQGAhKmMIQAAAABJRU5ErkJggg==",
  "base64",
);
const PAGE =
  `<!doctype html><html><head><title>Arch Page</title></head><body><main>` +
  `<h1>Arch Page</h1>` +
  `<p>The deployment topology below shows the system layout in good and clear detail.</p>` +
  `<img src="/img.png" alt="Arch">` +
  `<p>More body text after the figure to comfortably exceed the word-count threshold.</p>` +
  `</main></body></html>`;

let server: Server;
let base: string;
let tmp: string;

beforeEach(async () => {
  __clearRobotsCache();
  tmp = mkdtempSync(join(tmpdir(), "docforge-vlm-pipe-"));
  server = createServer((req, res) => {
    const path = (req.url ?? "").split("?")[0];
    if (path === "/robots.txt") { res.writeHead(200, { "content-type": "text/plain" }); res.end(""); return; }
    if (path === "/") { res.writeHead(200, { "content-type": "text/html; charset=utf-8" }); res.end(PAGE); return; }
    if (path === "/img.png") { res.writeHead(200, { "content-type": "image/png" }); res.end(PNG_1x1); return; }
    if (path === "/v1/chat/completions") {
      let raw = ""; req.on("data", (c) => (raw += c));
      req.on("end", () => { res.writeHead(200, { "content-type": "application/json" }); res.end(JSON.stringify({ choices: [{ message: { content: "A tiny architecture diagram." } }] })); });
      return;
    }
    res.writeHead(404).end();
  });
  await new Promise<void>((r) => server.listen(0, "127.0.0.1", r));
  base = `http://127.0.0.1:${(server.address() as AddressInfo).port}`;
});
afterEach(async () => {
  await new Promise<void>((r) => server.close(() => r()));
  rmSync(tmp, { recursive: true, force: true });
});

function fetchOptions() {
  return { userAgent: "docforge-test/0", timeoutMs: 5000, maxBytes: 10_000_000, cacheDir: null };
}
function crawlOptions() {
  return { maxPages: 1, maxDepth: 1, concurrency: 1, userAgent: "docforge-test/0", llmsFullMode: "off" as const };
}

describe("runPipeline VLM integration", () => {
  test("injects a caption block into the written Markdown when vlm is set", async () => {
    const result = await runPipeline({
      source: `${base}/`,
      outputDir: tmp,
      maxBytes: 10_000_000,
      dryRun: false,
      fetchOptions: fetchOptions(),
      crawlOptions: crawlOptions(),
      vlm: { baseUrl: `${base}/v1`, model: "test", minDim: 1, maxImages: 50, concurrency: 2, timeoutMs: 5000 },
    });
    expect(result.vlm?.described).toBe(1);
    expect(result.vlm?.cached).toBe(0);
    const out = readFileSync(join(tmp, "index.md"), "utf8");
    expect(out).toContain("![Arch]");
    expect(out).toContain("> **Figure — Arch.** A tiny architecture diagram.");
  });

  test("leaves the image untouched and reports no vlm stats when vlm is unset", async () => {
    const result = await runPipeline({
      source: `${base}/`,
      outputDir: tmp,
      maxBytes: 10_000_000,
      dryRun: false,
      fetchOptions: fetchOptions(),
      crawlOptions: crawlOptions(),
    });
    expect(result.vlm).toBeUndefined();
    const out = readFileSync(join(tmp, "index.md"), "utf8");
    expect(out).toContain("![Arch]");
    expect(out).not.toContain("> **Figure");
  });
});
