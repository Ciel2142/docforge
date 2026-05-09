import { afterEach, beforeEach, describe, expect, test } from "vitest";
import { mkdtempSync, readFileSync, rmSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { buildOutput, writeOutput, detectCollisions, CollisionError } from "../src/output.js";

let tmp: string;
beforeEach(() => {
  tmp = mkdtempSync(join(tmpdir(), "docforge-out-"));
});
afterEach(() => {
  rmSync(tmp, { recursive: true, force: true });
});

describe("buildOutput", () => {
  test("basic shape", () => {
    expect(buildOutput("My Title", "dir/page.html", "Body content here.")).toBe(
      "# My Title\n\nSource: dir/page.html\n\nBody content here.\n",
    );
  });

  test("strips trailing whitespace in body", () => {
    expect(buildOutput("T", "p.html", "  Body.  \n\n  ")).toBe(
      "# T\n\nSource: p.html\n\nBody.\n",
    );
  });

  test("keeps internal blank lines", () => {
    const out = buildOutput("T", "p.html", "Para 1.\n\nPara 2.");
    expect(out.includes("Para 1.\n\nPara 2.")).toBe(true);
  });

  test("handles unicode title", () => {
    const out = buildOutput("Заголовок", "ru.html", "Текст");
    expect(out.startsWith("# Заголовок\n")).toBe(true);
  });
});

describe("writeOutput", () => {
  test("creates parent dirs", () => {
    const out = join(tmp, "deep", "nested", "file.md");
    writeOutput(out, "content");
    expect(readFileSync(out, "utf8")).toBe("content");
  });

  test("overwrites existing", () => {
    const out = join(tmp, "file.md");
    writeFileSync(out, "old");
    writeOutput(out, "new");
    expect(readFileSync(out, "utf8")).toBe("new");
  });
});

describe("detectCollisions", () => {
  test("returns mapping when unique", () => {
    const a = "/src/a.html";
    const b = "/src/sub/b.html";
    const m = detectCollisions([a, b], "/src", "/out");
    expect(m.get(a)).toBe("/out/a.md");
    expect(m.get(b)).toBe("/out/sub/b.md");
  });

  test("throws on duplicate output (case-insensitive)", () => {
    const upper = "/src/Foo.html";
    const lower = "/src/foo.html";
    expect(() =>
      detectCollisions([upper, lower], "/src", "/out", { caseInsensitive: true }),
    ).toThrow(CollisionError);
  });

  test("collision message lists all colliding inputs", () => {
    try {
      detectCollisions(
        ["/src/Foo.html", "/src/foo.html"],
        "/src",
        "/out",
        { caseInsensitive: true },
      );
      throw new Error("expected throw");
    } catch (e) {
      expect(e).toBeInstanceOf(CollisionError);
      const msg = (e as Error).message;
      expect(msg).toContain("Foo.html");
      expect(msg).toContain("foo.html");
    }
  });

  test("htm and html mapping to same md collides", () => {
    expect(() =>
      detectCollisions(["/src/page.html", "/src/page.htm"], "/src", "/out"),
    ).toThrow(CollisionError);
  });
});
