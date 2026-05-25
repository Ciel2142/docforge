import type { ImageRef } from "./types.js";
import { fenceRanges, inAnyRange } from "../md-fences.js";

const NAME_SKIP = /(icon|logo|sprite|badge|avatar|emoji|spacer|pixel)/i;
const RASTER_EXT = /\.(png|jpe?g|webp|gif|bmp)(?:[?#]|$)/i;
const RASTER_DATA = /^data:image\/(png|jpe?g|webp|gif|bmp)/i;

/** Find inline Markdown image refs, ignoring those inside fenced code blocks. */
export function findImageRefs(md: string): ImageRef[] {
  const fences = fenceRanges(md);
  const re = /!\[([^\]]*)\]\(([^)]+)\)/g;
  const refs: ImageRef[] = [];
  let m: RegExpExecArray | null;
  while ((m = re.exec(md)) !== null) {
    if (inAnyRange(m.index, fences)) continue;
    const alt = m[1] ?? "";
    const inner = (m[2] ?? "").trim();
    const src = inner.split(/\s+/)[0] ?? "";
    refs.push({ match: m[0], alt, src, index: m.index });
  }
  return refs;
}

/** True when an image src looks like an informative raster image worth describing. */
export function isDescribable(src: string): boolean {
  if (src.startsWith("data:")) return RASTER_DATA.test(src);
  if (NAME_SKIP.test(src)) return false;
  return RASTER_EXT.test(src);
}

/** True when an image src is a raster we can save as a sidecar asset. Unlike
 *  isDescribable, this does NOT skip decorative names (logo/icon/…): a vault
 *  should keep those images too. */
export function isSavable(src: string): boolean {
  if (src.startsWith("data:")) return RASTER_DATA.test(src);
  return RASTER_EXT.test(src);
}
