import { describe, expect, test } from "vitest";
import { isSavable } from "../src/vlm/select.js";

describe("isSavable", () => {
  test("accepts raster extensions including decorative names (unlike isDescribable)", () => {
    for (const s of ["a.png", "a.jpg", "a.jpeg", "a.webp", "a.gif", "a.bmp", "logo.png", "icon.gif", "a.PNG?x=1"]) {
      expect(isSavable(s)).toBe(true);
    }
  });
  test("accepts raster data URIs", () => {
    expect(isSavable("data:image/png;base64,AAAA")).toBe(true);
  });
  test("rejects svg, svg data URIs, and extensionless/unknown", () => {
    expect(isSavable("a.svg")).toBe(false);
    expect(isSavable("data:image/svg+xml,<svg/>")).toBe(false);
    expect(isSavable("/image?id=5")).toBe(false);
  });
});
