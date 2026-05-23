import type { ImageRef } from "./types.js";

const NAME_SKIP = /(icon|logo|sprite|badge|avatar|emoji|spacer|pixel)/i;
const RASTER_EXT = /\.(png|jpe?g|webp|gif|bmp)(?:[?#]|$)/i;
const RASTER_DATA = /^data:image\/(png|jpe?g|webp|gif|bmp)/i;

/** Byte ranges (start inclusive, end exclusive) covered by ``` / ~~~ fences. */
function fenceRanges(md: string): Array<[number, number]> {
  const ranges: Array<[number, number]> = [];
  let offset = 0;
  let fenceStart = -1;
  for (const line of md.split("\n")) {
    if (/^\s*(```|~~~)/.test(line)) {
      if (fenceStart === -1) fenceStart = offset;
      else {
        ranges.push([fenceStart, offset + line.length]);
        fenceStart = -1;
      }
    }
    offset += line.length + 1; // +1 for the consumed "\n"
  }
  if (fenceStart !== -1) ranges.push([fenceStart, md.length]);
  return ranges;
}

function inAnyRange(i: number, ranges: Array<[number, number]>): boolean {
  return ranges.some(([s, e]) => i >= s && i < e);
}

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
