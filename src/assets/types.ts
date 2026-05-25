export interface AssetStats {
  saved: number;
  deduped: number;
  skipped: number;
  failed: number;
}

export interface RewriteDeps {
  /** Resolve image bytes + canonical extension for a ref's src. Throws on failure. */
  resolve(src: string): Promise<{ bytes: Buffer; ext: string }>;
  /** Persist bytes; return the bare filename to embed + whether it was a dedup. */
  store(bytes: Buffer, ext: string): { filename: string; deduped: boolean };
}
