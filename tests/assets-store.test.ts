import { afterEach, beforeEach, describe, expect, test } from "vitest";
import { mkdtempSync, readdirSync, readFileSync, rmSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { createHash } from "node:crypto";
import { AssetStore } from "../src/assets/store.js";

let tmp: string;
beforeEach(() => { tmp = mkdtempSync(join(tmpdir(), "docforge-assetstore-")); });
afterEach(() => { rmSync(tmp, { recursive: true, force: true }); });

describe("AssetStore", () => {
  test("writes <hash>.<ext> under _assets and returns the bare filename", () => {
    const store = new AssetStore(tmp);
    const bytes = Buffer.from("hello-png-bytes");
    const { filename, deduped } = store.save(bytes, "png");
    const hash = createHash("sha256").update(bytes).digest("hex").slice(0, 16);
    expect(filename).toBe(`${hash}.png`);
    expect(deduped).toBe(false);
    expect(readFileSync(join(tmp, "_assets", filename))).toEqual(bytes);
  });

  test("dedups identical bytes: one file written, second save reports deduped", () => {
    const store = new AssetStore(tmp);
    const bytes = Buffer.from("same-content");
    const a = store.save(bytes, "png");
    const b = store.save(bytes, "png");
    expect(a.deduped).toBe(false);
    expect(b.deduped).toBe(true);
    expect(a.filename).toBe(b.filename);
    expect(readdirSync(join(tmp, "_assets"))).toHaveLength(1);
  });
});
