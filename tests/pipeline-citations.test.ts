import { afterEach, beforeEach, describe, expect, test } from "vitest";
import { mkdirSync, mkdtempSync, readFileSync, rmSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { runPipeline } from "../src/runPipeline.js";

const PAD = "word ".repeat(40);
const PAGE = `<!DOCTYPE html><html><head><title>Page</title></head><body>
<main><h1>Page</h1>
<p>${PAD}</p>
<p>See <a href="https://example.com/x">ext</a> for details. ${PAD}</p>
</main></body></html>`;

let tmp: string;
beforeEach(() => {
  tmp = mkdtempSync(join(tmpdir(), "docforge-cite-"));
});
afterEach(() => {
  rmSync(tmp, { recursive: true, force: true });
});

function writeFixture(): { inDir: string; outDir: string } {
  const inDir = join(tmp, "in");
  const outDir = join(tmp, "out");
  mkdirSync(inDir, { recursive: true });
  writeFileSync(join(inDir, "page.html"), PAGE);
  return { inDir, outDir };
}

describe("runPipeline --cite-links", () => {
  test("default format: external link becomes a footnote + References block", async () => {
    const { inDir, outDir } = writeFixture();
    const res = await runPipeline({
      source: inDir, outputDir: outDir, maxBytes: 10485760, dryRun: false,
      citeLinks: true,
    });
    expect(res.citations).toEqual({ footnotes: 1 });
    const out = readFileSync(join(outDir, "page.md"), "utf8");
    expect(out).toContain("ext[^1]");
    expect(out).toContain("## References");
    expect(out).toContain("[^1]: https://example.com/x");
    expect(out).not.toContain("](https://example.com/x)");
  });

  test("obsidian format: footnotes applied alongside frontmatter", async () => {
    const { inDir, outDir } = writeFixture();
    const res = await runPipeline({
      source: inDir, outputDir: outDir, maxBytes: 10485760, dryRun: false,
      format: "obsidian", citeLinks: true,
    });
    expect(res.citations).toEqual({ footnotes: 1 });
    const out = readFileSync(join(outDir, "page.md"), "utf8");
    expect(out.startsWith("---\n")).toBe(true);
    expect(out).toContain("ext[^1]");
    expect(out).toContain("[^1]: https://example.com/x");
  });

  test("flag off: no footnotes, inline link preserved, no citations stat", async () => {
    const { inDir, outDir } = writeFixture();
    const resA = await runPipeline({
      source: inDir, outputDir: outDir, maxBytes: 10485760, dryRun: false,
    });
    const outA = readFileSync(join(outDir, "page.md"), "utf8");
    expect(resA.citations).toBeUndefined();
    expect(outA).toContain("](https://example.com/x)");
    expect(outA).not.toContain("## References");
    expect(outA).not.toContain("[^1]");

    const outDir2 = join(tmp, "out2");
    await runPipeline({
      source: inDir, outputDir: outDir2, maxBytes: 10485760, dryRun: false,
      citeLinks: false,
    });
    const outB = readFileSync(join(outDir2, "page.md"), "utf8");
    expect(outB).toBe(outA);
  });
});
