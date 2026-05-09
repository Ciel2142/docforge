import { afterEach, beforeEach, describe, expect, test } from "vitest";
import { mkdtempSync, mkdirSync, writeFileSync, symlinkSync, rmSync } from "node:fs";
import { tmpdir } from "node:os";
import { join, relative, sep } from "node:path";
import { iterHtmlFiles } from "../src/walk.js";

let tmp: string;

beforeEach(() => {
  tmp = mkdtempSync(join(tmpdir(), "docforge-walk-"));
});
afterEach(() => {
  rmSync(tmp, { recursive: true, force: true });
});

function touch(p: string, content = ""): string {
  const dir = p.split(sep).slice(0, -1).join(sep);
  if (dir) mkdirSync(dir, { recursive: true });
  writeFileSync(p, content);
  return p;
}

function names(paths: string[]): string[] {
  return paths.map((p) => p.split(sep).at(-1)!).sort();
}

function rels(paths: string[], root: string): string[] {
  return paths.map((p) => relative(root, p).split(sep).join("/")).sort();
}

describe("iterHtmlFiles", () => {
  test("finds single html file when source is a file", () => {
    const f = touch(join(tmp, "a.html"));
    const r = iterHtmlFiles(f, 10_000);
    expect(r.paths).toEqual([f]);
    expect(r.skippedCount).toBe(0);
  });

  test("skips non-html extensions", () => {
    touch(join(tmp, "a.html"));
    touch(join(tmp, "b.css"));
    touch(join(tmp, "c.js"));
    touch(join(tmp, "d.png"));
    touch(join(tmp, "e.txt"));
    const r = iterHtmlFiles(tmp, 10_000);
    expect(names(r.paths)).toEqual(["a.html"]);
    expect(r.skippedCount).toBe(4);
  });

  test("includes .htm extension", () => {
    touch(join(tmp, "a.htm"));
    expect(names(iterHtmlFiles(tmp, 10_000).paths)).toEqual(["a.htm"]);
  });

  test("skips named files", () => {
    touch(join(tmp, "page.html"));
    touch(join(tmp, "genindex.html"));
    touch(join(tmp, "search.html"));
    const r = iterHtmlFiles(tmp, 10_000);
    expect(names(r.paths)).toEqual(["page.html"]);
    expect(r.skippedCount).toBe(2);
  });

  test("skips _static and _downloads dirs", () => {
    touch(join(tmp, "page.html"));
    touch(join(tmp, "_static", "asset.html"));
    touch(join(tmp, "_downloads", "dl.html"));
    expect(names(iterHtmlFiles(tmp, 10_000).paths)).toEqual(["page.html"]);
  });

  test("skips dot-dirs", () => {
    touch(join(tmp, "page.html"));
    touch(join(tmp, ".git", "hidden.html"));
    touch(join(tmp, ".venv", "lib.html"));
    touch(join(tmp, ".tox", "x.html"));
    expect(names(iterHtmlFiles(tmp, 10_000).paths)).toEqual(["page.html"]);
  });

  test("skips node_modules / __pycache__ / dist / build", () => {
    touch(join(tmp, "page.html"));
    touch(join(tmp, "node_modules", "x.html"));
    touch(join(tmp, "__pycache__", "x.html"));
    touch(join(tmp, "dist", "x.html"));
    touch(join(tmp, "build", "x.html"));
    expect(names(iterHtmlFiles(tmp, 10_000).paths)).toEqual(["page.html"]);
  });

  test("recursive walk yields nested paths", () => {
    touch(join(tmp, "top.html"));
    touch(join(tmp, "sub", "mid.html"));
    touch(join(tmp, "sub", "deeper", "leaf.html"));
    expect(rels(iterHtmlFiles(tmp, 10_000).paths, tmp)).toEqual([
      "sub/deeper/leaf.html",
      "sub/mid.html",
      "top.html",
    ]);
  });

  test("sorted iteration within a directory", () => {
    touch(join(tmp, "c.html"));
    touch(join(tmp, "a.html"));
    touch(join(tmp, "b.html"));
    const paths = iterHtmlFiles(tmp, 10_000).paths;
    expect(paths.map((p) => p.split(sep).at(-1))).toEqual([
      "a.html",
      "b.html",
      "c.html",
    ]);
  });

  test("does not follow symlinks (file)", () => {
    const real = touch(join(tmp, "real.html"));
    symlinkSync(real, join(tmp, "link.html"));
    expect(names(iterHtmlFiles(tmp, 10_000).paths)).toEqual(["real.html"]);
  });

  test("does not follow symlinks (dir)", () => {
    const realDir = join(tmp, "real");
    touch(join(realDir, "inside.html"));
    symlinkSync(realDir, join(tmp, "link_dir"), "dir");
    expect(rels(iterHtmlFiles(tmp, 10_000).paths, tmp)).toEqual(["real/inside.html"]);
  });

  test("skips files above maxBytes and counts them as skipped", () => {
    touch(join(tmp, "big.html"), "x".repeat(5000));
    touch(join(tmp, "small.html"), "ok");
    const r = iterHtmlFiles(tmp, 1000);
    expect(names(r.paths)).toEqual(["small.html"]);
    expect(r.skippedCount).toBe(1);
  });
});
