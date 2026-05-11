import { afterAll, afterEach, beforeAll, beforeEach, describe, expect, test } from "vitest";
import { spawn, spawnSync, type ChildProcess } from "node:child_process";
import { mkdtempSync, readdirSync, rmSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";

let server: ChildProcess;
let port: number;
let tmp: string;
let serverScript: string;

const yamlSpec = `openapi: 3.0.0
info:
  title: T
  version: '1'
paths:
  /items:
    get:
      operationId: listItems
      responses:
        '200':
          description: ok
`;

beforeAll(async () => {
  serverScript = join(mkdtempSync(join(tmpdir(), "docforge-oapi-srv-")), "server.cjs");
  writeFileSync(
    serverScript,
    `const http = require('http');
const yamlSpec = ${JSON.stringify(yamlSpec)};
const s = http.createServer((req, res) => {
  if (req.url === '/openapi.yaml') {
    res.writeHead(200, { 'Content-Type': 'application/yaml' });
    res.end(yamlSpec);
    return;
  }
  res.writeHead(404);
  res.end();
});
s.listen(0, '127.0.0.1', () => {
  process.stdout.write('PORT=' + s.address().port + '\\n');
});
`,
    "utf8",
  );
  server = spawn("node", [serverScript], { stdio: ["ignore", "pipe", "pipe"] });
  port = await new Promise<number>((resolve, reject) => {
    const timer = setTimeout(() => reject(new Error("server startup timeout")), 5000);
    server.stdout!.on("data", (chunk: Buffer) => {
      const m = chunk.toString().match(/PORT=(\d+)/);
      if (m) {
        clearTimeout(timer);
        resolve(parseInt(m[1]!, 10));
      }
    });
    server.on("error", (e) => {
      clearTimeout(timer);
      reject(e);
    });
  });
});

afterAll(async () => {
  if (server && !server.killed) {
    server.kill("SIGTERM");
    await new Promise<void>((resolve) => server.once("exit", () => resolve()));
  }
});

beforeEach(() => {
  tmp = mkdtempSync(join(tmpdir(), "docforge-oapi-url-"));
});
afterEach(() => {
  rmSync(tmp, { recursive: true, force: true });
});

describe("docforge openapi <url>", () => {
  test("fetches yaml spec and renders endpoints", () => {
    const r = spawnSync("node", [
      "--experimental-vm-modules",
      "./dist/bin.js",
      "openapi",
      `http://127.0.0.1:${port}/openapi.yaml`,
      "--output",
      tmp,
    ], { encoding: "utf8" });
    expect(r.status).toBe(0);
    const endpoints = readdirSync(join(tmp, "endpoints"));
    expect(endpoints.length).toBeGreaterThan(0);
  });
});
