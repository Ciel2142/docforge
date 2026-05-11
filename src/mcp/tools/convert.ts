import type { ToolDefinition } from "../server.js";
import { McpError } from "../errors.js";
import type { McpConfig } from "../config.js";

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
  handler: async (_args, _ctx) => {
    throw new McpError("WRITE_FAILED", "convert handler not yet implemented");
  },
};

export type ConvertContext = { config: McpConfig };
