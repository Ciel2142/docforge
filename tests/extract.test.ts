import { describe, expect, test } from "vitest";
import { extractMainContent } from "../src/extract.js";

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
