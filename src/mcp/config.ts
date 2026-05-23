import { accessSync, constants, mkdirSync } from "node:fs";
import { homedir } from "node:os";
import { resolve } from "node:path";

import { VERSION } from "../index.js";

export interface McpConfig {
  qmdRoot: string;
  cacheDir: string;
  userAgent: string;
  maxPages: number;
  maxDepth: number;
  concurrency: number;
  vlm?: { baseUrl: string; model: string; apiKey?: string };
}

function expandHome(p: string): string {
  if (p === "~" || p.startsWith("~/")) {
    return p.replace(/^~/, homedir());
  }
  return p;
}

function parseIntEnv(name: string, fallback: number): number {
  const raw = process.env[name];
  if (raw === undefined || raw === "") return fallback;
  const parsed = Number.parseInt(raw, 10);
  if (!Number.isFinite(parsed) || parsed <= 0) {
    throw new Error(`invalid ${name}: ${raw} (expected positive integer)`);
  }
  return parsed;
}

export function loadConfig(): McpConfig {
  const qmdRootRaw = process.env.DOCFORGE_QMD_ROOT;
  if (!qmdRootRaw) {
    throw new Error("DOCFORGE_QMD_ROOT is required (no default)");
  }
  const qmdRoot = resolve(expandHome(qmdRootRaw));

  mkdirSync(qmdRoot, { recursive: true });
  try {
    accessSync(qmdRoot, constants.W_OK);
  } catch {
    throw new Error(`DOCFORGE_QMD_ROOT not writable: ${qmdRoot}`);
  }

  const cacheDir = resolve(expandHome(process.env.DOCFORGE_CACHE_DIR ?? "~/.cache/docforge"));
  const userAgent = process.env.DOCFORGE_USER_AGENT ?? `docforge/${VERSION}`;

  const vlmBaseUrl = process.env.DOCFORGE_VLM_BASE_URL;
  const vlmModel = process.env.DOCFORGE_VLM_MODEL;
  const vlm =
    vlmBaseUrl && vlmModel
      ? {
          baseUrl: vlmBaseUrl,
          model: vlmModel,
          ...(process.env.DOCFORGE_VLM_API_KEY ? { apiKey: process.env.DOCFORGE_VLM_API_KEY } : {}),
        }
      : undefined;

  return {
    qmdRoot,
    cacheDir,
    userAgent,
    maxPages: parseIntEnv("DOCFORGE_MAX_PAGES", 5000),
    maxDepth: parseIntEnv("DOCFORGE_MAX_DEPTH", 10),
    concurrency: parseIntEnv("DOCFORGE_CONCURRENCY", 4),
    ...(vlm ? { vlm } : {}),
  };
}
