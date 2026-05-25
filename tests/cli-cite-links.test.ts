import { mkdirSync, mkdtempSync, readFileSync, rmSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { afterEach, describe, expect, test, beforeEach } from "vitest";
import { runConvert } from "../src/cli.js";

const PAD = "word ".repeat(40);
const PAGE = `<!DOCTYPE html><html><head><title>T</title></head><body>
<main><h1>T</h1><p>${PAD}</p>
<p>See <a href="https://example.com/x">ext</a>. ${PAD}</p></main></body></html>`;

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

describe("CLI --cite-links flag", () => {
  let tmp: string;
  beforeEach(() => {
    tmp = mkdtempSync(join(tmpdir(), "docforge-clicite-"));
  });
  afterEach(() => {
    rmSync(tmp, { recursive: true, force: true });
  });

  test("--cite-links produces footnotes + References", async () => {
    const inDir = join(tmp, "in");
    const outDir = join(tmp, "out");
    mkdirSync(inDir, { recursive: true });
    writeFileSync(join(inDir, "page.html"), PAGE);

    const code = await runConvert(inDir, { ...baseOpts(outDir), citeLinks: true });
    expect(code).toBe(0);
    const out = readFileSync(join(outDir, "page.md"), "utf8");
    expect(out).toContain("ext[^1]");
    expect(out).toContain("## References");
    expect(out).toContain("[^1]: https://example.com/x");
  });

  test("without the flag, inline link preserved and no References block", async () => {
    const inDir = join(tmp, "in");
    const outDir = join(tmp, "out");
    mkdirSync(inDir, { recursive: true });
    writeFileSync(join(inDir, "page.html"), PAGE);

    const code = await runConvert(inDir, baseOpts(outDir));
    expect(code).toBe(0);
    const out = readFileSync(join(outDir, "page.md"), "utf8");
    expect(out).toContain("](https://example.com/x)");
    expect(out).not.toContain("## References");
  });
});
