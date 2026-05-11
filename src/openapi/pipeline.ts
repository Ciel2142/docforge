import { mkdirSync, writeFileSync } from "node:fs";
import { basename, resolve } from "node:path";

import type { FetchOptions } from "../http/fetch.js";
import { iterEndpoints, iterSchemas } from "./iter.js";
import { loadSpec, loadSpecFromUrl } from "./loader.js";
import {
  detectEndpointCollisions,
  endpointFilename,
  schemaFilename,
} from "./paths.js";
import { renderEndpoint, renderSchema } from "./render.js";

export interface RunOpenapiPipelineOptions {
  /** Filesystem path OR http(s):// URL to the spec. */
  source: string;
  /** Absolute output directory. Subdirectories `endpoints/` and `schemas/` are created here. */
  outputDir: string;
  /** Fetch options used only when source is a URL. */
  fetchOptions?: FetchOptions;
  /** Optional pre-parsed spec; if present, the internal load step is skipped. */
  spec?: Record<string, unknown>;
}

export interface OpenapiPipelineResult {
  endpoints: number;
  schemas: number;
  specFilename: string;
}

function isUrl(s: string): boolean {
  return /^https?:\/\//i.test(s);
}

export async function runOpenapiPipeline(
  opts: RunOpenapiPipelineOptions,
): Promise<OpenapiPipelineResult> {
  const { source, outputDir, fetchOptions } = opts;

  let spec: Record<string, unknown>;
  let specFilename: string;

  if (opts.spec) {
    spec = opts.spec;
    specFilename = isUrl(source)
      ? basename(new URL(source).pathname) || "openapi"
      : basename(resolve(source));
  } else if (isUrl(source)) {
    const fetchOpts: FetchOptions = fetchOptions ?? {
      userAgent: "docforge",
      timeoutMs: 30_000,
      maxBytes: 50 * 1024 * 1024,
      cacheDir: null,
    };
    spec = await loadSpecFromUrl(source, fetchOpts);
    specFilename = basename(new URL(source).pathname) || "openapi";
  } else {
    const specPath = resolve(source);
    spec = loadSpec(specPath);
    specFilename = basename(specPath);
  }

  const endpointsDir = resolve(outputDir, "endpoints");
  const schemasDir = resolve(outputDir, "schemas");
  mkdirSync(endpointsDir, { recursive: true });
  mkdirSync(schemasDir, { recursive: true });

  const endpoints = Array.from(iterEndpoints(spec));
  const schemas = Array.from(iterSchemas(spec));

  // Throws SlugCollisionError if any endpoint paths collide to the same filename.
  detectEndpointCollisions(endpoints.map((e) => [e.method, e.path]));

  for (const ep of endpoints) {
    const outPath = resolve(endpointsDir, endpointFilename(ep.method, ep.path));
    writeFileSync(outPath, renderEndpoint(ep, { specFilename }), "utf8");
  }
  for (const sc of schemas) {
    const outPath = resolve(schemasDir, schemaFilename(sc.name));
    writeFileSync(outPath, renderSchema(sc, { specFilename }), "utf8");
  }

  return {
    endpoints: endpoints.length,
    schemas: schemas.length,
    specFilename,
  };
}
