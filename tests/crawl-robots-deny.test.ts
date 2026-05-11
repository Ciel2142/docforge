import { afterAll, afterEach, beforeAll, beforeEach, describe, expect, test } from "vitest";
import { mkdtempSync, rmSync, existsSync, readFileSync } from "node:fs";
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
  // robots.txt in the fixture already disallows /private/.
  // Add a link to /private/secret.html from index by injection.
  srv = await startStaticServer({
    rootDir: join(__dirname, "fixtures/crawl-site"),
    rewriteBase: true,
    inject: {
      "/sitemap.xml": { status: 404 },
      "/sitemap_index.xml": { status: 404 },
      "/": {
        status: 200,
        body: `<html><head><title>Home</title></head><body>
<div role="main"><div itemprop="articleBody">
<h1>Home</h1>
<a href="/guide/">G</a>
<a href="/private/secret.html">Secret</a>
</div></div></body></html>`,
      },
    },
  });
});
afterAll(async () => srv.close());
beforeEach(() => {
  __clearRobotsCache();
  tmp = mkdtempSync(join(tmpdir(), "docforge-deny-"));
});
afterEach(() => rmSync(tmp, { recursive: true, force: true }));

describe("robots.txt Disallow is honored during crawl", () => {
  test("/private/* not fetched, not converted, not in report", async () => {
    const reportPath = join(tmp, "report.json");
    const code = await runConvert(`${srv.baseUrl}/`, {
      output: tmp,
      failThreshold: "0.10",
      maxBytes: "10485760",
      dryRun: false,
      reportJson: reportPath,
      maxPages: "5000",
      maxDepth: "10",
      concurrency: "1",
      cacheDir: join(tmp, ".cache"),
      cache: true,
      userAgent: "docforge-test/0",
      llmsFull: "auto",
    });
    expect(code).toBe(0);
    expect(existsSync(join(tmp, "private", "secret.md"))).toBe(false);
    const report = JSON.parse(readFileSync(reportPath, "utf8"));
    const denied = report.entries.find((e: { srcUri: string }) =>
      e.srcUri.includes("/private/"),
    );
    expect(denied).toBeUndefined();
  });
});
