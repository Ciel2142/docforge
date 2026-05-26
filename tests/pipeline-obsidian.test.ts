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

  // Regression guard for the spec-flagged edge case: a complex table emitted as
  // embedded HTML must survive the obsidian transforms (wikilink/autolink/frontmatter)
  // untouched. Uses content-dense markup so Defuddle retains the in-cell <ul>
  // (Defuddle's content scoring drops block content in sparse pages — out of scope here).
  test("preserves embedded HTML tables (complex) through obsidian transforms", async () => {
    const inDir = join(tmp, "in");
    const outDir = join(tmp, "out");
    mkdirSync(inDir, { recursive: true });
    const page = `<!doctype html><html><head><title>Doc</title></head><body><main>
<h1>Doc</h1>
<p>Intro paragraph with enough words to keep this as real article content here. See <a href="other.html">Other</a> for details.</p>
<table><thead><tr><th>Name</th><th>Role</th></tr></thead>
<tbody><tr><td>Ada</td><td>Engineer</td></tr></tbody></table>
<p>Middle paragraph separating the two tables with several words of filler.</p>
<table>
<tr><td rowspan="2">Ada</td><td>Owns:<ul><li>core</li><li>API</li></ul></td></tr>
<tr><td>Author</td></tr>
</table>
<p>Trailing paragraph also with several words to keep the body large enough.</p>
</main></body></html>`;
    writeFileSync(join(inDir, "page.html"), page);

    const res = await runPipeline({
      source: inDir,
      outputDir: outDir,
      maxBytes: 10485760,
      dryRun: false,
      format: "obsidian",
    });
    expect(res.converted).toBe(1);

    const out = readFileSync(join(outDir, "page.md"), "utf8");
    // complex table preserved as embedded HTML through the obsidian path
    expect(out).toContain("<table");
    expect(out).toContain('rowspan="2"');
    expect(out).toContain("<li>core</li>");
    expect(out).not.toContain("coreAPI");
    expect(out).not.toMatch(/DOCFORGETABLE/);
    // obsidian wikilink transform ran on the same document without harming the table
    expect(out).toContain("[[other|Other]]");
  });
});

describe("runPipeline local cross-dir internal links (docf-7w5)", () => {
  const PAD = "word ".repeat(40);
  const INTRO = `<!DOCTYPE html><html><head><title>Intro</title></head><body>
<main><h1>Intro</h1><p>${PAD}</p>
<p>See the <a href="../api/reference.html#post-widgets">API reference</a>. ${PAD}</p>
</main></body></html>`;
  const REF = `<!DOCTYPE html><html><head><title>API Reference</title></head><body>
<main><h1>API Reference</h1><p>${PAD}</p>
<p>Back to the <a href="../guide/intro.html">intro</a>. ${PAD}</p>
</main></body></html>`;

  function writeCorpus(): { inDir: string; outDir: string } {
    const inDir = join(tmp, "in");
    const outDir = join(tmp, "out");
    mkdirSync(join(inDir, "guide"), { recursive: true });
    mkdirSync(join(inDir, "api"), { recursive: true });
    writeFileSync(join(inDir, "guide", "intro.html"), INTRO);
    writeFileSync(join(inDir, "api", "reference.html"), REF);
    return { inDir, outDir };
  }

  test("obsidian: cross-dir anchored link → vault wikilink, no about:blank", async () => {
    const { inDir, outDir } = writeCorpus();
    await runPipeline({ source: inDir, outputDir: outDir, maxBytes: 10485760, dryRun: false, format: "obsidian" });
    const intro = readFileSync(join(outDir, "guide", "intro.md"), "utf8");
    expect(intro).not.toContain("about:blank");
    expect(intro).toContain("[[api/reference|API reference]]");
  });

  test("default: cross-dir anchored link → correct relative .md, no about:blank", async () => {
    const { inDir, outDir } = writeCorpus();
    await runPipeline({ source: inDir, outputDir: outDir, maxBytes: 10485760, dryRun: false });
    const intro = readFileSync(join(outDir, "guide", "intro.md"), "utf8");
    expect(intro).not.toContain("about:blank");
    expect(intro).toContain("[API reference](../api/reference.md#post-widgets)");
    // reverse direction (api/ → guide/) resolves symmetrically
    const ref = readFileSync(join(outDir, "api", "reference.md"), "utf8");
    expect(ref).not.toContain("about:blank");
    expect(ref).toContain("[intro](../guide/intro.md)");
  });
});
