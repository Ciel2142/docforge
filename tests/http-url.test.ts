import { describe, expect, test } from "vitest";
import { normalizeUrl, sameOrigin, urlToOutputPath } from "../src/http/url.js";

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
});
