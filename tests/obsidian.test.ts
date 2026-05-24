import { describe, expect, test } from "vitest";
import { buildObsidianOutput, toObsidianWikilinks } from "../src/obsidian.js";

describe("buildObsidianOutput", () => {
  test("emits frontmatter (title, source) then body", () => {
    expect(
      buildObsidianOutput("My Title", "dir/page.html", "# My Title\n\nBody."),
    ).toBe(
      '---\ntitle: "My Title"\nsource: "dir/page.html"\n---\n\n# My Title\n\nBody.\n',
    );
  });

  test("escapes double quotes and backslashes in title", () => {
    expect(
      buildObsidianOutput('He said "hi" \\o/', "p.html", "Body."),
    ).toBe(
      '---\ntitle: "He said \\"hi\\" \\\\o/"\nsource: "p.html"\n---\n\nBody.\n',
    );
  });

  test("trims surrounding whitespace in body", () => {
    expect(buildObsidianOutput("T", "p.html", "  Body.  \n\n  ")).toBe(
      '---\ntitle: "T"\nsource: "p.html"\n---\n\nBody.\n',
    );
  });

  test("escapes newlines in title to keep frontmatter single-line", () => {
    expect(buildObsidianOutput("a\nb", "p.html", "Body.")).toBe(
      '---\ntitle: "a\\nb"\nsource: "p.html"\n---\n\nBody.\n',
    );
  });
});

describe("toObsidianWikilinks", () => {
  test("resolves relative path, drops slug anchor, keeps text as alias", () => {
    expect(
      toObsidianWikilinks("[Install guide](../setup/index.md#install-foo)", "guide/page.md"),
    ).toBe("[[setup/index|Install guide]]");
  });

  test("rewrites .html internal targets", () => {
    expect(toObsidianWikilinks("[Next](other.html)", "page.md")).toBe(
      "[[other|Next]]",
    );
  });

  test("omits alias when link text equals target basename", () => {
    expect(toObsidianWikilinks("[index](sub/index.md)", "page.md")).toBe(
      "[[sub/index]]",
    );
  });

  test("converts autolinks without alias", () => {
    expect(toObsidianWikilinks("see <api.html>", "page.md")).toBe(
      "see [[api]]",
    );
  });

  test("resolves nested directories", () => {
    expect(toObsidianWikilinks("[See C](../c.md)", "a/b/page.md")).toBe(
      "[[a/c|See C]]",
    );
  });

  test("leaves image links untouched", () => {
    expect(toObsidianWikilinks("![diagram](img/d.png)", "page.md")).toBe(
      "![diagram](img/d.png)",
    );
  });

  test("leaves external, mailto, and bare-anchor links untouched", () => {
    const md = "[site](https://x.com/page.html) [mail](mailto:a@b.com) [top](#top)";
    expect(toObsidianWikilinks(md, "page.md")).toBe(md);
  });

  test("leaves above-vault-root targets untouched", () => {
    expect(toObsidianWikilinks("[up](../../x.md)", "page.md")).toBe(
      "[up](../../x.md)",
    );
  });

  test("leaves root-absolute targets untouched", () => {
    expect(
      toObsidianWikilinks("[Guide](/reference/api.md)", "docs/page.md"),
    ).toBe("[Guide](/reference/api.md)");
  });

  test("omits alias when link text equals the full vault path", () => {
    expect(
      toObsidianWikilinks("[setup/index](../setup/index.md)", "guide/page.md"),
    ).toBe("[[setup/index]]");
  });
});
