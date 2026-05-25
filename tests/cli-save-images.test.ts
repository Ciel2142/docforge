import { afterEach, beforeEach, describe, expect, test } from "vitest";
import { existsSync, mkdirSync, mkdtempSync, readdirSync, rmSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { runConvert } from "../src/cli.js";

const PNG_1x1 = Buffer.from(
  "iVBORw0KGgoAAAANSUhEUgAAAAEAAAABCAQAAAC1HAwCAAAAC0lEQVR42mP8z8BQDwAEhQGAhKmMIQAAAABJRU5ErkJggg==",
  "base64",
);
const PAGE = `<!DOCTYPE html><html><head><title>T</title></head><body><main><h1>T</h1>` +
  `<p>${"word ".repeat(40)}</p><p><img src="logo.png" alt="L"></p><p>${"word ".repeat(20)}</p></main></body></html>`;

let tmp: string;
beforeEach(() => { tmp = mkdtempSync(join(tmpdir(), "docforge-cli-saveimg-")); });
afterEach(() => { rmSync(tmp, { recursive: true, force: true }); });

function baseOpts(output: string) {
  return {
    output, failThreshold: "0.10", maxBytes: "10485760", dryRun: false,
    maxPages: "1", maxDepth: "1", concurrency: "1",
    cacheDir: join(tmp, ".cache"), cache: false, userAgent: "docforge-test/0", llmsFull: "auto",
  };
}

describe("convert --save-images", () => {
  test("saves assets for a local obsidian run", async () => {
    const inDir = join(tmp, "in");
    const outDir = join(tmp, "out");
    mkdirSync(inDir, { recursive: true });
    writeFileSync(join(inDir, "page.html"), PAGE);
    writeFileSync(join(inDir, "logo.png"), PNG_1x1);
    const code = await runConvert(inDir, { ...baseOpts(outDir), format: "obsidian", saveImages: true });
    expect(code).toBe(0);
    expect(existsSync(join(outDir, "_assets"))).toBe(true);
    expect(readdirSync(join(outDir, "_assets")).length).toBe(1);
  });

  test("warns and saves nothing without --format obsidian", async () => {
    const inDir = join(tmp, "in");
    const outDir = join(tmp, "out");
    mkdirSync(inDir, { recursive: true });
    writeFileSync(join(inDir, "page.html"), PAGE);
    writeFileSync(join(inDir, "logo.png"), PNG_1x1);
    const code = await runConvert(inDir, { ...baseOpts(outDir), saveImages: true });
    expect(code).toBe(0);
    expect(existsSync(join(outDir, "_assets"))).toBe(false);
  });
});
