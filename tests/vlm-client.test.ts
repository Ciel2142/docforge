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
