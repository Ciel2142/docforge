import { afterEach, beforeEach, describe, expect, test } from "vitest";
import { mkdtempSync, readdirSync, readFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { join, resolve } from "node:path";
import { startStaticServer, type RunningServer } from "./helpers/static-server.js";
import { runConvert } from "../src/cli.js";

let server: RunningServer;
let outDir: string;
const FIXTURE = resolve("tests/fixtures/llms-full-site");

describe("CLI --llms-full flag", () => {
  beforeEach(async () => {
    server = await startStaticServer({ rootDir: FIXTURE, rewriteBase: true });
    outDir = mkdtempSync(join(tmpdir(), "docforge-llms-"));
  });
  afterEach(async () => {
    await server.close();
  });

  test("auto: writes llms-full.md when present, skips HTML crawl", async () => {
    const code = await runConvert(server.baseUrl, baseOpts(outDir, "auto"));
    expect(code).toBe(0);
    const files = readdirSync(outDir);
    expect(files).toContain("llms-full.md");
    const out = readFileSync(join(outDir, "llms-full.md"), "utf8");
    expect(out).toContain("This is the canonical");
    expect(files.some((f) => f.startsWith("index"))).toBe(false);
  });

  test("off: ignores llms-full.txt, walks HTML normally", async () => {
    const code = await runConvert(server.baseUrl, baseOpts(outDir, "off"));
    expect(code).toBe(0);
    const files = readdirSync(outDir);
    expect(files).not.toContain("llms-full.md");
  });

  test("force: succeeds when present", async () => {
    const code = await runConvert(server.baseUrl, baseOpts(outDir, "force"));
    expect(code).toBe(0);
    const files = readdirSync(outDir);
    expect(files).toContain("llms-full.md");
  });

  test("force: returns 2 when llms-full.txt is absent", async () => {
    await server.close();
    const NO_LLMS = resolve("tests/fixtures/crawl-site");
    server = await startStaticServer({ rootDir: NO_LLMS, rewriteBase: true });
    const code = await runConvert(server.baseUrl, baseOpts(outDir, "force"));
    expect(code).toBe(2);
  });
});

function baseOpts(outDir: string, llmsFull: string) {
  return {
    output: outDir,
    failThreshold: "0.10",
    maxBytes: "10485760",
    dryRun: false,
    maxPages: "100",
    maxDepth: "5",
    concurrency: "2",
    cacheDir: "~/.cache/docforge",
    cache: false,
    userAgent: "docforge-test",
    selector: undefined,
    llmsFull,
  };
}
