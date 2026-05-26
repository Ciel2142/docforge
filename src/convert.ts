import { extractBytesSync, type ExtractionConfig } from "@kreuzberg/node";
import { parseHTML } from "linkedom";
import { extractMainContent, type ExtractOptions } from "./extract.js";
import { swapComplexTables, restoreTables } from "./tables.js";

const KZ_CONFIG: ExtractionConfig = {
  useCache: false,
  outputFormat: "markdown",
};

export type ConvertResult =
  | {
      status: "ok";
      body_md: string;
      h1_text: string | null;
      soup_title_text: string | null;
    }
  | { status: "empty" }
  | { status: "failed"; error: string };

export interface ConvertOptions {
  selector?: string;
  url?: string;
}

function extractH1(rawHtml: string, selector?: string): string | null {
  const { document } = parseHTML(rawHtml);
  // When a CSS selector override is active, scope H1 lookup to that element.
  // Otherwise prefer articleBody scope → role=main → main → body, in that priority order.
  // We extract from rawHtml (before Defuddle) because Defuddle demotes H1→H2 in cleanedHtml.
  let scope: Element | null | undefined;
  if (selector !== undefined) {
    scope = document.querySelector(selector);
  } else {
    const articleBody = document.querySelector('[itemprop="articleBody"]');
    const main =
      document.querySelector('[role="main"]') ?? document.querySelector("main");
    scope = articleBody ?? main ?? document.body;
  }
  const h1 = scope?.querySelector("h1");
  if (!h1) return null;
  const text = (h1.textContent ?? "").trim().replace(/¶+$/u, "").trim();
  return text || null;
}

function extractTitle(rawHtml: string): string | null {
  const { document } = parseHTML(rawHtml);
  const t = document.querySelector("title");
  if (!t) return null;
  const text = (t.textContent ?? "").trim();
  return text || null;
}

export async function convertHtml(
  rawHtml: string,
  opts: ConvertOptions = {},
): Promise<ConvertResult> {
  try {
    const extractOpts: ExtractOptions = {};
    if (opts.selector !== undefined) extractOpts.selector = opts.selector;
    if (opts.url !== undefined) extractOpts.url = opts.url;
    const extracted = await extractMainContent(rawHtml, extractOpts);
    if (extracted.status === "empty") return { status: "empty" };

    const soupTitle = extractTitle(rawHtml);
    const h1 = extractH1(rawHtml, opts.selector);

    const { html, placeholders } = swapComplexTables(extracted.cleanedHtml);
    const result = extractBytesSync(
      Buffer.from(html, "utf8"),
      "text/html",
      KZ_CONFIG,
    );
    const body_md = restoreTables(result.content.trim(), placeholders);

    return {
      status: "ok",
      body_md,
      h1_text: h1,
      soup_title_text: soupTitle,
    };
  } catch (e) {
    const err = e instanceof Error ? `${e.name}: ${e.message}` : String(e);
    return { status: "failed", error: err };
  }
}
