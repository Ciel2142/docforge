import { beforeEach, describe, expect, test, vi } from "vitest";
import { mkdtempSync, mkdirSync, rmSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";

vi.mock("../src/http/render.js", async (importOriginal) => {
  const mod = await importOriginal<typeof import("../src/http/render.js")>();
  return { ...mod, probeRenderAvailable: vi.fn(async () => {}) };
});

import { probeRenderAvailable } from "../src/http/render.js";
import { runConvert } from "../src/cli.js";

beforeEach(() => {
  vi.mocked(probeRenderAvailable).mockClear();
});

function baseOpts(output: string, render?: string) {
  return {
    output,
    failThreshold: "0.10",
    maxBytes: "10485760",
    dryRun: false,
    maxPages: "10",
    maxDepth: "2",
    concurrency: "1",
    cacheDir: join(output, ".cache"),
    cache: false,
    userAgent: "docforge-test/0",
    llmsFull: "off",
    ...(render !== undefined ? { render } : {}),
  };
}

describe("--render CLI flag", () => {
  test("invalid value → exit 2, no probe, no fetch", async () => {
    const tmp = mkdtempSync(join(tmpdir(), "docforge-cli-render-"));
    try {
      const code = await runConvert("http://localhost:9/", baseOpts(tmp, "banana"));
      expect(code).toBe(2);
    } finally {
      rmSync(tmp, { recursive: true, force: true });
    }
  });

  test("missing playwright (probe throws) → exit 2 before crawling", async () => {
    const tmp = mkdtempSync(join(tmpdir(), "docforge-cli-render-"));
    vi.mocked(probeRenderAvailable).mockRejectedValueOnce(
      new Error("--render requires playwright: npm i playwright && npx playwright install chromium"),
    );
    try {
      const code = await runConvert("http://localhost:9/", baseOpts(tmp, "auto"));
      expect(code).toBe(2);
    } finally {
      rmSync(tmp, { recursive: true, force: true });
    }
  });

  test("--render on filesystem source → warn + ignore, converts normally", async () => {
    const tmp = mkdtempSync(join(tmpdir(), "docforge-cli-render-"));
    const srcDir = join(tmp, "src");
    mkdirSync(srcDir, { recursive: true });
    writeFileSync(
      join(srcDir, "page.html"),
      `<html><head><title>T</title></head><body><main><h1>T</h1><p>${"local static content ".repeat(20)}</p></main></body></html>`,
    );
    const out = join(tmp, "out");
    try {
      const code = await runConvert(srcDir, baseOpts(out, "auto"));
      expect(code).toBe(0);
      expect(vi.mocked(probeRenderAvailable)).not.toHaveBeenCalled(); // fs path skips probe
    } finally {
      rmSync(tmp, { recursive: true, force: true });
    }
  });

  test("--render off is accepted and means static-only", async () => {
    const tmp = mkdtempSync(join(tmpdir(), "docforge-cli-render-"));
    const srcDir = join(tmp, "src");
    mkdirSync(srcDir, { recursive: true });
    writeFileSync(
      join(srcDir, "page.html"),
      `<html><head><title>T</title></head><body><main><h1>T</h1><p>${"local static content ".repeat(20)}</p></main></body></html>`,
    );
    const out = join(tmp, "out");
    try {
      const code = await runConvert(srcDir, baseOpts(out, "off"));
      expect(code).toBe(0);
    } finally {
      rmSync(tmp, { recursive: true, force: true });
    }
  });
});
