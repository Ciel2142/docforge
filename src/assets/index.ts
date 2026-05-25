import { readFileSync } from "node:fs";
import { extname, join } from "node:path";
import { fileURLToPath } from "node:url";
import { fetchUrl, type FetchOptions } from "../http/fetch.js";
import { decodeDataUri } from "../vlm/index.js";
import { rewriteImageRefs } from "./core.js";
import type { AssetStore } from "./store.js";
import type { AssetStats } from "./types.js";

const SENTINEL_HOST = "docforge.invalid";
const MIME_EXT: Record<string, string> = {
  "image/png": "png",
  "image/jpeg": "jpg",
  "image/webp": "webp",
  "image/gif": "gif",
  "image/bmp": "bmp",
};

export interface AssetPassOptions {
  /** Needed for http(s) image sources. Absent for local-only runs. */
  fetchOpts?: FetchOptions;
  /** Local source root, used only to reverse the docforge.invalid sentinel. */
  sourceRoot?: string;
}

/** Extension from a path/URL pathname, query/hash stripped, lowercased, jpeg→jpg. */
function extFromPath(p: string): string {
  const clean = p.split(/[?#]/)[0] ?? p;
  const e = extname(clean).replace(/^\./, "").toLowerCase();
  return e === "jpeg" ? "jpg" : e;
}

/**
 * Rewrite savable image refs in `md` to Obsidian embeds, persisting bytes via
 * `store`. Resolves each ref's src against `docOrigin` and dispatches on scheme:
 * data: decode, file: read, http(s) fetch, docforge.invalid sentinel → on-disk
 * read under `sourceRoot`.
 */
export async function runAssetPass(
  md: string,
  docOrigin: string,
  opts: AssetPassOptions,
  store: AssetStore,
): Promise<{ md: string; stats: AssetStats }> {
  return rewriteImageRefs(md, {
    store: (bytes, ext) => store.save(bytes, ext),
    resolve: async (src) => {
      if (src.startsWith("data:")) {
        const img = decodeDataUri(src);
        const ext = MIME_EXT[img.mime];
        if (!ext) throw new Error(`unsupported data URI mime: ${img.mime}`);
        return { bytes: img.bytes, ext };
      }
      const u = new URL(src, docOrigin);

      if (u.protocol === "file:") {
        const path = fileURLToPath(u);
        return { bytes: readFileSync(path), ext: extFromPath(path) };
      }

      const isHttp = u.protocol === "http:" || u.protocol === "https:";
      if (isHttp && u.hostname === SENTINEL_HOST) {
        if (!opts.sourceRoot) throw new Error("sentinel image src without sourceRoot");
        const rel = decodeURIComponent(u.pathname).replace(/^\/+/, "");
        const path = join(opts.sourceRoot, rel);
        return { bytes: readFileSync(path), ext: extFromPath(path) };
      }

      if (isHttp) {
        if (!opts.fetchOpts) throw new Error("http image src without fetch options");
        const r = await fetchUrl(u.toString(), opts.fetchOpts);
        const mime = (r.contentType.split(";")[0] ?? "").trim();
        if (!mime.startsWith("image/")) throw new Error(`not an image (${r.contentType})`);
        const ext = MIME_EXT[mime] ?? extFromPath(u.pathname);
        if (!ext) throw new Error(`unknown image type: ${mime}`);
        return { bytes: r.bytes, ext };
      }

      throw new Error(`unsupported image scheme: ${u.protocol}`);
    },
  });
}
