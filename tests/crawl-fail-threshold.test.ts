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

beforeAll(async () => {
  // Inject 500 for 2 of 6 sitemap pages (~33% failure rate).
  srv = await startStaticServer({
    rootDir: join(__dirname, "fixtures/crawl-site"),
    rewriteBase: true,
    inject: {
      "/guide/intro.html": { status: 500 },
      "/api/reference.html": { status: 500 },
    },
  });
});
afterAll(async () => srv.close());
beforeEach(() => {
  __clearRobotsCache();
  tmp = mkdtempSync(join(tmpdir(), "docforge-fail-"));
});
afterEach(() => rmSync(tmp, { recursive: true, force: true }));

describe("--fail-threshold gates exit code", () => {
  test(
    "default 0.10 threshold exits 1 with 33% failures",
    async () => {
      const code = await runConvert(`${srv.baseUrl}/`, {
        output: tmp,
        failThreshold: "0.10",
        maxBytes: "10485760",
        dryRun: false,
        maxPages: "5000",
        maxDepth: "10",
        concurrency: "1",
        cacheDir: join(tmp, ".cache"),
        cache: true,
        userAgent: "docforge-test/0",
        llmsFull: "auto",
      });
      expect(code).toBe(1);
    },
    30_000,
  );

  test(
    "1.0 threshold passes despite failures",
    async () => {
      const code = await runConvert(`${srv.baseUrl}/`, {
        output: tmp,
        failThreshold: "1.0",
        maxBytes: "10485760",
        dryRun: false,
        maxPages: "5000",
        maxDepth: "10",
        concurrency: "1",
        cacheDir: join(tmp, ".cache"),
        cache: true,
        userAgent: "docforge-test/0",
        llmsFull: "auto",
      });
      expect(code).toBe(0);
    },
    30_000,
  );
});
