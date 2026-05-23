import { afterEach, beforeEach, describe, expect, test } from "vitest";
import { mkdtempSync, rmSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { runConvert } from "../src/cli.js";

let tmp: string;
beforeEach(() => {
  tmp = mkdtempSync(join(tmpdir(), "docforge-cli-vlm-"));
});
afterEach(() => {
  rmSync(tmp, { recursive: true, force: true });
  delete process.env.DOCFORGE_VLM_BASE_URL;
  delete process.env.DOCFORGE_VLM_MODEL;
  delete process.env.DOCFORGE_VLM_API_KEY;
});

function baseOpts(output: string) {
  return {
    output,
    failThreshold: "0.10",
    maxBytes: "10485760",
    dryRun: false,
    maxPages: "1",
    maxDepth: "1",
    concurrency: "1",
    cacheDir: join(tmp, ".cache"),
    cache: false,
    userAgent: "docforge-test/0",
    llmsFull: "auto",
  };
}

describe("convert --describe-images validation", () => {
  test("exits 2 when --describe-images is set without base-url/model", async () => {
    const code = await runConvert("https://example.com/", {
      ...baseOpts(join(tmp, "o")),
      describeImages: true,
    });
    expect(code).toBe(2);
  });

  test("exits 2 when a numeric --vlm flag is not an integer", async () => {
    const code = await runConvert("https://example.com/", {
      ...baseOpts(join(tmp, "o")),
      describeImages: true,
      vlmBaseUrl: "http://127.0.0.1:1/v1",
      vlmModel: "x",
      vlmMinDim: "abc",
    });
    expect(code).toBe(2);
  });

  test("warns and proceeds (exit 0) when --describe-images is set on a local source", async () => {
    // A local directory source: VLM is URL-only, so the flag is ignored with a warning.
    const code = await runConvert(tmp, {
      ...baseOpts(join(tmp, "o")),
      describeImages: true,
      vlmBaseUrl: "http://127.0.0.1:1/v1",
      vlmModel: "x",
    });
    expect(code).toBe(0); // empty dir → 0 converted, 0 failed → under threshold
  });
});
