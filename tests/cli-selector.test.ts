import { mkdirSync, mkdtempSync, readdirSync, readFileSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { describe, expect, test, beforeEach } from "vitest";
import { runConvert } from "../src/cli.js";

function mkdirSyncCompat(p: string): string {
  mkdirSync(p, { recursive: true });
  return p;
}

describe("CLI --selector flag", () => {
  let tmp: string;

  beforeEach(() => {
    tmp = mkdtempSync(join(tmpdir(), "docforge-selector-"));
  });

  test("selector picks specified element, rejecting Defuddle defaults", async () => {
    const html = `<!DOCTYPE html>
<html><head><title>T</title></head><body>
<article class="markdown-body"><h1>Default Pick</h1><p>${"word ".repeat(50)}</p></article>
<aside class="custom-pick"><h1>Custom Pick</h1><p>${"word ".repeat(50)}</p></aside>
</body></html>`;
    const fixDir = join(tmp, "in");
    const outDir = join(tmp, "out");
    writeFileSync(join(mkdirSyncCompat(fixDir), "page.html"), html);

    const code = await runConvert(fixDir, {
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
      selector: "aside.custom-pick",
      llmsFull: "off",
    });
    expect(code).toBe(0);

    const files = readdirSync(outDir);
    expect(files).toContain("page.md");
    const out = readFileSync(join(outDir, "page.md"), "utf8");
    expect(out).toContain("Custom Pick");
    expect(out).not.toContain("Default Pick");
  });
});
