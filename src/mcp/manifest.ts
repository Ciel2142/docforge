import { createHash } from "node:crypto";
import {
  existsSync,
  readFileSync,
  readdirSync,
  renameSync,
  statSync,
  writeFileSync,
} from "node:fs";
import { join, relative, sep } from "node:path";

export const MANIFEST_FILE = ".docforge.json";
const FAILURES_FILE = ".docforge.failures.log";
const MANIFEST_VERSION = 1 as const;

export type CorpusKind = "page" | "site" | "llms-full" | "llms-index" | "openapi";

export interface Manifest {
  version: 1;
  collection: string;
  source_url: string;
  kind: CorpusKind;
  last_run: string;
  page_count: number;
  sha: string;
  docforge_version: string;
}

export function readManifest(collectionDir: string): Manifest | null {
  const path = join(collectionDir, MANIFEST_FILE);
  if (!existsSync(path)) return null;
  let parsed: unknown;
  try {
    parsed = JSON.parse(readFileSync(path, "utf8"));
  } catch {
    return null;
  }
  if (!isManifest(parsed)) return null;
  return parsed;
}

function isManifest(value: unknown): value is Manifest {
  if (!value || typeof value !== "object") return false;
  const m = value as Record<string, unknown>;
  return (
    m.version === MANIFEST_VERSION &&
    typeof m.collection === "string" &&
    typeof m.source_url === "string" &&
    (m.kind === "page" || m.kind === "site" || m.kind === "llms-full" || m.kind === "llms-index" || m.kind === "openapi") &&
    typeof m.last_run === "string" &&
    typeof m.page_count === "number" &&
    typeof m.sha === "string" &&
    typeof m.docforge_version === "string"
  );
}

export function writeManifest(collectionDir: string, manifest: Manifest): void {
  const finalPath = join(collectionDir, MANIFEST_FILE);
  const tmpPath = `${finalPath}.tmp`;
  writeFileSync(tmpPath, JSON.stringify(manifest, null, 2));
  renameSync(tmpPath, finalPath);
}

export function computeCorpusSha(collectionDir: string): string {
  const entries = collectFiles(collectionDir, collectionDir)
    .filter(rel => rel !== MANIFEST_FILE && rel !== FAILURES_FILE)
    .sort();

  const hasher = createHash("sha256");
  for (const rel of entries) {
    const abs = join(collectionDir, rel);
    const contentHash = createHash("sha256").update(readFileSync(abs)).digest("hex");
    hasher.update(`${rel.split(sep).join("/")}\0${contentHash}\n`);
  }
  return hasher.digest("hex");
}

function collectFiles(root: string, dir: string): string[] {
  const out: string[] = [];
  for (const entry of readdirSync(dir, { withFileTypes: true })) {
    const abs = join(dir, entry.name);
    if (entry.isDirectory()) {
      out.push(...collectFiles(root, abs));
    } else if (entry.isFile()) {
      out.push(relative(root, abs));
    }
  }
  return out;
}

export function fileExists(path: string): boolean {
  try {
    return statSync(path).isFile();
  } catch {
    return false;
  }
}
