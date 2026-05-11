import { parseHTML } from "linkedom";
import { Defuddle } from "defuddle/node";

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

  const defuddleOpts: Record<string, unknown> = {
    markdown: false,
    removePartialSelectors: true,
  };
  if (opts.selector !== undefined) defuddleOpts.contentSelector = opts.selector;
  if (opts.url !== undefined) defuddleOpts.url = opts.url;

  const result = await Defuddle(
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
