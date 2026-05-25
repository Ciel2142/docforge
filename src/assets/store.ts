import { createHash } from "node:crypto";
import { existsSync, mkdirSync, writeFileSync } from "node:fs";
import { dirname, join } from "node:path";

/**
 * Content-addressed sidecar image store, one instance per pipeline run.
 * Filenames are `<sha256[:16]>.<ext>`, so identical bytes collapse to one file
 * and the name is unique enough for an Obsidian bare-filename embed.
 */
export class AssetStore {
  private readonly seen = new Set<string>();
  constructor(private readonly outputDir: string) {}

  save(bytes: Buffer, ext: string): { filename: string; deduped: boolean } {
    const hash = createHash("sha256").update(bytes).digest("hex").slice(0, 16);
    const filename = `${hash}.${ext}`;
    if (this.seen.has(filename)) return { filename, deduped: true };
    this.seen.add(filename);
    const dest = join(this.outputDir, "_assets", filename);
    mkdirSync(dirname(dest), { recursive: true });
    if (!existsSync(dest)) writeFileSync(dest, bytes);
    return { filename, deduped: false };
  }
}
