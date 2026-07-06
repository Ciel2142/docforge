import { describe, expect, test } from "vitest";
import { looksJsRendered } from "../src/http/render.js";

const SPA_SHELL = `<!doctype html><html><head><title>Docs</title>
<script src="/static/js/main.7c2f.js"></script>
<style>body{margin:0}</style></head>
<body><div id="root"></div>
<noscript>You need to enable JavaScript to run this app.</noscript>
</body></html>`;

const STATIC_PAGE = `<!doctype html><html><body><main><h1>Guide</h1>
<p>${"Real documentation content about configuring the frobnicator. ".repeat(6)}</p>
</main></body></html>`;

describe("looksJsRendered", () => {
  test("SPA shell (empty root div + scripts) → true", () => {
    expect(looksJsRendered(SPA_SHELL)).toBe(true);
  });

  test("real docs page with body text → false", () => {
    expect(looksJsRendered(STATIC_PAGE)).toBe(false);
  });

  test("noscript-only text does not count as visible content", () => {
    const html = `<html><body><noscript>${"enable javascript please ".repeat(20)}</noscript></body></html>`;
    expect(looksJsRendered(html)).toBe(true);
  });

  test("script/style text does not count as visible content", () => {
    const html = `<html><body><script>${"var x = 1; ".repeat(50)}</script><style>${".a{color:red} ".repeat(30)}</style></body></html>`;
    expect(looksJsRendered(html)).toBe(true);
  });

  test("boundary: 199 visible chars → true, 200 → false", () => {
    expect(looksJsRendered(`<html><body>${"a".repeat(199)}</body></html>`)).toBe(true);
    expect(looksJsRendered(`<html><body>${"a".repeat(200)}</body></html>`)).toBe(false);
  });
});
