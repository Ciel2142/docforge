import { Command } from "commander";
import { mkdirSync, writeFileSync } from "node:fs";
import { basename, resolve } from "node:path";

import { VERSION } from "../index.js";
import { log } from "../log.js";
import { iterEndpoints, iterSchemas } from "./iter.js";
import { UnsupportedSpecError, loadSpec, loadSpecFromUrl } from "./loader.js";
import {
  SlugCollisionError,
  detectEndpointCollisions,
  endpointFilename,
  schemaFilename,
} from "./paths.js";
import { renderEndpoint, renderSchema } from "./render.js";
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

  let spec: Record<string, unknown>;
  let specFilename: string;
  try {
    if (isUrl(specArg)) {
      const fetchOpts: FetchOptions = {
        userAgent: opts.userAgent,
        timeoutMs: 30_000,
        maxBytes: 50 * 1024 * 1024,
        cacheDir: opts.cache ? expandHome(opts.cacheDir) : null,
      };
      if (fetchOpts.cacheDir) {
        try {
          mkdirSync(fetchOpts.cacheDir, { recursive: true });
        } catch {
          fetchOpts.cacheDir = null;
        }
      }
      spec = await loadSpecFromUrl(specArg, fetchOpts);
      specFilename = basename(new URL(specArg).pathname) || "openapi";
    } else {
      const specPath = resolve(expandHome(specArg));
      spec = loadSpec(specPath);
      specFilename = basename(specPath);
    }
  } catch (e) {
    if (e instanceof UnsupportedSpecError) {
      log("error", e.message);
      return 2;
    }
    if (e instanceof Error && e.message) {
      log("error", `failed to parse ${specArg}: ${e.message}`);
      return 2;
    }
    throw e;
  }

  const endpointsDir = resolve(output, "endpoints");
  const schemasDir = resolve(output, "schemas");
  mkdirSync(endpointsDir, { recursive: true });
  mkdirSync(schemasDir, { recursive: true });

  const endpoints = Array.from(iterEndpoints(spec));
  const schemas = Array.from(iterSchemas(spec));

  try {
    detectEndpointCollisions(endpoints.map((e) => [e.method, e.path]));
  } catch (e) {
    if (e instanceof SlugCollisionError) {
      log("error", e.message);
      return 2;
    }
    throw e;
  }

  for (const ep of endpoints) {
    const outPath = resolve(endpointsDir, endpointFilename(ep.method, ep.path));
    writeFileSync(outPath, renderEndpoint(ep, { specFilename }), "utf8");
  }
  for (const sc of schemas) {
    const outPath = resolve(schemasDir, schemaFilename(sc.name));
    writeFileSync(outPath, renderSchema(sc, { specFilename }), "utf8");
  }

  log("info", `endpoints=${endpoints.length} schemas=${schemas.length}`);
  return 0;
}

function expandHome(p: string): string {
  if (p.startsWith("~/") || p === "~") {
    const home = process.env.HOME ?? process.env.USERPROFILE ?? "";
    return p.replace(/^~/, home);
  }
  return p;
}
