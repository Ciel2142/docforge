import { describe, expect, test } from "vitest";
import { restoreTables } from "../src/tables.js";

describe("restoreTables", () => {
  test("replaces each token with its HTML block and tidies blank lines", () => {
    const md = "before\n\nDOCFORGETABLEab12N0END\n\nafter";
    const out = restoreTables(md, [
      { token: "DOCFORGETABLEab12N0END", html: "<table><tr><td>x</td></tr></table>" },
    ]);
    expect(out).toContain("<table><tr><td>x</td></tr></table>");
    expect(out).not.toContain("DOCFORGETABLEab12N0END");
    expect(out).not.toMatch(/\n{3,}/);
  });

  test("is a no-op when there are no placeholders", () => {
    expect(restoreTables("hello\n\n\nworld", [])).toBe("hello\n\n\nworld");
  });
});
