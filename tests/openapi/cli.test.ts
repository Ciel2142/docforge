import { afterEach, beforeEach, describe, expect, test } from "vitest";
import { spawnSync } from "node:child_process";
import { mkdtempSync, readdirSync, rmSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";

let tmp: string;
beforeEach(() => {
  tmp = mkdtempSync(join(tmpdir(), "docforge-oapi-"));
});
afterEach(() => {
  rmSync(tmp, { recursive: true, force: true });
});

function runCli(args: string[]): { code: number; stdout: string; stderr: string } {
  const r = spawnSync("node", ["dist/bin.js", ...args], { encoding: "utf8" });
  return {
    code: r.status ?? 2,
    stdout: r.stdout ?? "",
    stderr: r.stderr ?? "",
  };
}

describe("openapi e2e", () => {
  test("petstore-mini produces endpoints + schemas", () => {
    const out = join(tmp, "out");
    const r = runCli(["openapi", "tests/openapi/fixtures/petstore-mini.json", "--output", out]);
    expect(r.code).toBe(0);
    const eps = readdirSync(join(out, "endpoints"));
    const scs = readdirSync(join(out, "schemas"));
    expect(eps.length).toBeGreaterThan(0);
    expect(scs.length).toBeGreaterThan(0);
    expect(eps.every((f) => f.endsWith(".md"))).toBe(true);
    expect(scs.every((f) => f.endsWith(".md"))).toBe(true);
    expect(r.stderr).toMatch(/endpoints=\d+ schemas=\d+/);
  });

  test("missing spec exits 2", () => {
    const r = runCli(["openapi", join(tmp, "nope.json"), "--output", join(tmp, "out")]);
    expect(r.code).toBe(2);
  });

  test("swagger 2.0 spec exits 2", () => {
    const p = join(tmp, "swagger.json");
    writeFileSync(p, JSON.stringify({ swagger: "2.0", paths: {} }));
    const r = runCli(["openapi", p, "--output", join(tmp, "out")]);
    expect(r.code).toBe(2);
    expect(r.stderr.toLowerCase()).toContain("swagger");
  });
});
