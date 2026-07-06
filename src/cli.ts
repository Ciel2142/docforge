import { Command } from "commander";
import { mkdirSync } from "node:fs";
import { resolve } from "node:path";

import { VERSION } from "./index.js";
import { writeReportJson } from "./output.js";
import { log, setLevel } from "./log.js";
import { registerOpenapiSubcommand } from "./openapi/cli.js";
import { runPipeline, type RunPipelineOptions } from "./runPipeline.js";
import { scopePrefixFromSeed } from "./http/url.js";

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
    .option("--auth-header <value>", "Authorization header value sent to the root origin (URL source only). Warning: visible in process list and shell history.")
    .option("--selector <css>", "CSS selector override for body extraction (Defuddle contentSelector)")
    .option("--format <fmt>", "output format: default|obsidian", "default")
    .option("--save-images", "save referenced raster images beside the vault (--format obsidian only)", false)
    .option("--cite-links", "convert external links to [^n] footnotes + a ## References block", false)
    .option("--describe-images", "describe images via a VLM (URL source only)", false)
    .option("--vlm-base-url <url>", "OpenAI-compatible VLM base URL incl. /v1 (env DOCFORGE_VLM_BASE_URL)")
    .option("--vlm-model <name>", "VLM model id (env DOCFORGE_VLM_MODEL)")
    .option("--vlm-api-key <key>", "VLM API key (env DOCFORGE_VLM_API_KEY)")
    .option("--vlm-min-dim <px>", "skip images smaller than N px on the long side", "64")
    .option("--vlm-max-images <N>", "max images described per document", "50")
    .option("--vlm-concurrency <N>", "parallel VLM calls", "2")
    .option("--llms-full <mode>", "llms-full.txt mode: auto|force|off (URL source only)", "auto")
    .option("--scope <mode>", "crawl scope: path (seed path prefix) | origin (whole origin) (URL source only)", "path")
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
  scope?: string | undefined;
  authHeader?: string | undefined;
  describeImages?: boolean | undefined;
  vlmBaseUrl?: string | undefined;
  vlmModel?: string | undefined;
  vlmApiKey?: string | undefined;
  vlmMinDim?: string | undefined;
  vlmMaxImages?: string | undefined;
  vlmConcurrency?: string | undefined;
  format?: string | undefined;
  saveImages?: boolean | undefined;
  citeLinks?: boolean | undefined;
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

  const format = opts.format ?? "default";
  if (format !== "default" && format !== "obsidian") {
    log("error", `invalid --format value: ${opts.format} (expected default|obsidian)`);
    return 2;
  }

  const pipelineOpts: RunPipelineOptions = {
    source: isUrl(sourceArg) ? sourceArg : resolve(expandHome(sourceArg)),
    outputDir: output,
    maxBytes,
    dryRun: opts.dryRun,
  };
  if (opts.selector !== undefined) pipelineOpts.selector = opts.selector;
  pipelineOpts.format = format as "default" | "obsidian";
  if (opts.saveImages) {
    if (format === "obsidian") pipelineOpts.saveImages = true;
    else log("warn", "--save-images ignored unless --format obsidian");
  }
  if (opts.citeLinks) pipelineOpts.citeLinks = true;

  if (isUrl(sourceArg)) {
    const llmsFullMode = opts.llmsFull as "auto" | "force" | "off";
    if (llmsFullMode !== "auto" && llmsFullMode !== "force" && llmsFullMode !== "off") {
      log("error", `invalid --llms-full value: ${opts.llmsFull} (expected auto|force|off)`);
      return 2;
    }
    const scopeMode = opts.scope ?? "path";
    if (scopeMode !== "path" && scopeMode !== "origin") {
      log("error", `invalid --scope value: ${opts.scope} (expected path|origin)`);
      return 2;
    }
    pipelineOpts.fetchOptions = {
      userAgent: opts.userAgent,
      timeoutMs: 30_000,
      maxBytes,
      cacheDir: opts.cache ? expandHome(opts.cacheDir) : null,
    };
    if (opts.authHeader) {
      pipelineOpts.fetchOptions.auth = {
        header: opts.authHeader,
        origin: new URL(sourceArg).origin,
      };
    }
    const scopePrefix = scopeMode === "path" ? scopePrefixFromSeed(sourceArg) : null;
    pipelineOpts.crawlOptions = {
      maxPages: parseInt(opts.maxPages, 10),
      maxDepth: parseInt(opts.maxDepth, 10),
      concurrency: parseInt(opts.concurrency, 10),
      userAgent: opts.userAgent,
      llmsFullMode,
      ...(scopePrefix ? { scopePrefix } : {}),
    };
    if (opts.describeImages) {
      const baseUrl = opts.vlmBaseUrl ?? process.env.DOCFORGE_VLM_BASE_URL;
      const model = opts.vlmModel ?? process.env.DOCFORGE_VLM_MODEL;
      if (!baseUrl || !model) {
        log(
          "error",
          "--describe-images requires --vlm-base-url and --vlm-model (or DOCFORGE_VLM_BASE_URL / DOCFORGE_VLM_MODEL)",
        );
        return 2;
      }
      const apiKey = opts.vlmApiKey ?? process.env.DOCFORGE_VLM_API_KEY;
      const minDim = parseInt(opts.vlmMinDim ?? "64", 10);
      const maxImages = parseInt(opts.vlmMaxImages ?? "50", 10);
      const concurrency = parseInt(opts.vlmConcurrency ?? "2", 10);
      if (Number.isNaN(minDim) || Number.isNaN(maxImages) || Number.isNaN(concurrency)) {
        log("error", "--vlm-min-dim, --vlm-max-images, and --vlm-concurrency must be integers");
        return 2;
      }
      pipelineOpts.vlm = {
        baseUrl,
        model,
        minDim,
        maxImages,
        concurrency,
        timeoutMs: 60_000,
        ...(apiKey ? { apiKey } : {}),
      };
    }
  }

  if (opts.describeImages && !isUrl(sourceArg)) {
    log("warn", "--describe-images ignored for non-URL sources (v1 supports URL sources only)");
  }

  let result;
  try {
    result = await runPipeline(pipelineOpts);
  } catch (e) {
    log("error", (e as Error).message);
    return 2;
  }

  if (opts.reportJson) {
    writeReportJson(resolve(expandHome(opts.reportJson)), result.report);
  }

  const total = result.converted + result.empty + result.failed;
  log(
    "info",
    `converted=${result.converted} empty=${result.empty} skipped=${result.skipped} failed=${result.failed} total=${total}`,
  );

  if (result.vlm) {
    log(
      "info",
      `vlm: described=${result.vlm.described} skipped=${result.vlm.skipped} failed=${result.vlm.failed} cached=${result.vlm.cached}`,
    );
  }

  if (result.assets) {
    log(
      "info",
      `images: saved=${result.assets.saved} deduped=${result.assets.deduped} skipped=${result.assets.skipped} failed=${result.assets.failed}`,
    );
  }
  if (result.citations) {
    log("info", `citations: footnotes=${result.citations.footnotes}`);
  }

  if (total > 0 && result.failed / total > failThreshold) {
    log(
      "error",
      `failure ratio ${(result.failed / total).toFixed(3)} exceeds threshold ${failThreshold.toFixed(3)}`,
    );
    return 1;
  }
  return 0;
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
