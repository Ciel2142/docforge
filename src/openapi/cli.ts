import { Command } from "commander";
import { mkdirSync, writeFileSync } from "node:fs";
import { basename, resolve } from "node:path";

import { log } from "../log.js";
import { iterEndpoints, iterSchemas } from "./iter.js";
import { UnsupportedSpecError, loadSpec } from "./loader.js";
import {
  SlugCollisionError,
  detectEndpointCollisions,
  endpointFilename,
  schemaFilename,
} from "./paths.js";
import { renderEndpoint, renderSchema } from "./render.js";

export function registerOpenapiSubcommand(program: Command): void {
  program
    .command("openapi")
    .description("Convert an OpenAPI 3.x spec to per-endpoint + per-schema Markdown")
    .argument("<spec>", "path to OpenAPI 3.x JSON or YAML spec file")
    .requiredOption("--output <dir>", "output directory")
    .action((spec: string, opts: { output: string }) => {
      const code = runOpenapi(spec, opts);
      if (code !== 0) process.exit(code);
    });
}

function runOpenapi(specArg: string, opts: { output: string }): number {
  const specPath = resolve(expandHome(specArg));
  const output = resolve(expandHome(opts.output));

  let spec: Record<string, unknown>;
  try {
    spec = loadSpec(specPath);
  } catch (e) {
    if (e instanceof UnsupportedSpecError) {
      log("error", e.message);
      return 2;
    }
    if (e instanceof Error && e.message) {
      log("error", `failed to parse ${specPath}: ${e.message}`);
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

  const specFilename = basename(specPath);

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
