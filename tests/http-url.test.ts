import { describe, expect, test } from "vitest";
import {
  normalizeUrl,
  relativizeSameOriginLinks,
  sameOrigin,
  scopePrefixFromSeed,
  underScope,
  urlToOutputPath,
} from "../src/http/url.js";

describe("normalizeUrl", () => {
  test("absolute http url passes through", () => {
    expect(normalizeUrl("https://x.com/a")).toBe("https://x.com/a");
  });

  test("strips fragment", () => {
    expect(normalizeUrl("https://x.com/a#sec")).toBe("https://x.com/a");
  });

  test("strips query string", () => {
    expect(normalizeUrl("https://x.com/a?v=1")).toBe("https://x.com/a");
  });

  test("resolves relative against base", () => {
    expect(normalizeUrl("../b", "https://x.com/a/c/")).toBe("https://x.com/a/b");
  });

  test("collapses default https port", () => {
    expect(normalizeUrl("https://x.com:443/a")).toBe("https://x.com/a");
  });

  test("collapses default http port", () => {
    expect(normalizeUrl("http://x.com:80/a")).toBe("http://x.com/a");
  });

  test("lowercases host", () => {
    expect(normalizeUrl("https://X.COM/A")).toBe("https://x.com/A");
  });

  test("decodes percent-encoded sub-delim '@'", () => {
    expect(normalizeUrl("https://x.com/820%40/y")).toBe("https://x.com/820@/y");
  });

  test("decodes percent-encoded unreserved '~'", () => {
    expect(normalizeUrl("https://x.com/%7Euser")).toBe("https://x.com/~user");
  });

  test("preserves percent-encoded path separator '%2F'", () => {
    expect(normalizeUrl("https://x.com/a%2Fb/c")).toBe("https://x.com/a%2Fb/c");
  });

  test("uppercases percent-encoding hex", () => {
    expect(normalizeUrl("https://x.com/%c3%a9")).toBe("https://x.com/%C3%A9");
  });

  test("'@' and '%40' canonicalize to identical URL", () => {
    expect(normalizeUrl("https://x.com/820@/y")).toBe(
      normalizeUrl("https://x.com/820%40/y"),
    );
  });

  test("malformed percent-encoding leaves segment intact", () => {
    expect(normalizeUrl("https://x.com/a%ZZb")).toBe("https://x.com/a%ZZb");
  });

  test("returns null for mailto", () => {
    expect(normalizeUrl("mailto:foo@bar.com")).toBeNull();
  });

  test("returns null for javascript:", () => {
    expect(normalizeUrl("javascript:void(0)")).toBeNull();
  });

  test("returns null for relative without base", () => {
    expect(normalizeUrl("../b")).toBeNull();
  });
});

describe("sameOrigin", () => {
  test("same scheme + host + port", () => {
    expect(sameOrigin("https://x.com/a", "https://x.com/b")).toBe(true);
  });

  test("different host", () => {
    expect(sameOrigin("https://x.com/a", "https://y.com/a")).toBe(false);
  });

  test("different scheme", () => {
    expect(sameOrigin("https://x.com/", "http://x.com/")).toBe(false);
  });

  test("default port collapse same-origin", () => {
    expect(sameOrigin("https://x.com:443/a", "https://x.com/b")).toBe(true);
  });
});

describe("urlToOutputPath", () => {
  test.each([
    ["https://x.com/", "/out", "/out/index.md"],
    ["https://x.com/guide/", "/out", "/out/guide/index.md"],
    ["https://x.com/guide/foo.html", "/out", "/out/guide/foo.md"],
    ["https://x.com/guide/foo", "/out", "/out/guide/foo.md"],
    ["https://x.com/guide/foo?v=1#sec", "/out", "/out/guide/foo.md"],
    ["https://x.com/a/b/c/page.html", "/out", "/out/a/b/c/page.md"],
    ["https://x.com/foo.htm", "/out", "/out/foo.md"],
  ])("%s -> %s", (url, outDir, expected) => {
    expect(urlToOutputPath(url, outDir)).toBe(expected);
  });

  test("percent-encoded and bare '@' collide to same output path", () => {
    expect(urlToOutputPath("https://x.com/820@/Item820.html", "/out")).toBe(
      urlToOutputPath("https://x.com/820%40/Item820.html", "/out"),
    );
  });
});

describe("relativizeSameOriginLinks", () => {
  const PAGE = "https://docs.example.com/guide/intro";

  test("same-origin extensionless link → relative .md, fragment preserved", () => {
    expect(
      relativizeSameOriginLinks(
        "See [the API](https://docs.example.com/api/reference#post-widgets).",
        PAGE,
      ),
    ).toBe("See [the API](../api/reference.md#post-widgets).");
  });

  test("same-origin sibling link → relative .md", () => {
    expect(
      relativizeSameOriginLinks(
        "[next](https://docs.example.com/guide/advanced)",
        PAGE,
      ),
    ).toBe("[next](advanced.md)");
  });

  test("same-origin .html link → relative .md", () => {
    expect(
      relativizeSameOriginLinks(
        "[ref](https://docs.example.com/api/reference.html)",
        PAGE,
      ),
    ).toBe("[ref](../api/reference.md)");
  });

  test("trailing-slash same-origin link → index.md", () => {
    expect(
      relativizeSameOriginLinks(
        "[api home](https://docs.example.com/api/)",
        PAGE,
      ),
    ).toBe("[api home](../api/index.md)");
  });

  test("autolink same-origin → relative .md", () => {
    expect(
      relativizeSameOriginLinks(
        "<https://docs.example.com/api/reference>",
        PAGE,
      ),
    ).toBe("<../api/reference.md>");
  });

  test("external link left untouched", () => {
    const md = "[ext](https://other.com/x) and [rel](../already/rel.md)";
    expect(relativizeSameOriginLinks(md, PAGE)).toBe(md);
  });

  test("same-origin image left absolute (asset not converted)", () => {
    const md = "![diagram](https://docs.example.com/img/arch.png)";
    expect(relativizeSameOriginLinks(md, PAGE)).toBe(md);
  });

  test("same-origin non-page asset link left absolute", () => {
    const md = "[spec](https://docs.example.com/files/spec.pdf)";
    expect(relativizeSameOriginLinks(md, PAGE)).toBe(md);
  });

  test("query string dropped, fragment preserved", () => {
    expect(
      relativizeSameOriginLinks(
        "[v2](https://docs.example.com/api/reference?v=2#post-widgets)",
        PAGE,
      ),
    ).toBe("[v2](../api/reference.md#post-widgets)");
  });
});

describe("scopePrefixFromSeed", () => {
  test("root seed is unrestricted", () => {
    expect(scopePrefixFromSeed("https://x.com/")).toBe(null);
    expect(scopePrefixFromSeed("https://x.com")).toBe(null);
  });

  test("trailing-slash seed uses its own path", () => {
    expect(scopePrefixFromSeed("https://x.com/docs/")).toBe("/docs/");
    expect(scopePrefixFromSeed("https://x.com/a/b/")).toBe("/a/b/");
  });

  test("extensionless seed is treated as a directory", () => {
    expect(scopePrefixFromSeed("https://x.com/docs")).toBe("/docs/");
    expect(scopePrefixFromSeed("https://x.com/a/b/c")).toBe("/a/b/c/");
  });

  test("seed with file extension scopes to its directory", () => {
    expect(scopePrefixFromSeed("https://x.com/docs/intro.html")).toBe("/docs/");
  });

  test("dotted segment counts as a file (scopes wider)", () => {
    expect(scopePrefixFromSeed("https://x.com/docs/v1.2")).toBe("/docs/");
  });

  test("file at root is unrestricted", () => {
    expect(scopePrefixFromSeed("https://x.com/intro.html")).toBe(null);
  });

  test("query and fragment are ignored", () => {
    expect(scopePrefixFromSeed("https://x.com/docs/?q=1#frag")).toBe("/docs/");
  });

  test("invalid url returns null", () => {
    expect(scopePrefixFromSeed("not a url")).toBe(null);
  });
});

describe("underScope", () => {
  test("path under prefix matches", () => {
    expect(underScope("https://x.com/docs/a", "/docs/")).toBe(true);
    expect(underScope("https://x.com/docs/deep/page.html", "/docs/")).toBe(true);
  });

  test("prefix itself matches", () => {
    expect(underScope("https://x.com/docs/", "/docs/")).toBe(true);
  });

  test("extensionless seed page itself matches", () => {
    expect(underScope("https://x.com/docs", "/docs/")).toBe(true);
  });

  test("sibling with shared string prefix does not match", () => {
    expect(underScope("https://x.com/docsother", "/docs/")).toBe(false);
    expect(underScope("https://x.com/docsother/a", "/docs/")).toBe(false);
  });

  test("outside prefix does not match", () => {
    expect(underScope("https://x.com/blog/b", "/docs/")).toBe(false);
    expect(underScope("https://x.com/", "/docs/")).toBe(false);
  });

  test("invalid url does not match", () => {
    expect(underScope("not a url", "/docs/")).toBe(false);
  });
});
