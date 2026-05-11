import { join } from "node:path";
import got, { type Got, type OptionsOfTextResponseBody, RequestError, HTTPError, TimeoutError } from "got";
import { KeyvFile } from "keyv-file";
import { CompatKeyv } from "./compat-keyv.js";

export class FetchError extends Error {
  public status: number | null;
  constructor(message: string, status: number | null = null, cause?: unknown) {
    super(message);
    this.name = "FetchError";
    this.status = status;
    if (cause !== undefined) (this as Error & { cause?: unknown }).cause = cause;
  }
}

export interface FetchResult {
  status: number;
  bytes: Buffer;
  contentType: string;
  etag: string | null;
  fromCache: boolean;
}

export interface FetchOptions {
  userAgent: string;
  timeoutMs: number;
  maxBytes: number;
  cacheDir: string | null;
}

let cached: { dir: string; client: Got } | null = null;
let nocacheClient: Got | null = null;

function makeClient(opts: FetchOptions): Got {
  const base: OptionsOfTextResponseBody = {
    headers: { "user-agent": opts.userAgent },
    timeout: { request: opts.timeoutMs },
    retry: { limit: 2, methods: ["GET"], statusCodes: [408, 429, 500, 502, 503, 504] },
    throwHttpErrors: false,
    responseType: "buffer" as unknown as "text",
    decompress: true,
  };
  if (opts.cacheDir === null) {
    if (!nocacheClient) nocacheClient = got.extend(base);
    return nocacheClient;
  }
  if (cached && cached.dir === opts.cacheDir) return cached.client;
  const store = new KeyvFile({ filename: join(opts.cacheDir, "responses.json") });
  const keyv = new CompatKeyv({ store });
  const client = got.extend({ ...base, cache: keyv as unknown as Map<string, unknown> });
  cached = { dir: opts.cacheDir, client };
  return client;
}

export async function fetchUrl(url: string, opts: FetchOptions): Promise<FetchResult> {
  const client = makeClient(opts);
  let res;
  try {
    res = await client.get(url, {
      headers: { "user-agent": opts.userAgent },
      timeout: { request: opts.timeoutMs },
    });
  } catch (e) {
    if (e instanceof TimeoutError) throw new FetchError(`timeout fetching ${url}`, null, e);
    if (e instanceof RequestError) {
      const status =
        e instanceof HTTPError ? e.response.statusCode : null;
      throw new FetchError(`fetch failed ${url}: ${e.message}`, status, e);
    }
    throw new FetchError(`fetch failed ${url}: ${(e as Error).message}`, null, e);
  }

  if (res.statusCode >= 400) {
    throw new FetchError(`HTTP ${res.statusCode} for ${url}`, res.statusCode);
  }
  const body = Buffer.isBuffer(res.rawBody) ? res.rawBody : Buffer.from(res.rawBody);
  if (body.length > opts.maxBytes) {
    throw new FetchError(
      `body ${body.length} bytes exceeds maxBytes ${opts.maxBytes} for ${url}`,
      res.statusCode,
    );
  }
  const contentType = (res.headers["content-type"] as string | undefined) ?? "application/octet-stream";
  const etag = (res.headers["etag"] as string | undefined) ?? null;
  return {
    status: res.statusCode,
    bytes: body,
    contentType,
    etag,
    fromCache: res.isFromCache === true,
  };
}
