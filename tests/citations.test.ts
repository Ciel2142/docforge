import { describe, expect, test } from "vitest";
import { convertLinksToFootnotes } from "../src/citations.js";

describe("convertLinksToFootnotes", () => {
  test("external link → marker + References block", () => {
    const { md, count } = convertLinksToFootnotes("See [the docs](https://example.com/a).");
    expect(md).toBe(
      "See the docs[^1].\n\n## References\n\n[^1]: https://example.com/a\n",
    );
    expect(count).toBe(1);
  });

  test("http (not just https) is converted", () => {
    const { md, count } = convertLinksToFootnotes("[x](http://example.com/p)");
    expect(count).toBe(1);
    expect(md).toContain("x[^1]");
    expect(md).toContain("[^1]: http://example.com/p");
  });

  test("duplicate URLs share one footnote and one definition", () => {
    const { md, count } = convertLinksToFootnotes(
      "[a](https://x.com/1) and [b](https://x.com/1)",
    );
    expect(count).toBe(1);
    expect(md).toContain("a[^1]");
    expect(md).toContain("b[^1]");
    expect(md.match(/^\[\^1\]: https:\/\/x\.com\/1$/gm)).toHaveLength(1);
  });

  test("distinct URLs get sequential indices in first-seen order", () => {
    const { md, count } = convertLinksToFootnotes(
      "[a](https://x.com/1) [b](https://x.com/2)",
    );
    expect(count).toBe(2);
    expect(md).toContain("a[^1]");
    expect(md).toContain("b[^2]");
    expect(md).toContain("[^1]: https://x.com/1");
    expect(md).toContain("[^2]: https://x.com/2");
  });

  test("image links are not touched", () => {
    const input = "![alt](https://example.com/pic.png)";
    expect(convertLinksToFootnotes(input)).toEqual({ md: input, count: 0 });
  });

  test("internal .md links are not touched", () => {
    const input = "[guide](guide.md) and [[wikilink]]";
    expect(convertLinksToFootnotes(input)).toEqual({ md: input, count: 0 });
  });

  test("mailto links are not touched", () => {
    const input = "[mail](mailto:a@b.com)";
    expect(convertLinksToFootnotes(input)).toEqual({ md: input, count: 0 });
  });

  test("links inside a fenced code block are not touched", () => {
    const input = "```\n[x](https://example.com/in-code)\n```";
    expect(convertLinksToFootnotes(input)).toEqual({ md: input, count: 0 });
  });

  test("bare-URL anchor (text equals URL) is left as-is", () => {
    const input = "[https://example.com/x](https://example.com/x)";
    expect(convertLinksToFootnotes(input)).toEqual({ md: input, count: 0 });
  });

  test("no external links → unchanged, no heading", () => {
    const input = "Just text with [internal](page.md) and an ![img](a.png).";
    expect(convertLinksToFootnotes(input)).toEqual({ md: input, count: 0 });
  });

  test("real and fenced links coexist: only the real one converts", () => {
    const input = "[real](https://example.com/r)\n\n```\n[fake](https://example.com/f)\n```";
    const { md, count } = convertLinksToFootnotes(input);
    expect(count).toBe(1);
    expect(md).toContain("real[^1]");
    expect(md).toContain("[^1]: https://example.com/r");
    expect(md).toContain("[fake](https://example.com/f)");
    expect(md).not.toContain("[^2]");
  });
});
