import { Command } from "commander";
import { existsSync, lstatSync, mkdirSync } from "node:fs";
import { basename, extname, resolve } from "node:path";

import { VERSION } from "./index.js";
import { convertHtml } from "./convert.js";
import { extractTitle } from "./title.js";
import { rewriteInternalLinks } from "./links.js";
import {
  buildOutput,
  writeOutput,
  writeReportJson,
  urlToOutputPath,
  type ReportEntry,
} from "./output.js";
import { log, setLevel } from "./log.js";
import { registerOpenapiSubcommand } from "./openapi/cli.js";
import { FilesystemSource, HttpSource, type Source, type SourceItem } from "./source.js";
import type { FetchOptions } from "./http/fetch.js";
import type { CrawlOptions } from "./http/crawl.js";

const DEFAULT_USER_AGENT = `docforge/${VERSION}`;
const DEFAULT_CACHE_DIR = "~/.cache/docforge";

export function buildProgram(): Command {
  const program = new Command();
  program
    .name("docforge")
    .description("Convert documentation sources to Markdown for RAG ingestion.")
    .version(VERSION, "--version", "print version and exit")
    .option("-v, --verbose", "DEBUG-level logging")
    .option("-q, --quiet", "WARNING-level logging")
    .hook("preAction", (thisCommand) => {
      const opts = thisCommand.opts<{ verbose?: boolean | undefined; quiet?: boolean | undefined }>();
      if (opts.verbose) setLevel("debug");
      else if (opts.quiet) setLevel("warn");
    });

  program
    .command("convert")
    .description("Convert HTML (filesystem path or http(s) URL) to Markdown")
    .argument("<source>", "filesystem path OR http(s):// URL")
    .requiredOption("--output <dir>", "output directory")
    .option("--fail-threshold <ratio>", "max acceptable failure ratio before exit 1", "0.10")
    .option("--max-bytes <int>", "skip HTML files/responses larger than N bytes", "10485760")
    .option("--dry-run", "walk + report planned outputs, write nothing", false)
    .option("--report-json <path>", "write per-file report JSON to <path>")
    .option("--max-pages <N>", "max URLs to fetch (URL source only)", "5000")
    .option("--max-depth <N>", "max BFS depth (URL source only)", "10")
    .option("--concurrency <N>", "parallel fetches (URL source only)", "4")
    .option("--cache-dir <path>", "ETag cache directory (URL source only)", DEFAULT_CACHE_DIR)
    .option("--no-cache", "disable ETag cache (URL source only)")
    .option("--user-agent <str>", "User-Agent header (URL source only)", DEFAULT_USER_AGENT)
    .option("--selector <css>", "CSS selector override for body extraction (Defuddle contentSelector)")
    .option("--llms-full <mode>", "llms-full.txt mode: auto|force|off (URL source only)", "auto")
    .action(async (source: string, opts: ConvertOpts) => {
      const code = await runConvert(source, opts);
      if (code !== 0) process.exit(code);
    });

  registerOpenapiSubcommand(program);

  return program;
}

interface ConvertOpts {
  output: string;
  failThreshold: string;
  maxBytes: string;
  dryRun: boolean;
  reportJson?: string | undefined;
  maxPages: string;
  maxDepth: string;
  concurrency: string;
  cacheDir: string;
  cache: boolean; // commander --no-cache → cache: false
  userAgent: string;
  selector?: string | undefined;
  llmsFull: string;
}

function isUrl(s: string): boolean {
  return /^https?:\/\//i.test(s);
}

export async function runConvert(sourceArg: string, opts: ConvertOpts): Promise<number> {
  const output = resolve(expandHome(opts.output));
  try {
    mkdirSync(output, { recursive: true });
  } catch (e) {
    log("error", `cannot create output dir ${output}: ${(e as Error).message}`);
    return 2;
  }

  const maxBytes = parseInt(opts.maxBytes, 10);
  const failThreshold = parseFloat(opts.failThreshold);

  let source: Source;
  if (isUrl(sourceArg)) {
    const fetchOpts: FetchOptions = {
      userAgent: opts.userAgent,
      timeoutMs: 30_000,
      maxBytes,
      cacheDir: opts.cache ? expandHome(opts.cacheDir) : null,
    };
    const crawlOpts: CrawlOptions = {
      maxPages: parseInt(opts.maxPages, 10),
      maxDepth: parseInt(opts.maxDepth, 10),
      concurrency: parseInt(opts.concurrency, 10),
      userAgent: opts.userAgent,
      llmsFullMode: opts.llmsFull as "auto" | "force" | "off",
    };
    if (fetchOpts.cacheDir) {
      try {
        mkdirSync(fetchOpts.cacheDir, { recursive: true });
      } catch (e) {
        log("warn", `cache dir not writable, continuing without cache: ${(e as Error).message}`);
        fetchOpts.cacheDir = null;
      }
    }
    source = new HttpSource(sourceArg, fetchOpts, crawlOpts);
  } else {
    const fsPath = resolve(expandHome(sourceArg));
    if (!existsSync(fsPath)) {
      log("error", `source not found: ${fsPath}`);
      return 2;
    }
    const st = lstatSync(fsPath);
    if (!st.isFile() && !st.isDirectory()) {
      log("error", `source is neither file nor directory: ${fsPath}`);
      return 2;
    }
    source = new FilesystemSource(fsPath, maxBytes);
  }

  let converted = 0;
  let empty = 0;
  let failed = 0;
  const report: ReportEntry[] = [];
  const outputsUsed = new Map<string, string>(); // outPath -> srcUri (for runtime collision)

  for await (const item of source.iter()) {
    const outPath = computeOutputPath(item, output);
    const prior = outputsUsed.get(outPath);
    if (prior && prior !== item.srcUri) {
      log("error", `output path collision: ${outPath} from ${prior} AND ${item.srcUri}`);
      return 2;
    }
    outputsUsed.set(outPath, item.srcUri);

    if (item.error) {
      failed += 1;
      log("error", `FAIL fetch ${item.key}: ${item.error}`);
      report.push({
        input: item.key,
        srcUri: item.srcUri,
        output: null,
        status: "failed",
        error: item.error,
      });
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
        input: item.key,
        srcUri: item.srcUri,
        output: null,
        status: "failed",
        error: result.error,
      });
      continue;
    }

    const stem = basename(item.key, extname(item.key)) || "index";
    const title = extractTitle(result.h1_text, result.soup_title_text, stem);
    const bodyMd = rewriteInternalLinks(result.body_md);
    const content = buildOutput(title, item.key, bodyMd);
    writeOutput(outPath, content);
    converted += 1;
    report.push({ input: item.key, srcUri: item.srcUri, output: outPath, status: "ok" });
  }

  const skipped = source.skippedCount;
  const total = converted + empty + failed;

  if (opts.reportJson) {
    writeReportJson(resolve(expandHome(opts.reportJson)), report);
  }

  log(
    "info",
    `converted=${converted} empty=${empty} skipped=${skipped} failed=${failed} total=${total}`,
  );

  if (total > 0 && failed / total > failThreshold) {
    log(
      "error",
      `failure ratio ${(failed / total).toFixed(3)} exceeds threshold ${failThreshold.toFixed(3)}`,
    );
    return 1;
  }
  return 0;
}

function computeOutputPath(item: SourceItem, outputDir: string): string {
  if (item.srcUri.startsWith("http://") || item.srcUri.startsWith("https://")) {
    return urlToOutputPath(item.srcUri, outputDir);
  }
  // filesystem: mirror item.key under outputDir, .html → .md
  const outRel = item.key.replace(/\.html?$/i, ".md");
  return resolve(outputDir, outRel);
}

function expandHome(p: string): string {
  if (p.startsWith("~/") || p === "~") {
    const home = process.env.HOME ?? process.env.USERPROFILE ?? "";
    return p.replace(/^~/, home);
  }
  return p;
}

export async function main(argv: string[]): Promise<number> {
  const program = buildProgram();
  await program.parseAsync(argv, { from: "user" });
  return 0;
}
