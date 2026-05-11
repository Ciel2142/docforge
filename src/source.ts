import { lstatSync, readFileSync } from "node:fs";
import { dirname, relative } from "node:path";
import { pathToFileURL } from "node:url";

import PQueue from "p-queue";

import { iterHtmlFiles } from "./walk.js";
import { fetchUrl, FetchError, type FetchOptions } from "./http/fetch.js";
import { getRobots } from "./http/robots.js";
import { discoverSitemaps } from "./http/sitemap.js";
import { crawlBfs, type CrawlOptions } from "./http/crawl.js";
import { normalizeUrl } from "./http/url.js";
import { probeLlmsFullTxt } from "./http/llms.js";
import { log } from "./log.js";

export interface SourceItem {
  key: string;
  srcUri: string;
  bytes: Buffer;
  contentType: string;
  error?: string;          // set when fetch failed; convert loop counts as failed
  kind?: "html" | "llms-full";
}

export interface Source {
  iter(): AsyncIterable<SourceItem>;
  readonly skippedCount: number;
}

export class FilesystemSource implements Source {
  public skippedCount = 0;
  constructor(
    private readonly source: string,
    private readonly maxBytes: number,
  ) {}

  async *iter(): AsyncIterable<SourceItem> {
    const walk = iterHtmlFiles(this.source, this.maxBytes);
    this.skippedCount = walk.skippedCount;

    const st = lstatSync(this.source);
    const sourceRoot = st.isFile() ? dirname(this.source) : this.source;

    for (const path of walk.paths) {
      const rel = relative(sourceRoot, path).split(/[\\/]/).join("/");
      yield {
        key: rel,
        srcUri: pathToFileURL(path).toString(),
        bytes: readFileSync(path),
        contentType: "text/html",
      };
    }
  }
}

export class HttpSource implements Source {
  public skippedCount = 0;
  constructor(
    private readonly rootUrl: string,
    private readonly fetchOpts: FetchOptions,
    private readonly crawlOpts: CrawlOptions,
  ) {}

  async *iter(): AsyncIterable<SourceItem> {
    const normalized = normalizeUrl(this.rootUrl);
    if (!normalized) throw new Error(`invalid root url: ${this.rootUrl}`);

    if (this.crawlOpts.llmsFullMode !== "off") {
      const llms = await probeLlmsFullTxt(normalized, this.fetchOpts);
      if (llms) {
        yield {
          key: "llms-full.txt",
          srcUri: llms.url,
          bytes: llms.bytes,
          contentType: llms.contentType,
          kind: "llms-full",
        };
        return;
      }
      if (this.crawlOpts.llmsFullMode === "force") {
        throw new Error(
          `llms-full.txt required (--llms-full force) but not found at ${this.rootUrl}`,
        );
      }
    }

    const origin = new URL(normalized).origin;
    const robots = await getRobots(origin, this.fetchOpts);
    const sitemapUrls = await discoverSitemaps(normalized, robots, this.fetchOpts);

    if (sitemapUrls.length > 0) {
      yield* this.iterFromSitemap(sitemapUrls, robots);
    } else {
      yield* this.iterFromBfs(robots);
    }
  }

  private async *iterFromSitemap(
    urls: string[],
    robots: { isAllowed(url: string, ua: string): boolean; getCrawlDelay(ua: string): number },
  ): AsyncIterable<SourceItem> {
    const origin = new URL(normalizeUrl(this.rootUrl)!).origin;
    const filtered: string[] = [];
    for (const u of urls) {
      const n = normalizeUrl(u);
      if (!n) continue;
      if (new URL(n).origin !== origin) continue;
      if (!robots.isAllowed(n, this.crawlOpts.userAgent)) continue;
      filtered.push(n);
    }
    const delayMs = Math.max(
      0,
      Math.min(10_000, robots.getCrawlDelay(this.crawlOpts.userAgent) * 1000),
    );
    const queue =
      delayMs > 0
        ? new PQueue({
            concurrency: this.crawlOpts.concurrency,
            interval: delayMs,
            intervalCap: this.crawlOpts.concurrency,
          })
        : new PQueue({ concurrency: this.crawlOpts.concurrency });
    const buffered: SourceItem[] = [];
    const tasks = filtered.slice(0, this.crawlOpts.maxPages).map((url) => async () => {
      try {
        const res = await fetchUrl(url, this.fetchOpts);
        if (!/^text\/html/i.test(res.contentType)) {
          this.skippedCount += 1;
          return;
        }
        buffered.push({
          key: pathFromUrl(url),
          srcUri: url,
          bytes: res.bytes,
          contentType: res.contentType,
        });
      } catch (e) {
        if (e instanceof FetchError) {
          log("debug", `sitemap fetch fail ${url}: ${e.message}`);
          buffered.push({
            key: pathFromUrl(url),
            srcUri: url,
            bytes: Buffer.alloc(0),
            contentType: "",
            error: e.message,
          });
          return;
        }
        throw e;
      }
    });
    await queue.addAll(tasks);
    for (const item of buffered) yield item;
  }

  private async *iterFromBfs(
    robots: { isAllowed(url: string, ua: string): boolean; getCrawlDelay(ua: string): number; getSitemaps(): string[] },
  ): AsyncIterable<SourceItem> {
    for await (const item of crawlBfs(this.rootUrl, robots, this.fetchOpts, this.crawlOpts)) {
      if (item.error) {
        yield {
          key: pathFromUrl(item.url),
          srcUri: item.url,
          bytes: Buffer.alloc(0),
          contentType: "",
          error: item.error,
        };
        continue;
      }
      if (!/^text\/html/i.test(item.contentType)) {
        this.skippedCount += 1;
        continue;
      }
      yield {
        key: pathFromUrl(item.url),
        srcUri: item.url,
        bytes: item.bytes,
        contentType: item.contentType,
      };
    }
  }
}

function pathFromUrl(url: string): string {
  const u = new URL(url);
  const p = decodeURIComponent(u.pathname);
  if (p === "" || p === "/") return "index.html";
  return p.replace(/^\/+/, "");
}
