# docforge — TypeScript Rewrite Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Rewrite the docforge CLI from Python to TypeScript with full feature parity (HTML→Markdown convert + OpenAPI 3.x render), fix the lying `skipped` counter, and retire the Python codebase once dogfood proves parity.

**Architecture:** Node 20+ ESM TypeScript. cheerio for HTML parsing (replaces BS4). `@kreuzberg/node` for HTML→Markdown (same Rust core as the Python binding). commander for CLI subcommands (`convert` + `openapi`). vitest for unit + golden tests. Sync throughout, single-threaded — matches Python.

**Tech Stack:** Node 20+, TypeScript 5.7 strict, ESM, npm, cheerio, @kreuzberg/node, commander, js-yaml, vitest, tsx.

**Spec:** `docs/superpowers/specs/2026-05-09-docforge-typescript-rewrite-design.md`

---

## File Structure

After completing all waves the tree looks like this:

```
~/experiements/docforge/
├── package.json
├── tsconfig.json
├── vitest.config.ts
├── README.md
├── LICENSE
├── .gitignore
├── docs/superpowers/{specs,plans}/...
├── src/
│   ├── index.ts          # version export
│   ├── bin.ts            # shebang entry
│   ├── cli.ts            # commander root + convert handler
│   ├── log.ts            # 5-line stderr logger
│   ├── walk.ts           # iterHtmlFiles
│   ├── convert.ts        # convertHtml: cheerio + kreuzberg
│   ├── title.ts          # extractTitle
│   ├── links.ts          # rewriteInternalLinks
│   ├── output.ts         # buildOutput, detectCollisions, writeOutput, writeReportJson
│   └── openapi/
│       ├── cli.ts
│       ├── loader.ts
│       ├── iter.ts
│       ├── refs.ts
│       ├── paths.ts
│       └── render.ts
└── tests/
    ├── fixtures/          (carry over)
    ├── expected/          (regenerated in Wave 2)
    ├── walk.test.ts
    ├── convert.test.ts
    ├── title.test.ts
    ├── links.test.ts
    ├── output.test.ts
    ├── log.test.ts
    ├── cli.test.ts
    └── openapi/
        ├── fixtures/petstore-mini.json
        ├── loader.test.ts
        ├── iter.test.ts
        ├── refs.test.ts
        ├── paths.test.ts
        ├── render.test.ts
        └── cli.test.ts
```

The Python `src/docforge/`, Python `tests/*.py`, `pyproject.toml`, and `uv.lock` are deleted in Wave 6.

---

## Wave 0 — Scaffold

### Task 0.0: Create the rewrite branch

**Files:**
- Modify: git ref

- [ ] **Step 1: Create and check out the rewrite branch**

```bash
git checkout -b ts-rewrite
git status
```

Expected: branch `ts-rewrite` checked out, working tree carries the existing untracked files but no Python source modified yet.

---

### Task 0.1: Add Node project skeleton

**Files:**
- Create: `package.json`
- Create: `tsconfig.json`
- Create: `vitest.config.ts`
- Modify: `.gitignore`

- [ ] **Step 1: Write `package.json`**

```json
{
  "name": "docforge",
  "version": "0.4.0",
  "description": "Convert documentation sources to Markdown for RAG ingestion.",
  "type": "module",
  "license": "MIT",
  "bin": { "docforge": "dist/bin.js" },
  "scripts": {
    "build": "tsc",
    "dev": "tsx src/bin.ts",
    "test": "vitest run",
    "test:watch": "vitest",
    "typecheck": "tsc --noEmit"
  },
  "dependencies": {
    "@kreuzberg/node": "^4",
    "cheerio": "^1",
    "commander": "^13",
    "js-yaml": "^4"
  },
  "devDependencies": {
    "@types/js-yaml": "^4",
    "@types/node": "^22",
    "tsx": "^4",
    "typescript": "^5.7",
    "vitest": "^2"
  },
  "engines": { "node": ">=20" }
}
```

- [ ] **Step 2: Write `tsconfig.json`**

```json
{
  "compilerOptions": {
    "target": "ES2022",
    "module": "NodeNext",
    "moduleResolution": "NodeNext",
    "outDir": "dist",
    "rootDir": "src",
    "strict": true,
    "noUncheckedIndexedAccess": true,
    "noImplicitOverride": true,
    "exactOptionalPropertyTypes": true,
    "verbatimModuleSyntax": true,
    "esModuleInterop": true,
    "skipLibCheck": true,
    "declaration": false,
    "sourceMap": false,
    "resolveJsonModule": true
  },
  "include": ["src/**/*.ts"],
  "exclude": ["node_modules", "dist", "tests"]
}
```

- [ ] **Step 3: Write `vitest.config.ts`**

```ts
import { defineConfig } from "vitest/config";

export default defineConfig({
  test: {
    globals: false,
    include: ["tests/**/*.test.ts"],
    reporters: ["default"],
  },
});
```

- [ ] **Step 4: Append Node ignores to `.gitignore`**

Read the current `.gitignore` first, then append:

```
node_modules/
dist/
.vitest/
*.tsbuildinfo
```

- [ ] **Step 5: Install dependencies**

Run: `npm install`
Expected: `node_modules/` populated, `package-lock.json` generated, no errors.

- [ ] **Step 6: Commit**

```bash
git add package.json package-lock.json tsconfig.json vitest.config.ts .gitignore
git commit -m "chore(ts): scaffold node + typescript project (ts-rewrite)"
```

---

### Task 0.2: Add version export and --version smoke

**Files:**
- Create: `src/index.ts`
- Create: `src/bin.ts`
- Create: `src/cli.ts`
- Create: `src/log.ts`
- Create: `tests/version.test.ts`

- [ ] **Step 1: Write the failing test**

`tests/version.test.ts`:

```ts
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
```

- [ ] **Step 2: Run the test to verify it fails**

Run: `npm test -- version`
Expected: FAIL — `Cannot find module '../src/index.js'`.

- [ ] **Step 3: Write `src/index.ts`**

```ts
export const VERSION = "0.4.0";
```

- [ ] **Step 4: Run the test to verify it passes**

Run: `npm test -- version`
Expected: PASS (both tests).

- [ ] **Step 5: Write `src/log.ts`**

```ts
export type Level = "debug" | "info" | "warn" | "error";

const LEVEL_RANK: Record<Level, number> = {
  debug: 0,
  info: 1,
  warn: 2,
  error: 3,
};

let _minLevel: Level = "info";

export function setLevel(level: Level): void {
  _minLevel = level;
}

export function log(level: Level, msg: string, ...args: unknown[]): void {
  if (LEVEL_RANK[level] < LEVEL_RANK[_minLevel]) return;
  console.error(`${level.toUpperCase()} ${msg}`, ...args);
}
```

- [ ] **Step 6: Write `src/cli.ts` (skeleton with `--version` only)**

```ts
import { Command } from "commander";
import { VERSION } from "./index.js";
import { setLevel } from "./log.js";

export function buildProgram(): Command {
  const program = new Command();
  program
    .name("docforge")
    .description("Convert documentation sources to Markdown for RAG ingestion.")
    .version(VERSION, "--version", "print version and exit")
    .option("-v, --verbose", "DEBUG-level logging")
    .option("-q, --quiet", "WARNING-level logging")
    .hook("preAction", (thisCommand) => {
      const opts = thisCommand.opts<{ verbose?: boolean; quiet?: boolean }>();
      if (opts.verbose) setLevel("debug");
      else if (opts.quiet) setLevel("warn");
    });
  return program;
}

export async function main(argv: string[]): Promise<number> {
  const program = buildProgram();
  await program.parseAsync(argv, { from: "user" });
  return 0;
}
```

- [ ] **Step 7: Write `src/bin.ts`**

```ts
#!/usr/bin/env node
import { main } from "./cli.js";

main(process.argv.slice(2)).then(
  (code) => process.exit(code),
  (err) => {
    console.error("FATAL", err instanceof Error ? err.stack ?? err.message : err);
    process.exit(2);
  },
);
```

- [ ] **Step 8: Smoke `--version` via tsx**

Run: `npx tsx src/bin.ts --version`
Expected: prints `0.4.0` and exits 0.

- [ ] **Step 9: Commit**

```bash
git add src/ tests/version.test.ts
git commit -m "feat(ts): add version export, log helper, and cli skeleton"
```

---

## Wave 1 — Pure Helpers

### Task 1.1: `links.ts`

**Files:**
- Create: `src/links.ts`
- Create: `tests/links.test.ts`

- [ ] **Step 1: Write the failing tests**

`tests/links.test.ts`:

```ts
import { describe, expect, test } from "vitest";
import { rewriteInternalLinks } from "../src/links.js";

describe("rewriteInternalLinks", () => {
  test("simple relative link rewritten", () => {
    expect(rewriteInternalLinks("[Other](other.html)")).toBe("[Other](other.md)");
  });

  test("relative link with anchor preserved", () => {
    expect(rewriteInternalLinks("[Section](page.html#intro)")).toBe(
      "[Section](page.md#intro)",
    );
  });

  test("relative subdir link rewritten", () => {
    expect(rewriteInternalLinks("[Sub](dir/sub/page.html)")).toBe(
      "[Sub](dir/sub/page.md)",
    );
  });

  test("https link untouched", () => {
    const md = "[Ext](https://example.com/page.html)";
    expect(rewriteInternalLinks(md)).toBe(md);
  });

  test("http link untouched", () => {
    const md = "[Ext](http://example.com/page.html)";
    expect(rewriteInternalLinks(md)).toBe(md);
  });

  test("mailto link untouched", () => {
    const md = "[Email](mailto:foo@bar.html)";
    expect(rewriteInternalLinks(md)).toBe(md);
  });

  test("anchor-only link untouched", () => {
    expect(rewriteInternalLinks("[Anchor](#intro)")).toBe("[Anchor](#intro)");
  });

  test("non-html extension untouched", () => {
    expect(rewriteInternalLinks("[Pic](image.png)")).toBe("[Pic](image.png)");
  });

  test("multiple links in one string", () => {
    const md = "See [A](a.html) and [B](b.html#x) and [C](https://c.com/c.html).";
    expect(rewriteInternalLinks(md)).toBe(
      "See [A](a.md) and [B](b.md#x) and [C](https://c.com/c.html).",
    );
  });

  test("empty string returns empty", () => {
    expect(rewriteInternalLinks("")).toBe("");
  });

  test("autolink relative html rewritten", () => {
    expect(rewriteInternalLinks("See <other.html> for details.")).toBe(
      "See <other.md> for details.",
    );
  });

  test("autolink relative html with anchor rewritten", () => {
    expect(rewriteInternalLinks("See <page.html#intro> for details.")).toBe(
      "See <page.md#intro> for details.",
    );
  });

  test("autolink external https untouched", () => {
    const md = "See <https://example.com/page.html>.";
    expect(rewriteInternalLinks(md)).toBe(md);
  });

  test("autolink external http untouched", () => {
    const md = "See <http://example.com/page.html>.";
    expect(rewriteInternalLinks(md)).toBe(md);
  });

  test("autolink subdir rewritten", () => {
    expect(rewriteInternalLinks("<dir/sub/page.html>")).toBe("<dir/sub/page.md>");
  });

  test("protocol-relative md link untouched", () => {
    const md = "[CDN](//cdn.example.com/page.html)";
    expect(rewriteInternalLinks(md)).toBe(md);
  });

  test("protocol-relative autolink untouched", () => {
    const md = "<//cdn.example.com/page.html>";
    expect(rewriteInternalLinks(md)).toBe(md);
  });
});
```

- [ ] **Step 2: Run tests to verify they fail**

Run: `npm test -- links`
Expected: FAIL — module not found.

- [ ] **Step 3: Write `src/links.ts`**

```ts
const MD_LINK_RE = /\]\((?!https?:\/\/|\/\/|mailto:|#)([^)\s]+?)\.html(#[^)\s]*)?\)/g;
const AUTOLINK_RE = /<(?!https?:\/\/|\/\/|mailto:)([^>\s]+?)\.html(#[^>\s]*)?>/g;

export function rewriteInternalLinks(md: string): string {
  return md
    .replace(MD_LINK_RE, (_match, p1: string, p2?: string) => `](${p1}.md${p2 ?? ""})`)
    .replace(AUTOLINK_RE, (_match, p1: string, p2?: string) => `<${p1}.md${p2 ?? ""}>`);
}
```

- [ ] **Step 4: Run tests to verify they pass**

Run: `npm test -- links`
Expected: PASS (17 tests).

- [ ] **Step 5: Commit**

```bash
git add src/links.ts tests/links.test.ts
git commit -m "feat(ts): port links.rewriteInternalLinks with full test parity"
```

---

### Task 1.2: `title.ts`

**Files:**
- Create: `src/title.ts`
- Create: `tests/title.test.ts`

- [ ] **Step 1: Write the failing tests**

`tests/title.test.ts`:

```ts
import { describe, expect, test } from "vitest";
import { extractTitle } from "../src/title.js";

describe("extractTitle", () => {
  test("h1 takes priority", () => {
    expect(extractTitle("Body Heading", "Page Title", "stem")).toBe("Body Heading");
  });

  test("soup title when no h1", () => {
    expect(extractTitle(null, "Page Title", "stem")).toBe("Page Title");
  });

  test("stem when no h1 and no title", () => {
    expect(extractTitle(null, null, "stem")).toBe("stem");
  });

  test("empty h1 falls through", () => {
    expect(extractTitle("", "Page Title", "stem")).toBe("Page Title");
  });

  test("empty soup title falls through to stem", () => {
    expect(extractTitle(null, "", "stem")).toBe("stem");
  });

  test("whitespace-only h1 falls through", () => {
    expect(extractTitle("   ", "Page Title", "stem")).toBe("Page Title");
  });
});
```

- [ ] **Step 2: Run tests to verify they fail**

Run: `npm test -- title`
Expected: FAIL — module not found.

- [ ] **Step 3: Write `src/title.ts`**

```ts
export function extractTitle(
  h1Text: string | null,
  soupTitleText: string | null,
  fallbackStem: string,
): string {
  if (h1Text && h1Text.trim()) return h1Text.trim();
  if (soupTitleText && soupTitleText.trim()) return soupTitleText.trim();
  return fallbackStem;
}
```

- [ ] **Step 4: Run tests to verify they pass**

Run: `npm test -- title`
Expected: PASS (6 tests).

- [ ] **Step 5: Commit**

```bash
git add src/title.ts tests/title.test.ts
git commit -m "feat(ts): port title.extractTitle"
```

---

### Task 1.3: `walk.ts`

**Files:**
- Create: `src/walk.ts`
- Create: `tests/walk.test.ts`

The walker is the first module that touches `node:fs` directly. Note the new `WalkResult` shape — it includes `skippedCount` to fix the lying counter from the Python `cli.py:126` TODO.

- [ ] **Step 1: Write the failing tests**

`tests/walk.test.ts`:

```ts
import { afterEach, beforeEach, describe, expect, test } from "vitest";
import { mkdtempSync, mkdirSync, writeFileSync, symlinkSync, rmSync } from "node:fs";
import { tmpdir } from "node:os";
import { join, relative, sep } from "node:path";
import { iterHtmlFiles } from "../src/walk.js";

let tmp: string;

beforeEach(() => {
  tmp = mkdtempSync(join(tmpdir(), "docforge-walk-"));
});
afterEach(() => {
  rmSync(tmp, { recursive: true, force: true });
});

function touch(p: string, content = ""): string {
  const dir = p.split(sep).slice(0, -1).join(sep);
  if (dir) mkdirSync(dir, { recursive: true });
  writeFileSync(p, content);
  return p;
}

function names(paths: string[]): string[] {
  return paths.map((p) => p.split(sep).at(-1)!).sort();
}

function rels(paths: string[], root: string): string[] {
  return paths.map((p) => relative(root, p).split(sep).join("/")).sort();
}

describe("iterHtmlFiles", () => {
  test("finds single html file when source is a file", () => {
    const f = touch(join(tmp, "a.html"));
    const r = iterHtmlFiles(f, 10_000);
    expect(r.paths).toEqual([f]);
    expect(r.skippedCount).toBe(0);
  });

  test("skips non-html extensions", () => {
    touch(join(tmp, "a.html"));
    touch(join(tmp, "b.css"));
    touch(join(tmp, "c.js"));
    touch(join(tmp, "d.png"));
    touch(join(tmp, "e.txt"));
    const r = iterHtmlFiles(tmp, 10_000);
    expect(names(r.paths)).toEqual(["a.html"]);
    expect(r.skippedCount).toBe(4);
  });

  test("includes .htm extension", () => {
    touch(join(tmp, "a.htm"));
    expect(names(iterHtmlFiles(tmp, 10_000).paths)).toEqual(["a.htm"]);
  });

  test("skips named files", () => {
    touch(join(tmp, "page.html"));
    touch(join(tmp, "genindex.html"));
    touch(join(tmp, "search.html"));
    const r = iterHtmlFiles(tmp, 10_000);
    expect(names(r.paths)).toEqual(["page.html"]);
    expect(r.skippedCount).toBe(2);
  });

  test("skips _static and _downloads dirs", () => {
    touch(join(tmp, "page.html"));
    touch(join(tmp, "_static", "asset.html"));
    touch(join(tmp, "_downloads", "dl.html"));
    expect(names(iterHtmlFiles(tmp, 10_000).paths)).toEqual(["page.html"]);
  });

  test("skips dot-dirs", () => {
    touch(join(tmp, "page.html"));
    touch(join(tmp, ".git", "hidden.html"));
    touch(join(tmp, ".venv", "lib.html"));
    touch(join(tmp, ".tox", "x.html"));
    expect(names(iterHtmlFiles(tmp, 10_000).paths)).toEqual(["page.html"]);
  });

  test("skips node_modules / __pycache__ / dist / build", () => {
    touch(join(tmp, "page.html"));
    touch(join(tmp, "node_modules", "x.html"));
    touch(join(tmp, "__pycache__", "x.html"));
    touch(join(tmp, "dist", "x.html"));
    touch(join(tmp, "build", "x.html"));
    expect(names(iterHtmlFiles(tmp, 10_000).paths)).toEqual(["page.html"]);
  });

  test("recursive walk yields nested paths", () => {
    touch(join(tmp, "top.html"));
    touch(join(tmp, "sub", "mid.html"));
    touch(join(tmp, "sub", "deeper", "leaf.html"));
    expect(rels(iterHtmlFiles(tmp, 10_000).paths, tmp)).toEqual([
      "sub/deeper/leaf.html",
      "sub/mid.html",
      "top.html",
    ]);
  });

  test("sorted iteration within a directory", () => {
    touch(join(tmp, "c.html"));
    touch(join(tmp, "a.html"));
    touch(join(tmp, "b.html"));
    const paths = iterHtmlFiles(tmp, 10_000).paths;
    expect(paths.map((p) => p.split(sep).at(-1))).toEqual([
      "a.html",
      "b.html",
      "c.html",
    ]);
  });

  test("does not follow symlinks (file)", () => {
    const real = touch(join(tmp, "real.html"));
    symlinkSync(real, join(tmp, "link.html"));
    expect(names(iterHtmlFiles(tmp, 10_000).paths)).toEqual(["real.html"]);
  });

  test("does not follow symlinks (dir)", () => {
    const realDir = join(tmp, "real");
    touch(join(realDir, "inside.html"));
    symlinkSync(realDir, join(tmp, "link_dir"), "dir");
    expect(rels(iterHtmlFiles(tmp, 10_000).paths, tmp)).toEqual(["real/inside.html"]);
  });

  test("skips files above maxBytes and counts them as skipped", () => {
    touch(join(tmp, "big.html"), "x".repeat(5000));
    touch(join(tmp, "small.html"), "ok");
    const r = iterHtmlFiles(tmp, 1000);
    expect(names(r.paths)).toEqual(["small.html"]);
    expect(r.skippedCount).toBe(1);
  });
});
```

- [ ] **Step 2: Run tests to verify they fail**

Run: `npm test -- walk`
Expected: FAIL — module not found.

- [ ] **Step 3: Write `src/walk.ts`**

```ts
import { lstatSync, readdirSync, statSync } from "node:fs";
import { extname, join } from "node:path";
import { log } from "./log.js";

const SKIP_DIRS = new Set([
  "_static", "_downloads", ".git", ".venv", "node_modules",
  ".tox", "__pycache__", "dist", "build",
]);
const SKIP_FILES = new Set(["genindex.html", "search.html", "robots.txt", "rss.xml"]);
const SKIP_EXT = new Set([
  ".css", ".js", ".xml", ".xsd", ".txt",
  ".eot", ".ttf", ".woff", ".woff2",
  ".png", ".jpg", ".jpeg", ".ico",
]);
const HTML_EXT = new Set([".html", ".htm"]);

export interface WalkResult {
  paths: string[];
  skippedCount: number;
}

export function iterHtmlFiles(source: string, maxBytes: number): WalkResult {
  const result: WalkResult = { paths: [], skippedCount: 0 };

  let st;
  try {
    st = lstatSync(source);
  } catch {
    return result;
  }
  if (st.isSymbolicLink()) return result;

  if (st.isFile()) {
    if (passesFileFilters(source, maxBytes, result)) result.paths.push(source);
    return result;
  }
  if (st.isDirectory()) {
    walkDir(source, maxBytes, result);
  }
  return result;
}

function walkDir(dir: string, maxBytes: number, result: WalkResult): void {
  let entries;
  try {
    entries = readdirSync(dir, { withFileTypes: true });
  } catch {
    return;
  }
  entries.sort((a, b) => (a.name < b.name ? -1 : a.name > b.name ? 1 : 0));

  for (const entry of entries) {
    const full = join(dir, entry.name);
    if (entry.isSymbolicLink()) continue;
    if (entry.isDirectory()) {
      if (SKIP_DIRS.has(entry.name) || entry.name.startsWith(".")) continue;
      walkDir(full, maxBytes, result);
    } else if (entry.isFile()) {
      if (passesFileFilters(full, maxBytes, result)) result.paths.push(full);
    }
  }
}

function passesFileFilters(
  path: string,
  maxBytes: number,
  result: WalkResult,
): boolean {
  const name = path.split(/[\\/]/).at(-1)!;
  if (SKIP_FILES.has(name)) {
    result.skippedCount += 1;
    return false;
  }
  const suffix = extname(name).toLowerCase();
  if (SKIP_EXT.has(suffix)) {
    result.skippedCount += 1;
    return false;
  }
  if (!HTML_EXT.has(suffix)) {
    result.skippedCount += 1;
    return false;
  }
  let size: number;
  try {
    size = statSync(path).size;
  } catch {
    result.skippedCount += 1;
    return false;
  }
  if (size > maxBytes) {
    log("warn", `large-file skipped: ${path} (${size} bytes > ${maxBytes})`);
    result.skippedCount += 1;
    return false;
  }
  return true;
}
```

- [ ] **Step 4: Run tests to verify they pass**

Run: `npm test -- walk`
Expected: PASS (12 tests).

- [ ] **Step 5: Commit**

```bash
git add src/walk.ts tests/walk.test.ts
git commit -m "feat(ts): port walk.iterHtmlFiles with skippedCount"
```

---

## Wave 2 — Convert + Goldens

### Task 2.1: Carry over fixtures

**Files:**
- Copy: `tests/fixtures/*.html` (already present in the repo from the Python tool)
- Verify only — no modification

- [ ] **Step 1: Confirm fixtures already exist**

Run: `ls tests/fixtures/`
Expected: lists `generic-no-articleBody.html`, `non-utf8.html`, `sphinx-empty-body.html`, `sphinx-guide.html`, `sphinx-highlight-default.html`, `sphinx-internal-link.html`, `sphinx-method.html`, `sphinx-proto-blockquote.html`, `sphinx-proto.html`.

If any are missing, restore from git: `git checkout HEAD -- tests/fixtures/`.

No commit yet — this is a verify-only step.

---

### Task 2.2: `convert.ts` core (body select + strip + result type)

**Files:**
- Create: `src/convert.ts`
- Create: `tests/convert.test.ts`

This task lands the cheerio body-selection chain, the noise-strip, and the discriminated-union result type. Kreuzberg integration ships in Task 2.3.

- [ ] **Step 1: Write the failing tests**

`tests/convert.test.ts`:

```ts
import { describe, expect, test, vi } from "vitest";
import { load } from "cheerio";
import {
  convertHtml,
  __testing__,
  type ConvertResult,
} from "../src/convert.js";

const { selectBody, stripSphinxNoise, h1Text, soupTitleText } = __testing__;

describe("selectBody", () => {
  test("finds articleBody directly", () => {
    const $ = load(
      '<html><body><div itemprop="articleBody"><h1>X</h1></div></body></html>',
    );
    const body = selectBody($);
    expect(body).not.toBeNull();
    expect(body!.find("h1").text()).toBe("X");
  });

  test("finds articleBody inside role=main", () => {
    const $ = load(
      '<html><body><div role="main">' +
        '<div itemprop="articleBody"><h1>Y</h1></div>' +
        "</div></body></html>",
    );
    const body = selectBody($);
    expect(body).not.toBeNull();
    expect(body!.find("h1").text()).toBe("Y");
  });

  test("returns role=main when no articleBody", () => {
    const $ = load('<html><body><div role="main"><h1>Z</h1></div></body></html>');
    const body = selectBody($);
    expect(body).not.toBeNull();
    expect(body!.find("h1").text()).toBe("Z");
  });

  test("returns null when neither present", () => {
    const $ = load("<html><body><main><h1>Q</h1></main></body></html>");
    expect(selectBody($)).toBeNull();
  });
});

describe("stripSphinxNoise", () => {
  test("removes a.headerlink", () => {
    const $ = load(
      '<div><h1>Title<a class="headerlink" href="#title">¶</a></h1></div>',
    );
    const body = $("div").first();
    stripSphinxNoise(body);
    expect(body.find("a.headerlink").length).toBe(0);
    expect(body.find("h1").text()).toBe("Title");
  });

  test("removes a.viewcode-link", () => {
    const $ = load(
      '<div><h1>X</h1><a class="viewcode-link">[source]</a></div>',
    );
    const body = $("div").first();
    stripSphinxNoise(body);
    expect(body.find("a.viewcode-link").length).toBe(0);
  });

  test("leaves normal anchors alone", () => {
    const $ = load('<div><a href="other.html">Other</a></div>');
    const body = $("div").first();
    stripSphinxNoise(body);
    expect(body.find("a").length).toBe(1);
    expect(body.find("a").text()).toBe("Other");
  });
});

describe("h1Text + soupTitleText", () => {
  test("h1Text strips trailing pilcrow", () => {
    const $ = load("<div><h1>Heading¶</h1></div>");
    expect(h1Text($("div").first())).toBe("Heading");
  });

  test("h1Text returns null when missing", () => {
    const $ = load("<div><p>no h1</p></div>");
    expect(h1Text($("div").first())).toBeNull();
  });

  test("soupTitleText returns inner text", () => {
    const $ = load("<html><head><title>Page Title</title></head></html>");
    expect(soupTitleText($)).toBe("Page Title");
  });

  test("soupTitleText returns null when missing", () => {
    const $ = load("<html><head></head></html>");
    expect(soupTitleText($)).toBeNull();
  });

  test("soupTitleText returns null when blank", () => {
    const $ = load("<html><head><title>   </title></head></html>");
    expect(soupTitleText($)).toBeNull();
  });
});

describe("convertHtml result type", () => {
  test("returns empty when no body marker", () => {
    const r = convertHtml("<html><body><main><h1>X</h1></main></body></html>");
    expect(r.status).toBe("empty");
  });

  test("returns failed when kreuzberg throws", async () => {
    vi.doMock("@kreuzberg/node", () => ({
      extractBytesSync: () => {
        throw new Error("kreuzberg blew up");
      },
    }));
    vi.resetModules();
    const mod = await import("../src/convert.js");
    const r = mod.convertHtml(
      '<html><body><div itemprop="articleBody"><h1>X</h1></div></body></html>',
    );
    expect(r.status).toBe("failed");
    if (r.status === "failed") expect(r.error).toMatch(/kreuzberg/);
    vi.doUnmock("@kreuzberg/node");
    vi.resetModules();
  });
});
```

- [ ] **Step 2: Run tests to verify they fail**

Run: `npm test -- convert`
Expected: FAIL — module not found.

- [ ] **Step 3: Write `src/convert.ts`**

```ts
import { type CheerioAPI, type Cheerio, load } from "cheerio";
import type { Element } from "domhandler";
import { extractBytesSync, type ExtractionConfig } from "@kreuzberg/node";

const KZ_CONFIG: ExtractionConfig = {
  useCache: false,
  outputFormat: "markdown",
};

export type ConvertResult =
  | {
      status: "ok";
      body_md: string;
      h1_text: string | null;
      soup_title_text: string | null;
    }
  | { status: "empty" }
  | { status: "failed"; error: string };

function selectBody($: CheerioAPI): Cheerio<Element> | null {
  const direct = $('div[itemprop="articleBody"]').first();
  if (direct.length > 0) return direct;

  const main = $('div[role="main"]').first();
  if (main.length === 0) return null;

  const inner = main.find('div[itemprop="articleBody"]').first();
  return inner.length > 0 ? inner : main;
}

function stripSphinxNoise(body: Cheerio<Element>): void {
  body.find("a.headerlink").remove();
  body.find("a.viewcode-link").remove();
}

function h1Text(body: Cheerio<Element>): string | null {
  const h1 = body.find("h1").first();
  if (h1.length === 0) return null;
  const text = h1.text().trim().replace(/¶+$/, "").trim();
  return text || null;
}

function soupTitleText($: CheerioAPI): string | null {
  const t = $("title").first();
  if (t.length === 0) return null;
  const text = t.text().trim();
  return text || null;
}

export function convertHtml(rawHtml: string): ConvertResult {
  try {
    const $ = load(rawHtml, { xml: false });
    const body = selectBody($);
    if (body === null) return { status: "empty" };

    const h1 = h1Text(body);
    const title = soupTitleText($);
    stripSphinxNoise(body);

    const serialized = $.html(body);
    const result = extractBytesSync(
      Buffer.from(serialized, "utf8"),
      "text/html",
      KZ_CONFIG,
    );
    return {
      status: "ok",
      body_md: result.content.trim(),
      h1_text: h1,
      soup_title_text: title,
    };
  } catch (e) {
    const err = e instanceof Error ? `${e.name}: ${e.message}` : String(e);
    return { status: "failed", error: err };
  }
}

export const __testing__ = {
  selectBody,
  stripSphinxNoise,
  h1Text,
  soupTitleText,
};
```

- [ ] **Step 4: Run tests to verify they pass**

Run: `npm test -- convert`
Expected: PASS (12 tests). If a cheerio API import fails, run `npm view cheerio versions --json | tail -10` to confirm v1 is installed; the v1 API uses default-export `load` plus type re-exports as shown.

- [ ] **Step 5: Commit**

```bash
git add src/convert.ts tests/convert.test.ts
git commit -m "feat(ts): port convert core (cheerio body select + strip + result union)"
```

---

### Task 2.3: Golden-file tests + regenerate goldens once

**Files:**
- Modify: `tests/convert.test.ts` (append golden cases)
- Modify: `tests/expected/*.md` (regenerate against TS output, commit)

The original goldens were captured against Python+kreuzberg output. The Node binding shares the Rust core but may emit subtly different markdown (entity decoding, whitespace, autolink form). We regenerate once, eyeball the diff, then lock.

- [ ] **Step 1: Append golden cases to `tests/convert.test.ts`**

Insert the following block at the end of `tests/convert.test.ts`:

```ts
import { readFileSync } from "node:fs";
import { join } from "node:path";

const FIXTURES = "tests/fixtures";
const EXPECTED = "tests/expected";

const GOLDEN_CASES = [
  "sphinx-method",
  "sphinx-proto",
  "sphinx-proto-blockquote",
  "sphinx-guide",
  "sphinx-internal-link",
  "sphinx-highlight-default",
];

const EMPTY_CASES = ["sphinx-empty-body", "generic-no-articleBody"];

describe("golden files", () => {
  for (const name of GOLDEN_CASES) {
    test(`golden: ${name}`, () => {
      const raw = readFileSync(join(FIXTURES, `${name}.html`), "utf8");
      const r = convertHtml(raw);
      expect(r.status).toBe("ok");
      if (r.status === "ok") {
        const expected = readFileSync(join(EXPECTED, `${name}.md`), "utf8");
        expect(r.body_md.trim()).toBe(expected.trim());
      }
    });
  }
});

describe("empty classification", () => {
  for (const name of EMPTY_CASES) {
    test(`empty: ${name}`, () => {
      const raw = readFileSync(join(FIXTURES, `${name}.html`), "utf8");
      const r = convertHtml(raw);
      expect(r.status).toBe("empty");
    });
  }
});

describe("non-utf8 fixture", () => {
  test("does not crash and converts via replacement", () => {
    const buf = readFileSync(join(FIXTURES, "non-utf8.html"));
    const raw = buf.toString("utf8"); // Node default replaces invalid bytes
    const r = convertHtml(raw);
    expect(r.status).toBe("ok");
    if (r.status === "ok") expect(r.h1_text).toBe("Bad");
  });
});
```

- [ ] **Step 2: Run goldens to see expected drift**

Run: `npm test -- convert -- --reporter=verbose`
Expected: 6 golden-case tests likely FAIL with whitespace/encoding diff; 2 empty-classification tests PASS; 1 non-utf8 test PASS.

If goldens unexpectedly all PASS, skip Step 3 and go straight to Step 4 (commit).

- [ ] **Step 3: Regenerate goldens against TS output**

Write a one-shot script `scripts/regen-goldens.ts`:

```ts
import { readFileSync, writeFileSync } from "node:fs";
import { join } from "node:path";
import { convertHtml } from "../src/convert.js";

const cases = [
  "sphinx-method",
  "sphinx-proto",
  "sphinx-proto-blockquote",
  "sphinx-guide",
  "sphinx-internal-link",
  "sphinx-highlight-default",
];

for (const name of cases) {
  const raw = readFileSync(join("tests/fixtures", `${name}.html`), "utf8");
  const r = convertHtml(raw);
  if (r.status !== "ok") {
    throw new Error(`${name}: status=${r.status}`);
  }
  const out = join("tests/expected", `${name}.md`);
  writeFileSync(out, r.body_md.trim() + "\n", "utf8");
  console.log(`wrote ${out} (${r.body_md.length} chars)`);
}
```

Run: `npx tsx scripts/regen-goldens.ts`
Expected: prints 6 lines, one per case, each writing its `.md` file.

Run: `git diff tests/expected/`
Expected: shows the drift between Python-binding and Node-binding output. Eyeball each diff:
- Whitespace, blank-line counts, escape rules: acceptable
- Missing tables, dropped list items, dropped paragraphs: NOT acceptable — investigate before committing

- [ ] **Step 4: Run tests to verify goldens now pass**

Run: `npm test -- convert`
Expected: PASS (all golden, empty, non-utf8 cases).

- [ ] **Step 5: Commit**

```bash
git add tests/convert.test.ts tests/expected/ scripts/regen-goldens.ts
git commit -m "test(ts): regenerate goldens against @kreuzberg/node output"
```

---

## Wave 3 — Output, CLI Convert, E2E

### Task 3.1: `output.ts` — buildOutput + writeOutput

**Files:**
- Create: `src/output.ts` (initial)
- Create: `tests/output.test.ts` (initial)

- [ ] **Step 1: Write the failing tests**

`tests/output.test.ts`:

```ts
import { afterEach, beforeEach, describe, expect, test } from "vitest";
import { mkdtempSync, readFileSync, rmSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { buildOutput, writeOutput } from "../src/output.js";

let tmp: string;
beforeEach(() => {
  tmp = mkdtempSync(join(tmpdir(), "docforge-out-"));
});
afterEach(() => {
  rmSync(tmp, { recursive: true, force: true });
});

describe("buildOutput", () => {
  test("basic shape", () => {
    expect(buildOutput("My Title", "dir/page.html", "Body content here.")).toBe(
      "# My Title\n\nSource: dir/page.html\n\nBody content here.\n",
    );
  });

  test("strips trailing whitespace in body", () => {
    expect(buildOutput("T", "p.html", "  Body.  \n\n  ")).toBe(
      "# T\n\nSource: p.html\n\nBody.\n",
    );
  });

  test("keeps internal blank lines", () => {
    const out = buildOutput("T", "p.html", "Para 1.\n\nPara 2.");
    expect(out.includes("Para 1.\n\nPara 2.")).toBe(true);
  });

  test("handles unicode title", () => {
    const out = buildOutput("Заголовок", "ru.html", "Текст");
    expect(out.startsWith("# Заголовок\n")).toBe(true);
  });
});

describe("writeOutput", () => {
  test("creates parent dirs", () => {
    const out = join(tmp, "deep", "nested", "file.md");
    writeOutput(out, "content");
    expect(readFileSync(out, "utf8")).toBe("content");
  });

  test("overwrites existing", () => {
    const out = join(tmp, "file.md");
    writeFileSync(out, "old");
    writeOutput(out, "new");
    expect(readFileSync(out, "utf8")).toBe("new");
  });
});
```

- [ ] **Step 2: Run tests to verify they fail**

Run: `npm test -- output`
Expected: FAIL — module not found.

- [ ] **Step 3: Write `src/output.ts` (initial)**

```ts
import { mkdirSync, writeFileSync } from "node:fs";
import { dirname } from "node:path";

export function buildOutput(
  title: string,
  sourceRelpath: string,
  bodyMd: string,
): string {
  return `# ${title}\n\nSource: ${sourceRelpath}\n\n${bodyMd.trim()}\n`;
}

export function writeOutput(outPath: string, content: string): void {
  mkdirSync(dirname(outPath), { recursive: true });
  writeFileSync(outPath, content, "utf8");
}
```

- [ ] **Step 4: Run tests to verify they pass**

Run: `npm test -- output`
Expected: PASS (6 tests).

- [ ] **Step 5: Commit**

```bash
git add src/output.ts tests/output.test.ts
git commit -m "feat(ts): port output.buildOutput + writeOutput"
```

---

### Task 3.2: `output.ts` — detectCollisions

**Files:**
- Modify: `src/output.ts` (append)
- Modify: `tests/output.test.ts` (append)

- [ ] **Step 1: Append failing tests**

Append to `tests/output.test.ts`:

```ts
import { detectCollisions, CollisionError } from "../src/output.js";

describe("detectCollisions", () => {
  test("returns mapping when unique", () => {
    const a = "/src/a.html";
    const b = "/src/sub/b.html";
    const m = detectCollisions([a, b], "/src", "/out");
    expect(m.get(a)).toBe("/out/a.md");
    expect(m.get(b)).toBe("/out/sub/b.md");
  });

  test("throws on duplicate output (case-insensitive)", () => {
    const upper = "/src/Foo.html";
    const lower = "/src/foo.html";
    expect(() =>
      detectCollisions([upper, lower], "/src", "/out", { caseInsensitive: true }),
    ).toThrow(CollisionError);
  });

  test("collision message lists all colliding inputs", () => {
    try {
      detectCollisions(
        ["/src/Foo.html", "/src/foo.html"],
        "/src",
        "/out",
        { caseInsensitive: true },
      );
      throw new Error("expected throw");
    } catch (e) {
      expect(e).toBeInstanceOf(CollisionError);
      const msg = (e as Error).message;
      expect(msg).toContain("Foo.html");
      expect(msg).toContain("foo.html");
    }
  });

  test("htm and html mapping to same md collides", () => {
    expect(() =>
      detectCollisions(["/src/page.html", "/src/page.htm"], "/src", "/out"),
    ).toThrow(CollisionError);
  });
});
```

- [ ] **Step 2: Run tests to verify they fail**

Run: `npm test -- output`
Expected: 4 new FAIL — `detectCollisions` not exported.

- [ ] **Step 3: Append `detectCollisions` to `src/output.ts`**

Append:

```ts
import { relative, join } from "node:path";

export class CollisionError extends Error {
  constructor(message: string) {
    super(message);
    this.name = "CollisionError";
  }
}

export function detectCollisions(
  inputs: string[],
  sourceRoot: string,
  outputRoot: string,
  opts?: { caseInsensitive?: boolean },
): Map<string, string> {
  const caseInsensitive = opts?.caseInsensitive ?? false;
  const mapping = new Map<string, string>();
  const inverse = new Map<string, string[]>();

  for (const inPath of inputs) {
    const rel = relative(sourceRoot, inPath);
    const outRel = rel.replace(/\.html?$/i, ".md");
    const outPath = join(outputRoot, outRel);
    mapping.set(inPath, outPath);
    const key = caseInsensitive ? outPath.toLowerCase() : outPath;
    const arr = inverse.get(key) ?? [];
    arr.push(inPath);
    inverse.set(key, arr);
  }

  const collisions: [string, string[]][] = [];
  for (const [k, sources] of inverse) {
    if (sources.length > 1) collisions.push([k, sources]);
  }

  if (collisions.length > 0) {
    const lines = ["output path collisions detected:"];
    for (const [k, sources] of collisions) {
      lines.push(`  -> ${k}`);
      for (const s of sources) lines.push(`      from ${s}`);
    }
    throw new CollisionError(lines.join("\n"));
  }

  return mapping;
}
```

- [ ] **Step 4: Run tests to verify they pass**

Run: `npm test -- output`
Expected: PASS (10 tests now).

- [ ] **Step 5: Commit**

```bash
git add src/output.ts tests/output.test.ts
git commit -m "feat(ts): port output.detectCollisions"
```

---

### Task 3.3: `output.ts` — writeReportJson

**Files:**
- Modify: `src/output.ts` (append)
- Modify: `tests/output.test.ts` (append)

- [ ] **Step 1: Append failing test**

Append to `tests/output.test.ts`:

```ts
import { writeReportJson } from "../src/output.js";

describe("writeReportJson", () => {
  test("writes per-file report as pretty json", () => {
    const out = join(tmp, "report.json");
    writeReportJson(out, [
      { input: "a.html", output: "a.md", status: "ok" },
      { input: "b.html", output: null, status: "empty" },
      { input: "c.html", output: null, status: "failed", error: "boom" },
    ]);
    const parsed = JSON.parse(readFileSync(out, "utf8"));
    expect(parsed.entries).toHaveLength(3);
    expect(parsed.entries[1].status).toBe("empty");
    expect(parsed.entries[2].error).toBe("boom");
  });
});
```

- [ ] **Step 2: Run tests to verify it fails**

Run: `npm test -- output`
Expected: 1 FAIL — `writeReportJson` not exported.

- [ ] **Step 3: Append to `src/output.ts`**

```ts
export type ReportStatus = "ok" | "empty" | "failed" | "skipped";

export interface ReportEntry {
  input: string;
  output: string | null;
  status: ReportStatus;
  error?: string;
}

export interface Report {
  entries: ReportEntry[];
}

export function writeReportJson(path: string, entries: ReportEntry[]): void {
  const report: Report = { entries };
  mkdirSync(dirname(path), { recursive: true });
  writeFileSync(path, JSON.stringify(report, null, 2), "utf8");
}
```

- [ ] **Step 4: Run tests to verify it passes**

Run: `npm test -- output`
Expected: PASS (11 tests now).

- [ ] **Step 5: Commit**

```bash
git add src/output.ts tests/output.test.ts
git commit -m "feat(ts): add output.writeReportJson"
```

---

### Task 3.4: Wire up `convert` subcommand in `cli.ts`

**Files:**
- Modify: `src/cli.ts`
- Create: `tests/cli.test.ts`

This task wires the full pipeline through commander: walk → convert → assemble → write, with `--fail-threshold`, `--max-bytes`, `--dry-run`, `--report-json`.

- [ ] **Step 1: Write the failing tests (parser-level)**

`tests/cli.test.ts`:

```ts
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
```

- [ ] **Step 2: Run tests to verify the structural ones fail**

Run: `npm test -- cli`
Expected: FAIL on `requires source` and `requires --output` (commander returns ok on the skeleton); `--version` already passes from Wave 0.

- [ ] **Step 3: Replace `src/cli.ts` with the full convert wiring**

```ts
import { Command } from "commander";
import { existsSync, lstatSync, mkdirSync, readFileSync, statSync } from "node:fs";
import { basename, dirname, extname, relative, resolve } from "node:path";

import { VERSION } from "./index.js";
import { convertHtml } from "./convert.js";
import { extractTitle } from "./title.js";
import { rewriteInternalLinks } from "./links.js";
import {
  CollisionError,
  buildOutput,
  detectCollisions,
  writeOutput,
  writeReportJson,
  type ReportEntry,
} from "./output.js";
import { iterHtmlFiles } from "./walk.js";
import { log, setLevel } from "./log.js";

export function buildProgram(): Command {
  const program = new Command();
  program
    .name("docforge")
    .description("Convert documentation sources to Markdown for RAG ingestion.")
    .version(VERSION, "--version", "print version and exit")
    .option("-v, --verbose", "DEBUG-level logging")
    .option("-q, --quiet", "WARNING-level logging")
    .hook("preAction", (thisCommand) => {
      const opts = thisCommand.opts<{ verbose?: boolean; quiet?: boolean }>();
      if (opts.verbose) setLevel("debug");
      else if (opts.quiet) setLevel("warn");
    });

  program
    .command("convert")
    .description("Convert HTML to Markdown")
    .argument("<source>", "path to HTML file or directory")
    .requiredOption("--output <dir>", "output directory (mirrors source structure)")
    .option(
      "--fail-threshold <ratio>",
      "max acceptable failure ratio before exit 1 (default 0.10; set 1.0 to disable)",
      "0.10",
    )
    .option(
      "--max-bytes <int>",
      "skip HTML files larger than N bytes (default 10MB)",
      "10485760",
    )
    .option("--dry-run", "walk + report planned outputs, write nothing", false)
    .option("--report-json <path>", "write per-file report JSON to <path>")
    .action(async (source: string, opts: ConvertOpts, cmd: Command) => {
      const code = await runConvert(source, opts);
      if (code !== 0) process.exit(code);
    });

  return program;
}

interface ConvertOpts {
  output: string;
  failThreshold: string;
  maxBytes: string;
  dryRun: boolean;
  reportJson?: string;
}

async function runConvert(sourceArg: string, opts: ConvertOpts): Promise<number> {
  const source = resolve(expandHome(sourceArg));
  const output = resolve(expandHome(opts.output));

  if (!existsSync(source)) {
    log("error", `source not found: ${source}`);
    return 2;
  }
  const st = lstatSync(source);
  if (!st.isFile() && !st.isDirectory()) {
    log("error", `source is neither file nor directory: ${source}`);
    return 2;
  }

  try {
    mkdirSync(output, { recursive: true });
  } catch (e) {
    log("error", `cannot create output dir ${output}: ${(e as Error).message}`);
    return 2;
  }

  const maxBytes = parseInt(opts.maxBytes, 10);
  const failThreshold = parseFloat(opts.failThreshold);

  const walk = iterHtmlFiles(source, maxBytes);
  if (walk.paths.length === 0) {
    log("warn", `no HTML files found under ${source}`);
    log("info", `converted=0 empty=0 skipped=${walk.skippedCount} failed=0 total=0`);
    return 0;
  }

  const sourceRoot = st.isFile() ? dirname(source) : source;

  let mapping: Map<string, string>;
  try {
    mapping = detectCollisions(walk.paths, sourceRoot, output);
  } catch (e) {
    if (e instanceof CollisionError) {
      log("error", e.message);
      return 2;
    }
    throw e;
  }

  let converted = 0;
  let empty = 0;
  let failed = 0;
  const report: ReportEntry[] = [];

  for (const inPath of walk.paths) {
    const rel = relative(sourceRoot, inPath).split(/[\\/]/).join("/");
    const outPath = mapping.get(inPath)!;

    if (opts.dryRun) {
      log("info", `DRY ${rel} -> ${outPath}`);
      continue;
    }

    let raw: string;
    try {
      raw = readFileSync(inPath).toString("utf8");
    } catch (e) {
      failed += 1;
      log("error", `FAIL read ${rel}: ${(e as Error).message}`);
      report.push({
        input: rel,
        output: null,
        status: "failed",
        error: (e as Error).message,
      });
      continue;
    }

    const result = convertHtml(raw);
    if (result.status === "empty") {
      empty += 1;
      log("debug", `empty ${rel}`);
      report.push({ input: rel, output: null, status: "empty" });
      continue;
    }
    if (result.status === "failed") {
      failed += 1;
      log("error", `FAIL ${rel}: ${result.error}`);
      report.push({
        input: rel,
        output: null,
        status: "failed",
        error: result.error,
      });
      continue;
    }

    const stem = basename(inPath, extname(inPath));
    const title = extractTitle(result.h1_text, result.soup_title_text, stem);
    const bodyMd = rewriteInternalLinks(result.body_md);
    const content = buildOutput(title, rel, bodyMd);
    writeOutput(outPath, content);
    converted += 1;
    report.push({ input: rel, output: outPath, status: "ok" });
  }

  const skipped = walk.skippedCount;
  const total = converted + empty + failed;

  if (opts.reportJson) {
    writeReportJson(resolve(expandHome(opts.reportJson)), report);
  }

  log(
    "info",
    `converted=${converted} empty=${empty} skipped=${skipped} failed=${failed} total=${total}`,
  );

  if (total > 0 && failed / total > failThreshold) {
    log(
      "error",
      `failure ratio ${(failed / total).toFixed(3)} exceeds threshold ${failThreshold.toFixed(3)}`,
    );
    return 1;
  }

  return 0;
}

function expandHome(p: string): string {
  if (p.startsWith("~/") || p === "~") {
    const home = process.env.HOME ?? process.env.USERPROFILE ?? "";
    return p.replace(/^~/, home);
  }
  return p;
}

export async function main(argv: string[]): Promise<number> {
  const program = buildProgram();
  await program.parseAsync(argv, { from: "user" });
  return 0;
}
```

- [ ] **Step 4: Run tests to verify parser-level tests pass**

Run: `npm test -- cli`
Expected: PASS for the 3 parser tests.

- [ ] **Step 5: Commit**

```bash
git add src/cli.ts tests/cli.test.ts
git commit -m "feat(ts): wire up cli convert subcommand with all flags"
```

---

### Task 3.5: CLI E2E integration test

**Files:**
- Modify: `tests/cli.test.ts` (append)

- [ ] **Step 1: Build dist so the bin entry can run**

Run: `npm run build`
Expected: writes `dist/bin.js` and other files. No TS errors.

If TS errors appear, fix them inline before continuing.

- [ ] **Step 2: Append e2e tests**

Append to `tests/cli.test.ts`. First adjust the existing top-of-file imports to also import `afterEach` and `beforeEach` from `"vitest"` so the file has a single import block. Then append the rest of the e2e block below.

```ts
// Add at the top of the file (replace the existing vitest import line):
//   import { afterEach, beforeEach, describe, expect, test } from "vitest";

import { execFileSync } from "node:child_process";
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
  try {
    const stdout = execFileSync("node", ["dist/bin.js", ...args], {
      encoding: "utf8",
      stdio: ["ignore", "pipe", "pipe"],
    });
    return { code: 0, stdout, stderr: "" };
  } catch (e: any) {
    return {
      code: e.status ?? 2,
      stdout: e.stdout?.toString() ?? "",
      stderr: e.stderr?.toString() ?? "",
    };
  }
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
```

- [ ] **Step 3: Add a `pretest` script to ensure dist is fresh**

Modify `package.json` `scripts`:

```json
"scripts": {
  "build": "tsc",
  "dev": "tsx src/bin.ts",
  "pretest": "tsc",
  "test": "vitest run",
  "test:watch": "vitest",
  "typecheck": "tsc --noEmit"
}
```

- [ ] **Step 4: Run tests**

Run: `npm test -- cli`
Expected: PASS — all e2e tests + parser tests.

- [ ] **Step 5: Commit**

```bash
git add src/cli.ts tests/cli.test.ts package.json
git commit -m "test(ts): add cli e2e integration tests"
```

---

### Task 3.6: Wave 3 — full-suite green check

**Files:**
- (no source changes)

- [ ] **Step 1: Run full suite**

Run: `npm test`
Expected: PASS — all suites (links, title, walk, convert, output, cli, version) green.

- [ ] **Step 2: Run typecheck**

Run: `npm run typecheck`
Expected: no errors.

- [ ] **Step 3: Manual smoke against an existing fixture**

Run:

```bash
npm run build
node dist/bin.js convert tests/fixtures --output /tmp/docforge-smoke
ls /tmp/docforge-smoke
cat /tmp/docforge-smoke/sphinx-method.md
```

Expected: prints converted/empty/skipped/failed/total summary; output dir contains `.md` files matching the OK fixture set.

No commit — verify-only checkpoint.

---

## Wave 4 — OpenAPI Port

### Task 4.1: `openapi/loader.ts`

**Files:**
- Create: `src/openapi/loader.ts`
- Create: `tests/openapi/fixtures/petstore-mini.json` (copy from existing `tests/openapi/fixtures/`)
- Create: `tests/openapi/loader.test.ts`

- [ ] **Step 1: Confirm fixture exists**

Run: `ls tests/openapi/fixtures/petstore-mini.json`
Expected: file present (committed during the Python implementation).

- [ ] **Step 2: Write the failing tests**

`tests/openapi/loader.test.ts`:

```ts
import { afterEach, beforeEach, describe, expect, test } from "vitest";
import { mkdtempSync, rmSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { UnsupportedSpecError, loadSpec } from "../../src/openapi/loader.js";

let tmp: string;
beforeEach(() => {
  tmp = mkdtempSync(join(tmpdir(), "docforge-loader-"));
});
afterEach(() => {
  rmSync(tmp, { recursive: true, force: true });
});

describe("loadSpec", () => {
  test("loads valid 3.x JSON", () => {
    const p = join(tmp, "spec.json");
    writeFileSync(p, JSON.stringify({ openapi: "3.0.0", info: {}, paths: {} }));
    const spec = loadSpec(p);
    expect(spec.openapi).toBe("3.0.0");
  });

  test("loads valid 3.x YAML", () => {
    const p = join(tmp, "spec.yaml");
    writeFileSync(p, "openapi: '3.0.0'\ninfo: {}\npaths: {}\n");
    const spec = loadSpec(p);
    expect(spec.openapi).toBe("3.0.0");
  });

  test("rejects unknown suffix", () => {
    const p = join(tmp, "spec.txt");
    writeFileSync(p, "{}");
    expect(() => loadSpec(p)).toThrow(UnsupportedSpecError);
  });

  test("rejects swagger 2.0", () => {
    const p = join(tmp, "spec.json");
    writeFileSync(p, JSON.stringify({ swagger: "2.0", paths: {} }));
    expect(() => loadSpec(p)).toThrow(/swagger 2.0/i);
  });

  test("rejects unsupported openapi version", () => {
    const p = join(tmp, "spec.json");
    writeFileSync(p, JSON.stringify({ openapi: "2.0", paths: {} }));
    expect(() => loadSpec(p)).toThrow(/unsupported/i);
  });

  test("rejects non-object root", () => {
    const p = join(tmp, "spec.json");
    writeFileSync(p, JSON.stringify(["not", "an", "object"]));
    expect(() => loadSpec(p)).toThrow(UnsupportedSpecError);
  });
});
```

- [ ] **Step 3: Run tests to verify they fail**

Run: `npm test -- openapi/loader`
Expected: FAIL — module not found.

- [ ] **Step 4: Write `src/openapi/loader.ts`**

```ts
import { readFileSync } from "node:fs";
import { extname } from "node:path";
import { load as yamlLoad } from "js-yaml";

export class UnsupportedSpecError extends Error {
  constructor(message: string) {
    super(message);
    this.name = "UnsupportedSpecError";
  }
}

export function loadSpec(path: string): Record<string, unknown> {
  const suffix = extname(path).toLowerCase();
  const raw = readFileSync(path, "utf8");

  let spec: unknown;
  if (suffix === ".json") {
    spec = JSON.parse(raw);
  } else if (suffix === ".yaml" || suffix === ".yml") {
    spec = yamlLoad(raw);
  } else {
    throw new UnsupportedSpecError(
      `unknown spec suffix '${suffix}' (expected .json/.yaml/.yml)`,
    );
  }

  if (
    spec === null ||
    typeof spec !== "object" ||
    Array.isArray(spec)
  ) {
    throw new UnsupportedSpecError("spec root must be an object");
  }

  const obj = spec as Record<string, unknown>;

  if ("swagger" in obj) {
    throw new UnsupportedSpecError(
      `Swagger 2.0 not supported (found swagger=${JSON.stringify(obj.swagger)}); ` +
        "convert to OpenAPI 3.x first",
    );
  }

  const version = obj.openapi;
  if (typeof version !== "string" || !version.startsWith("3.")) {
    throw new UnsupportedSpecError(
      `unsupported openapi version: ${JSON.stringify(version)} (expected 3.x)`,
    );
  }

  return obj;
}
```

- [ ] **Step 5: Run tests to verify they pass**

Run: `npm test -- openapi/loader`
Expected: PASS (6 tests).

- [ ] **Step 6: Commit**

```bash
git add src/openapi/loader.ts tests/openapi/loader.test.ts
git commit -m "feat(ts): port openapi loader (json+yaml + 3.x version guards)"
```

---

### Task 4.2: `openapi/iter.ts`

**Files:**
- Create: `src/openapi/iter.ts`
- Create: `tests/openapi/iter.test.ts`

- [ ] **Step 1: Write the failing tests**

`tests/openapi/iter.test.ts`:

```ts
import { describe, expect, test } from "vitest";
import { iterEndpoints, iterSchemas } from "../../src/openapi/iter.js";

describe("iterEndpoints", () => {
  test("yields one entry per http method", () => {
    const spec = {
      paths: {
        "/foo": {
          get: { summary: "g" },
          post: { summary: "p" },
          parameters: [], // not a method, must be skipped
        },
      },
    };
    const eps = Array.from(iterEndpoints(spec));
    expect(eps.map((e) => e.method).sort()).toEqual(["get", "post"]);
  });

  test("lowercases method", () => {
    const spec = { paths: { "/x": { GET: {} } } };
    expect(Array.from(iterEndpoints(spec))[0]!.method).toBe("get");
  });

  test("populates tags + summary + description", () => {
    const spec = {
      paths: {
        "/x": {
          get: {
            tags: ["t1", "t2"],
            summary: "S",
            description: "D",
          },
        },
      },
    };
    const ep = Array.from(iterEndpoints(spec))[0]!;
    expect(ep.tags).toEqual(["t1", "t2"]);
    expect(ep.summary).toBe("S");
    expect(ep.description).toBe("D");
  });

  test("skips when path-item is not an object", () => {
    const spec = { paths: { "/x": "nope" } };
    expect(Array.from(iterEndpoints(spec))).toEqual([]);
  });
});

describe("iterSchemas", () => {
  test("yields entries from components.schemas", () => {
    const spec = {
      components: { schemas: { A: { type: "object" }, B: { type: "string" } } },
    };
    const names = Array.from(iterSchemas(spec)).map((s) => s.name);
    expect(names.sort()).toEqual(["A", "B"]);
  });

  test("yields nothing when components missing", () => {
    expect(Array.from(iterSchemas({}))).toEqual([]);
  });

  test("skips non-object schema bodies", () => {
    const spec = { components: { schemas: { A: "bad", B: { type: "string" } } } };
    expect(Array.from(iterSchemas(spec)).map((s) => s.name)).toEqual(["B"]);
  });
});
```

- [ ] **Step 2: Run tests to verify they fail**

Run: `npm test -- openapi/iter`
Expected: FAIL — module not found.

- [ ] **Step 3: Write `src/openapi/iter.ts`**

```ts
const HTTP_METHODS = new Set([
  "get", "post", "put", "delete", "patch", "head", "options", "trace",
]);

export interface Endpoint {
  method: string;
  path: string;
  operation: Record<string, unknown>;
  tags: string[];
  summary: string;
  description: string;
}

export interface Schema {
  name: string;
  body: Record<string, unknown>;
}

function isPlainObject(x: unknown): x is Record<string, unknown> {
  return x !== null && typeof x === "object" && !Array.isArray(x);
}

export function* iterEndpoints(
  spec: Record<string, unknown>,
): Generator<Endpoint> {
  const paths = isPlainObject(spec.paths) ? spec.paths : {};
  for (const [path, item] of Object.entries(paths)) {
    if (!isPlainObject(item)) continue;
    for (const [method, op] of Object.entries(item)) {
      const lower = method.toLowerCase();
      if (!HTTP_METHODS.has(lower)) continue;
      if (!isPlainObject(op)) continue;
      const tagsRaw = op.tags;
      const tags = Array.isArray(tagsRaw)
        ? tagsRaw.map((t) => String(t))
        : [];
      yield {
        method: lower,
        path,
        operation: op,
        tags,
        summary: typeof op.summary === "string" ? op.summary : "",
        description: typeof op.description === "string" ? op.description : "",
      };
    }
  }
}

export function* iterSchemas(
  spec: Record<string, unknown>,
): Generator<Schema> {
  const components = isPlainObject(spec.components) ? spec.components : {};
  const schemas = isPlainObject(components.schemas) ? components.schemas : {};
  for (const [name, body] of Object.entries(schemas)) {
    if (!isPlainObject(body)) continue;
    yield { name, body };
  }
}
```

- [ ] **Step 4: Run tests to verify they pass**

Run: `npm test -- openapi/iter`
Expected: PASS (7 tests).

- [ ] **Step 5: Commit**

```bash
git add src/openapi/iter.ts tests/openapi/iter.test.ts
git commit -m "feat(ts): port openapi iterEndpoints + iterSchemas"
```

---

### Task 4.3: `openapi/refs.ts`

**Files:**
- Create: `src/openapi/refs.ts`
- Create: `tests/openapi/refs.test.ts`

- [ ] **Step 1: Write the failing tests**

`tests/openapi/refs.test.ts`:

```ts
import { describe, expect, test } from "vitest";
import { refLink, refToSchemaName } from "../../src/openapi/refs.js";

describe("refToSchemaName", () => {
  test("extracts schema name", () => {
    expect(refToSchemaName("#/components/schemas/Foo")).toBe("Foo");
  });

  test("returns null for unrelated ref", () => {
    expect(refToSchemaName("#/paths/~1pets")).toBeNull();
  });

  test("returns null for empty schema name", () => {
    expect(refToSchemaName("#/components/schemas/")).toBeNull();
  });

  test("returns null for non-string", () => {
    expect(refToSchemaName(undefined as unknown as string)).toBeNull();
  });
});

describe("refLink", () => {
  test("from endpoint links to ../schemas/<name>.md", () => {
    expect(refLink("#/components/schemas/Foo", { fromKind: "endpoint" })).toEqual([
      "Foo",
      "../schemas/Foo.md",
    ]);
  });

  test("from schema links to <name>.md", () => {
    expect(refLink("#/components/schemas/Foo", { fromKind: "schema" })).toEqual([
      "Foo",
      "Foo.md",
    ]);
  });

  test("non-schema ref returned verbatim as both label and href", () => {
    expect(refLink("#/paths/~1pets", { fromKind: "endpoint" })).toEqual([
      "#/paths/~1pets",
      "#/paths/~1pets",
    ]);
  });

  test("rejects unknown fromKind", () => {
    expect(() =>
      refLink("#/components/schemas/Foo", { fromKind: "bogus" as never }),
    ).toThrow();
  });
});
```

- [ ] **Step 2: Run tests to verify they fail**

Run: `npm test -- openapi/refs`
Expected: FAIL — module not found.

- [ ] **Step 3: Write `src/openapi/refs.ts`**

```ts
const SCHEMA_PREFIX = "#/components/schemas/";
const FROM_KINDS = new Set(["endpoint", "schema"]);

export type FromKind = "endpoint" | "schema";

export function refToSchemaName(ref: unknown): string | null {
  if (typeof ref !== "string" || !ref.startsWith(SCHEMA_PREFIX)) return null;
  const name = ref.slice(SCHEMA_PREFIX.length);
  return name || null;
}

export function refLink(
  ref: string,
  opts: { fromKind: FromKind },
): [string, string] {
  if (!FROM_KINDS.has(opts.fromKind)) {
    throw new Error(`fromKind must be 'endpoint' or 'schema', got '${opts.fromKind}'`);
  }
  const name = refToSchemaName(ref);
  if (name === null) return [ref, ref];
  if (opts.fromKind === "endpoint") return [name, `../schemas/${name}.md`];
  return [name, `${name}.md`];
}
```

- [ ] **Step 4: Run tests to verify they pass**

Run: `npm test -- openapi/refs`
Expected: PASS (8 tests).

- [ ] **Step 5: Commit**

```bash
git add src/openapi/refs.ts tests/openapi/refs.test.ts
git commit -m "feat(ts): port openapi refLink + refToSchemaName"
```

---

### Task 4.4: `openapi/paths.ts`

**Files:**
- Create: `src/openapi/paths.ts`
- Create: `tests/openapi/paths.test.ts`

- [ ] **Step 1: Write the failing tests**

`tests/openapi/paths.test.ts`:

```ts
import { describe, expect, test } from "vitest";
import {
  SlugCollisionError,
  detectEndpointCollisions,
  endpointFilename,
  schemaFilename,
  slugPath,
} from "../../src/openapi/paths.js";

describe("slugPath", () => {
  test("replaces slashes and braces with underscores", () => {
    expect(slugPath("/pets/{id}")).toBe("pets_id");
  });

  test("collapses repeated underscores", () => {
    expect(slugPath("//a//b")).toBe("a_b");
  });

  test("returns 'root' for empty path", () => {
    expect(slugPath("/")).toBe("root");
    expect(slugPath("")).toBe("root");
  });
});

describe("endpointFilename", () => {
  test("uppercases method and slugs path", () => {
    expect(endpointFilename("get", "/pets/{id}")).toBe("GET_pets_id.md");
  });
});

describe("schemaFilename", () => {
  test("appends .md", () => {
    expect(schemaFilename("Pet")).toBe("Pet.md");
  });
});

describe("detectEndpointCollisions", () => {
  test("no-op when unique", () => {
    expect(() =>
      detectEndpointCollisions([["get", "/a"], ["post", "/a"]]),
    ).not.toThrow();
  });

  test("throws on collision", () => {
    expect(() =>
      detectEndpointCollisions([["get", "/a/b"], ["get", "/a_b"]]),
    ).toThrow(SlugCollisionError);
  });

  test("collision message lists offending pairs", () => {
    try {
      detectEndpointCollisions([["get", "/a/b"], ["get", "/a_b"]]);
      throw new Error("expected throw");
    } catch (e) {
      const msg = (e as Error).message;
      expect(msg).toContain("/a/b");
      expect(msg).toContain("/a_b");
    }
  });
});
```

- [ ] **Step 2: Run tests to verify they fail**

Run: `npm test -- openapi/paths`
Expected: FAIL — module not found.

- [ ] **Step 3: Write `src/openapi/paths.ts`**

```ts
const NON_SLUG_CHARS = /[/{}]+/g;
const MULTI_UNDERSCORE = /_+/g;

export class SlugCollisionError extends Error {
  constructor(message: string) {
    super(message);
    this.name = "SlugCollisionError";
  }
}

export function slugPath(path: string): string {
  let s = path.replace(NON_SLUG_CHARS, "_");
  s = s.replace(MULTI_UNDERSCORE, "_");
  s = s.replace(/^_+|_+$/g, "");
  return s || "root";
}

export function endpointFilename(method: string, path: string): string {
  return `${method.toUpperCase()}_${slugPath(path)}.md`;
}

export function schemaFilename(name: string): string {
  return `${name}.md`;
}

export function detectEndpointCollisions(
  pairs: Array<[string, string]>,
): void {
  const inverse = new Map<string, Array<[string, string]>>();
  for (const [method, path] of pairs) {
    const fname = endpointFilename(method, path);
    const arr = inverse.get(fname) ?? [];
    arr.push([method, path]);
    inverse.set(fname, arr);
  }
  const dupes: Array<[string, Array<[string, string]>]> = [];
  for (const [k, sources] of inverse) {
    if (sources.length > 1) dupes.push([k, sources]);
  }
  if (dupes.length === 0) return;
  const lines = ["endpoint filename collisions:"];
  for (const [fname, sources] of dupes) {
    lines.push(`  -> ${fname}`);
    for (const [m, p] of sources) lines.push(`      from ${m.toUpperCase()} ${p}`);
  }
  throw new SlugCollisionError(lines.join("\n"));
}
```

- [ ] **Step 4: Run tests to verify they pass**

Run: `npm test -- openapi/paths`
Expected: PASS (7 tests).

- [ ] **Step 5: Commit**

```bash
git add src/openapi/paths.ts tests/openapi/paths.test.ts
git commit -m "feat(ts): port openapi slug + filename + collision helpers"
```

---

### Task 4.5: `openapi/render.ts`

**Files:**
- Create: `src/openapi/render.ts`
- Create: `tests/openapi/render.test.ts`

- [ ] **Step 1: Write the failing tests**

`tests/openapi/render.test.ts`:

```ts
import { describe, expect, test } from "vitest";
import { renderEndpoint, renderSchema } from "../../src/openapi/render.js";
import type { Endpoint, Schema } from "../../src/openapi/iter.js";

describe("renderEndpoint", () => {
  test("renders header with method, path, source pointer", () => {
    const ep: Endpoint = {
      method: "get",
      path: "/pets/{id}",
      operation: {},
      tags: [],
      summary: "",
      description: "",
    };
    const md = renderEndpoint(ep, { specFilename: "pet.json" });
    expect(md.startsWith("# GET /pets/{id}\n")).toBe(true);
    expect(md.includes("Source: pet.json#/paths/~1pets~1{id}/get\n")).toBe(true);
  });

  test("renders tags + description", () => {
    const ep: Endpoint = {
      method: "get",
      path: "/x",
      operation: {},
      tags: ["t1", "t2"],
      summary: "S",
      description: "D",
    };
    const md = renderEndpoint(ep, { specFilename: "s.json" });
    expect(md).toContain("**Tags:** t1, t2");
    expect(md).toContain("D");
  });

  test("renders parameters table", () => {
    const ep: Endpoint = {
      method: "get",
      path: "/x",
      operation: {
        parameters: [
          {
            name: "limit",
            in: "query",
            schema: { type: "integer" },
            required: true,
            description: "max items",
          },
        ],
      },
      tags: [],
      summary: "",
      description: "",
    };
    const md = renderEndpoint(ep, { specFilename: "s.json" });
    expect(md).toContain("## Parameters");
    expect(md).toContain("| limit | query | integer | yes | max items |");
  });

  test("renders request body and responses with $ref summary", () => {
    const ep: Endpoint = {
      method: "post",
      path: "/x",
      operation: {
        requestBody: {
          required: true,
          content: {
            "application/json": {
              schema: { $ref: "#/components/schemas/NewPet" },
            },
          },
        },
        responses: {
          "200": {
            description: "OK",
            content: {
              "application/json": {
                schema: { $ref: "#/components/schemas/Pet" },
              },
            },
          },
        },
      },
      tags: [],
      summary: "",
      description: "",
    };
    const md = renderEndpoint(ep, { specFilename: "s.json" });
    expect(md).toContain("## Request Body");
    expect(md).toContain("[NewPet](../schemas/NewPet.md)");
    expect(md).toContain("## Responses");
    expect(md).toContain("### 200 OK");
    expect(md).toContain("[Pet](../schemas/Pet.md)");
  });
});

describe("renderSchema", () => {
  test("renders properties table for object", () => {
    const sc: Schema = {
      name: "Pet",
      body: {
        type: "object",
        required: ["id"],
        properties: {
          id: { type: "integer", description: "primary key" },
          name: { type: "string" },
        },
      },
    };
    const md = renderSchema(sc, { specFilename: "s.json" });
    expect(md.startsWith("# Pet\n")).toBe(true);
    expect(md).toContain("Source: s.json#/components/schemas/Pet");
    expect(md).toContain("| id | integer | yes | primary key |");
    expect(md).toContain("| name | string | no |");
  });

  test("renders json definition fallback for non-object", () => {
    const sc: Schema = {
      name: "Color",
      body: { type: "string", enum: ["red", "blue"] },
    };
    const md = renderSchema(sc, { specFilename: "s.json" });
    expect(md).toContain("## Definition");
    expect(md).toContain('"enum"');
  });
});
```

- [ ] **Step 2: Run tests to verify they fail**

Run: `npm test -- openapi/render`
Expected: FAIL — module not found.

- [ ] **Step 3: Write `src/openapi/render.ts`**

```ts
import type { Endpoint, Schema } from "./iter.js";
import { refLink, type FromKind } from "./refs.js";

export function jsonpointerEncode(s: string): string {
  return s.replace(/~/g, "~0").replace(/\//g, "~1");
}

function isPlainObject(x: unknown): x is Record<string, unknown> {
  return x !== null && typeof x === "object" && !Array.isArray(x);
}

function typeStr(schema: Record<string, unknown>): string {
  const t = schema.type;
  const fmt = schema.format;
  if (typeof t === "string" && typeof fmt === "string") return `${t} (${fmt})`;
  if (typeof t === "string") return t;
  return "any";
}

function schemaSummary(
  schema: Record<string, unknown>,
  opts: { fromKind: FromKind },
): string {
  if (typeof schema.$ref === "string") {
    const [label, href] = refLink(schema.$ref, opts);
    return `[${label}](${href})`;
  }
  if (schema.type === "array") {
    const items = isPlainObject(schema.items) ? schema.items : {};
    return `array of ${schemaSummary(items, opts)}`;
  }
  return `\`${typeStr(schema)}\``;
}

function renderParameters(params: unknown[]): string[] {
  if (params.length === 0) return [];
  const lines = [
    "## Parameters",
    "",
    "| Name | In | Type | Required | Description |",
    "|------|----|----|----------|-------------|",
  ];
  for (const p of params) {
    if (!isPlainObject(p)) continue;
    const name = typeof p.name === "string" ? p.name : "";
    const loc = typeof p.in === "string" ? p.in : "";
    const schema = isPlainObject(p.schema) ? p.schema : {};
    const tStr = typeStr(schema);
    const required = p.required ? "yes" : "no";
    const descRaw = typeof p.description === "string" ? p.description : "";
    const desc = descRaw.replace(/\|/g, "\\|").replace(/\n/g, " ");
    lines.push(`| ${name} | ${loc} | ${tStr} | ${required} | ${desc} |`);
  }
  lines.push("");
  return lines;
}

function renderRequestBody(body: unknown): string[] {
  if (!isPlainObject(body)) return [];
  const lines = ["## Request Body", ""];
  const requiredMarker = body.required ? " (required)" : "";
  if (typeof body.description === "string" && body.description.trim()) {
    lines.push(body.description.trim());
    lines.push("");
  }
  const content = isPlainObject(body.content) ? body.content : {};
  for (const [ctype, media] of Object.entries(content)) {
    if (!isPlainObject(media)) continue;
    const schema = isPlainObject(media.schema) ? media.schema : {};
    const summary = schemaSummary(schema, { fromKind: "endpoint" });
    lines.push(`\`${ctype}\`: ${summary}${requiredMarker}`);
  }
  lines.push("");
  return lines;
}

function renderResponses(responses: Record<string, unknown>): string[] {
  if (Object.keys(responses).length === 0) return [];
  const lines = ["## Responses", ""];
  for (const [code, resp] of Object.entries(responses)) {
    if (!isPlainObject(resp)) continue;
    const desc = typeof resp.description === "string" ? resp.description.trim() : "";
    lines.push(`### ${code} ${desc}`.trimEnd());
    lines.push("");
    const content = isPlainObject(resp.content) ? resp.content : {};
    for (const [ctype, media] of Object.entries(content)) {
      if (!isPlainObject(media)) continue;
      const schema = isPlainObject(media.schema) ? media.schema : {};
      const summary = schemaSummary(schema, { fromKind: "endpoint" });
      lines.push(`\`${ctype}\`: ${summary}`);
    }
    lines.push("");
  }
  return lines;
}

export function renderEndpoint(
  ep: Endpoint,
  opts: { specFilename: string },
): string {
  const pointer = `#/paths/${jsonpointerEncode(ep.path)}/${ep.method}`;
  const out: string[] = [
    `# ${ep.method.toUpperCase()} ${ep.path}`,
    "",
    `Source: ${opts.specFilename}${pointer}`,
    "",
  ];
  if (ep.tags.length > 0) {
    out.push(`**Tags:** ${ep.tags.join(", ")}`);
    out.push("");
  }
  if (ep.description.trim()) {
    out.push(ep.description.trim());
    out.push("");
  } else if (ep.summary.trim()) {
    out.push(ep.summary.trim());
    out.push("");
  }

  const params = Array.isArray(ep.operation.parameters) ? ep.operation.parameters : [];
  out.push(...renderParameters(params));
  out.push(...renderRequestBody(ep.operation.requestBody));
  const responses = isPlainObject(ep.operation.responses) ? ep.operation.responses : {};
  out.push(...renderResponses(responses));

  while (out.length > 0 && out.at(-1) === "") out.pop();
  return out.join("\n") + "\n";
}

function propertyType(schema: Record<string, unknown>): string {
  if (typeof schema.$ref === "string") {
    const [label, href] = refLink(schema.$ref, { fromKind: "schema" });
    return `[${label}](${href})`;
  }
  if (schema.type === "array") {
    const items = isPlainObject(schema.items) ? schema.items : {};
    return `array of ${propertyType(items)}`;
  }
  return typeStr(schema);
}

export function renderSchema(
  sc: Schema,
  opts: { specFilename: string },
): string {
  const body = sc.body;
  const out: string[] = [
    `# ${sc.name}`,
    "",
    `Source: ${opts.specFilename}#/components/schemas/${sc.name}`,
    "",
  ];
  const desc = typeof body.description === "string" ? body.description.trim() : "";
  if (desc) {
    out.push(desc);
    out.push("");
  }

  const properties =
    body.type === "object" && isPlainObject(body.properties)
      ? body.properties
      : null;

  if (properties) {
    const required = new Set(
      Array.isArray(body.required) ? body.required.map(String) : [],
    );
    out.push(
      "## Properties",
      "",
      "| Name | Type | Required | Description |",
      "|------|------|----------|-------------|",
    );
    for (const [propName, prop] of Object.entries(properties)) {
      const p = isPlainObject(prop) ? prop : {};
      const tStr = propertyType(p);
      const req = required.has(propName) ? "yes" : "no";
      const pdescRaw = typeof p.description === "string" ? p.description : "";
      const pdesc = pdescRaw.replace(/\|/g, "\\|").replace(/\n/g, " ");
      out.push(`| ${propName} | ${tStr} | ${req} | ${pdesc} |`);
    }
    out.push("");
  } else {
    out.push("## Definition");
    out.push("");
    out.push("```json");
    out.push(JSON.stringify(body, null, 2));
    out.push("```");
    out.push("");
  }

  while (out.length > 0 && out.at(-1) === "") out.pop();
  return out.join("\n") + "\n";
}
```

- [ ] **Step 4: Run tests to verify they pass**

Run: `npm test -- openapi/render`
Expected: PASS (6 tests).

- [ ] **Step 5: Commit**

```bash
git add src/openapi/render.ts tests/openapi/render.test.ts
git commit -m "feat(ts): port openapi renderEndpoint + renderSchema"
```

---

### Task 4.6: `openapi/cli.ts` + e2e

**Files:**
- Create: `src/openapi/cli.ts`
- Modify: `src/cli.ts` (register openapi subcommand)
- Create: `tests/openapi/cli.test.ts`

- [ ] **Step 1: Write the failing e2e test**

`tests/openapi/cli.test.ts`:

```ts
import { afterEach, beforeEach, describe, expect, test } from "vitest";
import { execFileSync } from "node:child_process";
import { mkdtempSync, readdirSync, readFileSync, rmSync, writeFileSync } from "node:fs";
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
  try {
    const stdout = execFileSync("node", ["dist/bin.js", ...args], {
      encoding: "utf8",
      stdio: ["ignore", "pipe", "pipe"],
    });
    return { code: 0, stdout, stderr: "" };
  } catch (e: any) {
    return {
      code: e.status ?? 2,
      stdout: e.stdout?.toString() ?? "",
      stderr: e.stderr?.toString() ?? "",
    };
  }
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
```

- [ ] **Step 2: Run tests to verify they fail**

Run: `npm test -- openapi/cli`
Expected: FAIL — `openapi` subcommand not registered yet.

- [ ] **Step 3: Write `src/openapi/cli.ts`**

```ts
import { Command } from "commander";
import { mkdirSync, writeFileSync } from "node:fs";
import { basename, resolve } from "node:path";

import { log } from "../log.js";
import { iterEndpoints, iterSchemas } from "./iter.js";
import { UnsupportedSpecError, loadSpec } from "./loader.js";
import {
  SlugCollisionError,
  detectEndpointCollisions,
  endpointFilename,
  schemaFilename,
} from "./paths.js";
import { renderEndpoint, renderSchema } from "./render.js";

export function registerOpenapiSubcommand(program: Command): void {
  program
    .command("openapi")
    .description("Convert an OpenAPI 3.x spec to per-endpoint + per-schema Markdown")
    .argument("<spec>", "path to OpenAPI 3.x JSON or YAML spec file")
    .requiredOption("--output <dir>", "output directory")
    .action((spec: string, opts: { output: string }) => {
      const code = runOpenapi(spec, opts);
      if (code !== 0) process.exit(code);
    });
}

function runOpenapi(specArg: string, opts: { output: string }): number {
  const specPath = resolve(expandHome(specArg));
  const output = resolve(expandHome(opts.output));

  let spec;
  try {
    spec = loadSpec(specPath);
  } catch (e) {
    if (e instanceof UnsupportedSpecError) {
      log("error", e.message);
      return 2;
    }
    if (e instanceof Error && e.message) {
      log("error", `failed to parse ${specPath}: ${e.message}`);
      return 2;
    }
    throw e;
  }

  const endpointsDir = resolve(output, "endpoints");
  const schemasDir = resolve(output, "schemas");
  mkdirSync(endpointsDir, { recursive: true });
  mkdirSync(schemasDir, { recursive: true });

  const endpoints = Array.from(iterEndpoints(spec));
  const schemas = Array.from(iterSchemas(spec));

  try {
    detectEndpointCollisions(endpoints.map((e) => [e.method, e.path]));
  } catch (e) {
    if (e instanceof SlugCollisionError) {
      log("error", e.message);
      return 2;
    }
    throw e;
  }

  const specFilename = basename(specPath);

  for (const ep of endpoints) {
    const outPath = resolve(endpointsDir, endpointFilename(ep.method, ep.path));
    writeFileSync(outPath, renderEndpoint(ep, { specFilename }), "utf8");
  }
  for (const sc of schemas) {
    const outPath = resolve(schemasDir, schemaFilename(sc.name));
    writeFileSync(outPath, renderSchema(sc, { specFilename }), "utf8");
  }

  log("info", `endpoints=${endpoints.length} schemas=${schemas.length}`);
  return 0;
}

function expandHome(p: string): string {
  if (p.startsWith("~/") || p === "~") {
    const home = process.env.HOME ?? process.env.USERPROFILE ?? "";
    return p.replace(/^~/, home);
  }
  return p;
}
```

- [ ] **Step 4: Register the subcommand in `src/cli.ts`**

Inside `buildProgram` in `src/cli.ts`, after the existing `program.command("convert")` block, add:

```ts
import { registerOpenapiSubcommand } from "./openapi/cli.js";
// ...
registerOpenapiSubcommand(program);
```

(Place the import at the top of the file with the other imports.)

- [ ] **Step 5: Build and run tests**

Run: `npm test -- openapi/cli`
Expected: PASS (3 e2e tests).

- [ ] **Step 6: Commit**

```bash
git add src/openapi/cli.ts src/cli.ts tests/openapi/cli.test.ts
git commit -m "feat(ts): wire up openapi subcommand end-to-end"
```

---

### Task 4.7: Wave 4 — full-suite green check

**Files:**
- (no source changes)

- [ ] **Step 1: Run full suite**

Run: `npm test`
Expected: PASS — all suites green.

- [ ] **Step 2: Run typecheck**

Run: `npm run typecheck`
Expected: no errors.

No commit — verify-only checkpoint.

---

## Wave 5 — Dogfood

### Task 5.1: Diff convert output against the existing `~/docs/diadok-md/`

**Files:**
- Create: `docs/superpowers/dogfood-2026-05-09-ts.md`

- [ ] **Step 1: Build the binary**

Run: `npm run build`
Expected: `dist/bin.js` present.

- [ ] **Step 2: Run convert against the diadok corpus**

```bash
mkdir -p /tmp/docforge-ts-dogfood
node dist/bin.js convert ~/docs/diadok --output /tmp/docforge-ts-dogfood --report-json /tmp/docforge-ts-report.json
```

Expected: stderr summary line shows `converted≈642 empty=0 skipped=<N> failed=0 total=642` (numbers may vary slightly with corpus state).

- [ ] **Step 3: Diff against the existing Python output**

```bash
diff -r --brief ~/docs/diadok-md /tmp/docforge-ts-dogfood | head -50
```

Expected: differences. The header format differs intentionally between Python (`# Title\n\nSource: ...`) and TS (same). Body content should be near-identical with possible whitespace/escape drift from binding differences.

- [ ] **Step 4: Sample-diff a representative file**

```bash
diff ~/docs/diadok-md/api-protobuf-ru/Address.md /tmp/docforge-ts-dogfood/api-protobuf-ru/Address.md
```

Expected: small diff (whitespace, list bullets, code-fence language tags). No dropped paragraphs or table rows.

- [ ] **Step 5: Write a dogfood report**

Create `docs/superpowers/dogfood-2026-05-09-ts.md` summarizing:

- File counts (converted/empty/failed/skipped/total)
- Sample-diff observations (which files drift, how much, what kind of drift)
- Any unexpected deltas (must investigate before committing)
- Pass/fail decision against the §16 acceptance criteria

- [ ] **Step 6: Commit the report**

```bash
git add docs/superpowers/dogfood-2026-05-09-ts.md
git commit -m "docs(ts): dogfood report for convert against diadok corpus"
```

---

### Task 5.2: Diff openapi output against the existing diadok spec rendering

**Files:**
- Modify: `docs/superpowers/dogfood-2026-05-09-ts.md` (append)

- [ ] **Step 1: Run openapi against the diadok spec**

```bash
mkdir -p /tmp/docforge-ts-openapi
node dist/bin.js openapi tests/openapi/fixtures/diadoc.api.json --output /tmp/docforge-ts-openapi
```

Expected: stderr `endpoints=N schemas=M`; output dir contains `endpoints/` and `schemas/` subdirs full of `.md` files.

- [ ] **Step 2: Compare against the Python tool**

If the Python tool's openapi output is in `qmd` collection `diadoc-openapi` (608 docs), compare counts:

```bash
ls /tmp/docforge-ts-openapi/endpoints | wc -l
ls /tmp/docforge-ts-openapi/schemas | wc -l
```

Expected: counts approximately match the published `diadoc-openapi` qmd collection.

- [ ] **Step 3: Sample-diff a known endpoint and schema**

Read both the TS output and one of the published files; eyeball for structural equivalence (same headers, same table columns, same `Source:` pointer format).

- [ ] **Step 4: Append findings to the dogfood report**

Append a `## OpenAPI` section to `docs/superpowers/dogfood-2026-05-09-ts.md` with file counts, sample-diff observations, and pass/fail decision.

- [ ] **Step 5: Commit**

```bash
git add docs/superpowers/dogfood-2026-05-09-ts.md
git commit -m "docs(ts): dogfood report for openapi subcommand"
```

---

## Wave 6 — Retire Python

This wave is destructive — it deletes the Python implementation. Run only after Wave 5 dogfood passes and the user has reviewed the report.

### Task 6.1: Delete Python source and tests

**Files:**
- Delete: `src/docforge/**/*.py`
- Delete: `tests/test_*.py`, `tests/openapi/test_*.py`, `tests/openapi/conftest.py`, `tests/__init__.py`, `tests/openapi/__init__.py`
- Delete: `pyproject.toml`, `uv.lock`, `.python-version` (if present)

- [ ] **Step 1: Delete Python sources**

```bash
git rm -r src/docforge
git rm pyproject.toml uv.lock
[ -f .python-version ] && git rm .python-version || true
```

- [ ] **Step 2: Delete Python test files (keep fixtures and goldens)**

```bash
git rm tests/__init__.py tests/test_*.py
git rm tests/openapi/__init__.py tests/openapi/test_*.py tests/openapi/conftest.py
```

`tests/fixtures/`, `tests/expected/`, and `tests/openapi/fixtures/` stay — they back the TS suite.

- [ ] **Step 3: Run the full TS suite to confirm nothing broke**

Run: `npm test`
Expected: PASS — no Python file was on a TS import path, so all suites stay green.

- [ ] **Step 4: Commit**

```bash
git add -A
git commit -m "chore(ts): remove python implementation after dogfood parity"
```

---

### Task 6.2: Update README

**Files:**
- Modify: `README.md`

- [ ] **Step 1: Rewrite README for the TS toolchain**

```markdown
# docforge

Convert documentation HTML and OpenAPI specs to Markdown for RAG ingestion.

v0.4.0 scope: HTML (Sphinx-shaped output works best) + OpenAPI 3.x JSON/YAML.

## Install

```bash
git clone https://github.com/<you>/docforge   # or local path
cd docforge
npm install
npm run build
npm install -g .
docforge --help
```

## Usage

```bash
docforge convert ~/docs/some-corpus --output ~/docs/some-corpus-md
docforge openapi ./api.yaml --output ./api-md
```

See `docforge --help` and `docforge <command> --help` for all flags.

## Development

```bash
cd ~/experiements/docforge
npm install
npm test
npm run typecheck
npx tsx src/bin.ts convert tests/fixtures --output /tmp/out
```

## Design

See `docs/superpowers/specs/2026-05-09-docforge-typescript-rewrite-design.md`.
```

- [ ] **Step 2: Commit**

```bash
git add README.md
git commit -m "docs(ts): rewrite README for the typescript toolchain"
```

---

### Task 6.3: Update beads memory + close any open infra issue

**Files:**
- (no source changes; updates beads via CLI)

- [ ] **Step 1: Record the rewrite in beads memory**

```bash
bd remember "docforge rewrite to TypeScript landed 2026-05-09. Stack: Node 20 + npm + ESM, cheerio + @kreuzberg/node + commander + js-yaml + vitest + tsx. Python codebase removed. Spec: docs/superpowers/specs/2026-05-09-docforge-typescript-rewrite-design.md. Plan: docs/superpowers/plans/2026-05-09-docforge-typescript-rewrite.md."
```

- [ ] **Step 2: List any open beads issues for this rewrite and close them**

```bash
bd list --status=in_progress
bd list --status=open | grep -i docforge || true
```

For each issue that the rewrite completes, close it:

```bash
bd close <id> --reason="docforge rewrite to TypeScript completed and merged to master 2026-05-09"
```

- [ ] **Step 3: Commit any beads JSONL changes**

```bash
git add .beads/
git commit -m "chore(beads): record docforge typescript rewrite + close completed issues"
```

---

### Task 6.4: Merge `ts-rewrite` to master

**Files:**
- Modify: git branches

This is a destructive ref change. Confirm with the user before running it.

- [ ] **Step 1: Confirm tests are green and tree is clean**

Run: `npm test && git status`
Expected: `npm test` green; `git status` shows nothing uncommitted.

- [ ] **Step 2: Confirm with the user before merging**

Ask the user to confirm: "Wave 5 dogfood passed; ready to merge `ts-rewrite` into `master` and delete the branch?"

If they decline, stop — do not merge.

- [ ] **Step 3: Merge**

```bash
git checkout master
git merge --ff-only ts-rewrite
```

If `--ff-only` refuses (because master moved during the rewrite), pause and ask the user how to proceed (rebase vs merge commit) — do not force.

- [ ] **Step 4: Delete the rewrite branch**

```bash
git branch -d ts-rewrite
```

- [ ] **Step 5: Final smoke test on master**

```bash
npm install
npm test
npm run build
node dist/bin.js --version
```

Expected: clean install, all tests green, version prints `0.4.0`.

The plan is complete.
