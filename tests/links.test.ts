import { describe, expect, test } from "vitest";
import { rewriteInternalLinks, stripHeadingAnchors } from "../src/links.js";
import { delocalizeLinks, LOCAL_BASE } from "../src/links.js";

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

describe("stripHeadingAnchors", () => {
  test("strips trailing anchor from heading line", () => {
    expect(stripHeadingAnchors("LM Studio 0.4.1 [#lm-studio-041]")).toBe(
      "LM Studio 0.4.1",
    );
  });

  test("strips slug with leading and doubled hyphens", () => {
    expect(
      stripHeadingAnchors("LM Studio 0.3.15 • 2025-04-24 [#-lm-studio-0315--2025-04-24]"),
    ).toBe("LM Studio 0.3.15 • 2025-04-24");
  });

  test("strips per line, leaves body text intact", () => {
    const md = "Heading One [#heading-one]\nbody text\nHeading Two [#heading-two]";
    expect(stripHeadingAnchors(md)).toBe("Heading One\nbody text\nHeading Two");
  });

  test("line without anchor untouched", () => {
    expect(stripHeadingAnchors("just some text")).toBe("just some text");
  });

  test("anchor not at end of line untouched", () => {
    const md = "see [#anchor] in the middle";
    expect(stripHeadingAnchors(md)).toBe(md);
  });

  test("markdown link with fragment untouched", () => {
    const md = "[Section](page.md#intro)";
    expect(stripHeadingAnchors(md)).toBe(md);
  });

  test("trailing whitespace after anchor removed", () => {
    expect(stripHeadingAnchors("Heading [#slug]  ")).toBe("Heading");
  });

  test("empty string returns empty", () => {
    expect(stripHeadingAnchors("")).toBe("");
  });
});

describe("delocalizeLinks", () => {
  test("LOCAL_BASE is the docforge.invalid sentinel", () => {
    expect(LOCAL_BASE).toBe("http://docforge.invalid/");
  });

  test("cross-dir anchored link → file-relative, fragment preserved", () => {
    expect(
      delocalizeLinks(
        "[API reference](http://docforge.invalid/api/ref.html#sec)",
        "guide/intro.md",
      ),
    ).toBe("[API reference](../api/ref.html#sec)");
  });

  test("same-dir link → bare relative", () => {
    expect(
      delocalizeLinks(
        "[sib](http://docforge.invalid/guide/sib.html#x)",
        "guide/intro.md",
      ),
    ).toBe("[sib](sib.html#x)");
  });

  test("root-level source file → relative without ../", () => {
    expect(
      delocalizeLinks(
        "[api](http://docforge.invalid/api/ref.html)",
        "index.md",
      ),
    ).toBe("[api](api/ref.html)");
  });

  test("autolink form is delocalized", () => {
    expect(
      delocalizeLinks("see <http://docforge.invalid/api/ref.html>", "guide/p.md"),
    ).toBe("see <../api/ref.html>");
  });

  test("image links are delocalized too", () => {
    expect(
      delocalizeLinks(
        "![diagram](http://docforge.invalid/img/arch.png)",
        "guide/p.md",
      ),
    ).toBe("![diagram](../img/arch.png)");
  });

  test("leaves real http(s) and relative links untouched", () => {
    const md =
      "[ext](https://example.com/page.html) [rel](../already/rel.html) [mail](mailto:a@b.com)";
    expect(delocalizeLinks(md, "guide/p.md")).toBe(md);
  });

  test("decodes percent-encoded path segments", () => {
    expect(
      delocalizeLinks(
        "[x](http://docforge.invalid/a%20b/c.html)",
        "index.md",
      ),
    ).toBe("[x](a b/c.html)");
  });

  test("delocalizes two adjacent sentinel links on one line", () => {
    expect(
      delocalizeLinks(
        "[a](http://docforge.invalid/api/a.html) and [b](http://docforge.invalid/api/b.html#x)",
        "guide/p.md",
      ),
    ).toBe("[a](../api/a.html) and [b](../api/b.html#x)");
  });

  test("preserves query string", () => {
    expect(
      delocalizeLinks("[x](http://docforge.invalid/api/ref.html?v=3#s)", "index.md"),
    ).toBe("[x](api/ref.html?v=3#s)");
  });

  test("root self-link to site root → current dir", () => {
    expect(
      delocalizeLinks("[home](http://docforge.invalid/)", "index.md"),
    ).toBe("[home](.)");
  });
});
