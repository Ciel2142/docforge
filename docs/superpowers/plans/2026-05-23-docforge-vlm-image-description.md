# VLM Image Description Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Add an opt-in pass that, for crawled HTML (URL) sources, describes informative raster images with a local OpenAI-compatible VLM and injects a caption block after each image reference in the output Markdown.

**Architecture:** A new `src/vlm/` module runs as a post-Markdown enrichment pass invoked from `runPipeline` (after Kreuzberg, before `buildOutput`), gated on an opt-in flag and an HTTP(S) source. The core orchestrator (`describeImages`) takes injected dependencies (fetch, VLM call, image-size, cache) so it is fully unit-testable with stubs; a thin `runVlmPass` wires the real dependencies (reusing the existing `fetchUrl` client for image fetches, so cache + auth are inherited). Model failures are swallowed per-image — the document always converts. The deterministic base pipeline is untouched when the flag is off.

**Tech Stack:** TypeScript (ESM, NodeNext, strict + `exactOptionalPropertyTypes` + `noUncheckedIndexedAccess` + `verbatimModuleSyntax`), vitest, `got` (HTTP), `p-queue` (concurrency), `keyv` + `keyv-file` (disk cache), `image-size` (NEW dep — pixel dimensions from a Buffer).

**Spec:** `docs/superpowers/specs/2026-05-23-docforge-vlm-image-description-design.md`
**Beads:** docf-i17

---

## Conventions (read once, apply everywhere)

- **ESM imports use `.js` extensions** even for `.ts` files (NodeNext).
- **`verbatimModuleSyntax`**: import types with `import type { … }` or inline `type` modifier (`import { fetchUrl, type FetchOptions } from "…"`).
- **`exactOptionalPropertyTypes`**: never assign `undefined` to an optional property. Build objects conditionally: `{ ...(x ? { x } : {}) }`.
- **`noUncheckedIndexedAccess`**: `arr[i]` is `T | undefined` — guard with `?? fallback` or a check.
- **Tests** import explicitly from `vitest` (`globals: false`): `import { describe, expect, test } from "vitest";`.
- Run the **full suite** with `npm test` (it runs `tsc` via `pretest`, then `vitest run`). Run a single file with `npx vitest run tests/<file>.test.ts`.
- Commit after every task. Commit messages: `feat(vlm): …` / `feat(cli): …` / `feat(mcp): …` / `test(vlm): …`, with a trailing `(docf-i17)`.

---

## File Structure

**Create:**
- `src/vlm/types.ts` — shared types (`VlmOptions`, `ImageRef`, `DescribeStats`, `FetchedImage`, `VlmCache`, `DescribeDeps`).
- `src/vlm/select.ts` — find Markdown image refs (skipping fenced code), apply skip heuristics.
- `src/vlm/client.ts` — OpenAI-compatible VLM call + prompt + `PROMPT_VERSION`.
- `src/vlm/describe.ts` — `captionBlock` + `describeImages` orchestrator (injected deps).
- `src/vlm/index.ts` — `runVlmPass` (wires real deps: `fetchUrl`, `callVlm`, `image-size`, `keyv` cache).
- Tests: `tests/vlm-select.test.ts`, `tests/vlm-describe.test.ts`, `tests/vlm-client.test.ts`, `tests/vlm-pass.test.ts`, `tests/vlm-pipeline.test.ts`, `tests/cli-describe-images.test.ts`, `tests/mcp/convert-describe-images.test.ts`.

**Modify:**
- `src/runPipeline.ts` — add `vlm?` option, insert the pass, aggregate stats into `PipelineResult`.
- `src/cli.ts` — add `--describe-images` + `--vlm-*` flags, build `pipelineOpts.vlm`, log stats.
- `src/mcp/errors.ts` — add `"INVALID_ARGS"` to `ErrorCode`.
- `src/mcp/config.ts` — load VLM endpoint/model/key from env into `McpConfig.vlm`.
- `src/mcp/tools/convert.ts` — add `describe_images` + tuning args; build `pipelineOpts.vlm` from server config.
- `README.md` — document the feature + flags + prerequisite.
- `package.json` — add `image-size` dependency (done via `npm install` in Task 5).

---

## Task 1: Image-ref discovery + selection (`src/vlm/select.ts` + `src/vlm/types.ts`)

**Files:**
- Create: `src/vlm/types.ts`
- Create: `src/vlm/select.ts`
- Test: `tests/vlm-select.test.ts`

- [ ] **Step 1: Create the types file**

Create `src/vlm/types.ts`:

```ts
export interface VlmOptions {
  /** OpenAI-compatible base URL, including the `/v1` segment. */
  baseUrl: string;
  model: string;
  apiKey?: string;
  /** Skip images whose longest side is below this many pixels. */
  minDim: number;
  /** Maximum number of images described per document. */
  maxImages: number;
  /** Parallel VLM calls. */
  concurrency: number;
  /** Per-call timeout in milliseconds. */
  timeoutMs: number;
}

export interface ImageRef {
  /** The full matched Markdown image, e.g. `![alt](src "title")`. */
  match: string;
  alt: string;
  /** First token inside the parentheses (title stripped). */
  src: string;
  /** Start offset of `match` within the source Markdown. */
  index: number;
}

export interface DescribeStats {
  described: number;
  skipped: number;
  failed: number;
  cached: number;
}

export interface FetchedImage {
  bytes: Buffer;
  /** MIME type without parameters, e.g. `image/png`. */
  mime: string;
}

export interface VlmCache {
  get(key: string): Promise<string | undefined>;
  set(key: string, value: string): Promise<void>;
}

export interface DescribeDeps {
  /** Fetch image bytes for an absolute URL or `data:` URI. Throws on failure. */
  fetchImage: (url: string) => Promise<FetchedImage>;
  /** Call the VLM. Returns a one-paragraph description. Throws on failure. */
  describe: (image: FetchedImage, context: string) => Promise<string>;
  /** Read pixel dimensions from image bytes. Returns `{}` if undetectable. */
  sizeOf: (bytes: Buffer) => { width?: number; height?: number };
  /** Optional persistent cache keyed by content hash. */
  cache?: VlmCache;
  /** Bumped when the prompt changes, to invalidate stale cache entries. */
  promptVersion: string;
}
```

- [ ] **Step 2: Write the failing test**

Create `tests/vlm-select.test.ts`:

```ts
import { describe, expect, test } from "vitest";
import { findImageRefs, isDescribable } from "../src/vlm/select.js";

describe("findImageRefs", () => {
  test("finds inline image with alt + src", () => {
    const refs = findImageRefs("intro\n\n![Arch overview](diagrams/arch.png)\n\nmore");
    expect(refs).toHaveLength(1);
    expect(refs[0]?.alt).toBe("Arch overview");
    expect(refs[0]?.src).toBe("diagrams/arch.png");
    expect(refs[0]?.match).toBe("![Arch overview](diagrams/arch.png)");
  });

  test("strips a title from the src token", () => {
    const refs = findImageRefs('![a](b.png "the title")');
    expect(refs[0]?.src).toBe("b.png");
  });

  test("ignores images inside fenced code blocks", () => {
    const md = "```\n![x](in-code.png)\n```\n\n![y](real.png)";
    const refs = findImageRefs(md);
    expect(refs).toHaveLength(1);
    expect(refs[0]?.src).toBe("real.png");
  });

  test("returns correct index for the match", () => {
    const md = "abc ![a](x.png)";
    expect(findImageRefs(md)[0]?.index).toBe(4);
  });
});

describe("isDescribable", () => {
  test("accepts raster extensions", () => {
    for (const s of ["a.png", "a.jpg", "a.jpeg", "a.webp", "a.gif", "a.bmp", "a.PNG?x=1"]) {
      expect(isDescribable(s)).toBe(true);
    }
  });
  test("accepts raster data URIs", () => {
    expect(isDescribable("data:image/png;base64,AAAA")).toBe(true);
  });
  test("rejects svg and unknown/extensionless", () => {
    expect(isDescribable("a.svg")).toBe(false);
    expect(isDescribable("data:image/svg+xml,<svg/>")).toBe(false);
    expect(isDescribable("/image?id=5")).toBe(false);
  });
  test("rejects decorative names even with a raster extension", () => {
    for (const s of ["logo.png", "site-icon.png", "avatar.jpg", "badge.svg", "spacer.gif", "x/emoji.png", "pixel.gif", "sprite.png"]) {
      expect(isDescribable(s)).toBe(false);
    }
  });
});
```

- [ ] **Step 3: Run the test to verify it fails**

Run: `npx vitest run tests/vlm-select.test.ts`
Expected: FAIL — `Cannot find module '../src/vlm/select.js'`.

- [ ] **Step 4: Implement `select.ts`**

Create `src/vlm/select.ts`:

```ts
import type { ImageRef } from "./types.js";

const NAME_SKIP = /(icon|logo|sprite|badge|avatar|emoji|spacer|pixel)/i;
const RASTER_EXT = /\.(png|jpe?g|webp|gif|bmp)(?:[?#]|$)/i;
const RASTER_DATA = /^data:image\/(png|jpe?g|webp|gif|bmp)/i;

/** Byte ranges (start inclusive, end exclusive) covered by ``` / ~~~ fences. */
function fenceRanges(md: string): Array<[number, number]> {
  const ranges: Array<[number, number]> = [];
  let offset = 0;
  let fenceStart = -1;
  for (const line of md.split("\n")) {
    if (/^\s*(```|~~~)/.test(line)) {
      if (fenceStart === -1) fenceStart = offset;
      else {
        ranges.push([fenceStart, offset + line.length]);
        fenceStart = -1;
      }
    }
    offset += line.length + 1; // +1 for the consumed "\n"
  }
  if (fenceStart !== -1) ranges.push([fenceStart, md.length]);
  return ranges;
}

function inAnyRange(i: number, ranges: Array<[number, number]>): boolean {
  return ranges.some(([s, e]) => i >= s && i < e);
}

/** Find inline Markdown image refs, ignoring those inside fenced code blocks. */
export function findImageRefs(md: string): ImageRef[] {
  const fences = fenceRanges(md);
  const re = /!\[([^\]]*)\]\(([^)]+)\)/g;
  const refs: ImageRef[] = [];
  let m: RegExpExecArray | null;
  while ((m = re.exec(md)) !== null) {
    if (inAnyRange(m.index, fences)) continue;
    const alt = m[1] ?? "";
    const inner = (m[2] ?? "").trim();
    const src = inner.split(/\s+/)[0] ?? "";
    refs.push({ match: m[0], alt, src, index: m.index });
  }
  return refs;
}

/** True when an image src looks like an informative raster image worth describing. */
export function isDescribable(src: string): boolean {
  if (NAME_SKIP.test(src)) return false;
  if (RASTER_DATA.test(src)) return true;
  return RASTER_EXT.test(src);
}
```

- [ ] **Step 5: Run the test to verify it passes**

Run: `npx vitest run tests/vlm-select.test.ts`
Expected: PASS (all cases).

- [ ] **Step 6: Commit**

```bash
git add src/vlm/types.ts src/vlm/select.ts tests/vlm-select.test.ts
git commit -m "feat(vlm): image-ref discovery + selection heuristics (docf-i17)"
```

---

## Task 2: Confirm Kreuzberg preserves image refs (assumption guard)

The whole post-Markdown approach assumes `convertHtml` keeps `![alt](src)`. Lock it with a regression test so a future Kreuzberg bump can't silently break the feature.

**Files:**
- Test: `tests/vlm-convert-preserves-img.test.ts`

- [ ] **Step 1: Write the test**

Create `tests/vlm-convert-preserves-img.test.ts`:

```ts
import { describe, expect, test } from "vitest";
import { convertHtml } from "../src/convert.js";

describe("convertHtml preserves image references (VLM pass precondition)", () => {
  test("an <img> survives as a Markdown image ref with alt + src", async () => {
    const html =
      `<html><head><title>T</title></head><body><div role="main">` +
      `<div itemprop="articleBody"><h1>Arch</h1>` +
      `<p>The deployment topology below shows the system layout in fine detail here.</p>` +
      `<figure><img src="diagrams/arch.png" alt="Architecture overview"></figure>` +
      `<p>More explanatory body text after the figure to clear the word threshold.</p>` +
      `</div></div></body></html>`;
    const r = await convertHtml(html);
    expect(r.status).toBe("ok");
    if (r.status === "ok") {
      expect(/!\[Architecture overview\]\([^)]*arch\.png[^)]*\)/.test(r.body_md)).toBe(true);
    }
  });
});
```

- [ ] **Step 2: Run the test to verify it passes**

Run: `npx vitest run tests/vlm-convert-preserves-img.test.ts`
Expected: PASS (verified manually during planning — the ref is emitted on its own line).

- [ ] **Step 3: Commit**

```bash
git add tests/vlm-convert-preserves-img.test.ts
git commit -m "test(vlm): lock Kreuzberg image-ref preservation precondition (docf-i17)"
```

---

## Task 3: Orchestrator + caption injection (`src/vlm/describe.ts`)

This is the testable core. All I/O is injected via `DescribeDeps`, so the test uses stubs — no network, no disk.

**Files:**
- Create: `src/vlm/describe.ts`
- Test: `tests/vlm-describe.test.ts`

- [ ] **Step 1: Write the failing test**

Create `tests/vlm-describe.test.ts`:

```ts
import { describe, expect, test } from "vitest";
import { captionBlock, describeImages } from "../src/vlm/describe.js";
import type { DescribeDeps, FetchedImage } from "../src/vlm/types.js";

const VLM = { baseUrl: "http://x/v1", model: "m", minDim: 64, maxImages: 50, concurrency: 2, timeoutMs: 1000 };

function deps(over: Partial<DescribeDeps> = {}): DescribeDeps {
  return {
    fetchImage: async (): Promise<FetchedImage> => ({ bytes: Buffer.from("img"), mime: "image/png" }),
    describe: async () => "A factual description.",
    sizeOf: () => ({ width: 800, height: 600 }),
    promptVersion: "test",
    ...over,
  };
}

describe("captionBlock", () => {
  test("formats a blockquote figure caption", () => {
    expect(captionBlock("Arch", "A diagram.")).toBe("\n\n> **Figure — Arch.** A diagram.");
  });
  test("falls back to 'image' when alt is empty and collapses whitespace", () => {
    expect(captionBlock("", "line one\n\nline two")).toBe("\n\n> **Figure — image.** line one line two");
  });
});

describe("describeImages", () => {
  test("injects a caption block after a described image", async () => {
    const md = "# H\n\n![Arch](/a.png)\n\nbody";
    const { md: out, stats } = await describeImages(md, "http://h/page", VLM, deps());
    expect(out).toBe("# H\n\n![Arch](/a.png)\n\n> **Figure — Arch.** A factual description.\n\nbody");
    expect(stats).toEqual({ described: 1, skipped: 0, failed: 0, cached: 0 });
  });

  test("skips non-describable refs and counts them", async () => {
    const md = "![logo](/logo.png)\n\n![real](/real.png)";
    const { stats } = await describeImages(md, "http://h/p", VLM, deps());
    expect(stats.described).toBe(1);
    expect(stats.skipped).toBe(1);
  });

  test("skips images below minDim", async () => {
    const { md: out, stats } = await describeImages("![a](/a.png)", "http://h/p", VLM, deps({ sizeOf: () => ({ width: 32, height: 16 }) }));
    expect(stats.skipped).toBe(1);
    expect(stats.described).toBe(0);
    expect(out).toBe("![a](/a.png)"); // untouched
  });

  test("uses the cache on a hit (no describe call)", async () => {
    let calls = 0;
    const cache = new Map<string, string>();
    const { stats } = await describeImages("![a](/a.png)", "http://h/p", VLM, deps({
      describe: async () => { calls++; return "fresh"; },
      cache: { get: async (k) => cache.get(k), set: async (k, v) => { cache.set(k, v); } },
    }));
    expect(stats.described).toBe(1);
    expect(calls).toBe(1);

    // Second run with the now-populated cache → cached hit, no new describe call.
    const { stats: s2 } = await describeImages("![a](/a.png)", "http://h/p", VLM, deps({
      describe: async () => { calls++; return "fresh"; },
      cache: { get: async (k) => cache.get(k), set: async (k, v) => { cache.set(k, v); } },
    }));
    expect(s2.cached).toBe(1);
    expect(s2.described).toBe(0);
    expect(calls).toBe(1); // unchanged
  });

  test("swallows a describe failure and leaves the image untouched", async () => {
    const md = "![a](/a.png)";
    const { md: out, stats } = await describeImages(md, "http://h/p", VLM, deps({
      describe: async () => { throw new Error("model down"); },
    }));
    expect(stats.failed).toBe(1);
    expect(out).toBe(md);
  });

  test("respects maxImages cap", async () => {
    const md = "![a](/a.png)\n\n![b](/b.png)\n\n![c](/c.png)";
    const { stats } = await describeImages(md, "http://h/p", { ...VLM, maxImages: 2 }, deps());
    expect(stats.described).toBe(2);
    expect(stats.skipped).toBe(1);
  });
});
```

- [ ] **Step 2: Run the test to verify it fails**

Run: `npx vitest run tests/vlm-describe.test.ts`
Expected: FAIL — `Cannot find module '../src/vlm/describe.js'`.

- [ ] **Step 3: Implement `describe.ts`**

Create `src/vlm/describe.ts`:

```ts
import { createHash } from "node:crypto";
import PQueue from "p-queue";
import { findImageRefs, isDescribable } from "./select.js";
import type { DescribeDeps, DescribeStats, VlmOptions } from "./types.js";

/** Build the caption block injected after an image ref. */
export function captionBlock(alt: string, description: string): string {
  const label = alt.trim() || "image";
  const clean = description.replace(/\s+/g, " ").trim();
  return `\n\n> **Figure — ${label}.** ${clean}`;
}

function resolveSrc(src: string, pageUrl: string): string | null {
  if (src.startsWith("data:")) return src;
  try {
    return new URL(src, pageUrl).toString();
  } catch {
    return null;
  }
}

function buildContext(md: string, index: number, alt: string): string {
  const before = md.slice(0, index);
  const lines = before.split("\n");
  let heading = "";
  for (let i = lines.length - 1; i >= 0; i--) {
    const line = lines[i] ?? "";
    if (/^#{1,6}\s+/.test(line)) {
      heading = line.replace(/^#{1,6}\s+/, "").replace(/\s+#*\s*$/, "").trim();
      break;
    }
  }
  const snippet = before.slice(-200).replace(/\s+/g, " ").trim();
  const parts: string[] = [];
  if (heading) parts.push(`Section: ${heading}`);
  const altClean = alt.trim();
  if (altClean) parts.push(`Alt text: ${altClean}`);
  if (snippet) parts.push(`Preceding text: …${snippet}`);
  return parts.join("\n");
}

interface Edit {
  index: number;
  length: number;
  insert: string;
}

/**
 * Describe informative images in `md` and inject caption blocks after them.
 * All I/O is supplied via `deps`, so this is pure given its dependencies.
 */
export async function describeImages(
  md: string,
  pageUrl: string,
  vlm: VlmOptions,
  deps: DescribeDeps,
): Promise<{ md: string; stats: DescribeStats }> {
  const stats: DescribeStats = { described: 0, skipped: 0, failed: 0, cached: 0 };
  const all = findImageRefs(md);
  const eligible = all.filter((r) => isDescribable(r.src));
  const capped = eligible.slice(0, vlm.maxImages);
  // Everything not attempted (non-eligible + over the cap) counts as skipped.
  stats.skipped = all.length - capped.length;

  const edits: Edit[] = [];
  const queue = new PQueue({ concurrency: vlm.concurrency });

  await Promise.all(
    capped.map((ref) =>
      queue.add(async () => {
        try {
          const url = resolveSrc(ref.src, pageUrl);
          if (!url) {
            stats.skipped++;
            return;
          }
          const image = await deps.fetchImage(url);
          const dim = deps.sizeOf(image.bytes);
          const maxSide = Math.max(dim.width ?? 0, dim.height ?? 0);
          if (maxSide > 0 && maxSide < vlm.minDim) {
            stats.skipped++;
            return;
          }
          const hash = createHash("sha256").update(image.bytes).digest("hex");
          const key = `${hash}:${vlm.model}:${deps.promptVersion}`;
          const hit = await deps.cache?.get(key);
          let description: string;
          if (hit) {
            description = hit;
            stats.cached++;
          } else {
            description = await deps.describe(image, buildContext(md, ref.index, ref.alt));
            await deps.cache?.set(key, description);
            stats.described++;
          }
          edits.push({ index: ref.index, length: ref.match.length, insert: captionBlock(ref.alt, description) });
        } catch {
          stats.failed++;
        }
      }),
    ),
  );

  // Apply edits from the end so earlier indices stay valid.
  edits.sort((a, b) => b.index - a.index);
  let out = md;
  for (const e of edits) {
    const at = e.index + e.length;
    out = out.slice(0, at) + e.insert + out.slice(at);
  }
  return { md: out, stats };
}
```

- [ ] **Step 4: Run the test to verify it passes**

Run: `npx vitest run tests/vlm-describe.test.ts`
Expected: PASS (all cases).

- [ ] **Step 5: Commit**

```bash
git add src/vlm/describe.ts tests/vlm-describe.test.ts
git commit -m "feat(vlm): describeImages orchestrator + caption injection (docf-i17)"
```

---

## Task 4: VLM client (`src/vlm/client.ts`)

**Files:**
- Create: `src/vlm/client.ts`
- Test: `tests/vlm-client.test.ts`

- [ ] **Step 1: Write the failing test**

Create `tests/vlm-client.test.ts`. It runs a fake OpenAI-compatible server with `node:http`, asserts the request shape, and checks parsing.

```ts
import { afterEach, beforeEach, describe, expect, test } from "vitest";
import { createServer, type Server } from "node:http";
import { AddressInfo } from "node:net";
import { callVlm } from "../src/vlm/client.js";
import type { VlmOptions } from "../src/vlm/types.js";

let server: Server;
let baseUrl: string;
let lastBody: any;
let lastAuth: string | undefined;
let nextContent: string | null = "A small architecture diagram.";

beforeEach(async () => {
  lastBody = undefined;
  lastAuth = undefined;
  nextContent = "A small architecture diagram.";
  server = createServer((req, res) => {
    if (req.url !== "/v1/chat/completions" || req.method !== "POST") {
      res.writeHead(404).end();
      return;
    }
    lastAuth = req.headers["authorization"] as string | undefined;
    let raw = "";
    req.on("data", (c) => (raw += c));
    req.on("end", () => {
      lastBody = JSON.parse(raw);
      res.writeHead(200, { "content-type": "application/json" });
      res.end(JSON.stringify({ choices: nextContent === null ? [] : [{ message: { content: nextContent } }] }));
    });
  });
  await new Promise<void>((r) => server.listen(0, "127.0.0.1", r));
  baseUrl = `http://127.0.0.1:${(server.address() as AddressInfo).port}/v1`;
});
afterEach(async () => {
  await new Promise<void>((r) => server.close(() => r()));
});

function opts(over: Partial<VlmOptions> = {}): VlmOptions {
  return { baseUrl, model: "test-vlm", minDim: 64, maxImages: 50, concurrency: 2, timeoutMs: 5000, ...over };
}

describe("callVlm", () => {
  test("posts model + image data URL and returns the content", async () => {
    const out = await callVlm(opts({ apiKey: "secret" }), { bytes: Buffer.from("PNGDATA"), mime: "image/png" }, "Section: Arch");
    expect(out).toBe("A small architecture diagram.");
    expect(lastBody.model).toBe("test-vlm");
    expect(lastAuth).toBe("Bearer secret");
    const parts = lastBody.messages[0].content;
    expect(parts[0].text).toContain("Section: Arch");
    expect(parts[1].image_url.url).toBe(`data:image/png;base64,${Buffer.from("PNGDATA").toString("base64")}`);
  });

  test("omits Authorization when no apiKey", async () => {
    await callVlm(opts(), { bytes: Buffer.from("x"), mime: "image/png" }, "");
    expect(lastAuth).toBeUndefined();
  });

  test("throws when the model returns empty content", async () => {
    nextContent = null;
    await expect(callVlm(opts(), { bytes: Buffer.from("x"), mime: "image/png" }, "")).rejects.toThrow(/empty/i);
  });
});
```

- [ ] **Step 2: Run the test to verify it fails**

Run: `npx vitest run tests/vlm-client.test.ts`
Expected: FAIL — `Cannot find module '../src/vlm/client.js'`.

- [ ] **Step 3: Implement `client.ts`**

Create `src/vlm/client.ts`:

```ts
import got from "got";
import type { FetchedImage, VlmOptions } from "./types.js";

/** Bump when PROMPT changes — invalidates cached descriptions. */
export const PROMPT_VERSION = "v1";

const PROMPT =
  "You are describing an image from technical documentation for a search index. " +
  "Write a single factual paragraph of at most ~120 words. " +
  "Transcribe ALL visible text verbatim: labels, axes, legends, code, UI strings, table cells. " +
  "Describe diagram structure and flow. Do not speculate about anything not visible. " +
  "Output only the description, with no preamble.";

interface ChatResponse {
  choices?: Array<{ message?: { content?: string } }>;
}

/** Call an OpenAI-compatible VLM with one image. Throws on transport or empty response. */
export async function callVlm(opts: VlmOptions, image: FetchedImage, context: string): Promise<string> {
  const url = `${opts.baseUrl.replace(/\/$/, "")}/chat/completions`;
  const dataUrl = `data:${image.mime};base64,${image.bytes.toString("base64")}`;
  const headers: Record<string, string> = { "content-type": "application/json" };
  if (opts.apiKey) headers.authorization = `Bearer ${opts.apiKey}`;

  const body = {
    model: opts.model,
    temperature: 0,
    max_tokens: 256,
    messages: [
      {
        role: "user",
        content: [
          { type: "text", text: context ? `${PROMPT}\n\nContext:\n${context}` : PROMPT },
          { type: "image_url", image_url: { url: dataUrl } },
        ],
      },
    ],
  };

  const res = await got
    .post(url, { json: body, headers, timeout: { request: opts.timeoutMs }, retry: { limit: 0 } })
    .json<ChatResponse>();

  const text = res.choices?.[0]?.message?.content?.trim();
  if (!text) throw new Error("VLM returned empty content");
  return text;
}
```

- [ ] **Step 4: Run the test to verify it passes**

Run: `npx vitest run tests/vlm-client.test.ts`
Expected: PASS.

- [ ] **Step 5: Commit**

```bash
git add src/vlm/client.ts tests/vlm-client.test.ts
git commit -m "feat(vlm): OpenAI-compatible VLM client (docf-i17)"
```

---

## Task 5: Real-dependency wiring (`src/vlm/index.ts`) + add `image-size`

**Files:**
- Modify: `package.json` (via `npm install`)
- Create: `src/vlm/index.ts`
- Test: `tests/vlm-pass.test.ts`

- [ ] **Step 1: Add the `image-size` dependency**

Run: `npm install image-size@^1.2.0`
Expected: `package.json` `dependencies` gains `"image-size": "^1.2.0"`; `package-lock.json` updated. (v1's default export reads dimensions synchronously from a `Buffer`.)

- [ ] **Step 2: Write the failing test**

Create `tests/vlm-pass.test.ts`. One server provides both the image and the VLM endpoint.

```ts
import { afterEach, beforeEach, describe, expect, test } from "vitest";
import { createServer, type Server } from "node:http";
import { AddressInfo } from "node:net";
import { runVlmPass } from "../src/vlm/index.js";
import type { VlmOptions } from "../src/vlm/types.js";
import type { FetchOptions } from "../src/http/fetch.js";

// 1x1 transparent PNG.
const PNG_1x1 = Buffer.from(
  "iVBORw0KGgoAAAANSUhEUgAAAAEAAAABCAQAAAC1HAwCAAAAC0lEQVR42mP8z8BQDwAEhQGAhKmMIQAAAABJRU5ErkJggg==",
  "base64",
);

let server: Server;
let base: string;

beforeEach(async () => {
  server = createServer((req, res) => {
    const path = (req.url ?? "").split("?")[0];
    if (path === "/img.png") {
      res.writeHead(200, { "content-type": "image/png" });
      res.end(PNG_1x1);
      return;
    }
    if (path === "/notimg.png") {
      res.writeHead(200, { "content-type": "text/plain" });
      res.end("not an image");
      return;
    }
    if (path === "/v1/chat/completions") {
      let raw = "";
      req.on("data", (c) => (raw += c));
      req.on("end", () => {
        res.writeHead(200, { "content-type": "application/json" });
        res.end(JSON.stringify({ choices: [{ message: { content: "A tiny test image." } }] }));
      });
      return;
    }
    res.writeHead(404).end();
  });
  await new Promise<void>((r) => server.listen(0, "127.0.0.1", r));
  base = `http://127.0.0.1:${(server.address() as AddressInfo).port}`;
});
afterEach(async () => {
  await new Promise<void>((r) => server.close(() => r()));
});

function fetchOpts(): FetchOptions {
  return { userAgent: "docforge-test/0", timeoutMs: 5000, maxBytes: 10_000_000, cacheDir: null };
}
function vlm(): VlmOptions {
  return { baseUrl: `${base}/v1`, model: "test", minDim: 1, maxImages: 50, concurrency: 2, timeoutMs: 5000 };
}

describe("runVlmPass (real fetch + client wiring)", () => {
  test("describes a relative-URL image and injects a caption", async () => {
    const { md, stats } = await runVlmPass("![Arch](/img.png)", `${base}/page`, vlm(), fetchOpts());
    expect(stats.described).toBe(1);
    expect(md).toContain("> **Figure — Arch.** A tiny test image.");
  });

  test("describes a data: URI image", async () => {
    const dataUri = `data:image/png;base64,${PNG_1x1.toString("base64")}`;
    const { stats } = await runVlmPass(`![d](${dataUri})`, `${base}/page`, vlm(), fetchOpts());
    expect(stats.described).toBe(1);
  });

  test("treats a non-image response as a failure (leaves ref untouched)", async () => {
    const { md, stats } = await runVlmPass("![x](/notimg.png)", `${base}/page`, vlm(), fetchOpts());
    expect(stats.failed).toBe(1);
    expect(md).toBe("![x](/notimg.png)");
  });
});
```

- [ ] **Step 3: Run the test to verify it fails**

Run: `npx vitest run tests/vlm-pass.test.ts`
Expected: FAIL — `Cannot find module '../src/vlm/index.js'`.

- [ ] **Step 4: Implement `index.ts`**

Create `src/vlm/index.ts`:

```ts
import { join } from "node:path";
import sizeOf from "image-size";
import { Keyv } from "keyv";
import { KeyvFile } from "keyv-file";
import { fetchUrl, type FetchOptions } from "../http/fetch.js";
import { callVlm, PROMPT_VERSION } from "./client.js";
import { describeImages } from "./describe.js";
import type { DescribeStats, FetchedImage, VlmCache, VlmOptions } from "./types.js";

function makeCache(cacheDir: string | null): VlmCache | undefined {
  if (!cacheDir) return undefined;
  const kv = new Keyv<string>({ store: new KeyvFile({ filename: join(cacheDir, "vlm.json") }) });
  return {
    get: (k) => kv.get(k) as Promise<string | undefined>,
    set: async (k, v) => {
      await kv.set(k, v);
    },
  };
}

function decodeDataUri(src: string): FetchedImage {
  const m = /^data:([^;,]+)(;base64)?,(.*)$/s.exec(src);
  if (!m) throw new Error("malformed data URI");
  const mime = m[1] ?? "application/octet-stream";
  const data = m[3] ?? "";
  const bytes = m[2] ? Buffer.from(data, "base64") : Buffer.from(decodeURIComponent(data), "utf8");
  return { bytes, mime };
}

/**
 * Run the VLM image-description pass over a converted Markdown body, wiring the
 * real fetch client (cache + auth inherited), VLM client, image-size, and cache.
 */
export async function runVlmPass(
  md: string,
  pageUrl: string,
  vlm: VlmOptions,
  fetchOpts: FetchOptions,
): Promise<{ md: string; stats: DescribeStats }> {
  const cache = makeCache(fetchOpts.cacheDir);
  return describeImages(md, pageUrl, vlm, {
    fetchImage: async (url): Promise<FetchedImage> => {
      if (url.startsWith("data:")) return decodeDataUri(url);
      const r = await fetchUrl(url, fetchOpts);
      const mime = (r.contentType.split(";")[0] ?? "").trim();
      if (!mime.startsWith("image/")) throw new Error(`not an image (${r.contentType})`);
      return { bytes: r.bytes, mime };
    },
    describe: (image, context) => callVlm(vlm, image, context),
    sizeOf: (bytes) => {
      try {
        const d = sizeOf(bytes);
        const out: { width?: number; height?: number } = {};
        if (typeof d.width === "number") out.width = d.width;
        if (typeof d.height === "number") out.height = d.height;
        return out;
      } catch {
        return {};
      }
    },
    ...(cache ? { cache } : {}),
    promptVersion: PROMPT_VERSION,
  });
}
```

- [ ] **Step 5: Run the test to verify it passes**

Run: `npx vitest run tests/vlm-pass.test.ts`
Expected: PASS. If `image-size`'s default import errors under ESM, confirm the installed version is `1.x` (not `2.x`, which changed to a named `imageSize` export).

- [ ] **Step 6: Commit**

```bash
git add package.json package-lock.json src/vlm/index.ts tests/vlm-pass.test.ts
git commit -m "feat(vlm): wire real fetch/client/cache + add image-size dep (docf-i17)"
```

---

## Task 6: Pipeline integration (`src/runPipeline.ts`)

**Files:**
- Modify: `src/runPipeline.ts`
- Test: `tests/vlm-pipeline.test.ts`

- [ ] **Step 1: Write the failing test**

Create `tests/vlm-pipeline.test.ts`. A single fake server serves robots.txt, the HTML page (with an `<img>`), the image, and the VLM endpoint. Drives `runPipeline` end-to-end.

```ts
import { afterEach, beforeEach, describe, expect, test } from "vitest";
import { createServer, type Server } from "node:http";
import { AddressInfo } from "node:net";
import { mkdtempSync, readFileSync, rmSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { runPipeline } from "../src/runPipeline.js";
import { __clearRobotsCache } from "../src/http/robots.js";

const PNG_1x1 = Buffer.from(
  "iVBORw0KGgoAAAANSUhEUgAAAAEAAAABCAQAAAC1HAwCAAAAC0lEQVR42mP8z8BQDwAEhQGAhKmMIQAAAABJRU5ErkJggg==",
  "base64",
);
const PAGE =
  `<!doctype html><html><head><title>Arch Page</title></head><body><main>` +
  `<h1>Arch Page</h1>` +
  `<p>The deployment topology below shows the system layout in good and clear detail.</p>` +
  `<img src="/img.png" alt="Arch">` +
  `<p>More body text after the figure to comfortably exceed the word-count threshold.</p>` +
  `</main></body></html>`;

let server: Server;
let base: string;
let tmp: string;

beforeEach(async () => {
  __clearRobotsCache();
  tmp = mkdtempSync(join(tmpdir(), "docforge-vlm-pipe-"));
  server = createServer((req, res) => {
    const path = (req.url ?? "").split("?")[0];
    if (path === "/robots.txt") { res.writeHead(200, { "content-type": "text/plain" }); res.end(""); return; }
    if (path === "/") { res.writeHead(200, { "content-type": "text/html; charset=utf-8" }); res.end(PAGE); return; }
    if (path === "/img.png") { res.writeHead(200, { "content-type": "image/png" }); res.end(PNG_1x1); return; }
    if (path === "/v1/chat/completions") {
      let raw = ""; req.on("data", (c) => (raw += c));
      req.on("end", () => { res.writeHead(200, { "content-type": "application/json" }); res.end(JSON.stringify({ choices: [{ message: { content: "A tiny architecture diagram." } }] })); });
      return;
    }
    res.writeHead(404).end();
  });
  await new Promise<void>((r) => server.listen(0, "127.0.0.1", r));
  base = `http://127.0.0.1:${(server.address() as AddressInfo).port}`;
});
afterEach(async () => {
  await new Promise<void>((r) => server.close(() => r()));
  rmSync(tmp, { recursive: true, force: true });
});

function fetchOptions() {
  return { userAgent: "docforge-test/0", timeoutMs: 5000, maxBytes: 10_000_000, cacheDir: null };
}
function crawlOptions() {
  return { maxPages: 1, maxDepth: 1, concurrency: 1, userAgent: "docforge-test/0", llmsFullMode: "off" as const };
}

describe("runPipeline VLM integration", () => {
  test("injects a caption block into the written Markdown when vlm is set", async () => {
    const result = await runPipeline({
      source: `${base}/`,
      outputDir: tmp,
      maxBytes: 10_000_000,
      dryRun: false,
      fetchOptions: fetchOptions(),
      crawlOptions: crawlOptions(),
      vlm: { baseUrl: `${base}/v1`, model: "test", minDim: 1, maxImages: 50, concurrency: 2, timeoutMs: 5000 },
    });
    expect(result.vlm?.described).toBe(1);
    const out = readFileSync(join(tmp, "index.md"), "utf8");
    expect(out).toContain("![Arch]");
    expect(out).toContain("> **Figure — Arch.** A tiny architecture diagram.");
  });

  test("leaves the image untouched and reports no vlm stats when vlm is unset", async () => {
    const result = await runPipeline({
      source: `${base}/`,
      outputDir: tmp,
      maxBytes: 10_000_000,
      dryRun: false,
      fetchOptions: fetchOptions(),
      crawlOptions: crawlOptions(),
    });
    expect(result.vlm).toBeUndefined();
    const out = readFileSync(join(tmp, "index.md"), "utf8");
    expect(out).toContain("![Arch]");
    expect(out).not.toContain("> **Figure");
  });
});
```

- [ ] **Step 2: Run the test to verify it fails**

Run: `npx vitest run tests/vlm-pipeline.test.ts`
Expected: FAIL — `vlm` not assignable to `RunPipelineOptions` / `result.vlm` undefined property type.

- [ ] **Step 3: Add the imports**

In `src/runPipeline.ts`, after the existing import block (the line `import type { CrawlOptions } from "./http/crawl.js";` at line 17), add:

```ts
import { runVlmPass } from "./vlm/index.js";
import type { VlmOptions, DescribeStats } from "./vlm/types.js";
```

- [ ] **Step 4: Extend the option + result types**

In `src/runPipeline.ts`, add `vlm` to `RunPipelineOptions` (after `selector?: string;`, line 26):

```ts
  selector?: string;
  vlm?: VlmOptions;
```

Add `vlm` to `PipelineResult` (after `report: ReportEntry[];`, line 34):

```ts
  report: ReportEntry[];
  vlm?: DescribeStats;
```

- [ ] **Step 5: Declare the aggregate before the loop**

In `src/runPipeline.ts`, next to the other counters (after `const report: ReportEntry[] = [];`, line 87), add:

```ts
  const vlmStats: DescribeStats = { described: 0, skipped: 0, failed: 0, cached: 0 };
```

- [ ] **Step 6: Insert the pass and use its output**

In `src/runPipeline.ts`, replace the HTML-branch tail (currently lines 192-193):

```ts
    const bodyMd = rewriteInternalLinks(result.body_md);
    const content = buildOutput(title, item.key, bodyMd);
```

with:

```ts
    let bodyMd = rewriteInternalLinks(result.body_md);
    if (
      opts.vlm &&
      opts.fetchOptions &&
      (item.srcUri.startsWith("http://") || item.srcUri.startsWith("https://"))
    ) {
      try {
        const vlmResult = await runVlmPass(bodyMd, item.srcUri, opts.vlm, opts.fetchOptions);
        bodyMd = vlmResult.md;
        vlmStats.described += vlmResult.stats.described;
        vlmStats.skipped += vlmResult.stats.skipped;
        vlmStats.failed += vlmResult.stats.failed;
        vlmStats.cached += vlmResult.stats.cached;
      } catch (e) {
        log("warn", `vlm pass failed for ${item.key}: ${(e as Error).message}`);
      }
    }
    const content = buildOutput(title, item.key, bodyMd);
```

- [ ] **Step 7: Return the aggregate when the pass ran**

In `src/runPipeline.ts`, replace the final `return` (line 199):

```ts
  return { converted, empty, skipped: source.skippedCount, failed, report };
```

with:

```ts
  return {
    converted,
    empty,
    skipped: source.skippedCount,
    failed,
    report,
    ...(opts.vlm ? { vlm: vlmStats } : {}),
  };
```

- [ ] **Step 8: Run the test to verify it passes**

Run: `npx vitest run tests/vlm-pipeline.test.ts`
Expected: PASS (both tests).

- [ ] **Step 9: Run the full suite (regression check)**

Run: `npm test`
Expected: PASS — all existing tests still green (flag-off path unchanged).

- [ ] **Step 10: Commit**

```bash
git add src/runPipeline.ts tests/vlm-pipeline.test.ts
git commit -m "feat(vlm): run image-description pass in pipeline for URL sources (docf-i17)"
```

---

## Task 7: CLI flags (`src/cli.ts`)

**Files:**
- Modify: `src/cli.ts`
- Test: `tests/cli-describe-images.test.ts`

- [ ] **Step 1: Write the failing test**

Create `tests/cli-describe-images.test.ts`. These tests exercise validation/branching only (no network), so they don't need a server.

```ts
import { afterEach, beforeEach, describe, expect, test } from "vitest";
import { mkdtempSync, rmSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { runConvert } from "../src/cli.js";

let tmp: string;
beforeEach(() => {
  tmp = mkdtempSync(join(tmpdir(), "docforge-cli-vlm-"));
});
afterEach(() => {
  rmSync(tmp, { recursive: true, force: true });
  delete process.env.DOCFORGE_VLM_BASE_URL;
  delete process.env.DOCFORGE_VLM_MODEL;
});

function baseOpts(output: string) {
  return {
    output,
    failThreshold: "0.10",
    maxBytes: "10485760",
    dryRun: false,
    maxPages: "1",
    maxDepth: "1",
    concurrency: "1",
    cacheDir: join(tmp, ".cache"),
    cache: false,
    userAgent: "docforge-test/0",
    llmsFull: "auto",
  };
}

describe("convert --describe-images validation", () => {
  test("exits 2 when --describe-images is set without base-url/model", async () => {
    const code = await runConvert("https://example.com/", {
      ...baseOpts(join(tmp, "o")),
      describeImages: true,
    });
    expect(code).toBe(2);
  });

  test("warns and proceeds (exit 0) when --describe-images is set on a local source", async () => {
    // A local directory source: VLM is URL-only, so the flag is ignored with a warning.
    const code = await runConvert(tmp, {
      ...baseOpts(join(tmp, "o")),
      describeImages: true,
      vlmBaseUrl: "http://127.0.0.1:1/v1",
      vlmModel: "x",
    });
    expect(code).toBe(0); // empty dir → 0 converted, 0 failed → under threshold
  });
});
```

- [ ] **Step 2: Run the test to verify it fails**

Run: `npx vitest run tests/cli-describe-images.test.ts`
Expected: FAIL — `describeImages` not a known property of the opts type / first test returns 0 not 2.

- [ ] **Step 3: Register the CLI options**

In `src/cli.ts`, in the `convert` command builder, after the `--selector` option (line 44) add:

```ts
    .option("--describe-images", "describe images via a VLM (URL source only)", false)
    .option("--vlm-base-url <url>", "OpenAI-compatible VLM base URL incl. /v1 (env DOCFORGE_VLM_BASE_URL)")
    .option("--vlm-model <name>", "VLM model id (env DOCFORGE_VLM_MODEL)")
    .option("--vlm-api-key <key>", "VLM API key (env DOCFORGE_VLM_API_KEY)")
    .option("--vlm-min-dim <px>", "skip images smaller than N px on the long side", "64")
    .option("--vlm-max-images <N>", "max images described per document", "50")
    .option("--vlm-concurrency <N>", "parallel VLM calls", "2")
```

- [ ] **Step 4: Extend the `ConvertOpts` interface**

In `src/cli.ts`, add to `interface ConvertOpts` (after `authHeader?: string | undefined;`, line 70). All optional so existing direct callers/tests are unaffected:

```ts
  describeImages?: boolean | undefined;
  vlmBaseUrl?: string | undefined;
  vlmModel?: string | undefined;
  vlmApiKey?: string | undefined;
  vlmMinDim?: string | undefined;
  vlmMaxImages?: string | undefined;
  vlmConcurrency?: string | undefined;
```

- [ ] **Step 5: Build `pipelineOpts.vlm` (URL branch) + warn on misuse**

In `src/cli.ts`, inside `runConvert`, at the very end of the `if (isUrl(sourceArg)) { … }` block — immediately before its closing brace (after the `crawlOptions` assignment, line 121) — add:

```ts
    if (opts.describeImages) {
      const baseUrl = opts.vlmBaseUrl ?? process.env.DOCFORGE_VLM_BASE_URL;
      const model = opts.vlmModel ?? process.env.DOCFORGE_VLM_MODEL;
      if (!baseUrl || !model) {
        log(
          "error",
          "--describe-images requires --vlm-base-url and --vlm-model (or DOCFORGE_VLM_BASE_URL / DOCFORGE_VLM_MODEL)",
        );
        return 2;
      }
      const apiKey = opts.vlmApiKey ?? process.env.DOCFORGE_VLM_API_KEY;
      pipelineOpts.vlm = {
        baseUrl,
        model,
        minDim: parseInt(opts.vlmMinDim ?? "64", 10),
        maxImages: parseInt(opts.vlmMaxImages ?? "50", 10),
        concurrency: parseInt(opts.vlmConcurrency ?? "2", 10),
        timeoutMs: 60_000,
        ...(apiKey ? { apiKey } : {}),
      };
    }
```

Then, immediately after the whole `if (isUrl(sourceArg)) { … }` block closes (before `let result;`, line 124), add the misuse warning:

```ts
  if (opts.describeImages && !isUrl(sourceArg)) {
    log("warn", "--describe-images ignored for non-URL sources (v1 supports URL sources only)");
  }
```

- [ ] **Step 6: Log VLM stats after a run**

In `src/cli.ts`, after the existing summary `log("info", …)` (the `converted=… empty=…` line, lines 137-140), add:

```ts
  if (result.vlm) {
    log(
      "info",
      `vlm: described=${result.vlm.described} skipped=${result.vlm.skipped} failed=${result.vlm.failed} cached=${result.vlm.cached}`,
    );
  }
```

- [ ] **Step 7: Run the test to verify it passes**

Run: `npx vitest run tests/cli-describe-images.test.ts`
Expected: PASS (both tests).

- [ ] **Step 8: Commit**

```bash
git add src/cli.ts tests/cli-describe-images.test.ts
git commit -m "feat(cli): add --describe-images + --vlm-* flags to convert (docf-i17)"
```

---

## Task 8: MCP convert tool (`src/mcp/*`)

For the MCP server the VLM endpoint, model, and key come from the **server environment** (`DOCFORGE_VLM_BASE_URL` / `DOCFORGE_VLM_MODEL` / `DOCFORGE_VLM_API_KEY`), not from tool arguments — so the API key never enters the tool-call transcript. The tool exposes only a `describe_images` toggle plus `vlm_min_dim` / `vlm_max_images` overrides. (This is a deliberate, security-positive refinement of the spec's "vlm args" sketch.)

**Files:**
- Modify: `src/mcp/errors.ts`
- Modify: `src/mcp/config.ts`
- Modify: `src/mcp/tools/convert.ts`
- Test: `tests/mcp/convert-describe-images.test.ts`

- [ ] **Step 1: Write the failing test**

Create `tests/mcp/convert-describe-images.test.ts`:

```ts
import { afterEach, beforeEach, describe, expect, test } from "vitest";
import { mkdtempSync, rmSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { convertTool } from "../../src/mcp/tools/convert.js";
import { LockManager } from "../../src/mcp/locks.js";
import type { ServerContext } from "../../src/mcp/server.js";

let tmp: string;
function ctx(vlm?: { baseUrl: string; model: string; apiKey?: string }): ServerContext {
  return {
    config: {
      qmdRoot: tmp,
      cacheDir: join(tmp, ".cache"),
      userAgent: "docforge-test/0",
      maxPages: 1,
      maxDepth: 1,
      concurrency: 1,
      ...(vlm ? { vlm } : {}),
    },
    locks: new LockManager(),
  };
}

beforeEach(() => {
  tmp = mkdtempSync(join(tmpdir(), "docforge-mcp-vlm-"));
});
afterEach(() => {
  rmSync(tmp, { recursive: true, force: true });
});

describe("convert tool — describe_images", () => {
  test("exposes describe_images in the input schema", () => {
    const props = convertTool.inputSchema.properties as Record<string, unknown>;
    expect(props.describe_images).toBeDefined();
    expect(props.vlm_min_dim).toBeDefined();
    expect(props.vlm_max_images).toBeDefined();
  });

  test("rejects describe_images=true when the server has no VLM configured (INVALID_ARGS)", async () => {
    await expect(
      convertTool.handler({ url: "https://example.com/", describe_images: true }, ctx()),
    ).rejects.toMatchObject({ code: "INVALID_ARGS" });
  });
});
```

- [ ] **Step 2: Run the test to verify it fails**

Run: `npx vitest run tests/mcp/convert-describe-images.test.ts`
Expected: FAIL — schema props undefined / `INVALID_ARGS` not a valid `ErrorCode` (type error) and handler does not throw it.

- [ ] **Step 3: Add the `INVALID_ARGS` error code**

In `src/mcp/errors.ts`, add to the `ErrorCode` union (after `"INVALID_CORPUS_NAME"`, line 3):

```ts
  | "INVALID_ARGS"
```

- [ ] **Step 4: Load VLM config from env**

In `src/mcp/config.ts`, add to the `McpConfig` interface (after `concurrency: number;`, line 13):

```ts
  vlm?: { baseUrl: string; model: string; apiKey?: string };
```

In `loadConfig`, before the final `return { … }` (line 50), add:

```ts
  const vlmBaseUrl = process.env.DOCFORGE_VLM_BASE_URL;
  const vlmModel = process.env.DOCFORGE_VLM_MODEL;
  const vlm =
    vlmBaseUrl && vlmModel
      ? {
          baseUrl: vlmBaseUrl,
          model: vlmModel,
          ...(process.env.DOCFORGE_VLM_API_KEY ? { apiKey: process.env.DOCFORGE_VLM_API_KEY } : {}),
        }
      : undefined;
```

Change the `return` to include it:

```ts
  return {
    qmdRoot,
    cacheDir,
    userAgent,
    maxPages: parseIntEnv("DOCFORGE_MAX_PAGES", 5000),
    maxDepth: parseIntEnv("DOCFORGE_MAX_DEPTH", 10),
    concurrency: parseIntEnv("DOCFORGE_CONCURRENCY", 4),
    ...(vlm ? { vlm } : {}),
  };
```

- [ ] **Step 5: Add args to the convert tool**

In `src/mcp/tools/convert.ts`, add to `interface ConvertArgs` (after `auth_header?: string;`, line 35):

```ts
  describe_images?: boolean;
  vlm_min_dim?: number;
  vlm_max_images?: number;
```

In `parseArgs`, before `return args;` (line 75), add:

```ts
  if (raw.describe_images === true) args.describe_images = true;
  if (typeof raw.vlm_min_dim === "number") args.vlm_min_dim = raw.vlm_min_dim;
  if (typeof raw.vlm_max_images === "number") args.vlm_max_images = raw.vlm_max_images;
```

In `inputSchema.properties`, after the `exclude_hosts` property (line 196), add:

```ts
      describe_images: {
        type: "boolean",
        default: false,
        description: "describe images via the server-configured VLM (requires DOCFORGE_VLM_BASE_URL + DOCFORGE_VLM_MODEL env)",
      },
      vlm_min_dim: { type: "integer", minimum: 1, description: "skip images smaller than N px on the long side (default 64)" },
      vlm_max_images: { type: "integer", minimum: 1, description: "max images described per document (default 50)" },
```

- [ ] **Step 6: Build `pipelineOpts.vlm` in the handler**

In `src/mcp/tools/convert.ts`, immediately after the `if (args.selector !== undefined) pipelineOpts.selector = args.selector;` line (line 264), add:

```ts
      if (args.describe_images) {
        if (!ctx.config.vlm) {
          throw new McpError(
            "INVALID_ARGS",
            "describe_images=true but the server has no VLM configured",
            "set DOCFORGE_VLM_BASE_URL and DOCFORGE_VLM_MODEL in the MCP server environment",
          );
        }
        pipelineOpts.vlm = {
          baseUrl: ctx.config.vlm.baseUrl,
          model: ctx.config.vlm.model,
          minDim: args.vlm_min_dim ?? 64,
          maxImages: args.vlm_max_images ?? 50,
          concurrency: 2,
          timeoutMs: 60_000,
          ...(ctx.config.vlm.apiKey ? { apiKey: ctx.config.vlm.apiKey } : {}),
        };
      }
```

- [ ] **Step 7: Run the test to verify it passes**

Run: `npx vitest run tests/mcp/convert-describe-images.test.ts`
Expected: PASS (both tests).

- [ ] **Step 8: Commit**

```bash
git add src/mcp/errors.ts src/mcp/config.ts src/mcp/tools/convert.ts tests/mcp/convert-describe-images.test.ts
git commit -m "feat(mcp): add describe_images arg to convert (env-configured VLM) (docf-i17)"
```

---

## Task 9: Documentation + final verification

**Files:**
- Modify: `README.md`

- [ ] **Step 1: Document the feature in the README**

In `README.md`, add a new section after the "### Body extraction" section (before "### llms-full.txt shortcut"):

```markdown
### Image description (VLM)

Documentation images — diagrams, screenshots, figures — are normally lost in the
HTML→Markdown conversion (only weak alt-text survives). With `--describe-images`,
docforge sends each informative raster image to a local OpenAI-compatible VLM
(e.g. LM Studio serving Qwen2.5-VL) and injects a caption block after the image:

```` markdown
![Architecture overview](arch.png)

> **Figure — Architecture overview.** A load balancer routes traffic to three
> API nodes, each reading from a shared Postgres primary with one read replica.
````

This is an opt-in, **URL-source-only** pass. It runs outside the deterministic
conversion core: with the flag off, output is byte-identical to before. Image
fetches reuse the crawl's cache and auth; descriptions are cached by image hash
so repeated logos/diagrams are described once. A model outage skips the image
and warns — the document still converts.

```bash
docforge convert https://docs.example.com/ --output ./md \
  --describe-images \
  --vlm-base-url http://192.168.1.114:1234/v1 \
  --vlm-model qwen2.5-vl-7b-instruct \
  --vlm-api-key "$LMSTUDIO_TOKEN"
```

Flags: `--describe-images`, `--vlm-base-url` (env `DOCFORGE_VLM_BASE_URL`),
`--vlm-model` (env `DOCFORGE_VLM_MODEL`), `--vlm-api-key`
(env `DOCFORGE_VLM_API_KEY`), `--vlm-min-dim` (default 64),
`--vlm-max-images` (default 50), `--vlm-concurrency` (default 2). SVG and
local-file sources are not yet supported.

**Prerequisite:** a vision-capable model must be loaded in the endpoint; an
embedding-only model cannot describe images. Output is not byte-reproducible
with this flag on (VLMs are not deterministic); the cache makes it stable within
a cache lifetime.

For the MCP `convert` tool, the VLM endpoint/model/key are read from the server
environment (`DOCFORGE_VLM_*`); the tool exposes only `describe_images`,
`vlm_min_dim`, and `vlm_max_images` so the key never enters the transcript.
```

- [ ] **Step 2: Run the full test suite**

Run: `npm test`
Expected: PASS — every test green, including all pre-existing goldens (proves the flag-off path is unchanged).

- [ ] **Step 3: Typecheck**

Run: `npm run typecheck`
Expected: no errors.

- [ ] **Step 4: Commit**

```bash
git add README.md
git commit -m "docs: document --describe-images VLM pass (docf-i17)"
```

- [ ] **Step 5: Close the beads issue**

```bash
bd close docf-i17 --reason="VLM image description pass shipped (URL sources): select → fetch → describe → caption, opt-in, cached, failure-safe; CLI + MCP surfaces; tests green"
git push
```

---

## Notes for the implementer

- **Determinism:** with the flag off, nothing in `src/vlm/` runs and no output changes. The pre-existing golden tests are the guardrail — keep them green.
- **Why injected deps in `describeImages`:** it keeps the orchestrator logic (selection, caching, caption placement, failure handling) testable without network or disk. `runVlmPass` is the only place that touches the real world.
- **Auth safety:** image fetches reuse `fetchUrl`, whose `Authorization` header is origin-gated — a CDN-hosted image on a different origin will not receive the doc-site token. The VLM endpoint key is separate and only sent to the VLM endpoint.
- **`image-size` version:** pin to `1.x`. v2 changed the API to a named `imageSize` export; the plan's default-import sync-Buffer usage is the v1 form.
- **If `new Keyv({ store: new KeyvFile(...) })` fails to typecheck:** the existing `src/http/compat-keyv.ts` + `src/http/fetch.ts:49-51` prove this construction compiles in this repo — mirror it exactly.
```
