import { describe, expect, test, beforeEach, afterEach } from "vitest";
import { spawn, type ChildProcessWithoutNullStreams } from "node:child_process";
import { mkdtempSync, rmSync } from "node:fs";
import { tmpdir } from "node:os";
import { join, resolve } from "node:path";
import { fileURLToPath } from "node:url";
import { dirname } from "node:path";

const __dirname = dirname(fileURLToPath(import.meta.url));

let qmdRoot: string;
let child: ChildProcessWithoutNullStreams;

const BIN = resolve(__dirname, "../../dist/mcp/bin.js");

beforeEach(() => {
  qmdRoot = mkdtempSync(join(tmpdir(), "df-roundtrip-"));
  child = spawn(process.execPath, [BIN], {
    env: { ...process.env, DOCFORGE_QMD_ROOT: qmdRoot },
    stdio: ["pipe", "pipe", "pipe"],
  });
});
afterEach(() => {
  child.kill("SIGTERM");
  rmSync(qmdRoot, { recursive: true, force: true });
});

function rpc(id: number, method: string, params: unknown): string {
  return JSON.stringify({ jsonrpc: "2.0", id, method, params }) + "\n";
}

function nextMessage(): Promise<unknown> {
  return new Promise((resolveP, reject) => {
    let buf = "";
    const onData = (chunk: Buffer) => {
      buf += chunk.toString("utf8");
      const nl = buf.indexOf("\n");
      if (nl >= 0) {
        child.stdout.off("data", onData);
        try {
          resolveP(JSON.parse(buf.slice(0, nl)));
        } catch (e) {
          reject(e);
        }
      }
    };
    child.stdout.on("data", onData);
    setTimeout(() => {
      child.stdout.off("data", onData);
      reject(new Error("timeout waiting for MCP response"));
    }, 5000);
  });
}

describe("MCP stdio roundtrip", () => {
  test("initialize + tools/list returns 3 tools", async () => {
    child.stdin.write(rpc(1, "initialize", {
      protocolVersion: "2024-11-05",
      capabilities: {},
      clientInfo: { name: "test", version: "0.0.0" },
    }));
    await nextMessage();
    child.stdin.write(rpc(2, "tools/list", {}));
    const resp = await nextMessage() as { result: { tools: Array<{ name: string }> } };
    const names = resp.result.tools.map((t) => t.name).sort();
    expect(names).toEqual(["convert", "convert_openapi", "list_corpora"]);
  });
});
