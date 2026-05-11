import {
  existsSync, mkdirSync, readdirSync, readFileSync, rmSync, statSync,
} from "node:fs";
import { join, relative, sep } from "node:path";

import { runPipeline, type RunPipelineOptions } from "../../runPipeline.js";
import { deriveCollectionName } from "../collection.js";
import { McpError } from "../errors.js";
import {
  readManifest, writeManifest, computeCorpusSha,
  type Manifest, type CorpusKind,
} from "../manifest.js";
import { collectionPaths, commitTmpToFinal } from "../atomic.js";
import { clampPreviewBytes, truncateMarkdown } from "../preview.js";
import type { ServerContext, ToolDefinition } from "../server.js";
import { VERSION } from "../../index.js";
import { probeLlmsFullTxt } from "../../http/llms.js";

interface ConvertArgs {
  url: string;
  corpus?: string;
  kind?: "auto" | "page" | "site" | "llms-full";
  llms_full?: "auto" | "force" | "off";
  selector?: string;
  max_pages?: number;
  max_depth?: number;
  concurrency?: number;
  user_agent?: string;
  force_refresh?: boolean;
  preview_bytes?: number;
}

function parseArgs(raw: Record<string, unknown>): ConvertArgs {
  const url = raw.url;
  if (typeof url !== "string" || !url) {
    throw new McpError("INVALID_URL", "url is required");
  }
  if (!/^https?:\/\//i.test(url)) {
    throw new McpError("INVALID_URL", `unsupported scheme in ${url}`, "use http:// or https://");
  }
  const args: ConvertArgs = { url };
  if (typeof raw.corpus === "string") args.corpus = raw.corpus;
  if (typeof raw.kind === "string") {
    const k = raw.kind as "auto" | "page" | "site" | "llms-full";
    args.kind = k;
  }
  if (typeof raw.llms_full === "string") {
    const lf = raw.llms_full as "auto" | "force" | "off";
    args.llms_full = lf;
  }
  if (typeof raw.selector === "string") args.selector = raw.selector;
  if (typeof raw.max_pages === "number") args.max_pages = raw.max_pages;
  if (typeof raw.max_depth === "number") args.max_depth = raw.max_depth;
  if (typeof raw.concurrency === "number") args.concurrency = raw.concurrency;
  if (typeof raw.user_agent === "string") args.user_agent = raw.user_agent;
  if (typeof raw.force_refresh === "boolean") args.force_refresh = raw.force_refresh;
  if (typeof raw.preview_bytes === "number") args.preview_bytes = raw.preview_bytes;
  return args;
}

function normaliseUrlForCompare(raw: string): string {
  const u = new URL(raw);
  const host = u.hostname.toLowerCase();
  const port = u.port && !defaultPort(u.protocol, u.port) ? `:${u.port}` : "";
  const path = u.pathname.replace(/\/+$/, "") || "/";
  return `${u.protocol}//${host}${port}${path}`;
}
function defaultPort(proto: string, port: string): boolean {
  return (proto === "http:" && port === "80") || (proto === "https:" && port === "443");
}

async function resolveKind(args: ConvertArgs, userAgent: string): Promise<CorpusKind> {
  if (args.kind && args.kind !== "auto") return args.kind;
  const mode = args.llms_full ?? "auto";
  if (mode !== "off") {
    const probe = await probeLlmsFullTxt(args.url, {
      userAgent,
      timeoutMs: 10_000,
      maxBytes: 10 * 1024 * 1024,
      cacheDir: null,
    });
    if (probe) return "llms-full";
    if (mode === "force") {
      throw new McpError(
        "LLMS_FULL_MISSING",
        `llms-full.txt not found at ${args.url}`,
        "use llms_full=\"auto\" to fall back to HTML, or pick a different source",
      );
    }
  }
  const path = new URL(args.url).pathname;
  const last = path.split("/").filter(Boolean).pop() ?? "";
  if (/\.(html?|md|txt|json|ya?ml)$/i.test(last)) return "page";
  return "site";
}

function listPages(collectionDir: string): Array<{ rel_path: string; bytes: number }> {
  const out: Array<{ rel_path: string; bytes: number }> = [];
  const walk = (dir: string) => {
    for (const e of readdirSync(dir, { withFileTypes: true })) {
      const abs = join(dir, e.name);
      if (e.isDirectory()) walk(abs);
      else if (e.isFile() && e.name !== ".docforge.json" && e.name !== ".docforge.failures.log") {
        const rel = relative(collectionDir, abs).split(sep).join("/");
        out.push({ rel_path: rel, bytes: statSync(abs).size });
      }
    }
  };
  walk(collectionDir);
  out.sort((a, b) => a.rel_path.localeCompare(b.rel_path));
  return out;
}

function pickPreviewPath(pages: Array<{ rel_path: string }>): string | null {
  const preferred = ["index.md", "llms-full.md"];
  for (const p of preferred) {
    if (pages.some(x => x.rel_path === p)) return p;
  }
  return pages[0]?.rel_path ?? null;
}

function readTitle(absPath: string): string {
  const head = readFileSync(absPath, "utf8").slice(0, 4096);
  const m = head.match(/^---\s*\ntitle:\s*"?([^"\n]+)"?\s*\n/);
  return m?.[1]?.trim() ?? "";
}

export const convertTool: ToolDefinition = {
  name: "convert",
  description: "Convert a URL (page, site crawl, or llms-full.txt) to Markdown under $DOCFORGE_QMD_ROOT.",
  inputSchema: {
    type: "object",
    properties: {
      url: { type: "string", description: "http(s) URL" },
      corpus: { type: "string", description: "override derived collection name" },
      kind: { type: "string", enum: ["auto", "page", "site", "llms-full"], default: "auto" },
      llms_full: { type: "string", enum: ["auto", "force", "off"], default: "auto" },
      selector: { type: "string", description: "CSS selector override for body extraction" },
      max_pages: { type: "integer", minimum: 1 },
      max_depth: { type: "integer", minimum: 1 },
      concurrency: { type: "integer", minimum: 1 },
      user_agent: { type: "string" },
      force_refresh: { type: "boolean", default: false },
      preview_bytes: { type: "integer" },
    },
    required: ["url"],
    additionalProperties: false,
  },
  handler: async (raw, ctx: ServerContext) => {
    const args = parseArgs(raw);
    const collection = deriveCollectionName({
      url: args.url,
      ...(args.corpus !== undefined ? { override: args.corpus } : {}),
    });
    const paths = collectionPaths(ctx.config.qmdRoot, collection);

    const existing = readManifest(paths.final);
    if (existing && !args.force_refresh) {
      if (normaliseUrlForCompare(existing.source_url) !== normaliseUrlForCompare(args.url)) {
        throw new McpError(
          "SOURCE_MISMATCH",
          `collection "${collection}" already exists for ${existing.source_url}`,
          "pass force_refresh=true to overwrite, or use a different corpus name",
        );
      }
    }

    const release = await ctx.locks.acquire(ctx.config.qmdRoot, collection);
    try {
      if (existsSync(paths.tmp)) rmSync(paths.tmp, { recursive: true, force: true });
      mkdirSync(paths.tmp, { recursive: true });

      const kind = await resolveKind(args, args.user_agent ?? ctx.config.userAgent);

      const pipelineOpts: RunPipelineOptions = {
        source: args.url,
        outputDir: paths.tmp,
        maxBytes: 10 * 1024 * 1024,
        dryRun: false,
        fetchOptions: {
          userAgent: args.user_agent ?? ctx.config.userAgent,
          timeoutMs: 30_000,
          maxBytes: 10 * 1024 * 1024,
          cacheDir: ctx.config.cacheDir,
        },
        crawlOptions: {
          maxPages: kind === "page" ? 1 : (args.max_pages ?? ctx.config.maxPages),
          maxDepth: args.max_depth ?? ctx.config.maxDepth,
          concurrency: args.concurrency ?? ctx.config.concurrency,
          userAgent: args.user_agent ?? ctx.config.userAgent,
          llmsFullMode: args.llms_full ?? "auto",
        },
      };
      if (args.selector !== undefined) pipelineOpts.selector = args.selector;

      let result;
      try {
        result = await runPipeline(pipelineOpts);
      } catch (e) {
        rmSync(paths.tmp, { recursive: true, force: true });
        throw new McpError("FETCH_FAILED", (e as Error).message);
      }

      const pages = listPages(paths.tmp);
      if (pages.length === 0) {
        rmSync(paths.tmp, { recursive: true, force: true });
        throw new McpError("FETCH_FAILED", "no pages produced from source");
      }

      const sha = computeCorpusSha(paths.tmp);
      const manifest: Manifest = {
        version: 1,
        collection,
        source_url: args.url,
        kind,
        last_run: new Date().toISOString(),
        page_count: pages.length,
        sha,
        docforge_version: VERSION,
      };
      writeManifest(paths.tmp, manifest);
      commitTmpToFinal(paths);

      const previewPath = pickPreviewPath(pages);
      const previewLimit = clampPreviewBytes(args.preview_bytes);
      const previewRaw = previewPath
        ? readFileSync(join(paths.final, previewPath), "utf8")
        : "";
      const truncated = truncateMarkdown(previewRaw, previewLimit);

      const warnings: string[] = [];
      if (result.failed > 0) warnings.push(`${result.failed} pages failed extraction`);

      const structuredContent = {
        collection,
        path: paths.final,
        kind_resolved: kind,
        pages: pages.map(p => ({
          rel_path: p.rel_path,
          title: readTitle(join(paths.final, p.rel_path)) || p.rel_path,
          source_url: args.url,
          bytes: p.bytes,
        })),
        preview: previewPath
          ? { rel_path: previewPath, markdown: truncated.markdown, truncated: truncated.truncated }
          : { rel_path: "", markdown: "", truncated: false },
        total_bytes: pages.reduce((s, p) => s + p.bytes, 0),
        warnings,
      };

      return {
        content: [{ type: "text", text: JSON.stringify(structuredContent) }],
        structuredContent,
      };
    } finally {
      await release();
    }
  },
};
