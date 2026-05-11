import { describe, expect, test, beforeEach, afterEach } from "vitest";
import { mkdtempSync, rmSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { loadConfig } from "../../src/mcp/config.js";

let dir: string;
const ENV = process.env;

beforeEach(() => {
  dir = mkdtempSync(join(tmpdir(), "df-cfg-"));
  process.env = { ...ENV };
});
afterEach(() => {
  rmSync(dir, { recursive: true, force: true });
  process.env = ENV;
});

describe("loadConfig", () => {
  test("requires DOCFORGE_QMD_ROOT", () => {
    delete process.env.DOCFORGE_QMD_ROOT;
    expect(() => loadConfig()).toThrow(/DOCFORGE_QMD_ROOT/);
  });

  test("auto-creates qmd root when missing", () => {
    const target = join(dir, "subdir-that-does-not-exist");
    process.env.DOCFORGE_QMD_ROOT = target;
    const cfg = loadConfig();
    expect(cfg.qmdRoot).toBe(target);
  });

  test("applies env defaults", () => {
    process.env.DOCFORGE_QMD_ROOT = dir;
    process.env.DOCFORGE_MAX_PAGES = "1234";
    process.env.DOCFORGE_MAX_DEPTH = "7";
    process.env.DOCFORGE_CONCURRENCY = "9";
    process.env.DOCFORGE_USER_AGENT = "custom-agent/1.0";
    const cfg = loadConfig();
    expect(cfg.maxPages).toBe(1234);
    expect(cfg.maxDepth).toBe(7);
    expect(cfg.concurrency).toBe(9);
    expect(cfg.userAgent).toBe("custom-agent/1.0");
  });

  test("falls back to library defaults when env unset", () => {
    process.env.DOCFORGE_QMD_ROOT = dir;
    delete process.env.DOCFORGE_MAX_PAGES;
    const cfg = loadConfig();
    expect(cfg.maxPages).toBe(5000);
    expect(cfg.maxDepth).toBe(10);
    expect(cfg.concurrency).toBe(4);
  });

  test("rejects non-numeric env values", () => {
    process.env.DOCFORGE_QMD_ROOT = dir;
    process.env.DOCFORGE_MAX_PAGES = "not-a-number";
    expect(() => loadConfig()).toThrow(/DOCFORGE_MAX_PAGES/);
  });
});
