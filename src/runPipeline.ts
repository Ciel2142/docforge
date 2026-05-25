import { existsSync, lstatSync, mkdirSync } from "node:fs";
import { basename, dirname, extname, relative, resolve, sep } from "node:path";

import { convertHtml } from "./convert.js";
import { extractTitle } from "./title.js";
import { rewriteInternalLinks, stripHeadingAnchors, delocalizeLinks, LOCAL_BASE } from "./links.js";
import { buildObsidianOutput, toObsidianWikilinks } from "./obsidian.js";
import {
  buildOutput,
  writeOutput,
  urlToOutputPath,
  relativizeSameOriginLinks,
  type ReportEntry,
} from "./output.js";
import { log } from "./log.js";
import { runOpenapiPipeline } from "./openapi/pipeline.js";
import { FilesystemSource, HttpSource, type Source, type SourceItem } from "./source.js";
import type { FetchOptions } from "./http/fetch.js";
import type { CrawlOptions } from "./http/crawl.js";
import { runVlmPass } from "./vlm/index.js";
import type { VlmOptions, DescribeStats } from "./vlm/types.js";
import { AssetStore } from "./assets/store.js";
import { runAssetPass } from "./assets/index.js";
import type { AssetStats } from "./assets/types.js";

export interface RunPipelineOptions {
  source: string;
  outputDir: string;
  maxBytes: number;
  dryRun: boolean;
  fetchOptions?: FetchOptions;
  crawlOptions?: CrawlOptions;
  selector?: string;
  vlm?: VlmOptions;
  format?: "default" | "obsidian";
  saveImages?: boolean;
}

export interface PipelineResult {
  converted: number;
  empty: number;
  skipped: number;
  failed: number;
  report: ReportEntry[];
  vlm?: DescribeStats;
  assets?: AssetStats;
}

function isUrl(s: string): boolean {
  return /^https?:\/\//i.test(s);
}

function computeOutputPath(item: SourceItem, outputDir: string): string {
  if (item.kind === "llms-full") {
    return resolve(outputDir, "llms-full.md");
  }
  if (item.outputKey) {
    return resolve(outputDir, item.outputKey);
  }
  if (item.srcUri.startsWith("http://") || item.srcUri.startsWith("https://")) {
    return urlToOutputPath(item.srcUri, outputDir);
  }
  const outRel = item.key.replace(/\.html?$/i, ".md");
  return resolve(outputDir, outRel);
}

export async function runPipeline(
  opts: RunPipelineOptions,
  signal?: AbortSignal,
): Promise<PipelineResult> {
  mkdirSync(opts.outputDir, { recursive: true });
  const format = opts.format ?? "default";

  let source: Source;
  let sourceRoot: string | undefined;
  if (isUrl(opts.source)) {
    if (!opts.fetchOptions || !opts.crawlOptions) {
      throw new Error("URL sources require fetchOptions and crawlOptions");
    }
    if (opts.fetchOptions.cacheDir) {
      try {
        mkdirSync(opts.fetchOptions.cacheDir, { recursive: true });
      } catch (e) {
        log("warn", `cache dir not writable: ${(e as Error).message}`);
      }
    }
    source = new HttpSource(opts.source, opts.fetchOptions, opts.crawlOptions);
  } else {
    const fsPath = resolve(opts.source);
    if (!existsSync(fsPath)) throw new Error(`source not found: ${fsPath}`);
    const st = lstatSync(fsPath);
    if (!st.isFile() && !st.isDirectory()) {
      throw new Error(`source is neither file nor directory: ${fsPath}`);
    }
    sourceRoot = st.isFile() ? dirname(fsPath) : fsPath;
    source = new FilesystemSource(fsPath, opts.maxBytes);
  }

  let converted = 0;
  let empty = 0;
  let failed = 0;
  const report: ReportEntry[] = [];
  const vlmStats: DescribeStats = { described: 0, skipped: 0, failed: 0, cached: 0 };
  const assetStore =
    format === "obsidian" && opts.saveImages ? new AssetStore(opts.outputDir) : undefined;
  const assetStats: AssetStats = { saved: 0, deduped: 0, skipped: 0, failed: 0 };
  const outputsUsed = new Map<string, string>();

  for await (const item of source.iter()) {
    if (signal?.aborted) throw new Error("aborted");

    const outPath = computeOutputPath(item, opts.outputDir);
    const prior = outputsUsed.get(outPath);
    if (prior && prior !== item.srcUri) {
      throw new Error(`output path collision: ${outPath} from ${prior} AND ${item.srcUri}`);
    }
    outputsUsed.set(outPath, item.srcUri);

    if (item.error) {
      failed += 1;
      log("error", `FAIL fetch ${item.key}: ${item.error}`);
      report.push({
        input: item.key, srcUri: item.srcUri, output: null,
        status: "failed", error: item.error,
      });
      continue;
    }

    if (item.kind === "llms-full" || item.kind === "markdown") {
      if (opts.dryRun) {
        log("info", `DRY ${item.key} -> ${outPath}`);
        continue;
      }
      const raw = item.bytes.toString("utf8");
      let md: string;
      if (format === "obsidian") {
        const fromRel = relative(opts.outputDir, outPath).split(sep).join("/");
        const stem = basename(item.key, extname(item.key)) || "index";
        const provenance = /^https?:\/\//i.test(item.srcUri) ? item.srcUri : item.key;
        let body = stripHeadingAnchors(toObsidianWikilinks(raw, fromRel));
        if (assetStore && opts.fetchOptions) {
          const ap = await runAssetPass(body, item.srcUri, { fetchOpts: opts.fetchOptions }, assetStore);
          body = ap.md;
          assetStats.saved += ap.stats.saved;
          assetStats.deduped += ap.stats.deduped;
          assetStats.skipped += ap.stats.skipped;
          assetStats.failed += ap.stats.failed;
        }
        md = buildObsidianOutput(stem, provenance, body);
      } else {
        md = stripHeadingAnchors(rewriteInternalLinks(raw));
      }
      writeOutput(outPath, md);
      converted += 1;
      report.push({ input: item.key, srcUri: item.srcUri, output: outPath, status: "ok" });
      continue;
    }

    if (item.kind === "openapi") {
      if (!item.spec) {
        failed += 1;
        log("error", `FAIL openapi ${item.key}: spec not pre-parsed`);
        report.push({
          input: item.key, srcUri: item.srcUri, output: null,
          status: "failed", error: "spec not pre-parsed",
        });
        continue;
      }
      const specDir = outPath.replace(/(\.(json|ya?ml))?\.md$/i, "");
      if (opts.dryRun) {
        log("info", `DRY openapi ${item.key} -> ${specDir}/`);
        continue;
      }
      try {
        const oaResult = await runOpenapiPipeline({
          source: item.srcUri,
          outputDir: specDir,
          spec: item.spec,
        });
        log(
          "info",
          `openapi ${item.key}: endpoints=${oaResult.endpoints} schemas=${oaResult.schemas}`,
        );
        converted += 1;
        report.push({
          input: item.key, srcUri: item.srcUri, output: specDir, status: "ok",
        });
      } catch (e) {
        failed += 1;
        const err = e instanceof Error ? e.message : String(e);
        log("error", `FAIL openapi ${item.key}: ${err}`);
        report.push({
          input: item.key, srcUri: item.srcUri, output: null,
          status: "failed", error: err,
        });
      }
      continue;
    }

    if (opts.dryRun) {
      log("info", `DRY ${item.key} -> ${outPath}`);
      continue;
    }

    const convertOpts: { selector?: string; url?: string } = {};
    if (opts.selector !== undefined) convertOpts.selector = opts.selector;
    if (item.srcUri.startsWith("http://") || item.srcUri.startsWith("https://")) {
      convertOpts.url = item.srcUri;
    } else {
      // Local source: give Defuddle a structure-preserving base so relative
      // internal links resolve correctly (empty base → `about:blank/...`).
      convertOpts.url = LOCAL_BASE + encodeURI(item.key.split(sep).join("/"));
    }
    const result = await convertHtml(item.bytes.toString("utf8"), convertOpts);
    if (result.status === "empty") {
      empty += 1;
      log("debug", `empty ${item.key}`);
      report.push({ input: item.key, srcUri: item.srcUri, output: null, status: "empty" });
      continue;
    }
    if (result.status === "failed") {
      failed += 1;
      log("error", `FAIL ${item.key}: ${result.error}`);
      report.push({
        input: item.key, srcUri: item.srcUri, output: null,
        status: "failed", error: result.error,
      });
      continue;
    }

    const stem = basename(item.key, extname(item.key)) || "index";
    const title = extractTitle(result.h1_text, result.soup_title_text, stem);
    const fromRel = relative(opts.outputDir, outPath).split(sep).join("/");
    const isUrlSource = isUrl(item.srcUri);
    const normalizedLinks = isUrlSource
      ? relativizeSameOriginLinks(result.body_md, item.srcUri)
      : delocalizeLinks(result.body_md, fromRel);
    let bodyMd =
      format === "obsidian"
        ? toObsidianWikilinks(normalizedLinks, fromRel)
        : rewriteInternalLinks(normalizedLinks);
    if (
      opts.vlm &&
      opts.fetchOptions &&
      (item.srcUri.startsWith("http://") || item.srcUri.startsWith("https://"))
    ) {
      try {
        const vlmResult = await runVlmPass(bodyMd, item.srcUri, opts.vlm, opts.fetchOptions);
        bodyMd = vlmResult.md;
        vlmStats.described += vlmResult.stats.described;
        vlmStats.skipped += vlmResult.stats.skipped;
        vlmStats.failed += vlmResult.stats.failed;
        vlmStats.cached += vlmResult.stats.cached;
      } catch (e) {
        const err = e instanceof Error ? e.message : String(e);
        log("warn", `vlm pass failed for ${item.key}: ${err}`);
      }
    }
    if (assetStore) {
      const ap = await runAssetPass(
        bodyMd,
        item.srcUri,
        {
          ...(opts.fetchOptions ? { fetchOpts: opts.fetchOptions } : {}),
          ...(sourceRoot ? { sourceRoot } : {}),
        },
        assetStore,
      );
      bodyMd = ap.md;
      assetStats.saved += ap.stats.saved;
      assetStats.deduped += ap.stats.deduped;
      assetStats.skipped += ap.stats.skipped;
      assetStats.failed += ap.stats.failed;
    }
    const provenance = /^https?:\/\//i.test(item.srcUri) ? item.srcUri : item.key;
    const content =
      format === "obsidian"
        ? buildObsidianOutput(title, provenance, bodyMd)
        : buildOutput(title, item.key, bodyMd);
    writeOutput(outPath, content);
    converted += 1;
    report.push({ input: item.key, srcUri: item.srcUri, output: outPath, status: "ok" });
  }

  return {
    converted,
    empty,
    skipped: source.skippedCount,
    failed,
    report,
    ...(opts.vlm ? { vlm: vlmStats } : {}),
    ...(assetStore ? { assets: assetStats } : {}),
  };
}
