import { Command } from "commander";
import { existsSync, lstatSync, mkdirSync, readFileSync } from "node:fs";
import { basename, dirname, extname, relative, resolve } from "node:path";

import { VERSION } from "./index.js";
import { convertHtml } from "./convert.js";
import { extractTitle } from "./title.js";
import { rewriteInternalLinks } from "./links.js";
import {
  CollisionError,
  buildOutput,
  detectCollisions,
  writeOutput,
  writeReportJson,
  type ReportEntry,
} from "./output.js";
import { iterHtmlFiles } from "./walk.js";
import { log, setLevel } from "./log.js";

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
    .description("Convert HTML to Markdown")
    .argument("<source>", "path to HTML file or directory")
    .requiredOption("--output <dir>", "output directory (mirrors source structure)")
    .option(
      "--fail-threshold <ratio>",
      "max acceptable failure ratio before exit 1 (default 0.10; set 1.0 to disable)",
      "0.10",
    )
    .option(
      "--max-bytes <int>",
      "skip HTML files larger than N bytes (default 10MB)",
      "10485760",
    )
    .option("--dry-run", "walk + report planned outputs, write nothing", false)
    .option("--report-json <path>", "write per-file report JSON to <path>")
    .action(async (source: string, opts: ConvertOpts) => {
      const code = await runConvert(source, opts);
      if (code !== 0) process.exit(code);
    });

  return program;
}

interface ConvertOpts {
  output: string;
  failThreshold: string;
  maxBytes: string;
  dryRun: boolean;
  reportJson?: string | undefined;
}

async function runConvert(sourceArg: string, opts: ConvertOpts): Promise<number> {
  const source = resolve(expandHome(sourceArg));
  const output = resolve(expandHome(opts.output));

  if (!existsSync(source)) {
    log("error", `source not found: ${source}`);
    return 2;
  }
  const st = lstatSync(source);
  if (!st.isFile() && !st.isDirectory()) {
    log("error", `source is neither file nor directory: ${source}`);
    return 2;
  }

  try {
    mkdirSync(output, { recursive: true });
  } catch (e) {
    log("error", `cannot create output dir ${output}: ${(e as Error).message}`);
    return 2;
  }

  const maxBytes = parseInt(opts.maxBytes, 10);
  const failThreshold = parseFloat(opts.failThreshold);

  const walk = iterHtmlFiles(source, maxBytes);
  if (walk.paths.length === 0) {
    log("warn", `no HTML files found under ${source}`);
    log("info", `converted=0 empty=0 skipped=${walk.skippedCount} failed=0 total=0`);
    return 0;
  }

  const sourceRoot = st.isFile() ? dirname(source) : source;

  let mapping: Map<string, string>;
  try {
    mapping = detectCollisions(walk.paths, sourceRoot, output);
  } catch (e) {
    if (e instanceof CollisionError) {
      log("error", e.message);
      return 2;
    }
    throw e;
  }

  let converted = 0;
  let empty = 0;
  let failed = 0;
  const report: ReportEntry[] = [];

  for (const inPath of walk.paths) {
    const rel = relative(sourceRoot, inPath).split(/[\\/]/).join("/");
    const outPath = mapping.get(inPath)!;

    if (opts.dryRun) {
      log("info", `DRY ${rel} -> ${outPath}`);
      continue;
    }

    let raw: string;
    try {
      raw = readFileSync(inPath).toString("utf8");
    } catch (e) {
      failed += 1;
      log("error", `FAIL read ${rel}: ${(e as Error).message}`);
      report.push({
        input: rel,
        output: null,
        status: "failed",
        error: (e as Error).message,
      });
      continue;
    }

    const result = convertHtml(raw);
    if (result.status === "empty") {
      empty += 1;
      log("debug", `empty ${rel}`);
      report.push({ input: rel, output: null, status: "empty" });
      continue;
    }
    if (result.status === "failed") {
      failed += 1;
      log("error", `FAIL ${rel}: ${result.error}`);
      report.push({
        input: rel,
        output: null,
        status: "failed",
        error: result.error,
      });
      continue;
    }

    const stem = basename(inPath, extname(inPath));
    const title = extractTitle(result.h1_text, result.soup_title_text, stem);
    const bodyMd = rewriteInternalLinks(result.body_md);
    const content = buildOutput(title, rel, bodyMd);
    writeOutput(outPath, content);
    converted += 1;
    report.push({ input: rel, output: outPath, status: "ok" });
  }

  const skipped = walk.skippedCount;
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
