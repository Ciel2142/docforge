import { describe, expect, test } from "vitest";
import {
  deriveCollectionName,
  validateCollectionName,
  COLLECTION_NAME_RE,
} from "../../src/mcp/collection.js";

describe("validateCollectionName", () => {
  test("accepts standard slug", () => {
    expect(validateCollectionName("docs-foo-dev")).toBe("docs-foo-dev");
  });

  test("rejects path traversal", () => {
    expect(() => validateCollectionName("..")).toThrow(/INVALID_CORPUS_NAME/);
    expect(() => validateCollectionName("../etc")).toThrow(/INVALID_CORPUS_NAME/);
  });

  test("rejects slashes", () => {
    expect(() => validateCollectionName("foo/bar")).toThrow(/INVALID_CORPUS_NAME/);
    expect(() => validateCollectionName("foo\\bar")).toThrow(/INVALID_CORPUS_NAME/);
  });

  test("rejects leading dot", () => {
    expect(() => validateCollectionName(".hidden")).toThrow(/INVALID_CORPUS_NAME/);
  });

  test("rejects empty", () => {
    expect(() => validateCollectionName("")).toThrow(/INVALID_CORPUS_NAME/);
  });

  test("rejects over 128 chars", () => {
    expect(() => validateCollectionName("a".repeat(129))).toThrow(/INVALID_CORPUS_NAME/);
  });

  test("regex matches valid names only", () => {
    expect(COLLECTION_NAME_RE.test("a")).toBe(true);
    expect(COLLECTION_NAME_RE.test("Abc")).toBe(false); // uppercase
    expect(COLLECTION_NAME_RE.test("-foo")).toBe(false); // leading hyphen
  });
});

describe("deriveCollectionName", () => {
  test("URL host + first path segment", () => {
    expect(deriveCollectionName({ url: "https://docs.python.org/3/" }))
      .toBe("docs-python-org-3");
  });

  test("URL host only when path empty", () => {
    expect(deriveCollectionName({ url: "https://docs.kreuzberg.dev/" }))
      .toBe("docs-kreuzberg-dev");
  });

  test("URL host + deeper path collapses", () => {
    expect(deriveCollectionName({ url: "https://docs.python.org/3.12/library/" }))
      .toBe("docs-python-org-3-12");
  });

  test("OpenAPI title preferred when present", () => {
    expect(
      deriveCollectionName({
        url: "https://api.stripe.com/v1/openapi.yaml",
        openApi: { title: "Stripe API", version: "1.0.4" },
      }),
    ).toBe("stripe-api-v1");
  });

  test("OpenAPI title without parseable version falls back to URL", () => {
    expect(
      deriveCollectionName({
        url: "https://api.stripe.com/v1/openapi.yaml",
        openApi: { title: "Stripe API", version: "2025-01-01" },
      }),
    ).toBe("stripe-api-v1");
  });

  test("override always wins when valid", () => {
    expect(
      deriveCollectionName({
        url: "https://docs.foo.dev/",
        override: "kreuzberg",
      }),
    ).toBe("kreuzberg");
  });

  test("override is validated", () => {
    expect(() =>
      deriveCollectionName({
        url: "https://docs.foo.dev/",
        override: "../etc",
      }),
    ).toThrow(/INVALID_CORPUS_NAME/);
  });

  test("file path basename", () => {
    expect(deriveCollectionName({ url: "file:///home/me/sphinx-build/" }))
      .toBe("sphinx-build");
  });

  test("rejects unsupported scheme", () => {
    expect(() => deriveCollectionName({ url: "ftp://x.com/" }))
      .toThrow(/INVALID_URL/);
  });
});
