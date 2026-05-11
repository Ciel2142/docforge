import { Command } from "commander";
import { mkdirSync } from "node:fs";
import { resolve } from "node:path";

import { VERSION } from "../index.js";
import { log } from "../log.js";
import { UnsupportedSpecError } from "./loader.js";
import { SlugCollisionError } from "./paths.js";
import { runOpenapiPipeline } from "./pipeline.js";
import type { FetchOptions } from "../http/fetch.js";

const DEFAULT_USER_AGENT = `docforge/${VERSION}`;
const DEFAULT_CACHE_DIR = "~/.cache/docforge";

export function registerOpenapiSubcommand(program: Command): void {
  program
    .command("openapi")
    .description("Convert an OpenAPI 3.x spec (path or http(s):// URL) to per-endpoint + per-schema Markdown")
    .argument("<spec>", "filesystem path OR http(s):// URL to spec")
    .requiredOption("--output <dir>", "output directory")
    .option("--cache-dir <path>", "ETag cache directory (URL source only)", DEFAULT_CACHE_DIR)
    .option("--no-cache", "disable ETag cache (URL source only)")
    .option("--user-agent <str>", "User-Agent header (URL source only)", DEFAULT_USER_AGENT)
    .action(async (spec: string, opts: OpenapiOpts) => {
      const code = await runOpenapi(spec, opts);
      if (code !== 0) process.exit(code);
    });
}

interface OpenapiOpts {
  output: string;
  cacheDir: string;
  cache: boolean;
  userAgent: string;
}

function isUrl(s: string): boolean {
  return /^https?:\/\//i.test(s);
}

async function runOpenapi(specArg: string, opts: OpenapiOpts): Promise<number> {
  const output = resolve(expandHome(opts.output));

  let fetchOpts: FetchOptions | undefined;
  if (isUrl(specArg)) {
    const cacheDir = opts.cache ? expandHome(opts.cacheDir) : null;
    if (cacheDir) {
      try {
        mkdirSync(cacheDir, { recursive: true });
      } catch {
        // best-effort cache dir creation; fall back to no cache
      }
    }
    fetchOpts = {
      userAgent: opts.userAgent,
      timeoutMs: 30_000,
      maxBytes: 50 * 1024 * 1024,
      cacheDir: cacheDir,
    };
  }

  const source = isUrl(specArg) ? specArg : resolve(expandHome(specArg));

  try {
    const pipelineOpts = fetchOpts !== undefined
      ? { source, outputDir: output, fetchOptions: fetchOpts }
      : { source, outputDir: output };
    const result = await runOpenapiPipeline(pipelineOpts);
    log("info", `endpoints=${result.endpoints} schemas=${result.schemas}`);
    return 0;
  } catch (e) {
    if (e instanceof UnsupportedSpecError) {
      log("error", e.message);
      return 2;
    }
    if (e instanceof SlugCollisionError) {
      log("error", e.message);
      return 2;
    }
    if (e instanceof Error && e.message) {
      log("error", `failed to parse ${specArg}: ${e.message}`);
      return 2;
    }
    throw e;
  }
}

function expandHome(p: string): string {
  if (p.startsWith("~/") || p === "~") {
    const home = process.env.HOME ?? process.env.USERPROFILE ?? "";
    return p.replace(/^~/, home);
  }
  return p;
}
