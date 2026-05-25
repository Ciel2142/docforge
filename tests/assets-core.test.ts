import { describe, expect, test } from "vitest";
import { rewriteImageRefs } from "../src/assets/core.js";
import type { RewriteDeps } from "../src/assets/types.js";

function deps(overrides: Partial<RewriteDeps> = {}): RewriteDeps {
  return {
    resolve: async (src) => ({ bytes: Buffer.from(src), ext: "png" }),
    store: (bytes) => ({ filename: `${bytes.toString()}.png`, deduped: false }),
    ...overrides,
  };
}

describe("rewriteImageRefs", () => {
  test("rewrites a raster ref to an Obsidian embed", async () => {
    const { md, stats } = await rewriteImageRefs("a ![x](pic.png) b", {
      resolve: async () => ({ bytes: Buffer.from("B"), ext: "png" }),
      store: () => ({ filename: "deadbeef.png", deduped: false }),
    });
    expect(md).toBe("a ![[deadbeef.png]] b");
    expect(stats).toEqual({ saved: 1, deduped: 0, skipped: 0, failed: 0 });
  });

  test("skips non-raster refs and leaves them intact", async () => {
    const { md, stats } = await rewriteImageRefs("![v](movie.svg)", deps());
    expect(md).toBe("![v](movie.svg)");
    expect(stats.skipped).toBe(1);
    expect(stats.saved).toBe(0);
  });

  test("ignores refs inside fenced code blocks", async () => {
    const { md, stats } = await rewriteImageRefs("```\n![x](in.png)\n```", deps());
    expect(md).toContain("![x](in.png)");
    expect(stats.saved).toBe(0);
    expect(stats.skipped).toBe(0);
  });

  test("counts dedup separately from saved", async () => {
    let n = 0;
    const { stats } = await rewriteImageRefs("![a](1.png) ![b](2.png)", {
      resolve: async () => ({ bytes: Buffer.from("X"), ext: "png" }),
      store: () => ({ filename: "x.png", deduped: n++ > 0 }),
    });
    expect(stats.saved).toBe(1);
    expect(stats.deduped).toBe(1);
  });

  test("resolve failure leaves the ref and counts failed", async () => {
    const { md, stats } = await rewriteImageRefs("![a](broken.png)", {
      resolve: async () => { throw new Error("nope"); },
      store: () => ({ filename: "n.png", deduped: false }),
    });
    expect(md).toBe("![a](broken.png)");
    expect(stats.failed).toBe(1);
  });

  test("applies multiple edits without corrupting offsets", async () => {
    const { md } = await rewriteImageRefs("![a](1.png) and ![b](2.png)", {
      resolve: async (src) => ({ bytes: Buffer.from(src), ext: "png" }),
      store: (bytes) => ({ filename: bytes.toString().includes("1") ? "one.png" : "two.png", deduped: false }),
    });
    expect(md).toBe("![[one.png]] and ![[two.png]]");
  });
});
