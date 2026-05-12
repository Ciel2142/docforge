import PQueue from "p-queue";
import { load as loadHtml } from "cheerio";
import { fetchUrl, FetchError, type FetchOptions } from "./fetch.js";
import { normalizeUrl, sameOrigin } from "./url.js";
import type { Robots } from "./robots.js";
import { log } from "../log.js";

export interface CrawlOptions {
  maxPages: number;
  maxDepth: number;
  concurrency: number;
  userAgent: string;
  llmsFullMode: "auto" | "force" | "off";
  llmsIndexMode?: "auto" | "force" | "off";
  singlePage?: boolean;
  excludeHosts?: string[];
}

export interface CrawlItem {
  url: string;
  bytes: Buffer;
  contentType: string;
  error?: string;
}

export async function* crawlBfs(
  rootUrl: string,
  robots: Robots,
  fetchOpts: FetchOptions,
  crawlOpts: CrawlOptions,
): AsyncIterable<CrawlItem> {
  const root = normalizeUrl(rootUrl);
  if (!root) throw new Error(`invalid root url: ${rootUrl}`);

  const visited = new Set<string>([root]);
  const delaySeconds = robots.getCrawlDelay(crawlOpts.userAgent);
  const delayMs = Math.max(0, Math.min(10_000, delaySeconds * 1000));
  const queue =
    delayMs > 0
      ? new PQueue({
          concurrency: crawlOpts.concurrency,
          interval: delayMs,
          intervalCap: crawlOpts.concurrency,
        })
      : new PQueue({ concurrency: crawlOpts.concurrency });

  const frontier: { url: string; depth: number }[] = [{ url: root, depth: 0 }];
  const results: CrawlItem[] = [];
  let yielded = 0;

  while (frontier.length > 0 && yielded < crawlOpts.maxPages) {
    const batch = frontier.splice(0, frontier.length);
    await queue.addAll(
      batch.map((entry) => async () => {
        if (yielded >= crawlOpts.maxPages) return;
        let item: CrawlItem;
        try {
          const res = await fetchUrl(entry.url, fetchOpts);
          item = { url: entry.url, bytes: res.bytes, contentType: res.contentType };
        } catch (e) {
          if (e instanceof FetchError) {
            log("debug", `crawl fetch fail ${entry.url}: ${e.message}`);
            results.push({
              url: entry.url,
              bytes: Buffer.alloc(0),
              contentType: "",
              error: e.message,
            });
            return;
          }
          throw e;
        }
        results.push(item);
        if (entry.depth >= crawlOpts.maxDepth) return;
        if (!/^text\/html/i.test(item.contentType)) return;
        const links = extractLinks(item.bytes.toString("utf8"), entry.url);
        for (const link of links) {
          if (!sameOrigin(link, root)) continue;
          if (!robots.isAllowed(link, crawlOpts.userAgent)) continue;
          if (visited.has(link)) continue;
          visited.add(link);
          frontier.push({ url: link, depth: entry.depth + 1 });
        }
      }),
    );
    while (results.length > 0 && yielded < crawlOpts.maxPages) {
      yielded += 1;
      yield results.shift()!;
    }
  }
}

function extractLinks(html: string, baseUrl: string): string[] {
  const $ = loadHtml(html);
  const out: string[] = [];
  $("a[href]").each((_, el) => {
    const href = $(el).attr("href");
    if (!href) return;
    const normalized = normalizeUrl(href, baseUrl);
    if (normalized) out.push(normalized);
  });
  return out;
}
