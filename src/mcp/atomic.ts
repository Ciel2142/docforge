import {
  existsSync, mkdirSync, readdirSync, renameSync, rmSync, statSync,
} from "node:fs";
import { join } from "node:path";

export interface CollectionPaths {
  final: string;
  tmp: string;
  old: string;
  lock: string;
}

export function collectionPaths(root: string, collection: string): CollectionPaths {
  return {
    final: join(root, collection),
    tmp: join(root, `${collection}.tmp`),
    old: join(root, `${collection}.old`),
    lock: join(root, `${collection}.lock`),
  };
}

export function ensureRoot(root: string): void {
  mkdirSync(root, { recursive: true });
}

export function commitTmpToFinal(p: CollectionPaths): void {
  if (!existsSync(p.tmp)) {
    throw new Error(`tmp dir missing: ${p.tmp}`);
  }
  if (existsSync(p.final)) {
    if (existsSync(p.old)) rmSync(p.old, { recursive: true, force: true });
    renameSync(p.final, p.old);
  }
  renameSync(p.tmp, p.final);
  if (existsSync(p.old)) {
    rmSync(p.old, { recursive: true, force: true });
  }
}

export function removeStaleTmpDirs(root: string, maxAgeMs: number): void {
  if (!existsSync(root)) return;
  const now = Date.now();
  for (const entry of readdirSync(root, { withFileTypes: true })) {
    if (!entry.isDirectory()) continue;
    if (!entry.name.endsWith(".tmp")) continue;
    const full = join(root, entry.name);
    try {
      const st = statSync(full);
      if (now - st.mtimeMs >= maxAgeMs) {
        rmSync(full, { recursive: true, force: true });
      }
    } catch {
      // best-effort cleanup; ignore
    }
  }
}
