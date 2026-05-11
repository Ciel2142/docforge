import { describe, expect, test, beforeEach, afterEach } from "vitest";
import { mkdtempSync, rmSync, readFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { join, resolve, dirname } from "node:path";
import { fileURLToPath } from "node:url";
import { convertOpenapiTool } from "../../src/mcp/tools/convert_openapi.js";
import { LockManager } from "../../src/mcp/locks.js";
import { readManifest } from "../../src/mcp/manifest.js";

const __dirname = dirname(fileURLToPath(import.meta.url));
const SPEC_FIXTURE_PATH = resolve(__dirname, "../openapi/fixtures/petstore-mini.json");

let qmdRoot: string;
beforeEach(() => {
  qmdRoot = mkdtempSync(join(tmpdir(), "df-openapi-"));
});
afterEach(() => {
  rmSync(qmdRoot, { recursive: true, force: true });
});

function ctx() {
  return {
    config: {
      qmdRoot,
      cacheDir: join(qmdRoot, ".cache"),
      userAgent: "docforge-test/1.0",
      maxPages: 5000,
      maxDepth: 10,
      concurrency: 4,
    },
    locks: new LockManager(),
  };
}

describe("convert_openapi tool", () => {
  test("inline spec produces operation pages + manifest", async () => {
    const raw = readFileSync(SPEC_FIXTURE_PATH, "utf8");
    const res = await convertOpenapiTool.handler(
      { source: raw, is_inline: true, format: "json", corpus: "petstore" },
      ctx(),
    );
    const sc = res.structuredContent as any;
    expect(sc.collection).toBe("petstore");
    expect(sc.kind_resolved).toBe("openapi");
    expect(sc.pages.length).toBeGreaterThan(0);
    const m = readManifest(sc.path);
    expect(m?.kind).toBe("openapi");
  });

  test("rejects unparseable inline spec", async () => {
    await expect(
      convertOpenapiTool.handler(
        { source: "this is not openapi", is_inline: true, format: "yaml", corpus: "bad" },
        ctx(),
      ),
    ).rejects.toMatchObject({ code: "OPENAPI_PARSE" });
  });
});
