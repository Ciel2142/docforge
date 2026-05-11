import { parseHTML } from "linkedom";
import { Defuddle } from "defuddle/node";
import type { DefuddleOptions } from "defuddle";

export interface ExtractOptions {
  selector?: string;
  url?: string;
}

export type ExtractResult =
  | {
      status: "ok";
      cleanedHtml: string;
      title: string | null;
      wordCount: number;
    }
  | { status: "empty" };

export async function extractMainContent(
  rawHtml: string,
  opts: ExtractOptions = {},
): Promise<ExtractResult> {
  const { document } = parseHTML(rawHtml);

  const defuddleOpts: DefuddleOptions = {
    markdown: false,
    removePartialSelectors: true,
  };
  if (opts.selector !== undefined) defuddleOpts.contentSelector = opts.selector;
  if (opts.url !== undefined) defuddleOpts.url = opts.url;

  const result = await Defuddle(
    // linkedom returns its own Document-ish type; cast through `unknown` because lib.dom's Document is structurally narrower (e.g. some optional fields differ).
    document as unknown as Document,
    opts.url ?? "",
    defuddleOpts,
  );

  if (!result?.content || result.wordCount < 5) {
    return { status: "empty" };
  }
  return {
    status: "ok",
    cleanedHtml: result.content,
    title: result.title ? result.title : null,
    wordCount: result.wordCount,
  };
}
