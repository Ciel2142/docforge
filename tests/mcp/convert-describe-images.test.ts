import { afterEach, beforeEach, describe, expect, test } from "vitest";
import { mkdtempSync, rmSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { convertTool } from "../../src/mcp/tools/convert.js";
import { LockManager } from "../../src/mcp/locks.js";
import type { ServerContext } from "../../src/mcp/server.js";

let tmp: string;
function ctx(vlm?: { baseUrl: string; model: string; apiKey?: string }): ServerContext {
  return {
    config: {
      qmdRoot: tmp,
      cacheDir: join(tmp, ".cache"),
      userAgent: "docforge-test/0",
      maxPages: 1,
      maxDepth: 1,
      concurrency: 1,
      ...(vlm ? { vlm } : {}),
    },
    locks: new LockManager(),
  };
}

beforeEach(() => {
  tmp = mkdtempSync(join(tmpdir(), "docforge-mcp-vlm-"));
});
afterEach(() => {
  rmSync(tmp, { recursive: true, force: true });
});

describe("convert tool — describe_images", () => {
  test("exposes describe_images in the input schema", () => {
    const props = convertTool.inputSchema.properties as Record<string, unknown>;
    expect(props.describe_images).toBeDefined();
    expect(props.vlm_min_dim).toBeDefined();
    expect(props.vlm_max_images).toBeDefined();
  });

  test("rejects describe_images=true when the server has no VLM configured (INVALID_ARGS)", async () => {
    await expect(
      convertTool.handler({ url: "https://example.com/", describe_images: true }, ctx()),
    ).rejects.toMatchObject({ code: "INVALID_ARGS" });
  });
});
