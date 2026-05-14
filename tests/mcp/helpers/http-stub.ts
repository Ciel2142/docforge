import { createServer, type Server } from "node:http";

export interface StubRoute {
  path: string;
  status?: number;
  contentType?: string;
  body: string;
}

export interface StubRequest {
  path: string;
  authorization: string | undefined;
}

export interface StubServer {
  url: string;
  origin: string;
  requests: StubRequest[];
  close(): Promise<void>;
}

export async function startStub(routes: StubRoute[]): Promise<StubServer> {
  const map = new Map<string, StubRoute>();
  for (const r of routes) map.set(r.path, r);
  const requests: StubRequest[] = [];

  const server: Server = createServer((req, res) => {
    const path = (req.url ?? "/").split("?")[0] ?? "/";
    requests.push({
      path,
      authorization: req.headers["authorization"] as string | undefined,
    });
    const route = map.get(path);
    if (!route) {
      res.writeHead(404, { "content-type": "text/plain" }).end("not found");
      return;
    }
    res.writeHead(route.status ?? 200, {
      "content-type": route.contentType ?? "text/html; charset=utf-8",
    });
    res.end(route.body);
  });
  await new Promise<void>(r => server.listen(0, "127.0.0.1", r));
  const addr = server.address();
  if (!addr || typeof addr === "string") throw new Error("bad address");
  const origin = `http://127.0.0.1:${addr.port}`;
  return {
    url: origin + "/",
    origin,
    requests,
    close: () => new Promise<void>(r => server.close(() => r())),
  };
}
