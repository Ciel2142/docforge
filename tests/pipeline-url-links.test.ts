import { afterEach, beforeEach, describe, expect, test } from "vitest";
import { mkdtempSync, readFileSync, rmSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { runPipeline, type RunPipelineOptions } from "../src/runPipeline.js";
import { startStub, type StubServer } from "./mcp/helpers/http-stub.js";

const PAD = "word ".repeat(40);
// NOTE: links are written as root-absolute paths against the stub origin so the
// crawler discovers them and they serialize as same-origin absolute URLs.
function page(body: string): string {
  return `<!doctype html><html><head><title>T</title></head><body><main><h1>T</h1><p>${PAD}</p>${body}</main></body></html>`;
}

let tmp: string;
let stub: StubServer | undefined;
beforeEach(() => {
  tmp = mkdtempSync(join(tmpdir(), "df-urllinks-"));
});
afterEach(async () => {
  if (stub) {
    await stub.close();
    stub = undefined;
  }
  rmSync(tmp, { recursive: true, force: true });
});

// Build a site: / → /guide/intro → /api/reference (with #frag) + external link.
// The root page links to /guide/intro so BFS can discover it.
async function startSite(): Promise<StubServer> {
  return startStub([
    { path: "/", body: page(`<p>See <a href="/guide/intro">guide</a>. ${PAD}</p>`) },
    {
      path: "/guide/intro",
      body: page(
        `<p>See <a href="/api/reference#post-widgets">API</a> and <a href="https://external.example/x">ext</a>. ${PAD}</p>`,
      ),
    },
    { path: "/api/reference", body: page(`<p>Back to <a href="/guide/intro">intro</a>. ${PAD}</p>`) },
    { path: "/robots.txt", contentType: "text/plain", body: "User-agent: *\nDisallow:" },
    { path: "/llms-full.txt", status: 404, body: "" },
    { path: "/sitemap.xml", status: 404, body: "" },
    { path: "/sitemap_index.xml", status: 404, body: "" },
  ]);
}

function makePipelineOpts(
  stubUrl: string,
  outDir: string,
  format?: "default" | "obsidian",
): RunPipelineOptions {
  return {
    source: stubUrl,
    outputDir: outDir,
    maxBytes: 10485760,
    dryRun: false,
    format: format ?? "default",
    fetchOptions: {
      userAgent: "docforge-test/0",
      timeoutMs: 10000,
      maxBytes: 10485760,
      cacheDir: null,
    },
    crawlOptions: {
      maxPages: 10,
      maxDepth: 5,
      concurrency: 1,
      userAgent: "docforge-test/0",
      llmsFullMode: "off",
      llmsIndexMode: "off",
    },
  };
}

describe("URL crawl relativizes same-origin links (docf-cf1)", () => {
  test("obsidian: same-origin link → wikilink, external untouched", async () => {
    stub = await startSite();
    const outDir = join(tmp, "out");
    await runPipeline(makePipelineOpts(stub.url, outDir, "obsidian"));
    const intro = readFileSync(join(outDir, "guide", "intro.md"), "utf8");
    expect(intro).toContain("[[api/reference|API]]");
    expect(intro).toContain("https://external.example/x"); // external stays absolute
    expect(intro).not.toContain(`${stub.origin}/api/reference`); // same-origin no longer absolute
  });

  test("default: same-origin link → relative .md, external untouched", async () => {
    stub = await startSite();
    const outDir = join(tmp, "out");
    await runPipeline(makePipelineOpts(stub.url, outDir, "default"));
    const intro = readFileSync(join(outDir, "guide", "intro.md"), "utf8");
    expect(intro).toContain("[API](../api/reference.md#post-widgets)");
    expect(intro).toContain("https://external.example/x");
    expect(intro).not.toContain(`${stub.origin}/api/reference`);
  });
});
