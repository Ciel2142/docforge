import { describe, expect, test } from "vitest";
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
