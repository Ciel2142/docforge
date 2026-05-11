import { readFileSync } from "node:fs";
import { join } from "node:path";
import { describe, expect, test, vi } from "vitest";
import { convertHtml } from "../src/convert.js";

describe("convertHtml result type", () => {
  test("returns ok with body_md + h1_text + soup_title_text for Sphinx shape", async () => {
    const r = await convertHtml(
      '<html><head><title>T</title></head><body><div role="main"><div itemprop="articleBody"><h1>Hello</h1><p>Body content with enough words to pass the threshold check easily.</p></div></div></body></html>',
    );
    expect(r.status).toBe("ok");
    if (r.status === "ok") {
      expect(r.h1_text).toBe("Hello");
      expect(r.soup_title_text).toBe("T");
      expect(r.body_md).toContain("Hello");
    }
  });

  test("returns empty when document has no body", async () => {
    const r = await convertHtml("<html><body></body></html>");
    expect(r.status).toBe("empty");
  });

  test("returns failed when kreuzberg throws", async () => {
    vi.doMock("@kreuzberg/node", () => ({
      extractBytesSync: () => {
        throw new Error("kreuzberg blew up");
      },
    }));
    vi.resetModules();
    const mod = await import("../src/convert.js");
    const r = await mod.convertHtml(
      '<html><body><div itemprop="articleBody"><h1>X</h1><p>Body content with enough words to pass the threshold check easily.</p></div></body></html>',
    );
    expect(r.status).toBe("failed");
    if (r.status === "failed") expect(r.error).toMatch(/kreuzberg/);
    vi.doUnmock("@kreuzberg/node");
    vi.resetModules();
  });
});

const FIXTURES = "tests/fixtures";
const EXPECTED = "tests/expected";

const GOLDEN_CASES = [
  "sphinx-method",
  "sphinx-proto",
  "sphinx-proto-blockquote",
  "sphinx-guide",
  "sphinx-internal-link",
  "sphinx-highlight-default",
];

describe("golden files (Sphinx — unchanged regression)", () => {
  for (const name of GOLDEN_CASES) {
    test(`golden: ${name}`, async () => {
      const raw = readFileSync(join(FIXTURES, `${name}.html`), "utf8");
      const r = await convertHtml(raw);
      expect(r.status).toBe("ok");
      if (r.status === "ok") {
        const expected = readFileSync(join(EXPECTED, `${name}.md`), "utf8");
        expect(r.body_md.trim()).toBe(expected.trim());
      }
    });
  }
});

describe("empty classification", () => {
  test("sphinx-empty-body returns empty (no body content)", async () => {
    const raw = readFileSync(join(FIXTURES, "sphinx-empty-body.html"), "utf8");
    const r = await convertHtml(raw);
    expect(r.status).toBe("empty");
  });
});

describe("non-utf8 fixture", () => {
  test("does not crash and converts", async () => {
    const buf = readFileSync(join(FIXTURES, "non-utf8.html"));
    const raw = buf.toString("utf8");
    const r = await convertHtml(raw);
    expect(r.status).toBe("ok");
    if (r.status === "ok") expect(r.h1_text).toBe("Bad");
  });
});
