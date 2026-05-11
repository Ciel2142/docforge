import {
  existsSync,
  mkdirSync,
  mkdtempSync,
  readdirSync,
  readFileSync,
  rmSync,
  statSync,
  writeFileSync,
} from "node:fs";
import { tmpdir } from "node:os";
import { join, relative, sep } from "node:path";

import { deriveCollectionName } from "../collection.js";
import { McpError } from "../errors.js";
import {
  readManifest,
  writeManifest,
  computeCorpusSha,
  type Manifest,
} from "../manifest.js";
import { collectionPaths, commitTmpToFinal } from "../atomic.js";
import { clampPreviewBytes, truncateMarkdown } from "../preview.js";
import type { ServerContext, ToolDefinition } from "../server.js";
import { VERSION } from "../../index.js";
import { runOpenapiPipeline } from "../../openapi/pipeline.js";
import { loadSpec, loadSpecFromUrl } from "../../openapi/loader.js";
import type { FetchOptions } from "../../http/fetch.js";

interface OpenapiArgs {
  source: string;
  is_inline?: boolean;
  format?: "auto" | "json" | "yaml";
  corpus?: string;
  force_refresh?: boolean;
  preview_bytes?: number;
}

function parseArgs(raw: Record<string, unknown>): OpenapiArgs {
  const source = raw.source;
  if (typeof source !== "string" || !source) {
    throw new McpError("INVALID_URL", "source is required");
  }
  const args: OpenapiArgs = { source };
  if (typeof raw.is_inline === "boolean") args.is_inline = raw.is_inline;
  if (raw.format === "auto" || raw.format === "json" || raw.format === "yaml") args.format = raw.format;
  if (typeof raw.corpus === "string") args.corpus = raw.corpus;
  if (typeof raw.force_refresh === "boolean") args.force_refresh = raw.force_refresh;
  if (typeof raw.preview_bytes === "number") args.preview_bytes = raw.preview_bytes;
  return args;
}

function listPages(dir: string): Array<{ rel_path: string; bytes: number }> {
  const out: Array<{ rel_path: string; bytes: number }> = [];
  const walk = (d: string) => {
    for (const e of readdirSync(d, { withFileTypes: true })) {
      const abs = join(d, e.name);
      if (e.isDirectory()) walk(abs);
      else if (
        e.isFile() &&
        e.name !== ".docforge.json" &&
        e.name !== ".docforge.failures.log"
      ) {
        out.push({
          rel_path: relative(dir, abs).split(sep).join("/"),
          bytes: statSync(abs).size,
        });
      }
    }
  };
  walk(dir);
  out.sort((a, b) => a.rel_path.localeCompare(b.rel_path));
  return out;
}

function isUrl(s: string): boolean {
  return /^https?:\/\//i.test(s);
}

async function loadSpecRef(
  ref: string,
  urlSource: boolean,
  fetchOpts: FetchOptions,
): Promise<Record<string, unknown>> {
  return urlSource ? loadSpecFromUrl(ref, fetchOpts) : loadSpec(ref);
}

export const convertOpenapiTool: ToolDefinition = {
  name: "convert_openapi",
  description: "Convert an OpenAPI spec (URL or inline) to per-operation Markdown.",
  inputSchema: {
    type: "object",
    properties: {
      source: { type: "string", description: "URL or raw spec text" },
      is_inline: { type: "boolean", default: false },
      format: { type: "string", enum: ["auto", "json", "yaml"], default: "auto" },
      corpus: { type: "string" },
      force_refresh: { type: "boolean", default: false },
      preview_bytes: { type: "integer" },
    },
    required: ["source"],
    additionalProperties: false,
  },
  handler: async (raw, ctx: ServerContext) => {
    const args = parseArgs(raw);

    let specRef = args.source;
    let scratch: string | null = null;
    if (args.is_inline) {
      scratch = mkdtempSync(join(tmpdir(), "df-openapi-inline-"));
      const ext = args.format === "json" ? "json" : "yaml";
      specRef = join(scratch, `spec.${ext}`);
      writeFileSync(specRef, args.source);
    }

    const fetchOpts: FetchOptions = {
      userAgent: ctx.config.userAgent,
      timeoutMs: 30_000,
      maxBytes: 50 * 1024 * 1024,
      cacheDir: ctx.config.cacheDir,
    };

    let openApiInfo: { title: string; version?: string } | undefined;
    let parsedSpec: Record<string, unknown>;
    try {
      parsedSpec = await loadSpecRef(specRef, isUrl(specRef), fetchOpts);
      const info = parsedSpec["info"];
      if (info && typeof info === "object") {
        const infoObj = info as Record<string, unknown>;
        const title = infoObj["title"];
        if (typeof title === "string") {
          openApiInfo = { title };
          const version = infoObj["version"];
          if (version !== undefined) openApiInfo.version = String(version);
        }
      }
    } catch (e) {
      if (scratch) rmSync(scratch, { recursive: true, force: true });
      throw new McpError("OPENAPI_PARSE", (e as Error).message);
    }

    const collection = deriveCollectionName({
      url: args.is_inline ? `file://${specRef}` : args.source,
      ...(openApiInfo !== undefined ? { openApi: openApiInfo } : {}),
      ...(args.corpus !== undefined ? { override: args.corpus } : {}),
    });
    const paths = collectionPaths(ctx.config.qmdRoot, collection);

    const existing = readManifest(paths.final);
    if (existing && !args.force_refresh && existing.source_url !== args.source) {
      if (scratch) rmSync(scratch, { recursive: true, force: true });
      throw new McpError(
        "SOURCE_MISMATCH",
        `collection "${collection}" already exists for ${existing.source_url}`,
        "pass force_refresh=true to overwrite, or use a different corpus name",
      );
    }

    const release = await ctx.locks.acquire(ctx.config.qmdRoot, collection);
    try {
      // Re-check inside lock to close TOCTOU race.
      const lockedExisting = readManifest(paths.final);
      if (lockedExisting && !args.force_refresh && lockedExisting.source_url !== args.source) {
        throw new McpError(
          "SOURCE_MISMATCH",
          `collection "${collection}" already exists for ${lockedExisting.source_url}`,
          "pass force_refresh=true to overwrite, or use a different corpus name",
        );
      }

      if (existsSync(paths.tmp)) rmSync(paths.tmp, { recursive: true, force: true });
      mkdirSync(paths.tmp, { recursive: true });

      try {
        await runOpenapiPipeline({ source: specRef, outputDir: paths.tmp, fetchOptions: fetchOpts, spec: parsedSpec });
      } catch (e) {
        rmSync(paths.tmp, { recursive: true, force: true });
        throw new McpError("OPENAPI_PARSE", (e as Error).message);
      }

      const pages = listPages(paths.tmp);
      if (pages.length === 0) {
        rmSync(paths.tmp, { recursive: true, force: true });
        throw new McpError("OPENAPI_PARSE", "spec produced no operations");
      }

      const sha = computeCorpusSha(paths.tmp);
      const manifest: Manifest = {
        version: 1,
        collection,
        source_url: args.source,
        kind: "openapi",
        last_run: new Date().toISOString(),
        page_count: pages.length,
        sha,
        docforge_version: VERSION,
      };
      writeManifest(paths.tmp, manifest);
      try {
        commitTmpToFinal(paths);
      } catch (e) {
        rmSync(paths.tmp, { recursive: true, force: true });
        throw new McpError("WRITE_FAILED", (e as Error).message);
      }

      const previewPath =
        pages.find((p) => p.rel_path === "index.md")?.rel_path ??
        pages[0]?.rel_path ??
        "";
      const previewLimit = clampPreviewBytes(args.preview_bytes);
      const previewRaw = previewPath
        ? readFileSync(join(paths.final, previewPath), "utf8")
        : "";
      const truncated = truncateMarkdown(previewRaw, previewLimit);

      const structuredContent = {
        collection,
        path: paths.final,
        kind_resolved: "openapi" as const,
        pages: pages.map((p) => ({
          rel_path: p.rel_path,
          title: p.rel_path,
          source_url: args.source,
          bytes: p.bytes,
        })),
        preview: {
          rel_path: previewPath,
          markdown: truncated.markdown,
          truncated: truncated.truncated,
        },
        total_bytes: pages.reduce((s, p) => s + p.bytes, 0),
        warnings: [] as string[],
      };

      return {
        content: [{ type: "text", text: JSON.stringify(structuredContent) }],
        structuredContent,
      };
    } finally {
      if (scratch) rmSync(scratch, { recursive: true, force: true });
      await release();
    }
  },
};
