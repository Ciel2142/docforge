import { describe, expect, test } from "vitest";
import { truncateMarkdown, clampPreviewBytes } from "../../src/mcp/preview.js";

describe("clampPreviewBytes", () => {
  test("default when undefined", () => {
    expect(clampPreviewBytes(undefined)).toBe(8192);
  });

  test("clamps below floor", () => {
    expect(clampPreviewBytes(10)).toBe(256);
  });

  test("clamps above ceiling", () => {
    expect(clampPreviewBytes(999_999)).toBe(65536);
  });

  test("passes through valid", () => {
    expect(clampPreviewBytes(1024)).toBe(1024);
  });
});

describe("truncateMarkdown", () => {
  test("returns untruncated when under limit", () => {
    const text = "hello";
    const r = truncateMarkdown(text, 1024);
    expect(r.markdown).toBe("hello");
    expect(r.truncated).toBe(false);
  });

  test("truncates at byte boundary not codepoint mid-sequence", () => {
    const text = "a".repeat(10) + "é".repeat(10);
    const r = truncateMarkdown(text, 15);
    expect(r.truncated).toBe(true);
    expect(Buffer.byteLength(r.markdown, "utf8")).toBeLessThanOrEqual(15);
    expect(() => Buffer.from(r.markdown, "utf8").toString("utf8")).not.toThrow();
    expect(r.markdown.length).toBeGreaterThan(0);
  });

  test("never splits a multi-byte char in half", () => {
    const text = "héllo";
    const r = truncateMarkdown(text, 2);
    expect(r.truncated).toBe(true);
    expect(r.markdown).toBe("h");
  });
});
