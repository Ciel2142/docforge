import { createHash } from "node:crypto";
import { createServer, type Server, type IncomingMessage, type ServerResponse } from "node:http";
import { readFileSync, statSync, existsSync } from "node:fs";
import { extname, join, resolve } from "node:path";
import { AddressInfo } from "node:net";

export interface StaticServerOptions {
  rootDir: string;
  rewriteBase?: boolean;            // replace __BASE__ in served bodies (for sitemap.xml)
  inject?: Record<string, { status: number; body?: string }>; // per-URL overrides
}

export interface RunningServer {
  port: number;
  baseUrl: string;
  close(): Promise<void>;
  hits: string[];
}

const TYPES: Record<string, string> = {
  ".html": "text/html; charset=utf-8",
  ".xml": "application/xml; charset=utf-8",
  ".txt": "text/plain; charset=utf-8",
  ".css": "text/css; charset=utf-8",
};

export async function startStaticServer(options: StaticServerOptions): Promise<RunningServer> {
  const hits: string[] = [];
  let baseUrl = "";

  const handler = (req: IncomingMessage, res: ServerResponse) => {
    const url = req.url ?? "/";
    hits.push(url);

    const override = options.inject?.[url];
    if (override) {
      res.writeHead(override.status, { "Content-Type": "text/html" });
      res.end(override.body ?? "");
      return;
    }

    let relPath = url.split("?")[0];
    if (relPath.endsWith("/")) relPath += "index.html";
    const filePath = resolve(join(options.rootDir, relPath));
    if (!filePath.startsWith(resolve(options.rootDir))) {
      res.writeHead(403);
      res.end();
      return;
    }
    if (!existsSync(filePath)) {
      res.writeHead(404);
      res.end();
      return;
    }
    const st = statSync(filePath);
    if (!st.isFile()) {
      res.writeHead(404);
      res.end();
      return;
    }
    let body = readFileSync(filePath);
    if (options.rewriteBase && (filePath.endsWith(".xml") || filePath.endsWith(".txt"))) {
      body = Buffer.from(body.toString("utf8").replace(/__BASE__/g, baseUrl));
    }
    const etag = `"${createHash("sha1").update(body).digest("hex").slice(0, 16)}"`;
    if (req.headers["if-none-match"] === etag) {
      res.writeHead(304, { ETag: etag });
      res.end();
      return;
    }
    const ctype = TYPES[extname(filePath).toLowerCase()] ?? "application/octet-stream";
    res.writeHead(200, { "Content-Type": ctype, ETag: etag });
    res.end(body);
  };

  const server: Server = createServer(handler);
  await new Promise<void>((resolve) => server.listen(0, resolve));
  const port = (server.address() as AddressInfo).port;
  baseUrl = `http://localhost:${port}`;

  return {
    port,
    baseUrl,
    hits,
    close: () => new Promise<void>((resolve) => server.close(() => resolve())),
  };
}
