import { afterEach, beforeEach, describe, expect, test } from "vitest";
import { mkdirSync, mkdtempSync, readFileSync, rmSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { runPipeline } from "../src/runPipeline.js";

const PAGE = `<!DOCTYPE html><html><head><title>Page Title</title></head><body>
<main><h1>Page Title</h1>
<p>${"word ".repeat(40)}</p>
<p>See <a href="other.html">Other</a> for details ${"word ".repeat(20)}</p>
</main></body></html>`;

let tmp: string;
beforeEach(() => {
  tmp = mkdtempSync(join(tmpdir(), "docforge-obsidian-"));
});
afterEach(() => {
  rmSync(tmp, { recursive: true, force: true });
});

describe("runPipeline format=obsidian", () => {
  test("emits frontmatter + wikilinks for HTML conversion", async () => {
    const inDir = join(tmp, "in");
    const outDir = join(tmp, "out");
    mkdirSync(inDir, { recursive: true });
    writeFileSync(join(inDir, "page.html"), PAGE);

    const res = await runPipeline({
      source: inDir,
      outputDir: outDir,
      maxBytes: 10485760,
      dryRun: false,
      format: "obsidian",
    });
    expect(res.converted).toBe(1);

    const out = readFileSync(join(outDir, "page.md"), "utf8");
    expect(out.startsWith("---\n")).toBe(true);
    expect(out).toContain('source: "page.html"');
    expect(out).toContain("[[other|Other]]");
    expect(out).not.toContain("Source: page.html");
  });

  test("default format unchanged (inline Source line, no frontmatter)", async () => {
    const inDir = join(tmp, "in");
    const outDir = join(tmp, "out");
    mkdirSync(inDir, { recursive: true });
    writeFileSync(join(inDir, "page.html"), PAGE);

    await runPipeline({
      source: inDir,
      outputDir: outDir,
      maxBytes: 10485760,
      dryRun: false,
    });

    const out = readFileSync(join(outDir, "page.md"), "utf8");
    expect(out.startsWith("---\n")).toBe(false);
    expect(out).toContain("Source: page.html");
    expect(out).toContain("[Other](other.md)");
  });
});
