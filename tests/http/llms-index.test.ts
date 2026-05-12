import { afterAll, beforeAll, describe, expect, test } from "vitest";
import { createServer, type Server } from "node:http";
import type { AddressInfo } from "node:net";
import { parseLlmsTxt, probeLlmsTxt } from "../../src/http/llms-index.js";

describe("parseLlmsTxt", () => {
  test("empty text yields no links", () => {
    expect(parseLlmsTxt("", "https://x.com/llms.txt")).toEqual({ links: [] });
  });

  test("extracts title, tagline, and one link", () => {
    const md = `# Project

> Short tagline describing the project.

## Docs

- [Quickstart](https://example.com/quickstart): get started fast
`;
    const out = parseLlmsTxt(md, "https://example.com/llms.txt");
    expect(out.title).toBe("Project");
    expect(out.tagline).toBe("Short tagline describing the project.");
    expect(out.links).toHaveLength(1);
    expect(out.links[0]).toEqual({
      url: "https://example.com/quickstart",
      title: "Quickstart",
      section: "Docs",
      description: "get started fast",
    });
  });

  test("resolves relative URLs against baseUrl", () => {
    const md = `# x

## Docs

- [Home](/index.html)
- [Sibling](./other.html)
`;
    const out = parseLlmsTxt(md, "https://example.com/docs/llms.txt");
    expect(out.links.map((l) => l.url).sort()).toEqual([
      "https://example.com/docs/other.html",
      "https://example.com/index.html",
    ]);
  });

  test("preserves cross-origin links", () => {
    const md = `# x

## Docs

- [Docs](https://docs.example.com/intro)
- [API](https://api.example.com/openapi.json)
`;
    const out = parseLlmsTxt(md, "https://example.com/llms.txt");
    expect(out.links.map((l) => l.url)).toEqual([
      "https://docs.example.com/intro",
      "https://api.example.com/openapi.json",
    ]);
  });

  test("groups links by section, includes Optional", () => {
    const md = `# x

## Docs

- [A](https://x.com/a)

## Optional

- [B](https://x.com/b)
`;
    const out = parseLlmsTxt(md, "https://x.com/llms.txt");
    expect(out.links).toEqual([
      { url: "https://x.com/a", title: "A", section: "Docs" },
      { url: "https://x.com/b", title: "B", section: "Optional" },
    ]);
  });

  test("ignores links inside fenced code blocks", () => {
    const md = `# x

## Docs

- [Real](https://x.com/real)

\`\`\`
- [Fake](https://x.com/fake)
\`\`\`

- [AlsoReal](https://x.com/also)
`;
    const out = parseLlmsTxt(md, "https://x.com/llms.txt");
    expect(out.links.map((l) => l.url)).toEqual([
      "https://x.com/real",
      "https://x.com/also",
    ]);
  });

  test("dedupes repeated links", () => {
    const md = `# x

- [Dup](https://x.com/a)
- [Dup again](https://x.com/a)
`;
    const out = parseLlmsTxt(md, "https://x.com/llms.txt");
    expect(out.links).toHaveLength(1);
    expect(out.links[0].url).toBe("https://x.com/a");
  });

  test("supports * bullets in addition to -", () => {
    const md = `# x

* [Star](https://x.com/star)
- [Dash](https://x.com/dash)
`;
    const out = parseLlmsTxt(md, "https://x.com/llms.txt");
    expect(out.links.map((l) => l.url)).toEqual([
      "https://x.com/star",
      "https://x.com/dash",
    ]);
  });
});

let server: Server;
let port: number;
let pages: Record<string, { status: number; ctype: string; body: string }> = {};

beforeAll(async () => {
  server = createServer((req, res) => {
    const r = pages[req.url ?? ""];
    if (!r) {
      res.writeHead(404);
      res.end();
      return;
    }
    res.writeHead(r.status, { "Content-Type": r.ctype });
    res.end(r.body);
  });
  await new Promise<void>((resolve) => server.listen(0, resolve));
  port = (server.address() as AddressInfo).port;
});

afterAll(async () => {
  await new Promise<void>((resolve) => server.close(() => resolve()));
});

describe("probeLlmsTxt", () => {
  test("returns null when 404", async () => {
    pages = {};
    const out = await probeLlmsTxt(`http://localhost:${port}/`, {
      userAgent: "t",
      timeoutMs: 1_000,
      maxBytes: 1_000_000,
      cacheDir: null,
    });
    expect(out).toBeNull();
  });

  test("returns null when content-type is not text/*", async () => {
    pages = {
      "/llms.txt": { status: 200, ctype: "application/octet-stream", body: "- [x](https://x.com/a)" },
    };
    const out = await probeLlmsTxt(`http://localhost:${port}/`, {
      userAgent: "t",
      timeoutMs: 1_000,
      maxBytes: 1_000_000,
      cacheDir: null,
    });
    expect(out).toBeNull();
  });

  test("returns null when text has no links", async () => {
    pages = {
      "/llms.txt": { status: 200, ctype: "text/plain", body: "# x\n\nNo links here.\n" },
    };
    const out = await probeLlmsTxt(`http://localhost:${port}/`, {
      userAgent: "t",
      timeoutMs: 1_000,
      maxBytes: 1_000_000,
      cacheDir: null,
    });
    expect(out).toBeNull();
  });

  test("returns parsed index on 200 with links", async () => {
    pages = {
      "/llms.txt": {
        status: 200,
        ctype: "text/plain; charset=utf-8",
        body: `# Project\n\n> tagline\n\n## Docs\n\n- [A](https://example.com/a)\n`,
      },
    };
    const out = await probeLlmsTxt(`http://localhost:${port}/`, {
      userAgent: "t",
      timeoutMs: 1_000,
      maxBytes: 1_000_000,
      cacheDir: null,
    });
    expect(out).not.toBeNull();
    expect(out!.url).toBe(`http://localhost:${port}/llms.txt`);
    expect(out!.parsed.title).toBe("Project");
    expect(out!.parsed.links).toHaveLength(1);
    expect(out!.parsed.links[0].url).toBe("https://example.com/a");
  });
});
