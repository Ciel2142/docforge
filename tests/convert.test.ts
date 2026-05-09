import { readFileSync } from "node:fs";
import { join } from "node:path";
import { describe, expect, test, vi } from "vitest";
import { load } from "cheerio";
import {
  convertHtml,
  __testing__,
  type ConvertResult,
} from "../src/convert.js";

const { selectBody, stripSphinxNoise, h1Text, soupTitleText } = __testing__;

describe("selectBody", () => {
  test("finds articleBody directly", () => {
    const $ = load(
      '<html><body><div itemprop="articleBody"><h1>X</h1></div></body></html>',
    );
    const body = selectBody($);
    expect(body).not.toBeNull();
    expect(body!.find("h1").text()).toBe("X");
  });

  test("finds articleBody inside role=main", () => {
    const $ = load(
      '<html><body><div role="main">' +
        '<div itemprop="articleBody"><h1>Y</h1></div>' +
        "</div></body></html>",
    );
    const body = selectBody($);
    expect(body).not.toBeNull();
    expect(body!.find("h1").text()).toBe("Y");
  });

  test("returns role=main when no articleBody", () => {
    const $ = load('<html><body><div role="main"><h1>Z</h1></div></body></html>');
    const body = selectBody($);
    expect(body).not.toBeNull();
    expect(body!.find("h1").text()).toBe("Z");
  });

  test("returns null when neither present", () => {
    const $ = load("<html><body><main><h1>Q</h1></main></body></html>");
    expect(selectBody($)).toBeNull();
  });
});

describe("stripSphinxNoise", () => {
  test("removes a.headerlink", () => {
    const $ = load(
      '<div><h1>Title<a class="headerlink" href="#title">¶</a></h1></div>',
    );
    const body = $("div").first();
    stripSphinxNoise(body);
    expect(body.find("a.headerlink").length).toBe(0);
    expect(body.find("h1").text()).toBe("Title");
  });

  test("removes a.viewcode-link", () => {
    const $ = load(
      '<div><h1>X</h1><a class="viewcode-link">[source]</a></div>',
    );
    const body = $("div").first();
    stripSphinxNoise(body);
    expect(body.find("a.viewcode-link").length).toBe(0);
  });

  test("leaves normal anchors alone", () => {
    const $ = load('<div><a href="other.html">Other</a></div>');
    const body = $("div").first();
    stripSphinxNoise(body);
    expect(body.find("a").length).toBe(1);
    expect(body.find("a").text()).toBe("Other");
  });
});

describe("h1Text + soupTitleText", () => {
  test("h1Text strips trailing pilcrow", () => {
    const $ = load("<div><h1>Heading¶</h1></div>");
    expect(h1Text($("div").first())).toBe("Heading");
  });

  test("h1Text returns null when missing", () => {
    const $ = load("<div><p>no h1</p></div>");
    expect(h1Text($("div").first())).toBeNull();
  });

  test("soupTitleText returns inner text", () => {
    const $ = load("<html><head><title>Page Title</title></head></html>");
    expect(soupTitleText($)).toBe("Page Title");
  });

  test("soupTitleText returns null when missing", () => {
    const $ = load("<html><head></head></html>");
    expect(soupTitleText($)).toBeNull();
  });

  test("soupTitleText returns null when blank", () => {
    const $ = load("<html><head><title>   </title></head></html>");
    expect(soupTitleText($)).toBeNull();
  });
});

describe("convertHtml result type", () => {
  test("returns empty when no body marker", () => {
    const r = convertHtml("<html><body><main><h1>X</h1></main></body></html>");
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
    const r = mod.convertHtml(
      '<html><body><div itemprop="articleBody"><h1>X</h1></div></body></html>',
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

const EMPTY_CASES = ["sphinx-empty-body", "generic-no-articleBody"];

describe("golden files", () => {
  for (const name of GOLDEN_CASES) {
    test(`golden: ${name}`, () => {
      const raw = readFileSync(join(FIXTURES, `${name}.html`), "utf8");
      const r = convertHtml(raw);
      expect(r.status).toBe("ok");
      if (r.status === "ok") {
        const expected = readFileSync(join(EXPECTED, `${name}.md`), "utf8");
        expect(r.body_md.trim()).toBe(expected.trim());
      }
    });
  }
});

describe("empty classification", () => {
  for (const name of EMPTY_CASES) {
    test(`empty: ${name}`, () => {
      const raw = readFileSync(join(FIXTURES, `${name}.html`), "utf8");
      const r = convertHtml(raw);
      expect(r.status).toBe("empty");
    });
  }
});

describe("non-utf8 fixture", () => {
  test("does not crash and converts via replacement", () => {
    const buf = readFileSync(join(FIXTURES, "non-utf8.html"));
    const raw = buf.toString("utf8"); // Node default replaces invalid bytes
    const r = convertHtml(raw);
    expect(r.status).toBe("ok");
    if (r.status === "ok") expect(r.h1_text).toBe("Bad");
  });
});
