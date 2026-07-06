import { load as loadHtml } from "cheerio";

export const JS_RENDERED_TEXT_THRESHOLD = 200;

/**
 * Cheap signal that a page is a client-rendered shell: after dropping
 * script/style/noscript/template, almost no visible body text remains.
 * False positives (legitimately tiny pages) cost one wasted render.
 * False negatives are escape-hatched by --render force.
 */
export function looksJsRendered(html: string): boolean {
  const $ = loadHtml(html);
  $("script, style, noscript, template").remove();
  const text = $("body").text().replace(/\s+/g, " ").trim();
  return text.length < JS_RENDERED_TEXT_THRESHOLD;
}
