import { afterAll, afterEach, beforeAll, beforeEach, describe, expect, test } from "vitest";
import { mkdtempSync, readFileSync, rmSync, existsSync } from "node:fs";
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
  });
});
afterAll(async () => {
  await srv.close();
});
beforeEach(() => {
  __clearRobotsCache();
  tmp = mkdtempSync(join(tmpdir(), "docforge-e2e-"));
});
afterEach(() => {
  rmSync(tmp, { recursive: true, force: true });
});

describe("convert URL e2e (sitemap path)", () => {
  test("converts all sitemap entries to mirrored .md tree", async () => {
    const code = await runConvert(`${srv.baseUrl}/`, {
      output: tmp,
      failThreshold: "0.10",
      maxBytes: "10485760",
      dryRun: false,
      reportJson: join(tmp, "report.json"),
      maxPages: "5000",
      maxDepth: "10",
      concurrency: "4",
      cacheDir: join(tmp, ".cache"),
      cache: true,
      userAgent: "docforge-test/0",
      llmsFull: "auto",
    });
    expect(code).toBe(0);
    expect(existsSync(join(tmp, "index.md"))).toBe(true);
    expect(existsSync(join(tmp, "guide", "index.md"))).toBe(true);
    expect(existsSync(join(tmp, "guide", "intro.md"))).toBe(true);
    expect(existsSync(join(tmp, "guide", "advanced.md"))).toBe(true);
    expect(existsSync(join(tmp, "api", "index.md"))).toBe(true);
    expect(existsSync(join(tmp, "api", "reference.md"))).toBe(true);
    // private/ is disallowed in robots — must not appear
    expect(existsSync(join(tmp, "private", "secret.md"))).toBe(false);

    const report = JSON.parse(readFileSync(join(tmp, "report.json"), "utf8"));
    expect(report.entries.length).toBeGreaterThanOrEqual(6);
    const okEntries = report.entries.filter((e: { status: string }) => e.status === "ok");
    expect(okEntries.length).toBeGreaterThanOrEqual(6);
    expect(okEntries[0].srcUri.startsWith("http://")).toBe(true);
  });
});
