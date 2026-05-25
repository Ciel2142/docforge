import { findImageRefs, isSavable } from "../vlm/select.js";
import type { AssetStats, RewriteDeps } from "./types.js";

interface Edit {
  index: number;
  length: number;
  insert: string;
}

/**
 * Replace each savable raster image ref in `md` with an Obsidian embed
 * `![[<filename>]]`, persisting bytes through `deps`. Pure given its deps.
 * Non-raster refs are skipped (left intact); resolve failures leave the ref
 * intact and count as failed.
 */
export async function rewriteImageRefs(
  md: string,
  deps: RewriteDeps,
): Promise<{ md: string; stats: AssetStats }> {
  const stats: AssetStats = { saved: 0, deduped: 0, skipped: 0, failed: 0 };
  const edits: Edit[] = [];

  for (const ref of findImageRefs(md)) {
    if (!isSavable(ref.src)) {
      stats.skipped++;
      continue;
    }
    try {
      const { bytes, ext } = await deps.resolve(ref.src);
      const { filename, deduped } = deps.store(bytes, ext);
      if (deduped) stats.deduped++;
      else stats.saved++;
      edits.push({ index: ref.index, length: ref.match.length, insert: `![[${filename}]]` });
    } catch {
      stats.failed++;
    }
  }

  // Apply edits from the end so earlier indices stay valid.
  edits.sort((a, b) => b.index - a.index);
  let out = md;
  for (const e of edits) {
    out = out.slice(0, e.index) + e.insert + out.slice(e.index + e.length);
  }
  return { md: out, stats };
}
