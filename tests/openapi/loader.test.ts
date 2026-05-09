import { afterEach, beforeEach, describe, expect, test } from "vitest";
import { mkdtempSync, rmSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { UnsupportedSpecError, loadSpec } from "../../src/openapi/loader.js";

let tmp: string;
beforeEach(() => {
  tmp = mkdtempSync(join(tmpdir(), "docforge-loader-"));
});
afterEach(() => {
  rmSync(tmp, { recursive: true, force: true });
});

describe("loadSpec", () => {
  test("loads valid 3.x JSON", () => {
    const p = join(tmp, "spec.json");
    writeFileSync(p, JSON.stringify({ openapi: "3.0.0", info: {}, paths: {} }));
    const spec = loadSpec(p);
    expect(spec.openapi).toBe("3.0.0");
  });

  test("loads valid 3.x YAML", () => {
    const p = join(tmp, "spec.yaml");
    writeFileSync(p, "openapi: '3.0.0'\ninfo: {}\npaths: {}\n");
    const spec = loadSpec(p);
    expect(spec.openapi).toBe("3.0.0");
  });

  test("rejects unknown suffix", () => {
    const p = join(tmp, "spec.txt");
    writeFileSync(p, "{}");
    expect(() => loadSpec(p)).toThrow(UnsupportedSpecError);
  });

  test("rejects swagger 2.0", () => {
    const p = join(tmp, "spec.json");
    writeFileSync(p, JSON.stringify({ swagger: "2.0", paths: {} }));
    expect(() => loadSpec(p)).toThrow(/swagger 2.0/i);
  });

  test("rejects unsupported openapi version", () => {
    const p = join(tmp, "spec.json");
    writeFileSync(p, JSON.stringify({ openapi: "2.0", paths: {} }));
    expect(() => loadSpec(p)).toThrow(/unsupported/i);
  });

  test("rejects non-object root", () => {
    const p = join(tmp, "spec.json");
    writeFileSync(p, JSON.stringify(["not", "an", "object"]));
    expect(() => loadSpec(p)).toThrow(UnsupportedSpecError);
  });
});
