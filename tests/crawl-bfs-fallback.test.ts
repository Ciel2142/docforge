import { afterAll, afterEach, beforeAll, beforeEach, describe, expect, test } from "vitest";
import { mkdtempSync, rmSync, existsSync } from "node:fs";
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
  srv = await startStaticServer({
    rootDir: join(__dirname, "fixtures/crawl-site"),
    rewriteBase: true,
    inject: {
      "/sitemap.xml": { status: 404 },
      "/sitemap_index.xml": { status: 404 },
    },
  });
});
afterAll(async () => {
  await srv.close();
});
beforeEach(() => {
  __clearRobotsCache();
  tmp = mkdtempSync(join(tmpdir(), "docforge-bfs-"));
});
afterEach(() => {
  rmSync(tmp, { recursive: true, force: true });
});

describe("BFS fallback when sitemap is absent", () => {
  test("discovers all pages via <a href> graph", async () => {
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
    });
    expect(code).toBe(0);
    expect(existsSync(join(tmp, "index.md"))).toBe(true);
    expect(existsSync(join(tmp, "guide", "index.md"))).toBe(true);
    expect(existsSync(join(tmp, "guide", "intro.md"))).toBe(true);
    expect(existsSync(join(tmp, "api", "reference.md"))).toBe(true);
  });
});
