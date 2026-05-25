/** Byte ranges (start inclusive, end exclusive) covered by ``` / ~~~ fences. */
export function fenceRanges(md: string): Array<[number, number]> {
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

/** True when offset i falls within any [start, end) range. */
export function inAnyRange(i: number, ranges: Array<[number, number]>): boolean {
  return ranges.some(([s, e]) => i >= s && i < e);
}
