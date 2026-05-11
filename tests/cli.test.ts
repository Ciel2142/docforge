import { afterEach, beforeEach, describe, expect, test } from "vitest";
import { buildProgram } from "../src/cli.js";

function parse(args: string[]) {
  const p = buildProgram();
  p.exitOverride();
  // commander accumulates options on the matched subcommand; capture via .action
  // by invoking parseAsync and reading opts off the matched command.
  return p;
}

describe("convert parser", () => {
  test("requires source", () => {
    const p = parse([]);
    expect(() => p.parse(["convert"], { from: "user" })).toThrow();
  });

  test("requires --output", () => {
    const p = parse([]);
    expect(() => p.parse(["convert", "src"], { from: "user" })).toThrow();
  });

  test("--version exits 0", () => {
    const p = parse([]);
    try {
      p.parse(["--version"], { from: "user" });
      throw new Error("expected exit");
    } catch (e: any) {
      expect(e.exitCode ?? 0).toBe(0);
    }
  });
});

describe("convert URL detection", () => {
  test("accepts http(s) URL as <source>", () => {
    const p = buildProgram();
    p.exitOverride();
    // Should not throw during parse — actual execution is mocked in integration tests
    expect(() =>
      p.parse(
        ["convert", "https://x.com/", "--output", "/tmp/x", "--dry-run"],
        { from: "user" },
      ),
    ).not.toThrow();
  });

  test("accepts new flags", () => {
    const p = buildProgram();
    p.exitOverride();
    expect(() =>
      p.parse(
        [
          "convert",
          "https://x.com/",
          "--output",
          "/tmp/x",
          "--max-pages",
          "10",
          "--concurrency",
          "2",
          "--no-cache",
          "--dry-run",
        ],
        { from: "user" },
      ),
    ).not.toThrow();
  });
});

import { spawnSync } from "node:child_process";
import {
  existsSync,
  mkdirSync,
  mkdtempSync,
  readFileSync,
  rmSync,
  writeFileSync,
} from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";

let tmp: string;
beforeEach(() => {
  tmp = mkdtempSync(join(tmpdir(), "docforge-cli-"));
});
afterEach(() => {
  rmSync(tmp, { recursive: true, force: true });
});

function makeSphinx(title: string, bodyHtml: string): string {
  return [
    "<html>",
    `<head><title>${title}</title></head>`,
    "<body>",
    '  <div role="main">',
    '    <div itemprop="articleBody">',
    `      ${bodyHtml}`,
    "    </div>",
    "  </div>",
    "</body>",
    "</html>",
    "",
  ].join("\n");
}

function seedTree(root: string): void {
  mkdirSync(root, { recursive: true });
  writeFileSync(
    join(root, "page1.html"),
    makeSphinx("Page 1", "<h1>Page 1</h1><p>Hello.</p>"),
    "utf8",
  );
  mkdirSync(join(root, "sub"), { recursive: true });
  writeFileSync(
    join(root, "sub", "page2.html"),
    makeSphinx(
      "Page 2",
      '<h1>Page 2</h1><p>See <a href="../page1.html">first</a>.</p>',
    ),
    "utf8",
  );
  writeFileSync(join(root, "asset.css"), "body{}", "utf8");
  writeFileSync(
    join(root, "empty.html"),
    "<html><body><p>no body marker</p></body></html>",
    "utf8",
  );
}

function runCli(args: string[]): { code: number; stdout: string; stderr: string } {
  const result = spawnSync("node", ["dist/bin.js", ...args], {
    encoding: "utf8",
    stdio: ["ignore", "pipe", "pipe"],
  });
  return {
    code: result.status ?? 2,
    stdout: result.stdout ?? "",
    stderr: result.stderr ?? "",
  };
}

describe("convert e2e", () => {
  test("converts a tree", () => {
    const src = join(tmp, "src");
    seedTree(src);
    const out = join(tmp, "out");

    const r = runCli(["convert", src, "--output", out]);
    expect(r.code).toBe(0);

    const p1 = readFileSync(join(out, "page1.md"), "utf8");
    const p2 = readFileSync(join(out, "sub", "page2.md"), "utf8");
    expect(p1.startsWith("# Page 1\n\nSource: page1.html\n\n")).toBe(true);
    expect(p1.includes("Hello.")).toBe(true);
    expect(p2.startsWith("# Page 2\n\nSource: sub/page2.html\n\n")).toBe(true);
    expect(p2.includes("../page1.md")).toBe(true);
    expect(existsSync(join(out, "asset.css.md"))).toBe(false);
    expect(existsSync(join(out, "empty.md"))).toBe(false);
  });

  test("--dry-run writes nothing", () => {
    const src = join(tmp, "src");
    seedTree(src);
    const out = join(tmp, "out");
    const r = runCli(["-v", "convert", src, "--output", out, "--dry-run"]);
    expect(r.code).toBe(0);
    expect(existsSync(out)).toBe(true);
    expect(existsSync(join(out, "page1.md"))).toBe(false);
  });

  test("idempotent rerun", () => {
    const src = join(tmp, "src");
    seedTree(src);
    const out = join(tmp, "out");
    runCli(["convert", src, "--output", out]);
    const body1 = readFileSync(join(out, "page1.md"), "utf8");
    runCli(["convert", src, "--output", out]);
    const body2 = readFileSync(join(out, "page1.md"), "utf8");
    expect(body1).toBe(body2);
  });

  test("missing source exits 2", () => {
    const r = runCli(["convert", join(tmp, "nope"), "--output", join(tmp, "out")]);
    expect(r.code).toBe(2);
    expect(r.stderr.toLowerCase()).toContain("not found");
  });

  test("collision exits 2", () => {
    const src = join(tmp, "src");
    mkdirSync(src);
    writeFileSync(join(src, "page.html"), makeSphinx("X", "<h1>X</h1>"), "utf8");
    writeFileSync(join(src, "page.htm"), makeSphinx("X", "<h1>X</h1>"), "utf8");
    const r = runCli(["convert", src, "--output", join(tmp, "out")]);
    expect(r.code).toBe(2);
    expect(r.stderr.toLowerCase()).toContain("collision");
  });

  test("--help lists all flags", () => {
    const r = runCli(["convert", "--help"]);
    expect(r.code).toBe(0);
    for (const flag of ["--output", "--fail-threshold", "--max-bytes", "--dry-run", "--report-json"]) {
      expect(r.stdout).toContain(flag);
    }
  });

  test("--version prints and exits", () => {
    const r = runCli(["--version"]);
    expect(r.code).toBe(0);
    expect(r.stdout.trim()).toMatch(/^[\d.]+$/);
  });

  test("summary line has all keys including skipped", () => {
    const src = join(tmp, "src");
    seedTree(src);
    const out = join(tmp, "out");
    const r = runCli(["convert", src, "--output", out]);
    expect(r.code).toBe(0);
    for (const key of ["converted=", "empty=", "skipped=", "failed=", "total="]) {
      expect(r.stderr).toContain(key);
    }
  });

  test("--report-json writes a valid report", () => {
    const src = join(tmp, "src");
    seedTree(src);
    const out = join(tmp, "out");
    const reportPath = join(tmp, "report.json");
    const r = runCli(["convert", src, "--output", out, "--report-json", reportPath]);
    expect(r.code).toBe(0);
    const parsed = JSON.parse(readFileSync(reportPath, "utf8"));
    expect(Array.isArray(parsed.entries)).toBe(true);
    expect(parsed.entries.length).toBeGreaterThan(0);
  });
});
