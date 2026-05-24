import { mkdirSync, mkdtempSync, readFileSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { describe, expect, test, beforeEach } from "vitest";
import { runConvert } from "../src/cli.js";

const PAGE = `<!DOCTYPE html><html><head><title>T</title></head><body>
<main><h1>T</h1><p>${"word ".repeat(50)}</p></main></body></html>`;

function baseOpts(output: string) {
  return {
    output,
    failThreshold: "0.10",
    maxBytes: "10485760",
    dryRun: false,
    maxPages: "100",
    maxDepth: "5",
    concurrency: "2",
    cacheDir: "~/.cache/docforge",
    cache: false,
    userAgent: "docforge-test",
    llmsFull: "off",
  };
}

describe("CLI --format flag", () => {
  let tmp: string;
  beforeEach(() => {
    tmp = mkdtempSync(join(tmpdir(), "docforge-cliformat-"));
  });

  test("format=obsidian writes frontmatter output", async () => {
    const inDir = join(tmp, "in");
    const outDir = join(tmp, "out");
    mkdirSync(inDir, { recursive: true });
    writeFileSync(join(inDir, "page.html"), PAGE);

    const code = await runConvert(inDir, { ...baseOpts(outDir), format: "obsidian" });
    expect(code).toBe(0);
    const out = readFileSync(join(outDir, "page.md"), "utf8");
    expect(out.startsWith("---\n")).toBe(true);
  });

  test("invalid format value exits 2", async () => {
    const inDir = join(tmp, "in");
    const outDir = join(tmp, "out");
    mkdirSync(inDir, { recursive: true });
    writeFileSync(join(inDir, "page.html"), PAGE);

    const code = await runConvert(inDir, { ...baseOpts(outDir), format: "markdown" });
    expect(code).toBe(2);
  });
});
