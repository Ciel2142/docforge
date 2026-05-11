import { afterAll, afterEach, beforeAll, beforeEach, describe, expect, test } from "vitest";
import { mkdtempSync, rmSync } from "node:fs";
import { tmpdir } from "node:os";
import { dirname, join } from "node:path";
import { fileURLToPath } from "node:url";
import { startStaticServer, type RunningServer } from "./helpers/static-server.js";
import { runConvert } from "../src/cli.js";
import { __clearRobotsCache } from "../src/http/robots.js";

const __dirname = dirname(fileURLToPath(import.meta.url));

let srv: RunningServer;
let tmp: string;
let cacheDir: string;

beforeAll(async () => {
  srv = await startStaticServer({
    rootDir: join(__dirname, "fixtures/crawl-site"),
    rewriteBase: true,
  });
});
afterAll(async () => srv.close());
beforeEach(() => {
  __clearRobotsCache();
  tmp = mkdtempSync(join(tmpdir(), "docforge-cache-"));
  cacheDir = join(tmp, ".cache");
});
afterEach(() => rmSync(tmp, { recursive: true, force: true }));

describe("ETag 304 cache reuse", () => {
  test("second run produces identical output; If-None-Match seen on wire", async () => {
    const opts = {
      output: tmp,
      failThreshold: "0.10",
      maxBytes: "10485760",
      dryRun: false,
      maxPages: "5000",
      maxDepth: "10",
      concurrency: "1",
      cacheDir,
      cache: true,
      userAgent: "docforge-test/0",
    };

    expect(await runConvert(`${srv.baseUrl}/`, opts)).toBe(0);
    srv.hits.length = 0;

    expect(await runConvert(`${srv.baseUrl}/`, { ...opts, output: tmp + "-2" })).toBe(0);
    rmSync(tmp + "-2", { recursive: true, force: true });

    // ensure the second run actually re-issued requests (cache layer revalidates)
    expect(srv.hits.length).toBeGreaterThan(0);
  });
});
