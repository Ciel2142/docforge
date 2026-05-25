import { join } from "node:path";
import { imageSize as sizeOf } from "image-size";
import { Keyv } from "keyv";
import { KeyvFile } from "keyv-file";
import { fetchUrl, type FetchOptions } from "../http/fetch.js";
import { callVlm, PROMPT_VERSION } from "./client.js";
import { describeImages } from "./describe.js";
import type { DescribeStats, FetchedImage, VlmCache, VlmOptions } from "./types.js";

/** One shared cache instance per cacheDir, so concurrent/sequential passes don't race the JSON file. */
const cacheByDir = new Map<string, VlmCache>();

function makeCache(cacheDir: string | null): VlmCache | undefined {
  if (!cacheDir) return undefined;
  const existing = cacheByDir.get(cacheDir);
  if (existing) return existing;
  const kv = new Keyv<string>({ store: new KeyvFile({ filename: join(cacheDir, "vlm.json") }) });
  const cache: VlmCache = {
    get: (k) => kv.get(k) as Promise<string | undefined>,
    set: async (k, v) => {
      await kv.set(k, v);
    },
  };
  cacheByDir.set(cacheDir, cache);
  return cache;
}

export function decodeDataUri(src: string): FetchedImage {
  const m = /^data:([^;,]+)(;base64)?,(.*)$/s.exec(src);
  if (!m) throw new Error("malformed data URI");
  const mime = m[1] ?? "application/octet-stream";
  const data = m[3] ?? "";
  const bytes = m[2] ? Buffer.from(data, "base64") : Buffer.from(decodeURIComponent(data), "utf8");
  return { bytes, mime };
}

/**
 * Run the VLM image-description pass over a converted Markdown body, wiring the
 * real fetch client (cache + auth inherited), VLM client, image-size, and cache.
 */
export async function runVlmPass(
  md: string,
  pageUrl: string,
  vlm: VlmOptions,
  fetchOpts: FetchOptions,
): Promise<{ md: string; stats: DescribeStats }> {
  const cache = makeCache(fetchOpts.cacheDir);
  return describeImages(md, pageUrl, vlm, {
    fetchImage: async (url): Promise<FetchedImage> => {
      if (url.startsWith("data:")) return decodeDataUri(url);
      const r = await fetchUrl(url, fetchOpts);
      const mime = (r.contentType.split(";")[0] ?? "").trim();
      if (!mime.startsWith("image/")) throw new Error(`not an image (${r.contentType})`);
      return { bytes: r.bytes, mime };
    },
    describe: (image, context) => callVlm(vlm, image, context),
    sizeOf: (bytes) => {
      try {
        const d = sizeOf(bytes);
        const out: { width?: number; height?: number } = {};
        if (typeof d.width === "number") out.width = d.width;
        if (typeof d.height === "number") out.height = d.height;
        return out;
      } catch {
        return {};
      }
    },
    ...(cache ? { cache } : {}),
    promptVersion: PROMPT_VERSION,
  });
}
