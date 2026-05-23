import { describe, expect, test } from "vitest";
import { findImageRefs, isDescribable } from "../src/vlm/select.js";

describe("findImageRefs", () => {
  test("finds inline image with alt + src", () => {
    const refs = findImageRefs("intro\n\n![Arch overview](diagrams/arch.png)\n\nmore");
    expect(refs).toHaveLength(1);
    expect(refs[0]?.alt).toBe("Arch overview");
    expect(refs[0]?.src).toBe("diagrams/arch.png");
    expect(refs[0]?.match).toBe("![Arch overview](diagrams/arch.png)");
  });

  test("strips a title from the src token", () => {
    const refs = findImageRefs('![a](b.png "the title")');
    expect(refs[0]?.src).toBe("b.png");
  });

  test("ignores images inside fenced code blocks", () => {
    const md = "```\n![x](in-code.png)\n```\n\n![y](real.png)";
    const refs = findImageRefs(md);
    expect(refs).toHaveLength(1);
    expect(refs[0]?.src).toBe("real.png");
  });

  test("returns correct index for the match", () => {
    const md = "abc ![a](x.png)";
    expect(findImageRefs(md)[0]?.index).toBe(4);
  });
});

describe("isDescribable", () => {
  test("accepts raster extensions", () => {
    for (const s of ["a.png", "a.jpg", "a.jpeg", "a.webp", "a.gif", "a.bmp", "a.PNG?x=1"]) {
      expect(isDescribable(s)).toBe(true);
    }
  });
  test("accepts raster data URIs", () => {
    expect(isDescribable("data:image/png;base64,AAAA")).toBe(true);
  });
  test("does not apply the decorative-name skip to data-URI base64 content", () => {
    // base64 payload literally contains "logo"; must NOT be skipped (heuristic is filename-only).
    expect(isDescribable("data:image/png;base64,iVBORlogow0KGgo")).toBe(true);
  });
  test("rejects svg and unknown/extensionless", () => {
    expect(isDescribable("a.svg")).toBe(false);
    expect(isDescribable("data:image/svg+xml,<svg/>")).toBe(false);
    expect(isDescribable("/image?id=5")).toBe(false);
  });
  test("rejects decorative names even with a raster extension", () => {
    for (const s of ["logo.png", "site-icon.png", "avatar.jpg", "badge.svg", "spacer.gif", "x/emoji.png", "pixel.gif", "sprite.png"]) {
      expect(isDescribable(s)).toBe(false);
    }
  });
});
