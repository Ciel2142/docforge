import { afterEach, beforeEach, describe, expect, test } from "vitest";
import { resolve } from "node:path";
import { startStaticServer, type RunningServer } from "./helpers/static-server.js";
import { probeLlmsFullTxt } from "../src/http/llms.js";
import type { FetchOptions } from "../src/http/fetch.js";

let server: RunningServer;
const FIXTURE = resolve("tests/fixtures/llms-full-site");

const FETCH_OPTS: FetchOptions = {
  userAgent: "docforge-test",
  timeoutMs: 5_000,
  maxBytes: 1_000_000,
  cacheDir: null,
};

describe("probeLlmsFullTxt", () => {
  beforeEach(async () => {
    server = await startStaticServer({ rootDir: FIXTURE, rewriteBase: true });
  });
  afterEach(async () => {
    await server.close();
  });

  test("returns body when /llms-full.txt exists with text content type", async () => {
    const r = await probeLlmsFullTxt(server.baseUrl, FETCH_OPTS);
    expect(r).not.toBeNull();
    if (r) {
      expect(r.url).toBe(`${server.baseUrl}/llms-full.txt`);
      expect(r.bytes.toString("utf8")).toContain("This is the canonical");
      expect(r.contentType).toMatch(/^text\//);
    }
  });

  test("returns null when /llms-full.txt does not exist", async () => {
    // start a server pointing at a directory WITHOUT llms-full.txt
    await server.close();
    server = await startStaticServer({ rootDir: resolve("tests/fixtures"), rewriteBase: false });
    const r = await probeLlmsFullTxt(server.baseUrl, FETCH_OPTS);
    expect(r).toBeNull();
  });
});
