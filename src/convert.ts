import { type CheerioAPI, type Cheerio, load } from "cheerio";
import type { Element } from "domhandler";
import { extractBytesSync, type ExtractionConfig } from "@kreuzberg/node";

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

function selectBody($: CheerioAPI): Cheerio<Element> | null {
  const direct = $('div[itemprop="articleBody"]').first();
  if (direct.length > 0) return direct;

  const main = $('div[role="main"]').first();
  if (main.length === 0) return null;

  const inner = main.find('div[itemprop="articleBody"]').first();
  return inner.length > 0 ? inner : main;
}

function stripSphinxNoise(body: Cheerio<Element>): void {
  body.find("a.headerlink").remove();
  body.find("a.viewcode-link").remove();
}

function h1Text(body: Cheerio<Element>): string | null {
  const h1 = body.find("h1").first();
  if (h1.length === 0) return null;
  const text = h1.text().trim().replace(/¶+$/, "").trim();
  return text || null;
}

function soupTitleText($: CheerioAPI): string | null {
  const t = $("title").first();
  if (t.length === 0) return null;
  const text = t.text().trim();
  return text || null;
}

export function convertHtml(rawHtml: string): ConvertResult {
  try {
    const $ = load(rawHtml, { xml: false });
    const body = selectBody($);
    if (body === null) return { status: "empty" };

    const h1 = h1Text(body);
    const title = soupTitleText($);
    stripSphinxNoise(body);

    const serialized = $.html(body);
    const result = extractBytesSync(
      Buffer.from(serialized, "utf8"),
      "text/html",
      KZ_CONFIG,
    );
    return {
      status: "ok",
      body_md: result.content.trim(),
      h1_text: h1,
      soup_title_text: title,
    };
  } catch (e) {
    const err = e instanceof Error ? `${e.name}: ${e.message}` : String(e);
    return { status: "failed", error: err };
  }
}

export const __testing__ = {
  selectBody,
  stripSphinxNoise,
  h1Text,
  soupTitleText,
};
