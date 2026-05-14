import { afterEach, beforeEach, describe, expect, test } from "vitest";
import { createServer, type Server } from "node:http";
import { AddressInfo } from "node:net";
import { existsSync, mkdtempSync, readFileSync, rmSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { runConvert } from "../src/cli.js";
import { __clearRobotsCache } from "../src/http/robots.js";

const AUTH_VALUE = "Bearer cli-test-token";
const PAGE_HTML =
  `<!doctype html><html><head><title>Secret Docs</title></head>` +
  `<body><main><h1>Secret Docs</h1>` +
  `<p>This documentation page sits behind HTTP authentication for testing purposes.</p>` +
  `</main></body></html>`;

interface AuthServer {
  url: string;
  close(): Promise<void>;
}

async function startAuthServer(): Promise<AuthServer> {
  const server: Server = createServer((req, res) => {
    const path = (req.url ?? "/").split("?")[0];
    if (path !== "/") {
      res.writeHead(404).end();
      return;
    }
    if (req.headers["authorization"] !== AUTH_VALUE) {
      res.writeHead(401).end();
      return;
    }
    res.writeHead(200, { "Content-Type": "text/html; charset=utf-8" });
    res.end(PAGE_HTML);
  });
  await new Promise<void>((r) => server.listen(0, "127.0.0.1", r));
  const port = (server.address() as AddressInfo).port;
  return {
    url: `http://127.0.0.1:${port}/`,
    close: () => new Promise<void>((r) => server.close(() => r())),
  };
}

let tmp: string;
beforeEach(() => {
  __clearRobotsCache();
  tmp = mkdtempSync(join(tmpdir(), "docforge-cli-auth-"));
});
afterEach(() => {
  rmSync(tmp, { recursive: true, force: true });
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

describe("convert --auth-header", () => {
  test("crawls an auth-gated page when --auth-header is provided", async () => {
    const srv = await startAuthServer();
    try {
      const out = join(tmp, "authed");
      const code = await runConvert(srv.url, {
        ...baseOpts(out),
        authHeader: AUTH_VALUE,
      });
      expect(code).toBe(0);
      expect(existsSync(join(out, "index.md"))).toBe(true);
      expect(readFileSync(join(out, "index.md"), "utf8")).toContain("Secret Docs");
    } finally {
      await srv.close();
    }
  });

  test("fails to crawl the same page without --auth-header", async () => {
    const srv = await startAuthServer();
    try {
      const out = join(tmp, "noauth");
      const code = await runConvert(srv.url, baseOpts(out));
      expect(code).toBe(1);
      expect(existsSync(join(out, "index.md"))).toBe(false);
    } finally {
      await srv.close();
    }
  });
});
