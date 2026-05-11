import { Command } from "commander";
import { mkdirSync } from "node:fs";
import { resolve } from "node:path";

import { VERSION } from "./index.js";
import { writeReportJson } from "./output.js";
import { log, setLevel } from "./log.js";
import { registerOpenapiSubcommand } from "./openapi/cli.js";
import { runPipeline, type RunPipelineOptions } from "./runPipeline.js";

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

  const pipelineOpts: RunPipelineOptions = {
    source: isUrl(sourceArg) ? sourceArg : resolve(expandHome(sourceArg)),
    outputDir: output,
    maxBytes,
    dryRun: opts.dryRun,
  };
  if (opts.selector !== undefined) pipelineOpts.selector = opts.selector;

  if (isUrl(sourceArg)) {
    const llmsFullMode = opts.llmsFull as "auto" | "force" | "off";
    if (llmsFullMode !== "auto" && llmsFullMode !== "force" && llmsFullMode !== "off") {
      log("error", `invalid --llms-full value: ${opts.llmsFull} (expected auto|force|off)`);
      return 2;
    }
    pipelineOpts.fetchOptions = {
      userAgent: opts.userAgent,
      timeoutMs: 30_000,
      maxBytes,
      cacheDir: opts.cache ? expandHome(opts.cacheDir) : null,
    };
    pipelineOpts.crawlOptions = {
      maxPages: parseInt(opts.maxPages, 10),
      maxDepth: parseInt(opts.maxDepth, 10),
      concurrency: parseInt(opts.concurrency, 10),
      userAgent: opts.userAgent,
      llmsFullMode,
    };
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
