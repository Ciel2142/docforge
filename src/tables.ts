export interface Placeholder {
  token: string;
  html: string;
}

export interface SwapResult {
  html: string;
  placeholders: Placeholder[];
}

/** Re-insert each stashed HTML table where its placeholder landed in the Markdown. */
export function restoreTables(markdown: string, placeholders: Placeholder[]): string {
  if (placeholders.length === 0) return markdown;
  let out = markdown;
  for (const { token, html } of placeholders) {
    out = out.replaceAll(token, `\n\n${html}\n\n`);
  }
  return out.replace(/\n{3,}/g, "\n\n").trim();
}
