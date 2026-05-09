import { describe, expect, test } from "vitest";
import { rewriteInternalLinks } from "../src/links.js";

describe("rewriteInternalLinks", () => {
  test("simple relative link rewritten", () => {
    expect(rewriteInternalLinks("[Other](other.html)")).toBe("[Other](other.md)");
  });

  test("relative link with anchor preserved", () => {
    expect(rewriteInternalLinks("[Section](page.html#intro)")).toBe(
      "[Section](page.md#intro)",
    );
  });

  test("relative subdir link rewritten", () => {
    expect(rewriteInternalLinks("[Sub](dir/sub/page.html)")).toBe(
      "[Sub](dir/sub/page.md)",
    );
  });

  test("https link untouched", () => {
    const md = "[Ext](https://example.com/page.html)";
    expect(rewriteInternalLinks(md)).toBe(md);
  });

  test("http link untouched", () => {
    const md = "[Ext](http://example.com/page.html)";
    expect(rewriteInternalLinks(md)).toBe(md);
  });

  test("mailto link untouched", () => {
    const md = "[Email](mailto:foo@bar.html)";
    expect(rewriteInternalLinks(md)).toBe(md);
  });

  test("anchor-only link untouched", () => {
    expect(rewriteInternalLinks("[Anchor](#intro)")).toBe("[Anchor](#intro)");
  });

  test("non-html extension untouched", () => {
    expect(rewriteInternalLinks("[Pic](image.png)")).toBe("[Pic](image.png)");
  });

  test("multiple links in one string", () => {
    const md = "See [A](a.html) and [B](b.html#x) and [C](https://c.com/c.html).";
    expect(rewriteInternalLinks(md)).toBe(
      "See [A](a.md) and [B](b.md#x) and [C](https://c.com/c.html).",
    );
  });

  test("empty string returns empty", () => {
    expect(rewriteInternalLinks("")).toBe("");
  });

  test("autolink relative html rewritten", () => {
    expect(rewriteInternalLinks("See <other.html> for details.")).toBe(
      "See <other.md> for details.",
    );
  });

  test("autolink relative html with anchor rewritten", () => {
    expect(rewriteInternalLinks("See <page.html#intro> for details.")).toBe(
      "See <page.md#intro> for details.",
    );
  });

  test("autolink external https untouched", () => {
    const md = "See <https://example.com/page.html>.";
    expect(rewriteInternalLinks(md)).toBe(md);
  });

  test("autolink external http untouched", () => {
    const md = "See <http://example.com/page.html>.";
    expect(rewriteInternalLinks(md)).toBe(md);
  });

  test("autolink subdir rewritten", () => {
    expect(rewriteInternalLinks("<dir/sub/page.html>")).toBe("<dir/sub/page.md>");
  });

  test("protocol-relative md link untouched", () => {
    const md = "[CDN](//cdn.example.com/page.html)";
    expect(rewriteInternalLinks(md)).toBe(md);
  });

  test("protocol-relative autolink untouched", () => {
    const md = "<//cdn.example.com/page.html>";
    expect(rewriteInternalLinks(md)).toBe(md);
  });
});
