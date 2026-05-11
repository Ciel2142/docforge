export const PREVIEW_BYTES_DEFAULT = 8192;
export const PREVIEW_BYTES_MIN = 256;
export const PREVIEW_BYTES_MAX = 65536;

export function clampPreviewBytes(input: number | undefined): number {
  if (input === undefined) return PREVIEW_BYTES_DEFAULT;
  if (input < PREVIEW_BYTES_MIN) return PREVIEW_BYTES_MIN;
  if (input > PREVIEW_BYTES_MAX) return PREVIEW_BYTES_MAX;
  return Math.floor(input);
}

export interface TruncatedMarkdown {
  markdown: string;
  truncated: boolean;
}

export function truncateMarkdown(text: string, limitBytes: number): TruncatedMarkdown {
  const buf = Buffer.from(text, "utf8");
  if (buf.length <= limitBytes) return { markdown: text, truncated: false };

  let end = limitBytes;
  // Walk back to avoid splitting a UTF-8 continuation byte.
  while (end > 0 && ((buf[end] ?? 0) & 0xc0) === 0x80) end -= 1;
  // If we landed on a multi-byte lead byte without all its continuations, step back one more.
  if (end > 0) {
    const lead = buf[end];
    if (lead !== undefined && lead >= 0xc0) end -= 1;
  }
  const sliced = buf.subarray(0, Math.max(0, end + 1)).toString("utf8");
  return { markdown: sliced, truncated: true };
}
