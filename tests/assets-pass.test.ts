import { afterEach, beforeEach, describe, expect, test } from "vitest";
import { createServer, type Server } from "node:http";
import { AddressInfo } from "node:net";
import { mkdirSync, mkdtempSync, readdirSync, rmSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { pathToFileURL } from "node:url";
import { runAssetPass } from "../src/assets/index.js";
import { AssetStore } from "../src/assets/store.js";
import type { FetchOptions } from "../src/http/fetch.js";

const PNG_1x1 = Buffer.from(
  "iVBORw0KGgoAAAANSUhEUgAAAAEAAAABCAQAAAC1HAwCAAAAC0lEQVR42mP8z8BQDwAEhQGAhKmMIQAAAABJRU5ErkJggg==",
  "base64",
);

let tmp: string;
let server: Server;
let base: string;

beforeEach(async () => {
  tmp = mkdtempSync(join(tmpdir(), "docforge-assetpass-"));
  server = createServer((req, res) => {
    const p = (req.url ?? "").split("?")[0];
    if (p === "/img.png") { res.writeHead(200, { "content-type": "image/png" }); res.end(PNG_1x1); return; }
    if (p === "/notimg.png") { res.writeHead(200, { "content-type": "text/html" }); res.end("<html/>"); return; }
    res.writeHead(404).end();
  });
  await new Promise<void>((r) => server.listen(0, "127.0.0.1", r));
  base = `http://127.0.0.1:${(server.address() as AddressInfo).port}`;
});
afterEach(async () => {
  await new Promise<void>((r) => server.close(() => r()));
  rmSync(tmp, { recursive: true, force: true });
});

function fetchOpts(): FetchOptions {
  return { userAgent: "docforge-test/0", timeoutMs: 5000, maxBytes: 10_000_000, cacheDir: null };
}

describe("runAssetPass resolver", () => {
  test("data: URI → saved + embed", async () => {
    const store = new AssetStore(tmp);
    const uri = `data:image/png;base64,${PNG_1x1.toString("base64")}`;
    const { md, stats } = await runAssetPass(`![d](${uri})`, `${base}/page`, { fetchOpts: fetchOpts() }, store);
    expect(stats.saved).toBe(1);
    expect(md).toMatch(/!\[\[[0-9a-f]{16}\.png\]\]/);
  });

  test("http image → fetched + saved", async () => {
    const store = new AssetStore(tmp);
    const { stats } = await runAssetPass("![a](/img.png)", `${base}/page`, { fetchOpts: fetchOpts() }, store);
    expect(stats.saved).toBe(1);
    expect(readdirSync(join(tmp, "_assets"))).toHaveLength(1);
  });

  test("http non-image response → failed, ref kept", async () => {
    const store = new AssetStore(tmp);
    const { md, stats } = await runAssetPass("![a](/notimg.png)", `${base}/page`, { fetchOpts: fetchOpts() }, store);
    expect(stats.failed).toBe(1);
    expect(md).toBe("![a](/notimg.png)");
  });

  test("file:// origin → reads a relative image from disk", async () => {
    mkdirSync(join(tmp, "sub"), { recursive: true });
    writeFileSync(join(tmp, "sub", "logo.png"), PNG_1x1);
    const docUrl = pathToFileURL(join(tmp, "sub", "page.html")).toString();
    const store = new AssetStore(tmp);
    const { md, stats } = await runAssetPass("![L](logo.png)", docUrl, {}, store);
    expect(stats.saved).toBe(1);
    expect(md).toMatch(/!\[\[[0-9a-f]{16}\.png\]\]/);
  });

  test("docforge.invalid sentinel → resolved against sourceRoot", async () => {
    mkdirSync(join(tmp, "img"), { recursive: true });
    writeFileSync(join(tmp, "img", "x.png"), PNG_1x1);
    const store = new AssetStore(tmp);
    const { stats } = await runAssetPass(
      "![s](http://docforge.invalid/img/x.png)",
      "http://docforge.invalid/page.html",
      { sourceRoot: tmp },
      store,
    );
    expect(stats.saved).toBe(1);
  });
});
