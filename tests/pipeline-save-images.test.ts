import { afterEach, beforeEach, describe, expect, test } from "vitest";
import { createServer, type Server } from "node:http";
import { AddressInfo } from "node:net";
import { existsSync, mkdirSync, mkdtempSync, readFileSync, rmSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { createHash } from "node:crypto";
import { runPipeline } from "../src/runPipeline.js";
import { __clearRobotsCache } from "../src/http/robots.js";

const PNG_1x1 = Buffer.from(
  "iVBORw0KGgoAAAANSUhEUgAAAAEAAAABCAQAAAC1HAwCAAAAC0lEQVR42mP8z8BQDwAEhQGAhKmMIQAAAABJRU5ErkJggg==",
  "base64",
);
const HASH = createHash("sha256").update(PNG_1x1).digest("hex").slice(0, 16);
const PAD = "word ".repeat(40);
const PAGE = `<!DOCTYPE html><html><head><title>About UI</title></head><body>
<main><h1>About UI</h1><p>${PAD}</p>
<p><img src="img/logo.png" alt="Logo"></p>
<p>${PAD}</p></main></body></html>`;

let tmp: string;
beforeEach(() => { __clearRobotsCache(); tmp = mkdtempSync(join(tmpdir(), "docforge-saveimg-")); });
afterEach(() => { rmSync(tmp, { recursive: true, force: true }); });

function writeCorpus() {
  const inDir = join(tmp, "in");
  const outDir = join(tmp, "out");
  mkdirSync(join(inDir, "user-interface", "img"), { recursive: true });
  writeFileSync(join(inDir, "user-interface", "about.html"), PAGE);
  writeFileSync(join(inDir, "user-interface", "img", "logo.png"), PNG_1x1);
  return { inDir, outDir };
}

describe("runPipeline --save-images (obsidian, local source)", () => {
  test("copies the PNG into _assets and rewrites the ref to an embed", async () => {
    const { inDir, outDir } = writeCorpus();
    const res = await runPipeline({
      source: inDir, outputDir: outDir, maxBytes: 10485760, dryRun: false,
      format: "obsidian", saveImages: true,
    });
    expect(existsSync(join(outDir, "_assets", `${HASH}.png`))).toBe(true);
    const out = readFileSync(join(outDir, "user-interface", "about.md"), "utf8");
    expect(out).toContain(`![[${HASH}.png]]`);
    expect(res.assets?.saved).toBe(1);
  });

  test("no _assets and no stats when saveImages is off", async () => {
    const { inDir, outDir } = writeCorpus();
    const res = await runPipeline({
      source: inDir, outputDir: outDir, maxBytes: 10485760, dryRun: false, format: "obsidian",
    });
    expect(existsSync(join(outDir, "_assets"))).toBe(false);
    expect(res.assets).toBeUndefined();
  });

  test("default format ignores saveImages", async () => {
    const { inDir, outDir } = writeCorpus();
    const res = await runPipeline({
      source: inDir, outputDir: outDir, maxBytes: 10485760, dryRun: false, saveImages: true,
    });
    expect(existsSync(join(outDir, "_assets"))).toBe(false);
    expect(res.assets).toBeUndefined();
  });
});

describe("runPipeline --save-images (obsidian, URL source)", () => {
  let server: Server;
  let base: string;
  const URL_PAGE = `<!DOCTYPE html><html><head><title>Arch</title></head><body>
<main><h1>Arch</h1><p>${PAD}</p><p><img src="/img.png" alt="Arch"></p><p>${PAD}</p></main></body></html>`;

  beforeEach(async () => {
    server = createServer((req, res) => {
      const p = (req.url ?? "").split("?")[0];
      if (p === "/robots.txt") { res.writeHead(200, { "content-type": "text/plain" }); res.end(""); return; }
      if (p === "/") { res.writeHead(200, { "content-type": "text/html; charset=utf-8" }); res.end(URL_PAGE); return; }
      if (p === "/img.png") { res.writeHead(200, { "content-type": "image/png" }); res.end(PNG_1x1); return; }
      res.writeHead(404).end();
    });
    await new Promise<void>((r) => server.listen(0, "127.0.0.1", r));
    base = `http://127.0.0.1:${(server.address() as AddressInfo).port}`;
  });
  afterEach(async () => { await new Promise<void>((r) => server.close(() => r())); });

  test("fetches the image, writes _assets, and embeds it", async () => {
    const outDir = join(tmp, "out");
    const res = await runPipeline({
      source: `${base}/`,
      outputDir: outDir,
      maxBytes: 10485760,
      dryRun: false,
      format: "obsidian",
      saveImages: true,
      fetchOptions: { userAgent: "docforge-test/0", timeoutMs: 5000, maxBytes: 10_000_000, cacheDir: null },
      crawlOptions: { maxPages: 1, maxDepth: 1, concurrency: 1, userAgent: "docforge-test/0", llmsFullMode: "off" },
    });
    expect(res.assets?.saved).toBe(1);
    expect(existsSync(join(outDir, "_assets", `${HASH}.png`))).toBe(true);
    const out = readFileSync(join(outDir, "index.md"), "utf8");
    expect(out).toContain(`![[${HASH}.png]]`);
  });
});
