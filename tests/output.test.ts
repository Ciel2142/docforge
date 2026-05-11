import { afterEach, beforeEach, describe, expect, test } from "vitest";
import { mkdtempSync, readFileSync, rmSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { buildOutput, writeOutput, detectCollisions, CollisionError, writeReportJson, type ReportEntry } from "../src/output.js";

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

  test("hoists body H1 when present, dropping title arg", () => {
    expect(buildOutput("ignored", "p.html", "# Body Heading\n\nPara.")).toBe(
      "# Body Heading\n\nSource: p.html\n\nPara.\n",
    );
  });

  test("body H1 differing from title still wins", () => {
    expect(buildOutput("Title Arg", "p.html", "# Other Heading\n\nText.")).toBe(
      "# Other Heading\n\nSource: p.html\n\nText.\n",
    );
  });

  test("body that is only an H1 produces single-heading output", () => {
    expect(buildOutput("ignored", "p.html", "# Only Heading")).toBe(
      "# Only Heading\n\nSource: p.html\n",
    );
  });

  test("body starting with H2 falls back to title-prefix path", () => {
    expect(buildOutput("Title", "p.html", "## Sub\n\nBody.")).toBe(
      "# Title\n\nSource: p.html\n\n## Sub\n\nBody.\n",
    );
  });

  test("body H1 with surrounding whitespace still hoists", () => {
    expect(buildOutput("ignored", "p.html", "\n\n# Heading\n\nPara.\n")).toBe(
      "# Heading\n\nSource: p.html\n\nPara.\n",
    );
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

describe("writeReportJson", () => {
  test("writes per-file report as pretty json", () => {
    const out = join(tmp, "report.json");
    writeReportJson(out, [
      { input: "a.html", srcUri: "", output: "a.md", status: "ok" },
      { input: "b.html", srcUri: "", output: null, status: "empty" },
      { input: "c.html", srcUri: "", output: null, status: "failed", error: "boom" },
    ]);
    const parsed = JSON.parse(readFileSync(out, "utf8"));
    expect(parsed.entries).toHaveLength(3);
    expect(parsed.entries[1].status).toBe("empty");
    expect(parsed.entries[2].error).toBe("boom");
  });
});

describe("ReportEntry srcUri", () => {
  test("writeReportJson persists srcUri", () => {
    const tmp = mkdtempSync(join(tmpdir(), "df-report-"));
    try {
      const entries: ReportEntry[] = [
        {
          input: "guide/foo.html",
          srcUri: "https://x.com/guide/foo.html",
          output: "/out/guide/foo.md",
          status: "ok",
        },
      ];
      const p = join(tmp, "r.json");
      writeReportJson(p, entries);
      const parsed = JSON.parse(readFileSync(p, "utf8"));
      expect(parsed.entries[0].srcUri).toBe("https://x.com/guide/foo.html");
    } finally {
      rmSync(tmp, { recursive: true, force: true });
    }
  });
});
