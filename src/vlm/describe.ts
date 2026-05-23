import { createHash } from "node:crypto";
import PQueue from "p-queue";
import { findImageRefs, isDescribable } from "./select.js";
import type { DescribeDeps, DescribeStats, VlmOptions } from "./types.js";

/** Build the caption block injected after an image ref. */
export function captionBlock(alt: string, description: string): string {
  const label = alt.trim() || "image";
  const clean = description.replace(/\s+/g, " ").trim();
  return `\n\n> **Figure — ${label}.** ${clean}`;
}

function resolveSrc(src: string, pageUrl: string): string | null {
  if (src.startsWith("data:")) return src;
  try {
    return new URL(src, pageUrl).toString();
  } catch {
    return null;
  }
}

function buildContext(md: string, index: number, alt: string): string {
  const before = md.slice(0, index);
  const lines = before.split("\n");
  let heading = "";
  for (let i = lines.length - 1; i >= 0; i--) {
    const line = lines[i] ?? "";
    if (/^#{1,6}\s+/.test(line)) {
      heading = line.replace(/^#{1,6}\s+/, "").replace(/\s+#*\s*$/, "").trim();
      break;
    }
  }
  const snippet = before.slice(-200).replace(/\s+/g, " ").trim();
  const parts: string[] = [];
  if (heading) parts.push(`Section: ${heading}`);
  const altClean = alt.trim();
  if (altClean) parts.push(`Alt text: ${altClean}`);
  if (snippet) parts.push(`Preceding text: …${snippet}`);
  return parts.join("\n");
}

interface Edit {
  index: number;
  length: number;
  insert: string;
}

/**
 * Describe informative images in `md` and inject caption blocks after them.
 * All I/O is supplied via `deps`, so this is pure given its dependencies.
 */
export async function describeImages(
  md: string,
  pageUrl: string,
  vlm: VlmOptions,
  deps: DescribeDeps,
): Promise<{ md: string; stats: DescribeStats }> {
  const stats: DescribeStats = { described: 0, skipped: 0, failed: 0, cached: 0 };
  const all = findImageRefs(md);
  const eligible = all.filter((r) => isDescribable(r.src));
  const capped = eligible.slice(0, vlm.maxImages);
  // Everything not attempted (non-eligible + over the cap) counts as skipped.
  stats.skipped = all.length - capped.length;

  const edits: Edit[] = [];
  const queue = new PQueue({ concurrency: vlm.concurrency });

  await Promise.all(
    capped.map((ref) =>
      queue.add(async () => {
        try {
          const url = resolveSrc(ref.src, pageUrl);
          if (!url) {
            stats.skipped++;
            return;
          }
          const image = await deps.fetchImage(url);
          const dim = deps.sizeOf(image.bytes);
          const maxSide = Math.max(dim.width ?? 0, dim.height ?? 0);
          if (maxSide > 0 && maxSide < vlm.minDim) {
            stats.skipped++;
            return;
          }
          const hash = createHash("sha256").update(image.bytes).digest("hex");
          const key = `${hash}:${vlm.model}:${deps.promptVersion}`;
          const hit = await deps.cache?.get(key);
          let description: string;
          if (hit !== undefined) {
            description = hit;
            stats.cached++;
          } else {
            description = await deps.describe(image, buildContext(md, ref.index, ref.alt));
            await deps.cache?.set(key, description);
            stats.described++;
          }
          edits.push({ index: ref.index, length: ref.match.length, insert: captionBlock(ref.alt, description) });
        } catch {
          stats.failed++;
        }
      }),
    ),
  );

  // Apply edits from the end so earlier indices stay valid.
  edits.sort((a, b) => b.index - a.index);
  let out = md;
  for (const e of edits) {
    const at = e.index + e.length;
    out = out.slice(0, at) + e.insert + out.slice(at);
  }
  return { md: out, stats };
}
