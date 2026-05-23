import { describe, expect, test } from "vitest";
import { captionBlock, describeImages } from "../src/vlm/describe.js";
import type { DescribeDeps, FetchedImage } from "../src/vlm/types.js";

const VLM = { baseUrl: "http://x/v1", model: "m", minDim: 64, maxImages: 50, concurrency: 2, timeoutMs: 1000 };

function deps(over: Partial<DescribeDeps> = {}): DescribeDeps {
  return {
    fetchImage: async (): Promise<FetchedImage> => ({ bytes: Buffer.from("img"), mime: "image/png" }),
    describe: async () => "A factual description.",
    sizeOf: () => ({ width: 800, height: 600 }),
    promptVersion: "test",
    ...over,
  };
}

describe("captionBlock", () => {
  test("formats a blockquote figure caption", () => {
    expect(captionBlock("Arch", "A diagram.")).toBe("\n\n> **Figure — Arch.** A diagram.");
  });
  test("falls back to 'image' when alt is empty and collapses whitespace", () => {
    expect(captionBlock("", "line one\n\nline two")).toBe("\n\n> **Figure — image.** line one line two");
  });
});

describe("describeImages", () => {
  test("injects a caption block after a described image", async () => {
    const md = "# H\n\n![Arch](/a.png)\n\nbody";
    const { md: out, stats } = await describeImages(md, "http://h/page", VLM, deps());
    expect(out).toBe("# H\n\n![Arch](/a.png)\n\n> **Figure — Arch.** A factual description.\n\nbody");
    expect(stats).toEqual({ described: 1, skipped: 0, failed: 0, cached: 0 });
  });

  test("injects captions for multiple images with correct back-to-front placement", async () => {
    const md = "# H\n\n![A](/a.png)\n\n![B](/b.png)\n\nend";
    const { md: out, stats } = await describeImages(md, "http://h/page", VLM, deps());
    expect(out).toBe(
      "# H\n\n![A](/a.png)\n\n> **Figure — A.** A factual description.\n\n![B](/b.png)\n\n> **Figure — B.** A factual description.\n\nend",
    );
    expect(stats).toEqual({ described: 2, skipped: 0, failed: 0, cached: 0 });
  });

  test("skips non-describable refs and counts them", async () => {
    const md = "![logo](/logo.png)\n\n![real](/real.png)";
    const { stats } = await describeImages(md, "http://h/p", VLM, deps());
    expect(stats.described).toBe(1);
    expect(stats.skipped).toBe(1);
  });

  test("skips images below minDim", async () => {
    const { md: out, stats } = await describeImages("![a](/a.png)", "http://h/p", VLM, deps({ sizeOf: () => ({ width: 32, height: 16 }) }));
    expect(stats.skipped).toBe(1);
    expect(stats.described).toBe(0);
    expect(out).toBe("![a](/a.png)"); // untouched
  });

  test("uses the cache on a hit (no describe call)", async () => {
    let calls = 0;
    const cache = new Map<string, string>();
    const { stats } = await describeImages("![a](/a.png)", "http://h/p", VLM, deps({
      describe: async () => { calls++; return "fresh"; },
      cache: { get: async (k) => cache.get(k), set: async (k, v) => { cache.set(k, v); } },
    }));
    expect(stats.described).toBe(1);
    expect(calls).toBe(1);

    // Second run with the now-populated cache → cached hit, no new describe call.
    const { stats: s2 } = await describeImages("![a](/a.png)", "http://h/p", VLM, deps({
      describe: async () => { calls++; return "fresh"; },
      cache: { get: async (k) => cache.get(k), set: async (k, v) => { cache.set(k, v); } },
    }));
    expect(s2.cached).toBe(1);
    expect(s2.described).toBe(0);
    expect(calls).toBe(1); // unchanged
  });

  test("swallows a describe failure and leaves the image untouched", async () => {
    const md = "![a](/a.png)";
    const { md: out, stats } = await describeImages(md, "http://h/p", VLM, deps({
      describe: async () => { throw new Error("model down"); },
    }));
    expect(stats.failed).toBe(1);
    expect(out).toBe(md);
  });

  test("respects maxImages cap", async () => {
    const md = "![a](/a.png)\n\n![b](/b.png)\n\n![c](/c.png)";
    const { stats } = await describeImages(md, "http://h/p", { ...VLM, maxImages: 2 }, deps());
    expect(stats.described).toBe(2);
    expect(stats.skipped).toBe(1);
  });
});
