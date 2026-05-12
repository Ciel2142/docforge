import { readdirSync } from "node:fs";
import type { Dirent } from "node:fs";
import { join } from "node:path";

import { readManifest } from "../manifest.js";
import type { ServerContext, ToolDefinition } from "../server.js";

interface ListArgs {
  filter?: string;
}

export const listCorporaTool: ToolDefinition = {
  name: "list_corpora",
  description: "Enumerate docforge-produced corpora under $DOCFORGE_QMD_ROOT.",
  inputSchema: {
    type: "object",
    properties: {
      filter: { type: "string", description: "substring match on collection name" },
    },
    additionalProperties: false,
  },
  handler: async (raw, ctx: ServerContext) => {
    const args: ListArgs = {};
    const f = raw.filter;
    if (typeof f === "string") args.filter = f;

    const corpora: Array<{
      collection: string; path: string; source_url: string;
      kind: string; last_run: string; page_count: number; sha: string;
    }> = [];

    let entries: Dirent[];
    try {
      entries = readdirSync(ctx.config.qmdRoot, { withFileTypes: true });
    } catch {
      entries = [];
    }

    for (const entry of entries) {
      if (!entry.isDirectory()) continue;
      if (entry.name.endsWith(".tmp") || entry.name.endsWith(".old")) continue;
      if (args.filter && !entry.name.includes(args.filter)) continue;
      const path = join(ctx.config.qmdRoot, entry.name);
      const m = readManifest(path);
      if (!m) continue;
      corpora.push({
        collection: m.collection,
        path,
        source_url: m.source_url,
        kind: m.kind,
        last_run: m.last_run,
        page_count: m.page_count,
        sha: m.sha,
      });
    }

    corpora.sort((a, b) => a.collection.localeCompare(b.collection));
    const structuredContent = { corpora };
    return {
      content: [{ type: "text", text: JSON.stringify(structuredContent) }],
      structuredContent,
    };
  },
};
