import { describe, expect, test, beforeEach, afterEach } from "vitest";
import { mkdtempSync, rmSync, writeFileSync, readFileSync, mkdirSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import {
  readManifest,
  writeManifest,
  computeCorpusSha,
  MANIFEST_FILE,
  type Manifest,
} from "../../src/mcp/manifest.js";

let dir: string;
beforeEach(() => {
  dir = mkdtempSync(join(tmpdir(), "df-manifest-"));
});
afterEach(() => {
  rmSync(dir, { recursive: true, force: true });
});

const sample: Manifest = {
  version: 1,
  collection: "docs-foo-dev",
  source_url: "https://docs.foo.dev/",
  kind: "site",
  last_run: "2026-05-11T12:00:00.000Z",
  page_count: 3,
  sha: "abc123",
  docforge_version: "0.6.0",
};

describe("writeManifest / readManifest", () => {
  test("roundtrips", () => {
    writeManifest(dir, sample);
    const got = readManifest(dir);
    expect(got).toEqual(sample);
  });

  test("returns null when manifest missing", () => {
    expect(readManifest(dir)).toBeNull();
  });

  test("returns null when manifest malformed", () => {
    writeFileSync(join(dir, MANIFEST_FILE), "{not json");
    expect(readManifest(dir)).toBeNull();
  });

  test("returns null when manifest version mismatched", () => {
    writeFileSync(join(dir, MANIFEST_FILE), JSON.stringify({ ...sample, version: 99 }));
    expect(readManifest(dir)).toBeNull();
  });

  test("write is atomic (no partial file on disk)", () => {
    writeManifest(dir, sample);
    const raw = readFileSync(join(dir, MANIFEST_FILE), "utf8");
    expect(() => JSON.parse(raw)).not.toThrow();
  });
});

describe("computeCorpusSha", () => {
  test("deterministic for same content", () => {
    writeFileSync(join(dir, "a.md"), "hello");
    mkdirSync(join(dir, "sub"));
    writeFileSync(join(dir, "sub", "b.md"), "world");
    const sha1 = computeCorpusSha(dir);
    const sha2 = computeCorpusSha(dir);
    expect(sha1).toBe(sha2);
  });

  test("changes when content changes", () => {
    writeFileSync(join(dir, "a.md"), "hello");
    const sha1 = computeCorpusSha(dir);
    writeFileSync(join(dir, "a.md"), "different");
    const sha2 = computeCorpusSha(dir);
    expect(sha1).not.toBe(sha2);
  });

  test("changes when file added", () => {
    writeFileSync(join(dir, "a.md"), "hello");
    const sha1 = computeCorpusSha(dir);
    writeFileSync(join(dir, "b.md"), "more");
    const sha2 = computeCorpusSha(dir);
    expect(sha1).not.toBe(sha2);
  });

  test("ignores .docforge.json", () => {
    writeFileSync(join(dir, "a.md"), "hello");
    writeFileSync(join(dir, MANIFEST_FILE), JSON.stringify(sample));
    const sha1 = computeCorpusSha(dir);
    writeFileSync(join(dir, MANIFEST_FILE), JSON.stringify({ ...sample, sha: "x" }));
    const sha2 = computeCorpusSha(dir);
    expect(sha1).toBe(sha2);
  });

  test("ignores .docforge.failures.log", () => {
    writeFileSync(join(dir, "a.md"), "hello");
    const sha1 = computeCorpusSha(dir);
    writeFileSync(join(dir, ".docforge.failures.log"), "url\treason\n");
    const sha2 = computeCorpusSha(dir);
    expect(sha1).toBe(sha2);
  });
});
