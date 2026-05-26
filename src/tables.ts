import { parseHTML } from "linkedom";

/** Block-level elements that, inside a cell, make GFM unable to represent the table. */
const BLOCK_IN_CELL =
  "ul,ol,p,table,pre,blockquote,div,h1,h2,h3,h4,h5,h6,hr,figure,figcaption";

/** Elements allowed to remain inside an emitted HTML table. Anything else is unwrapped to its children. */
const ALLOWED_TAGS = new Set([
  "table", "thead", "tbody", "tfoot", "tr", "th", "td",
  "strong", "em", "b", "i", "u", "s", "code", "a", "br", "ul", "ol", "li", "p", "sup", "sub",
]);

/** Elements removed wholesale (content dropped, not unwrapped). */
const DROP_TAGS = new Set([
  "script", "style", "iframe", "object", "embed", "noscript", "template",
]);

const KEEP_ATTRS_CELL = new Set(["colspan", "rowspan", "scope"]);
const KEEP_ATTRS_LINK = new Set(["href"]);

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

function isComplexTable(table: Element): boolean {
  for (const cell of Array.from(table.querySelectorAll("th,td"))) {
    const colspan = parseInt(cell.getAttribute("colspan") ?? "1", 10);
    const rowspan = parseInt(cell.getAttribute("rowspan") ?? "1", 10);
    if (colspan >= 2 || rowspan >= 2) return true;
    if (cell.querySelector(BLOCK_IN_CELL)) return true;
  }
  return false;
}

function sanitizeTable(table: Element): void {
  for (const el of Array.from(table.querySelectorAll("*"))) {
    const tag = el.tagName.toLowerCase();
    if (DROP_TAGS.has(tag)) {
      el.remove();
      continue;
    }
    if (!ALLOWED_TAGS.has(tag)) {
      el.replaceWith(...Array.from(el.childNodes));
      continue;
    }
    const keep = tag === "a" ? KEEP_ATTRS_LINK : KEEP_ATTRS_CELL;
    for (const name of Array.from(el.attributes).map((a) => a.name)) {
      if (!keep.has(name)) el.removeAttribute(name);
    }
  }
  for (const name of Array.from(table.attributes).map((a) => a.name)) {
    table.removeAttribute(name);
  }
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
