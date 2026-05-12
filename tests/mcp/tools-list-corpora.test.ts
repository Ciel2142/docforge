import { describe, expect, test, beforeEach, afterEach } from "vitest";
import { mkdtempSync, rmSync, mkdirSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { listCorporaTool } from "../../src/mcp/tools/list_corpora.js";
import { LockManager } from "../../src/mcp/locks.js";
import { MANIFEST_FILE } from "../../src/mcp/manifest.js";

let qmdRoot: string;
beforeEach(() => {
  qmdRoot = mkdtempSync(join(tmpdir(), "df-list-"));
});
afterEach(() => {
  rmSync(qmdRoot, { recursive: true, force: true });
});

function ctx() {
  return {
    config: {
      qmdRoot,
      cacheDir: join(qmdRoot, ".cache"),
      userAgent: "x", maxPages: 1, maxDepth: 1, concurrency: 1,
    },
    locks: new LockManager(),
  };
}

function seedCorpus(name: string, source_url: string, kind: string) {
  const dir = join(qmdRoot, name);
  mkdirSync(dir, { recursive: true });
  writeFileSync(join(dir, "index.md"), "# hi");
  writeFileSync(join(dir, MANIFEST_FILE), JSON.stringify({
    version: 1, collection: name, source_url, kind,
    last_run: "2026-05-11T00:00:00.000Z", page_count: 1,
    sha: "abc", docforge_version: "0.6.0",
  }));
}

describe("list_corpora tool", () => {
  test("returns empty list when root empty", async () => {
    const res = await listCorporaTool.handler({}, ctx());
    expect((res.structuredContent as any).corpora).toEqual([]);
  });

  test("lists corpora with manifests, skips dirs without", async () => {
    seedCorpus("docs-foo", "https://docs.foo.dev/", "site");
    seedCorpus("petstore", "https://api.example.com/openapi.yaml", "openapi");
    mkdirSync(join(qmdRoot, "no-manifest"));
    writeFileSync(join(qmdRoot, "no-manifest", "a.md"), "x");

    const res = await listCorporaTool.handler({}, ctx());
    const names = (res.structuredContent as any).corpora.map((c: any) => c.collection).sort();
    expect(names).toEqual(["docs-foo", "petstore"]);
  });

  test("filter substring narrows results", async () => {
    seedCorpus("docs-foo", "https://docs.foo.dev/", "site");
    seedCorpus("petstore", "https://api.example.com/openapi.yaml", "openapi");

    const res = await listCorporaTool.handler({ filter: "foo" }, ctx());
    const names = (res.structuredContent as any).corpora.map((c: any) => c.collection);
    expect(names).toEqual(["docs-foo"]);
  });
});
