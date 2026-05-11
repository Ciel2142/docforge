import { lstatSync, readFileSync } from "node:fs";
import { dirname, relative } from "node:path";
import { pathToFileURL } from "node:url";

import { iterHtmlFiles } from "./walk.js";

export interface SourceItem {
  key: string;
  srcUri: string;
  bytes: Buffer;
  contentType: string;
  error?: string;          // set when fetch failed; convert loop counts as failed
}

export interface Source {
  iter(): AsyncIterable<SourceItem>;
  readonly skippedCount: number;
}

export class FilesystemSource implements Source {
  public skippedCount = 0;
  constructor(
    private readonly source: string,
    private readonly maxBytes: number,
  ) {}

  async *iter(): AsyncIterable<SourceItem> {
    const walk = iterHtmlFiles(this.source, this.maxBytes);
    this.skippedCount = walk.skippedCount;

    const st = lstatSync(this.source);
    const sourceRoot = st.isFile() ? dirname(this.source) : this.source;

    for (const path of walk.paths) {
      const rel = relative(sourceRoot, path).split(/[\\/]/).join("/");
      yield {
        key: rel,
        srcUri: pathToFileURL(path).toString(),
        bytes: readFileSync(path),
        contentType: "text/html",
      };
    }
  }
}
