import { describe, expect, test, beforeEach, afterEach } from "vitest";
import {
  mkdtempSync, rmSync, mkdirSync, writeFileSync, readFileSync,
  existsSync, readdirSync, utimesSync,
} from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import {
  collectionPaths,
  commitTmpToFinal,
  removeStaleTmpDirs,
} from "../../src/mcp/atomic.js";

let root: string;
beforeEach(() => {
  root = mkdtempSync(join(tmpdir(), "df-atomic-"));
});
afterEach(() => {
  rmSync(root, { recursive: true, force: true });
});

describe("collectionPaths", () => {
  test("produces final, tmp, old, lock paths", () => {
    const p = collectionPaths(root, "docs-foo");
    expect(p.final).toBe(join(root, "docs-foo"));
    expect(p.tmp).toBe(join(root, "docs-foo.tmp"));
    expect(p.old).toBe(join(root, "docs-foo.old"));
    expect(p.lock).toBe(join(root, "docs-foo.lock"));
  });
});

describe("commitTmpToFinal", () => {
  test("swaps tmp into place when no prior corpus", () => {
    const p = collectionPaths(root, "c1");
    mkdirSync(p.tmp);
    writeFileSync(join(p.tmp, "a.md"), "new");
    commitTmpToFinal(p);
    expect(readFileSync(join(p.final, "a.md"), "utf8")).toBe("new");
    expect(existsSync(p.tmp)).toBe(false);
  });

  test("replaces prior corpus atomically", () => {
    const p = collectionPaths(root, "c2");
    mkdirSync(p.final);
    writeFileSync(join(p.final, "a.md"), "old");
    mkdirSync(p.tmp);
    writeFileSync(join(p.tmp, "a.md"), "new");
    writeFileSync(join(p.tmp, "b.md"), "new2");
    commitTmpToFinal(p);
    expect(readFileSync(join(p.final, "a.md"), "utf8")).toBe("new");
    expect(readFileSync(join(p.final, "b.md"), "utf8")).toBe("new2");
    expect(existsSync(p.tmp)).toBe(false);
    expect(existsSync(p.old)).toBe(false);
  });
});

describe("removeStaleTmpDirs", () => {
  test("removes *.tmp older than threshold, preserves younger", () => {
    const stale = join(root, "old-corpus.tmp");
    const fresh = join(root, "new-corpus.tmp");
    mkdirSync(stale);
    mkdirSync(fresh);
    writeFileSync(join(stale, "f.md"), "x");
    writeFileSync(join(fresh, "f.md"), "x");
    const twoHoursAgo = new Date(Date.now() - 2 * 3600 * 1000);
    utimesSync(stale, twoHoursAgo, twoHoursAgo);
    removeStaleTmpDirs(root, 3600 * 1000); // 1h threshold
    expect(existsSync(stale)).toBe(false);
    expect(existsSync(fresh)).toBe(true);
  });

  test("ignores non-tmp directories", () => {
    mkdirSync(join(root, "regular-corpus"));
    removeStaleTmpDirs(root, 0);
    expect(existsSync(join(root, "regular-corpus"))).toBe(true);
  });

  test("returns empty when root missing", () => {
    expect(() => removeStaleTmpDirs(join(root, "nope"), 0)).not.toThrow();
  });
});
