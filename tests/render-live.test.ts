import { afterAll, beforeAll, describe, expect, test } from "vitest";
import { createServer, type Server } from "node:http";
import { AddressInfo } from "node:net";
import { FetchError } from "../src/http/fetch.js";
import { createRenderer } from "../src/http/render.js";

// Probe once at module load: playwright importable AND chromium launchable.
let available = false;
try {
  const pw = await import("playwright");
  const b = await pw.chromium.launch({ headless: true });
  await b.close();
  available = true;
} catch {
  // playwright or chromium missing — whole suite skips
}

const SHELL = `<!doctype html><html><head><script>
document.addEventListener("DOMContentLoaded", () => {
  document.getElementById("root").innerHTML =
    "<h1>Hydrated</h1><p>content injected by script at load time</p><a href=\\"/next\\">next</a>";
});
</script></head><body><div id="root"></div></body></html>`;

describe.skipIf(!available)("Renderer (live chromium)", () => {
  let server: Server;
  let base: string;
  let origin: string;
  const mainAuth: Array<string | undefined> = [];

  let xServer: Server; // cross-origin (different port = different origin)
  let xBase: string;
  const xAuth: Array<string | undefined> = [];

  beforeAll(async () => {
    server = createServer((req, res) => {
      mainAuth.push(req.headers.authorization);
      if (req.url === "/shell") {
        res.writeHead(200, { "Content-Type": "text/html" });
        res.end(SHELL);
      } else if (req.url === "/with-img") {
        res.writeHead(200, { "Content-Type": "text/html" });
        res.end(`<html><body><p>page</p><img src="${xBase}/pixel.png"></body></html>`);
      } else {
        res.writeHead(404);
        res.end();
      }
    });
    xServer = createServer((req, res) => {
      xAuth.push(req.headers.authorization);
      res.writeHead(200, { "Content-Type": "image/png" });
      res.end(Buffer.from([0x89, 0x50, 0x4e, 0x47]));
    });
    await new Promise<void>((r) => xServer.listen(0, r));
    xBase = `http://localhost:${(xServer.address() as AddressInfo).port}`;
    await new Promise<void>((r) => server.listen(0, r));
    base = `http://localhost:${(server.address() as AddressInfo).port}`;
    origin = base;
  });

  afterAll(async () => {
    await new Promise<void>((r) => server.close(() => r()));
    await new Promise<void>((r) => xServer.close(() => r()));
  });

  test("returns hydrated DOM including script-injected anchors", async () => {
    const renderer = await createRenderer({
      userAgent: "docforge-test/0",
      timeoutMs: 15_000,
      maxBytes: 10_000_000,
    });
    try {
      const res = await renderer.render(`${base}/shell`);
      const html = res.bytes.toString("utf8");
      expect(res.contentType).toBe("text/html");
      expect(html).toContain("Hydrated");
      expect(html).toContain('href="/next"');
    } finally {
      await renderer.close();
    }
  });

  test("rendered bytes over maxBytes throw FetchError", async () => {
    const renderer = await createRenderer({
      userAgent: "docforge-test/0",
      timeoutMs: 15_000,
      maxBytes: 10,
    });
    try {
      await expect(renderer.render(`${base}/shell`)).rejects.toBeInstanceOf(FetchError);
    } finally {
      await renderer.close();
    }
  });

  test("auth header sent only to matching origin, not cross-origin subresources", async () => {
    mainAuth.length = 0;
    xAuth.length = 0;
    const renderer = await createRenderer({
      userAgent: "docforge-test/0",
      timeoutMs: 15_000,
      maxBytes: 10_000_000,
      auth: { header: "Bearer secret-token", origin },
    });
    try {
      await renderer.render(`${base}/with-img`);
      expect(mainAuth.some((h) => h === "Bearer secret-token")).toBe(true);
      expect(xAuth.every((h) => h === undefined)).toBe(true);
      expect(xAuth.length).toBeGreaterThan(0); // the pixel WAS fetched
    } finally {
      await renderer.close();
    }
  });

  test("relaunches once after browser death and serves the page", async () => {
    const renderer = await createRenderer({
      userAgent: "docforge-test/0",
      timeoutMs: 15_000,
      maxBytes: 10_000_000,
    });
    try {
      await renderer.render(`${base}/shell`); // first launch
      // simulate crash: reach into the private browser handle and kill it
      const inner = (renderer as unknown as { browser: { close(): Promise<void> } }).browser;
      await inner.close();
      const res = await renderer.render(`${base}/shell`); // must relaunch + retry
      expect(res.bytes.toString("utf8")).toContain("Hydrated");
    } finally {
      await renderer.close();
    }
  });
});
