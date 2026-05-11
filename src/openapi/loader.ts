import { readFileSync } from "node:fs";
import { extname } from "node:path";
import { load as yamlLoad } from "js-yaml";

import { fetchUrl, type FetchOptions } from "../http/fetch.js";

export class UnsupportedSpecError extends Error {
  constructor(message: string) {
    super(message);
    this.name = "UnsupportedSpecError";
  }
}

export function loadSpec(path: string): Record<string, unknown> {
  const suffix = extname(path).toLowerCase();
  const raw = readFileSync(path, "utf8");

  let spec: unknown;
  if (suffix === ".json") {
    spec = JSON.parse(raw);
  } else if (suffix === ".yaml" || suffix === ".yml") {
    spec = yamlLoad(raw);
  } else {
    throw new UnsupportedSpecError(
      `unknown spec suffix '${suffix}' (expected .json/.yaml/.yml)`,
    );
  }

  if (
    spec === null ||
    typeof spec !== "object" ||
    Array.isArray(spec)
  ) {
    throw new UnsupportedSpecError("spec root must be an object");
  }

  const obj = spec as Record<string, unknown>;

  if ("swagger" in obj) {
    throw new UnsupportedSpecError(
      `Swagger 2.0 not supported (found swagger=${JSON.stringify(obj.swagger)}); ` +
        "convert to OpenAPI 3.x first",
    );
  }

  const version = obj.openapi;
  if (typeof version !== "string" || !version.startsWith("3.")) {
    throw new UnsupportedSpecError(
      `unsupported openapi version: ${JSON.stringify(version)} (expected 3.x)`,
    );
  }

  return obj;
}

export async function loadSpecFromUrl(
  url: string,
  opts: FetchOptions,
): Promise<Record<string, unknown>> {
  const res = await fetchUrl(url, opts);
  const ct = res.contentType.toLowerCase();
  const body = res.bytes.toString("utf8");
  let spec: unknown;
  if (ct.includes("json")) {
    spec = JSON.parse(body);
  } else {
    spec = yamlLoad(body);
  }
  if (spec === null || typeof spec !== "object" || Array.isArray(spec)) {
    throw new UnsupportedSpecError("spec root must be an object");
  }
  const obj = spec as Record<string, unknown>;
  if ("swagger" in obj) {
    throw new UnsupportedSpecError(
      `Swagger 2.0 not supported (found swagger=${JSON.stringify(obj.swagger)}); convert to OpenAPI 3.x first`,
    );
  }
  const version = obj.openapi;
  if (typeof version !== "string" || !version.startsWith("3.")) {
    throw new UnsupportedSpecError(
      `unsupported openapi version: ${JSON.stringify(version)} (expected 3.x)`,
    );
  }
  return obj;
}
