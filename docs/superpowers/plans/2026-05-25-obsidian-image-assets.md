# Obsidian Image Assets Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Add `--save-images` so `docforge convert --format obsidian` copies referenced raster images into the vault and rewrites each ref to an Obsidian `![[ ]]` embed, instead of leaving a broken link.

**Architecture:** New `src/assets/` module mirroring `src/vlm/`: a pure ref-rewriter (`core.ts`), a content-hash file store (`store.ts`), and an IO shell (`index.ts`) that resolves image bytes from `data:` / `file:` / `http(s)` / the `docforge.invalid` sentinel. `runPipeline` runs this pass after the VLM pass in both body-producing branches when `format==="obsidian" && saveImages`. The CLI gains a `--save-images` flag.

**Tech Stack:** TypeScript (ESM, NodeNext), vitest 2, commander, kreuzberg/defuddle (existing), node:crypto/fs/url.

**Spec:** `docs/superpowers/specs/2026-05-25-obsidian-image-assets-design.md`
**Issue:** docf-85k

---

## File Structure

- `src/assets/types.ts` (new) — `AssetStats`, `RewriteDeps` interfaces.
- `src/assets/store.ts` (new) — `AssetStore` class: content-hash → `_assets/<sha16>.<ext>`, in-run dedup.
- `src/assets/core.ts` (new) — `rewriteImageRefs(md, deps)`: pure, replaces savable refs with `![[file]]`.
- `src/assets/index.ts` (new) — `runAssetPass(md, docOrigin, opts, store)`: wires the byte resolver.
- `src/vlm/select.ts` (modify) — add `isSavable(src)` (raster ext/data, **no** decorative-name skip).
- `src/vlm/index.ts` (modify) — `export` the existing `decodeDataUri`.
- `src/runPipeline.ts` (modify) — construct `AssetStore`, run pass in both branches, compute `sourceRoot`, surface `assets` stats.
- `src/cli.ts` (modify) — `--save-images` flag, warn-without-obsidian, stats log line.
- Tests: `tests/assets-savable.test.ts`, `tests/assets-store.test.ts`, `tests/assets-core.test.ts`, `tests/assets-pass.test.ts`, `tests/pipeline-save-images.test.ts`, `tests/cli-save-images.test.ts`.

**Shared test constant** (1×1 transparent PNG), used in several test files:
```ts
const PNG_1x1 = Buffer.from(
  "iVBORw0KGgoAAAANSUhEUgAAAAEAAAABCAQAAAC1HAwCAAAAC0lEQVR42mP8z8BQDwAEhQGAhKmMIQAAAABJRU5ErkJggg==",
  "base64",
);
```

---

## Task 1: `isSavable` predicate

Distinct from `isDescribable`: saving must keep decorative images (logos, icons) too, so it omits the `NAME_SKIP` filter.

**Files:**
- Modify: `src/vlm/select.ts`
- Test: `tests/assets-savable.test.ts`

- [ ] **Step 1: Write the failing test**

Create `tests/assets-savable.test.ts`:
```ts
import { describe, expect, test } from "vitest";
import { isSavable } from "../src/vlm/select.js";

describe("isSavable", () => {
  test("accepts raster extensions including decorative names (unlike isDescribable)", () => {
    for (const s of ["a.png", "a.jpg", "a.jpeg", "a.webp", "a.gif", "a.bmp", "logo.png", "icon.gif", "a.PNG?x=1"]) {
      expect(isSavable(s)).toBe(true);
    }
  });
  test("accepts raster data URIs", () => {
    expect(isSavable("data:image/png;base64,AAAA")).toBe(true);
  });
  test("rejects svg, svg data URIs, and extensionless/unknown", () => {
    expect(isSavable("a.svg")).toBe(false);
    expect(isSavable("data:image/svg+xml,<svg/>")).toBe(false);
    expect(isSavable("/image?id=5")).toBe(false);
  });
});
```

- [ ] **Step 2: Run test to verify it fails**

Run: `npx vitest run tests/assets-savable.test.ts`
Expected: FAIL — `isSavable` is not exported from `../src/vlm/select.js`.

- [ ] **Step 3: Add `isSavable` to `src/vlm/select.ts`**

Append after the existing `isDescribable` function:
```ts
/** True when an image src is a raster we can save as a sidecar asset. Unlike
 *  isDescribable, this does NOT skip decorative names (logo/icon/…): a vault
 *  should keep those images too. */
export function isSavable(src: string): boolean {
  if (src.startsWith("data:")) return RASTER_DATA.test(src);
  return RASTER_EXT.test(src);
}
```

- [ ] **Step 4: Run test to verify it passes**

Run: `npx vitest run tests/assets-savable.test.ts`
Expected: PASS (3 tests).

- [ ] **Step 5: Commit**

```bash
git add src/vlm/select.ts tests/assets-savable.test.ts
git commit -m "feat(assets): isSavable raster predicate without decorative-name skip (docf-85k)"
```

---

## Task 2: `AssetStore`

**Files:**
- Create: `src/assets/store.ts`
- Test: `tests/assets-store.test.ts`

- [ ] **Step 1: Write the failing test**

Create `tests/assets-store.test.ts`:
```ts
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
```

- [ ] **Step 2: Run test to verify it fails**

Run: `npx vitest run tests/assets-store.test.ts`
Expected: FAIL — cannot find module `../src/assets/store.js`.

- [ ] **Step 3: Create `src/assets/store.ts`**

```ts
import { createHash } from "node:crypto";
import { existsSync, mkdirSync, writeFileSync } from "node:fs";
import { dirname, join } from "node:path";

/**
 * Content-addressed sidecar image store, one instance per pipeline run.
 * Filenames are `<sha256[:16]>.<ext>`, so identical bytes collapse to one file
 * and the name is unique enough for an Obsidian bare-filename embed.
 */
export class AssetStore {
  private readonly seen = new Set<string>();
  constructor(private readonly outputDir: string) {}

  save(bytes: Buffer, ext: string): { filename: string; deduped: boolean } {
    const hash = createHash("sha256").update(bytes).digest("hex").slice(0, 16);
    const filename = `${hash}.${ext}`;
    if (this.seen.has(filename)) return { filename, deduped: true };
    this.seen.add(filename);
    const dest = join(this.outputDir, "_assets", filename);
    mkdirSync(dirname(dest), { recursive: true });
    if (!existsSync(dest)) writeFileSync(dest, bytes);
    return { filename, deduped: false };
  }
}
```

- [ ] **Step 4: Run test to verify it passes**

Run: `npx vitest run tests/assets-store.test.ts`
Expected: PASS (2 tests).

- [ ] **Step 5: Commit**

```bash
git add src/assets/store.ts tests/assets-store.test.ts
git commit -m "feat(assets): content-hash AssetStore writing _assets/<sha16>.<ext> (docf-85k)"
```

---

## Task 3: `rewriteImageRefs` core + types

**Files:**
- Create: `src/assets/types.ts`
- Create: `src/assets/core.ts`
- Test: `tests/assets-core.test.ts`

- [ ] **Step 1: Write the failing test**

Create `tests/assets-core.test.ts`:
```ts
import { describe, expect, test } from "vitest";
import { rewriteImageRefs } from "../src/assets/core.js";
import type { RewriteDeps } from "../src/assets/types.js";

function deps(overrides: Partial<RewriteDeps> = {}): RewriteDeps {
  return {
    resolve: async (src) => ({ bytes: Buffer.from(src), ext: "png" }),
    store: (bytes) => ({ filename: `${bytes.toString()}.png`, deduped: false }),
    ...overrides,
  };
}

describe("rewriteImageRefs", () => {
  test("rewrites a raster ref to an Obsidian embed", async () => {
    const { md, stats } = await rewriteImageRefs("a ![x](pic.png) b", {
      resolve: async () => ({ bytes: Buffer.from("B"), ext: "png" }),
      store: () => ({ filename: "deadbeef.png", deduped: false }),
    });
    expect(md).toBe("a ![[deadbeef.png]] b");
    expect(stats).toEqual({ saved: 1, deduped: 0, skipped: 0, failed: 0 });
  });

  test("skips non-raster refs and leaves them intact", async () => {
    const { md, stats } = await rewriteImageRefs("![v](movie.svg)", deps());
    expect(md).toBe("![v](movie.svg)");
    expect(stats.skipped).toBe(1);
    expect(stats.saved).toBe(0);
  });

  test("ignores refs inside fenced code blocks", async () => {
    const { md, stats } = await rewriteImageRefs("```\n![x](in.png)\n```", deps());
    expect(md).toContain("![x](in.png)");
    expect(stats.saved).toBe(0);
    expect(stats.skipped).toBe(0);
  });

  test("counts dedup separately from saved", async () => {
    let n = 0;
    const { stats } = await rewriteImageRefs("![a](1.png) ![b](2.png)", {
      resolve: async () => ({ bytes: Buffer.from("X"), ext: "png" }),
      store: () => ({ filename: "x.png", deduped: n++ > 0 }),
    });
    expect(stats.saved).toBe(1);
    expect(stats.deduped).toBe(1);
  });

  test("resolve failure leaves the ref and counts failed", async () => {
    const { md, stats } = await rewriteImageRefs("![a](broken.png)", {
      resolve: async () => { throw new Error("nope"); },
      store: () => ({ filename: "n.png", deduped: false }),
    });
    expect(md).toBe("![a](broken.png)");
    expect(stats.failed).toBe(1);
  });

  test("applies multiple edits without corrupting offsets", async () => {
    const { md } = await rewriteImageRefs("![a](1.png) and ![b](2.png)", {
      resolve: async (src) => ({ bytes: Buffer.from(src), ext: "png" }),
      store: (bytes) => ({ filename: bytes.toString().includes("1") ? "one.png" : "two.png", deduped: false }),
    });
    expect(md).toBe("![[one.png]] and ![[two.png]]");
  });
});
```

- [ ] **Step 2: Run test to verify it fails**

Run: `npx vitest run tests/assets-core.test.ts`
Expected: FAIL — cannot find `../src/assets/core.js` / `../src/assets/types.js`.

- [ ] **Step 3: Create `src/assets/types.ts`**

```ts
export interface AssetStats {
  saved: number;
  deduped: number;
  skipped: number;
  failed: number;
}

export interface RewriteDeps {
  /** Resolve image bytes + canonical extension for a ref's src. Throws on failure. */
  resolve(src: string): Promise<{ bytes: Buffer; ext: string }>;
  /** Persist bytes; return the bare filename to embed + whether it was a dedup. */
  store(bytes: Buffer, ext: string): { filename: string; deduped: boolean };
}
```

- [ ] **Step 4: Create `src/assets/core.ts`**

```ts
import { findImageRefs, isSavable } from "../vlm/select.js";
import type { AssetStats, RewriteDeps } from "./types.js";

interface Edit {
  index: number;
  length: number;
  insert: string;
}

/**
 * Replace each savable raster image ref in `md` with an Obsidian embed
 * `![[<filename>]]`, persisting bytes through `deps`. Pure given its deps.
 * Non-raster refs are skipped (left intact); resolve failures leave the ref
 * intact and count as failed.
 */
export async function rewriteImageRefs(
  md: string,
  deps: RewriteDeps,
): Promise<{ md: string; stats: AssetStats }> {
  const stats: AssetStats = { saved: 0, deduped: 0, skipped: 0, failed: 0 };
  const edits: Edit[] = [];

  for (const ref of findImageRefs(md)) {
    if (!isSavable(ref.src)) {
      stats.skipped++;
      continue;
    }
    try {
      const { bytes, ext } = await deps.resolve(ref.src);
      const { filename, deduped } = deps.store(bytes, ext);
      if (deduped) stats.deduped++;
      else stats.saved++;
      edits.push({ index: ref.index, length: ref.match.length, insert: `![[${filename}]]` });
    } catch {
      stats.failed++;
    }
  }

  // Apply edits from the end so earlier indices stay valid.
  edits.sort((a, b) => b.index - a.index);
  let out = md;
  for (const e of edits) {
    out = out.slice(0, e.index) + e.insert + out.slice(e.index + e.length);
  }
  return { md: out, stats };
}
```

- [ ] **Step 5: Run test to verify it passes**

Run: `npx vitest run tests/assets-core.test.ts`
Expected: PASS (6 tests).

- [ ] **Step 6: Commit**

```bash
git add src/assets/types.ts src/assets/core.ts tests/assets-core.test.ts
git commit -m "feat(assets): rewriteImageRefs pure ref→embed rewriter (docf-85k)"
```

---

## Task 4: Export `decodeDataUri` from the VLM module

The asset resolver reuses the existing data-URI decoder. It is currently a private function in `src/vlm/index.ts`.

**Files:**
- Modify: `src/vlm/index.ts`

- [ ] **Step 1: Add `export` to `decodeDataUri`**

In `src/vlm/index.ts`, change the function declaration:
```ts
function decodeDataUri(src: string): FetchedImage {
```
to:
```ts
export function decodeDataUri(src: string): FetchedImage {
```

- [ ] **Step 2: Verify it still builds**

Run: `npm run typecheck`
Expected: no errors.

- [ ] **Step 3: Commit**

```bash
git add src/vlm/index.ts
git commit -m "refactor(vlm): export decodeDataUri for reuse by the asset pass (docf-85k)"
```

---

## Task 5: `runAssetPass` resolver (IO shell)

**Files:**
- Create: `src/assets/index.ts`
- Test: `tests/assets-pass.test.ts`

- [ ] **Step 1: Write the failing test**

Create `tests/assets-pass.test.ts`:
```ts
import { afterEach, beforeEach, describe, expect, test } from "vitest";
import { createServer, type Server } from "node:http";
import { AddressInfo } from "node:net";
import { mkdirSync, mkdtempSync, readdirSync, rmSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { pathToFileURL } from "node:url";
import { runAssetPass } from "../src/assets/index.js";
import { AssetStore } from "../src/assets/store.js";
import type { FetchOptions } from "../src/http/fetch.js";

const PNG_1x1 = Buffer.from(
  "iVBORw0KGgoAAAANSUhEUgAAAAEAAAABCAQAAAC1HAwCAAAAC0lEQVR42mP8z8BQDwAEhQGAhKmMIQAAAABJRU5ErkJggg==",
  "base64",
);

let tmp: string;
let server: Server;
let base: string;

beforeEach(async () => {
  tmp = mkdtempSync(join(tmpdir(), "docforge-assetpass-"));
  server = createServer((req, res) => {
    const p = (req.url ?? "").split("?")[0];
    if (p === "/img.png") { res.writeHead(200, { "content-type": "image/png" }); res.end(PNG_1x1); return; }
    if (p === "/notimg.png") { res.writeHead(200, { "content-type": "text/html" }); res.end("<html/>"); return; }
    res.writeHead(404).end();
  });
  await new Promise<void>((r) => server.listen(0, "127.0.0.1", r));
  base = `http://127.0.0.1:${(server.address() as AddressInfo).port}`;
});
afterEach(async () => {
  await new Promise<void>((r) => server.close(() => r()));
  rmSync(tmp, { recursive: true, force: true });
});

function fetchOpts(): FetchOptions {
  return { userAgent: "docforge-test/0", timeoutMs: 5000, maxBytes: 10_000_000, cacheDir: null };
}

describe("runAssetPass resolver", () => {
  test("data: URI → saved + embed", async () => {
    const store = new AssetStore(tmp);
    const uri = `data:image/png;base64,${PNG_1x1.toString("base64")}`;
    const { md, stats } = await runAssetPass(`![d](${uri})`, `${base}/page`, { fetchOpts: fetchOpts() }, store);
    expect(stats.saved).toBe(1);
    expect(md).toMatch(/!\[\[[0-9a-f]{16}\.png\]\]/);
  });

  test("http image → fetched + saved", async () => {
    const store = new AssetStore(tmp);
    const { stats } = await runAssetPass("![a](/img.png)", `${base}/page`, { fetchOpts: fetchOpts() }, store);
    expect(stats.saved).toBe(1);
    expect(readdirSync(join(tmp, "_assets"))).toHaveLength(1);
  });

  test("http non-image response → failed, ref kept", async () => {
    const store = new AssetStore(tmp);
    const { md, stats } = await runAssetPass("![a](/notimg.png)", `${base}/page`, { fetchOpts: fetchOpts() }, store);
    expect(stats.failed).toBe(1);
    expect(md).toBe("![a](/notimg.png)");
  });

  test("file:// origin → reads a relative image from disk", async () => {
    mkdirSync(join(tmp, "sub"), { recursive: true });
    writeFileSync(join(tmp, "sub", "logo.png"), PNG_1x1);
    const docUrl = pathToFileURL(join(tmp, "sub", "page.html")).toString();
    const store = new AssetStore(tmp);
    const { md, stats } = await runAssetPass("![L](logo.png)", docUrl, {}, store);
    expect(stats.saved).toBe(1);
    expect(md).toMatch(/!\[\[[0-9a-f]{16}\.png\]\]/);
  });

  test("docforge.invalid sentinel → resolved against sourceRoot", async () => {
    mkdirSync(join(tmp, "img"), { recursive: true });
    writeFileSync(join(tmp, "img", "x.png"), PNG_1x1);
    const store = new AssetStore(tmp);
    const { stats } = await runAssetPass(
      "![s](http://docforge.invalid/img/x.png)",
      "http://docforge.invalid/page.html",
      { sourceRoot: tmp },
      store,
    );
    expect(stats.saved).toBe(1);
  });
});
```

- [ ] **Step 2: Run test to verify it fails**

Run: `npx vitest run tests/assets-pass.test.ts`
Expected: FAIL — cannot find `../src/assets/index.js`.

- [ ] **Step 3: Create `src/assets/index.ts`**

```ts
import { readFileSync } from "node:fs";
import { extname, join } from "node:path";
import { fileURLToPath } from "node:url";
import { fetchUrl, type FetchOptions } from "../http/fetch.js";
import { decodeDataUri } from "../vlm/index.js";
import { rewriteImageRefs } from "./core.js";
import type { AssetStore } from "./store.js";
import type { AssetStats } from "./types.js";

const SENTINEL_HOST = "docforge.invalid";
const MIME_EXT: Record<string, string> = {
  "image/png": "png",
  "image/jpeg": "jpg",
  "image/webp": "webp",
  "image/gif": "gif",
  "image/bmp": "bmp",
};

export interface AssetPassOptions {
  /** Needed for http(s) image sources. Absent for local-only runs. */
  fetchOpts?: FetchOptions;
  /** Local source root, used only to reverse the docforge.invalid sentinel. */
  sourceRoot?: string;
}

/** Extension from a path/URL pathname, query/hash stripped, lowercased, jpeg→jpg. */
function extFromPath(p: string): string {
  const clean = p.split(/[?#]/)[0] ?? p;
  const e = extname(clean).replace(/^\./, "").toLowerCase();
  return e === "jpeg" ? "jpg" : e;
}

/**
 * Rewrite savable image refs in `md` to Obsidian embeds, persisting bytes via
 * `store`. Resolves each ref's src against `docOrigin` and dispatches on scheme:
 * data: decode, file: read, http(s) fetch, docforge.invalid sentinel → on-disk
 * read under `sourceRoot`.
 */
export async function runAssetPass(
  md: string,
  docOrigin: string,
  opts: AssetPassOptions,
  store: AssetStore,
): Promise<{ md: string; stats: AssetStats }> {
  return rewriteImageRefs(md, {
    store: (bytes, ext) => store.save(bytes, ext),
    resolve: async (src) => {
      if (src.startsWith("data:")) {
        const img = decodeDataUri(src);
        const ext = MIME_EXT[img.mime];
        if (!ext) throw new Error(`unsupported data URI mime: ${img.mime}`);
        return { bytes: img.bytes, ext };
      }
      const u = new URL(src, docOrigin);

      if (u.protocol === "file:") {
        const path = fileURLToPath(u);
        return { bytes: readFileSync(path), ext: extFromPath(path) };
      }

      const isHttp = u.protocol === "http:" || u.protocol === "https:";
      if (isHttp && u.hostname === SENTINEL_HOST) {
        if (!opts.sourceRoot) throw new Error("sentinel image src without sourceRoot");
        const rel = decodeURIComponent(u.pathname).replace(/^\/+/, "");
        const path = join(opts.sourceRoot, rel);
        return { bytes: readFileSync(path), ext: extFromPath(path) };
      }

      if (isHttp) {
        if (!opts.fetchOpts) throw new Error("http image src without fetch options");
        const r = await fetchUrl(u.toString(), opts.fetchOpts);
        const mime = (r.contentType.split(";")[0] ?? "").trim();
        if (!mime.startsWith("image/")) throw new Error(`not an image (${r.contentType})`);
        const ext = MIME_EXT[mime] ?? extFromPath(u.pathname);
        if (!ext) throw new Error(`unknown image type: ${mime}`);
        return { bytes: r.bytes, ext };
      }

      throw new Error(`unsupported image scheme: ${u.protocol}`);
    },
  });
}
```

- [ ] **Step 4: Run test to verify it passes**

Run: `npx vitest run tests/assets-pass.test.ts`
Expected: PASS (5 tests).

- [ ] **Step 5: Commit**

```bash
git add src/assets/index.ts tests/assets-pass.test.ts
git commit -m "feat(assets): runAssetPass byte resolver (data/file/http/sentinel) (docf-85k)"
```

---

## Task 6: Wire the asset pass into `runPipeline`

**Files:**
- Modify: `src/runPipeline.ts`
- Test: `tests/pipeline-save-images.test.ts`

- [ ] **Step 1: Write the failing integration test**

Create `tests/pipeline-save-images.test.ts`:
```ts
import { afterEach, beforeEach, describe, expect, test } from "vitest";
import { createServer, type Server } from "node:http";
import { AddressInfo } from "node:net";
import { existsSync, mkdirSync, mkdtempSync, readFileSync, rmSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { createHash } from "node:crypto";
import { runPipeline } from "../src/runPipeline.js";
import { __clearRobotsCache } from "../src/http/robots.js";

const PNG_1x1 = Buffer.from(
  "iVBORw0KGgoAAAANSUhEUgAAAAEAAAABCAQAAAC1HAwCAAAAC0lEQVR42mP8z8BQDwAEhQGAhKmMIQAAAABJRU5ErkJggg==",
  "base64",
);
const HASH = createHash("sha256").update(PNG_1x1).digest("hex").slice(0, 16);
const PAD = "word ".repeat(40);
const PAGE = `<!DOCTYPE html><html><head><title>About UI</title></head><body>
<main><h1>About UI</h1><p>${PAD}</p>
<p><img src="img/logo.png" alt="Logo"></p>
<p>${PAD}</p></main></body></html>`;

let tmp: string;
beforeEach(() => { __clearRobotsCache(); tmp = mkdtempSync(join(tmpdir(), "docforge-saveimg-")); });
afterEach(() => { rmSync(tmp, { recursive: true, force: true }); });

function writeCorpus() {
  const inDir = join(tmp, "in");
  const outDir = join(tmp, "out");
  mkdirSync(join(inDir, "user-interface", "img"), { recursive: true });
  writeFileSync(join(inDir, "user-interface", "about.html"), PAGE);
  writeFileSync(join(inDir, "user-interface", "img", "logo.png"), PNG_1x1);
  return { inDir, outDir };
}

describe("runPipeline --save-images (obsidian, local source)", () => {
  test("copies the PNG into _assets and rewrites the ref to an embed", async () => {
    const { inDir, outDir } = writeCorpus();
    const res = await runPipeline({
      source: inDir, outputDir: outDir, maxBytes: 10485760, dryRun: false,
      format: "obsidian", saveImages: true,
    });
    expect(existsSync(join(outDir, "_assets", `${HASH}.png`))).toBe(true);
    const out = readFileSync(join(outDir, "user-interface", "about.md"), "utf8");
    expect(out).toContain(`![[${HASH}.png]]`);
    expect(res.assets?.saved).toBe(1);
  });

  test("no _assets and no stats when saveImages is off", async () => {
    const { inDir, outDir } = writeCorpus();
    const res = await runPipeline({
      source: inDir, outputDir: outDir, maxBytes: 10485760, dryRun: false, format: "obsidian",
    });
    expect(existsSync(join(outDir, "_assets"))).toBe(false);
    expect(res.assets).toBeUndefined();
  });

  test("default format ignores saveImages", async () => {
    const { inDir, outDir } = writeCorpus();
    const res = await runPipeline({
      source: inDir, outputDir: outDir, maxBytes: 10485760, dryRun: false, saveImages: true,
    });
    expect(existsSync(join(outDir, "_assets"))).toBe(false);
    expect(res.assets).toBeUndefined();
  });
});

describe("runPipeline --save-images (obsidian, URL source)", () => {
  let server: Server;
  let base: string;
  const URL_PAGE = `<!DOCTYPE html><html><head><title>Arch</title></head><body>
<main><h1>Arch</h1><p>${PAD}</p><p><img src="/img.png" alt="Arch"></p><p>${PAD}</p></main></body></html>`;

  beforeEach(async () => {
    server = createServer((req, res) => {
      const p = (req.url ?? "").split("?")[0];
      if (p === "/robots.txt") { res.writeHead(200, { "content-type": "text/plain" }); res.end(""); return; }
      if (p === "/") { res.writeHead(200, { "content-type": "text/html; charset=utf-8" }); res.end(URL_PAGE); return; }
      if (p === "/img.png") { res.writeHead(200, { "content-type": "image/png" }); res.end(PNG_1x1); return; }
      res.writeHead(404).end();
    });
    await new Promise<void>((r) => server.listen(0, "127.0.0.1", r));
    base = `http://127.0.0.1:${(server.address() as AddressInfo).port}`;
  });
  afterEach(async () => { await new Promise<void>((r) => server.close(() => r())); });

  test("fetches the image, writes _assets, and embeds it", async () => {
    const outDir = join(tmp, "out");
    const res = await runPipeline({
      source: `${base}/`,
      outputDir: outDir,
      maxBytes: 10485760,
      dryRun: false,
      format: "obsidian",
      saveImages: true,
      fetchOptions: { userAgent: "docforge-test/0", timeoutMs: 5000, maxBytes: 10_000_000, cacheDir: null },
      crawlOptions: { maxPages: 1, maxDepth: 1, concurrency: 1, userAgent: "docforge-test/0", llmsFullMode: "off" },
    });
    expect(res.assets?.saved).toBe(1);
    expect(existsSync(join(outDir, "_assets", `${HASH}.png`))).toBe(true);
    const out = readFileSync(join(outDir, "index.md"), "utf8");
    expect(out).toContain(`![[${HASH}.png]]`);
  });
});
```

- [ ] **Step 2: Run test to verify it fails**

Run: `npx vitest run tests/pipeline-save-images.test.ts`
Expected: FAIL — `saveImages` not on `RunPipelineOptions` (type error) and `res.assets` undefined / `_assets` not written.

- [ ] **Step 3: Add imports and option/result types in `src/runPipeline.ts`**

Add `dirname` to the `node:path` import (line 2):
```ts
import { basename, dirname, extname, relative, resolve, sep } from "node:path";
```

Add module imports near the other `./vlm/*` imports (after line 21):
```ts
import { AssetStore } from "./assets/store.js";
import { runAssetPass } from "./assets/index.js";
import type { AssetStats } from "./assets/types.js";
```

Add `saveImages` to `RunPipelineOptions`:
```ts
  vlm?: VlmOptions;
  format?: "default" | "obsidian";
  saveImages?: boolean;
```

Add `assets` to `PipelineResult`:
```ts
  report: ReportEntry[];
  vlm?: DescribeStats;
  assets?: AssetStats;
```

- [ ] **Step 4: Compute `sourceRoot` and construct the store**

In the local-source `else` branch (currently around lines 82-90), capture the source root. Change:
```ts
  } else {
    const fsPath = resolve(opts.source);
    if (!existsSync(fsPath)) throw new Error(`source not found: ${fsPath}`);
    const st = lstatSync(fsPath);
    if (!st.isFile() && !st.isDirectory()) {
      throw new Error(`source is neither file nor directory: ${fsPath}`);
    }
    source = new FilesystemSource(fsPath, opts.maxBytes);
  }
```
to:
```ts
  let sourceRoot: string | undefined;
  if (isUrl(opts.source)) {
    // ...unchanged URL branch above...
  } else {
    const fsPath = resolve(opts.source);
    if (!existsSync(fsPath)) throw new Error(`source not found: ${fsPath}`);
    const st = lstatSync(fsPath);
    if (!st.isFile() && !st.isDirectory()) {
      throw new Error(`source is neither file nor directory: ${fsPath}`);
    }
    sourceRoot = st.isFile() ? dirname(fsPath) : fsPath;
    source = new FilesystemSource(fsPath, opts.maxBytes);
  }
```
(Declare `let sourceRoot` just before the existing `let source: Source;`, and set it only in the `else` branch. The URL branch above it is unchanged.)

After the existing `const vlmStats` declaration (around line 96), add:
```ts
  const assetStore =
    format === "obsidian" && opts.saveImages ? new AssetStore(opts.outputDir) : undefined;
  const assetStats: AssetStats = { saved: 0, deduped: 0, skipped: 0, failed: 0 };
```

- [ ] **Step 5: Run the pass in the markdown-passthrough branch**

In the `item.kind === "llms-full" || item.kind === "markdown"` branch, right before `writeOutput(outPath, md);`, insert:
```ts
      if (assetStore && opts.fetchOptions) {
        const ap = await runAssetPass(md, item.srcUri, { fetchOpts: opts.fetchOptions }, assetStore);
        md = ap.md;
        assetStats.saved += ap.stats.saved;
        assetStats.deduped += ap.stats.deduped;
        assetStats.skipped += ap.stats.skipped;
        assetStats.failed += ap.stats.failed;
      }
```

- [ ] **Step 6: Run the pass in the HTML-convert branch**

After the VLM block (immediately before `const provenance = ...` near line 240), insert:
```ts
    if (assetStore) {
      const ap = await runAssetPass(
        bodyMd,
        item.srcUri,
        {
          ...(opts.fetchOptions ? { fetchOpts: opts.fetchOptions } : {}),
          ...(sourceRoot ? { sourceRoot } : {}),
        },
        assetStore,
      );
      bodyMd = ap.md;
      assetStats.saved += ap.stats.saved;
      assetStats.deduped += ap.stats.deduped;
      assetStats.skipped += ap.stats.skipped;
      assetStats.failed += ap.stats.failed;
    }
```

- [ ] **Step 7: Surface the stats in the return value**

Change the final `return { ... }` to include `assets` when the store ran:
```ts
  return {
    converted,
    empty,
    skipped: source.skippedCount,
    failed,
    report,
    ...(opts.vlm ? { vlm: vlmStats } : {}),
    ...(assetStore ? { assets: assetStats } : {}),
  };
```

- [ ] **Step 8: Run the integration test to verify it passes**

Run: `npx vitest run tests/pipeline-save-images.test.ts`
Expected: PASS (3 tests).

- [ ] **Step 9: Run the full suite + typecheck to catch regressions**

Run: `npm run typecheck && npx vitest run`
Expected: typecheck clean; all tests PASS (existing obsidian/vlm/pipeline tests unaffected).

- [ ] **Step 10: Commit**

```bash
git add src/runPipeline.ts tests/pipeline-save-images.test.ts
git commit -m "feat(pipeline): run asset pass for obsidian+saveImages, surface stats (docf-85k)"
```

---

## Task 7: CLI `--save-images` flag

**Files:**
- Modify: `src/cli.ts`
- Test: `tests/cli-save-images.test.ts`

- [ ] **Step 1: Write the failing test**

Create `tests/cli-save-images.test.ts`:
```ts
import { afterEach, beforeEach, describe, expect, test } from "vitest";
import { existsSync, mkdirSync, mkdtempSync, readdirSync, rmSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { runConvert } from "../src/cli.js";

const PNG_1x1 = Buffer.from(
  "iVBORw0KGgoAAAANSUhEUgAAAAEAAAABCAQAAAC1HAwCAAAAC0lEQVR42mP8z8BQDwAEhQGAhKmMIQAAAABJRU5ErkJggg==",
  "base64",
);
const PAGE = `<!DOCTYPE html><html><head><title>T</title></head><body><main><h1>T</h1>` +
  `<p>${"word ".repeat(40)}</p><p><img src="logo.png" alt="L"></p><p>${"word ".repeat(20)}</p></main></body></html>`;

let tmp: string;
beforeEach(() => { tmp = mkdtempSync(join(tmpdir(), "docforge-cli-saveimg-")); });
afterEach(() => { rmSync(tmp, { recursive: true, force: true }); });

function baseOpts(output: string) {
  return {
    output, failThreshold: "0.10", maxBytes: "10485760", dryRun: false,
    maxPages: "1", maxDepth: "1", concurrency: "1",
    cacheDir: join(tmp, ".cache"), cache: false, userAgent: "docforge-test/0", llmsFull: "auto",
  };
}

describe("convert --save-images", () => {
  test("saves assets for a local obsidian run", async () => {
    const inDir = join(tmp, "in");
    const outDir = join(tmp, "out");
    mkdirSync(inDir, { recursive: true });
    writeFileSync(join(inDir, "page.html"), PAGE);
    writeFileSync(join(inDir, "logo.png"), PNG_1x1);
    const code = await runConvert(inDir, { ...baseOpts(outDir), format: "obsidian", saveImages: true });
    expect(code).toBe(0);
    expect(existsSync(join(outDir, "_assets"))).toBe(true);
    expect(readdirSync(join(outDir, "_assets")).length).toBe(1);
  });

  test("warns and saves nothing without --format obsidian", async () => {
    const inDir = join(tmp, "in");
    const outDir = join(tmp, "out");
    mkdirSync(inDir, { recursive: true });
    writeFileSync(join(inDir, "page.html"), PAGE);
    writeFileSync(join(inDir, "logo.png"), PNG_1x1);
    const code = await runConvert(inDir, { ...baseOpts(outDir), saveImages: true });
    expect(code).toBe(0);
    expect(existsSync(join(outDir, "_assets"))).toBe(false);
  });
});
```

- [ ] **Step 2: Run test to verify it fails**

Run: `npx vitest run tests/cli-save-images.test.ts`
Expected: FAIL — `saveImages` is not a known property of the `runConvert` opts type / no `_assets` written.

- [ ] **Step 3: Register the CLI option**

In `src/cli.ts`, add after the `--format` option (line 45):
```ts
    .option("--save-images", "save referenced raster images beside the vault (--format obsidian only)", false)
```

- [ ] **Step 4: Add `saveImages` to the `ConvertOpts` interface**

```ts
  format?: string | undefined;
  saveImages?: boolean | undefined;
```

- [ ] **Step 5: Wire it into `runConvert`**

After the block that sets `pipelineOpts.format = format as ...;` (line 118), add:
```ts
  if (opts.saveImages) {
    if (format === "obsidian") pipelineOpts.saveImages = true;
    else log("warn", "--save-images ignored unless --format obsidian");
  }
```

- [ ] **Step 6: Log the asset stats**

After the `if (result.vlm) { ... }` block (line 202), add:
```ts
  if (result.assets) {
    log(
      "info",
      `images: saved=${result.assets.saved} deduped=${result.assets.deduped} skipped=${result.assets.skipped} failed=${result.assets.failed}`,
    );
  }
```

- [ ] **Step 7: Run test to verify it passes**

Run: `npx vitest run tests/cli-save-images.test.ts`
Expected: PASS (2 tests).

- [ ] **Step 8: Commit**

```bash
git add src/cli.ts tests/cli-save-images.test.ts
git commit -m "feat(cli): --save-images flag for obsidian sidecar assets (docf-85k)"
```

---

## Task 8: Final verification + README note

**Files:**
- Modify: `README.md` (document the flag)

- [ ] **Step 1: Document the flag in `README.md`**

Find the `convert` options / obsidian section and add a line describing `--save-images`:
```
--save-images   With --format obsidian, copy referenced raster images
                (png/jpg/webp/gif/bmp) into <output>/_assets/ and rewrite refs to
                Obsidian ![[embed]] links. Default off. No effect without --format obsidian.
```
(Match the surrounding README style; if there is an options table, add a row instead.)

- [ ] **Step 2: Run the full suite + typecheck**

Run: `npm run typecheck && npm test`
Expected: typecheck clean; full vitest suite PASS.

- [ ] **Step 3: Commit**

```bash
git add README.md
git commit -m "docs(readme): document --save-images obsidian asset flag (docf-85k)"
```

- [ ] **Step 4: Close the issue and push**

```bash
bd close docf-85k --reason="--save-images obsidian sidecar assets implemented + tested"
git push -u origin feat/docf-85k-obsidian-image-assets
```

---

## Self-Review notes (for the implementer)

- **Defuddle image src form is verified at runtime, not assumed.** Local HTML may emit either a relative src (`img/logo.png`, resolved against the `file://` doc origin) or a sentinel-absolutized src (`http://docforge.invalid/...`, resolved against `sourceRoot`). The resolver handles both; the Task 6 integration test passes regardless of which Defuddle produces. If that test fails because the `<img>` was dropped entirely by Defuddle, treat it as a debugging task (inspect `bodyMd` before the asset pass) — do not weaken the assertion.
- **`fetchUrl` shape** (`{ bytes, contentType }`) matches the VLM usage in `src/vlm/index.ts`; the resolver mirrors its `image/` content-type guard.
- **Optional-property spreads** (`...(cond ? { x } : {})`) are used when passing `AssetPassOptions` to satisfy the project's strict optional types — match that pattern, don't pass `undefined` explicitly.
