import { afterEach, beforeEach, describe, expect, test } from "vitest";
import { existsSync, mkdtempSync, rmSync } from "node:fs";
import { tmpdir } from "node:os";
import { join, resolve } from "node:path";
import { startStaticServer, type RunningServer } from "./helpers/static-server.js";
import { runConvert } from "../src/cli.js";

let server: RunningServer;
let outDir: string;
const FIXTURE = resolve("tests/fixtures/crawl-site");

describe("CLI --scope flag", () => {
  beforeEach(async () => {
    server = await startStaticServer({ rootDir: FIXTURE, rewriteBase: true });
    outDir = mkdtempSync(join(tmpdir(), "docforge-scope-"));
  });
  afterEach(async () => {
    await server.close();
    rmSync(outDir, { recursive: true, force: true });
  });

  test("default scope=path: seed /guide/ converts only guide pages", async () => {
    const code = await runConvert(`${server.baseUrl}/guide/`, baseOpts(outDir));
    expect(code).toBe(0);
    expect(existsSync(join(outDir, "guide/index.md"))).toBe(true);
    expect(existsSync(join(outDir, "guide/intro.md"))).toBe(true);
    expect(existsSync(join(outDir, "guide/advanced.md"))).toBe(true);
    expect(existsSync(join(outDir, "api/reference.md"))).toBe(false);
    expect(existsSync(join(outDir, "index.md"))).toBe(false);
  });

  test("--scope origin: seed /guide/ converts the whole origin", async () => {
    const code = await runConvert(`${server.baseUrl}/guide/`, baseOpts(outDir, "origin"));
    expect(code).toBe(0);
    expect(existsSync(join(outDir, "guide/intro.md"))).toBe(true);
    expect(existsSync(join(outDir, "api/reference.md"))).toBe(true);
    expect(existsSync(join(outDir, "index.md"))).toBe(true);
  });

  test("invalid --scope value returns 2", async () => {
    const code = await runConvert(`${server.baseUrl}/guide/`, baseOpts(outDir, "banana"));
    expect(code).toBe(2);
  });
});

function baseOpts(outDir: string, scope?: string) {
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
    llmsFull: "off",
    ...(scope !== undefined ? { scope } : {}),
  };
}
