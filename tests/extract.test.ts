import { describe, expect, test } from "vitest";
import { readFileSync } from "node:fs";
import { join } from "node:path";
import { extractMainContent } from "../src/extract.js";
import { extractBytesSync } from "@kreuzberg/node";

describe("extractMainContent", () => {
  test("extracts Sphinx articleBody and returns wordCount + title", async () => {
    const html = `<!DOCTYPE html>
<html><head><title>Test Page</title></head>
<body><div role="main"><div itemprop="articleBody">
<h1>Hello World</h1>
<p>Some body content with enough words to satisfy any threshold.</p>
</div></div></body></html>`;
    const r = await extractMainContent(html);
    expect(r.status).toBe("ok");
    if (r.status === "ok") {
      expect(r.cleanedHtml).toContain("Hello World");
      expect(r.cleanedHtml).toContain("Some body content");
      expect(r.wordCount).toBeGreaterThan(0);
    }
  });

  test("returns empty when document has no body content", async () => {
    const html = "<!DOCTYPE html><html><head></head><body></body></html>";
    const r = await extractMainContent(html);
    expect(r.status).toBe("empty");
  });

  test("honours selector override via contentSelector", async () => {
    const html = `<!DOCTYPE html>
<html><body>
<nav>Should not appear</nav>
<div class="custom-content"><h1>Picked</h1><p>${"word ".repeat(50)}</p></div>
<footer>Should not appear either</footer>
</body></html>`;
    const r = await extractMainContent(html, { selector: "div.custom-content" });
    expect(r.status).toBe("ok");
    if (r.status === "ok") {
      // Defuddle promotes the lone H1 to result.title; assert the marker
      // appears in either body or title (custom selector still excludes nav/footer).
      expect((r.cleanedHtml + (r.title ?? ""))).toContain("Picked");
      expect(r.cleanedHtml).not.toContain("Should not appear");
    }
  });
});

const FIXTURES = "tests/fixtures";
const EXPECTED = "tests/expected";

const NEW_GOLDEN_CASES = ["material-mkdocs", "generic-article", "generic-main"];

describe("extract golden files", () => {
  for (const name of NEW_GOLDEN_CASES) {
    test(`golden: ${name}`, async () => {
      const raw = readFileSync(join(FIXTURES, `${name}.html`), "utf8");
      const r = await extractMainContent(raw);
      expect(r.status).toBe("ok");
      if (r.status === "ok") {
        const md = extractBytesSync(
          Buffer.from(r.cleanedHtml, "utf8"),
          "text/html",
          { useCache: false, outputFormat: "markdown" },
        );
        const expected = readFileSync(join(EXPECTED, `${name}.md`), "utf8");
        expect(md.content.trim()).toBe(expected.trim());
      }
    });
  }
});
