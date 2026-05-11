import { describe, expect, test, beforeEach, afterEach } from "vitest";
import { mkdtempSync, rmSync, mkdirSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { LockManager } from "../../src/mcp/locks.js";
import { McpError } from "../../src/mcp/errors.js";

let root: string;
beforeEach(() => {
  root = mkdtempSync(join(tmpdir(), "df-lock-"));
  mkdirSync(join(root, "c1"));
});
afterEach(() => {
  rmSync(root, { recursive: true, force: true });
});

describe("LockManager — in-memory", () => {
  test("two same-collection acquires throw BUSY in-process", async () => {
    const mgr = new LockManager();
    const release = await mgr.acquire(root, "c1");
    await expect(mgr.acquire(root, "c1"))
      .rejects.toMatchObject({ code: "BUSY" });
    await release();
  });

  test("different collections do not conflict", async () => {
    mkdirSync(join(root, "c2"));
    const mgr = new LockManager();
    const r1 = await mgr.acquire(root, "c1");
    const r2 = await mgr.acquire(root, "c2");
    await r1();
    await r2();
  });

  test("release frees the slot", async () => {
    const mgr = new LockManager();
    const r1 = await mgr.acquire(root, "c1");
    await r1();
    const r2 = await mgr.acquire(root, "c1");
    await r2();
  });
});

describe("LockManager — on-disk", () => {
  test("BUSY surfaces as McpError with hint", async () => {
    const mgr = new LockManager();
    const release = await mgr.acquire(root, "c1");
    try {
      await mgr.acquire(root, "c1");
      throw new Error("expected throw");
    } catch (e) {
      expect(e).toBeInstanceOf(McpError);
      expect((e as McpError).code).toBe("BUSY");
      expect((e as McpError).hint).toBeTruthy();
    }
    await release();
  });
});
