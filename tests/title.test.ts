import { describe, expect, test } from "vitest";
import { extractTitle } from "../src/title.js";

describe("extractTitle", () => {
  test("h1 takes priority", () => {
    expect(extractTitle("Body Heading", "Page Title", "stem")).toBe("Body Heading");
  });

  test("soup title when no h1", () => {
    expect(extractTitle(null, "Page Title", "stem")).toBe("Page Title");
  });

  test("stem when no h1 and no title", () => {
    expect(extractTitle(null, null, "stem")).toBe("stem");
  });

  test("empty h1 falls through", () => {
    expect(extractTitle("", "Page Title", "stem")).toBe("Page Title");
  });

  test("empty soup title falls through to stem", () => {
    expect(extractTitle(null, "", "stem")).toBe("stem");
  });

  test("whitespace-only h1 falls through", () => {
    expect(extractTitle("   ", "Page Title", "stem")).toBe("Page Title");
  });
});
