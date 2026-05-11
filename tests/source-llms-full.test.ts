import { afterEach, beforeEach, describe, expect, test } from "vitest";
import { resolve } from "node:path";
import { startStaticServer, type RunningServer } from "./helpers/static-server.js";
import { HttpSource, type SourceItem } from "../src/source.js";
import type { FetchOptions } from "../src/http/fetch.js";
import type { CrawlOptions } from "../src/http/crawl.js";

let server: RunningServer;
const FIXTURE = resolve("tests/fixtures/llms-full-site");

const FETCH_OPTS: FetchOptions = {
  userAgent: "docforge-test",
  timeoutMs: 5_000,
  maxBytes: 1_000_000,
  cacheDir: null,
};

function crawlOpts(mode: "auto" | "force" | "off"): CrawlOptions {
  return {
    maxPages: 100,
    maxDepth: 5,
    concurrency: 2,
    userAgent: "docforge-test",
    llmsFullMode: mode,
  };
}

async function collect(source: HttpSource): Promise<SourceItem[]> {
  const items: SourceItem[] = [];
  for await (const item of source.iter()) items.push(item);
  return items;
}

describe("HttpSource llms-full short-circuit", () => {
  beforeEach(async () => {
    server = await startStaticServer({ rootDir: FIXTURE, rewriteBase: true });
  });
  afterEach(async () => {
    await server.close();
  });

  test("auto mode: yields single llms-full item when file exists", async () => {
    const source = new HttpSource(server.baseUrl, FETCH_OPTS, crawlOpts("auto"));
    const items = await collect(source);
    expect(items.length).toBe(1);
    expect(items[0]!.kind).toBe("llms-full");
    expect(items[0]!.key).toBe("llms-full.txt");
    expect(items[0]!.bytes.toString("utf8")).toContain("This is the canonical");
  });

  test("off mode: ignores llms-full.txt and yields HTML items", async () => {
    const source = new HttpSource(server.baseUrl, FETCH_OPTS, crawlOpts("off"));
    const items = await collect(source);
    expect(items.length).toBeGreaterThan(0);
    expect(items.every((i) => i.kind !== "llms-full")).toBe(true);
  });

  test("force mode: throws when llms-full.txt missing", async () => {
    await server.close();
    server = await startStaticServer({ rootDir: resolve("tests/fixtures"), rewriteBase: false });
    const source = new HttpSource(server.baseUrl, FETCH_OPTS, crawlOpts("force"));
    await expect(collect(source)).rejects.toThrow(/llms-full\.txt required/);
  });
});
