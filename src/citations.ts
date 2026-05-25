import { fenceRanges, inAnyRange } from "./md-fences.js";

// External markdown link [text](http(s)://…), NOT an image (negative lookbehind on `!`).
// The http(s) scheme requirement naturally excludes internal/.md, mailto:, anchor-only,
// and bare relative links — by this pipeline stage only external links remain in this form.
const EXTERNAL_LINK_RE = /(?<!!)\[([^\]]*)\]\((https?:\/\/[^)\s]+)\)/g;

/**
 * Convert external inline Markdown links to `[^n]` footnotes and append a
 * `## References` definition block. Identical URLs share one footnote. Links
 * inside fenced code blocks, images, and bare-URL anchors are left untouched.
 * Returns the rewritten Markdown and the number of distinct footnotes created
 * (0 → input returned unchanged, no heading appended).
 */
export function convertLinksToFootnotes(md: string): { md: string; count: number } {
  const fences = fenceRanges(md);
  const order: string[] = []; // URLs in first-seen order; index = position + 1
  const indexByUrl = new Map<string, number>();

  const body = md.replace(
    EXTERNAL_LINK_RE,
    (match: string, text: string, url: string, offset: number): string => {
      if (inAnyRange(offset, fences)) return match; // inside a code fence
      if (text.trim() === url) return match; // bare-URL anchor — converting is pure redundancy
      let idx = indexByUrl.get(url);
      if (idx === undefined) {
        idx = order.length + 1;
        indexByUrl.set(url, idx);
        order.push(url);
      }
      return `${text}[^${idx}]`;
    },
  );

  if (order.length === 0) return { md, count: 0 };

  const refs = order.map((url, i) => `[^${i + 1}]: ${url}`).join("\n");
  return {
    md: `${body.trimEnd()}\n\n## References\n\n${refs}\n`,
    count: order.length,
  };
}
