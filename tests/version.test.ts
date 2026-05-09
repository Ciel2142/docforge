import { describe, expect, test } from "vitest";
import { readFileSync } from "node:fs";
import { VERSION } from "../src/index.js";

describe("version", () => {
  test("exports a non-empty string", () => {
    expect(typeof VERSION).toBe("string");
    expect(VERSION.length).toBeGreaterThan(0);
  });

  test("matches package.json version", () => {
    const pkg = JSON.parse(readFileSync("package.json", "utf8")) as { version: string };
    expect(VERSION).toBe(pkg.version);
  });
});
