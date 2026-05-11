import { afterEach, beforeEach, describe, expect, test } from "vitest";
import { mkdtempSync, mkdirSync, rmSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { FilesystemSource } from "../src/source.js";

let tmp: string;
beforeEach(() => {
  tmp = mkdtempSync(join(tmpdir(), "docforge-source-"));
});
afterEach(() => {
  rmSync(tmp, { recursive: true, force: true });
});

describe("FilesystemSource", () => {
  test("yields items for each html file with file:// srcUri", async () => {
    mkdirSync(join(tmp, "guide"), { recursive: true });
    writeFileSync(join(tmp, "index.html"), "<html>i</html>");
    writeFileSync(join(tmp, "guide/foo.html"), "<html>f</html>");

    const source = new FilesystemSource(tmp, 10_000_000);
    const items = [];
    for await (const item of source.iter()) items.push(item);
    items.sort((a, b) => a.key.localeCompare(b.key));

    expect(items.map((i) => i.key)).toEqual(["guide/foo.html", "index.html"]);
    expect(items[0].srcUri.startsWith("file://")).toBe(true);
    expect(items[0].contentType).toBe("text/html");
    expect(items[1].bytes.toString("utf8")).toBe("<html>i</html>");
    expect(source.skippedCount).toBe(0);
  });

  test("single-file source yields one item keyed by basename", async () => {
    const file = join(tmp, "a.html");
    writeFileSync(file, "<html>a</html>");
    const source = new FilesystemSource(file, 10_000_000);
    const items = [];
    for await (const item of source.iter()) items.push(item);
    expect(items).toHaveLength(1);
    expect(items[0].key).toBe("a.html");
  });

  test("non-html files do not appear; skippedCount tracks them", async () => {
    writeFileSync(join(tmp, "a.html"), "<html>a</html>");
    writeFileSync(join(tmp, "b.css"), "body{}");
    const source = new FilesystemSource(tmp, 10_000_000);
    const items = [];
    for await (const item of source.iter()) items.push(item);
    expect(items).toHaveLength(1);
    expect(source.skippedCount).toBeGreaterThanOrEqual(1);
  });
});
