import { lstatSync, readFileSync } from "node:fs";
import { dirname, relative } from "node:path";
import { pathToFileURL } from "node:url";

import { load as yamlLoad } from "js-yaml";
import PQueue from "p-queue";

import { iterHtmlFiles } from "./walk.js";
import { fetchUrl, FetchError, type FetchOptions } from "./http/fetch.js";
import { getRobots } from "./http/robots.js";
import { discoverSitemaps } from "./http/sitemap.js";
import { crawlBfs, type CrawlOptions } from "./http/crawl.js";
import { normalizeUrl } from "./http/url.js";
import { probeLlmsFullTxt } from "./http/llms.js";
import { probeLlmsTxt, type LlmsIndexEntry } from "./http/llms-index.js";
import { log } from "./log.js";

export interface SourceItem {
  key: string;
  srcUri: string;
  bytes: Buffer;
  contentType: string;
  error?: string;          // set when fetch failed; convert loop counts as failed
  kind?: "html" | "llms-full" | "markdown" | "openapi";
  outputKey?: string;      // when set, runPipeline uses this for output path (host-prefixed for cross-origin)
  spec?: Record<string, unknown>; // parsed OpenAPI 3.x spec when kind === "openapi"
}

function isPlainObject(x: unknown): x is Record<string, unknown> {
  return x !== null && typeof x === "object" && !Array.isArray(x);
}

function isOpenapiCandidate(contentType: string, url: string): boolean {
  const ct = contentType.toLowerCase();
  if (/^application\/(json|yaml|x-yaml)/.test(ct)) return true;
  if (/^application\/vnd\.oai\.openapi(\+(json|yaml))?/.test(ct)) return true;
  if (/^text\/(yaml|x-yaml)/.test(ct)) return true;
  try {
    const path = new URL(url).pathname.toLowerCase();
    if (/\.(json|ya?ml)$/.test(path)) return true;
  } catch {
    // ignore
  }
  return false;
}

function tryParseOpenapiSpec(
  bytes: Buffer,
  contentType: string,
  url: string,
): Record<string, unknown> | null {
  const body = bytes.toString("utf8");
  let parsed: unknown;
  let urlPath = "";
  try {
    urlPath = new URL(url).pathname.toLowerCase();
  } catch {
    urlPath = "";
  }
  const ct = contentType.toLowerCase();
  const looksJson = ct.includes("json") || /\.json$/i.test(urlPath);
  try {
    parsed = looksJson ? JSON.parse(body) : yamlLoad(body);
  } catch {
    return null;
  }
  if (!isPlainObject(parsed)) return null;
  if ("swagger" in parsed) return null; // 2.0 not supported
  const version = parsed.openapi;
  if (typeof version !== "string" || !version.startsWith("3.")) return null;
  return parsed;
}

function maybeOpenapiItem(
  url: string,
  res: { bytes: Buffer; contentType: string },
  outputKey?: string,
): SourceItem | null {
  if (!isOpenapiCandidate(res.contentType, url)) return null;
  const spec = tryParseOpenapiSpec(res.bytes, res.contentType, url);
  if (!spec) return null;
  const item: SourceItem = {
    key: pathFromUrl(url),
    srcUri: url,
    bytes: res.bytes,
    contentType: res.contentType,
    kind: "openapi",
    spec,
  };
  if (outputKey) item.outputKey = outputKey;
  return item;
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

    if (this.crawlOpts.singlePage) {
      try {
        const res = await fetchUrl(normalized, this.fetchOpts);
        if (!/^text\/html/i.test(res.contentType)) {
          const oa = maybeOpenapiItem(normalized, res);
          if (oa) {
            yield oa;
            return;
          }
          this.skippedCount += 1;
          return;
        }
        yield {
          key: pathFromUrl(normalized),
          srcUri: normalized,
          bytes: res.bytes,
          contentType: res.contentType,
        };
      } catch (e) {
        if (e instanceof FetchError) {
          yield {
            key: pathFromUrl(normalized),
            srcUri: normalized,
            bytes: Buffer.alloc(0),
            contentType: "",
            error: e.message,
          };
          return;
        }
        throw e;
      }
      return;
    }

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

    if ((this.crawlOpts.llmsIndexMode ?? "auto") !== "off") {
      const idx = await probeLlmsTxt(normalized, this.fetchOpts);
      if (idx) {
        yield* this.iterFromLlmsIndex(idx.parsed.links);
        return;
      }
      if (this.crawlOpts.llmsIndexMode === "force") {
        throw new Error(
          `llms.txt required (--llms-index force) but not found at ${this.rootUrl}`,
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
          const oa = maybeOpenapiItem(url, res);
          if (oa) {
            buffered.push(oa);
            return;
          }
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

  private async *iterFromLlmsIndex(
    entries: LlmsIndexEntry[],
  ): AsyncIterable<SourceItem> {
    const robotsByOrigin = new Map<string, { isAllowed(url: string, ua: string): boolean }>();
    const limited = entries.slice(0, this.crawlOpts.maxPages);
    const buffered: SourceItem[] = [];
    const queue = new PQueue({ concurrency: this.crawlOpts.concurrency });
    const ua = this.crawlOpts.userAgent;
    const deny = this.crawlOpts.excludeHosts ?? [];
    const tasks = limited.map((entry) => async () => {
      try {
        const linkHost = new URL(entry.url).hostname.toLowerCase();
        if (isHostDenied(linkHost, deny)) {
          this.skippedCount += 1;
          return;
        }
        const linkOrigin = new URL(entry.url).origin;
        let robots = robotsByOrigin.get(linkOrigin);
        if (!robots) {
          robots = await getRobots(linkOrigin, this.fetchOpts);
          robotsByOrigin.set(linkOrigin, robots);
        }
        if (!robots.isAllowed(entry.url, ua)) {
          this.skippedCount += 1;
          return;
        }
        const res = await fetchUrl(entry.url, this.fetchOpts);
        const ct = res.contentType.toLowerCase();
        const isHtml = /^text\/html/.test(ct);
        const isMarkdown = /^text\/(markdown|x-markdown)/.test(ct);
        if (!isHtml && !isMarkdown) {
          const oa = maybeOpenapiItem(entry.url, res, hostPrefixedKey(entry.url));
          if (oa) {
            buffered.push(oa);
            return;
          }
          this.skippedCount += 1;
          return;
        }
        const item: SourceItem = {
          key: pathFromUrl(entry.url),
          srcUri: entry.url,
          bytes: res.bytes,
          contentType: res.contentType,
          outputKey: hostPrefixedKey(entry.url),
        };
        if (isMarkdown) item.kind = "markdown";
        buffered.push(item);
      } catch (e) {
        if (e instanceof FetchError) {
          log("debug", `llms-index fetch fail ${entry.url}: ${e.message}`);
          buffered.push({
            key: pathFromUrl(entry.url),
            srcUri: entry.url,
            bytes: Buffer.alloc(0),
            contentType: "",
            error: e.message,
            outputKey: hostPrefixedKey(entry.url),
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
        const oa = maybeOpenapiItem(item.url, {
          bytes: item.bytes,
          contentType: item.contentType,
        });
        if (oa) {
          yield oa;
          continue;
        }
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

function hostPrefixedKey(url: string): string {
  const u = new URL(url);
  const host = u.hostname.toLowerCase();
  let path = decodeURIComponent(u.pathname);
  if (path.endsWith("/") || path === "") path = `${path}index.md`;
  else if (/\.html?$/i.test(path)) path = path.replace(/\.html?$/i, ".md");
  else if (/\.md$/i.test(path)) { /* already .md */ }
  else path = `${path}.md`;
  const sanitized = path.split("/").map(safeSeg).filter(Boolean).join("/");
  return `${host}/${sanitized}`;
}

function safeSeg(seg: string): string {
  return seg.replace(/[<>:"|?*\0]/g, "_");
}

export function isHostDenied(host: string, deny: readonly string[]): boolean {
  const h = host.toLowerCase();
  for (const raw of deny) {
    const x = raw.toLowerCase().trim();
    if (!x) continue;
    if (h === x) return true;
    if (h.endsWith("." + x)) return true;
  }
  return false;
}
