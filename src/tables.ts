import { parseHTML } from "linkedom";

export interface Placeholder {
  token: string;
  html: string;
}

export interface SwapResult {
  html: string;
  placeholders: Placeholder[];
}

/**
 * Replace tables GFM cannot represent with placeholder paragraphs, returning
 * their sanitized HTML so the caller can re-insert it after the HTML->Markdown step.
 */
export function swapComplexTables(cleanedHtml: string): SwapResult {
  const { document } = parseHTML(cleanedHtml);
  const doc = document as unknown as Document;
  const placeholders: Placeholder[] = [];
  const runId = Math.random().toString(36).slice(2, 8);
  let swapped = false;
  for (const table of Array.from(doc.querySelectorAll("table"))) {
    if (!isComplexTable(table)) continue;
    sanitizeTable(table);
    const token = `DOCFORGETABLE${runId}N${placeholders.length}END`;
    placeholders.push({ token, html: table.outerHTML });
    const marker = doc.createElement("p");
    marker.textContent = token;
    table.replaceWith(marker);
    swapped = true;
  }
  return { html: swapped ? doc.toString() : cleanedHtml, placeholders };
}

function isComplexTable(_table: Element): boolean {
  return false; // real classification added in Task 3
}

function sanitizeTable(_table: Element): void {
  // real sanitization added in Task 4
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
